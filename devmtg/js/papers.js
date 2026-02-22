/**
 * papers.js - Papers/blogs listing page logic for LLVM Research Library
 */

// ============================================================
// State
// ============================================================

const HubUtils = window.LLVMHubUtils || {};

let allPapers = [];
let searchIndex = [];
let viewMode = 'grid'; // 'grid' | 'list'
let debounceTimer = null;
let searchMode = 'browse'; // 'browse' | 'exact' | 'fuzzy'
let autocompleteIndex = {
  tags: [],      // Paper-only key topics (used for local paper topic filters)
  speakers: [],  // Paper-only authors (used for local author filters)
  topics: [],    // Combined talks + papers topics
  people: [],    // Combined speakers + authors
  talks: [],     // Talk titles
  papers: [],    // Paper titles
};
let dropdownActiveIdx = -1;
let talkSearchIndex = [];
let universalAutocompletePromise = null;
const INITIAL_RENDER_BATCH_SIZE = 60;
const RENDER_BATCH_SIZE = 40;
const LOAD_MORE_ROOT_MARGIN = '900px 0px';
let activeRenderResults = [];
let activeRenderTokens = [];
let renderedCount = 0;
let loadMoreObserver = null;
let loadMoreScrollHandler = null;
const MIN_TOPIC_FILTER_COUNT = 4;
const MAX_TOPIC_FILTERS = 180;
const BLOG_SOURCE_SLUGS = new Set(['llvm-blog-www', 'llvm-www-blog']);
const PAPER_FILTER_VALUE = 'paper';
const BLOG_FILTER_VALUE = 'blog';
const CONTENT_TYPE_ORDER = [PAPER_FILTER_VALUE, BLOG_FILTER_VALUE];
const DIRECT_PDF_URL_RE = /\.pdf(?:$|[?#])|\/pdf(?:$|[/?#])|[?&](?:format|type|output)=pdf(?:$|[&#])|[?&]filename=[^&#]*\.pdf(?:$|[&#])/i;
const CONTENT_TYPE_META = {
  [PAPER_FILTER_VALUE]: {
    label: 'Paper',
    badgeClass: 'badge-paper',
  },
  [BLOG_FILTER_VALUE]: {
    label: 'Blog',
    badgeClass: 'badge-blog',
  },
};

const ALL_WORK_PAGE_PATH = 'work.html';
const BLOGS_PAGE_PATH = 'blogs.html';
const PAPERS_PAGE_PATH = 'papers.html';
const PAPER_SORT_MODES = new Set(['relevance', 'year', 'citations']);
const PAGE_SCOPE = (() => {
  const raw = normalizeFilterValue(document.body && document.body.dataset ? document.body.dataset.contentScope : '');
  return raw === BLOG_FILTER_VALUE ? BLOG_FILTER_VALUE : PAPER_FILTER_VALUE;
})();
const PAGE_SCOPE_LABELS = PAGE_SCOPE === BLOG_FILTER_VALUE
  ? { singular: 'blog', plural: 'blogs', singularTitle: 'blog post', pluralTitle: 'blog posts' }
  : { singular: 'paper', plural: 'papers', singularTitle: 'paper', pluralTitle: 'papers' };

const state = {
  query: '',
  activeSpeaker: '',
  activeTags: new Set(),
  speaker: '', // exact author filter from author button click
  years: new Set(),
  contentTypes: new Set(),
  sortBy: 'relevance',
};

let scopedPapers = [];

// ============================================================
// Data Loading
// ============================================================

async function loadData() {
  if (typeof window.loadPaperData !== 'function') {
    return { papers: [] };
  }
  try {
    return await window.loadPaperData();
  } catch {
    return { papers: [] };
  }
}

// ============================================================
// Helpers
// ============================================================

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cleanMetadataValue(value) {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const lowered = cleaned.toLowerCase();
  if (['none', 'null', 'nan', 'n/a'].includes(lowered)) return '';
  return cleaned;
}

function isDirectPdfUrl(url) {
  return DIRECT_PDF_URL_RE.test(String(url || '').trim());
}

function normalizePublicationAndVenue(publication, venue) {
  let normalizedPublication = cleanMetadataValue(publication);
  const rawVenueParts = String(venue || '')
    .split('|')
    .map((part) => cleanMetadataValue(part))
    .filter(Boolean);

  let volume = '';
  let issue = '';
  const extras = [];

  for (const part of rawVenueParts) {
    const volumeMatch = part.match(/^Vol\.\s*(.+?)(?:\s*\(Issue\s*(.+?)\))?$/i);
    if (volumeMatch) {
      volume = cleanMetadataValue(volumeMatch[1] || '');
      issue = cleanMetadataValue(volumeMatch[2] || '');
      continue;
    }

    const issueMatch = part.match(/^Issue\s+(.+)$/i);
    if (issueMatch) {
      issue = cleanMetadataValue(issueMatch[1] || '');
      continue;
    }

    extras.push(part);
  }

  if (!normalizedPublication && extras.length > 0) {
    const first = extras[0];
    if (!/^Vol\./i.test(first) && !/^Issue\b/i.test(first)) {
      normalizedPublication = first;
    }
  }

  const normalizedVenueParts = [];
  if (normalizedPublication) normalizedVenueParts.push(normalizedPublication);
  for (const part of extras) {
    if (normalizedPublication && part.toLowerCase() === normalizedPublication.toLowerCase()) continue;
    if (!normalizedVenueParts.some((existing) => existing.toLowerCase() === part.toLowerCase())) {
      normalizedVenueParts.push(part);
    }
  }

  if (volume) {
    normalizedVenueParts.push(`Vol. ${volume}${issue ? ` (Issue ${issue})` : ''}`);
  } else if (issue) {
    normalizedVenueParts.push(`Issue ${issue}`);
  }

  return {
    publication: normalizedPublication,
    venue: normalizedVenueParts.join(' | '),
  };
}

function normalizeIsoDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (!match) return '';
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return '';
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function formatIsoDateLabel(value) {
  const iso = normalizeIsoDate(value);
  if (!iso) return '';
  const [year, month, day] = iso.split('-').map((piece) => Number.parseInt(piece, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return '';
  const stamp = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(stamp);
}

function normalizePaperRecord(rawPaper) {
  if (!rawPaper || typeof rawPaper !== 'object') return null;

  const paper = { ...rawPaper };
  paper.id = String(paper.id || '').trim();
  paper.title = String(paper.title || '').trim();
  paper.abstract = String(paper.abstract || '').trim();
  paper.year = String(paper.year || '').trim();
  paper.publishedDate = normalizeIsoDate(
    paper.publishedDate || paper.publishDate || paper.date || rawPaper.publishedDate || rawPaper.publishDate || rawPaper.date
  );
  const metadata = normalizePublicationAndVenue(paper.publication, paper.venue);
  paper.publication = metadata.publication;
  paper.venue = metadata.venue;
  paper.type = String(paper.type || '').trim();
  paper.source = String(paper.source || '').trim();
  paper.paperUrl = String(paper.paperUrl || '').trim();
  paper.sourceUrl = String(paper.sourceUrl || '').trim();
  paper.citationCount = parseCitationCount(rawPaper);

  paper.authors = Array.isArray(paper.authors)
    ? paper.authors
      .map((author) => {
        if (typeof HubUtils.normalizePersonRecord === 'function') {
          const normalized = HubUtils.normalizePersonRecord(author);
          if (!normalized || !normalized.name) return null;
          const affiliation = author && typeof author === 'object'
            ? String(author.affiliation || '').trim()
            : '';
          return { name: normalized.name, affiliation };
        }
        if (!author || typeof author !== 'object') return null;
        const name = String(author.name || '').trim();
        const affiliation = String(author.affiliation || '').trim();
        if (!name) return null;
        return { name, affiliation };
      })
      .filter(Boolean)
    : [];

  paper.tags = Array.isArray(paper.tags)
    ? paper.tags.map((tag) => String(tag || '').trim()).filter(Boolean)
    : [];
  paper.keywords = Array.isArray(paper.keywords)
    ? paper.keywords.map((keyword) => String(keyword || '').trim()).filter(Boolean)
    : [];
  if (!paper.keywords.length && paper.tags.length) {
    paper.keywords = [...paper.tags];
  }

  if (!paper.id || !paper.title) return null;

  paper._year = /^\d{4}$/.test(paper.year) ? paper.year : '';
  paper._publishedDate = paper.publishedDate;
  paper._publishedDateLabel = formatIsoDateLabel(paper._publishedDate);
  paper._citationCount = paper.citationCount;
  paper._titleLower = paper.title.toLowerCase();
  paper._authorLower = paper.authors.map((author) => `${author.name} ${author.affiliation || ''}`.trim()).join(' ').toLowerCase();
  paper._abstractLower = paper.abstract.toLowerCase();
  paper._tagsLower = paper.tags.join(' ').toLowerCase();
  paper._keywordsLower = paper.keywords.join(' ').toLowerCase();
  paper._publicationLower = paper.publication.toLowerCase();
  paper._venueLower = paper.venue.toLowerCase();
  paper._typeLower = paper.type.toLowerCase();
  paper._sourceLower = paper.source.toLowerCase();
  paper._isBlog = BLOG_SOURCE_SLUGS.has(paper._sourceLower)
    || paper._typeLower === 'blog-post'
    || paper._typeLower === 'blog'
    || /^https?:\/\/(?:www\.)?blog\.llvm\.org\//i.test(paper.sourceUrl)
    || /github\.com\/llvm\/(?:llvm-blog-www|llvm-www-blog)\b/i.test(paper.paperUrl);

  const uniqueTokens = (parts) => {
    const seen = new Set();
    const out = [];
    for (const part of parts) {
      const chunks = String(part || '')
        .toLowerCase()
        .split(/[^a-z0-9+#.]+/)
        .map((chunk) => chunk.trim())
        .filter((chunk) => chunk.length >= 2);
      for (const chunk of chunks) {
        if (!seen.has(chunk)) {
          seen.add(chunk);
          out.push(chunk);
        }
      }
    }
    return out;
  };

  paper._fuzzyTitle = uniqueTokens([paper.title]);
  paper._fuzzyAuthors = uniqueTokens(paper.authors.map((author) => author.name));
  paper._fuzzyTags = uniqueTokens(paper.tags);
  paper._fuzzyKeywords = uniqueTokens(paper.keywords);
  paper._fuzzyPublication = uniqueTokens([paper.publication]);
  paper._fuzzyVenue = uniqueTokens([paper.venue, paper.publication, paper.type, paper.year]);

  return paper;
}

function isBlogPaper(paper) {
  return !!(paper && paper._isBlog);
}

function matchesPageScope(paper) {
  if (PAGE_SCOPE === BLOG_FILTER_VALUE) return isBlogPaper(paper);
  return !isBlogPaper(paper);
}

function getPaperContentTypeValue(paper) {
  return isBlogPaper(paper) ? BLOG_FILTER_VALUE : PAPER_FILTER_VALUE;
}

function getContentTypeMeta(contentType) {
  const value = normalizeFilterValue(contentType);
  return value ? (CONTENT_TYPE_META[value] || null) : null;
}

function getContentTypeLabel(contentType) {
  const meta = getContentTypeMeta(contentType);
  return meta ? meta.label : '';
}

function parseCitationCount(rawPaper) {
  if (!rawPaper || typeof rawPaper !== 'object') return 0;

  const fields = [
    rawPaper.citationCount,
    rawPaper.citation_count,
    rawPaper.citedByCount,
    rawPaper.cited_by_count,
    rawPaper.citations,
  ];

  for (const value of fields) {
    if (value === null || value === undefined || value === '') continue;
    const parsed = Number.parseInt(String(value), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  return 0;
}

function buildSearchIndex() {
  searchIndex = scopedPapers.map((paper) => ({ ...paper }));
}

function tokenize(query) {
  if (typeof HubUtils.tokenizeQuery === 'function') {
    return HubUtils.tokenizeQuery(query);
  }

  const tokens = [];
  const re = /"([^"]+)"|(\S+)/g;
  let match;
  while ((match = re.exec(String(query || ''))) !== null) {
    const token = (match[1] || match[2] || '').toLowerCase().trim();
    if (token.length >= 2) tokens.push(token);
  }
  return tokens;
}

function scorePaperMatch(indexedPaper, tokens) {
  if (!tokens.length) return 0;

  let totalScore = 0;
  for (const token of tokens) {
    let tokenScore = 0;

    const title = String(indexedPaper._titleLower || '');
    const authors = String(indexedPaper._authorLower || '');
    const abstractText = String(indexedPaper._abstractLower || '');
    const tags = String(indexedPaper._tagsLower || '');
    const keywords = String(indexedPaper._keywordsLower || '');
    const publication = String(indexedPaper._publicationLower || '');
    const venue = String(indexedPaper._venueLower || '');
    const type = String(indexedPaper._typeLower || '');
    const year = String(indexedPaper._year || '');

    const titleIdx = title.indexOf(token);
    if (titleIdx !== -1) tokenScore += titleIdx === 0 ? 100 : 50;
    if (authors.includes(token)) tokenScore += 34;
    if (tags.includes(token)) tokenScore += 20;
    if (keywords.includes(token)) tokenScore += 16;
    if (abstractText.includes(token)) tokenScore += 12;
    if (publication.includes(token)) tokenScore += 10;
    if (venue.includes(token)) tokenScore += 8;
    if (type.includes(token)) tokenScore += 6;
    if (year.includes(token)) tokenScore += 6;

    if (tokenScore === 0) return 0; // AND semantics across tokens
    totalScore += tokenScore;
  }

  const year = parseInt(indexedPaper._year || '2002', 10);
  const safeYear = Number.isNaN(year) ? 2002 : year;
  totalScore += (safeYear - 2002) * 0.1;
  return totalScore;
}

function isSubsequence(needle, haystack) {
  let i = 0;
  let j = 0;
  while (i < needle.length && j < haystack.length) {
    if (needle[i] === haystack[j]) i += 1;
    j += 1;
  }
  return i === needle.length;
}

function boundedLevenshtein(a, b, maxDistance) {
  const lenA = a.length;
  const lenB = b.length;
  if (Math.abs(lenA - lenB) > maxDistance) return maxDistance + 1;

  let prev = new Array(lenB + 1);
  let curr = new Array(lenB + 1);
  for (let j = 0; j <= lenB; j += 1) prev[j] = j;

  for (let i = 1; i <= lenA; i += 1) {
    curr[0] = i;
    let minInRow = curr[0];

    for (let j = 1; j <= lenB; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
      if (curr[j] < minInRow) minInRow = curr[j];
    }

    if (minInRow > maxDistance) return maxDistance + 1;
    const swap = prev;
    prev = curr;
    curr = swap;
  }

  return prev[lenB];
}

function fuzzyTokenScore(token, words) {
  if (!token || !words || words.length === 0) return 0;
  let best = 0;

  for (const word of words) {
    if (!word) continue;
    if (word === token) return 20;
    if (word.startsWith(token)) best = Math.max(best, 16);
    else if (word.includes(token)) best = Math.max(best, 14);
    else if (token.length >= 3 && isSubsequence(token, word)) best = Math.max(best, 11);

    if (token.length >= 4) {
      const maxDist = token.length >= 7 ? 2 : 1;
      const dist = boundedLevenshtein(token, word, maxDist);
      if (dist <= maxDist) best = Math.max(best, dist === 1 ? 10 : 8);
    }
  }

  return best;
}

function fuzzyScorePaper(indexedPaper, tokens) {
  let total = 0;

  for (const token of tokens) {
    const titleScore = fuzzyTokenScore(token, indexedPaper._fuzzyTitle || []);
    const authorScore = fuzzyTokenScore(token, indexedPaper._fuzzyAuthors || []);
    const tagScore = fuzzyTokenScore(token, indexedPaper._fuzzyTags || []);
    const keywordScore = fuzzyTokenScore(token, indexedPaper._fuzzyKeywords || []);
    const publicationScore = fuzzyTokenScore(token, indexedPaper._fuzzyPublication || []);
    const venueScore = fuzzyTokenScore(token, indexedPaper._fuzzyVenue || []);

    const best = Math.max(
      titleScore ? titleScore + 3 : 0,
      authorScore ? authorScore + 2 : 0,
      tagScore ? tagScore + 2 : 0,
      keywordScore ? keywordScore + 2 : 0,
      publicationScore ? publicationScore + 1 : 0,
      venueScore,
    );

    if (best <= 0) return 0;
    total += best;
  }

  return total;
}

function comparePapersNewestFirst(a, b) {
  const yearA = Number.parseInt(String(a._year || ''), 10);
  const yearB = Number.parseInt(String(b._year || ''), 10);
  const yearDiff = (Number.isFinite(yearB) ? yearB : 0) - (Number.isFinite(yearA) ? yearA : 0);
  if (yearDiff !== 0) return yearDiff;
  const citationDiff = (b._citationCount || 0) - (a._citationCount || 0);
  if (citationDiff !== 0) return citationDiff;
  const titleDiff = String(a.title || '').localeCompare(String(b.title || ''));
  if (titleDiff !== 0) return titleDiff;
  return String(a.id || '').localeCompare(String(b.id || ''));
}

function normalizeFilterValue(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePersonKey(value) {
  if (typeof HubUtils.normalizePersonKey === 'function') {
    return HubUtils.normalizePersonKey(value);
  }
  return normalizeFilterValue(value);
}

function samePersonName(a, b) {
  const keyA = normalizePersonKey(a);
  const keyB = normalizePersonKey(b);
  if (!keyA || !keyB) return false;
  if (keyA === keyB) return true;
  if (typeof HubUtils.arePersonMiddleVariants === 'function') {
    return HubUtils.arePersonMiddleVariants(a, b);
  }
  return false;
}

function normalizeTopicKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function getPaperKeyTopics(paper, limit = Infinity) {
  if (typeof HubUtils.getPaperKeyTopics === 'function') {
    return HubUtils.getPaperKeyTopics(paper, limit);
  }

  const out = [];
  const seen = new Set();

  const add = (value) => {
    const label = String(value || '').trim();
    const key = normalizeTopicKey(label);
    if (!label || !key || seen.has(key)) return;
    seen.add(key);
    out.push(label);
  };

  for (const tag of (paper.tags || [])) add(tag);
  for (const keyword of (paper.keywords || [])) add(keyword);

  return Number.isFinite(limit) ? out.slice(0, limit) : out;
}

function filterAndSort() {
  const tokens = state.query.length >= 2 ? tokenize(state.query) : [];
  searchMode = tokens.length > 0 ? 'exact' : 'browse';
  let entries = searchIndex.map((paper) => ({ paper, score: 0 }));

  if (tokens.length > 0) {
    const scored = [];
    for (const paper of searchIndex) {
      const score = scorePaperMatch(paper, tokens);
      if (score > 0) scored.push({ paper, score });
    }

    entries = scored;

    if (entries.length === 0) {
      const fuzzy = [];
      for (const paper of searchIndex) {
        const score = fuzzyScorePaper(paper, tokens);
        if (score > 0) fuzzy.push({ paper, score });
      }

      entries = fuzzy;
      if (entries.length > 0) searchMode = 'fuzzy';
    }
  }

  if (state.speaker) {
    const selectedAuthor = state.speaker;
    entries = entries.filter(({ paper }) =>
      (paper.authors || []).some((author) => samePersonName(author.name, selectedAuthor))
    );
  }

  if (state.activeSpeaker) {
    const activeSpeaker = state.activeSpeaker;
    entries = entries.filter(({ paper }) =>
      (paper.authors || []).some((author) => samePersonName(author.name, activeSpeaker))
    );
  }

  if (state.activeTags.size > 0) {
    const activeTags = new Set([...state.activeTags].map((tag) => normalizeFilterValue(tag)));
    entries = entries.filter(({ paper }) =>
      getPaperKeyTopics(paper)
        .some((topic) => activeTags.has(normalizeFilterValue(topic)))
    );
  }

  if (state.years.size > 0) {
    entries = entries.filter(({ paper }) => state.years.has(paper._year));
  }

  if (state.contentTypes.size > 0) {
    entries = entries.filter(({ paper }) => state.contentTypes.has(getPaperContentTypeValue(paper)));
  }

  entries.sort((a, b) => {
    if (state.sortBy === 'year') {
      const yearDiff = comparePapersNewestFirst(a.paper, b.paper);
      if (yearDiff !== 0) return yearDiff;
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;
      return 0;
    }

    if (state.sortBy === 'citations') {
      const citationDiff = (b.paper._citationCount || 0) - (a.paper._citationCount || 0);
      if (citationDiff !== 0) return citationDiff;
      const yearDiff = comparePapersNewestFirst(a.paper, b.paper);
      if (yearDiff !== 0) return yearDiff;
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;
      return 0;
    }

    const scoreDiff = b.score - a.score;
    if (scoreDiff !== 0) return scoreDiff;
    return comparePapersNewestFirst(a.paper, b.paper);
  });

  if (!tokens.length && state.sortBy === 'relevance') {
    entries.sort((a, b) => comparePapersNewestFirst(a.paper, b.paper));
  }

  return entries.map((entry) => entry.paper);
}

function highlightText(text, tokens) {
  if (!tokens || tokens.length === 0) return escapeHtml(text);

  let result = escapeHtml(text);
  for (const token of tokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
  }
  return result;
}

function renderAuthorButtons(authors, tokens) {
  if (!authors || authors.length === 0) return 'Authors unknown';

  const activeAuthor = state.activeSpeaker || state.speaker || '';

  return authors.map((author) => {
    const label = String(author.name || '').trim();
    if (!label) return '';
    let labelHtml;

    if (activeAuthor && samePersonName(author.name, activeAuthor)) {
      labelHtml = `<mark>${escapeHtml(label)}</mark>`;
    } else {
      labelHtml = highlightText(label, tokens);
    }

    return `<button type="button" class="speaker-btn" data-speaker-filter="${escapeHtml(author.name)}" aria-label="View talks and papers by ${escapeHtml(author.name)}">${labelHtml}</button>`;
  }).filter(Boolean).join('<span class="speaker-btn-sep">, </span>');
}

function renderPaperCard(paper, tokens) {
  const blogEntry = isBlogPaper(paper);
  const badgeClass = blogEntry ? 'badge-blog' : 'badge-paper';
  const badgeLabel = blogEntry ? CONTENT_TYPE_META[BLOG_FILTER_VALUE].label : CONTENT_TYPE_META[PAPER_FILTER_VALUE].label;
  const titleEsc = escapeHtml(paper.title);
  const authorLabel = (paper.authors || []).map((author) => String(author.name || '').trim()).filter(Boolean).join(', ');
  const dateOrYearLabel = blogEntry
    ? escapeHtml(paper._publishedDateLabel || paper._year || 'Unknown date')
    : escapeHtml(paper._year || 'Unknown year');
  const venueLabel = escapeHtml(paper.publication || paper.venue || (paper.type ? paper.type.replace(/-/g, ' ') : 'Academic paper'));
  const abstractText = paper.abstract || 'No abstract available.';

  const paperIsPdf = isDirectPdfUrl(paper.paperUrl || '');
  const sourceIsPdf = isDirectPdfUrl(paper.sourceUrl || '');
  const sourceLink = !blogEntry && sourceIsPdf && !paperIsPdf && paper.sourceUrl && paper.sourceUrl !== paper.paperUrl
    ? `<a href="${escapeHtml(paper.sourceUrl)}" class="card-link-btn" target="_blank" rel="noopener noreferrer" aria-label="Open PDF for ${titleEsc} (opens in new tab)"><span aria-hidden="true">PDF</span></a>`
    : '';

  const paperActionLabel = isBlogPaper(paper) ? 'Post' : (paperIsPdf ? 'PDF' : 'Paper');
  const paperLink = paper.paperUrl
    ? `<a href="${escapeHtml(paper.paperUrl)}" class="card-link-btn card-link-btn--video" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHtml(paperActionLabel)} for ${titleEsc} (opens in new tab)"><span aria-hidden="true">${escapeHtml(paperActionLabel)}</span></a>`
    : '';

  const citationCount = Number.isFinite(paper._citationCount) ? paper._citationCount : 0;
  const citationHtml = citationCount > 0
    ? `<span class="paper-citation-count" aria-label="${citationCount.toLocaleString()} citations">${citationCount.toLocaleString()} citation${citationCount === 1 ? '' : 's'}</span>`
    : '';

  const keyTopics = getPaperKeyTopics(paper, 8);
  const tagsHtml = keyTopics.length
    ? `<div class="card-tags-wrap"><div class="card-tags" aria-label="Key Topics">${keyTopics.slice(0, 4).map((topic) =>
        `<button type="button" class="card-tag" data-tag="${escapeHtml(topic)}" data-tag-filter="${escapeHtml(topic)}" aria-label="Filter by key topic: ${escapeHtml(topic)}">${escapeHtml(topic)}</button>`
      ).join('')}${keyTopics.length > 4 ? `<span class="card-tag card-tag--more" aria-hidden="true">+${keyTopics.length - 4}</span>` : ''}</div></div>`
    : '';

  return `
    <article class="talk-card paper-card">
      <a href="paper.html?id=${escapeHtml(paper.id)}&from=${PAGE_SCOPE}" class="card-link-wrap" aria-label="${titleEsc}${authorLabel ? ` by ${escapeHtml(authorLabel)}` : ''}">
        <div class="card-body">
          <div class="card-meta">
            <span class="badge ${badgeClass}">${badgeLabel}</span>
            <span class="meeting-label">${dateOrYearLabel}</span>
            <span class="meeting-label">${venueLabel}</span>
          </div>
          <p class="card-title">${highlightText(paper.title, tokens)}</p>
          <p class="card-abstract">${highlightText(abstractText, tokens)}</p>
        </div>
      </a>
      <p class="card-speakers paper-authors">${renderAuthorButtons(paper.authors || [], tokens)}</p>
      ${tagsHtml}
      ${(paperLink || sourceLink || citationHtml) ? `<div class="card-footer">${paperLink}${sourceLink}${citationHtml}</div>` : ''}
    </article>`;
}

function teardownInfiniteLoader() {
  if (loadMoreObserver) {
    loadMoreObserver.disconnect();
    loadMoreObserver = null;
  }

  if (loadMoreScrollHandler) {
    window.removeEventListener('scroll', loadMoreScrollHandler);
    window.removeEventListener('resize', loadMoreScrollHandler);
    loadMoreScrollHandler = null;
  }

  const sentinel = document.getElementById('papers-load-sentinel');
  if (sentinel) sentinel.remove();
}

function ensureLoadMoreSentinel(grid) {
  let sentinel = document.getElementById('papers-load-sentinel');
  if (!sentinel) {
    sentinel = document.createElement('div');
    sentinel.id = 'papers-load-sentinel';
    sentinel.setAttribute('aria-hidden', 'true');
    sentinel.style.width = '100%';
    sentinel.style.height = '1px';
    sentinel.style.gridColumn = '1 / -1';
  }
  grid.appendChild(sentinel);
  return sentinel;
}

function appendNextResultsBatch(forceBatchSize = RENDER_BATCH_SIZE) {
  const grid = document.getElementById('papers-grid');
  if (!grid) return;

  if (!activeRenderResults.length || renderedCount >= activeRenderResults.length) {
    teardownInfiniteLoader();
    return;
  }

  const nextCount = Math.min(renderedCount + forceBatchSize, activeRenderResults.length);
  const nextHtml = activeRenderResults
    .slice(renderedCount, nextCount)
    .map((paper) => renderPaperCard(paper, activeRenderTokens))
    .join('');

  grid.insertAdjacentHTML('beforeend', nextHtml);
  renderedCount = nextCount;

  if (renderedCount >= activeRenderResults.length) {
    teardownInfiniteLoader();
    return;
  }

  ensureLoadMoreSentinel(grid);
}

function setupInfiniteLoader() {
  const grid = document.getElementById('papers-grid');
  if (!grid) return;

  teardownInfiniteLoader();
  if (renderedCount >= activeRenderResults.length) return;

  const sentinel = ensureLoadMoreSentinel(grid);

  if ('IntersectionObserver' in window) {
    loadMoreObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          appendNextResultsBatch();
          break;
        }
      }
    }, { root: null, rootMargin: LOAD_MORE_ROOT_MARGIN, threshold: 0 });

    loadMoreObserver.observe(sentinel);
    return;
  }

  loadMoreScrollHandler = () => {
    const activeSentinel = document.getElementById('papers-load-sentinel');
    if (!activeSentinel) return;
    const rect = activeSentinel.getBoundingClientRect();
    if (rect.top <= window.innerHeight + 900) {
      appendNextResultsBatch();
    }
  };

  window.addEventListener('scroll', loadMoreScrollHandler, { passive: true });
  window.addEventListener('resize', loadMoreScrollHandler);
  loadMoreScrollHandler();
}

function renderCards(results) {
  const grid = document.getElementById('papers-grid');
  if (!grid) return;

  grid.setAttribute('aria-busy', 'false');

  if (results.length === 0) {
    teardownInfiniteLoader();
    activeRenderResults = [];
    activeRenderTokens = [];
    renderedCount = 0;

    const query = state.query;
    const suggestions = autocompleteIndex.tags.slice(0, 6).map((tag) => tag.label);
    const recoveryActions = [];

    if (state.speaker) recoveryActions.push({ id: 'clear-author', label: 'Clear author' });
    if (state.years.size > 0) recoveryActions.push({ id: 'clear-year', label: 'Clear year' });
    if (state.contentTypes.size > 0) recoveryActions.push({ id: 'clear-content', label: 'Clear content type' });
    if (state.activeTags.size > 0) recoveryActions.push({ id: 'clear-topic', label: 'Clear key topic' });
    else if (state.query) recoveryActions.push({ id: 'clear-search', label: 'Clear search' });
    recoveryActions.push({ id: 'reset-all', label: 'Reset all' });

    grid.innerHTML = `
      <div class="empty-state" role="status">
        <div class="empty-state-icon" aria-hidden="true">PDF</div>
        <h2>No ${escapeHtml(PAGE_SCOPE_LABELS.plural)} found</h2>
        <p>${query ? `No ${escapeHtml(PAGE_SCOPE_LABELS.plural)} match "<strong>${escapeHtml(query)}</strong>".` : `No ${escapeHtml(PAGE_SCOPE_LABELS.plural)} match the current filters.`}</p>
        <div class="empty-state-actions" aria-label="Recovery actions">
          ${recoveryActions.map((action) => `<button class="empty-action-btn" data-empty-action="${escapeHtml(action.id)}">${escapeHtml(action.label)}</button>`).join('')}
        </div>
        ${suggestions.length
          ? `<div class="empty-state-suggestions" aria-label="Key Topic suggestions">${suggestions.map((topic) => `<button class="suggestion-chip" data-suggestion="${escapeHtml(topic)}">${escapeHtml(topic)}</button>`).join('')}</div>`
          : ''}
      </div>`;

    grid.querySelectorAll('.empty-action-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.emptyAction;
        if (action === 'clear-author') {
          removeSpeakerFilter();
          return;
        }
        if (action === 'clear-year') {
          state.years.clear();
          document.querySelectorAll('.filter-chip[data-type="year"]').forEach((chip) => {
            chip.classList.remove('active');
            chip.setAttribute('aria-checked', 'false');
          });
          updateClearBtn();
          syncUrl();
          render();
          return;
        }
        if (action === 'clear-content') {
          clearContentTypeFilters();
          return;
        }
        if (action === 'clear-topic' || action === 'clear-search') {
          if (action === 'clear-topic') {
            clearTagFilters();
          } else {
            clearQuery();
          }
          return;
        }
        if (action === 'reset-all') {
          clearFilters();
        }
      });
    });

    grid.querySelectorAll('.suggestion-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        applyAutocompleteSelection('tag', chip.dataset.suggestion || '', 'search');
      });
    });

    return;
  }

  const tokens = state.query.length >= 2 ? tokenize(state.query) : [];
  activeRenderResults = results;
  activeRenderTokens = tokens;
  renderedCount = 0;

  grid.innerHTML = '';
  appendNextResultsBatch(INITIAL_RENDER_BATCH_SIZE);
  setupInfiniteLoader();
}

function renderResultCount(count) {
  const el = document.getElementById('results-count');
  const contextEl = document.getElementById('results-context');
  if (!el) return;

  const total = scopedPapers.length;
  const queryCountsAsFilter = !!state.query && !hasTagFilter(state.query);
  const activeFilterCount =
    (queryCountsAsFilter ? 1 : 0) +
    (state.speaker ? 1 : 0) +
    state.activeTags.size +
    state.years.size +
    state.contentTypes.size;

  const noActiveFilters =
    !queryCountsAsFilter &&
    !state.speaker &&
    state.activeTags.size === 0 &&
    state.years.size === 0 &&
    state.contentTypes.size === 0;

  if (count === total && noActiveFilters) {
    el.innerHTML = `<strong>${total.toLocaleString()}</strong> ${escapeHtml(PAGE_SCOPE_LABELS.pluralTitle)}`;
  } else {
    el.innerHTML = `<strong>${count.toLocaleString()}</strong> of ${total.toLocaleString()} ${escapeHtml(PAGE_SCOPE_LABELS.pluralTitle)}`;
  }

  if (!contextEl) return;
  const parts = [];
  parts.push(activeFilterCount > 0
    ? `${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} active`
    : 'All results');
  if (state.sortBy === 'year') parts.push('Sorted by year');
  else if (state.sortBy === 'citations') parts.push('Sorted by citation count');
  else parts.push('Sorted by relevance');
  if (searchMode === 'fuzzy') parts.push('Fuzzy match');
  contextEl.textContent = `· ${parts.join(' · ')}`;
}

function updateHeroSubtitle(resultsCount) {
  const el = document.getElementById('papers-subtitle');
  if (!el) return;

  const total = scopedPapers.length;
  const singular = PAGE_SCOPE_LABELS.singularTitle;
  const plural = PAGE_SCOPE_LABELS.pluralTitle;

  if (state.speaker) {
    el.innerHTML = `Showing all ${escapeHtml(plural)} by <strong>${escapeHtml(state.speaker)}</strong>`;
    return;
  }

  if (state.activeTags.size === 1 && (!state.query || hasTagFilter(state.query))) {
    const onlyTag = [...state.activeTags][0];
    el.innerHTML = `Showing ${escapeHtml(plural)} for key topic <strong>${escapeHtml(onlyTag)}</strong>`;
    return;
  }

  if (state.activeTags.size > 1 && !state.query) {
    el.innerHTML = `Showing ${escapeHtml(plural)} across <strong>${state.activeTags.size.toLocaleString()}</strong> key topic filters`;
    return;
  }

  if (resultsCount === total) {
    el.innerHTML = `Browse <strong>${total.toLocaleString()}</strong> ${escapeHtml(plural)}`;
    return;
  }

  el.innerHTML = `Showing <strong>${resultsCount.toLocaleString()}</strong> of ${total.toLocaleString()} ${escapeHtml(resultsCount === 1 ? singular : plural)}`;
}

function showError(html) {
  const grid = document.getElementById('papers-grid');
  if (!grid) return;

  teardownInfiniteLoader();
  activeRenderResults = [];
  activeRenderTokens = [];
  renderedCount = 0;

  grid.setAttribute('aria-busy', 'false');
  grid.innerHTML = `
    <div class="empty-state" role="alert">
      <div class="empty-state-icon" aria-hidden="true">!</div>
      <h2>Could not load ${escapeHtml(PAGE_SCOPE_LABELS.plural)}</h2>
      <p>${html}</p>
    </div>`;
}

// ============================================================
// Active Filters Strip
// ============================================================

const _xIcon = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

function createActiveFilterPill(typeLabel, valueLabel, ariaLabel, onRemove, options = {}) {
  const pill = document.createElement('span');
  pill.className = 'active-filter-pill';

  const type = document.createElement('span');
  type.className = 'active-filter-pill__type';
  type.textContent = typeLabel;
  pill.appendChild(type);
  pill.appendChild(document.createTextNode(` ${valueLabel}`));

  const workHref = String(options.workHref || '').trim();
  if (workHref) {
    const workLink = document.createElement('a');
    workLink.className = 'active-filter-pill__work';
    workLink.href = workHref;
    workLink.textContent = options.workLabel || 'All Work';
    workLink.setAttribute('aria-label', options.workAriaLabel || `${typeLabel} ${valueLabel}: see all related work`);
    workLink.addEventListener('click', (event) => {
      event.stopPropagation();
    });
    pill.appendChild(workLink);
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'active-filter-pill__remove';
  button.setAttribute('aria-label', ariaLabel);
  button.innerHTML = _xIcon;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onRemove();
  });
  pill.appendChild(button);

  return pill;
}

function renderActiveFilters() {
  const el = document.getElementById('active-filters');
  if (!el) return;

  const pills = [];

  if (state.speaker) {
    pills.push(createActiveFilterPill(
      'Author',
      state.speaker,
      `Remove author filter: ${state.speaker}`,
      removeSpeakerFilter,
      {
        workHref: buildAllWorkUrl('speaker', state.speaker),
        workAriaLabel: `See all work for author ${state.speaker}`,
      }
    ));
  }

  const queryMatchesTopicFilter = hasTagFilter(state.query);

  if (state.query && !queryMatchesTopicFilter) {
    let typeLabel = 'Search';
    let workHref = '';
    let workAriaLabel = '';
    if (state.activeSpeaker && normalizeFilterValue(state.activeSpeaker) === normalizeFilterValue(state.query)) {
      typeLabel = 'Author';
      workHref = buildAllWorkUrl('speaker', state.query);
      workAriaLabel = `See all work for author ${state.query}`;
    }

    pills.push(createActiveFilterPill(
      typeLabel,
      state.query,
      `Remove ${typeLabel} filter: ${state.query}`,
      clearQuery,
      {
        workHref,
        workAriaLabel,
      }
    ));
  }

  const sortedTags = [...state.activeTags].sort((a, b) => a.localeCompare(b));
  for (const tag of sortedTags) {
    pills.push(createActiveFilterPill(
      'Key Topic',
      tag,
      `Remove key topic filter: ${tag}`,
      () => removeTagFilter(tag),
      {
        workHref: buildAllWorkUrl('topic', tag),
        workAriaLabel: `See all work for key topic ${tag}`,
      }
    ));
  }

  for (const year of [...state.years].sort().reverse()) {
    pills.push(createActiveFilterPill(
      'Year',
      year,
      `Remove year filter: ${year}`,
      () => removeYearFilter(year)
    ));
  }

  const activeContentTypes = [...state.contentTypes]
    .filter((contentType) => !!getContentTypeMeta(contentType))
    .sort((a, b) => {
      const aIndex = CONTENT_TYPE_ORDER.indexOf(a);
      const bIndex = CONTENT_TYPE_ORDER.indexOf(b);
      if (aIndex !== bIndex) return aIndex - bIndex;
      return a.localeCompare(b);
    });

  for (const contentType of activeContentTypes) {
    const label = getContentTypeLabel(contentType);
    if (!label) continue;
    pills.push(createActiveFilterPill(
      'Type',
      label,
      `Remove content type filter: ${label}`,
      () => removeContentTypeFilter(contentType)
    ));
  }

  if (pills.length > 0) {
    el.innerHTML = '';
    for (const pill of pills) el.appendChild(pill);
    el.classList.remove('hidden');
  } else {
    el.innerHTML = '';
    el.classList.add('hidden');
  }
}

function resolveCanonicalTag(value) {
  const normalized = normalizeFilterValue(value);
  if (!normalized) return '';

  const matched = autocompleteIndex.tags.find((tag) => normalizeFilterValue(tag.label) === normalized);
  return matched ? matched.label : '';
}

function hasTagFilter(value) {
  const normalized = normalizeFilterValue(value);
  if (!normalized) return false;
  for (const tag of state.activeTags) {
    if (normalizeFilterValue(tag) === normalized) return true;
  }
  return false;
}

function syncTopicChipState() {
  document.querySelectorAll('.filter-chip[data-type="tag"]').forEach((chip) => {
    const isActive = hasTagFilter(chip.dataset.value);
    chip.classList.toggle('active', isActive);
    chip.setAttribute('aria-checked', isActive ? 'true' : 'false');
  });
}

function addTagFilter(tag) {
  const canonical = resolveCanonicalTag(tag) || String(tag || '').trim();
  if (!canonical || hasTagFilter(canonical)) return canonical;
  state.activeTags.add(canonical);
  return canonical;
}

function removeTagFilter(tag, { skipRender = false } = {}) {
  const target = normalizeFilterValue(tag);
  if (!target) return;

  for (const currentTag of [...state.activeTags]) {
    if (normalizeFilterValue(currentTag) === target) {
      state.activeTags.delete(currentTag);
    }
  }

  if (state.query && normalizeFilterValue(state.query) === target) {
    state.query = '';
    const input = document.getElementById('search-input');
    if (input) input.value = '';
  }

  syncTopicChipState();
  updateClearBtn();
  syncUrl();
  if (!skipRender) render();
}

function clearTagFilters({ skipRender = false } = {}) {
  const shouldClearQuery = hasTagFilter(state.query);
  state.activeTags.clear();
  if (shouldClearQuery) {
    state.query = '';
    const input = document.getElementById('search-input');
    if (input) input.value = '';
  }
  syncTopicChipState();
  updateClearBtn();
  syncUrl();
  if (!skipRender) render();
}

function toggleTagFilter(tag) {
  if (hasTagFilter(tag)) {
    removeTagFilter(tag);
    return;
  }
  addTagFilter(tag);
  syncTopicChipState();
  updateClearBtn();
  syncUrl();
  render();
}

function applyTopicSearchFilter(tag, source = 'search') {
  if (source === 'sidebar') {
    toggleTagFilter(tag);
    return;
  }

  const input = document.getElementById('search-input');
  const canonical = addTagFilter(tag) || String(tag || '').trim();
  if (!canonical) return;

  state.speaker = '';
  state.activeSpeaker = '';
  state.query = canonical;

  if (input) input.value = state.query;
  syncTopicChipState();

  closeDropdown();
  updateClearBtn();
  syncUrl();
  render();
}

function applyAutocompleteSelection(type, value, source = 'search') {
  const input = document.getElementById('search-input');
  let effectiveType = String(type || '').trim();

  if (effectiveType === 'person') {
    effectiveType = 'speaker';
  } else if (effectiveType === 'topic') {
    effectiveType = 'tag';
  } else if (effectiveType === 'talk') {
    effectiveType = 'generic';
  } else if (effectiveType === 'paper') {
    effectiveType = 'generic';
  } else if (effectiveType === 'global') {
    effectiveType = 'global';
  }

  if (effectiveType === 'global') {
    closeDropdown();
    routeToGlobalSearch(value);
    return 'global';
  }

  if (effectiveType === 'tag') {
    applyTopicSearchFilter(value, source);
    return 'local';
  }

  state.speaker = '';

  if (effectiveType === 'speaker') {
    state.activeSpeaker = value;
    state.query = value;
  } else {
    state.activeSpeaker = '';
    state.query = value;
  }

  if (input) input.value = state.query;
  closeDropdown();
  updateClearBtn();
  syncUrl();
  render();
  return 'local';
}

function removeSpeakerFilter() {
  const removedSpeaker = state.speaker;
  state.speaker = '';

  if (removedSpeaker && state.query && normalizeFilterValue(state.query) === normalizeFilterValue(removedSpeaker)) {
    state.query = '';
    state.activeSpeaker = '';
    const input = document.getElementById('search-input');
    if (input) input.value = '';
    closeDropdown();
  }

  updateClearBtn();
  syncUrl();
  render();
}

function removeYearFilter(year) {
  const target = normalizeFilterValue(year);

  for (const currentYear of [...state.years]) {
    if (normalizeFilterValue(currentYear) === target) {
      state.years.delete(currentYear);
    }
  }

  document.querySelectorAll('.filter-chip[data-type="year"]').forEach((chip) => {
    if (normalizeFilterValue(chip.dataset.value) === target) {
      chip.classList.remove('active');
      chip.setAttribute('aria-checked', 'false');
    }
  });

  updateClearBtn();
  syncUrl();
  render();
}

function clearQuery() {
  const input = document.getElementById('search-input');
  if (input) input.value = '';

  state.query = '';
  state.activeSpeaker = '';
  closeDropdown();
  updateClearBtn();
  syncUrl();
  render();
}

function clearFilters() {
  state.query = '';
  state.activeSpeaker = '';
  state.activeTags.clear();
  state.speaker = '';
  state.years.clear();
  state.contentTypes.clear();

  const input = document.getElementById('search-input');
  if (input) input.value = '';

  document.querySelectorAll('.filter-chip.active').forEach((chip) => {
    chip.classList.remove('active');
    chip.setAttribute('aria-checked', 'false');
  });

  closeDropdown();
  updateClearBtn();
  syncUrl();
  render();
}

function syncContentTypeChipState() {
  document.querySelectorAll('.filter-chip[data-type="content-type"]').forEach((chip) => {
    const value = normalizeFilterValue(chip.dataset.value);
    const isActive = state.contentTypes.has(value);
    chip.classList.toggle('active', isActive);
    chip.setAttribute('aria-checked', isActive ? 'true' : 'false');
  });
}

function addContentTypeFilter(contentType) {
  const value = normalizeFilterValue(contentType);
  if (!value) return '';
  if (!CONTENT_TYPE_META[value]) return '';
  if (!state.contentTypes.has(value)) state.contentTypes.add(value);
  return value;
}

function removeContentTypeFilter(contentType, { skipRender = false } = {}) {
  const value = normalizeFilterValue(contentType);
  if (!value) return;
  state.contentTypes.delete(value);
  syncContentTypeChipState();
  updateClearBtn();
  syncUrl();
  if (!skipRender) render();
}

function clearContentTypeFilters({ skipRender = false } = {}) {
  state.contentTypes.clear();
  syncContentTypeChipState();
  updateClearBtn();
  syncUrl();
  if (!skipRender) render();
}

function toggleContentTypeFilter(contentType) {
  const value = normalizeFilterValue(contentType);
  if (!value) return;
  if (state.contentTypes.has(value)) removeContentTypeFilter(value);
  else {
    addContentTypeFilter(value);
    syncContentTypeChipState();
    updateClearBtn();
    syncUrl();
    render();
  }
}

// ============================================================
// Filters
// ============================================================

function syncYearChipsFromState() {
  document.querySelectorAll('.filter-chip[data-type="year"]').forEach((chip) => {
    const isActive = state.years.has(chip.dataset.value);
    chip.classList.toggle('active', isActive);
    chip.setAttribute('aria-checked', isActive ? 'true' : 'false');
  });
}

function initFilters() {
  const tagCounts = {};
  const yearCounts = {};
  const contentTypeCounts = new Map([
    [PAPER_FILTER_VALUE, 0],
    [BLOG_FILTER_VALUE, 0],
  ]);

  for (const paper of scopedPapers) {
    for (const topic of getPaperKeyTopics(paper, 8)) {
      if (String(topic || '').length > 48) continue;
      tagCounts[topic] = (tagCounts[topic] || 0) + 1;
    }

    if (paper._year) {
      yearCounts[paper._year] = (yearCounts[paper._year] || 0) + 1;
    }

    const contentType = getPaperContentTypeValue(paper);
    contentTypeCounts.set(contentType, (contentTypeCounts.get(contentType) || 0) + 1);

  }

  const tags = Object.entries(tagCounts)
    .filter(([, count]) => count >= MIN_TOPIC_FILTER_COUNT)
    .sort((a, b) => a[0].localeCompare(b[0]));
  const visibleTags = tags.slice(0, MAX_TOPIC_FILTERS);

  const tagContainer = document.getElementById('filter-tags');
  if (tagContainer) {
    tagContainer.innerHTML = visibleTags.map(([tag, count]) => `
      <button class="filter-chip filter-chip--tag" data-type="tag" data-value="${escapeHtml(tag)}"
              role="switch" aria-checked="false">
        ${escapeHtml(tag)}
        <span class="filter-chip-count">${count.toLocaleString()}</span>
      </button>`).join('');
  }

  const years = Object.entries(yearCounts)
    .sort((a, b) => b[0].localeCompare(a[0]));

  const yearContainer = document.getElementById('filter-years');
  if (yearContainer) {
    yearContainer.innerHTML = years.map(([year, count]) => `
      <button class="filter-chip" data-type="year" data-value="${escapeHtml(year)}"
              role="switch" aria-checked="false">
        ${escapeHtml(year)}
        <span class="filter-chip-count">${count.toLocaleString()}</span>
      </button>`).join('');
  }

  const contentTypeContainer = document.getElementById('filter-content-types');
  if (contentTypeContainer) {
    contentTypeContainer.innerHTML = CONTENT_TYPE_ORDER
      .map((contentType) => {
        const meta = CONTENT_TYPE_META[contentType];
        const count = contentTypeCounts.get(contentType) || 0;
        if (!meta || count <= 0) return '';
        return `
      <button class="filter-chip filter-chip--type" data-type="content-type" data-value="${escapeHtml(contentType)}"
              role="switch" aria-checked="false">
        <span class="badge filter-chip-type-label ${escapeHtml(meta.badgeClass)}">${escapeHtml(meta.label)}</span>
        <span class="filter-chip-count filter-chip-type-count">${count.toLocaleString()}</span>
      </button>`;
      })
      .join('');
  }

  document.querySelectorAll('.filter-chip[data-type]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const type = chip.dataset.type;
      const value = chip.dataset.value;

      if (type === 'year') {
        if (state.years.has(value)) {
          state.years.delete(value);
          chip.classList.remove('active');
          chip.setAttribute('aria-checked', 'false');
        } else {
          state.years.add(value);
          chip.classList.add('active');
          chip.setAttribute('aria-checked', 'true');
        }

        updateClearBtn();
        syncUrl();
        render();
        return;
      }

      if (type === 'tag') {
        applyAutocompleteSelection('tag', value, 'sidebar');
        return;
      }

      if (type === 'content-type') {
        toggleContentTypeFilter(value);
      }
    });
  });

  const clearBtn = document.getElementById('clear-filters');
  if (clearBtn) clearBtn.addEventListener('click', clearFilters);
}

function setFilterAccordionOpen(name, open) {
  const section = document.querySelector(`.filter-accordion[data-accordion="${CSS.escape(name)}"]`);
  if (!section) return;

  const toggle = section.querySelector('.filter-accordion-toggle');
  const panel = section.querySelector('.filter-accordion-panel');
  if (!toggle || !panel) return;

  section.classList.toggle('is-collapsed', !open);
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  panel.hidden = !open;
}

function initFilterAccordions() {
  const sections = document.querySelectorAll('.filter-accordion[data-accordion]');
  if (!sections.length) return;

  sections.forEach((section) => {
    const name = section.dataset.accordion;
    const toggle = section.querySelector('.filter-accordion-toggle');
    if (!name || !toggle) return;

    setFilterAccordionOpen(name, true);

    toggle.addEventListener('click', () => {
      const currentlyOpen = toggle.getAttribute('aria-expanded') === 'true';
      setFilterAccordionOpen(name, !currentlyOpen);
    });
  });
}

function setFilterSidebarCollapsed(collapsed, persist = true) {
  const collapseBtn = document.getElementById('filter-collapse-btn');
  if (!collapseBtn) return;

  document.body.classList.toggle('filter-collapsed', collapsed);
  collapseBtn.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
  collapseBtn.setAttribute('aria-label', collapsed ? 'Expand filters' : 'Collapse filters');
  collapseBtn.setAttribute('title', collapsed ? 'Expand filters' : 'Collapse filters');

  if (persist) {
    sessionStorage.setItem('llvm-hub-filter-sidebar-collapsed', collapsed ? '1' : '0');
  }
}

function initFilterSidebarCollapse() {
  const collapseBtn = document.getElementById('filter-collapse-btn');
  const filterSection = document.querySelector('.filter-section');
  const mobileOpenBtn = document.getElementById('mobile-filter-open');
  const mobileCloseBtn = document.getElementById('mobile-filter-close');
  const mobileApplyBtn = document.getElementById('mobile-filter-apply');
  const mobileClearBtn = document.getElementById('mobile-filter-clear');
  const mobileScrim = document.getElementById('mobile-filter-scrim');
  if (!collapseBtn) return;

  const mobileMq = window.matchMedia('(max-width: 1180px)');

  const setMobileDrawerOpen = (open) => {
    const isMobile = mobileMq.matches;
    const active = isMobile && open;

    document.body.classList.toggle('mobile-filters-open', active);
    if (mobileOpenBtn) mobileOpenBtn.setAttribute('aria-expanded', active ? 'true' : 'false');

    if (mobileScrim) {
      mobileScrim.classList.toggle('hidden', !active);
      mobileScrim.setAttribute('aria-hidden', active ? 'false' : 'true');
    }

    if (filterSection) {
      if (isMobile) {
        filterSection.hidden = !active;
        if (active) {
          filterSection.removeAttribute('inert');
        } else {
          filterSection.setAttribute('inert', '');
        }
      } else {
        filterSection.hidden = false;
        filterSection.removeAttribute('inert');
      }
    }
  };

  const syncSidebarMode = () => {
    if (mobileMq.matches) {
      document.body.classList.remove('filter-collapsed');
      collapseBtn.setAttribute('aria-pressed', 'false');
      collapseBtn.setAttribute('aria-label', 'Collapse filters');
      collapseBtn.setAttribute('title', 'Collapse filters');
      setMobileDrawerOpen(false);
      return;
    }

    sessionStorage.removeItem('llvm-hub-filter-sidebar-collapsed');
    setFilterSidebarCollapsed(false, false);
    setMobileDrawerOpen(false);
  };

  syncSidebarMode();

  if (typeof mobileMq.addEventListener === 'function') {
    mobileMq.addEventListener('change', syncSidebarMode);
  } else if (typeof mobileMq.addListener === 'function') {
    mobileMq.addListener(syncSidebarMode);
  }

  collapseBtn.addEventListener('click', () => {
    if (mobileMq.matches) return;
    const next = !document.body.classList.contains('filter-collapsed');
    setFilterSidebarCollapsed(next, true);
  });

  if (mobileOpenBtn) {
    mobileOpenBtn.addEventListener('click', () => {
      if (!mobileMq.matches) return;
      setMobileDrawerOpen(true);
    });
  }

  if (mobileCloseBtn) {
    mobileCloseBtn.addEventListener('click', () => {
      setMobileDrawerOpen(false);
      if (mobileOpenBtn) mobileOpenBtn.focus();
    });
  }

  if (mobileScrim) {
    mobileScrim.addEventListener('click', () => {
      setMobileDrawerOpen(false);
      if (mobileOpenBtn) mobileOpenBtn.focus();
    });
  }

  if (mobileApplyBtn) {
    mobileApplyBtn.addEventListener('click', () => {
      setMobileDrawerOpen(false);
      if (mobileOpenBtn) mobileOpenBtn.focus();
    });
  }

  if (mobileClearBtn) {
    mobileClearBtn.addEventListener('click', () => {
      clearFilters();
      setMobileDrawerOpen(false);
      if (mobileOpenBtn) mobileOpenBtn.focus();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('mobile-filters-open')) {
      setMobileDrawerOpen(false);
      if (mobileOpenBtn) mobileOpenBtn.focus();
    }
  });
}

// ============================================================
// URL State Sync
// ============================================================

function syncUrl() {
  const params = new URLSearchParams();
  if (state.speaker) params.set('speaker', state.speaker);
  if (state.query) params.set('q', state.query);
  if (state.activeTags.size) params.set('tag', [...state.activeTags].sort((a, b) => a.localeCompare(b)).join(','));
  if (state.years.size) params.set('year', [...state.years].join(','));
  if (state.contentTypes.size) params.set('content', [...state.contentTypes].sort((a, b) => a.localeCompare(b)).join(','));
  if (state.sortBy !== 'relevance') params.set('sort', state.sortBy);

  const newUrl = params.toString()
    ? `${window.location.pathname}?${params.toString()}`
    : window.location.pathname;
  history.replaceState(null, '', newUrl);
}

function loadStateFromUrl() {
  const params = new URLSearchParams(window.location.search);

  state.query = String(params.get('q') || '').trim();
  state.speaker = String(params.get('speaker') || '').trim();
  const sortParam = String(params.get('sort') || '').trim();
  state.sortBy = PAPER_SORT_MODES.has(sortParam) ? sortParam : 'relevance';
  state.activeTags.clear();
  state.years.clear();
  state.contentTypes.clear();

  const yearParam = String(params.get('year') || '').trim();
  if (yearParam) {
    yearParam.split(',').map((part) => part.trim()).filter(Boolean).forEach((year) => state.years.add(year));
  }

  const requestedContentType = normalizeFilterValue(String(params.get('content') || '').split(',')[0] || '');
  const legacySourceParam = normalizeFilterValue(params.get('source'));
  const requestedScope = (requestedContentType === BLOG_FILTER_VALUE || BLOG_SOURCE_SLUGS.has(legacySourceParam) || legacySourceParam === BLOG_FILTER_VALUE)
    ? BLOG_FILTER_VALUE
    : (requestedContentType === PAPER_FILTER_VALUE ? PAPER_FILTER_VALUE : '');
  if (requestedScope && requestedScope !== PAGE_SCOPE) {
    const redirectParams = new URLSearchParams(window.location.search);
    redirectParams.delete('content');
    redirectParams.delete('source');
    const redirectPath = requestedScope === BLOG_FILTER_VALUE ? BLOGS_PAGE_PATH : PAPERS_PAGE_PATH;
    const redirectUrl = redirectParams.toString() ? `${redirectPath}?${redirectParams.toString()}` : redirectPath;
    window.location.replace(redirectUrl);
    return;
  }

  if (!state.query) {
    const legacyPublication = String(params.get('publication') || params.get('venue') || '').trim();
    if (legacyPublication) state.query = legacyPublication;
  }

  const tagParam = String(params.get('tag') || '').trim();
  if (tagParam) {
    tagParam.split(',').map((part) => part.trim()).filter(Boolean).forEach((tag) => addTagFilter(tag));
  }

  state.activeSpeaker = '';

  const input = document.getElementById('search-input');
  if (input) input.value = state.query;
}

function applyUrlFilters() {
  syncYearChipsFromState();
  syncTopicChipState();
  syncContentTypeChipState();
  syncSortControl();
  updateClearBtn();
}

// ============================================================
// Search Autocomplete
// ============================================================

function addCountToMap(map, label) {
  const value = String(label || '').trim();
  if (!value) return;
  map.set(value, (map.get(value) || 0) + 1);
}

function mapToSortedEntries(map) {
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function mapToAlphaEntries(map) {
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function ensurePersonBucket(buckets, name) {
  const label = String(name || '').trim();
  const key = normalizePersonKey(label);
  if (!label || !key) return null;
  if (!buckets.has(key)) {
    buckets.set(key, {
      talkCount: 0,
      paperCount: 0,
      labels: new Map(),
    });
  }
  return buckets.get(key);
}

function buildPeopleEntriesFromBuckets(buckets) {
  return [...buckets.values()]
    .map((bucket) => {
      const label = [...bucket.labels.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || '';
      const talkCount = bucket.talkCount || 0;
      const paperCount = bucket.paperCount || 0;
      return {
        label,
        talkCount,
        paperCount,
        count: talkCount + paperCount,
      };
    })
    .filter((entry) => entry.label)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function buildTopicEntries(talkCounts, paperCounts) {
  const labels = new Set([...talkCounts.keys(), ...paperCounts.keys()]);
  return [...labels]
    .map((label) => {
      const talkCount = talkCounts.get(label) || 0;
      const paperCount = paperCounts.get(label) || 0;
      return {
        label,
        talkCount,
        paperCount,
        count: talkCount + paperCount,
      };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function normalizeTalks(rawTalks) {
  if (typeof HubUtils.normalizeTalks === 'function') {
    return HubUtils.normalizeTalks(rawTalks);
  }
  return Array.isArray(rawTalks) ? rawTalks : [];
}

function getTalkKeyTopics(talk, limit = Infinity) {
  if (typeof HubUtils.getTalkKeyTopics === 'function') {
    return HubUtils.getTalkKeyTopics(talk, limit);
  }
  const tags = Array.isArray(talk && talk.tags) ? talk.tags : [];
  return Number.isFinite(limit) ? tags.slice(0, limit) : tags;
}

function buildTalkSearchEntry(talk) {
  if (!talk || typeof talk !== 'object') return null;
  const title = String(talk.title || '').trim();
  if (!title) return null;

  const keyTopics = getTalkKeyTopics(talk, 12);
  const speakers = Array.isArray(talk.speakers)
    ? talk.speakers.map((speaker) => String((speaker && speaker.name) || '').trim()).filter(Boolean)
    : [];
  const abstractText = String(talk.abstract || '').trim();
  const meetingText = [
    String(talk.meetingName || '').trim(),
    String(talk.meetingLocation || '').trim(),
    String(talk.meetingDate || '').trim(),
    String(talk.meeting || '').trim(),
  ].filter(Boolean).join(' ');

  const uniqueTokens = (parts) => {
    const seen = new Set();
    const out = [];
    for (const part of parts) {
      const chunks = String(part || '')
        .toLowerCase()
        .split(/[^a-z0-9+#.]+/)
        .map((chunk) => chunk.trim())
        .filter((chunk) => chunk.length >= 2);
      for (const chunk of chunks) {
        if (!seen.has(chunk)) {
          seen.add(chunk);
          out.push(chunk);
        }
      }
    }
    return out;
  };

  return {
    _titleLower: title.toLowerCase(),
    _speakerLower: speakers.join(' ').toLowerCase(),
    _abstractLower: abstractText.toLowerCase(),
    _tagsLower: keyTopics.join(' ').toLowerCase(),
    _meetingLower: meetingText.toLowerCase(),
    _year: String(talk.meeting || '').slice(0, 4),
    _fuzzyTitle: uniqueTokens([title]),
    _fuzzySpeakers: uniqueTokens(speakers),
    _fuzzyTags: uniqueTokens(keyTopics),
    _fuzzyMeeting: uniqueTokens([meetingText]),
  };
}

function scoreTalkSearchMatch(indexedTalk, tokens) {
  if (typeof HubUtils.scoreMatch === 'function') {
    return HubUtils.scoreMatch(indexedTalk, tokens);
  }

  let total = 0;
  for (const token of tokens) {
    let tokenScore = 0;
    const titleIdx = indexedTalk._titleLower.indexOf(token);
    if (titleIdx !== -1) tokenScore += titleIdx === 0 ? 100 : 50;
    if (indexedTalk._speakerLower.includes(token)) tokenScore += 30;
    if (indexedTalk._tagsLower.includes(token)) tokenScore += 15;
    if (indexedTalk._abstractLower.includes(token)) tokenScore += 10;
    if (indexedTalk._meetingLower.includes(token)) tokenScore += 5;
    if (tokenScore === 0) return 0;
    total += tokenScore;
  }
  return total;
}

function fuzzyScoreTalkMatch(indexedTalk, tokens) {
  let total = 0;
  for (const token of tokens) {
    const titleScore = fuzzyTokenScore(token, indexedTalk._fuzzyTitle || []);
    const speakerScore = fuzzyTokenScore(token, indexedTalk._fuzzySpeakers || []);
    const tagScore = fuzzyTokenScore(token, indexedTalk._fuzzyTags || []);
    const meetingScore = fuzzyTokenScore(token, indexedTalk._fuzzyMeeting || []);
    const best = Math.max(
      titleScore ? titleScore + 3 : 0,
      speakerScore ? speakerScore + 2 : 0,
      tagScore ? tagScore + 2 : 0,
      meetingScore,
    );
    if (best <= 0) return 0;
    total += best;
  }
  return total;
}

function countTalkMatchesForQuery(query) {
  if (!talkSearchIndex.length) return 0;
  const tokens = tokenize(query);
  if (!tokens.length) return 0;

  let exactCount = 0;
  for (const talk of talkSearchIndex) {
    if (scoreTalkSearchMatch(talk, tokens) > 0) exactCount += 1;
  }
  if (exactCount > 0) return exactCount;

  let fuzzyCount = 0;
  for (const talk of talkSearchIndex) {
    if (fuzzyScoreTalkMatch(talk, tokens) > 0) fuzzyCount += 1;
  }
  return fuzzyCount;
}

function countPaperMatchesForQuery(query) {
  const tokens = tokenize(query);
  if (!tokens.length) return 0;

  let exactCount = 0;
  for (const paper of searchIndex) {
    if (scorePaperMatch(paper, tokens) > 0) exactCount += 1;
  }
  if (exactCount > 0) return exactCount;

  let fuzzyCount = 0;
  for (const paper of searchIndex) {
    if (fuzzyScorePaper(paper, tokens) > 0) fuzzyCount += 1;
  }
  return fuzzyCount;
}

function ensureScript(src) {
  return new Promise((resolve, reject) => {
    const existing = [...document.querySelectorAll('script[src]')].find((script) => {
      const scriptSrc = script.getAttribute('src') || '';
      return scriptSrc === src || scriptSrc.startsWith(`${src}?`);
    });

    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => {
        existing.dataset.loaded = 'true';
        resolve();
      }, { once: true });
      existing.addEventListener('error', () => reject(new Error(`Could not load ${src}`)), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    }, { once: true });
    script.addEventListener('error', () => reject(new Error(`Could not load ${src}`)), { once: true });
    document.body.appendChild(script);
  });
}

async function ensureEventDataLoader() {
  if (typeof window.loadEventData === 'function') return true;
  try {
    await ensureScript('js/events-data.js');
  } catch {
    return false;
  }
  return typeof window.loadEventData === 'function';
}

function buildPaperAutocompleteBase() {
  const paperTopicCounts = new Map();
  const peopleBuckets = new Map();
  const paperTitleCounts = new Map();

  for (const paper of scopedPapers) {
    for (const topic of getPaperKeyTopics(paper, 12)) addCountToMap(paperTopicCounts, topic);
    addCountToMap(paperTitleCounts, paper.title);

    const seenAuthors = new Set();
    for (const author of (paper.authors || [])) {
      const name = String(author.name || '').trim();
      const key = normalizePersonKey(name);
      if (!name || !key || seenAuthors.has(key)) continue;
      seenAuthors.add(key);
      const bucket = ensurePersonBucket(peopleBuckets, name);
      if (!bucket) continue;
      bucket.paperCount += 1;
      bucket.labels.set(name, (bucket.labels.get(name) || 0) + 1);
    }
  }

  const people = buildPeopleEntriesFromBuckets(peopleBuckets);

  autocompleteIndex.tags = mapToSortedEntries(paperTopicCounts);
  autocompleteIndex.speakers = people
    .filter((entry) => entry.paperCount > 0)
    .map((entry) => ({ label: entry.label, count: entry.paperCount }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  autocompleteIndex.topics = buildTopicEntries(new Map(), paperTopicCounts);
  autocompleteIndex.people = people;
  autocompleteIndex.talks = [];
  autocompleteIndex.papers = mapToAlphaEntries(paperTitleCounts);
  talkSearchIndex = [];
}

async function hydrateUniversalAutocomplete() {
  if (universalAutocompletePromise) return universalAutocompletePromise;

  universalAutocompletePromise = (async () => {
    const hasLoader = await ensureEventDataLoader();
    if (!hasLoader || typeof window.loadEventData !== 'function') return;

    let talks = [];
    try {
      const payload = await window.loadEventData();
      talks = normalizeTalks(payload && payload.talks);
    } catch {
      return;
    }

    const talkTopicCounts = new Map();
    const paperTopicCounts = new Map();
    const peopleBuckets = new Map();
    const talkTitleCounts = new Map();
    const paperTitleCounts = new Map();
    const nextTalkSearchIndex = [];

    for (const paper of scopedPapers) {
      for (const topic of getPaperKeyTopics(paper, 12)) addCountToMap(paperTopicCounts, topic);
      addCountToMap(paperTitleCounts, paper.title);
      const seenAuthors = new Set();
      for (const author of (paper.authors || [])) {
        const name = String(author.name || '').trim();
        const key = normalizePersonKey(name);
        if (!name || !key || seenAuthors.has(key)) continue;
        seenAuthors.add(key);
        const bucket = ensurePersonBucket(peopleBuckets, name);
        if (!bucket) continue;
        bucket.paperCount += 1;
        bucket.labels.set(name, (bucket.labels.get(name) || 0) + 1);
      }
    }

    for (const talk of talks) {
      for (const topic of getTalkKeyTopics(talk, 12)) addCountToMap(talkTopicCounts, topic);
      addCountToMap(talkTitleCounts, talk.title);
      for (const speaker of (talk.speakers || [])) {
        const name = String((speaker && speaker.name) || '').trim();
        const bucket = ensurePersonBucket(peopleBuckets, name);
        if (!bucket) continue;
        bucket.talkCount += 1;
        bucket.labels.set(name, (bucket.labels.get(name) || 0) + 1);
      }
      const indexedTalk = buildTalkSearchEntry(talk);
      if (indexedTalk) nextTalkSearchIndex.push(indexedTalk);
    }

    const people = buildPeopleEntriesFromBuckets(peopleBuckets);

    autocompleteIndex.tags = mapToSortedEntries(paperTopicCounts);
    autocompleteIndex.speakers = people
      .filter((entry) => entry.paperCount > 0)
      .map((entry) => ({ label: entry.label, count: entry.paperCount }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    autocompleteIndex.topics = buildTopicEntries(talkTopicCounts, paperTopicCounts);
    autocompleteIndex.people = people;
    autocompleteIndex.talks = mapToAlphaEntries(talkTitleCounts);
    autocompleteIndex.papers = mapToAlphaEntries(paperTitleCounts);
    talkSearchIndex = nextTalkSearchIndex;

    const input = document.getElementById('search-input');
    if (input) {
      const query = String(input.value || '').trim();
      if (query) renderDropdown(query);
    }
  })();

  return universalAutocompletePromise;
}

function buildAutocompleteIndex() {
  buildPaperAutocompleteBase();
  hydrateUniversalAutocomplete();
}

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escapeHtml(text).replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
}

function renderDropdown(query) {
  const dropdown = document.getElementById('search-dropdown');
  if (!dropdown) return;

  if (!query || query.length < 1) {
    dropdown.classList.add('hidden');
    dropdownActiveIdx = -1;
    return;
  }

  const q = query.toLowerCase();

  const matchedTopics = autocompleteIndex.topics
    .filter((tag) => tag.label.toLowerCase().includes(q))
    .slice(0, 6);

  const matchedPeople = autocompleteIndex.people
    .filter((speaker) => speaker.label.toLowerCase().includes(q))
    .slice(0, 6);

  const matchedTalkTitles = autocompleteIndex.talks
    .filter((talk) => talk.label.toLowerCase().includes(q))
    .slice(0, 4);

  const matchedPaperTitles = autocompleteIndex.papers
    .filter((paper) => paper.label.toLowerCase().includes(q))
    .slice(0, 4);

  const tagIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`;
  const personIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
  const talkIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  const paperIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
  const searchIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;

  let html = `<div class="search-dropdown-section search-dropdown-section--action">
      <button class="search-dropdown-item search-dropdown-item--action" role="option" aria-selected="false"
              data-autocomplete-type="global" data-autocomplete-value="${escapeHtml(query)}">
        <span class="search-dropdown-item-icon">${searchIcon}</span>
        <span class="search-dropdown-item-label">Search entire library for "${escapeHtml(query)}"</span>
        <span class="search-dropdown-item-count">All</span>
      </button>
    </div>`;

  if (matchedTopics.length > 0) {
    if (html) html += `<div class="search-dropdown-divider"></div>`;
    html += `<div class="search-dropdown-section">
      <div class="search-dropdown-label" aria-hidden="true">Key Topics</div>
      ${matchedTopics.map((tag) => `
        <button class="search-dropdown-item" role="option" aria-selected="false"
                data-autocomplete-type="topic" data-autocomplete-value="${escapeHtml(tag.label)}">
          <span class="search-dropdown-item-icon">${tagIcon}</span>
          <span class="search-dropdown-item-label">${highlightMatch(tag.label, query)}</span>
          <span class="search-dropdown-item-count">${tag.count.toLocaleString()}</span>
        </button>`).join('')}
    </div>`;
  }

  if (matchedPeople.length > 0) {
    if (html) html += `<div class="search-dropdown-divider"></div>`;
    html += `<div class="search-dropdown-section">
      <div class="search-dropdown-label" aria-hidden="true">Speakers + Authors</div>
      ${matchedPeople.map((speaker) => `
        <button class="search-dropdown-item" role="option" aria-selected="false"
                data-autocomplete-type="person" data-autocomplete-value="${escapeHtml(speaker.label)}">
          <span class="search-dropdown-item-icon">${personIcon}</span>
          <span class="search-dropdown-item-label">${highlightMatch(speaker.label, query)}</span>
          <span class="search-dropdown-item-count">${speaker.count.toLocaleString()} work${speaker.count === 1 ? '' : 's'}</span>
        </button>`).join('')}
    </div>`;
  }

  if (matchedTalkTitles.length > 0) {
    if (html) html += `<div class="search-dropdown-divider"></div>`;
    html += `<div class="search-dropdown-section">
      <div class="search-dropdown-label" aria-hidden="true">Talk Titles</div>
      ${matchedTalkTitles.map((talk) => `
        <button class="search-dropdown-item" role="option" aria-selected="false"
                data-autocomplete-type="talk" data-autocomplete-value="${escapeHtml(talk.label)}">
          <span class="search-dropdown-item-icon">${talkIcon}</span>
          <span class="search-dropdown-item-label">${highlightMatch(talk.label, query)}</span>
          <span class="search-dropdown-item-count">Talk</span>
        </button>`).join('')}
    </div>`;
  }

  if (matchedPaperTitles.length > 0) {
    const titleLabel = PAGE_SCOPE === BLOG_FILTER_VALUE ? 'Blog Titles' : 'Paper Titles';
    const entryLabel = PAGE_SCOPE === BLOG_FILTER_VALUE ? 'Blog' : 'Paper';
    if (html) html += `<div class="search-dropdown-divider"></div>`;
    html += `<div class="search-dropdown-section">
      <div class="search-dropdown-label" aria-hidden="true">${titleLabel}</div>
      ${matchedPaperTitles.map((paper) => `
        <button class="search-dropdown-item" role="option" aria-selected="false"
                data-autocomplete-type="paper" data-autocomplete-value="${escapeHtml(paper.label)}">
          <span class="search-dropdown-item-icon">${paperIcon}</span>
          <span class="search-dropdown-item-label">${highlightMatch(paper.label, query)}</span>
          <span class="search-dropdown-item-count">${entryLabel}</span>
        </button>`).join('')}
    </div>`;
  }

  dropdown.innerHTML = html;
  dropdown.classList.remove('hidden');
  dropdownActiveIdx = -1;

  dropdown.querySelectorAll('.search-dropdown-item').forEach((item) => {
    item.addEventListener('mousedown', (event) => {
      event.preventDefault();
      selectAutocompleteItem(item);
    });
  });
}

function selectAutocompleteItem(item) {
  const value = item.dataset.autocompleteValue;
  const type = item.dataset.autocompleteType;
  applyAutocompleteSelection(type, value, 'search');
}

function closeDropdown() {
  const dropdown = document.getElementById('search-dropdown');
  if (!dropdown) return;

  dropdown.classList.add('hidden');
  dropdownActiveIdx = -1;
}

function navigateDropdown(direction) {
  const dropdown = document.getElementById('search-dropdown');
  if (!dropdown || dropdown.classList.contains('hidden')) return false;

  const items = Array.from(dropdown.querySelectorAll('.search-dropdown-item'));
  if (items.length === 0) return false;

  if (dropdownActiveIdx >= 0 && dropdownActiveIdx < items.length) {
    items[dropdownActiveIdx].setAttribute('aria-selected', 'false');
  }

  dropdownActiveIdx += direction;
  if (dropdownActiveIdx < 0) dropdownActiveIdx = items.length - 1;
  if (dropdownActiveIdx >= items.length) dropdownActiveIdx = 0;

  items[dropdownActiveIdx].setAttribute('aria-selected', 'true');
  items[dropdownActiveIdx].scrollIntoView({ block: 'nearest' });
  return true;
}

function findExactAutocompleteEntry(entries, value) {
  const normalized = normalizeFilterValue(value);
  if (!normalized) return null;
  return entries.find((entry) => normalizeFilterValue(entry.label) === normalized) || null;
}

function findTopicEntry(value) {
  return findExactAutocompleteEntry(autocompleteIndex.topics, value);
}

function findAuthorEntry(value) {
  return findExactAutocompleteEntry(autocompleteIndex.speakers, value);
}

function findPersonEntry(value) {
  return findExactAutocompleteEntry(autocompleteIndex.people, value);
}

function findTalkTitleEntry(value) {
  return findExactAutocompleteEntry(autocompleteIndex.talks, value);
}

function findPaperTitleEntry(value) {
  return findExactAutocompleteEntry(autocompleteIndex.papers, value);
}

function hasNonSearchFiltersApplied() {
  return !!(
    state.speaker ||
    state.activeTags.size > 0 ||
    state.years.size > 0 ||
    state.contentTypes.size > 0
  );
}

function buildGlobalSearchUrl(query) {
  const params = new URLSearchParams();
  params.set('mode', 'search');
  params.set('q', String(query || '').trim());
  return `${ALL_WORK_PAGE_PATH}?${params.toString()}`;
}

function routeToGlobalSearch(query) {
  const value = String(query || '').trim();
  if (!value) return false;
  window.location.href = buildGlobalSearchUrl(value);
  return true;
}

function shouldRouteToGlobalSearch(query) {
  const value = String(query || '').trim();
  if (!value) return false;

  const topic = findTopicEntry(value);
  if (topic && topic.paperCount === 0 && topic.talkCount > 0) return true;

  const talkTitle = findTalkTitleEntry(value);
  const paperTitle = findPaperTitleEntry(value);
  if (talkTitle && !paperTitle) return true;

  const person = findPersonEntry(value);
  const author = findAuthorEntry(value);
  if (person && !author) return true;

  if (!hasNonSearchFiltersApplied()) {
    const paperMatches = countPaperMatchesForQuery(value);
    if (paperMatches === 0) {
      const talkMatches = countTalkMatchesForQuery(value);
      if (talkMatches > 0) return true;
    }
  }

  return false;
}

function commitSearchValue(rawValue, allowGlobalRouting = true) {
  const committed = String(rawValue || '').trim();

  if (allowGlobalRouting && committed) {
    closeDropdown();
    routeToGlobalSearch(committed);
    return 'global';
  }

  if (committed !== state.activeSpeaker) state.activeSpeaker = '';
  if (committed && state.speaker) state.speaker = '';

  state.query = committed;
  closeDropdown();
  updateClearBtn();
  syncUrl();
  render();
  return 'local';
}

function initSearch() {
  const input = document.getElementById('search-input');
  const clearBtn = document.getElementById('search-clear');
  if (!input || !clearBtn) return;

  buildAutocompleteIndex();

  input.addEventListener('input', () => {
    const rawValue = input.value;

    if (rawValue.trim() !== state.activeSpeaker) state.activeSpeaker = '';

    if (rawValue.trim() && state.speaker) state.speaker = '';

    renderDropdown(rawValue.trim());

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      state.query = rawValue.trim();
      updateClearBtn();
      syncUrl();
      render();
    }, 150);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      navigateDropdown(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      navigateDropdown(-1);
    } else if (event.key === 'Enter') {
      const dropdown = document.getElementById('search-dropdown');
      if (dropdown && !dropdown.classList.contains('hidden') && dropdownActiveIdx >= 0) {
        event.preventDefault();
        const items = dropdown.querySelectorAll('.search-dropdown-item');
        if (items[dropdownActiveIdx]) selectAutocompleteItem(items[dropdownActiveIdx]);
      } else {
        event.preventDefault();
        clearTimeout(debounceTimer);
        const mode = commitSearchValue(input.value, false);
        if (mode !== 'global') input.blur();
      }
    } else if (event.key === 'Escape') {
      const dropdown = document.getElementById('search-dropdown');
      if (dropdown && !dropdown.classList.contains('hidden')) {
        closeDropdown();
      } else {
        input.blur();
      }
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(closeDropdown, 150);
  });

  clearBtn.addEventListener('click', () => {
    clearQuery();
    input.focus();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && document.activeElement !== input) {
      event.preventDefault();
      input.focus();
      input.select();
    }
  });
}

function initCardFilterInteractions() {
  const grid = document.getElementById('papers-grid');
  if (!grid) return;

  grid.addEventListener('click', (event) => {
    const speakerButton = event.target.closest('button[data-speaker-filter]');
    if (speakerButton && grid.contains(speakerButton)) {
      event.preventDefault();
      event.stopPropagation();
      filterBySpeaker(speakerButton.getAttribute('data-speaker-filter'));
      return;
    }

    const tagButton = event.target.closest('button[data-tag-filter]');
    if (tagButton && grid.contains(tagButton)) {
      event.preventDefault();
      event.stopPropagation();
      filterByTag(tagButton.getAttribute('data-tag-filter'));
    }
  });
}

// ============================================================
// Render + Control Sync
// ============================================================

function setViewMode(mode) {
  viewMode = mode === 'list' ? 'list' : 'grid';
  const grid = document.getElementById('papers-grid');
  if (grid) {
    grid.className = viewMode === 'list' ? 'talks-list' : 'talks-grid';
  }

  const gridBtn = document.getElementById('view-grid');
  const listBtn = document.getElementById('view-list');
  if (gridBtn && listBtn) {
    gridBtn.classList.toggle('active', viewMode === 'grid');
    listBtn.classList.toggle('active', viewMode === 'list');
    gridBtn.setAttribute('aria-pressed', viewMode === 'grid' ? 'true' : 'false');
    listBtn.setAttribute('aria-pressed', viewMode === 'list' ? 'true' : 'false');
  }

  localStorage.setItem('llvm-hub-view', viewMode);
}

function initViewControls() {
  const gridBtn = document.getElementById('view-grid');
  const listBtn = document.getElementById('view-list');
  if (!gridBtn || !listBtn) return;

  const savedView = localStorage.getItem('llvm-hub-view') || 'grid';
  setViewMode(savedView);

  gridBtn.addEventListener('click', () => setViewMode('grid'));
  listBtn.addEventListener('click', () => setViewMode('list'));
}

function syncSortControl() {
  const select = document.getElementById('papers-sort-select');
  if (!select) return;
  select.value = PAPER_SORT_MODES.has(state.sortBy) ? state.sortBy : 'relevance';
}

function initSortControl() {
  const select = document.getElementById('papers-sort-select');
  if (!select) return;

  select.addEventListener('change', () => {
    const next = String(select.value || '').trim();
    state.sortBy = PAPER_SORT_MODES.has(next) ? next : 'relevance';
    syncSortControl();
    syncUrl();
    render();
  });
}

function updateClearBtn() {
  const hasActivity =
    state.query.length > 0 ||
    state.speaker ||
    state.activeTags.size > 0 ||
    state.years.size > 0 ||
    state.contentTypes.size > 0;

  const clearBtn = document.getElementById('clear-filters');
  if (clearBtn) clearBtn.classList.toggle('hidden', !hasActivity);

  const searchClear = document.getElementById('search-clear');
  if (searchClear) searchClear.classList.toggle('visible', state.query.length > 0);
}

function syncHeaderGlobalSearchInput() {
  const input = document.querySelector('.global-search-input');
  if (!input) return;
  if (document.activeElement === input) return;

  const desired = String(state.query || '').trim();
  if (input.value !== desired) input.value = desired;
}

function render() {
  const results = filterAndSort();
  renderCards(results);
  renderResultCount(results.length);
  renderActiveFilters();
  updateHeroSubtitle(results.length);
  updateClearBtn();
  syncHeaderGlobalSearchInput();
}

// ============================================================
// Card-level filter hooks
// ============================================================

function buildAllWorkUrl(kind, value) {
  const params = new URLSearchParams();
  params.set('kind', kind);
  params.set('value', String(value || '').trim());
  params.set('from', PAGE_SCOPE === BLOG_FILTER_VALUE ? 'blogs' : 'papers');
  return `${ALL_WORK_PAGE_PATH}?${params.toString()}`;
}

function filterBySpeaker(name) {
  const value = String(name || '').trim();
  if (!value) return;

  const input = document.getElementById('search-input');
  state.speaker = value;
  state.activeSpeaker = '';
  state.query = '';
  state.activeTags.clear();
  syncTopicChipState();

  if (input) input.value = '';
  closeDropdown();
  updateClearBtn();
  syncUrl();
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function filterByTag(tag) {
  applyAutocompleteSelection('tag', tag, 'search');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

window.filterBySpeaker = filterBySpeaker;
window.filterByTag = filterByTag;

// ============================================================
// Theme / UI menus
// ============================================================

const THEME_PREF_KEY = 'llvm-hub-theme-preference';
const TEXT_SIZE_KEY = 'llvm-hub-text-size';
const THEME_PREF_VALUES = new Set(['system', 'light', 'dark']);
const TEXT_SIZE_VALUES = new Set(['small', 'default', 'large']);
let systemThemeQuery = null;

function getThemePreference() {
  const saved = localStorage.getItem(THEME_PREF_KEY);
  return THEME_PREF_VALUES.has(saved) ? saved : 'system';
}

function resolveTheme(preference) {
  if (preference === 'light' || preference === 'dark') return preference;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(preference, persist = false) {
  const pref = THEME_PREF_VALUES.has(preference) ? preference : 'system';
  const resolved = resolveTheme(pref);
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.setAttribute('data-theme-preference', pref);
  document.documentElement.style.backgroundColor = resolved === 'dark' ? '#000000' : '#f5f5f5';
  if (persist) localStorage.setItem(THEME_PREF_KEY, pref);
}

function getTextSizePreference() {
  const saved = localStorage.getItem(TEXT_SIZE_KEY);
  return TEXT_SIZE_VALUES.has(saved) ? saved : 'default';
}

function applyTextSize(size, persist = false) {
  const textSize = TEXT_SIZE_VALUES.has(size) ? size : 'default';
  if (textSize === 'default') {
    document.documentElement.removeAttribute('data-text-size');
  } else {
    document.documentElement.setAttribute('data-text-size', textSize);
  }
  if (persist) localStorage.setItem(TEXT_SIZE_KEY, textSize);
}

function syncCustomizationMenuControls() {
  const themeSelect = document.getElementById('custom-theme-select');
  const textSizeSelect = document.getElementById('custom-text-size-select');
  if (themeSelect) themeSelect.value = getThemePreference();
  if (textSizeSelect) textSizeSelect.value = getTextSizePreference();
}

function handleSystemThemeChange() {
  if (getThemePreference() === 'system') {
    applyTheme('system');
    syncCustomizationMenuControls();
  }
}

function initTheme() {
  applyTheme(getThemePreference());
  if (systemThemeQuery) return;

  systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  if (typeof systemThemeQuery.addEventListener === 'function') {
    systemThemeQuery.addEventListener('change', handleSystemThemeChange);
  } else if (typeof systemThemeQuery.addListener === 'function') {
    systemThemeQuery.addListener(handleSystemThemeChange);
  }
}

function initTextSize() {
  applyTextSize(getTextSizePreference());
}

function initCustomizationMenu() {
  const menu = document.getElementById('customization-menu');
  const toggle = document.getElementById('customization-toggle');
  const panel = document.getElementById('customization-panel');
  const themeSelect = document.getElementById('custom-theme-select');
  const textSizeSelect = document.getElementById('custom-text-size-select');
  const resetBtn = document.getElementById('custom-reset-display');
  if (!menu || !toggle || !panel || !themeSelect || !textSizeSelect || !resetBtn) return;

  syncCustomizationMenuControls();

  const openMenu = () => {
    menu.classList.add('open');
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
  };

  const closeMenu = () => {
    menu.classList.remove('open');
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  };

  const isInsideMenu = (target) => menu.contains(target);

  closeMenu();

  toggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (menu.classList.contains('open')) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  themeSelect.addEventListener('change', () => {
    const preference = THEME_PREF_VALUES.has(themeSelect.value) ? themeSelect.value : 'system';
    applyTheme(preference, true);
    syncCustomizationMenuControls();
  });

  textSizeSelect.addEventListener('change', () => {
    const size = TEXT_SIZE_VALUES.has(textSizeSelect.value) ? textSizeSelect.value : 'default';
    applyTextSize(size, true);
    syncCustomizationMenuControls();
  });

  resetBtn.addEventListener('click', () => {
    localStorage.removeItem(THEME_PREF_KEY);
    localStorage.removeItem(TEXT_SIZE_KEY);
    applyTheme('system');
    applyTextSize('default');
    syncCustomizationMenuControls();
  });

  document.addEventListener('pointerdown', (event) => {
    if (!isInsideMenu(event.target)) closeMenu();
  });

  document.addEventListener('focusin', (event) => {
    if (!isInsideMenu(event.target)) closeMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.classList.contains('open')) {
      closeMenu();
      toggle.focus();
    }
  });
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through
    }
  }

  try {
    const input = document.createElement('input');
    input.value = text;
    input.setAttribute('readonly', 'readonly');
    input.style.position = 'absolute';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(input);
    return !!ok;
  } catch {
    return false;
  }
}

function initMobileNavMenu() {
  const menu = document.getElementById('mobile-nav-menu');
  const toggle = document.getElementById('mobile-nav-toggle');
  const panel = document.getElementById('mobile-nav-panel');
  if (!menu || !toggle || !panel) return;

  const openMenu = () => {
    menu.classList.add('open');
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
  };

  const closeMenu = () => {
    menu.classList.remove('open');
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  };

  const isInsideMenu = (target) => menu.contains(target);

  closeMenu();

  toggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (menu.classList.contains('open')) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  panel.addEventListener('click', (event) => {
    const target = event.target.closest('a,button');
    if (target) closeMenu();
  });

  document.addEventListener('pointerdown', (event) => {
    if (!isInsideMenu(event.target)) closeMenu();
  });

  document.addEventListener('focusin', (event) => {
    if (!isInsideMenu(event.target)) closeMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.classList.contains('open')) {
      closeMenu();
      toggle.focus();
    }
  });
}

function initShareMenu() {
  const menu = document.getElementById('share-menu');
  const toggle = document.getElementById('share-btn');
  const panel = document.getElementById('share-panel');
  const copyBtn = document.getElementById('share-copy-link');
  const nativeShareBtn = document.getElementById('share-native-share');
  const emailLink = document.getElementById('share-email-link');
  const xLink = document.getElementById('share-x-link');
  const linkedInLink = document.getElementById('share-linkedin-link');
  if (!menu || !toggle || !panel || !copyBtn || !emailLink || !xLink || !linkedInLink) return;

  const shareUrl = window.location.href;
  const shareTitle = document.title || "LLVM Research Library";
  const defaultLabel = toggle.textContent.trim() || 'Share';
  let resetTimer = null;

  emailLink.href = `mailto:?subject=${encodeURIComponent(shareTitle)}&body=${encodeURIComponent(`${shareTitle} - ${shareUrl}`)}`;
  xLink.href = `https://x.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareTitle)}`;
  linkedInLink.href = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;

  const setButtonState = (label, success = false) => {
    toggle.textContent = label;
    toggle.classList.toggle('is-success', success);
    if (resetTimer) window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      toggle.textContent = defaultLabel;
      toggle.classList.remove('is-success');
    }, 1500);
  };

  const openMenu = () => {
    menu.classList.add('open');
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
  };

  const closeMenu = () => {
    menu.classList.remove('open');
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  };

  const isInsideMenu = (target) => menu.contains(target);
  const supportsNativeShare = typeof navigator.share === 'function';

  if (nativeShareBtn) nativeShareBtn.hidden = !supportsNativeShare;

  closeMenu();

  toggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (menu.classList.contains('open')) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  if (nativeShareBtn && supportsNativeShare) {
    nativeShareBtn.addEventListener('click', async (event) => {
      event.preventDefault();
      try {
        await navigator.share({ title: shareTitle, url: shareUrl });
        setButtonState('Shared', true);
      } catch (error) {
        if (error && error.name === 'AbortError') return;
        setButtonState('Share failed', false);
      }
      closeMenu();
    });
  }

  copyBtn.addEventListener('click', async (event) => {
    event.preventDefault();
    const copied = await copyTextToClipboard(shareUrl);
    setButtonState(copied ? 'Link copied' : 'Copy failed', copied);
    if (copied) closeMenu();
  });

  [emailLink, xLink, linkedInLink].forEach((link) => {
    link.addEventListener('click', () => {
      closeMenu();
    });
  });

  document.addEventListener('pointerdown', (event) => {
    if (!isInsideMenu(event.target)) closeMenu();
  });

  document.addEventListener('focusin', (event) => {
    if (!isInsideMenu(event.target)) closeMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.classList.contains('open')) {
      closeMenu();
      toggle.focus();
    }
  });
}

// ============================================================
// Boot
// ============================================================

(async function init() {
  initTheme();
  initTextSize();
  initCustomizationMenu();
  initMobileNavMenu();
  initShareMenu();
  initViewControls();

  const { papers } = await loadData();
  allPapers = Array.isArray(papers)
    ? papers.map(normalizePaperRecord).filter(Boolean)
    : [];
  scopedPapers = allPapers.filter((paper) => matchesPageScope(paper));

  if (!allPapers.length) {
    showError('No records were loaded from <code>papers/*.json</code>.');
    return;
  }

  buildSearchIndex();
  initFilters();
  initFilterAccordions();
  initFilterSidebarCollapse();
  initSearch();
  initSortControl();
  initCardFilterInteractions();

  loadStateFromUrl();
  applyUrlFilters();
  render();
})();

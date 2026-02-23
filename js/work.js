/**
 * work.js — Unified talks + papers + blogs view for a selected speaker/topic.
 */

const HubUtils = window.LLVMHubUtils || {};

const TALK_BATCH_SIZE = 24;
const PAPER_BATCH_SIZE = 24;
const BLOG_BATCH_SIZE = 24;
const UNIVERSAL_BATCH_SIZE = 36;
const BLOG_SOURCE_SLUGS = new Set(['llvm-blog-www', 'llvm-www-blog']);
const DIRECT_PDF_URL_RE = /\.pdf(?:$|[?#])|\/pdf(?:$|[/?#])|[?&](?:format|type|output)=pdf(?:$|[&#])|[?&]filename=[^&#]*\.pdf(?:$|[&#])/i;
const WORK_SORT_MODES = new Set(['relevance', 'newest', 'oldest', 'title', 'citations']);
const WORK_VIEW_MODES = new Set(['expanded', 'compact']);
const WORK_VIEW_STORAGE_KEY = 'llvm-hub-work-view';

const state = {
  mode: 'entity', // 'entity' | 'search'
  kind: 'topic', // 'speaker' | 'topic'
  value: '',
  query: '',
  from: 'talks', // 'talks' | 'papers' | 'blogs' | 'people' | 'work'
  sortBy: 'relevance',
  viewMode: 'expanded',
};

const CATEGORY_META = {
  keynote: { label: 'Keynote' },
  'technical-talk': { label: 'Technical Talk' },
  tutorial: { label: 'Tutorial' },
  panel: { label: 'Panel' },
  'quick-talk': { label: 'Quick Talk' },
  'lightning-talk': { label: 'Lightning Talk' },
  'student-talk': { label: 'Student Technical Talk' },
  'llvm-foundation': { label: 'LLVM Foundation' },
  bof: { label: 'BoF' },
  poster: { label: 'Poster' },
  workshop: { label: 'Workshop' },
  other: { label: 'Other' },
};

let filteredTalks = [];
let filteredPapers = [];
let filteredBlogs = [];
let filteredUniversal = [];
let renderedTalkCount = 0;
let renderedPaperCount = 0;
let renderedBlogCount = 0;
let renderedUniversalCount = 0;
let allTalkRecords = [];
let allPaperRecords = [];
let allBlogRecords = [];

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeExternalUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw, window.location.href);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol === 'http:' || protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    return '';
  }
  return '';
}

function setIssueContext(context) {
  if (typeof window.setLibraryIssueContext !== 'function') return;
  if (!context || typeof context !== 'object') return;
  window.setLibraryIssueContext(context);
}

function normalizeValue(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeViewMode(value) {
  const normalized = normalizeValue(value);
  if (normalized === 'compact' || normalized === 'list') return 'compact';
  return 'expanded';
}

function defaultSortMode() {
  return state.mode === 'search' ? 'relevance' : 'newest';
}

function normalizeSortMode(value) {
  const normalized = normalizeValue(value);
  if (!WORK_SORT_MODES.has(normalized)) return defaultSortMode();
  if (state.mode !== 'search' && normalized === 'relevance') return 'newest';
  return normalized;
}

function normalizePersonKey(value) {
  if (typeof HubUtils.normalizePersonKey === 'function') {
    return HubUtils.normalizePersonKey(value);
  }
  return normalizeValue(value);
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
    .replace(/[^a-z0-9+]+/g, '');
}

function normalizePublicationLabel(value) {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  if (/^arxiv(?:\.org)?(?:\s*\(cornell university\))?$/i.test(cleaned)) {
    return 'arXiv';
  }
  return cleaned;
}

function getTalkKeyTopics(talk, limit = Infinity) {
  if (typeof HubUtils.getTalkKeyTopics === 'function') {
    return HubUtils.getTalkKeyTopics(talk, limit);
  }
  const tags = Array.isArray(talk && talk.tags) ? talk.tags : [];
  return Number.isFinite(limit) ? tags.slice(0, limit) : tags;
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

function toTitleCaseSlug(slug) {
  return String(slug || '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function isDirectPdfUrl(url) {
  return DIRECT_PDF_URL_RE.test(String(url || '').trim());
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

function stripSearchSourceText(value) {
  return String(value || '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1 ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`*_>#~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildContextSnippet(sourceText, query, maxLength = 320) {
  const text = stripSearchSourceText(sourceText);
  if (!text) return '';

  if (query && query.length >= 2 && typeof HubUtils.buildSearchSnippet === 'function') {
    const snippet = HubUtils.buildSearchSnippet(text, query, { maxLength });
    if (snippet) return snippet;
  }

  if (text.length <= maxLength) return text;
  const hardSlice = text.slice(0, maxLength).trim();
  const softSlice = hardSlice.replace(/\s+\S*$/, '').trim();
  return `${softSlice || hardSlice}...`;
}

function getPaperPreviewSource(paper) {
  const parts = [
    paper && paper.abstract,
    paper && paper.content,
    paper && paper.body,
    paper && paper.markdown,
    paper && paper.html,
  ]
    .map((value) => stripSearchSourceText(value))
    .filter(Boolean);
  return parts.join(' ');
}

function categoryLabel(cat) {
  return CATEGORY_META[cat]?.label ?? toTitleCaseSlug(cat || 'other');
}

function formatSpeakers(speakers) {
  if (!speakers || speakers.length === 0) return '';
  return speakers.map((speaker) => speaker.name).join(', ');
}

function sourceNameFromHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
  if (!host) return 'External Source';
  if (host === 'youtu.be' || host.endsWith('youtube.com')) return 'YouTube';
  if (host === 'devimages.apple.com') return 'Apple Developer';
  return host;
}

function isAppleDeveloperVideoUrl(videoUrl) {
  if (!videoUrl) return false;
  try {
    const host = new URL(videoUrl).hostname.toLowerCase().replace(/^www\./, '');
    return host === 'devimages.apple.com';
  } catch {
    return false;
  }
}

function getVideoLinkMeta(videoUrl, titleEsc) {
  const fallback = {
    text: 'Watch',
    ariaLabel: `Watch video: ${titleEsc} (opens in new tab)`,
    icon: 'play',
  };
  if (!videoUrl) return fallback;

  try {
    const url = new URL(videoUrl);
    const sourceName = sourceNameFromHost(url.hostname);
    const isYouTube = sourceName === 'YouTube';
    const isDownload =
      /\.(mov|m4v|mp4|mkv|avi|wmv|webm)$/i.test(url.pathname) ||
      /download/i.test(url.pathname) ||
      /download/i.test(url.search);

    if (isDownload) {
      const sourceText = isYouTube ? '' : ` (${sourceName})`;
      return {
        text: `Download${sourceText}`,
        ariaLabel: `Download video${isYouTube ? '' : ` from ${sourceName}`}: ${titleEsc} (opens in new tab)`,
        icon: sourceName === 'Apple Developer' ? 'tv' : 'download',
      };
    }

    if (!isYouTube) {
      return {
        text: `Watch on ${sourceName}`,
        ariaLabel: `Watch on ${sourceName}: ${titleEsc} (opens in new tab)`,
        icon: 'play',
      };
    }

    return {
      text: 'Watch',
      ariaLabel: `Watch on YouTube: ${titleEsc} (opens in new tab)`,
      icon: 'play',
    };
  } catch {
    return fallback;
  }
}

const _SVG_DOC = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`;
const _SVG_TOOL = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;
const _SVG_CHAT = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
const _SVG_TV = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2" ry="2"/><line x1="8" y1="20" x2="16" y2="20"/><line x1="12" y1="17" x2="12" y2="20"/><polygon points="10 9 15 11 10 13 10 9" fill="currentColor" stroke="none"/></svg>`;

function placeholderSvgForCategory(category) {
  return { workshop: _SVG_TOOL, panel: _SVG_CHAT, bof: _SVG_CHAT }[category] ?? _SVG_DOC;
}

function placeholderSvgForTalk(talk) {
  if (isAppleDeveloperVideoUrl(talk.videoUrl)) return _SVG_TV;
  return placeholderSvgForCategory(talk.category);
}

window.thumbnailError = function thumbnailError(img, category) {
  const div = document.createElement('div');
  div.className = 'card-thumbnail-placeholder';
  div.innerHTML = placeholderSvgForCategory(category);
  if (img.parentElement) img.parentElement.replaceChild(div, img);
};

document.addEventListener('error', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLImageElement)) return;
  const category = target.getAttribute('data-thumbnail-category');
  if (!category) return;
  window.thumbnailError(target, category);
}, true);

function buildWorkUrl(kind, value) {
  const params = new URLSearchParams();
  params.set('mode', 'entity');
  params.set('kind', kind);
  params.set('value', String(value || '').trim());
  params.set('from', 'work');
  return `work.html?${params.toString()}`;
}

function parseStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const kindParam = normalizeValue(params.get('kind'));
  const kind = kindParam === 'speaker' ? 'speaker' : 'topic';
  const valueParam = String(params.get('value') || '').trim();
  const queryParam = String(params.get('q') || '').trim();
  const modeParam = normalizeValue(params.get('mode'));
  const fromParam = normalizeValue(params.get('from'));
  const FROM_VALUES = new Set(['talks', 'papers', 'blogs', 'people', 'work']);
  const from = FROM_VALUES.has(fromParam) ? fromParam : 'talks';
  const hasEntityContext = Boolean(valueParam || kindParam);
  const explicitEntityMode = modeParam === 'entity';
  const isSearchMode = modeParam === 'search' || (!explicitEntityMode && !hasEntityContext && !!queryParam);

  state.kind = kind;
  state.mode = isSearchMode ? 'search' : 'entity';
  state.query = isSearchMode ? queryParam : '';
  state.value = isSearchMode ? '' : String(valueParam || queryParam || '').trim();
  state.from = from;
  state.sortBy = normalizeSortMode(params.get('sort'));

  const urlView = params.get('view');
  if (urlView) {
    state.viewMode = normalizeViewMode(urlView);
  } else {
    const savedView = localStorage.getItem(WORK_VIEW_STORAGE_KEY);
    state.viewMode = WORK_VIEW_MODES.has(normalizeViewMode(savedView))
      ? normalizeViewMode(savedView)
      : 'expanded';
  }
}

function syncUrlState() {
  const params = new URLSearchParams();

  if (state.mode === 'search') {
    params.set('mode', 'search');
    if (state.query) params.set('q', state.query);
  } else {
    params.set('mode', 'entity');
    params.set('kind', state.kind === 'speaker' ? 'speaker' : 'topic');
    if (state.value) params.set('value', state.value);
  }

  if (state.from && state.from !== 'talks') params.set('from', state.from);

  const defaultSort = defaultSortMode();
  if (state.sortBy !== defaultSort) params.set('sort', state.sortBy);
  if (state.viewMode !== 'expanded') params.set('view', state.viewMode);

  const nextUrl = params.toString()
    ? `${window.location.pathname}?${params.toString()}`
    : window.location.pathname;
  history.replaceState(null, '', nextUrl);
}

function updateIssueContextForWork() {
  const isSearch = state.mode === 'search';
  const itemType = isSearch
    ? 'Search'
    : (state.kind === 'speaker' ? 'Person' : 'Topic');
  const itemTitle = isSearch ? state.query : state.value;

  setIssueContext({
    pageType: 'Work',
    itemType,
    itemTitle,
    query: state.query,
  });
}

function syncGlobalSearchInput() {
  const input = document.querySelector('.global-search-input');
  if (!input) return;
  input.value = state.mode === 'search' ? state.query : state.value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function normalizePaperRecord(rawPaper) {
  if (!rawPaper || typeof rawPaper !== 'object') return null;

  const paper = { ...rawPaper };
  paper.id = String(paper.id || '').trim();
  paper.title = String(paper.title || '').trim();
  paper.abstract = String(paper.abstract || '').trim();
  paper.year = String(paper.year || '').trim();
  paper.publication = normalizePublicationLabel(paper.publication);
  paper.venue = normalizePublicationLabel(paper.venue);
  paper.type = String(paper.type || '').trim();
  paper.paperUrl = String(paper.paperUrl || '').trim();
  paper.sourceUrl = String(paper.sourceUrl || '').trim();
  paper.source = String(paper.source || '').trim();
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
        if (!name) return null;
        return { name };
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
  paper._citationCount = paper.citationCount;
  paper._titleLower = paper.title.toLowerCase();
  paper._authorsLower = paper.authors.map((author) => `${author.name || ''}`).join(' ').toLowerCase();
  paper._topicsLower = `${paper.tags.join(' ')} ${paper.keywords.join(' ')}`.trim().toLowerCase();
  paper._abstractLower = paper.abstract.toLowerCase();
  paper._contentLower = [
    paper.content,
    paper.body,
    paper.markdown,
    paper.html,
  ].map((value) => String(value || '').trim()).filter(Boolean).join(' ').toLowerCase();
  paper._publicationLower = paper.publication.toLowerCase();
  paper._venueLower = paper.venue.toLowerCase();
  paper._yearLower = paper._year.toLowerCase();
  const normalizedSource = paper.source.toLowerCase();
  const normalizedType = paper.type.toLowerCase();
  paper._isBlog = BLOG_SOURCE_SLUGS.has(normalizedSource)
    || normalizedType === 'blog'
    || normalizedType === 'blog-post'
    || /^https?:\/\/(?:www\.)?blog\.llvm\.org\//i.test(paper.sourceUrl)
    || /github\.com\/llvm\/(?:llvm-blog-www|llvm-www-blog)\b/i.test(paper.paperUrl);
  return paper;
}

function isBlogPaper(paper) {
  return !!(paper && paper._isBlog);
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

function compareTalksNewestFirst(a, b) {
  const meetingDiff = String(b.meeting || '').localeCompare(String(a.meeting || ''));
  if (meetingDiff !== 0) return meetingDiff;

  const titleDiff = String(a.title || '').localeCompare(String(b.title || ''));
  if (titleDiff !== 0) return titleDiff;

  return String(a.id || '').localeCompare(String(b.id || ''));
}

function compareTalksOldestFirst(a, b) {
  const meetingDiff = String(a.meeting || '').localeCompare(String(b.meeting || ''));
  if (meetingDiff !== 0) return meetingDiff;

  const titleDiff = String(a.title || '').localeCompare(String(b.title || ''));
  if (titleDiff !== 0) return titleDiff;

  return String(a.id || '').localeCompare(String(b.id || ''));
}

function compareTalksTitle(a, b) {
  const titleDiff = String(a.title || '').localeCompare(String(b.title || ''));
  if (titleDiff !== 0) return titleDiff;

  const meetingDiff = String(b.meeting || '').localeCompare(String(a.meeting || ''));
  if (meetingDiff !== 0) return meetingDiff;

  return String(a.id || '').localeCompare(String(b.id || ''));
}

function comparePapersNewestFirst(a, b) {
  const yearDiff = String(b._year || '').localeCompare(String(a._year || ''));
  if (yearDiff !== 0) return yearDiff;

  const titleDiff = String(a.title || '').localeCompare(String(b.title || ''));
  if (titleDiff !== 0) return titleDiff;

  return String(a.id || '').localeCompare(String(b.id || ''));
}

function comparePapersOldestFirst(a, b) {
  const yearDiff = String(a._year || '').localeCompare(String(b._year || ''));
  if (yearDiff !== 0) return yearDiff;

  const titleDiff = String(a.title || '').localeCompare(String(b.title || ''));
  if (titleDiff !== 0) return titleDiff;

  return String(a.id || '').localeCompare(String(b.id || ''));
}

function comparePapersTitle(a, b) {
  const titleDiff = String(a.title || '').localeCompare(String(b.title || ''));
  if (titleDiff !== 0) return titleDiff;

  const yearDiff = String(b._year || '').localeCompare(String(a._year || ''));
  if (yearDiff !== 0) return yearDiff;

  return String(a.id || '').localeCompare(String(b.id || ''));
}

function comparePapersCitations(a, b) {
  const aCitations = Number(a._citationCount || 0);
  const bCitations = Number(b._citationCount || 0);
  if (aCitations !== bCitations) return bCitations - aCitations;

  return comparePapersNewestFirst(a, b);
}

function sortTalkResults(talks) {
  const entries = [...(talks || [])];
  if (state.sortBy === 'oldest') return entries.sort(compareTalksOldestFirst);
  if (state.sortBy === 'title') return entries.sort(compareTalksTitle);
  if (state.mode === 'search' && state.sortBy === 'relevance') return entries;
  return entries.sort(compareTalksNewestFirst);
}

function sortPaperResults(papers) {
  const entries = [...(papers || [])];
  if (state.sortBy === 'oldest') return entries.sort(comparePapersOldestFirst);
  if (state.sortBy === 'title') return entries.sort(comparePapersTitle);
  if (state.sortBy === 'citations') return entries.sort(comparePapersCitations);
  if (state.mode === 'search' && state.sortBy === 'relevance') return entries;
  return entries.sort(comparePapersNewestFirst);
}

function tokenizeQuery(query) {
  if (typeof HubUtils.tokenizeQuery === 'function') return HubUtils.tokenizeQuery(query);
  const tokens = [];
  const re = /"([^"]+)"|(\S+)/g;
  let match;
  while ((match = re.exec(String(query || ''))) !== null) {
    const token = (match[1] || match[2] || '').toLowerCase().trim();
    if (token.length >= 2) tokens.push(token);
  }
  return tokens;
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseYearValue(value) {
  const match = String(value || '').match(/\b(19|20)\d{2}\b/);
  if (!match) return 0;
  const year = Number.parseInt(match[0], 10);
  return Number.isFinite(year) ? year : 0;
}

function computeUniversalTitleBoost(title, normalizedQuery, normalizedTokens) {
  const normalizedTitle = normalizeSearchText(title);
  if (!normalizedTitle || !normalizedQuery) return 0;

  let boost = 0;
  if (normalizedTitle === normalizedQuery) {
    boost += 260;
  } else if (normalizedTitle.startsWith(`${normalizedQuery} `) || normalizedTitle.startsWith(normalizedQuery)) {
    boost += 136;
  } else if (normalizedTitle.includes(normalizedQuery)) {
    boost += 72;
  }

  if (Array.isArray(normalizedTokens) && normalizedTokens.length) {
    let matchedTokens = 0;
    for (const token of normalizedTokens) {
      if (token && normalizedTitle.includes(token)) matchedTokens += 1;
    }
    if (matchedTokens > 0) {
      boost += (matchedTokens / normalizedTokens.length) * 28;
      if (matchedTokens === normalizedTokens.length) boost += 56;
    }
  }

  return boost;
}

function getUniversalEntryTitle(entry) {
  if (!entry || typeof entry !== 'object') return '';
  if (entry.kind === 'talk') return String((entry.talk && entry.talk.title) || '');
  return String((entry.paper && entry.paper.title) || '');
}

function getUniversalEntryYear(entry) {
  if (!entry || typeof entry !== 'object') return 0;
  if (entry.kind === 'talk') {
    const talk = entry.talk || {};
    return parseYearValue(talk.meeting || talk.meetingDate || talk._year);
  }
  const paper = entry.paper || {};
  return parseYearValue(paper._year || paper.year || paper.publishedDate || paper.publishDate || paper.date);
}

function getUniversalEntryCitations(entry) {
  if (!entry || typeof entry !== 'object') return 0;
  if (entry.kind === 'talk') return 0;
  const paper = entry.paper || {};
  const citations = Number(paper._citationCount || paper.citationCount || 0);
  return Number.isFinite(citations) && citations > 0 ? citations : 0;
}

function compareUniversalEntries(a, b) {
  if (state.sortBy === 'title') {
    const titleDiff = getUniversalEntryTitle(a).localeCompare(getUniversalEntryTitle(b));
    if (titleDiff !== 0) return titleDiff;
    const yearDiff = getUniversalEntryYear(b) - getUniversalEntryYear(a);
    if (yearDiff !== 0) return yearDiff;
    return (b.score || 0) - (a.score || 0);
  }

  if (state.sortBy === 'newest' || state.sortBy === 'oldest') {
    const yearDiff = getUniversalEntryYear(b) - getUniversalEntryYear(a);
    if (yearDiff !== 0) return state.sortBy === 'newest' ? yearDiff : -yearDiff;
    const scoreDiff = (b.score || 0) - (a.score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return getUniversalEntryTitle(a).localeCompare(getUniversalEntryTitle(b));
  }

  if (state.sortBy === 'citations') {
    const citationDiff = getUniversalEntryCitations(b) - getUniversalEntryCitations(a);
    if (citationDiff !== 0) return citationDiff;
    const yearDiff = getUniversalEntryYear(b) - getUniversalEntryYear(a);
    if (yearDiff !== 0) return yearDiff;
    const scoreDiff = (b.score || 0) - (a.score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return getUniversalEntryTitle(a).localeCompare(getUniversalEntryTitle(b));
  }

  const scoreDiff = (b.score || 0) - (a.score || 0);
  if (scoreDiff !== 0) return scoreDiff;
  const yearDiff = getUniversalEntryYear(b) - getUniversalEntryYear(a);
  if (yearDiff !== 0) return yearDiff;
  return getUniversalEntryTitle(a).localeCompare(getUniversalEntryTitle(b));
}

function buildUniversalResultsFromRankedLists(talks, papers, blogs, query) {
  const rankedTalks = Array.isArray(talks) ? talks : [];
  const rankedPapers = Array.isArray(papers) ? papers : [];
  const rankedBlogs = Array.isArray(blogs) ? blogs : [];
  const normalizedQuery = normalizeSearchText(query);
  const normalizedTokens = tokenizeQuery(query).map((token) => normalizeSearchText(token)).filter(Boolean);
  const model = typeof HubUtils.buildSearchQueryModel === 'function'
    ? HubUtils.buildSearchQueryModel(query)
    : null;
  const hasModel = !!(model && Array.isArray(model.clauses) && model.clauses.length > 0);
  const canScoreTalkByModel = hasModel && typeof HubUtils.scoreTalkRecordByModel === 'function';
  const canScorePaperByModel = hasModel && typeof HubUtils.scorePaperRecordByModel === 'function';
  const strict = [];
  const relaxed = [];
  const fallback = [];

  const pushEntry = (bucket, kind, record, score, rankIndex) => {
    if (!(score > 0)) return;
    if (kind === 'talk') {
      bucket.push({ kind, talk: record, score, rankIndex });
      return;
    }
    bucket.push({ kind, paper: record, score, rankIndex });
  };

  const pushForKind = (records, kind) => {
    const values = Array.isArray(records) ? records : [];
    const canScoreByModel = kind === 'talk' ? canScoreTalkByModel : canScorePaperByModel;

    values.forEach((record, index) => {
      const title = getUniversalEntryTitle(kind === 'talk' ? { kind, talk: record } : { kind, paper: record });
      const titleBoost = computeUniversalTitleBoost(title, normalizedQuery, normalizedTokens);

      if (canScoreByModel) {
        const strictScore = kind === 'talk'
          ? HubUtils.scoreTalkRecordByModel(record, model, { relaxed: false })
          : HubUtils.scorePaperRecordByModel(record, model, { relaxed: false });
        if (strictScore > 0) {
          pushEntry(strict, kind, record, strictScore + titleBoost, index);
          return;
        }

        const relaxedScore = kind === 'talk'
          ? HubUtils.scoreTalkRecordByModel(record, model, { relaxed: true })
          : HubUtils.scorePaperRecordByModel(record, model, { relaxed: true });
        if (relaxedScore > 0) {
          pushEntry(relaxed, kind, record, relaxedScore + (titleBoost * 0.9), index);
          return;
        }
      }

      const fallbackScore = (230 / (index + 2)) + titleBoost;
      pushEntry(fallback, kind, record, fallbackScore, index);
    });
  };

  pushForKind(rankedTalks, 'talk');
  pushForKind(rankedPapers, 'paper');
  pushForKind(rankedBlogs, 'blog');

  let entries = [];
  if (strict.length > 0) {
    const softenedRelaxed = relaxed.map((entry) => ({ ...entry, score: entry.score * 0.55 }));
    entries = [...strict, ...softenedRelaxed];
  }
  else if (relaxed.length > 0) entries = relaxed;
  else entries = fallback;

  return entries.sort(compareUniversalEntries);
}

function splitUniversalEntries(entries) {
  const talks = [];
  const papers = [];
  const blogs = [];

  for (const entry of (entries || [])) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.kind === 'talk' && entry.talk) talks.push(entry.talk);
    else if (entry.kind === 'paper' && entry.paper) papers.push(entry.paper);
    else if (entry.kind === 'blog' && entry.paper) blogs.push(entry.paper);
  }

  return { talks, papers, blogs };
}

function indexTalkForSearch(talk) {
  const keyTopics = getTalkKeyTopics(talk);
  return {
    ...talk,
    _titleLower: String(talk.title || '').toLowerCase(),
    _speakerLower: (talk.speakers || []).map((speaker) => speaker.name).join(' ').toLowerCase(),
    _abstractLower: String(talk.abstract || '').toLowerCase(),
    _tagsLower: keyTopics.join(' ').toLowerCase(),
    _meetingLower: `${talk.meetingName || ''} ${talk.meetingLocation || ''} ${talk.meetingDate || ''}`.toLowerCase(),
    _year: talk.meeting ? String(talk.meeting).slice(0, 4) : '',
  };
}

function scorePaperForQuery(paper, tokens) {
  if (!tokens.length) return 0;

  let total = 0;
  const title = String(paper.title || '').toLowerCase();
  const authors = (paper.authors || []).map((author) => `${author.name || ''}`).join(' ').toLowerCase();
  const abstractText = String(paper.abstract || '').toLowerCase();
  const tags = (paper.tags || []).join(' ').toLowerCase();
  const keywords = (paper.keywords || []).join(' ').toLowerCase();
  const publication = String(paper.publication || '').toLowerCase();
  const venue = String(paper.venue || '').toLowerCase();
  const year = String(paper._year || '').toLowerCase();

  for (const token of tokens) {
    let tokenScore = 0;
    const titleIdx = title.indexOf(token);
    if (titleIdx !== -1) tokenScore += titleIdx === 0 ? 100 : 50;
    if (authors.includes(token)) tokenScore += 34;
    if (tags.includes(token)) tokenScore += 20;
    if (keywords.includes(token)) tokenScore += 16;
    if (abstractText.includes(token)) tokenScore += 12;
    if (publication.includes(token)) tokenScore += 10;
    if (venue.includes(token)) tokenScore += 8;
    if (year.includes(token)) tokenScore += 6;
    if (tokenScore === 0) return 0;
    total += tokenScore;
  }

  const yearNumber = Number.parseInt(String(paper._year || ''), 10);
  total += (Number.isFinite(yearNumber) ? yearNumber : 2002) * 0.01;
  return total;
}

function rankTalksForQuery(talks, query) {
  const indexedTalks = (talks || []).map(indexTalkForSearch);
  const tokens = tokenizeQuery(query);
  if (!tokens.length) return indexedTalks.sort(compareTalksNewestFirst);

  if (typeof HubUtils.rankTalksByQuery === 'function') {
    return HubUtils.rankTalksByQuery(indexedTalks, query);
  }

  if (typeof HubUtils.scoreMatch === 'function') {
    const scored = [];
    for (const talk of indexedTalks) {
      const score = HubUtils.scoreMatch(talk, tokens);
      if (score > 0) scored.push({ talk, score });
    }
    scored.sort((a, b) => (b.score - a.score) || compareTalksNewestFirst(a.talk, b.talk));
    return scored.map((entry) => entry.talk);
  }

  return indexedTalks.sort(compareTalksNewestFirst);
}

function rankPapersForQuery(papers, query) {
  if (typeof HubUtils.rankPaperRecordsByQuery === 'function') {
    return HubUtils.rankPaperRecordsByQuery(papers, query);
  }

  const tokens = tokenizeQuery(query);
  if (!tokens.length) return [...papers].sort(comparePapersNewestFirst);

  const scored = [];
  for (const paper of papers) {
    const score = scorePaperForQuery(paper, tokens);
    if (score > 0) scored.push({ paper, score });
  }

  scored.sort((a, b) => (b.score - a.score) || comparePapersNewestFirst(a.paper, b.paper));
  return scored.map((entry) => entry.paper);
}

function recomputeFilteredResults() {
  if (state.mode === 'search') {
    const rankedTalks = rankTalksForQuery(allTalkRecords, state.query);
    const rankedPapers = rankPapersForQuery(allPaperRecords, state.query);
    const rankedBlogs = rankPapersForQuery(allBlogRecords, state.query);
    filteredUniversal = buildUniversalResultsFromRankedLists(rankedTalks, rankedPapers, rankedBlogs, state.query);
    const split = splitUniversalEntries(filteredUniversal);
    filteredTalks = split.talks;
    filteredPapers = split.papers;
    filteredBlogs = split.blogs;
    return;
  }

  filteredUniversal = [];
  const normalizedNeedle = normalizeValue(state.value);
  const normalizedTopicNeedle = normalizeTopicKey(state.value);

  filteredTalks = sortTalkResults(
    allTalkRecords.filter((talk) => matchesTalkEntity(talk, normalizedNeedle, normalizedTopicNeedle))
  );
  filteredPapers = sortPaperResults(
    allPaperRecords.filter((paper) => matchesPaperEntity(paper, normalizedNeedle, normalizedTopicNeedle))
  );
  filteredBlogs = sortPaperResults(
    allBlogRecords.filter((paper) => matchesPaperEntity(paper, normalizedNeedle, normalizedTopicNeedle))
  );
}

function matchesTalkEntity(talk, normalizedNeedle, normalizedTopicNeedle) {
  if (state.kind === 'speaker') {
    return (talk.speakers || []).some((speaker) => samePersonName(speaker.name, state.value));
  }

  const topics = getTalkKeyTopics(talk);
  if (normalizedTopicNeedle) {
    return topics.some((topic) => normalizeTopicKey(topic) === normalizedTopicNeedle);
  }
  return topics.some((topic) => normalizeValue(topic) === normalizedNeedle);
}

function matchesPaperEntity(paper, normalizedNeedle, normalizedTopicNeedle) {
  if (state.kind === 'speaker') {
    return (paper.authors || []).some((author) => samePersonName(author.name, state.value));
  }

  const canonicalTopics = getPaperKeyTopics(paper);
  if (normalizedTopicNeedle && canonicalTopics.length > 0) {
    return canonicalTopics.some((topic) => normalizeTopicKey(topic) === normalizedTopicNeedle);
  }

  return [...(paper.tags || []), ...(paper.keywords || [])]
    .some((topic) => {
      if (normalizedTopicNeedle) return normalizeTopicKey(topic) === normalizedTopicNeedle;
      return normalizeValue(topic) === normalizedNeedle;
    });
}

function renderEntityLinks(items, kind) {
  if (!items || items.length === 0) return '';

  const tokens = state.mode === 'search' ? tokenizeQuery(state.query) : [];

  return items
    .map((label) => {
      const value = String(label || '').trim();
      if (!value) return '';
      return `<a class="speaker-btn" href="${escapeHtml(buildWorkUrl(kind, value))}">${highlightText(value, tokens)}</a>`;
    })
    .filter(Boolean)
    .join('<span class="speaker-btn-sep">, </span>');
}

function renderTagLinks(tags) {
  if (!tags || tags.length === 0) return '';

  const tokens = state.mode === 'search' ? tokenizeQuery(state.query) : [];
  const shown = tags.slice(0, 4);
  return `<div class="card-tags-wrap"><div class="card-tags" aria-label="Key Topics">${shown
    .map((tag) => `<a class="card-tag" href="${escapeHtml(buildWorkUrl('topic', tag))}">${highlightText(tag, tokens)}</a>`)
    .join('')}${tags.length > shown.length ? `<span class="card-tag card-tag--more" aria-hidden="true">+${tags.length - shown.length}</span>` : ''}</div></div>`;
}

function renderTalkCard(talk) {
  const query = state.mode === 'search' ? state.query : '';
  const tokens = query ? tokenizeQuery(query) : [];
  const titleEsc = escapeHtml(talk.title || 'Untitled talk');
  const abstractPreview = buildContextSnippet(talk.abstract || '', query, 300);
  const thumbnailUrl = talk.videoId
    ? `https://img.youtube.com/vi/${talk.videoId}/hqdefault.jpg`
    : '';
  const meetingLabel = talk.meetingName || (talk._year || talk.meeting?.slice(0, 4) || '');
  const badgeCls = `badge badge-${escapeHtml(talk.category || 'other')}`;
  const placeholderHtml = `<div class="card-thumbnail-placeholder">${placeholderSvgForTalk(talk)}</div>`;
  const thumbnailHtml = thumbnailUrl
    ? `<img src="${escapeHtml(thumbnailUrl)}" alt="" loading="lazy" data-thumbnail-category="${escapeHtml(talk.category || '')}">`
    : placeholderHtml;
  const videoHref = sanitizeExternalUrl(talk.videoUrl);
  const slidesHref = sanitizeExternalUrl(talk.slidesUrl);
  const githubHref = sanitizeExternalUrl(talk.projectGithub);
  const videoMeta = getVideoLinkMeta(videoHref, titleEsc);
  const videoIcon = videoMeta.icon === 'download'
    ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 21h16"/></svg>`
    : videoMeta.icon === 'tv'
      ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2" ry="2"/><line x1="8" y1="20" x2="16" y2="20"/><line x1="12" y1="17" x2="12" y2="20"/></svg>`
      : `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  const videoLinkHtml = videoHref
    ? `<a href="${escapeHtml(videoHref)}" class="card-link-btn card-link-btn--video" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(videoMeta.ariaLabel)}">${videoIcon}<span aria-hidden="true">${escapeHtml(videoMeta.text)}</span></a>`
    : '';
  const slidesLinkHtml = slidesHref
    ? `<a href="${escapeHtml(slidesHref)}" class="card-link-btn" target="_blank" rel="noopener noreferrer" aria-label="View slides: ${titleEsc} (opens in new tab)"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span aria-hidden="true">Slides</span></a>`
    : '';
  const githubLinkHtml = githubHref
    ? `<a href="${escapeHtml(githubHref)}" class="card-link-btn" target="_blank" rel="noopener noreferrer" aria-label="GitHub repository: ${titleEsc} (opens in new tab)"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg><span aria-hidden="true">GitHub</span></a>`
    : '';
  const hasActions = videoLinkHtml || slidesLinkHtml || githubLinkHtml;
  const speakerText = formatSpeakers(talk.speakers);
  const speakerLabel = speakerText ? ` by ${speakerText}` : '';
  const speakerNames = (talk.speakers || []).map((speaker) => speaker.name).filter(Boolean);
  const speakersHtml = renderEntityLinks(speakerNames, 'speaker');

  return `
    <article class="talk-card">
      <a href="talks/talk.html?id=${escapeHtml(talk.id || '')}" class="card-link-wrap" aria-label="${titleEsc}${escapeHtml(speakerLabel)}">
        <div class="card-thumbnail" aria-hidden="true">
          ${thumbnailHtml}
          ${talk.videoId ? `<div class="play-overlay" aria-hidden="true"><div class="play-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg></div></div>` : ''}
        </div>
        <div class="card-body">
          <div class="card-meta">
            <span class="${badgeCls}">${escapeHtml(categoryLabel(talk.category || 'other'))}</span>
            <span class="meeting-label">${escapeHtml(meetingLabel)}</span>
          </div>
          <p class="card-title">${highlightText(talk.title || 'Untitled talk', tokens)}</p>
          ${abstractPreview ? `<p class="card-abstract">${highlightText(abstractPreview, tokens)}</p>` : ''}
        </div>
      </a>
      ${speakersHtml ? `<p class="card-speakers">${speakersHtml}</p>` : ''}
      ${renderTagLinks(getTalkKeyTopics(talk, 8))}
      ${hasActions ? `<div class="card-footer">${videoLinkHtml}${slidesLinkHtml}${githubLinkHtml}</div>` : ''}
    </article>`;
}

function renderPaperCard(paper) {
  const query = state.mode === 'search' ? state.query : '';
  const tokens = query ? tokenizeQuery(query) : [];
  const blogEntry = isBlogPaper(paper);
  const listingFrom = blogEntry ? 'blogs' : 'papers';
  const titleEsc = escapeHtml(paper.title || 'Untitled paper');
  const authorLabel = (paper.authors || []).map((author) => String(author.name || '').trim()).filter(Boolean).join(', ');
  const venue = escapeHtml(paper.publication || paper.venue || toTitleCaseSlug(paper.type || 'paper'));
  const year = escapeHtml(paper._year || 'Unknown year');
  const previewSource = getPaperPreviewSource(paper);
  const abstractText = buildContextSnippet(previewSource, query, 340)
    || (blogEntry ? 'No blog excerpt available.' : 'No abstract available.');
  const authorNames = (paper.authors || []).map((author) => author.name).filter(Boolean);
  const authorsHtml = renderEntityLinks(authorNames, 'speaker');
  const topics = getPaperKeyTopics(paper, 8);
  const paperIsPdf = isDirectPdfUrl(paper.paperUrl || '');
  const sourceIsPdf = isDirectPdfUrl(paper.sourceUrl || '');
  const sourceHref = sanitizeExternalUrl(paper.sourceUrl);
  const paperHref = sanitizeExternalUrl(paper.paperUrl);
  const sourceLink = !blogEntry && sourceIsPdf && !paperIsPdf && sourceHref && sourceHref !== paperHref
    ? `<a href="${escapeHtml(sourceHref)}" class="card-link-btn" target="_blank" rel="noopener noreferrer" aria-label="Open PDF for ${titleEsc} (opens in new tab)"><span aria-hidden="true">PDF</span></a>`
    : '';
  const paperActionLabel = blogEntry ? 'Post' : (paperIsPdf ? 'PDF' : 'Paper');
  const paperLink = paperHref
    ? `<a href="${escapeHtml(paperHref)}" class="card-link-btn card-link-btn--video" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHtml(paperActionLabel)} for ${titleEsc} (opens in new tab)"><span aria-hidden="true">${escapeHtml(paperActionLabel)}</span></a>`
    : '';
  const citationCount = Number.isFinite(paper._citationCount) ? paper._citationCount : 0;
  const citationHtml = citationCount > 0
    ? `<span class="paper-citation-count" aria-label="${citationCount.toLocaleString()} citations">${citationCount.toLocaleString()} citation${citationCount === 1 ? '' : 's'}</span>`
    : '';

  return `
    <article class="talk-card paper-card">
      <a href="papers/paper.html?id=${escapeHtml(paper.id || '')}&from=${listingFrom}" class="card-link-wrap" aria-label="${titleEsc}${authorLabel ? ` by ${escapeHtml(authorLabel)}` : ''}">
        <div class="card-body">
          <div class="card-meta">
            <span class="badge ${blogEntry ? 'badge-blog' : 'badge-paper'}">${blogEntry ? 'Blog' : 'Paper'}</span>
            <span class="meeting-label">${year}</span>
            <span class="meeting-label">${venue}</span>
          </div>
          <p class="card-title">${highlightText(paper.title || 'Untitled paper', tokens)}</p>
          <p class="card-abstract">${highlightText(abstractText, tokens)}</p>
        </div>
      </a>
      ${authorsHtml ? `<p class="card-speakers paper-authors">${authorsHtml}</p>` : ''}
      ${renderTagLinks(topics)}
      ${(paperLink || sourceLink || citationHtml) ? `<div class="card-footer">${paperLink}${sourceLink}${citationHtml}</div>` : ''}
    </article>`;
}

function renderUniversalCard(entry) {
  if (!entry || typeof entry !== 'object') return '';
  if (entry.kind === 'talk' && entry.talk) return renderTalkCard(entry.talk);
  if ((entry.kind === 'paper' || entry.kind === 'blog') && entry.paper) return renderPaperCard(entry.paper);
  return '';
}

function setEmptyState(gridId, label) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  grid.setAttribute('aria-busy', 'false');
  const scopeValue = state.mode === 'search' ? state.query : state.value;
  const scope = scopeValue ? ` for "${escapeHtml(scopeValue)}"` : '';
  grid.innerHTML = `<div class="work-empty-state">No ${escapeHtml(label)} found${scope}.</div>`;
}

function renderUniversalBatch(reset = false) {
  const grid = document.getElementById('work-universal-grid');
  const moreBtn = document.getElementById('work-universal-more');
  if (!grid || !moreBtn) return;

  if (reset) {
    grid.innerHTML = '';
    renderedUniversalCount = 0;
  }

  if (!filteredUniversal.length) {
    moreBtn.classList.add('hidden');
    setEmptyState('work-universal-grid', 'results');
    return;
  }

  const nextCount = Math.min(renderedUniversalCount + UNIVERSAL_BATCH_SIZE, filteredUniversal.length);
  const html = filteredUniversal.slice(renderedUniversalCount, nextCount).map(renderUniversalCard).join('');
  grid.insertAdjacentHTML('beforeend', html);
  grid.setAttribute('aria-busy', 'false');
  renderedUniversalCount = nextCount;

  const remaining = filteredUniversal.length - renderedUniversalCount;
  if (remaining > 0) {
    moreBtn.textContent = `Show more results (${remaining.toLocaleString()} left)`;
    moreBtn.classList.remove('hidden');
  } else {
    moreBtn.classList.add('hidden');
  }
}

function renderTalkBatch(reset = false) {
  const grid = document.getElementById('work-talks-grid');
  const moreBtn = document.getElementById('work-talks-more');
  if (!grid || !moreBtn) return;

  if (reset) {
    grid.innerHTML = '';
    renderedTalkCount = 0;
  }

  if (!filteredTalks.length) {
    moreBtn.classList.add('hidden');
    setEmptyState('work-talks-grid', 'talks');
    return;
  }

  const nextCount = Math.min(renderedTalkCount + TALK_BATCH_SIZE, filteredTalks.length);
  const html = filteredTalks.slice(renderedTalkCount, nextCount).map(renderTalkCard).join('');
  grid.insertAdjacentHTML('beforeend', html);
  grid.setAttribute('aria-busy', 'false');
  renderedTalkCount = nextCount;

  const remaining = filteredTalks.length - renderedTalkCount;
  if (remaining > 0) {
    moreBtn.textContent = `Show more talks (${remaining.toLocaleString()} left)`;
    moreBtn.classList.remove('hidden');
  } else {
    moreBtn.classList.add('hidden');
  }
}

function renderPaperBatch(reset = false) {
  const grid = document.getElementById('work-papers-grid');
  const moreBtn = document.getElementById('work-papers-more');
  if (!grid || !moreBtn) return;

  if (reset) {
    grid.innerHTML = '';
    renderedPaperCount = 0;
  }

  if (!filteredPapers.length) {
    moreBtn.classList.add('hidden');
    setEmptyState('work-papers-grid', 'papers');
    return;
  }

  const nextCount = Math.min(renderedPaperCount + PAPER_BATCH_SIZE, filteredPapers.length);
  const html = filteredPapers.slice(renderedPaperCount, nextCount).map(renderPaperCard).join('');
  grid.insertAdjacentHTML('beforeend', html);
  grid.setAttribute('aria-busy', 'false');
  renderedPaperCount = nextCount;

  const remaining = filteredPapers.length - renderedPaperCount;
  if (remaining > 0) {
    moreBtn.textContent = `Show more papers (${remaining.toLocaleString()} left)`;
    moreBtn.classList.remove('hidden');
  } else {
    moreBtn.classList.add('hidden');
  }
}

function renderBlogBatch(reset = false) {
  const grid = document.getElementById('work-blogs-grid');
  const moreBtn = document.getElementById('work-blogs-more');
  if (!grid || !moreBtn) return;

  if (reset) {
    grid.innerHTML = '';
    renderedBlogCount = 0;
  }

  if (!filteredBlogs.length) {
    moreBtn.classList.add('hidden');
    setEmptyState('work-blogs-grid', 'blogs');
    return;
  }

  const nextCount = Math.min(renderedBlogCount + BLOG_BATCH_SIZE, filteredBlogs.length);
  const html = filteredBlogs.slice(renderedBlogCount, nextCount).map(renderPaperCard).join('');
  grid.insertAdjacentHTML('beforeend', html);
  grid.setAttribute('aria-busy', 'false');
  renderedBlogCount = nextCount;

  const remaining = filteredBlogs.length - renderedBlogCount;
  if (remaining > 0) {
    moreBtn.textContent = `Show more blogs (${remaining.toLocaleString()} left)`;
    moreBtn.classList.remove('hidden');
  } else {
    moreBtn.classList.add('hidden');
  }
}

function setWorkDocumentTitle(value) {
  const title = String(value || '').trim();
  document.title = title ? `${title} — LLVM Research Library` : 'LLVM Research Library';
}

function applyHeaderState() {
  const titleEl = document.getElementById('work-title');
  const subtitleEl = document.getElementById('work-subtitle');
  const summaryEl = document.getElementById('work-results-summary');
  const universalCountEl = document.getElementById('work-universal-count');
  const talksCountEl = document.getElementById('work-talks-count');
  const papersCountEl = document.getElementById('work-papers-count');
  const blogsCountEl = document.getElementById('work-blogs-count');
  const backLink = document.getElementById('work-back-link');

  const entityLabel = state.kind === 'speaker' ? 'Speaker' : 'Key Topic';
  const backHref = state.from === 'papers'
    ? 'papers/'
    : (state.from === 'blogs'
      ? 'blogs/'
      : (state.from === 'people' ? 'people/' : 'talks/'));
  const backText = state.from === 'papers'
    ? 'Back to papers'
    : (state.from === 'blogs'
      ? 'Back to blogs'
      : (state.from === 'people' ? 'Back to people' : 'Back'));
  const showBackLink = state.mode !== 'search' && state.from !== 'work';

  if (backLink) {
    backLink.href = backHref;
    backLink.textContent = backText;
    backLink.hidden = !showBackLink;
  }

  if (state.mode === 'search') {
    if (!state.query) {
      if (titleEl) titleEl.textContent = 'Global Search';
      if (subtitleEl) subtitleEl.textContent = 'Use Global Search across talks, papers, and blogs from one place.';
      if (summaryEl) summaryEl.textContent = 'No search query provided';
      if (universalCountEl) universalCountEl.textContent = '';
      if (talksCountEl) talksCountEl.textContent = '';
      if (papersCountEl) papersCountEl.textContent = '';
      if (blogsCountEl) blogsCountEl.textContent = '';
      setWorkDocumentTitle('Global Search');
      return;
    }

    if (titleEl) titleEl.textContent = 'Global Search';
    if (subtitleEl) subtitleEl.innerHTML = `Results for <strong>${escapeHtml(state.query)}</strong>, ranked across talks, papers, and blogs`;
    setWorkDocumentTitle(`Global Search: ${state.query}`);
  } else {
    if (!state.value) {
      if (titleEl) titleEl.textContent = 'All Work';
      if (subtitleEl) subtitleEl.textContent = 'Choose a speaker or key topic from Talks, Papers, or Blogs to view all related work.';
      if (summaryEl) summaryEl.textContent = 'No speaker/key topic selected';
      if (universalCountEl) universalCountEl.textContent = '';
      if (talksCountEl) talksCountEl.textContent = '';
      if (papersCountEl) papersCountEl.textContent = '';
      if (blogsCountEl) blogsCountEl.textContent = '';
      setWorkDocumentTitle('All Work');
      return;
    }

    if (titleEl) titleEl.textContent = `${entityLabel}: ${state.value}`;
    if (subtitleEl) {
      if (state.kind === 'speaker') {
        subtitleEl.innerHTML = `All Work for <strong>${escapeHtml(state.value)}</strong> across talks and papers`;
      } else {
        subtitleEl.innerHTML = `All Work for key topic <strong>${escapeHtml(state.value)}</strong> across talks, papers, and blogs`;
      }
    }
    setWorkDocumentTitle(`All Work: ${entityLabel} ${state.value}`);
  }

  if (universalCountEl) {
    if (state.mode === 'search') {
      universalCountEl.textContent = `${filteredUniversal.length.toLocaleString()} result${filteredUniversal.length === 1 ? '' : 's'}`;
    } else {
      universalCountEl.textContent = '';
    }
  }

  if (talksCountEl) {
    talksCountEl.textContent = `${filteredTalks.length.toLocaleString()} talk${filteredTalks.length === 1 ? '' : 's'}`;
  }

  if (papersCountEl) {
    papersCountEl.textContent = `${filteredPapers.length.toLocaleString()} paper${filteredPapers.length === 1 ? '' : 's'}`;
  }

  if (blogsCountEl) {
    blogsCountEl.textContent = `${filteredBlogs.length.toLocaleString()} blog${filteredBlogs.length === 1 ? '' : 's'}`;
  }

  if (summaryEl) {
    const total = state.mode === 'search'
      ? filteredUniversal.length
      : (filteredTalks.length + filteredPapers.length + filteredBlogs.length);
    const sortLabel = state.sortBy === 'relevance'
      ? (state.mode === 'search' ? 'cross-type relevance' : 'relevance')
      : state.sortBy === 'oldest'
        ? 'oldest'
        : state.sortBy === 'title'
          ? 'title'
          : state.sortBy === 'citations'
            ? 'citations'
            : 'newest';
    const densityLabel = state.viewMode === 'compact' ? 'compact' : 'expanded';
    summaryEl.innerHTML = `<strong>${total.toLocaleString()}</strong> total results · ${filteredTalks.length.toLocaleString()} talks · ${filteredPapers.length.toLocaleString()} papers · ${filteredBlogs.length.toLocaleString()} blogs · Sorted by ${sortLabel} · ${densityLabel} view`;
  }
}

function syncSortControl() {
  const select = document.getElementById('work-sort-select');
  if (!select) return;
  const relevanceOption = select.querySelector('option[value="relevance"]');
  if (relevanceOption) relevanceOption.disabled = state.mode !== 'search';
  select.value = normalizeSortMode(state.sortBy);
}

function syncViewControls() {
  const expandedBtn = document.getElementById('work-view-expanded');
  const compactBtn = document.getElementById('work-view-compact');
  const isCompact = state.viewMode === 'compact';

  if (expandedBtn) {
    expandedBtn.classList.toggle('active', !isCompact);
    expandedBtn.setAttribute('aria-pressed', !isCompact ? 'true' : 'false');
  }
  if (compactBtn) {
    compactBtn.classList.toggle('active', isCompact);
    compactBtn.setAttribute('aria-pressed', isCompact ? 'true' : 'false');
  }
}

function syncSearchSectionVisibility() {
  const searchMode = state.mode === 'search';
  const universalSection = document.getElementById('work-universal-section');
  const talksSection = document.getElementById('work-talks-section');
  const papersSection = document.getElementById('work-papers-section');
  const blogsSection = document.getElementById('work-blogs-section');

  if (universalSection) universalSection.classList.toggle('hidden', !searchMode);
  if (talksSection) talksSection.classList.toggle('hidden', searchMode);
  if (papersSection) papersSection.classList.toggle('hidden', searchMode);
  if (blogsSection) blogsSection.classList.toggle('hidden', searchMode);
}

function applyViewMode(mode, persist = true, refreshHeader = true) {
  state.viewMode = mode === 'compact' ? 'compact' : 'expanded';
  const gridClass = state.viewMode === 'compact' ? 'talks-list' : 'talks-grid';
  ['work-universal-grid', 'work-talks-grid', 'work-papers-grid', 'work-blogs-grid'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.className = gridClass;
  });
  syncViewControls();
  if (refreshHeader) applyHeaderState();

  if (persist) {
    localStorage.setItem(WORK_VIEW_STORAGE_KEY, state.viewMode);
  }
}

function rerenderWorkSections() {
  syncSearchSectionVisibility();
  applyHeaderState();
  if (state.mode === 'search') {
    renderUniversalBatch(true);
    return;
  }
  renderTalkBatch(true);
  renderPaperBatch(true);
  renderBlogBatch(true);
}

function initSortControl() {
  const select = document.getElementById('work-sort-select');
  if (!select) return;

  select.addEventListener('change', () => {
    state.sortBy = normalizeSortMode(select.value);
    syncSortControl();
    recomputeFilteredResults();
    rerenderWorkSections();
    syncUrlState();
  });

  syncSortControl();
}

function initViewControls() {
  const expandedBtn = document.getElementById('work-view-expanded');
  const compactBtn = document.getElementById('work-view-compact');

  if (expandedBtn) {
    expandedBtn.addEventListener('click', () => {
      applyViewMode('expanded');
      syncUrlState();
    });
  }

  if (compactBtn) {
    compactBtn.addEventListener('click', () => {
      applyViewMode('compact');
      syncUrlState();
    });
  }

  applyViewMode(state.viewMode, false, false);
}

function renderError(message) {
  const universalGrid = document.getElementById('work-universal-grid');
  const talksGrid = document.getElementById('work-talks-grid');
  const papersGrid = document.getElementById('work-papers-grid');
  const blogsGrid = document.getElementById('work-blogs-grid');
  const summaryEl = document.getElementById('work-results-summary');

  if (summaryEl) summaryEl.textContent = 'Could not load work results';

  const html = `<div class="work-empty-state">${escapeHtml(message)}</div>`;

  if (universalGrid) {
    universalGrid.setAttribute('aria-busy', 'false');
    universalGrid.innerHTML = html;
  }

  if (talksGrid) {
    talksGrid.setAttribute('aria-busy', 'false');
    talksGrid.innerHTML = html;
  }

  if (papersGrid) {
    papersGrid.setAttribute('aria-busy', 'false');
    papersGrid.innerHTML = html;
  }

  if (blogsGrid) {
    blogsGrid.setAttribute('aria-busy', 'false');
    blogsGrid.innerHTML = html;
  }
}

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
    if (menu.classList.contains('open')) closeMenu();
    else openMenu();
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
  nativeShareBtn.hidden = !supportsNativeShare;

  closeMenu();

  toggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (menu.classList.contains('open')) closeMenu();
    else openMenu();
  });

  if (supportsNativeShare) {
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
    link.addEventListener('click', closeMenu);
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

function initWorkHeroSearch() {
  const input = document.getElementById('work-search-input');
  const clearBtn = document.getElementById('work-search-clear');
  if (!input || !clearBtn) return;

  const syncClear = () => {
    const hasText = String(input.value || '').trim().length > 0;
    clearBtn.classList.toggle('visible', hasText);
  };

  input.addEventListener('input', syncClear);
  input.addEventListener('focus', syncClear);
  input.addEventListener('blur', () => {
    window.setTimeout(syncClear, 150);
  });

  clearBtn.addEventListener('click', (event) => {
    event.preventDefault();
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    syncClear();
  });

  syncClear();
}

async function init() {
  initTheme();
  initTextSize();
  initCustomizationMenu();
  initMobileNavMenu();
  initShareMenu();
  initWorkHeroSearch();
  parseStateFromUrl();
  initSortControl();
  initViewControls();
  syncSearchSectionVisibility();
  updateIssueContextForWork();
  syncGlobalSearchInput();

  if (state.mode === 'search' && !state.query) {
    applyHeaderState();
    setEmptyState('work-universal-grid', 'results');
    setEmptyState('work-talks-grid', 'talks');
    setEmptyState('work-papers-grid', 'papers');
    setEmptyState('work-blogs-grid', 'blogs');
    return;
  }

  if (state.mode === 'entity' && !state.value) {
    applyHeaderState();
    setEmptyState('work-universal-grid', 'results');
    setEmptyState('work-talks-grid', 'talks');
    setEmptyState('work-papers-grid', 'papers');
    setEmptyState('work-blogs-grid', 'blogs');
    return;
  }

  if (typeof window.loadEventData !== 'function' || typeof window.loadPaperData !== 'function') {
    renderError('Data loaders are unavailable on this page.');
    return;
  }

  try {
    const [eventPayload, paperPayload] = await Promise.all([
      window.loadEventData(),
      window.loadPaperData(),
    ]);

    const talks = typeof HubUtils.normalizeTalks === 'function'
      ? HubUtils.normalizeTalks(eventPayload.talks || [])
      : (Array.isArray(eventPayload.talks) ? eventPayload.talks : []);

    const papers = Array.isArray(paperPayload.papers)
      ? paperPayload.papers.map(normalizePaperRecord).filter(Boolean)
      : [];
    const paperOnly = papers.filter((paper) => !isBlogPaper(paper));
    const blogsOnly = papers.filter((paper) => isBlogPaper(paper));
    allTalkRecords = talks;
    allPaperRecords = paperOnly;
    allBlogRecords = blogsOnly;
    recomputeFilteredResults();
    rerenderWorkSections();

    const talksMoreBtn = document.getElementById('work-talks-more');
    const papersMoreBtn = document.getElementById('work-papers-more');
    const blogsMoreBtn = document.getElementById('work-blogs-more');
    const universalMoreBtn = document.getElementById('work-universal-more');

    if (universalMoreBtn) universalMoreBtn.addEventListener('click', () => renderUniversalBatch(false));
    if (talksMoreBtn) talksMoreBtn.addEventListener('click', () => renderTalkBatch(false));
    if (papersMoreBtn) papersMoreBtn.addEventListener('click', () => renderPaperBatch(false));
    if (blogsMoreBtn) blogsMoreBtn.addEventListener('click', () => renderBlogBatch(false));
  } catch (error) {
    renderError(`Could not load data: ${String(error && error.message ? error.message : error)}`);
  }
}

init();

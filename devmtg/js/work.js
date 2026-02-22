/**
 * work.js — Unified talks + papers + blogs view for a selected speaker/topic.
 */

const HubUtils = window.LLVMHubUtils || {};

const TALK_BATCH_SIZE = 24;
const PAPER_BATCH_SIZE = 24;
const BLOG_BATCH_SIZE = 24;
const BLOG_SOURCE_SLUGS = new Set(['llvm-blog-www', 'llvm-www-blog']);

const state = {
  mode: 'entity', // 'entity' | 'search'
  kind: 'topic', // 'speaker' | 'topic'
  value: '',
  query: '',
  from: 'talks', // 'talks' | 'papers' | 'blogs' | 'people' | 'work'
};

const CATEGORY_META = {
  keynote: { label: 'Keynote' },
  'technical-talk': { label: 'Technical Talk' },
  tutorial: { label: 'Tutorial' },
  panel: { label: 'Panel' },
  'quick-talk': { label: 'Quick Talk' },
  'lightning-talk': { label: 'Lightning Talk' },
  'student-talk': { label: 'Student Technical Talk' },
  bof: { label: 'BoF' },
  poster: { label: 'Poster' },
  workshop: { label: 'Workshop' },
  other: { label: 'Other' },
};

let filteredTalks = [];
let filteredPapers = [];
let filteredBlogs = [];
let renderedTalkCount = 0;
let renderedPaperCount = 0;
let renderedBlogCount = 0;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setIssueContext(context) {
  if (typeof window.setLibraryIssueContext !== 'function') return;
  if (!context || typeof context !== 'object') return;
  window.setLibraryIssueContext(context);
}

function normalizeValue(value) {
  return String(value || '').trim().toLowerCase();
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
    .replace(/[^a-z0-9]+/g, '');
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

function highlightText(text, tokens) {
  if (!tokens || tokens.length === 0) return escapeHtml(text);
  let result = escapeHtml(text);
  for (const token of tokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
  }
  return result;
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

function buildWorkUrl(kind, value) {
  const params = new URLSearchParams();
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
  const isSearchMode = modeParam === 'search' || (!hasEntityContext && !!queryParam);

  state.kind = kind;
  state.mode = isSearchMode ? 'search' : 'entity';
  state.query = isSearchMode ? queryParam : '';
  state.value = isSearchMode ? '' : String(valueParam || queryParam || '').trim();
  state.from = from;
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
  paper.publication = String(paper.publication || '').trim();
  paper.venue = String(paper.venue || '').trim();
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

function comparePapersNewestFirst(a, b) {
  const yearDiff = String(b._year || '').localeCompare(String(a._year || ''));
  if (yearDiff !== 0) return yearDiff;

  const titleDiff = String(a.title || '').localeCompare(String(b.title || ''));
  if (titleDiff !== 0) return titleDiff;

  return String(a.id || '').localeCompare(String(b.id || ''));
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

function matchesTalkEntity(talk, normalizedNeedle) {
  if (state.kind === 'speaker') {
    return (talk.speakers || []).some((speaker) => samePersonName(speaker.name, state.value));
  }

  return getTalkKeyTopics(talk).some((topic) => normalizeValue(topic) === normalizedNeedle);
}

function matchesPaperEntity(paper, normalizedNeedle) {
  if (state.kind === 'speaker') {
    return (paper.authors || []).some((author) => samePersonName(author.name, state.value));
  }

  return [...(paper.tags || []), ...(paper.keywords || [])]
    .some((tag) => normalizeValue(tag) === normalizedNeedle);
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
  const tokens = state.mode === 'search' ? tokenizeQuery(state.query) : [];
  const titleEsc = escapeHtml(talk.title || 'Untitled talk');
  const abstractPreview = talk.abstract ? talk.abstract.slice(0, 300) : '';
  const thumbnailUrl = talk.videoId
    ? `https://img.youtube.com/vi/${talk.videoId}/hqdefault.jpg`
    : '';
  const meetingLabel = talk.meetingName || (talk._year || talk.meeting?.slice(0, 4) || '');
  const badgeCls = `badge badge-${escapeHtml(talk.category || 'other')}`;
  const placeholderHtml = `<div class="card-thumbnail-placeholder">${placeholderSvgForTalk(talk)}</div>`;
  const thumbnailHtml = thumbnailUrl
    ? `<img src="${escapeHtml(thumbnailUrl)}" alt="" loading="lazy" onerror="thumbnailError(this,'${escapeHtml(talk.category || '')}')">`
    : placeholderHtml;
  const videoMeta = getVideoLinkMeta(talk.videoUrl, titleEsc);
  const videoIcon = videoMeta.icon === 'download'
    ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 21h16"/></svg>`
    : videoMeta.icon === 'tv'
      ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2" ry="2"/><line x1="8" y1="20" x2="16" y2="20"/><line x1="12" y1="17" x2="12" y2="20"/></svg>`
      : `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  const videoLinkHtml = talk.videoUrl
    ? `<a href="${escapeHtml(talk.videoUrl)}" class="card-link-btn card-link-btn--video" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(videoMeta.ariaLabel)}">${videoIcon}<span aria-hidden="true">${escapeHtml(videoMeta.text)}</span></a>`
    : '';
  const slidesLinkHtml = talk.slidesUrl
    ? `<a href="${escapeHtml(talk.slidesUrl)}" class="card-link-btn" target="_blank" rel="noopener noreferrer" aria-label="View slides: ${titleEsc} (opens in new tab)"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span aria-hidden="true">Slides</span></a>`
    : '';
  const githubLinkHtml = talk.projectGithub
    ? `<a href="${escapeHtml(talk.projectGithub)}" class="card-link-btn" target="_blank" rel="noopener noreferrer" aria-label="GitHub repository: ${titleEsc} (opens in new tab)"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg><span aria-hidden="true">GitHub</span></a>`
    : '';
  const hasActions = videoLinkHtml || slidesLinkHtml || githubLinkHtml;
  const speakerText = formatSpeakers(talk.speakers);
  const speakerLabel = speakerText ? ` by ${speakerText}` : '';
  const speakerNames = (talk.speakers || []).map((speaker) => speaker.name).filter(Boolean);
  const speakersHtml = renderEntityLinks(speakerNames, 'speaker');

  return `
    <article class="talk-card">
      <a href="talk.html?id=${escapeHtml(talk.id || '')}" class="card-link-wrap" aria-label="${titleEsc}${escapeHtml(speakerLabel)}">
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
  const tokens = state.mode === 'search' ? tokenizeQuery(state.query) : [];
  const blogEntry = isBlogPaper(paper);
  const listingFrom = blogEntry ? 'blogs' : 'papers';
  const titleEsc = escapeHtml(paper.title || 'Untitled paper');
  const authorLabel = (paper.authors || []).map((author) => String(author.name || '').trim()).filter(Boolean).join(', ');
  const venue = escapeHtml(paper.publication || paper.venue || toTitleCaseSlug(paper.type || 'paper'));
  const year = escapeHtml(paper._year || 'Unknown year');
  const abstractText = paper.abstract || (blogEntry ? 'No blog excerpt available.' : 'No abstract available.');
  const authorNames = (paper.authors || []).map((author) => author.name).filter(Boolean);
  const authorsHtml = renderEntityLinks(authorNames, 'speaker');
  const topics = getPaperKeyTopics(paper, 8);
  const sourceIsPdf = /\.pdf(?:$|[?#])/i.test(paper.sourceUrl || '');
  const sourceLink = sourceIsPdf && paper.sourceUrl !== paper.paperUrl
    ? `<a href="${escapeHtml(paper.sourceUrl)}" class="card-link-btn" target="_blank" rel="noopener noreferrer" aria-label="Open alternate PDF for ${titleEsc} (opens in new tab)"><span aria-hidden="true">Source</span></a>`
    : '';
  const isPdf = /\.pdf(?:$|[?#])/i.test(paper.paperUrl || '');
  const paperActionLabel = blogEntry ? 'Post' : (isPdf ? 'PDF' : 'Paper');
  const paperLink = paper.paperUrl
    ? `<a href="${escapeHtml(paper.paperUrl)}" class="card-link-btn card-link-btn--video" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHtml(paperActionLabel)} for ${titleEsc} (opens in new tab)"><span aria-hidden="true">${escapeHtml(paperActionLabel)}</span></a>`
    : '';
  const citationCount = Number.isFinite(paper._citationCount) ? paper._citationCount : 0;
  const citationHtml = citationCount > 0
    ? `<span class="paper-citation-count" aria-label="${citationCount.toLocaleString()} citations">${citationCount.toLocaleString()} citation${citationCount === 1 ? '' : 's'}</span>`
    : '';

  return `
    <article class="talk-card paper-card">
      <a href="paper.html?id=${escapeHtml(paper.id || '')}&from=${listingFrom}" class="card-link-wrap" aria-label="${titleEsc}${authorLabel ? ` by ${escapeHtml(authorLabel)}` : ''}">
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

function setEmptyState(gridId, label) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  grid.setAttribute('aria-busy', 'false');
  const scopeValue = state.mode === 'search' ? state.query : state.value;
  const scope = scopeValue ? ` for "${escapeHtml(scopeValue)}"` : '';
  grid.innerHTML = `<div class="work-empty-state">No ${escapeHtml(label)} found${scope}.</div>`;
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

function applyHeaderState() {
  const titleEl = document.getElementById('work-title');
  const subtitleEl = document.getElementById('work-subtitle');
  const summaryEl = document.getElementById('work-results-summary');
  const talksCountEl = document.getElementById('work-talks-count');
  const papersCountEl = document.getElementById('work-papers-count');
  const blogsCountEl = document.getElementById('work-blogs-count');
  const backLink = document.getElementById('work-back-link');

  const entityLabel = state.kind === 'speaker' ? 'Speaker' : 'Key Topic';
  const backHref = state.from === 'papers'
    ? 'papers.html'
    : (state.from === 'blogs'
      ? 'blogs.html'
      : (state.from === 'people' ? 'people.html' : 'talks/'));
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
      if (subtitleEl) subtitleEl.textContent = 'Search talks, papers, and blogs from one place.';
      if (summaryEl) summaryEl.textContent = 'No search query provided';
      if (talksCountEl) talksCountEl.textContent = '';
      if (papersCountEl) papersCountEl.textContent = '';
      if (blogsCountEl) blogsCountEl.textContent = '';
      return;
    }

    if (titleEl) titleEl.textContent = 'Global Search';
    if (subtitleEl) subtitleEl.innerHTML = `Results for <strong>${escapeHtml(state.query)}</strong> across talks, papers, and blogs`;
  } else {
    if (!state.value) {
      if (titleEl) titleEl.textContent = 'All Work';
      if (subtitleEl) subtitleEl.textContent = 'Choose a speaker or key topic from Talks, Papers, or Blogs to view all related work.';
      if (summaryEl) summaryEl.textContent = 'No speaker/key topic selected';
      if (talksCountEl) talksCountEl.textContent = '';
      if (papersCountEl) papersCountEl.textContent = '';
      if (blogsCountEl) blogsCountEl.textContent = '';
      return;
    }

    if (titleEl) titleEl.textContent = `${entityLabel}: ${state.value}`;
    if (subtitleEl) {
      if (state.kind === 'speaker') {
        subtitleEl.innerHTML = `Showing talks and papers for <strong>${escapeHtml(state.value)}</strong>`;
      } else {
        subtitleEl.innerHTML = `Showing talks, papers, and blogs for <strong>${escapeHtml(state.value)}</strong>`;
      }
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
    const total = filteredTalks.length + filteredPapers.length + filteredBlogs.length;
    summaryEl.innerHTML = `<strong>${total.toLocaleString()}</strong> total results · ${filteredTalks.length.toLocaleString()} talks · ${filteredPapers.length.toLocaleString()} papers · ${filteredBlogs.length.toLocaleString()} blogs`;
  }
}

function renderError(message) {
  const talksGrid = document.getElementById('work-talks-grid');
  const papersGrid = document.getElementById('work-papers-grid');
  const blogsGrid = document.getElementById('work-blogs-grid');
  const summaryEl = document.getElementById('work-results-summary');

  if (summaryEl) summaryEl.textContent = 'Could not load all work';

  const html = `<div class="work-empty-state">${escapeHtml(message)}</div>`;

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
  updateIssueContextForWork();
  syncGlobalSearchInput();

  if (state.mode === 'search' && !state.query) {
    applyHeaderState();
    setEmptyState('work-talks-grid', 'talks');
    setEmptyState('work-papers-grid', 'papers');
    setEmptyState('work-blogs-grid', 'blogs');
    return;
  }

  if (state.mode === 'entity' && !state.value) {
    applyHeaderState();
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

    if (state.mode === 'search') {
      filteredTalks = rankTalksForQuery(talks, state.query);
      filteredPapers = rankPapersForQuery(paperOnly, state.query);
      filteredBlogs = rankPapersForQuery(blogsOnly, state.query);
    } else {
      const normalizedNeedle = normalizeValue(state.value);
      filteredTalks = talks
        .filter((talk) => matchesTalkEntity(talk, normalizedNeedle))
        .sort(compareTalksNewestFirst);

      filteredPapers = paperOnly
        .filter((paper) => matchesPaperEntity(paper, normalizedNeedle))
        .sort(comparePapersNewestFirst);

      filteredBlogs = blogsOnly
        .filter((paper) => matchesPaperEntity(paper, normalizedNeedle))
        .sort(comparePapersNewestFirst);
    }

    applyHeaderState();
    renderTalkBatch(true);
    renderPaperBatch(true);
    renderBlogBatch(true);

    const talksMoreBtn = document.getElementById('work-talks-more');
    const papersMoreBtn = document.getElementById('work-papers-more');
    const blogsMoreBtn = document.getElementById('work-blogs-more');

    if (talksMoreBtn) talksMoreBtn.addEventListener('click', () => renderTalkBatch(false));
    if (papersMoreBtn) papersMoreBtn.addEventListener('click', () => renderPaperBatch(false));
    if (blogsMoreBtn) blogsMoreBtn.addEventListener('click', () => renderBlogBatch(false));
  } catch (error) {
    renderError(`Could not load data: ${String(error && error.message ? error.message : error)}`);
  }
}

init();

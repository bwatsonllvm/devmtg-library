/**
 * work.js — Unified talks + papers + blogs + docs + people view for search/entity pages.
 */

const HubUtils = window.LLVMHubUtils;
if (!HubUtils || typeof HubUtils !== 'object') {
  throw new Error('LLVMHubUtils is required before loading work.js');
}

function requireHubFunction(name) {
  const fn = HubUtils[name];
  if (typeof fn !== 'function') {
    throw new Error(`LLVMHubUtils.${name} is required by work.js`);
  }
  return fn.bind(HubUtils);
}

const createPageShell = requireHubFunction('createPageShell');
const normalizePersonKeyFromHub = requireHubFunction('normalizePersonKey');
const arePersonMiddleVariants = requireHubFunction('arePersonMiddleVariants');
const normalizePersonDisplayNameFromHub = requireHubFunction('normalizePersonDisplayName');
const getTalkKeyTopicsFromHub = requireHubFunction('getTalkKeyTopics');
const getPaperKeyTopicsFromHub = requireHubFunction('getPaperKeyTopics');
const buildSearchSnippet = requireHubFunction('buildSearchSnippet');
const highlightSearchTextFromHub = requireHubFunction('highlightSearchText');
const normalizePersonRecord = requireHubFunction('normalizePersonRecord');
const tokenizeQueryFromHub = requireHubFunction('tokenizeQuery');
const buildSearchQueryModel = requireHubFunction('buildSearchQueryModel');
const scoreTalkRecordByModel = requireHubFunction('scoreTalkRecordByModel');
const scorePaperRecordByModel = requireHubFunction('scorePaperRecordByModel');
const composeCrossTypeRelevance = requireHubFunction('composeCrossTypeRelevance');
const rankTalksByQuery = requireHubFunction('rankTalksByQuery');
const rankPaperRecordsByQuery = requireHubFunction('rankPaperRecordsByQuery');
const buildPeopleIndex = requireHubFunction('buildPeopleIndex');
const normalizeTalksFromHub = requireHubFunction('normalizeTalks');

const PageShell = createPageShell();
if (!PageShell || typeof PageShell !== 'object') {
  throw new Error('LLVMHubUtils.createPageShell() returned an invalid object');
}

function requirePageShellMethod(name) {
  const fn = PageShell[name];
  if (typeof fn !== 'function') {
    throw new Error(`PageShell.${name} is required by work.js`);
  }
  return fn.bind(PageShell);
}

const safeStorageGet = requirePageShellMethod('safeStorageGet');
const safeStorageSet = requirePageShellMethod('safeStorageSet');
const initTheme = requirePageShellMethod('initTheme');
const initTextSize = requirePageShellMethod('initTextSize');
const initCustomizationMenu = requirePageShellMethod('initCustomizationMenu');
const initShareMenu = requirePageShellMethod('initShareMenu');
const initMobileNavMenu = requirePageShellMethod('initMobileNavMenu');

const TALK_BATCH_SIZE = 24;
const PAPER_BATCH_SIZE = 24;
const BLOG_BATCH_SIZE = 24;
const DOCS_BATCH_SIZE = 24;
const PEOPLE_BATCH_SIZE = 24;
const UNIVERSAL_BATCH_SIZE = 36;
const BLOG_SOURCE_SLUGS = new Set(['llvm-blog-www', 'llvm-www-blog']);
const DIRECT_PDF_URL_RE = /\.pdf(?:$|[?#])|\/pdf(?:$|[/?#])|[?&](?:format|type|output)=pdf(?:$|[&#])|[?&]filename=[^&#]*\.pdf(?:$|[&#])/i;
const WORK_SORT_MODES = new Set(['relevance', 'newest', 'oldest', 'title', 'citations']);
const WORK_VIEW_MODES = new Set(['expanded', 'compact']);
const WORK_VIEW_STORAGE_KEY = 'llvm-hub-work-view';
const WORK_SEARCH_SCOPES = new Set(['all', 'talks', 'papers', 'blogs', 'docs', 'people']);
const WORK_FROM_VALUES = new Set(['talks', 'papers', 'blogs', 'people', 'work']);
const WORK_TIME_FILTERS = new Set(['any', 'since-2026', 'since-2025', 'since-2022', 'custom']);
const WORK_ADVANCED_WHERE_MODES = new Set(['anywhere', 'title', 'abstract']);
const WORK_YEAR_MIN = 1990;
const WORK_YEAR_MAX = 2100;
const UNIVERSAL_FALLBACK_PER_KIND_LIMIT = 240;
const UNIVERSAL_MAX_RESULTS = 1200;
const DOCS_UNIVERSAL_INDEX_SRC = 'docs/_static/docs-universal-search-index.js?v=1e667af80c5f';
const CLANG_DOCS_UNIVERSAL_INDEX_SRC = 'docs/clang/_static/docs-universal-search-index.js?v=9fb48ac24824';
const LLDB_DOCS_UNIVERSAL_INDEX_SRC = 'docs/lldb/_static/docs-universal-search-index.js?v=eba40672f6e7';
const DOCS_UNIVERSAL_SEARCH_LIMIT = 420;
const DOCS_BEGINNER_STRONG_RE = /\bbeginner(?:s)?\b|\bfor beginners\b|\bgetting started\b|\bbasics\b|\btutorial(?:s)?\b|\bbeginner[- ]friendly\b/;
const DOCS_BEGINNER_INTRO_RE = /\bintro(?:duction)?(?:\s+to)?\b|\bintroductory\b/;
const DOCS_BEGINNER_AMBIGUOUS_RE = DOCS_BEGINNER_INTRO_RE;
const DOCS_BEGINNER_ADVANCED_RE = /\badvanced\b|\binternals?\b|\bdeep dive\b|\bexpert\b|\breference\b|\bspec(?:ification)?\b/;
const DOCS_BEGINNER_FALSE_POSITIVE_RE = /\bbasic block(?:s)?\b|\bbasic-block(?:s)?\b/g;
const DOCS_FUNDAMENTALS_SIGNAL_RE = /\bfundamentals?\b|\boverview\b|\btutorial(?:s)?\b|\bwalkthrough\b|\bguide\b|\blearn\b|\bintro(?:duction)?\b|\bgetting started\b|\bbasics\b/;
const DOCS_ADVANCED_RESEARCH_SIGNAL_RE = /\badvanced\b|\binternals?\b|\bdeep dive\b|\breference\b|\bspec(?:ification)?\b|\bresearch\b|\bbenchmark(?:ing)?\b|\bevaluation\b|\banalysis\b|\bstate of the art\b/;
const DOCS_SUBPROJECT_TOPIC_PATTERNS = Object.freeze({
  LLVM: /\bllvm\b/,
  Clang: /\bclang(?:d)?\b/,
  'clang-tools-extra': /\bclang[- ]tools[- ]extra\b|\bclang[- ](?:tidy|format|query)\b/,
  MLIR: /\bmlir\b|\bmulti[- ]level intermediate representation\b/,
  Flang: /\bflang\b/,
  LLD: /\blld\b/,
  LLDB: /\blldb\b/,
  CIRCT: /\bcirct\b/,
  Polly: /\bpolly\b/,
  OpenMP: /\bopenmp\b|\blibomp\b/,
  'compiler-rt': /\bcompiler[- ]?rt\b|\blibfuzzer\b/,
  'libc++': /\blibc\+\+\b/,
  'libc++abi': /\blibc\+\+abi\b|\blibcxxabi\b/,
  libc: /\blibc\b/,
  BOLT: /\bbolt\b/,
  'orc-rt': /\borc[- ]?rt\b/,
  'ORC JIT': /\borc(?:\s*jit)?\b/,
  ClangIR: /\bclangir\b|\bclang\s+ir\b/,
});

const state = {
  mode: 'entity', // 'entity' | 'search'
  scope: 'all', // 'all' | 'talks' | 'papers' | 'blogs' | 'docs' | 'people' (search mode only)
  kind: 'topic', // 'speaker' | 'topic'
  value: '',
  query: '',
  from: 'talks', // 'talks' | 'papers' | 'blogs' | 'people' | 'work'
  sortBy: 'relevance',
  viewMode: 'expanded',
  timeFilter: 'any', // search mode only
  yearFrom: 0, // search mode only
  yearTo: 0, // search mode only
  advancedOpen: false,
  advanced: {
    allWords: '',
    exactPhrase: '',
    anyWords: '',
    withoutWords: '',
    where: 'anywhere',
    author: '',
    publication: '',
  },
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
let filteredPeople = [];
let filteredUniversal = [];
let renderedTalkCount = 0;
let renderedPaperCount = 0;
let renderedBlogCount = 0;
let renderedDocsCount = 0;
let renderedPeopleCount = 0;
let renderedUniversalCount = 0;
let allTalkRecords = [];
let allPaperRecords = [];
let allBlogRecords = [];
let allPeopleRecords = [];
let allDocsRecords = [];
let filteredDocs = [];
let searchResultCounts = {
  all: 0,
  talks: 0,
  papers: 0,
  blogs: 0,
  docs: 0,
  people: 0,
};
let docsDataLoadPromise = null;
const QUERY_TOKEN_CACHE_MAX = 128;
const QUERY_TOKEN_CACHE = new Map();
const DOM_NODE_CACHE = new Map();

function getNodeById(id) {
  const key = String(id || '');
  if (!key) return null;
  const cached = DOM_NODE_CACHE.get(key);
  if (cached && cached.isConnected) return cached;
  const node = document.getElementById(key);
  if (node) DOM_NODE_CACHE.set(key, node);
  return node;
}

function ensureScript(src) {
  return new Promise((resolve, reject) => {
    const existing = [...document.querySelectorAll('script[src]')]
      .find((script) => {
        const scriptSrc = script.getAttribute('src') || '';
        return scriptSrcMatches(scriptSrc, src);
      });
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
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

function getScriptSrcVariants(value) {
  const raw = String(value || '').trim();
  if (!raw) return { full: '', base: '' };
  try {
    const parsed = new URL(raw, window.location.href);
    const full = parsed.toString();
    parsed.search = '';
    parsed.hash = '';
    return { full, base: parsed.toString() };
  } catch {
    const noHash = raw.split('#')[0];
    return { full: noHash, base: noHash.split('?')[0] };
  }
}

function scriptSrcMatches(candidateSrc, targetSrc) {
  const candidate = getScriptSrcVariants(candidateSrc);
  const target = getScriptSrcVariants(targetSrc);
  if (!candidate.full || !target.full) return false;
  return candidate.full === target.full || (candidate.base && candidate.base === target.base);
}

function isDocsUniversalPayload(payload) {
  return !!(payload && Array.isArray(payload.entries));
}

function readDocsUniversalPayload(globalName) {
  const payload = window[globalName];
  return isDocsUniversalPayload(payload) ? payload : null;
}

async function loadDocsUniversalPayloadFromScript(src, globalName) {
  try {
    await ensureScript(src);
    if (isDocsUniversalPayload(window.LLVMDocsUniversalSearchIndex)) {
      window[globalName] = window.LLVMDocsUniversalSearchIndex;
    }
  } catch {
    // Continue; docs search can still operate with whichever indexes loaded.
  }
  return readDocsUniversalPayload(globalName);
}

async function loadDocsUniversalRecords() {
  if (docsDataLoadPromise) return docsDataLoadPromise;

  docsDataLoadPromise = (async () => {
    let llvmPayload = readDocsUniversalPayload('LLVMCoreDocsUniversalSearchIndex');
    let clangPayload = readDocsUniversalPayload('LLVMClangDocsUniversalSearchIndex');
    let lldbPayload = readDocsUniversalPayload('LLVMLLDBDocsUniversalSearchIndex');

    if (!llvmPayload) {
      llvmPayload = await loadDocsUniversalPayloadFromScript(
        DOCS_UNIVERSAL_INDEX_SRC,
        'LLVMCoreDocsUniversalSearchIndex'
      );
    }

    if (!clangPayload) {
      clangPayload = await loadDocsUniversalPayloadFromScript(
        CLANG_DOCS_UNIVERSAL_INDEX_SRC,
        'LLVMClangDocsUniversalSearchIndex'
      );
    }

    if (!lldbPayload) {
      lldbPayload = await loadDocsUniversalPayloadFromScript(
        LLDB_DOCS_UNIVERSAL_INDEX_SRC,
        'LLVMLLDBDocsUniversalSearchIndex'
      );
    }

    if (llvmPayload) {
      window.LLVMDocsUniversalSearchIndex = llvmPayload;
    }

    const llvmEntries = llvmPayload
      ? llvmPayload.entries.map((entry, index) => normalizeDocsRecord(entry, index, 'docs'))
      : [];
    const clangEntries = clangPayload
      ? clangPayload.entries.map((entry, index) => normalizeDocsRecord(entry, index + llvmEntries.length, 'docs/clang'))
      : [];
    const lldbEntries = lldbPayload
      ? lldbPayload.entries.map((entry, index) => normalizeDocsRecord(entry, index + llvmEntries.length + clangEntries.length, 'docs/lldb'))
      : [];

    return [...llvmEntries, ...clangEntries, ...lldbEntries].filter(Boolean);
  })().catch(() => []);

  return docsDataLoadPromise;
}

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

function normalizeSearchScope(value) {
  const normalized = normalizeValue(value);
  return WORK_SEARCH_SCOPES.has(normalized) ? normalized : 'all';
}

function normalizeTimeFilter(value) {
  const normalized = normalizeValue(value);
  if (normalized === 'since2026') return 'since-2026';
  if (normalized === 'since2025') return 'since-2025';
  if (normalized === 'since2022') return 'since-2022';
  return WORK_TIME_FILTERS.has(normalized) ? normalized : 'any';
}

function normalizeAdvancedText(value, maxLength = 220) {
  const cleaned = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned.slice(0, maxLength);
}

function normalizeAdvancedWhere(value) {
  const normalized = normalizeValue(value);
  if (normalized === 'any' || normalized === 'all') return 'anywhere';
  if (normalized === 'intitle') return 'title';
  if (normalized === 'inabstract' || normalized === 'content') return 'abstract';
  return WORK_ADVANCED_WHERE_MODES.has(normalized) ? normalized : 'anywhere';
}

function parseYearFilterInput(value) {
  const year = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(year)) return 0;
  if (year < WORK_YEAR_MIN || year > WORK_YEAR_MAX) return 0;
  return year;
}

function normalizeYearRange(from, to) {
  const yearFrom = parseYearFilterInput(from);
  const yearTo = parseYearFilterInput(to);
  if (yearFrom > 0 && yearTo > 0 && yearFrom > yearTo) {
    return { from: yearTo, to: yearFrom };
  }
  return { from: yearFrom, to: yearTo };
}

function resolveTimeFilterWindow() {
  if (state.timeFilter === 'since-2026') return { from: 2026, to: 0 };
  if (state.timeFilter === 'since-2025') return { from: 2025, to: 0 };
  if (state.timeFilter === 'since-2022') return { from: 2022, to: 0 };
  if (state.timeFilter === 'custom') return normalizeYearRange(state.yearFrom, state.yearTo);
  return { from: 0, to: 0 };
}

function hasAdvancedSearchTerms() {
  return !!(
    state.advanced.allWords
    || state.advanced.exactPhrase
    || state.advanced.anyWords
    || state.advanced.withoutWords
    || state.advanced.author
    || state.advanced.publication
  );
}

function hasActiveSearchCriteria() {
  if (state.mode !== 'search') return false;
  if (state.query) return true;
  if (hasAdvancedSearchTerms()) return true;
  if (state.timeFilter !== 'any') return true;
  return false;
}

function buildAdvancedSearchOptions() {
  const timeWindow = resolveTimeFilterWindow();
  return {
    allWords: state.advanced.allWords,
    exactPhrase: state.advanced.exactPhrase,
    anyWords: state.advanced.anyWords,
    withoutWords: state.advanced.withoutWords,
    where: state.advanced.where,
    author: state.advanced.author,
    publication: state.advanced.publication,
    yearFrom: timeWindow.from,
    yearTo: timeWindow.to,
  };
}

function hasAdvancedSearchOptions(options) {
  const source = options && typeof options === 'object' ? options : {};
  return !!(
    source.allWords
    || source.exactPhrase
    || source.anyWords
    || source.withoutWords
    || source.author
    || source.publication
    || parseYearFilterInput(source.yearFrom) > 0
    || parseYearFilterInput(source.yearTo) > 0
  );
}

function buildSearchDisplayValue() {
  const parts = [];
  const query = String(state.query || '').trim();
  if (query) parts.push(query);
  if (state.advanced.exactPhrase) parts.push(`"${state.advanced.exactPhrase}"`);
  if (state.advanced.allWords) parts.push(`all: ${state.advanced.allWords}`);
  if (state.advanced.anyWords) parts.push(`any: ${state.advanced.anyWords}`);
  if (state.advanced.author) parts.push(`author: ${state.advanced.author}`);
  if (state.advanced.publication) parts.push(`publication: ${state.advanced.publication}`);
  return parts.join(' · ');
}

function defaultSortMode() {
  return state.mode === 'search' ? 'relevance' : 'newest';
}

function normalizeSortMode(value) {
  const normalized = normalizeValue(value);
  if (!WORK_SORT_MODES.has(normalized)) return defaultSortMode();
  if (state.mode !== 'search' && normalized === 'relevance') return 'newest';
  if (state.mode === 'search' && state.scope === 'talks' && normalized === 'citations') return 'newest';
  return normalized;
}

function normalizePersonKey(value) {
  return normalizePersonKeyFromHub(value);
}

function samePersonName(a, b) {
  const keyA = normalizePersonKey(a);
  const keyB = normalizePersonKey(b);
  if (!keyA || !keyB) return false;
  if (keyA === keyB) return true;
  return arePersonMiddleVariants(a, b);
}

function normalizePersonDisplayName(value) {
  return normalizePersonDisplayNameFromHub(value);
}

function getPersonVariantNames(person) {
  if (!person || typeof person !== 'object') return [];
  const candidates = [person.name, ...(Array.isArray(person.variantNames) ? person.variantNames : [])];
  const out = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const label = normalizePersonDisplayName(candidate);
    const key = normalizePersonKey(label);
    if (!label || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

function findPersonRecordByName(value) {
  const label = normalizePersonDisplayName(value);
  const key = normalizePersonKey(label);
  if (!label || !key) return null;
  return allPeopleRecords.find((person) => {
    for (const variant of getPersonVariantNames(person)) {
      if (normalizePersonKey(variant) === key) return true;
    }
    return false;
  }) || null;
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
  return getTalkKeyTopicsFromHub(talk, limit);
}

function getPaperKeyTopics(paper, limit = Infinity) {
  return getPaperKeyTopicsFromHub(paper, limit);
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
  const queryOrTokens = state.query && state.query.trim() ? state.query : tokens;
  return highlightSearchTextFromHub(text, queryOrTokens);
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

  if (query && query.length >= 2) {
    const snippet = buildSearchSnippet(text, query, { maxLength });
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
    paper && paper.bodyText,
    paper && paper.body,
    paper && paper.fullText,
    paper && paper.text,
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
  const scopeParam = normalizeSearchScope(params.get('scope'));
  const timeParam = normalizeTimeFilter(params.get('time'));
  const yearFromParam = parseYearFilterInput(params.get('yearFrom'));
  const yearToParam = parseYearFilterInput(params.get('yearTo'));
  const allWordsParam = normalizeAdvancedText(params.get('allWords'));
  const exactPhraseParam = normalizeAdvancedText(params.get('exactPhrase'));
  const anyWordsParam = normalizeAdvancedText(params.get('anyWords'));
  const withoutWordsParam = normalizeAdvancedText(params.get('withoutWords'));
  const whereParam = normalizeAdvancedWhere(params.get('where'));
  const authorParam = normalizeAdvancedText(params.get('author'));
  const publicationParam = normalizeAdvancedText(params.get('publication'));
  const modeParam = normalizeValue(params.get('mode'));
  const fromParam = normalizeValue(params.get('from'));
  const from = WORK_FROM_VALUES.has(fromParam) ? fromParam : 'talks';
  const hasEntityContext = Boolean(valueParam || kindParam);
  const explicitEntityMode = modeParam === 'entity';
  const hasAdvancedQueryContext = !!(
    allWordsParam
    || exactPhraseParam
    || anyWordsParam
    || withoutWordsParam
    || authorParam
    || publicationParam
    || timeParam !== 'any'
    || yearFromParam > 0
    || yearToParam > 0
  );
  const isSearchMode = modeParam === 'search'
    || (!explicitEntityMode && !hasEntityContext && (!!queryParam || hasAdvancedQueryContext));

  state.kind = kind;
  state.mode = isSearchMode ? 'search' : 'entity';
  state.scope = isSearchMode ? scopeParam : 'all';
  state.query = isSearchMode ? queryParam : '';
  state.value = isSearchMode ? '' : String(valueParam || queryParam || '').trim();
  state.timeFilter = isSearchMode ? timeParam : 'any';
  state.advanced = isSearchMode
    ? {
      allWords: allWordsParam,
      exactPhrase: exactPhraseParam,
      anyWords: anyWordsParam,
      withoutWords: withoutWordsParam,
      where: whereParam,
      author: authorParam,
      publication: publicationParam,
    }
    : {
      allWords: '',
      exactPhrase: '',
      anyWords: '',
      withoutWords: '',
      where: 'anywhere',
      author: '',
      publication: '',
    };
  state.advancedOpen = isSearchMode && (
    state.advanced.allWords
    || state.advanced.exactPhrase
    || state.advanced.anyWords
    || state.advanced.withoutWords
    || state.advanced.author
    || state.advanced.publication
    || state.advanced.where !== 'anywhere'
  );
  const normalizedYears = normalizeYearRange(yearFromParam, yearToParam);
  if (isSearchMode && state.timeFilter !== 'custom' && (normalizedYears.from > 0 || normalizedYears.to > 0)) {
    state.timeFilter = 'custom';
  }
  state.yearFrom = isSearchMode ? normalizedYears.from : 0;
  state.yearTo = isSearchMode ? normalizedYears.to : 0;
  if (state.timeFilter !== 'custom') {
    state.yearFrom = 0;
    state.yearTo = 0;
  }
  state.from = from;
  state.sortBy = normalizeSortMode(params.get('sort'));

  const urlView = params.get('view');
  if (urlView) {
    state.viewMode = normalizeViewMode(urlView);
  } else {
    const savedView = safeStorageGet(WORK_VIEW_STORAGE_KEY);
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
    if (state.scope !== 'all') params.set('scope', state.scope);
    if (state.timeFilter !== 'any') params.set('time', state.timeFilter);
    if (state.timeFilter === 'custom') {
      const normalizedYears = normalizeYearRange(state.yearFrom, state.yearTo);
      if (normalizedYears.from > 0) params.set('yearFrom', String(normalizedYears.from));
      if (normalizedYears.to > 0) params.set('yearTo', String(normalizedYears.to));
    }
    if (state.advanced.allWords) params.set('allWords', state.advanced.allWords);
    if (state.advanced.exactPhrase) params.set('exactPhrase', state.advanced.exactPhrase);
    if (state.advanced.anyWords) params.set('anyWords', state.advanced.anyWords);
    if (state.advanced.withoutWords) params.set('withoutWords', state.advanced.withoutWords);
    if (state.advanced.where !== 'anywhere') params.set('where', state.advanced.where);
    if (state.advanced.author) params.set('author', state.advanced.author);
    if (state.advanced.publication) params.set('publication', state.advanced.publication);
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
  const itemTitle = isSearch ? (buildSearchDisplayValue() || state.query) : state.value;

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

function getSearchScopeCount(scope) {
  if (scope === 'talks') return Number(searchResultCounts.talks || 0);
  if (scope === 'papers') return Number(searchResultCounts.papers || 0);
  if (scope === 'blogs') return Number(searchResultCounts.blogs || 0);
  if (scope === 'docs') return Number(searchResultCounts.docs || 0);
  if (scope === 'people') return Number(searchResultCounts.people || 0);
  return Number(searchResultCounts.all || 0);
}

function getActiveSearchScopeCount() {
  return getSearchScopeCount(state.scope);
}

function getSearchScopeLabel(scope) {
  if (scope === 'talks') return 'Talks';
  if (scope === 'papers') return 'Papers';
  if (scope === 'blogs') return 'Blogs';
  if (scope === 'docs') return 'Docs';
  if (scope === 'people') return 'People';
  return 'All';
}

function getActiveFilterLabels() {
  if (state.mode !== 'search') return [];
  const labels = [];
  if (state.timeFilter === 'since-2026') labels.push('Since 2026');
  else if (state.timeFilter === 'since-2025') labels.push('Since 2025');
  else if (state.timeFilter === 'since-2022') labels.push('Since 2022');
  else if (state.timeFilter === 'custom') {
    const years = normalizeYearRange(state.yearFrom, state.yearTo);
    if (years.from > 0 || years.to > 0) {
      if (years.from > 0 && years.to > 0) labels.push(`Years ${years.from}-${years.to}`);
      else if (years.from > 0) labels.push(`Since ${years.from}`);
      else labels.push(`Up to ${years.to}`);
    } else {
      labels.push('Custom range');
    }
  }
  if (state.advanced.allWords) labels.push(`All words: ${state.advanced.allWords}`);
  if (state.advanced.exactPhrase) labels.push(`Exact phrase: "${state.advanced.exactPhrase}"`);
  if (state.advanced.anyWords) labels.push(`Any words: ${state.advanced.anyWords}`);
  if (state.advanced.withoutWords) labels.push(`Without: ${state.advanced.withoutWords}`);
  if (state.advanced.where !== 'anywhere') {
    labels.push(state.advanced.where === 'title' ? 'Words in title' : 'Words in abstract/content');
  }
  if (state.advanced.author) labels.push(`Author: ${state.advanced.author}`);
  if (state.advanced.publication) labels.push(`Publication: ${state.advanced.publication}`);
  return labels;
}

function syncScopeControlVisibility() {
  const scopeToggle = getNodeById('work-scope-toggle');
  if (!scopeToggle) return;
  scopeToggle.hidden = state.mode !== 'search';
}

function syncScopeControlCounts() {
  const countAll = getNodeById('work-scope-count-all');
  const countTalks = getNodeById('work-scope-count-talks');
  const countPapers = getNodeById('work-scope-count-papers');
  const countBlogs = getNodeById('work-scope-count-blogs');
  const countDocs = getNodeById('work-scope-count-docs');
  const countPeople = getNodeById('work-scope-count-people');
  if (countAll) countAll.textContent = getSearchScopeCount('all').toLocaleString();
  if (countTalks) countTalks.textContent = getSearchScopeCount('talks').toLocaleString();
  if (countPapers) countPapers.textContent = getSearchScopeCount('papers').toLocaleString();
  if (countBlogs) countBlogs.textContent = getSearchScopeCount('blogs').toLocaleString();
  if (countDocs) countDocs.textContent = getSearchScopeCount('docs').toLocaleString();
  if (countPeople) countPeople.textContent = getSearchScopeCount('people').toLocaleString();
}

function syncScopeControls() {
  const scopeToggle = getNodeById('work-scope-toggle');
  const scopeInput = getNodeById('work-search-scope-input');
  const timeInput = getNodeById('work-search-time-input');
  const yearFromInput = getNodeById('work-search-year-from-input');
  const yearToInput = getNodeById('work-search-year-to-input');
  const allWordsInput = getNodeById('work-search-all-words-input');
  const exactPhraseInput = getNodeById('work-search-exact-phrase-input');
  const anyWordsInput = getNodeById('work-search-any-words-input');
  const withoutWordsInput = getNodeById('work-search-without-words-input');
  const whereInput = getNodeById('work-search-where-input');
  const authorInput = getNodeById('work-search-author-input');
  const publicationInput = getNodeById('work-search-publication-input');
  if (scopeInput) scopeInput.value = normalizeSearchScope(state.scope);
  if (timeInput) timeInput.value = state.mode === 'search' ? normalizeTimeFilter(state.timeFilter) : 'any';
  const normalizedYears = normalizeYearRange(state.yearFrom, state.yearTo);
  if (yearFromInput) yearFromInput.value = state.mode === 'search' && state.timeFilter === 'custom' && normalizedYears.from > 0
    ? String(normalizedYears.from)
    : '';
  if (yearToInput) yearToInput.value = state.mode === 'search' && state.timeFilter === 'custom' && normalizedYears.to > 0
    ? String(normalizedYears.to)
    : '';
  if (allWordsInput) allWordsInput.value = state.mode === 'search' ? state.advanced.allWords : '';
  if (exactPhraseInput) exactPhraseInput.value = state.mode === 'search' ? state.advanced.exactPhrase : '';
  if (anyWordsInput) anyWordsInput.value = state.mode === 'search' ? state.advanced.anyWords : '';
  if (withoutWordsInput) withoutWordsInput.value = state.mode === 'search' ? state.advanced.withoutWords : '';
  if (whereInput) whereInput.value = state.mode === 'search' ? normalizeAdvancedWhere(state.advanced.where) : 'anywhere';
  if (authorInput) authorInput.value = state.mode === 'search' ? state.advanced.author : '';
  if (publicationInput) publicationInput.value = state.mode === 'search' ? state.advanced.publication : '';
  if (!scopeToggle) return;
  const buttons = [...scopeToggle.querySelectorAll('.work-scope-btn[data-work-scope]')];
  for (const button of buttons) {
    const scope = normalizeSearchScope(button.getAttribute('data-work-scope'));
    const active = scope === state.scope;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
  syncScopeControlCounts();
}

function initScopeControl() {
  const scopeToggle = getNodeById('work-scope-toggle');
  if (!scopeToggle) return;

  const buttons = [...scopeToggle.querySelectorAll('.work-scope-btn[data-work-scope]')];
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const nextScope = normalizeSearchScope(button.getAttribute('data-work-scope'));
      if (nextScope === state.scope) return;
      state.scope = nextScope;
      state.sortBy = normalizeSortMode(state.sortBy);
      recomputeFilteredResults();
      syncScopeControls();
      syncAdvancedFilterControls();
      syncSortControl();
      rerenderWorkSections();
      syncUrlState();
    });
  }

  syncScopeControlVisibility();
  syncScopeControls();
}

function countActiveAdvancedFields() {
  let count = 0;
  if (state.advanced.allWords) count += 1;
  if (state.advanced.exactPhrase) count += 1;
  if (state.advanced.anyWords) count += 1;
  if (state.advanced.withoutWords) count += 1;
  if (state.advanced.where !== 'anywhere') count += 1;
  if (state.advanced.author) count += 1;
  if (state.advanced.publication) count += 1;
  if (state.timeFilter === 'custom' && (state.yearFrom > 0 || state.yearTo > 0)) count += 1;
  return count;
}

function syncAdvancedFilterControlVisibility() {
  const searchMode = state.mode === 'search';
  const timeSelect = getNodeById('work-time-select');
  const timeLabel = document.querySelector('label[for="work-time-select"]');
  const customRange = getNodeById('work-custom-range');
  const advancedToggle = getNodeById('work-advanced-toggle');
  const advancedPanel = getNodeById('work-advanced-panel');
  const customVisible = searchMode && state.timeFilter === 'custom';
  const activeAdvancedCount = countActiveAdvancedFields();
  const advancedActive = activeAdvancedCount > 0;
  const advancedVisualOn = searchMode && (advancedActive || state.advancedOpen);

  if (timeLabel) timeLabel.hidden = !searchMode;
  if (timeSelect) {
    timeSelect.hidden = !searchMode;
    timeSelect.disabled = !searchMode;
  }
  if (customRange) customRange.classList.toggle('hidden', !customVisible);
  if (advancedToggle) {
    advancedToggle.hidden = !searchMode;
    advancedToggle.classList.toggle('active', advancedVisualOn);
    advancedToggle.setAttribute('data-advanced-active', advancedActive ? 'true' : 'false');
    advancedToggle.setAttribute('data-advanced-open', searchMode && state.advancedOpen ? 'true' : 'false');
    advancedToggle.setAttribute('aria-expanded', searchMode && state.advancedOpen ? 'true' : 'false');
    advancedToggle.setAttribute('aria-pressed', searchMode && state.advancedOpen ? 'true' : 'false');
    advancedToggle.setAttribute('aria-label', 'Advanced search tools');
  }
  if (advancedPanel) {
    const showPanel = searchMode && state.advancedOpen;
    advancedPanel.classList.toggle('hidden', !showPanel);
  }
}

function syncAdvancedFilterControls() {
  const timeSelect = getNodeById('work-time-select');
  const yearFromInput = getNodeById('work-year-from');
  const yearToInput = getNodeById('work-year-to');
  const advancedAllWordsInput = getNodeById('work-advanced-all-words');
  const advancedExactPhraseInput = getNodeById('work-advanced-exact-phrase');
  const advancedAnyWordsInput = getNodeById('work-advanced-any-words');
  const advancedWithoutWordsInput = getNodeById('work-advanced-without-words');
  const advancedWhereInput = getNodeById('work-advanced-where');
  const advancedAuthorInput = getNodeById('work-advanced-author');
  const advancedPublicationInput = getNodeById('work-advanced-publication');
  const advancedYearFromInput = getNodeById('work-advanced-year-from');
  const advancedYearToInput = getNodeById('work-advanced-year-to');
  const normalizedYears = normalizeYearRange(state.yearFrom, state.yearTo);
  if (timeSelect) timeSelect.value = normalizeTimeFilter(state.timeFilter);
  if (yearFromInput) yearFromInput.value = normalizedYears.from > 0 ? String(normalizedYears.from) : '';
  if (yearToInput) yearToInput.value = normalizedYears.to > 0 ? String(normalizedYears.to) : '';
  if (advancedAllWordsInput) advancedAllWordsInput.value = state.advanced.allWords;
  if (advancedExactPhraseInput) advancedExactPhraseInput.value = state.advanced.exactPhrase;
  if (advancedAnyWordsInput) advancedAnyWordsInput.value = state.advanced.anyWords;
  if (advancedWithoutWordsInput) advancedWithoutWordsInput.value = state.advanced.withoutWords;
  if (advancedWhereInput) advancedWhereInput.value = normalizeAdvancedWhere(state.advanced.where);
  if (advancedAuthorInput) advancedAuthorInput.value = state.advanced.author;
  if (advancedPublicationInput) advancedPublicationInput.value = state.advanced.publication;
  if (advancedYearFromInput) advancedYearFromInput.value = normalizedYears.from > 0 ? String(normalizedYears.from) : '';
  if (advancedYearToInput) advancedYearToInput.value = normalizedYears.to > 0 ? String(normalizedYears.to) : '';
  syncAdvancedFilterControlVisibility();
  syncScopeControls();
}

function applySearchFilterControls(options = {}) {
  if (state.mode !== 'search') return;
  const normalizeOnly = options.normalizeOnly === true;

  state.timeFilter = normalizeTimeFilter(state.timeFilter);
  state.advanced.allWords = normalizeAdvancedText(state.advanced.allWords);
  state.advanced.exactPhrase = normalizeAdvancedText(state.advanced.exactPhrase);
  state.advanced.anyWords = normalizeAdvancedText(state.advanced.anyWords);
  state.advanced.withoutWords = normalizeAdvancedText(state.advanced.withoutWords);
  state.advanced.where = normalizeAdvancedWhere(state.advanced.where);
  state.advanced.author = normalizeAdvancedText(state.advanced.author);
  state.advanced.publication = normalizeAdvancedText(state.advanced.publication);

  const normalizedYears = normalizeYearRange(state.yearFrom, state.yearTo);
  if (state.timeFilter === 'custom') {
    state.yearFrom = normalizedYears.from;
    state.yearTo = normalizedYears.to;
  } else {
    state.yearFrom = 0;
    state.yearTo = 0;
  }

  syncAdvancedFilterControls();
  if (normalizeOnly) return;
  recomputeFilteredResults();
  rerenderWorkSections();
  syncUrlState();
}

function initAdvancedFilterControls() {
  const timeSelect = getNodeById('work-time-select');
  const yearFromInput = getNodeById('work-year-from');
  const yearToInput = getNodeById('work-year-to');
  const advancedToggle = getNodeById('work-advanced-toggle');
  const advancedAllWordsInput = getNodeById('work-advanced-all-words');
  const advancedExactPhraseInput = getNodeById('work-advanced-exact-phrase');
  const advancedAnyWordsInput = getNodeById('work-advanced-any-words');
  const advancedWithoutWordsInput = getNodeById('work-advanced-without-words');
  const advancedWhereInput = getNodeById('work-advanced-where');
  const advancedAuthorInput = getNodeById('work-advanced-author');
  const advancedPublicationInput = getNodeById('work-advanced-publication');
  const advancedYearFromInput = getNodeById('work-advanced-year-from');
  const advancedYearToInput = getNodeById('work-advanced-year-to');
  const advancedApplyBtn = getNodeById('work-advanced-apply');
  const advancedClearBtn = getNodeById('work-advanced-clear');

  if (timeSelect) {
    timeSelect.addEventListener('change', () => {
      state.timeFilter = normalizeTimeFilter(timeSelect.value);
      applySearchFilterControls();
    });
  }

  const bindYearInput = (inputEl, key, source = 'basic') => {
    if (!inputEl) return;
    const apply = () => {
      state[key] = parseYearFilterInput(inputEl.value);
      if (state.timeFilter !== 'custom') state.timeFilter = 'custom';
      if (source === 'advanced' && !state.yearFrom && !state.yearTo) {
        state.timeFilter = 'any';
      }
      applySearchFilterControls();
    };
    inputEl.addEventListener('change', apply);
    inputEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        apply();
      }
    });
  };

  bindYearInput(yearFromInput, 'yearFrom');
  bindYearInput(yearToInput, 'yearTo');
  bindYearInput(advancedYearFromInput, 'yearFrom', 'advanced');
  bindYearInput(advancedYearToInput, 'yearTo', 'advanced');

  if (advancedToggle) {
    advancedToggle.addEventListener('click', () => {
      state.advancedOpen = !state.advancedOpen;
      syncAdvancedFilterControls();
    });
  }

  const applyAdvancedFields = () => {
    state.advanced.allWords = normalizeAdvancedText(advancedAllWordsInput ? advancedAllWordsInput.value : state.advanced.allWords);
    state.advanced.exactPhrase = normalizeAdvancedText(advancedExactPhraseInput ? advancedExactPhraseInput.value : state.advanced.exactPhrase);
    state.advanced.anyWords = normalizeAdvancedText(advancedAnyWordsInput ? advancedAnyWordsInput.value : state.advanced.anyWords);
    state.advanced.withoutWords = normalizeAdvancedText(advancedWithoutWordsInput ? advancedWithoutWordsInput.value : state.advanced.withoutWords);
    state.advanced.where = normalizeAdvancedWhere(advancedWhereInput ? advancedWhereInput.value : state.advanced.where);
    state.advanced.author = normalizeAdvancedText(advancedAuthorInput ? advancedAuthorInput.value : state.advanced.author);
    state.advanced.publication = normalizeAdvancedText(advancedPublicationInput ? advancedPublicationInput.value : state.advanced.publication);

    if (advancedYearFromInput || advancedYearToInput) {
      const nextFrom = parseYearFilterInput(advancedYearFromInput ? advancedYearFromInput.value : '');
      const nextTo = parseYearFilterInput(advancedYearToInput ? advancedYearToInput.value : '');
      state.yearFrom = nextFrom;
      state.yearTo = nextTo;
      if (nextFrom > 0 || nextTo > 0) state.timeFilter = 'custom';
      else if (state.timeFilter === 'custom') state.timeFilter = 'any';
    }

    state.advancedOpen = true;
    applySearchFilterControls();
  };

  if (advancedApplyBtn) {
    advancedApplyBtn.addEventListener('click', () => applyAdvancedFields());
  }

  if (advancedWhereInput) {
    advancedWhereInput.addEventListener('change', () => {
      state.advanced.where = normalizeAdvancedWhere(advancedWhereInput.value);
      applySearchFilterControls();
    });
  }

  if (advancedClearBtn) {
    advancedClearBtn.addEventListener('click', () => {
      state.advanced = {
        allWords: '',
        exactPhrase: '',
        anyWords: '',
        withoutWords: '',
        where: 'anywhere',
        author: '',
        publication: '',
      };
      state.yearFrom = 0;
      state.yearTo = 0;
      if (state.timeFilter === 'custom') state.timeFilter = 'any';
      applySearchFilterControls();
    });
  }

  const advancedTextInputs = [
    advancedAllWordsInput,
    advancedExactPhraseInput,
    advancedAnyWordsInput,
    advancedWithoutWordsInput,
    advancedAuthorInput,
    advancedPublicationInput,
  ].filter(Boolean);

  for (const input of advancedTextInputs) {
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      applyAdvancedFields();
    });
  }

  syncAdvancedFilterControls();
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
        const normalized = normalizePersonRecord(author);
        if (!normalized || !normalized.name) return null;
        const affiliation = author && typeof author === 'object'
          ? String(author.affiliation || '').trim()
          : '';
        return { name: normalized.name, affiliation };
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

function resolveDocsRecordHref(rawHref, rawSlug, docsBasePrefix = 'docs') {
  const href = String(rawHref || '').trim();
  const slug = String(rawSlug || '').trim();
  const basePrefix = String(docsBasePrefix || 'docs').replace(/^\/+|\/+$/g, '');
  if (href) {
    if (/^https?:\/\//i.test(href)) return href;
    if (href.startsWith('/')) return href;
    if (href.startsWith('docs/')) return href;
    return `${basePrefix}/${href}`.replace(/\/{2,}/g, '/');
  }
  if (!slug || slug === 'index') return `${basePrefix}/`;
  if (slug.endsWith('/index')) return `${basePrefix}/${slug.slice(0, -6)}/`.replace(/\/{2,}/g, '/');
  return `${basePrefix}/${slug}.html`.replace(/\/{2,}/g, '/');
}

function normalizeDocsRecord(rawEntry, fallbackIndex = 0, docsBasePrefix = 'docs') {
  if (!rawEntry || typeof rawEntry !== 'object') return null;

  const title = normalizeAdvancedText(rawEntry.title, 320);
  const slug = normalizeAdvancedText(rawEntry.slug, 320);
  const summary = normalizeAdvancedText(rawEntry.summary, 420);
  const chapter = normalizeAdvancedText(rawEntry.chapter, 200);
  const outline = normalizeAdvancedText(rawEntry.outline, 80);
  const headingTexts = Array.isArray(rawEntry.headings)
    ? rawEntry.headings
      .map((item) => normalizeAdvancedText(item && item.text, 180))
      .filter(Boolean)
      .slice(0, 10)
    : [];
  const searchText = normalizeAdvancedText(rawEntry.search, 2200);
  const href = resolveDocsRecordHref(rawEntry.href, slug, docsBasePrefix);
  const idCore = slug || `doc-${fallbackIndex + 1}`;
  const idPrefix = String(docsBasePrefix || 'docs').replace(/[^a-z0-9/_-]+/gi, '').replace(/\//g, '-');
  const id = `${idPrefix}:${idCore}`;
  const normalizedPrefix = String(docsBasePrefix || '').replace(/^\/+|\/+$/g, '');
  const collection = ({
    docs: 'LLVM Core',
    'docs/clang': 'Clang',
    'docs/lldb': 'LLDB',
  }[normalizedPrefix] || 'LLVM Core');

  if (!title || !href) return null;

  return {
    id,
    collection,
    slug,
    title,
    href,
    summary,
    chapter,
    outline,
    headings: headingTexts,
    search: searchText,
    _titleLower: normalizeSearchText(title),
    _slugLower: normalizeSearchText(slug),
    _chapterLower: normalizeSearchText(chapter),
    _outlineLower: normalizeSearchText(outline),
    _headingsLower: normalizeSearchText(headingTexts.join(' ')),
    _summaryLower: normalizeSearchText(summary),
    _searchLower: normalizeSearchText(searchText || `${title} ${headingTexts.join(' ')} ${summary} ${slug}`),
  };
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

function comparePeopleByName(a, b) {
  return String(a && a.name || '').localeCompare(String(b && b.name || ''));
}

function comparePeopleNewestFirst(a, b) {
  const yearDiff = Number(b && b._latestYear || 0) - Number(a && a._latestYear || 0);
  if (yearDiff !== 0) return yearDiff;
  const worksDiff = Number(b && b.totalCount || 0) - Number(a && a.totalCount || 0);
  if (worksDiff !== 0) return worksDiff;
  return comparePeopleByName(a, b);
}

function comparePeopleOldestFirst(a, b) {
  const yearA = Number(a && a._earliestYear || 0);
  const yearB = Number(b && b._earliestYear || 0);
  if (yearA > 0 && yearB > 0 && yearA !== yearB) return yearA - yearB;
  if (yearA > 0 && yearB <= 0) return -1;
  if (yearA <= 0 && yearB > 0) return 1;
  const worksDiff = Number(b && b.totalCount || 0) - Number(a && a.totalCount || 0);
  if (worksDiff !== 0) return worksDiff;
  return comparePeopleByName(a, b);
}

function comparePeopleCitations(a, b) {
  const citationsDiff = Number(b && b.citationCount || 0) - Number(a && a.citationCount || 0);
  if (citationsDiff !== 0) return citationsDiff;
  return comparePeopleNewestFirst(a, b);
}

function comparePeopleWorks(a, b) {
  const worksDiff = Number(b && b.totalCount || 0) - Number(a && a.totalCount || 0);
  if (worksDiff !== 0) return worksDiff;
  return comparePeopleCitations(a, b);
}

function sortPeopleResults(people) {
  const entries = [...(people || [])];
  if (state.sortBy === 'oldest') return entries.sort(comparePeopleOldestFirst);
  if (state.sortBy === 'title') return entries.sort(comparePeopleByName);
  if (state.sortBy === 'citations') return entries.sort(comparePeopleCitations);
  if (state.mode === 'search' && state.sortBy === 'relevance') return entries;
  return entries.sort(comparePeopleNewestFirst);
}

function tokenizeQuery(query) {
  const raw = String(query || '');
  if (!raw.trim()) return [];
  const cacheHit = QUERY_TOKEN_CACHE.get(raw);
  if (Array.isArray(cacheHit)) return cacheHit;

  const tokens = tokenizeQueryFromHub(raw);
  const resolved = Array.isArray(tokens) ? tokens : [];
  if (QUERY_TOKEN_CACHE.size >= QUERY_TOKEN_CACHE_MAX) {
    const oldest = QUERY_TOKEN_CACHE.keys().next().value;
    if (oldest !== undefined) QUERY_TOKEN_CACHE.delete(oldest);
  }
  QUERY_TOKEN_CACHE.set(raw, resolved);
  return resolved;
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

function getTalkYear(talk) {
  if (!talk || typeof talk !== 'object') return 0;
  return parseYearValue(talk.meeting || talk.meetingDate || talk._year || '');
}

function getPaperYear(paper) {
  if (!paper || typeof paper !== 'object') return 0;
  return parseYearValue(paper._year || paper.year || paper.publishDate || paper.publishedDate || paper.date || '');
}

function yearInWindow(year, window) {
  if (!window || typeof window !== 'object') return true;
  const from = Number.isFinite(window.from) ? Number(window.from) : 0;
  const to = Number.isFinite(window.to) ? Number(window.to) : 0;
  if (from <= 0 && to <= 0) return true;
  if (!year || !Number.isFinite(year)) return false;
  if (from > 0 && year < from) return false;
  if (to > 0 && year > to) return false;
  return true;
}

function matchesTalkSearchFilters(talk, filterWindow) {
  return yearInWindow(getTalkYear(talk), filterWindow);
}

function matchesPaperSearchFilters(paper, filterWindow) {
  return yearInWindow(getPaperYear(paper), filterWindow);
}

function matchesPersonSearchFilters(person, filterWindow) {
  if (!filterWindow || typeof filterWindow !== 'object') return true;
  const from = Number.isFinite(filterWindow.from) ? Number(filterWindow.from) : 0;
  const to = Number.isFinite(filterWindow.to) ? Number(filterWindow.to) : 0;
  if (from <= 0 && to <= 0) return true;

  const latestYear = Number(person && person._latestYear || 0);
  const earliestYear = Number(person && person._earliestYear || 0);
  const rangeStart = earliestYear > 0 ? earliestYear : latestYear;
  const rangeEnd = latestYear > 0 ? latestYear : earliestYear;
  if (rangeStart <= 0 && rangeEnd <= 0) return false;
  if (from > 0 && rangeEnd < from) return false;
  if (to > 0 && rangeStart > to) return false;
  return true;
}

function buildPersonKeySetFromResults(talks, papers, blogs) {
  const keys = new Set();
  const addName = (value) => {
    const key = normalizePersonKey(value);
    if (key) keys.add(key);
  };

  for (const talk of (talks || [])) {
    for (const speaker of (talk && talk.speakers) || []) addName(speaker && speaker.name);
  }
  for (const paper of (papers || [])) {
    for (const author of (paper && paper.authors) || []) addName(author && author.name);
  }
  for (const blog of (blogs || [])) {
    for (const author of (blog && blog.authors) || []) addName(author && author.name);
  }

  return keys;
}

function personRecordMatchesKeySet(person, keySet) {
  if (!(keySet instanceof Set) || !keySet.size) return false;
  for (const variant of getPersonVariantNames(person)) {
    const key = normalizePersonKey(variant);
    if (key && keySet.has(key)) return true;
  }
  return false;
}

function buildPersonContextScoreMap(talks, papers, blogs) {
  const scoreByKey = new Map();
  const addScore = (name, score) => {
    const key = normalizePersonKey(name);
    if (!key || !Number.isFinite(score) || score <= 0) return;
    scoreByKey.set(key, Number(scoreByKey.get(key) || 0) + score);
  };

  for (const talk of (talks || [])) {
    for (const speaker of (talk && talk.speakers) || []) addScore(speaker && speaker.name, 1.35);
  }
  for (const paper of (papers || [])) {
    for (const author of (paper && paper.authors) || []) addScore(author && author.name, 1.85);
  }
  for (const blog of (blogs || [])) {
    for (const author of (blog && blog.authors) || []) addScore(author && author.name, 1.15);
  }

  return scoreByKey;
}

function getPersonContextScore(person, scoreByKey) {
  if (!(scoreByKey instanceof Map) || !scoreByKey.size || !person) return 0;
  let best = 0;
  for (const variant of getPersonVariantNames(person)) {
    const key = normalizePersonKey(variant);
    if (!key) continue;
    const score = Number(scoreByKey.get(key) || 0);
    if (score > best) best = score;
  }
  return best;
}

function rankPeopleWithContext(rankedPeople, scoreByKey, filterWindow) {
  const ranked = Array.isArray(rankedPeople) ? rankedPeople : [];
  const seen = new Set();
  const merged = [];

  const pushUnique = (person) => {
    if (!person || !matchesPersonSearchFilters(person, filterWindow)) return false;
    const keys = getPersonVariantNames(person)
      .map((variant) => normalizePersonKey(variant))
      .filter(Boolean);
    if (!keys.length) return false;
    if (keys.some((key) => seen.has(key))) return false;
    keys.forEach((key) => seen.add(key));
    merged.push(person);
    return true;
  };

  for (const person of ranked) pushUnique(person);

  const contextualScored = [];
  for (const person of allPeopleRecords) {
    if (!matchesPersonSearchFilters(person, filterWindow)) continue;
    const contextScore = getPersonContextScore(person, scoreByKey);
    if (contextScore <= 0) continue;
    contextualScored.push({ person, contextScore });
  }
  contextualScored.sort((a, b) =>
    (Number(b.contextScore || 0) - Number(a.contextScore || 0))
    || comparePeopleWorks(a.person, b.person)
  );
  let contextualRanked = contextualScored;
  if (contextualScored.length) {
    const topContextScore = Number(contextualScored[0].contextScore || 0);
    if (topContextScore > 0) {
      const minContextScore = Math.max(1.05, topContextScore * 0.17);
      contextualRanked = contextualScored.filter((entry) => Number(entry.contextScore || 0) >= minContextScore);
    }
    if (contextualRanked.length > 320) {
      contextualRanked = contextualRanked.slice(0, 320);
    }
  }

  if (!merged.length) {
    const contextualOnly = [];
    for (const entry of contextualRanked) {
      if (pushUnique(entry.person)) contextualOnly.push(entry.person);
    }
    return contextualOnly;
  }

  for (const entry of contextualRanked) pushUnique(entry.person);
  return merged;
}

function getPersonSearchBlob(person) {
  const variants = getPersonVariantNames(person);
  const parts = [
    ...variants,
    person && person.talkFilterName,
    person && person.paperFilterName,
    person && person.blogFilterName,
  ];
  return normalizeSearchText(parts.filter(Boolean).join(' '));
}

function scorePersonRecordByModel(person, model, options = {}) {
  if (!person || !model) return 0;

  const relaxed = options.relaxed === true;
  const name = normalizeSearchText(person.name || '');
  const variants = getPersonVariantNames(person).map((value) => normalizeSearchText(value)).filter(Boolean);
  const blob = getPersonSearchBlob(person);
  const publicationBlob = normalizeSearchText(
    (Array.isArray(person.publications) ? person.publications : [])
      .map((entry) => entry && entry.name)
      .filter(Boolean)
      .join(' ')
  );
  const where = normalizeAdvancedWhere(model.whereScope || 'anywhere');
  const scopedText = where === 'title'
    ? [name, ...variants].join(' ').trim()
    : (where === 'abstract' ? blob : [name, ...variants, blob].join(' ').trim());
  const hasCoreTerms = !!(
    (Array.isArray(model.clauses) && model.clauses.length)
    || (Array.isArray(model.anyClauses) && model.anyClauses.length)
    || (Array.isArray(model.requiredPhrases) && model.requiredPhrases.length)
    || (Array.isArray(model.anyPhrases) && model.anyPhrases.length)
    || (Array.isArray(model.phrases) && model.phrases.length)
  );

  if (!blob && !scopedText) return 0;
  if (!hasCoreTerms && !model.hasFilters) return 0;

  const clauseScoreInText = (clause, textValue, specificity = 1) => {
    if (!clause || !Array.isArray(clause.variants) || !clause.variants.length) return 0;
    const text = normalizeSearchText(textValue || '');
    if (!text) return 0;
    let best = 0;
    for (const variant of clause.variants) {
      const term = normalizeSearchText(variant && variant.term);
      const weight = Number(variant && variant.weight || 0);
      if (!term || weight <= 0) continue;
      if (!text.includes(term)) continue;
      const score = weight * (Number(specificity || 1) || 1);
      if (score > best) best = score;
    }
    return best;
  };

  const phraseInText = (phrase, textValue) => {
    const value = normalizeSearchText(phrase);
    const text = normalizeSearchText(textValue);
    if (!value || !text) return false;
    return text.includes(value);
  };

  for (const excluded of (model.excludeClauses || [])) {
    if (!excluded || !Array.isArray(excluded.variants)) continue;
    for (const variant of excluded.variants) {
      const term = normalizeSearchText(variant && variant.term);
      if (term && blob.includes(term)) return 0;
    }
  }
  for (const excludedPhrase of (model.excludePhrases || [])) {
    const phrase = normalizeSearchText(excludedPhrase);
    if (phrase && blob.includes(phrase)) return 0;
  }

  const authorFieldClauses = model.fieldClauses && Array.isArray(model.fieldClauses.authors)
    ? model.fieldClauses.authors
    : [];
  for (const clause of authorFieldClauses) {
    if (clauseScoreInText(clause, `${name} ${variants.join(' ')}`, clause && clause.specificity || 1) <= 0) return 0;
  }

  const venueFieldClauses = model.fieldClauses && Array.isArray(model.fieldClauses.venue)
    ? model.fieldClauses.venue
    : [];
  for (const clause of venueFieldClauses) {
    if (clauseScoreInText(clause, publicationBlob, clause && clause.specificity || 1) <= 0) return 0;
  }

  const authorFieldPhrases = model.fieldPhrases && Array.isArray(model.fieldPhrases.authors)
    ? model.fieldPhrases.authors
    : [];
  for (const entry of authorFieldPhrases) {
    const phrase = normalizeSearchText(entry && entry.value);
    if (!phrase) continue;
    if (!phraseInText(phrase, `${name} ${variants.join(' ')}`)) return 0;
  }

  const venueFieldPhrases = model.fieldPhrases && Array.isArray(model.fieldPhrases.venue)
    ? model.fieldPhrases.venue
    : [];
  for (const entry of venueFieldPhrases) {
    const phrase = normalizeSearchText(entry && entry.value);
    if (!phrase) continue;
    if (!phraseInText(phrase, publicationBlob)) return 0;
  }

  for (const phrase of (model.requiredPhrases || [])) {
    if (!phraseInText(phrase, scopedText)) return 0;
  }

  if (Array.isArray(model.anyClauses) && model.anyClauses.length) {
    let matchedAnyClause = false;
    for (const clause of model.anyClauses) {
      if (clauseScoreInText(clause, scopedText, clause && clause.specificity || 1) > 0) {
        matchedAnyClause = true;
        break;
      }
    }
    if (!matchedAnyClause && !(Array.isArray(model.anyPhrases) && model.anyPhrases.length)) return 0;
    if (!matchedAnyClause && Array.isArray(model.anyPhrases) && model.anyPhrases.length) {
      let matchedAnyPhrase = false;
      for (const phrase of model.anyPhrases) {
        if (phraseInText(phrase, scopedText)) {
          matchedAnyPhrase = true;
          break;
        }
      }
      if (!matchedAnyPhrase) return 0;
    }
  } else if (Array.isArray(model.anyPhrases) && model.anyPhrases.length) {
    let matchedAnyPhrase = false;
    for (const phrase of model.anyPhrases) {
      if (phraseInText(phrase, scopedText)) {
        matchedAnyPhrase = true;
        break;
      }
    }
    if (!matchedAnyPhrase) return 0;
  }

  let total = 0;
  let matchedClauses = 0;
  const clauses = Array.isArray(model.clauses) ? model.clauses : [];
  for (const clause of clauses) {
    if (!clause || !Array.isArray(clause.variants) || !clause.variants.length) continue;
    let bestClauseScore = 0;
    for (const variant of clause.variants) {
      const term = normalizeSearchText(variant && variant.term);
      const weight = Number(variant && variant.weight || 0);
      if (!term || weight <= 0) continue;

      let termScore = 0;
      if (where !== 'abstract') {
        if (name === term) termScore = Math.max(termScore, 18);
        else if (name.startsWith(`${term} `) || name.startsWith(term)) termScore = Math.max(termScore, 13);
        else if (name.includes(term)) termScore = Math.max(termScore, 9);

        for (const candidate of variants) {
          if (candidate === term) termScore = Math.max(termScore, 12);
          else if (candidate.startsWith(`${term} `) || candidate.startsWith(term)) termScore = Math.max(termScore, 9);
          else if (candidate.includes(term)) termScore = Math.max(termScore, 7);
        }
      }

      if (where !== 'title' && blob.includes(term)) termScore = Math.max(termScore, where === 'abstract' ? 8 : 4);
      if (termScore <= 0) continue;

      const weightedScore = termScore * weight * (Number(clause.specificity || 1));
      if (weightedScore > bestClauseScore) bestClauseScore = weightedScore;
    }

    if (bestClauseScore > 0) matchedClauses += 1;
    total += bestClauseScore;
  }

  let coverage = 1;
  if (clauses.length) {
    if (!matchedClauses || total <= 0) return 0;
    const clauseCount = Math.max(1, clauses.length);
    coverage = matchedClauses / clauseCount;
    if (!relaxed && coverage < 1) return 0;
    if (relaxed && clauseCount >= 3 && coverage < 0.5) return 0;
    if (relaxed && clauseCount < 3 && coverage < 1) return 0;
  } else {
    total = 1;
  }

  let phraseBonus = 0;
  for (const phraseEntry of (model.phrases || [])) {
    const phrase = normalizeSearchText(phraseEntry && phraseEntry.value);
    const phraseWeight = Number(phraseEntry && phraseEntry.weight || 1);
    if (!phrase || phraseWeight <= 0) continue;
    if (where !== 'abstract') {
      if (name === phrase) phraseBonus += 20 * phraseWeight;
      else if (name.startsWith(`${phrase} `) || name.startsWith(phrase)) phraseBonus += 14 * phraseWeight;
      else if (variants.some((candidate) => candidate.includes(phrase))) phraseBonus += 10 * phraseWeight;
    }
    if (where !== 'title' && blob.includes(phrase)) phraseBonus += 8 * phraseWeight;
  }

  let requiredPhraseBonus = 0;
  for (const phrase of (model.requiredPhrases || [])) {
    if (!phrase) continue;
    if (phraseInText(phrase, scopedText)) requiredPhraseBonus += 9;
  }

  let anyBonus = 0;
  for (const clause of (model.anyClauses || [])) {
    const score = clauseScoreInText(clause, scopedText, clause && clause.specificity || 1);
    if (score > anyBonus) anyBonus = score;
  }
  for (const phrase of (model.anyPhrases || [])) {
    if (phraseInText(phrase, scopedText)) {
      anyBonus = Math.max(anyBonus, 4.2);
      break;
    }
  }

  const countBoost = Math.log1p(Number(person.totalCount || 0)) * 2.4;
  const citationBoost = Math.log1p(Number(person.citationCount || 0)) * 1.7;
  const yearBoost = Number(person._latestYear || 0) > 0
    ? Math.max(0, Number(person._latestYear || 0) - 2006) * 0.05
    : 0;

  return (total * (0.52 + coverage)) + phraseBonus + requiredPhraseBonus + anyBonus + countBoost + citationBoost + yearBoost;
}

function computeUniversalTitleBoost(title, normalizedQuery, normalizedTokens) {
  const normalizedTitle = normalizeSearchText(title);
  if (!normalizedTitle || !normalizedQuery) return 0;
  const titleWords = normalizedTitle.split(/\s+/).filter(Boolean);
  const titleWordSet = new Set(titleWords);

  const hasTokenBoundaryMatch = (token) => {
    const term = normalizeSearchText(token);
    if (!term) return false;
    if (titleWordSet.has(term)) return true;
    if (term.length >= 4 && titleWords.some((word) => word.startsWith(term))) return true;
    if (term.length >= 5 && titleWords.some((word) => term.startsWith(word))) return true;
    return false;
  };

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
      if (token && hasTokenBoundaryMatch(token)) matchedTokens += 1;
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
  if (entry.kind === 'person') return String((entry.person && entry.person.name) || '');
  if (entry.kind === 'docs') return String((entry.doc && entry.doc.title) || '');
  return String((entry.paper && entry.paper.title) || '');
}

function getUniversalEntryYear(entry) {
  if (!entry || typeof entry !== 'object') return 0;
  if (entry.kind === 'talk') {
    const talk = entry.talk || {};
    return parseYearValue(talk.meeting || talk.meetingDate || talk._year);
  }
  if (entry.kind === 'person') {
    const person = entry.person || {};
    return Number(person._latestYear || 0);
  }
  if (entry.kind === 'docs') return 0;
  const paper = entry.paper || {};
  return parseYearValue(paper._year || paper.year || paper.publishedDate || paper.publishDate || paper.date);
}

function getUniversalEntryCitations(entry) {
  if (!entry || typeof entry !== 'object') return 0;
  if (entry.kind === 'talk') return 0;
  if (entry.kind === 'person') {
    const person = entry.person || {};
    const citations = Number(person.citationCount || 0);
    return Number.isFinite(citations) && citations > 0 ? citations : 0;
  }
  if (entry.kind === 'docs') return 0;
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
  const rawDiff = (b.rawScore || 0) - (a.rawScore || 0);
  if (rawDiff !== 0) return rawDiff;
  const yearDiff = getUniversalEntryYear(b) - getUniversalEntryYear(a);
  if (yearDiff !== 0) return yearDiff;
  return getUniversalEntryTitle(a).localeCompare(getUniversalEntryTitle(b));
}

function resolveUniversalDiversityPlan(model, options = {}) {
  if (!model || typeof model !== 'object') return null;
  const highlySpecificIntent = options && options.highlySpecificIntent === true;

  if (model.beginnerIntent || model.fundamentalsIntent) {
    return {
      headLimit: highlySpecificIntent ? 10 : 16,
      sequence: ['docs', 'talk', 'docs', 'talk', 'paper', 'talk', 'docs', 'paper', 'person', 'blog', 'talk', 'docs'],
    };
  }

  if (model.advancedResearchIntent) {
    if (highlySpecificIntent) return null;
    return {
      headLimit: 10,
      sequence: ['paper', 'paper', 'talk', 'paper', 'docs', 'blog', 'paper', 'talk', 'person', 'docs'],
    };
  }
  return null;
}

function applyIntentAwareUniversalDiversity(entries, model, options = {}) {
  const source = Array.isArray(entries) ? entries : [];
  if (source.length < 6) return source;

  const plan = resolveUniversalDiversityPlan(model, options);
  if (!plan || !Array.isArray(plan.sequence) || !plan.sequence.length) return source;

  const availableKinds = new Set(source.map((entry) => String(entry && entry.kind || '')).filter(Boolean));
  if (availableKinds.size < 2) return source;
  if ((model.beginnerIntent || model.fundamentalsIntent) && !(availableKinds.has('docs') || availableKinds.has('talk'))) {
    return source;
  }

  const kindQueues = new Map();
  source.forEach((entry, index) => {
    const kind = String(entry && entry.kind || '');
    if (!kind) return;
    if (!kindQueues.has(kind)) kindQueues.set(kind, []);
    kindQueues.get(kind).push({ entry, index });
  });

  const usedIndexes = new Set();
  const diversifiedHead = [];
  const headLimit = Math.min(Number(plan.headLimit || 0) || 0, source.length);
  if (!(headLimit > 0)) return source;

  const takeNextKind = (kind) => {
    const queue = kindQueues.get(kind);
    if (!Array.isArray(queue)) return null;
    while (queue.length) {
      const candidate = queue.shift();
      if (!candidate || usedIndexes.has(candidate.index)) continue;
      usedIndexes.add(candidate.index);
      return candidate.entry;
    }
    return null;
  };

  const takeNextGlobal = () => {
    for (let index = 0; index < source.length; index += 1) {
      if (usedIndexes.has(index)) continue;
      usedIndexes.add(index);
      return source[index];
    }
    return null;
  };

  for (let cursor = 0; cursor < headLimit; cursor += 1) {
    const preferredKind = plan.sequence[cursor % plan.sequence.length];
    const picked = takeNextKind(preferredKind) || takeNextGlobal();
    if (!picked) break;
    diversifiedHead.push(picked);
  }

  if (!diversifiedHead.length) return source;

  const out = [...diversifiedHead];
  for (let index = 0; index < source.length; index += 1) {
    if (usedIndexes.has(index)) continue;
    out.push(source[index]);
  }
  return out;
}

function buildUniversalResultsFromRankedLists(talks, papers, blogs, people, docs, query, advancedOptions = null) {
  const rankedTalks = Array.isArray(talks) ? talks : [];
  const rankedPapers = Array.isArray(papers) ? papers : [];
  const rankedBlogs = Array.isArray(blogs) ? blogs : [];
  const rankedPeople = Array.isArray(people) ? people : [];
  const rankedDocs = Array.isArray(docs) ? docs : [];
  const normalizedQuery = normalizeSearchText(query);
  const normalizedTokens = tokenizeQuery(query).map((token) => normalizeSearchText(token)).filter(Boolean);
  const model = buildSearchQueryModel(query, advancedOptions || undefined);
  const hasModel = !!(model && model.hasSearchConstraints);
  const narrowClauseCount = hasModel
    ? (Array.isArray(model.clauses) ? model.clauses.filter((clause) => clause && clause.isBroad !== true).length : 0)
    : 0;
  const requiredPhraseCount = hasModel
    ? (Array.isArray(model.requiredPhrases) ? model.requiredPhrases.length : 0)
    : 0;
  const focusedIntent = hasModel && (narrowClauseCount >= 2 || requiredPhraseCount > 0);
  const highlySpecificIntent = hasModel && (narrowClauseCount >= 3 || requiredPhraseCount >= 1);
  const canScoreTalkByModel = hasModel;
  const canScorePaperByModel = hasModel;
  const canScorePeopleByModel = hasModel;
  const resolveIntentKindMultiplier = (kind) => {
    if (!hasModel) return 1;

    let multiplier = 1;
    if (model.beginnerIntent || model.fundamentalsIntent) {
      if (kind === 'docs') multiplier *= 1.14;
      else if (kind === 'talk') multiplier *= 1.08;
      else if (kind === 'paper' || kind === 'blog') multiplier *= 0.96;
    }

    if (model.advancedResearchIntent) {
      if (kind === 'paper' || kind === 'blog') multiplier *= 1.14;
      else if (kind === 'talk') multiplier *= 1.06;
      else if (kind === 'docs') multiplier *= 0.86;
    }

    if (model.subprojectIntent && kind === 'person') {
      multiplier *= 0.94;
    }
    return multiplier;
  };
  const strict = [];
  const relaxed = [];
  const fallback = [];

  const pushEntry = (bucket, tier, kind, record, rawScore, rankIndex) => {
    const numericScore = Number(rawScore);
    if (!(numericScore > 0)) return;
    const entry = {
      kind,
      rawScore: numericScore,
      score: numericScore,
      rankIndex,
      tier,
    };
    if (kind === 'talk') {
      bucket.push({ ...entry, talk: record });
      return;
    }
    if (kind === 'person') {
      bucket.push({ ...entry, person: record });
      return;
    }
    if (kind === 'docs') {
      bucket.push({ ...entry, doc: record });
      return;
    }
    bucket.push({ ...entry, paper: record });
  };

  const pushForKind = (records, kind) => {
    const values = Array.isArray(records) ? records : [];
    const canScoreByModel = kind === 'talk'
      ? canScoreTalkByModel
      : (kind === 'person' ? canScorePeopleByModel : (kind === 'docs' ? false : canScorePaperByModel));

    values.forEach((record, index) => {
      const title = getUniversalEntryTitle(
        kind === 'talk'
          ? { kind, talk: record }
          : (kind === 'person'
            ? { kind, person: record }
            : (kind === 'docs' ? { kind, doc: record } : { kind, paper: record }))
      );
      const titleBoost = computeUniversalTitleBoost(title, normalizedQuery, normalizedTokens);

      if (kind === 'docs') {
        const docsScore = Number(record && record._workSearchScore || 0);
        if (docsScore > 0) {
          pushEntry(strict, 'strict', kind, record, docsScore + titleBoost, index);
          return;
        }
      }

      if (canScoreByModel) {
        const strictScore = kind === 'talk'
          ? scoreTalkRecordByModel(record, model, { relaxed: false })
          : (kind === 'person'
            ? scorePersonRecordByModel(record, model, { relaxed: false })
            : scorePaperRecordByModel(record, model, { relaxed: false }));
        if (strictScore > 0) {
          pushEntry(strict, 'strict', kind, record, strictScore + titleBoost, index);
          return;
        }

        const relaxedScore = kind === 'talk'
          ? scoreTalkRecordByModel(record, model, { relaxed: true })
          : (kind === 'person'
            ? scorePersonRecordByModel(record, model, { relaxed: true })
            : scorePaperRecordByModel(record, model, { relaxed: true }));
        if (relaxedScore > 0) {
          pushEntry(relaxed, 'relaxed', kind, record, relaxedScore + (titleBoost * 0.9), index);
          return;
        }
      }

      if (index >= UNIVERSAL_FALLBACK_PER_KIND_LIMIT) return;
      const fallbackBase = kind === 'person' ? 210 : (kind === 'docs' ? 235 : 230);
      const fallbackScore = (fallbackBase / (index + 2)) + titleBoost;
      pushEntry(fallback, 'fallback', kind, record, fallbackScore, index);
    });
  };

  pushForKind(rankedTalks, 'talk');
  pushForKind(rankedPapers, 'paper');
  pushForKind(rankedBlogs, 'blog');
  pushForKind(rankedPeople, 'person');
  pushForKind(rankedDocs, 'docs');

  let entries = [];
  if (strict.length > 0) {
    if (highlySpecificIntent || strict.length >= 120) {
      entries = [...strict];
    } else {
      const relaxedMultiplier = focusedIntent ? 0.56 : 0.62;
      const softenedRelaxed = relaxed.map((entry) => ({ ...entry, score: entry.score * relaxedMultiplier }));
      entries = [...strict, ...softenedRelaxed];
    }
  } else if (relaxed.length > 0) {
    entries = [...relaxed];
  } else {
    entries = fallback;
  }

  if (entries.length) {
    const topByKind = new Map();
    let globalTopScore = 0;

    for (const entry of entries) {
      const raw = Number(entry && entry.rawScore || 0);
      if (!(raw > 0)) continue;
      if (raw > globalTopScore) globalTopScore = raw;
      const prev = Number(topByKind.get(entry.kind) || 0);
      if (raw > prev) topByKind.set(entry.kind, raw);
    }

    entries = entries.map((entry) => {
      const raw = Number(entry && entry.rawScore || 0);
      if (!(raw > 0)) return { ...entry, score: 0 };

      const kindTopScore = Number(topByKind.get(entry.kind) || 0) || globalTopScore || raw;
      const blendedScore = composeCrossTypeRelevance(raw, {
        kindTopScore,
        globalTopScore: globalTopScore || raw,
        rankIndex: Number(entry.rankIndex || 0),
        tier: entry.tier || 'strict',
        kind: entry.kind || '',
      });

      return {
        ...entry,
        score: (blendedScore > 0 ? blendedScore : raw) * resolveIntentKindMultiplier(entry.kind),
      };
    });
  }

  const sorted = entries.sort(compareUniversalEntries);
  if (state.sortBy !== 'relevance') {
    return sorted.slice(0, UNIVERSAL_MAX_RESULTS);
  }
  if (!sorted.length) return sorted;

  const topScore = Number(sorted[0].score || 0);
  if (!(topScore > 0)) {
    const fallbackSorted = sorted.slice(0, Math.min(180, UNIVERSAL_MAX_RESULTS));
    const diversifiedFallback = applyIntentAwareUniversalDiversity(fallbackSorted, model, { highlySpecificIntent });
    return diversifiedFallback.slice(0, UNIVERSAL_MAX_RESULTS);
  }

  const queryTokenCount = tokenizeQuery(query).length;
  let relativeFloor = queryTokenCount >= 4
    ? 0.22
    : (queryTokenCount === 3 ? 0.18 : 0.14);
  let absoluteFloor = queryTokenCount >= 4 ? 7 : 4;
  if (focusedIntent) {
    relativeFloor = Math.max(relativeFloor, 0.26);
    absoluteFloor = Math.max(absoluteFloor, 7);
  }
  if (highlySpecificIntent) {
    relativeFloor = Math.max(relativeFloor, 0.34);
    absoluteFloor = Math.max(absoluteFloor, 10);
  }
  const threshold = Math.max(absoluteFloor, topScore * relativeFloor);
  const keepHead = highlySpecificIntent ? 80 : 120;
  const pruned = sorted.filter((entry, index) => index < keepHead || Number(entry.score || 0) >= threshold);
  const baseResults = (pruned.length ? pruned : sorted.slice(0, 180)).slice(0, UNIVERSAL_MAX_RESULTS);
  const diversified = applyIntentAwareUniversalDiversity(baseResults, model, { highlySpecificIntent });
  return diversified.slice(0, UNIVERSAL_MAX_RESULTS);
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

function rankTalksForQuery(talks, query, advancedOptions = null) {
  const indexedTalks = (talks || []).map(indexTalkForSearch);
  const tokens = tokenizeQuery(query);
  const hasAdvanced = hasAdvancedSearchOptions(advancedOptions || {});
  if (!tokens.length && !hasAdvanced) return indexedTalks.sort(compareTalksNewestFirst);
  try {
    return rankTalksByQuery(indexedTalks, query, { advanced: advancedOptions || undefined });
  } catch (error) {
    console.error('[work] rankTalksByQuery failed, falling back to newest-first ordering.', error);
    return indexedTalks.sort(compareTalksNewestFirst);
  }
}

function rankPapersForQuery(papers, query, advancedOptions = null) {
  const values = Array.isArray(papers) ? papers : [];
  try {
    return rankPaperRecordsByQuery(values, query, { advanced: advancedOptions || undefined });
  } catch (error) {
    console.error('[work] rankPaperRecordsByQuery failed, falling back to newest-first ordering.', error);
    return [...values].sort(comparePapersNewestFirst);
  }
}

function rankPeopleForQuery(people, query, advancedOptions = null) {
  const records = Array.isArray(people) ? [...people] : [];
  const model = buildSearchQueryModel(query, advancedOptions || undefined);
  const hasModel = !!(model && model.hasSearchConstraints);
  const compareScored = (a, b) =>
    (Number(b.score || 0) - Number(a.score || 0))
    || comparePeopleWorks(a.person, b.person);

  if (hasModel) {
    let scored = [];
    for (const person of records) {
      const score = scorePersonRecordByModel(person, model, { relaxed: false });
      if (score > 0) scored.push({ person, score });
    }

    if (!scored.length && (model.clauses.length >= 2 || model.hasFilters)) {
      for (const person of records) {
        const score = scorePersonRecordByModel(person, model, { relaxed: true });
        if (score > 0) scored.push({ person, score });
      }
    }

    if (scored.length) {
      scored.sort(compareScored);
      const topScore = Number(scored[0].score || 0);
      if (topScore > 0) {
        const relativeFloor = model.beginnerIntent
          ? 0.42
          : (model.clauses.length <= 2 ? 0.3 : 0.22);
        const absoluteFloor = model.beginnerIntent ? 8 : 4;
        const threshold = Math.max(absoluteFloor, topScore * relativeFloor);
        const pruned = scored.filter((entry) => Number(entry.score || 0) >= threshold);
        return (pruned.length ? pruned : scored.slice(0, Math.min(180, scored.length)))
          .map((entry) => entry.person);
      }
      return scored.map((entry) => entry.person);
    }
  }

  const tokens = tokenizeQuery(query);
  const hasAdvanced = hasAdvancedSearchOptions(advancedOptions || {});
  if (!tokens.length && !hasAdvanced) return records.sort(comparePeopleWorks);

  const scored = [];
  for (const person of records) {
    const name = normalizeSearchText(person.name || '');
    const variants = getPersonVariantNames(person).map((value) => normalizeSearchText(value)).filter(Boolean);
    const blob = getPersonSearchBlob(person);
    if (!blob) continue;

    let total = 0;
    let matched = 0;
    for (const token of tokens) {
      let tokenScore = 0;
      if (name === token) tokenScore = Math.max(tokenScore, 140);
      else if (name.startsWith(`${token} `) || name.startsWith(token)) tokenScore = Math.max(tokenScore, 95);
      else if (name.includes(token)) tokenScore = Math.max(tokenScore, 62);

      for (const variant of variants) {
        if (variant === token) tokenScore = Math.max(tokenScore, 92);
        else if (variant.startsWith(`${token} `) || variant.startsWith(token)) tokenScore = Math.max(tokenScore, 68);
        else if (variant.includes(token)) tokenScore = Math.max(tokenScore, 48);
      }

      if (blob.includes(token)) tokenScore = Math.max(tokenScore, 28);
      if (tokenScore <= 0) {
        total = 0;
        break;
      }
      matched += 1;
      total += tokenScore;
    }

    if (!total || matched < tokens.length) continue;
    total += Math.log1p(Number(person.totalCount || 0)) * 7;
    total += Math.log1p(Number(person.citationCount || 0)) * 5;
    total += Number(person._latestYear || 0) > 0 ? (Number(person._latestYear || 0) - 2006) * 0.09 : 0;
    scored.push({ person, score: total });
  }

  scored.sort(compareScored);
  return scored.map((entry) => entry.person);
}

function docsFiltersSupported(advancedOptions) {
  const options = advancedOptions && typeof advancedOptions === 'object' ? advancedOptions : {};
  const hasAuthorFilter = normalizeAdvancedText(options.author).length > 0;
  const hasPublicationFilter = normalizeAdvancedText(options.publication).length > 0;
  const hasYearFrom = parseYearFilterInput(options.yearFrom) > 0;
  const hasYearTo = parseYearFilterInput(options.yearTo) > 0;
  return !(hasAuthorFilter || hasPublicationFilter || hasYearFrom || hasYearTo);
}

function docsScopedBlob(doc, whereMode) {
  const where = normalizeAdvancedWhere(whereMode);
  if (where === 'title') {
    return [doc._titleLower, doc._headingsLower].join(' ').trim();
  }
  if (where === 'abstract') {
    return [doc._summaryLower, doc._headingsLower, doc._chapterLower, doc._searchLower].join(' ').trim();
  }
  return [doc._titleLower, doc._headingsLower, doc._summaryLower, doc._chapterLower, doc._searchLower].join(' ').trim();
}

function docsHasBeginnerSignal(doc, blob) {
  const title = String(doc && doc._titleLower || '');
  const headings = String(doc && doc._headingsLower || '');
  const summary = String(doc && doc._summaryLower || '');
  const chapter = String(doc && doc._chapterLower || '');
  const text = `${title} ${headings} ${summary} ${chapter} ${String(blob || '')}`
    .replace(DOCS_BEGINNER_FALSE_POSITIVE_RE, ' ')
    .trim();
  if (!text) return false;

  const advancedSignal = DOCS_BEGINNER_ADVANCED_RE.test(text);
  if (DOCS_BEGINNER_STRONG_RE.test(text)) return true;
  if (DOCS_BEGINNER_INTRO_RE.test(text) && !advancedSignal) return true;
  if (!DOCS_BEGINNER_AMBIGUOUS_RE.test(text)) return false;
  return !advancedSignal;
}

function docsHasFundamentalsSignal(doc, blob) {
  const title = String(doc && doc._titleLower || '');
  const headings = String(doc && doc._headingsLower || '');
  const summary = String(doc && doc._summaryLower || '');
  const chapter = String(doc && doc._chapterLower || '');
  const text = `${title} ${headings} ${summary} ${chapter} ${String(blob || '')}`
    .replace(DOCS_BEGINNER_FALSE_POSITIVE_RE, ' ')
    .trim();
  if (!text) return false;
  if (!DOCS_FUNDAMENTALS_SIGNAL_RE.test(text)) return false;
  if (!DOCS_ADVANCED_RESEARCH_SIGNAL_RE.test(text)) return true;
  return /\bfundamentals?\b|\boverview\b|\btutorial(?:s)?\b|\bwalkthrough\b|\bguide\b|\bgetting started\b|\bbasics\b|\blearn\b/.test(text);
}

function docsHasAdvancedResearchSignal(doc, blob) {
  const title = String(doc && doc._titleLower || '');
  const headings = String(doc && doc._headingsLower || '');
  const summary = String(doc && doc._summaryLower || '');
  const chapter = String(doc && doc._chapterLower || '');
  const text = `${title} ${headings} ${summary} ${chapter} ${String(blob || '')}`.trim();
  if (!text) return false;
  if (DOCS_ADVANCED_RESEARCH_SIGNAL_RE.test(text)) return true;
  return /\breference\b|\bspec(?:ification)?\b/.test(headings);
}

function docsSubprojectCoverage(model, doc, blob) {
  const subprojectTopics = Array.isArray(model && model.subprojectTopics)
    ? model.subprojectTopics
    : [];
  if (!subprojectTopics.length) {
    return { matchedCount: 0, totalCount: 0, coverage: 0 };
  }

  const title = String(doc && doc._titleLower || '');
  const headings = String(doc && doc._headingsLower || '');
  const summary = String(doc && doc._summaryLower || '');
  const chapter = String(doc && doc._chapterLower || '');
  const slug = String(doc && doc._slugLower || '');
  const text = `${title} ${headings} ${summary} ${chapter} ${slug} ${String(blob || '')}`;
  if (!text) {
    return { matchedCount: 0, totalCount: subprojectTopics.length, coverage: 0 };
  }

  let matchedCount = 0;
  for (const topic of subprojectTopics) {
    const pattern = DOCS_SUBPROJECT_TOPIC_PATTERNS[topic];
    if (pattern && pattern.test(text)) {
      matchedCount += 1;
      continue;
    }
    const fallbackNeedle = normalizeSearchText(topic);
    if (fallbackNeedle && text.includes(fallbackNeedle)) {
      matchedCount += 1;
    }
  }

  return {
    matchedCount,
    totalCount: subprojectTopics.length,
    coverage: subprojectTopics.length ? matchedCount / subprojectTopics.length : 0,
  };
}

function countMatchedQueryTokens(tokens, blob) {
  if (!Array.isArray(tokens) || !tokens.length || !blob) return 0;
  let matched = 0;
  for (const token of tokens) {
    if (!token) continue;
    if (blob.includes(token)) matched += 1;
  }
  return matched;
}

function matchesAdvancedTextConstraint(value, blob, mode = 'all') {
  const normalized = normalizeSearchText(value);
  if (!normalized) return true;
  const terms = tokenizeQuery(normalized).map((token) => normalizeSearchText(token)).filter(Boolean);
  if (!terms.length) return true;
  if (!blob) return false;
  if (mode === 'any') return terms.some((term) => blob.includes(term));
  if (mode === 'none') return terms.every((term) => !blob.includes(term));
  return terms.every((term) => blob.includes(term));
}

function scoreDocsRecordByQuery(doc, query, advancedOptions = null, queryModel = null) {
  if (!doc || typeof doc !== 'object') return 0;
  if (!docsFiltersSupported(advancedOptions)) return 0;

  const options = advancedOptions && typeof advancedOptions === 'object' ? advancedOptions : {};
  const where = normalizeAdvancedWhere(options.where || 'anywhere');
  const blob = docsScopedBlob(doc, where);
  if (!blob) return 0;
  const model = queryModel && typeof queryModel === 'object'
    ? queryModel
    : buildSearchQueryModel(query, options || undefined);
  const beginnerIntent = !!(model && model.beginnerIntent);
  const fundamentalsIntent = !!(model && model.fundamentalsIntent);
  const advancedResearchIntent = !!(model && model.advancedResearchIntent);
  const subprojectIntent = !!(model && model.subprojectIntent);
  const hasNarrowSubprojectIntent = !!(
    subprojectIntent
    && Array.isArray(model && model.subprojectTopics)
    && model.subprojectTopics.some((topic) => normalizeSearchText(topic) !== normalizeSearchText('LLVM'))
  );
  const fundamentalsSignal = fundamentalsIntent ? docsHasFundamentalsSignal(doc, blob) : false;
  const advancedSignal = advancedResearchIntent ? docsHasAdvancedResearchSignal(doc, blob) : false;
  const topicCoverage = subprojectIntent
    ? docsSubprojectCoverage(model, doc, blob)
    : { matchedCount: 0, totalCount: 0, coverage: 0 };

  if (!matchesAdvancedTextConstraint(options.allWords, blob, 'all')) return 0;
  if (!matchesAdvancedTextConstraint(options.anyWords, blob, 'any')) return 0;
  if (!matchesAdvancedTextConstraint(options.withoutWords, blob, 'none')) return 0;

  const exactPhrase = normalizeSearchText(options.exactPhrase);
  if (exactPhrase && !blob.includes(exactPhrase)) return 0;

  const normalizedQuery = normalizeSearchText(query);
  const clauseTokens = Array.isArray(model && model.clauses)
    ? model.clauses.map((clause) => normalizeSearchText(clause && clause.token)).filter(Boolean)
    : [];
  const queryTokens = clauseTokens.length
    ? clauseTokens
    : tokenizeQuery(query).map((token) => normalizeSearchText(token)).filter(Boolean);
  const hasTextIntent = !!(normalizedQuery || queryTokens.length || exactPhrase || normalizeSearchText(options.allWords));
  if (!hasTextIntent) return 0;
  if (beginnerIntent && !docsHasBeginnerSignal(doc, blob)) return 0;
  if (hasNarrowSubprojectIntent && topicCoverage.matchedCount < 1) return 0;

  const matchedTokens = countMatchedQueryTokens(queryTokens, blob);
  if (queryTokens.length) {
    const coverage = matchedTokens / queryTokens.length;
    if (matchedTokens <= 0) return 0;
    if (queryTokens.length >= 3 && coverage < 0.55) return 0;
    if (queryTokens.length <= 2 && coverage < 1) return 0;
  }

  let score = 0;
  const title = String(doc._titleLower || '');
  const headings = String(doc._headingsLower || '');
  const summary = String(doc._summaryLower || '');
  const chapter = String(doc._chapterLower || '');
  const slug = String(doc._slugLower || '');

  if (normalizedQuery) {
    if (title === normalizedQuery) score += 240;
    else if (title.startsWith(`${normalizedQuery} `) || title.startsWith(normalizedQuery)) score += 148;
    else if (title.includes(normalizedQuery)) score += 110;

    if (headings.includes(normalizedQuery)) score += 78;
    if (summary.includes(normalizedQuery)) score += 54;
    if (slug.includes(normalizedQuery)) score += 42;
    if (chapter.includes(normalizedQuery)) score += 26;
  }

  let scoredTokens = 0;
  for (const token of queryTokens) {
    let tokenScore = 0;
    if (title.includes(token)) tokenScore += 48;
    if (headings.includes(token)) tokenScore += 32;
    if (summary.includes(token)) tokenScore += 18;
    if (slug.includes(token)) tokenScore += 12;
    if (chapter.includes(token)) tokenScore += 10;
    if (tokenScore <= 0) continue;
    scoredTokens += 1;
    score += tokenScore;
  }

  if (queryTokens.length && scoredTokens > 0) {
    const coverageBoost = (scoredTokens / queryTokens.length) * 56;
    score += coverageBoost;
  }

  if (exactPhrase) {
    if (title.includes(exactPhrase)) score += 76;
    else if (blob.includes(exactPhrase)) score += 42;
  }

  const headingCountBoost = Math.min(16, (Array.isArray(doc.headings) ? doc.headings.length : 0) * 2);
  score += headingCountBoost;
  if (beginnerIntent) {
    const titleHeadings = `${title} ${headings}`;
    const titleSummary = `${titleHeadings} ${summary}`;
    const introSignal = DOCS_BEGINNER_INTRO_RE.test(titleSummary);
    const advancedIntroSignal = DOCS_BEGINNER_ADVANCED_RE.test(titleSummary);
    if (DOCS_BEGINNER_STRONG_RE.test(titleHeadings)) score += 54;
    else if (introSignal && !advancedIntroSignal) score += 34;
  } else if (fundamentalsIntent) {
    if (fundamentalsSignal) score += 44;
    else score *= 0.86;
  }

  if (advancedResearchIntent) {
    if (advancedSignal) score += 54;
    else score *= 0.72;
    if (fundamentalsSignal && !advancedSignal) score *= 0.9;
  }

  if (subprojectIntent && topicCoverage.matchedCount > 0) {
    const baseBoost = hasNarrowSubprojectIntent ? 30 : 14;
    const coverageBoost = hasNarrowSubprojectIntent ? 42 : 20;
    score += baseBoost + (topicCoverage.coverage * coverageBoost);
  } else if (subprojectIntent && topicCoverage.matchedCount < 1) {
    score *= hasNarrowSubprojectIntent ? 0.8 : 0.93;
  }
  return score;
}

function rankDocsForQuery(docs, query, advancedOptions = null) {
  const entries = Array.isArray(docs) ? docs : [];
  if (!entries.length) return [];
  if (!docsFiltersSupported(advancedOptions)) return [];

  const normalizedQuery = normalizeSearchText(query);
  const hasAdvanced = hasAdvancedSearchOptions(advancedOptions || {});
  const hasTextAdvanced = !!(
    normalizeAdvancedText(advancedOptions && advancedOptions.allWords)
    || normalizeAdvancedText(advancedOptions && advancedOptions.exactPhrase)
    || normalizeAdvancedText(advancedOptions && advancedOptions.anyWords)
    || normalizeAdvancedText(advancedOptions && advancedOptions.withoutWords)
  );

  if (!normalizedQuery && !hasTextAdvanced && !hasAdvanced) {
    return [...entries].sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
  }

  const model = buildSearchQueryModel(query, advancedOptions || undefined);
  const scored = [];
  for (const doc of entries) {
    const score = scoreDocsRecordByQuery(doc, query, advancedOptions, model);
    if (score > 0) scored.push({ doc, score });
  }

  scored.sort((a, b) =>
    (Number(b.score || 0) - Number(a.score || 0))
    || String((a.doc && a.doc.title) || '').localeCompare(String((b.doc && b.doc.title) || ''))
  );

  return scored
    .slice(0, DOCS_UNIVERSAL_SEARCH_LIMIT)
    .map((entry) => ({
      ...entry.doc,
      _workSearchScore: Number(entry.score || 0),
    }));
}

function recomputeFilteredResults() {
  if (state.mode === 'search') {
    if (!hasActiveSearchCriteria()) {
      filteredTalks = [];
      filteredPapers = [];
      filteredBlogs = [];
      filteredPeople = [];
      filteredDocs = [];
      filteredUniversal = [];
      searchResultCounts = {
        all: 0,
        talks: 0,
        papers: 0,
        blogs: 0,
        docs: 0,
        people: 0,
      };
      syncScopeControlCounts();
      return;
    }

    const filterWindow = resolveTimeFilterWindow();
    const advancedOptions = buildAdvancedSearchOptions();
    const rankedTalks = rankTalksForQuery(allTalkRecords, state.query, advancedOptions);
    const rankedPapers = rankPapersForQuery(allPaperRecords, state.query, advancedOptions);
    const rankedBlogs = rankPapersForQuery(allBlogRecords, state.query, advancedOptions);
    const rankedPeople = rankPeopleForQuery(allPeopleRecords, state.query, advancedOptions);
    const rankedDocs = rankDocsForQuery(allDocsRecords, state.query, advancedOptions);
    const scopedTalks = rankedTalks.filter((talk) => matchesTalkSearchFilters(talk, filterWindow));
    const scopedPapers = rankedPapers.filter((paper) => matchesPaperSearchFilters(paper, filterWindow));
    const scopedBlogs = rankedBlogs.filter((paper) => matchesPaperSearchFilters(paper, filterWindow));
    const personContextScores = buildPersonContextScoreMap(scopedTalks, scopedPapers, scopedBlogs);
    const scopedPeople = rankPeopleWithContext(rankedPeople, personContextScores, filterWindow);
    filteredTalks = sortTalkResults(scopedTalks);
    filteredPapers = sortPaperResults(scopedPapers);
    filteredBlogs = sortPaperResults(scopedBlogs);
    filteredPeople = sortPeopleResults(scopedPeople);
    filteredDocs = rankedDocs;
    const universalEntries = buildUniversalResultsFromRankedLists(
      scopedTalks,
      scopedPapers,
      scopedBlogs,
      scopedPeople,
      rankedDocs,
      state.query,
      advancedOptions
    );
    filteredUniversal = universalEntries;
    searchResultCounts = {
      all: universalEntries.length,
      talks: filteredTalks.length,
      papers: filteredPapers.length,
      blogs: filteredBlogs.length,
      docs: filteredDocs.length,
      people: filteredPeople.length,
    };
    syncScopeControlCounts();
    return;
  }

  searchResultCounts = {
    all: 0,
    talks: 0,
    papers: 0,
    blogs: 0,
    docs: 0,
    people: 0,
  };
  filteredDocs = [];
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

  if (state.kind === 'speaker') {
    const exactPerson = findPersonRecordByName(state.value);
    if (exactPerson) {
      filteredPeople = sortPeopleResults([exactPerson]);
    } else {
      const personKeys = buildPersonKeySetFromResults(filteredTalks, filteredPapers, filteredBlogs);
      filteredPeople = sortPeopleResults(allPeopleRecords.filter((person) => personRecordMatchesKeySet(person, personKeys)));
    }
  } else {
    const personKeys = buildPersonKeySetFromResults(filteredTalks, filteredPapers, filteredBlogs);
    filteredPeople = sortPeopleResults(allPeopleRecords.filter((person) => personRecordMatchesKeySet(person, personKeys)));
  }
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

function resolveHighlightTokens(defaultQuery, overrideTokens = null) {
  if (Array.isArray(overrideTokens)) return overrideTokens;
  const query = String(defaultQuery || '').trim();
  if (!query) return [];
  return tokenizeQuery(query);
}

function renderEntityLinks(items, kind, tokensOverride = null) {
  if (!items || items.length === 0) return '';

  const tokens = resolveHighlightTokens(state.mode === 'search' ? state.query : '', tokensOverride);

  return items
    .map((label) => {
      const value = String(label || '').trim();
      if (!value) return '';
      return `<a class="speaker-btn" href="${escapeHtml(buildWorkUrl(kind, value))}">${highlightText(value, tokens)}</a>`;
    })
    .filter(Boolean)
    .join('<span class="speaker-btn-sep">, </span>');
}

function renderTagLinks(tags, tokensOverride = null) {
  if (!tags || tags.length === 0) return '';

  const tokens = resolveHighlightTokens(state.mode === 'search' ? state.query : '', tokensOverride);
  const shown = tags.slice(0, 4);
  return `<div class="card-tags-wrap"><div class="card-tags" aria-label="Key Topics">${shown
    .map((tag) => `<a class="card-tag" href="${escapeHtml(buildWorkUrl('topic', tag))}">${highlightText(tag, tokens)}</a>`)
    .join('')}${tags.length > shown.length ? `<span class="card-tag card-tag--more" aria-hidden="true">+${tags.length - shown.length}</span>` : ''}</div></div>`;
}

function renderTalkCard(talk, tokensOverride = null) {
  const query = state.mode === 'search' ? state.query : '';
  const tokens = resolveHighlightTokens(query, tokensOverride);
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
  const speakersHtml = renderEntityLinks(speakerNames, 'speaker', tokens);

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
      ${renderTagLinks(getTalkKeyTopics(talk, 8), tokens)}
      ${hasActions ? `<div class="card-footer">${videoLinkHtml}${slidesLinkHtml}${githubLinkHtml}</div>` : ''}
    </article>`;
}

function renderPaperCard(paper, tokensOverride = null) {
  const query = state.mode === 'search' ? state.query : '';
  const tokens = resolveHighlightTokens(query, tokensOverride);
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
  const authorsHtml = renderEntityLinks(authorNames, 'speaker', tokens);
  const topics = getPaperKeyTopics(paper, 8);
  const paperIsPdf = isDirectPdfUrl(paper.paperUrl || '');
  const sourceIsPdf = isDirectPdfUrl(paper.sourceUrl || '');
  const sourceHref = sanitizeExternalUrl(paper.sourceUrl);
  const paperHref = sanitizeExternalUrl(paper.paperUrl);
  const detailHref = `papers/paper.html?id=${encodeURIComponent(paper.id || '')}&from=${listingFrom}`;
  const directPdfHref = !blogEntry
    ? (paperIsPdf && paperHref
      ? paperHref
      : (sourceIsPdf && sourceHref ? sourceHref : ''))
    : '';
  const pdfLink = directPdfHref
    ? `<a href="${escapeHtml(directPdfHref)}" class="card-link-btn card-link-btn--video" target="_blank" rel="noopener noreferrer" aria-label="Open PDF for ${titleEsc} (opens in new tab)"><span aria-hidden="true">PDF</span></a>`
    : '';
  const detailLink = (!blogEntry && directPdfHref)
    ? `<a href="${escapeHtml(detailHref)}" class="card-link-btn" aria-label="Open detail page for ${titleEsc}"><span aria-hidden="true">Detail</span></a>`
    : '';
  const paperActionLabel = blogEntry ? 'Post' : 'Paper';
  const paperLink = (paperHref && !directPdfHref)
    ? `<a href="${escapeHtml(paperHref)}" class="card-link-btn card-link-btn--video" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHtml(paperActionLabel)} for ${titleEsc} (opens in new tab)"><span aria-hidden="true">${escapeHtml(paperActionLabel)}</span></a>`
    : '';
  const citationCount = Number.isFinite(paper._citationCount) ? paper._citationCount : 0;
  const citationHtml = citationCount > 0
    ? `<span class="paper-citation-count" aria-label="${citationCount.toLocaleString()} citations">${citationCount.toLocaleString()} citation${citationCount === 1 ? '' : 's'}</span>`
    : '';

  return `
    <article class="talk-card paper-card">
      <a href="${escapeHtml(detailHref)}" class="card-link-wrap" aria-label="${titleEsc}${authorLabel ? ` by ${escapeHtml(authorLabel)}` : ''}">
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
      ${renderTagLinks(topics, tokens)}
      ${(pdfLink || detailLink || paperLink || citationHtml) ? `<div class="card-footer">${pdfLink}${detailLink}${paperLink}${citationHtml}</div>` : ''}
    </article>`;
}

function renderPersonCard(person, tokensOverride = null) {
  const query = state.mode === 'search' ? state.query : state.value;
  const tokens = resolveHighlightTokens(query, tokensOverride);
  const titleEsc = escapeHtml(person.name || 'Unknown person');
  const variantNames = getPersonVariantNames(person).filter((name) => !samePersonName(name, person.name));
  const variantLinksHtml = variantNames
    .slice(0, 4)
    .map((name) => `<a class="person-variant-pill" href="${escapeHtml(buildWorkUrl('speaker', name))}" aria-label="Open all work for ${escapeHtml(name)}">${highlightText(name, tokens)}</a>`)
    .join('');
  const variantsHtml = variantLinksHtml
    ? `<div class="person-variants" aria-label="Name variants">
        <span class="person-variants-label">Also appears as</span>
        ${variantLinksHtml}
      </div>`
    : '';

  const talksLabel = Number(person.talkCount || 0);
  const papersLabel = Number(person.paperCount || 0);
  const blogsLabel = Number(person.blogCount || 0);
  const citationCount = Number(person.citationCount || 0);
  const allWorkUrl = buildWorkUrl('speaker', person.name);
  const talksUrl = `talks/?speaker=${encodeURIComponent(person.talkFilterName || person.name || '')}`;
  const papersUrl = `papers/?speaker=${encodeURIComponent(person.paperFilterName || person.name || '')}`;
  const blogsUrl = `blogs/?speaker=${encodeURIComponent(person.blogFilterName || person.paperFilterName || person.name || '')}`;
  const citationsHtml = citationCount > 0
    ? `<span class="meeting-label">${citationCount.toLocaleString()} citations</span>`
    : '';

  const talksLink = talksLabel > 0
    ? `<a class="card-link-btn" href="${talksUrl}" aria-label="Open talks for ${titleEsc}">
        <span aria-hidden="true">Talks ${talksLabel.toLocaleString()}</span>
      </a>`
    : `<span class="card-link-btn card-link-btn--disabled" aria-hidden="true">Talks 0</span>`;

  const papersLink = papersLabel > 0
    ? `<a class="card-link-btn" href="${papersUrl}" aria-label="Open papers for ${titleEsc}">
        <span aria-hidden="true">Papers ${papersLabel.toLocaleString()}</span>
      </a>`
    : `<span class="card-link-btn card-link-btn--disabled" aria-hidden="true">Papers 0</span>`;

  const blogsLink = blogsLabel > 0
    ? `<a class="card-link-btn" href="${blogsUrl}" aria-label="Open blogs for ${titleEsc}">
        <span aria-hidden="true">Blogs ${blogsLabel.toLocaleString()}</span>
      </a>`
    : `<span class="card-link-btn card-link-btn--disabled" aria-hidden="true">Blogs 0</span>`;

  return `
    <article class="talk-card person-card">
      <a href="${escapeHtml(allWorkUrl)}" class="card-link-wrap" aria-label="Open all work for ${titleEsc}">
        <div class="card-body">
          <div class="card-meta">
            <span class="meeting-label">${Number(person.totalCount || 0).toLocaleString()} works</span>
            ${citationsHtml}
          </div>
          <p class="card-title">${highlightText(person.name || 'Unknown person', tokens)}</p>
        </div>
      </a>
      ${variantsHtml}
      <div class="card-footer person-card-footer">
        <div class="person-work-links">
          ${talksLink}
          ${papersLink}
          ${blogsLink}
          <a class="card-link-btn card-link-btn--video" href="${escapeHtml(allWorkUrl)}" aria-label="Open all work for ${titleEsc}">
            <span aria-hidden="true">All Work</span>
          </a>
        </div>
      </div>
    </article>`;
}

function renderDocsCard(doc, tokensOverride = null) {
  const query = state.mode === 'search' ? state.query : '';
  const tokens = resolveHighlightTokens(query, tokensOverride);
  const titleEsc = escapeHtml(doc.title || 'Documentation');
  const chapter = String(doc.chapter || '').trim();
  const outline = String(doc.outline || '').trim();
  const slugLabel = String(doc.slug || '').trim() || 'index';
  const summary = buildContextSnippet(doc.summary || doc.search || '', query, 320);
  const headingPreview = Array.isArray(doc.headings)
    ? doc.headings.slice(0, 2).filter(Boolean).join(' · ')
    : '';
  const href = String(doc.href || '').trim() || 'docs/';

  return `
    <article class="talk-card paper-card docs-card">
      <a href="${escapeHtml(href)}" class="card-link-wrap" aria-label="Open docs page: ${titleEsc}">
        <div class="card-body">
          <div class="card-meta">
            <span class="badge badge-blog">Docs</span>
            ${doc.collection ? `<span class="meeting-label">${escapeHtml(doc.collection)}</span>` : ''}
            ${chapter ? `<span class="meeting-label">${escapeHtml(chapter)}</span>` : ''}
            ${outline ? `<span class="meeting-label">${escapeHtml(outline)}</span>` : ''}
          </div>
          <p class="card-title">${highlightText(doc.title || 'Documentation', tokens)}</p>
          ${summary ? `<p class="card-abstract">${highlightText(summary, tokens)}</p>` : ''}
          <p class="card-speakers paper-authors">${escapeHtml(slugLabel)}</p>
          ${headingPreview ? `<p class="card-speakers paper-authors">${highlightText(headingPreview, tokens)}</p>` : ''}
        </div>
      </a>
      <div class="card-footer">
        <a href="${escapeHtml(href)}" class="card-link-btn card-link-btn--video" aria-label="Open docs page: ${titleEsc}">
          <span aria-hidden="true">Open Doc</span>
        </a>
      </div>
    </article>`;
}

function renderUniversalCard(entry, tokensOverride = null) {
  if (!entry || typeof entry !== 'object') return '';
  if (entry.kind === 'talk' && entry.talk) return renderTalkCard(entry.talk, tokensOverride);
  if (entry.kind === 'person' && entry.person) return renderPersonCard(entry.person, tokensOverride);
  if (entry.kind === 'docs' && entry.doc) return renderDocsCard(entry.doc, tokensOverride);
  if ((entry.kind === 'paper' || entry.kind === 'blog') && entry.paper) return renderPaperCard(entry.paper, tokensOverride);
  return '';
}

function setEmptyState(gridOrId, label) {
  const grid = typeof gridOrId === 'string'
    ? getNodeById(gridOrId)
    : gridOrId;
  if (!grid) return;
  grid.setAttribute('aria-busy', 'false');
  const scopeValue = state.mode === 'search'
    ? (buildSearchDisplayValue() || state.query)
    : state.value;
  const scope = scopeValue ? ` for "${escapeHtml(scopeValue)}"` : '';
  grid.innerHTML = `<div class="work-empty-state">No ${escapeHtml(label)} found${scope}.</div>`;
}

function renderBatch({
  gridId,
  moreBtnId,
  items,
  batchSize,
  renderedCount,
  reset = false,
  emptyLabel,
  moreLabel,
  renderItem,
  tokens = null,
}) {
  const grid = getNodeById(gridId);
  const moreBtn = getNodeById(moreBtnId);
  if (!grid || !moreBtn || typeof renderItem !== 'function') return renderedCount;

  if (reset) {
    grid.innerHTML = '';
    renderedCount = 0;
  }

  const values = Array.isArray(items) ? items : [];
  if (!values.length) {
    moreBtn.classList.add('hidden');
    setEmptyState(grid, emptyLabel);
    return 0;
  }

  const nextCount = Math.min(renderedCount + batchSize, values.length);
  let html = '';
  for (let index = renderedCount; index < nextCount; index += 1) {
    html += renderItem(values[index], tokens);
  }
  if (html) grid.insertAdjacentHTML('beforeend', html);
  grid.setAttribute('aria-busy', 'false');

  const remaining = values.length - nextCount;
  if (remaining > 0) {
    moreBtn.textContent = `Show more ${moreLabel} (${remaining.toLocaleString()} left)`;
    moreBtn.classList.remove('hidden');
  } else {
    moreBtn.classList.add('hidden');
  }

  return nextCount;
}

function renderUniversalBatch(reset = false) {
  const tokens = resolveHighlightTokens(state.mode === 'search' ? state.query : '', null);
  renderedUniversalCount = renderBatch({
    gridId: 'work-universal-grid',
    moreBtnId: 'work-universal-more',
    items: filteredUniversal,
    batchSize: UNIVERSAL_BATCH_SIZE,
    renderedCount: renderedUniversalCount,
    reset,
    emptyLabel: 'results',
    moreLabel: 'results',
    renderItem: renderUniversalCard,
    tokens,
  });
}

function renderTalkBatch(reset = false) {
  const tokens = resolveHighlightTokens(state.mode === 'search' ? state.query : '', null);
  renderedTalkCount = renderBatch({
    gridId: 'work-talks-grid',
    moreBtnId: 'work-talks-more',
    items: filteredTalks,
    batchSize: TALK_BATCH_SIZE,
    renderedCount: renderedTalkCount,
    reset,
    emptyLabel: 'talks',
    moreLabel: 'talks',
    renderItem: renderTalkCard,
    tokens,
  });
}

function renderPaperBatch(reset = false) {
  const tokens = resolveHighlightTokens(state.mode === 'search' ? state.query : '', null);
  renderedPaperCount = renderBatch({
    gridId: 'work-papers-grid',
    moreBtnId: 'work-papers-more',
    items: filteredPapers,
    batchSize: PAPER_BATCH_SIZE,
    renderedCount: renderedPaperCount,
    reset,
    emptyLabel: 'papers',
    moreLabel: 'papers',
    renderItem: renderPaperCard,
    tokens,
  });
}

function renderBlogBatch(reset = false) {
  const tokens = resolveHighlightTokens(state.mode === 'search' ? state.query : '', null);
  renderedBlogCount = renderBatch({
    gridId: 'work-blogs-grid',
    moreBtnId: 'work-blogs-more',
    items: filteredBlogs,
    batchSize: BLOG_BATCH_SIZE,
    renderedCount: renderedBlogCount,
    reset,
    emptyLabel: 'blogs',
    moreLabel: 'blogs',
    renderItem: renderPaperCard,
    tokens,
  });
}

function renderDocsBatch(reset = false) {
  const tokens = resolveHighlightTokens(state.mode === 'search' ? state.query : '', null);
  renderedDocsCount = renderBatch({
    gridId: 'work-docs-grid',
    moreBtnId: 'work-docs-more',
    items: filteredDocs,
    batchSize: DOCS_BATCH_SIZE,
    renderedCount: renderedDocsCount,
    reset,
    emptyLabel: 'docs',
    moreLabel: 'docs',
    renderItem: renderDocsCard,
    tokens,
  });
}

function renderPeopleBatch(reset = false) {
  const tokenQuery = state.mode === 'search' ? state.query : state.value;
  const tokens = resolveHighlightTokens(tokenQuery, null);
  renderedPeopleCount = renderBatch({
    gridId: 'work-people-grid',
    moreBtnId: 'work-people-more',
    items: filteredPeople,
    batchSize: PEOPLE_BATCH_SIZE,
    renderedCount: renderedPeopleCount,
    reset,
    emptyLabel: 'people',
    moreLabel: 'people',
    renderItem: renderPersonCard,
    tokens,
  });
}

function setWorkDocumentTitle(value) {
  const title = String(value || '').trim();
  document.title = title ? `${title} — LLVM Research Library` : 'LLVM Research Library';
}

function applyHeaderState() {
  const titleEl = getNodeById('work-title');
  const subtitleEl = getNodeById('work-subtitle');
  const summaryEl = getNodeById('work-results-summary');
  const universalCountEl = getNodeById('work-universal-count');
  const talksCountEl = getNodeById('work-talks-count');
  const papersCountEl = getNodeById('work-papers-count');
  const blogsCountEl = getNodeById('work-blogs-count');
  const docsCountEl = getNodeById('work-docs-count');
  const peopleCountEl = getNodeById('work-people-count');
  const backLink = getNodeById('work-back-link');

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
    const searchLabel = buildSearchDisplayValue() || state.query;
    if (!hasActiveSearchCriteria()) {
      if (titleEl) titleEl.textContent = 'Search All';
      if (subtitleEl) subtitleEl.textContent = 'Use Search All across talks, papers, blogs, docs, and people from one place.';
      if (summaryEl) summaryEl.textContent = 'No search query provided';
      if (universalCountEl) universalCountEl.textContent = '';
      if (talksCountEl) talksCountEl.textContent = '';
      if (papersCountEl) papersCountEl.textContent = '';
      if (blogsCountEl) blogsCountEl.textContent = '';
      if (docsCountEl) docsCountEl.textContent = '';
      if (peopleCountEl) peopleCountEl.textContent = '';
      setWorkDocumentTitle('Search All');
      return;
    }

    if (titleEl) titleEl.textContent = 'Search All';
    if (subtitleEl) {
      if (state.scope === 'all') {
        subtitleEl.innerHTML = `Results for <strong>${escapeHtml(searchLabel || 'advanced search')}</strong>, ranked across talks, papers, blogs, docs, and people`;
      } else {
        subtitleEl.innerHTML = `Results for <strong>${escapeHtml(searchLabel || 'advanced search')}</strong> in <strong>${escapeHtml(getSearchScopeLabel(state.scope))}</strong>`;
      }
    }
    setWorkDocumentTitle(`Search All: ${searchLabel || 'Advanced search'}${state.scope === 'all' ? '' : ` (${getSearchScopeLabel(state.scope)})`}`);
  } else {
    if (!state.value) {
      if (titleEl) titleEl.textContent = 'All Work';
      if (subtitleEl) subtitleEl.textContent = 'Choose a speaker or key topic to view related talks, papers, blogs, docs, and people.';
      if (summaryEl) summaryEl.textContent = 'No speaker/key topic selected';
      if (universalCountEl) universalCountEl.textContent = '';
      if (talksCountEl) talksCountEl.textContent = '';
      if (papersCountEl) papersCountEl.textContent = '';
      if (blogsCountEl) blogsCountEl.textContent = '';
      if (docsCountEl) docsCountEl.textContent = '';
      if (peopleCountEl) peopleCountEl.textContent = '';
      setWorkDocumentTitle('All Work');
      return;
    }

    if (titleEl) titleEl.textContent = `${entityLabel}: ${state.value}`;
    if (subtitleEl) {
      if (state.kind === 'speaker') {
        subtitleEl.innerHTML = `All Work for <strong>${escapeHtml(state.value)}</strong> across talks, papers, blogs, docs, and people`;
      } else {
        subtitleEl.innerHTML = `All Work for key topic <strong>${escapeHtml(state.value)}</strong> across talks, papers, blogs, docs, and people`;
      }
    }
    setWorkDocumentTitle(`All Work: ${entityLabel} ${state.value}`);
  }

  if (universalCountEl) {
    if (state.mode === 'search' && state.scope === 'all') {
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

  if (docsCountEl) {
    docsCountEl.textContent = `${filteredDocs.length.toLocaleString()} doc${filteredDocs.length === 1 ? '' : 's'}`;
  }

  if (peopleCountEl) {
    peopleCountEl.textContent = `${filteredPeople.length.toLocaleString()} people`;
  }

  if (summaryEl) {
    const sortLabel = state.sortBy === 'relevance'
      ? 'relevance'
      : state.sortBy === 'oldest'
        ? 'oldest'
        : state.sortBy === 'title'
          ? 'title'
          : state.sortBy === 'citations'
            ? 'citations'
            : 'newest';
    const activeFilterCount = getActiveFilterLabels().length;
    const filterSuffix = activeFilterCount
      ? ` · ${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} active`
      : '';
    if (state.mode === 'search') {
      const scopeTotal = getActiveSearchScopeCount();
      const allTotal = getSearchScopeCount('all');
      if (state.scope === 'all') {
        summaryEl.innerHTML = `<strong>${allTotal.toLocaleString()}</strong> results · Sorted by ${sortLabel}${filterSuffix}`;
      } else {
        const scopeLabel = getSearchScopeLabel(state.scope).toLowerCase();
        summaryEl.innerHTML = `<strong>${scopeTotal.toLocaleString()}</strong> ${scopeLabel} results · Sorted by ${sortLabel}${filterSuffix}`;
      }
    } else {
      const total = filteredTalks.length + filteredPapers.length + filteredBlogs.length + filteredPeople.length;
      summaryEl.innerHTML = `<strong>${total.toLocaleString()}</strong> results · Sorted by ${sortLabel}`;
    }
  }
}

function syncSortControl() {
  const select = getNodeById('work-sort-select');
  if (!select) return;
  const relevanceOption = select.querySelector('option[value="relevance"]');
  const citationsOption = select.querySelector('option[value="citations"]');
  if (relevanceOption) relevanceOption.disabled = state.mode !== 'search';
  if (citationsOption) citationsOption.disabled = state.mode === 'search' && state.scope === 'talks';
  select.value = normalizeSortMode(state.sortBy);
}

function syncViewControls() {
  const expandedBtn = getNodeById('work-view-expanded');
  const compactBtn = getNodeById('work-view-compact');
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
  const universalSection = getNodeById('work-universal-section');
  const talksSection = getNodeById('work-talks-section');
  const papersSection = getNodeById('work-papers-section');
  const blogsSection = getNodeById('work-blogs-section');
  const docsSection = getNodeById('work-docs-section');
  const peopleSection = getNodeById('work-people-section');

  if (!searchMode) {
    if (universalSection) universalSection.classList.add('hidden');
    if (talksSection) talksSection.classList.remove('hidden');
    if (papersSection) papersSection.classList.remove('hidden');
    if (blogsSection) blogsSection.classList.remove('hidden');
    if (docsSection) docsSection.classList.add('hidden');
    if (peopleSection) peopleSection.classList.remove('hidden');
    return;
  }

  if (universalSection) universalSection.classList.toggle('hidden', state.scope !== 'all');
  if (talksSection) talksSection.classList.toggle('hidden', state.scope !== 'talks');
  if (papersSection) papersSection.classList.toggle('hidden', state.scope !== 'papers');
  if (blogsSection) blogsSection.classList.toggle('hidden', state.scope !== 'blogs');
  if (docsSection) docsSection.classList.toggle('hidden', state.scope !== 'docs');
  if (peopleSection) peopleSection.classList.toggle('hidden', state.scope !== 'people');
}

function applyViewMode(mode, persist = true, refreshHeader = true) {
  state.viewMode = mode === 'compact' ? 'compact' : 'expanded';
  const gridClass = state.viewMode === 'compact' ? 'talks-list' : 'talks-grid';
  ['work-universal-grid', 'work-talks-grid', 'work-papers-grid', 'work-blogs-grid', 'work-docs-grid'].forEach((id) => {
    const el = getNodeById(id);
    if (el) el.className = gridClass;
  });
  const peopleGrid = getNodeById('work-people-grid');
  if (peopleGrid) {
    peopleGrid.className = `${gridClass} people-grid`;
  }
  syncViewControls();
  if (refreshHeader) applyHeaderState();

  if (persist) {
    safeStorageSet(WORK_VIEW_STORAGE_KEY, state.viewMode);
  }
}

function rerenderWorkSections() {
  syncScopeControlVisibility();
  syncScopeControls();
  syncAdvancedFilterControls();
  syncSearchSectionVisibility();
  applyHeaderState();
  if (state.mode === 'search') {
    if (state.scope === 'talks') {
      renderTalkBatch(true);
      return;
    }
    if (state.scope === 'papers') {
      renderPaperBatch(true);
      return;
    }
    if (state.scope === 'blogs') {
      renderBlogBatch(true);
      return;
    }
    if (state.scope === 'docs') {
      renderDocsBatch(true);
      return;
    }
    if (state.scope === 'people') {
      renderPeopleBatch(true);
      return;
    }
    renderUniversalBatch(true);
    return;
  }
  renderTalkBatch(true);
  renderPaperBatch(true);
  renderBlogBatch(true);
  renderPeopleBatch(true);
}

function initSortControl() {
  const select = getNodeById('work-sort-select');
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
  const expandedBtn = getNodeById('work-view-expanded');
  const compactBtn = getNodeById('work-view-compact');

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
  const universalGrid = getNodeById('work-universal-grid');
  const talksGrid = getNodeById('work-talks-grid');
  const papersGrid = getNodeById('work-papers-grid');
  const blogsGrid = getNodeById('work-blogs-grid');
  const docsGrid = getNodeById('work-docs-grid');
  const peopleGrid = getNodeById('work-people-grid');
  const summaryEl = getNodeById('work-results-summary');

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

  if (docsGrid) {
    docsGrid.setAttribute('aria-busy', 'false');
    docsGrid.innerHTML = html;
  }

  if (peopleGrid) {
    peopleGrid.setAttribute('aria-busy', 'false');
    peopleGrid.innerHTML = html;
  }
}

function initWorkHeroSearch() {
  const input = getNodeById('work-search-input');
  const clearBtn = getNodeById('work-search-clear');
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

function buildPeopleRecordsWithMetadata(talks, papers, blogs) {
  const basePeople = buildPeopleIndex(talks, [...papers, ...blogs]);
  const statsByKey = new Map();

  const recordYear = (name, year) => {
    const key = normalizePersonKey(name);
    if (!key || !Number.isFinite(year) || year <= 0) return;
    if (!statsByKey.has(key)) {
      statsByKey.set(key, { latestYear: 0, earliestYear: 0 });
    }
    const stats = statsByKey.get(key);
    if (year > Number(stats.latestYear || 0)) stats.latestYear = year;
    if (!stats.earliestYear || year < Number(stats.earliestYear || 0)) stats.earliestYear = year;
  };

  for (const talk of (talks || [])) {
    const year = getTalkYear(talk);
    for (const speaker of (talk && talk.speakers) || []) {
      recordYear(speaker && speaker.name, year);
    }
  }
  for (const paper of (papers || [])) {
    const year = getPaperYear(paper);
    for (const author of (paper && paper.authors) || []) {
      recordYear(author && author.name, year);
    }
  }
  for (const blog of (blogs || [])) {
    const year = getPaperYear(blog);
    for (const author of (blog && blog.authors) || []) {
      recordYear(author && author.name, year);
    }
  }

  return basePeople.map((person) => {
    let latestYear = 0;
    let earliestYear = 0;
    for (const variant of getPersonVariantNames(person)) {
      const stats = statsByKey.get(normalizePersonKey(variant));
      if (!stats) continue;
      if (Number(stats.latestYear || 0) > latestYear) latestYear = Number(stats.latestYear || 0);
      const candidateEarliest = Number(stats.earliestYear || 0);
      if (candidateEarliest > 0 && (!earliestYear || candidateEarliest < earliestYear)) {
        earliestYear = candidateEarliest;
      }
    }
    return {
      ...person,
      _latestYear: latestYear,
      _earliestYear: earliestYear,
    };
  });
}

async function init() {
  initTheme();
  initTextSize();
  initCustomizationMenu();
  initMobileNavMenu();
  initShareMenu();
  initWorkHeroSearch();
  parseStateFromUrl();
  initScopeControl();
  initAdvancedFilterControls();
  applySearchFilterControls({ normalizeOnly: true });
  initSortControl();
  initViewControls();
  syncScopeControlVisibility();
  syncAdvancedFilterControlVisibility();
  syncSearchSectionVisibility();
  updateIssueContextForWork();
  syncGlobalSearchInput();

  if (state.mode === 'search' && !hasActiveSearchCriteria()) {
    applyHeaderState();
    setEmptyState('work-universal-grid', 'results');
    setEmptyState('work-talks-grid', 'talks');
    setEmptyState('work-papers-grid', 'papers');
    setEmptyState('work-blogs-grid', 'blogs');
    setEmptyState('work-docs-grid', 'docs');
    setEmptyState('work-people-grid', 'people');
    return;
  }

  if (state.mode === 'entity' && !state.value) {
    applyHeaderState();
    setEmptyState('work-universal-grid', 'results');
    setEmptyState('work-talks-grid', 'talks');
    setEmptyState('work-papers-grid', 'papers');
    setEmptyState('work-blogs-grid', 'blogs');
    setEmptyState('work-docs-grid', 'docs');
    setEmptyState('work-people-grid', 'people');
    return;
  }

  if (typeof window.loadEventData !== 'function' || typeof window.loadPaperData !== 'function') {
    renderError('Data loaders are unavailable on this page.');
    return;
  }

  try {
    const [eventPayload, paperPayload, docsPayload] = await Promise.all([
      window.loadEventData(),
      window.loadPaperData(),
      loadDocsUniversalRecords(),
    ]);

    const talks = normalizeTalksFromHub(eventPayload.talks || []);

    const papers = Array.isArray(paperPayload.papers)
      ? paperPayload.papers.map(normalizePaperRecord).filter(Boolean)
      : [];
    const paperOnly = papers.filter((paper) => !isBlogPaper(paper));
    const blogsOnly = papers.filter((paper) => isBlogPaper(paper));
    allTalkRecords = talks;
    allPaperRecords = paperOnly;
    allBlogRecords = blogsOnly;
    allPeopleRecords = buildPeopleRecordsWithMetadata(talks, paperOnly, blogsOnly);
    allDocsRecords = Array.isArray(docsPayload) ? docsPayload : [];
    recomputeFilteredResults();
    rerenderWorkSections();

    const talksMoreBtn = getNodeById('work-talks-more');
    const papersMoreBtn = getNodeById('work-papers-more');
    const blogsMoreBtn = getNodeById('work-blogs-more');
    const docsMoreBtn = getNodeById('work-docs-more');
    const peopleMoreBtn = getNodeById('work-people-more');
    const universalMoreBtn = getNodeById('work-universal-more');

    if (universalMoreBtn) universalMoreBtn.addEventListener('click', () => renderUniversalBatch(false));
    if (talksMoreBtn) talksMoreBtn.addEventListener('click', () => renderTalkBatch(false));
    if (papersMoreBtn) papersMoreBtn.addEventListener('click', () => renderPaperBatch(false));
    if (blogsMoreBtn) blogsMoreBtn.addEventListener('click', () => renderBlogBatch(false));
    if (docsMoreBtn) docsMoreBtn.addEventListener('click', () => renderDocsBatch(false));
    if (peopleMoreBtn) peopleMoreBtn.addEventListener('click', () => renderPeopleBatch(false));
  } catch (error) {
    renderError(`Could not load data: ${String(error && error.message ? error.message : error)}`);
  }
}

init();

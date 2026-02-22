/**
 * paper.js — Paper detail page logic for LLVM Research Library
 */

const HubUtils = window.LLVMHubUtils || {};
const BLOG_SOURCE_SLUG = 'llvm-blog-www';
const BLOG_SOURCE_SLUG_ALIASES = new Set([
  BLOG_SOURCE_SLUG,
  'llvm-www-blog',
]);
const PAPERS_PAGE_PATH = 'papers.html';
const BLOGS_PAGE_PATH = 'blogs.html';

// ============================================================
// Data Loading
// ============================================================

function cleanMetadataValue(value) {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const lowered = cleaned.toLowerCase();
  if (['none', 'null', 'nan', 'n/a'].includes(lowered)) return '';
  return cleaned;
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
  paper.source = String(paper.source || '').trim();
  paper.type = String(paper.type || '').trim();
  paper.paperUrl = String(paper.paperUrl || '').trim();
  paper.sourceUrl = String(paper.sourceUrl || '').trim();
  paper.contentFormat = String(paper.contentFormat || paper.bodyFormat || '').trim().toLowerCase();
  paper.content = String(paper.content || paper.body || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  paper.citationCount = parseCitationCount(rawPaper);
  paper.openalexId = normalizeOpenAlexId(
    paper.openalexId ||
    paper.openAlexId ||
    rawPaper.openalexId ||
    rawPaper.openAlexId
  );
  paper.doi = extractDoi(rawPaper.doi) || extractDoi(paper.paperUrl) || extractDoi(paper.sourceUrl);

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
  const normalizedType = paper.type.toLowerCase();
  const normalizedSource = paper.source.toLowerCase();
  paper._isBlog = BLOG_SOURCE_SLUG_ALIASES.has(normalizedSource) || normalizedType === 'blog-post' || normalizedType === 'blog';
  return paper;
}

function normalizePapers(rawPapers) {
  if (!Array.isArray(rawPapers)) return null;
  return rawPapers.map(normalizePaperRecord).filter(Boolean);
}

async function loadPapers() {
  if (typeof window.loadPaperData !== 'function') return null;
  try {
    const { papers } = await window.loadPaperData();
    return normalizePapers(papers);
  } catch {
    return null;
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

function setIssueContext(context) {
  if (typeof window.setLibraryIssueContext !== 'function') return;
  if (!context || typeof context !== 'object') return;
  window.setLibraryIssueContext(context);
}

function setIssueContextForPaper(paper) {
  if (!paper || typeof paper !== 'object') return;
  const itemType = isBlogPaper(paper) ? 'Blog' : 'Paper';
  setIssueContext({
    pageType: 'Paper',
    itemType,
    itemId: String(paper.id || '').trim(),
    itemTitle: String(paper.title || '').trim(),
    pageTitle: `${String(paper.title || '').trim()} — LLVM Research Library`,
    year: String(paper._year || '').trim(),
    paperUrl: String(paper.paperUrl || '').trim(),
    sourceUrl: String(paper.sourceUrl || '').trim(),
    doi: String(paper.doi || '').trim(),
    openalexId: String(paper.openalexId || '').trim(),
  });
}

function normalizePaperType(type) {
  const raw = String(type || '').trim().toLowerCase();
  if (!raw) return 'Paper';
  if (raw === 'thesis') return 'Thesis';
  if (raw === 'presentation-paper') return 'Presentation Paper';
  if (raw === 'research-paper') return 'Research Paper';
  return raw
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function isBlogPaper(paper) {
  return !!(paper && paper._isBlog);
}

function getListingPathForPaper(paper) {
  return isBlogPaper(paper) ? BLOGS_PAGE_PATH : PAPERS_PAGE_PATH;
}

function getListingLabelForPaper(paper) {
  return isBlogPaper(paper) ? 'blogs' : 'papers';
}

function buildSpeakerWorkUrl(name, paper) {
  const params = new URLSearchParams();
  params.set('kind', 'speaker');
  params.set('value', String(name || '').trim());
  params.set('from', isBlogPaper(paper) ? 'blogs' : 'papers');
  return `work.html?${params.toString()}`;
}

function setHeaderNavActive(link, active) {
  if (!link) return;
  link.classList.toggle('active', !!active);
  if (active) link.setAttribute('aria-current', 'page');
  else link.removeAttribute('aria-current');
}

function syncHeaderNavForPaper(paper) {
  const blogEntry = isBlogPaper(paper);
  const desktopPapers = document.getElementById('paper-nav-link-papers');
  const desktopBlogs = document.getElementById('paper-nav-link-blogs');
  const mobilePapers = document.getElementById('paper-nav-mobile-papers');
  const mobileBlogs = document.getElementById('paper-nav-mobile-blogs');

  setHeaderNavActive(desktopPapers, !blogEntry);
  setHeaderNavActive(desktopBlogs, blogEntry);
  setHeaderNavActive(mobilePapers, !blogEntry);
  setHeaderNavActive(mobileBlogs, blogEntry);
}

function fallbackListingPathFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const from = String(params.get('from') || '').trim().toLowerCase();
  return from === 'blogs' ? BLOGS_PAGE_PATH : PAPERS_PAGE_PATH;
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

function normalizeOpenAlexId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\/openalex\.org\/W\d+$/i.test(raw)) return raw;
  if (/^W\d+$/i.test(raw)) return `https://openalex.org/${raw.toUpperCase()}`;
  return '';
}

function extractDoi(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const doiUrlMatch = raw.match(/https?:\/\/(?:dx\.)?doi\.org\/(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i);
  if (doiUrlMatch && doiUrlMatch[1]) return doiUrlMatch[1];

  const bareMatch = raw.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i);
  if (bareMatch && bareMatch[0]) return bareMatch[0];

  return '';
}

function doiUrlFromValue(doi) {
  const normalized = String(doi || '').trim();
  if (!normalized) return '';
  return `https://doi.org/${normalized}`;
}

function truncateText(value, maxLength = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function normalizeKeywordKey(value) {
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
    const key = normalizeKeywordKey(label);
    if (!label || !key || seen.has(key)) return;
    seen.add(key);
    out.push(label);
  };

  for (const tag of (paper.tags || [])) add(tag);
  for (const keyword of (paper.keywords || [])) add(keyword);

  return Number.isFinite(limit) ? out.slice(0, limit) : out;
}

function makeBibtexKey(paper) {
  const firstAuthor = (paper.authors && paper.authors[0] && paper.authors[0].name)
    ? paper.authors[0].name
    : 'paper';
  const authorSlug = String(firstAuthor).toLowerCase().replace(/[^a-z0-9]/g, '');
  const year = paper._year || 'xxxx';
  const titleSlug = String(paper.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16);
  const stem = authorSlug || titleSlug || 'paper';
  return `${stem}${year}${titleSlug ? `-${titleSlug}` : ''}`;
}

function escapeBibtexValue(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}');
}

function buildBibtexEntry(paper) {
  const type = paper.type === 'thesis' ? 'phdthesis' : 'article';
  const fields = [];

  fields.push(`title = {${escapeBibtexValue(paper.title)}}`);

  if (paper.authors && paper.authors.length) {
    const authorValue = paper.authors.map((author) => author.name).filter(Boolean).join(' and ');
    if (authorValue) fields.push(`author = {${escapeBibtexValue(authorValue)}}`);
  }
  if (paper._year) fields.push(`year = {${escapeBibtexValue(paper._year)}}`);
  if (paper.publication) fields.push(`journal = {${escapeBibtexValue(paper.publication)}}`);
  if (paper.venue && paper.venue !== paper.publication) fields.push(`booktitle = {${escapeBibtexValue(paper.venue)}}`);
  if (paper.doi) fields.push(`doi = {${escapeBibtexValue(paper.doi)}}`);
  if (paper.paperUrl) fields.push(`url = {${escapeBibtexValue(paper.paperUrl)}}`);

  const key = makeBibtexKey(paper);
  return `@${type}{${key},\n  ${fields.join(',\n  ')}\n}`;
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

function upsertMetaTag(attrName, attrValue, content) {
  if (!content) return;
  const existing = Array.from(document.head.querySelectorAll(`meta[${attrName}]`))
    .find((meta) => meta.getAttribute(attrName) === attrValue);
  const el = existing || document.createElement('meta');
  if (!existing) {
    el.setAttribute(attrName, attrValue);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertCanonical(url) {
  if (!url) return;
  let link = document.head.querySelector('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', 'canonical');
    document.head.appendChild(link);
  }
  link.setAttribute('href', url);
}

function upsertJsonLd(scriptId, payload) {
  if (!payload) return;
  let script = document.getElementById(scriptId);
  if (!script) {
    script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = scriptId;
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(payload);
}

function updatePaperSeoMetadata(paper) {
  const canonical = new URL(window.location.href);
  canonical.search = '';
  canonical.hash = '';
  canonical.searchParams.set('id', paper.id);
  const canonicalUrl = canonical.toString();
  const descriptionSource = paper.abstract || paper.content || `${paper.title}.`;
  const description = truncateText(
    String(descriptionSource || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
    180
  ) || truncateText(`${paper.title}.`, 180);
  const schemaType = isBlogPaper(paper) ? 'BlogPosting' : 'ScholarlyArticle';
  const publishedStamp = paper._publishedDate || (paper._year ? `${paper._year}-01-01` : '');

  upsertCanonical(canonicalUrl);
  upsertMetaTag('name', 'description', description);

  upsertMetaTag('property', 'og:type', 'article');
  upsertMetaTag('property', 'og:site_name', "LLVM Research Library");
  upsertMetaTag('property', 'og:title', paper.title);
  upsertMetaTag('property', 'og:description', description);
  upsertMetaTag('property', 'og:url', canonicalUrl);
  if (publishedStamp) upsertMetaTag('property', 'article:published_time', publishedStamp);

  upsertMetaTag('name', 'twitter:card', 'summary');
  upsertMetaTag('name', 'twitter:title', paper.title);
  upsertMetaTag('name', 'twitter:description', description);

  const authors = (paper.authors || [])
    .map((author) => String(author.name || '').trim())
    .filter(Boolean);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': schemaType,
    headline: paper.title,
    name: paper.title,
    description,
    author: authors.map((name) => ({ '@type': 'Person', name })),
    datePublished: publishedStamp || undefined,
    isPartOf: paper.publication ? { '@type': 'PublicationIssue', name: paper.publication } : undefined,
    keywords: getPaperKeyTopics(paper).join(', ') || undefined,
    url: canonicalUrl,
    sameAs: paper.openalexId || undefined,
    identifier: paper.doi
      ? { '@type': 'PropertyValue', propertyID: 'DOI', value: paper.doi }
      : undefined,
    mainEntityOfPage: canonicalUrl,
  };
  upsertJsonLd('paper-jsonld', jsonLd);
}

// ============================================================
// Header Menus
// ============================================================

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
    if (menu.classList.contains('open')) closeMenu();
    else openMenu();
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
    if (menu.classList.contains('open')) closeMenu();
    else openMenu();
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
// Abstract + Author Rendering
// ============================================================

function resolveContentUrl(rawUrl, baseUrl, { allowData = false } = {}) {
  const value = String(rawUrl || '').trim();
  if (!value) return '';
  if (value.startsWith('#')) return value;

  const lower = value.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('vbscript:')) return '';
  if (lower.startsWith('data:')) return allowData ? value : '';
  if (lower.startsWith('//')) return `https:${value}`;

  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
      const parsed = new URL(value);
      const scheme = parsed.protocol.toLowerCase();
      if (scheme === 'http:' || scheme === 'https:' || scheme === 'mailto:' || scheme === 'tel:') {
        return parsed.toString();
      }
      return '';
    }

    const base = baseUrl ? new URL(baseUrl, window.location.href) : new URL(window.location.href);
    return new URL(value, base).toString();
  } catch {
    return '';
  }
}

function appendClassName(el, className) {
  if (!el || !className) return;
  const existing = String(el.getAttribute('class') || '').trim();
  if (!existing) {
    el.setAttribute('class', className);
    return;
  }
  const classes = new Set(existing.split(/\s+/).filter(Boolean));
  classes.add(className);
  el.setAttribute('class', [...classes].join(' '));
}

function applyLegacyStyleSemantics(el, styleValue) {
  const style = String(styleValue || '').toLowerCase();
  if (!style) return;
  const tag = String(el.tagName || '').toLowerCase();
  const monospace = /(monospace|courier|menlo|monaco|consolas|sfmono|ui-monospace)/.test(style);
  const preformatted = /white-space\s*:\s*(pre|pre-wrap|pre-line)/.test(style);
  const blockCode = /display\s*:\s*block\b/.test(style);
  const hasCodeSurface = /background(?:-color)?\s*:/.test(style);
  const headingLike = /font-size\s*:\s*(?:x-large|xx-large|larger|[2-9]\d(?:\.\d+)?px|1\.[6-9]\d*em|[2-9](?:\.\d+)?em)/.test(style);
  const centered = /text-align\s*:\s*center\b/.test(style) || /margin(?:-left|-right)?\s*:\s*[^;]*\bauto\b/.test(style);

  if (monospace) appendClassName(el, 'blog-inline-mono');
  if (preformatted) appendClassName(el, 'blog-preformatted');
  if (blockCode && (tag === 'code' || tag === 'span' || tag === 'div')) appendClassName(el, 'blog-code-block-inline');
  if (hasCodeSurface && (tag === 'code' || tag === 'pre' || monospace)) appendClassName(el, 'blog-code-surface');
  if (headingLike && (tag === 'span' || tag === 'div' || tag === 'p' || tag === 'strong' || tag === 'b')) appendClassName(el, 'blog-heading-like');
  if (centered && (tag === 'div' || tag === 'p' || tag === 'figure')) appendClassName(el, 'blog-centered');
}

function normalizeLegacyCodeMarkup(fragmentRoot) {
  if (!fragmentRoot || typeof fragmentRoot.querySelectorAll !== 'function') return;

  fragmentRoot.querySelectorAll('pre').forEach((pre) => appendClassName(pre, 'blog-code-block'));
  fragmentRoot.querySelectorAll('pre > code').forEach((code) => appendClassName(code, 'blog-code'));

  fragmentRoot.querySelectorAll('code').forEach((code) => {
    if (code.closest('pre')) return;
    const hasLineBreak = /\n/.test(code.textContent || '') || !!code.querySelector('br');
    const wantsBlock = hasLineBreak
      || code.classList.contains('blog-preformatted')
      || code.classList.contains('blog-code-block-inline');
    if (!wantsBlock) return;

    const pre = document.createElement('pre');
    appendClassName(pre, 'blog-code-block');
    if (code.classList.contains('blog-code-surface')) appendClassName(pre, 'blog-code-surface');

    const nextCode = code.cloneNode(true);
    appendClassName(nextCode, 'blog-code');
    pre.appendChild(nextCode);
    code.replaceWith(pre);
  });
}

function sanitizeHtmlFragment(rawHtml, baseUrl) {
  const template = document.createElement('template');
  template.innerHTML = String(rawHtml || '');

  const blocked = 'script,style,iframe,object,embed,form,meta,link,base'.split(',');
  template.content.querySelectorAll(blocked.join(',')).forEach((node) => node.remove());

  const allElements = template.content.querySelectorAll('*');
  allElements.forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value;

      if (name.startsWith('on') || name === 'srcdoc') {
        el.removeAttribute(attr.name);
        continue;
      }

      if (name === 'style') {
        applyLegacyStyleSemantics(el, value);
        el.removeAttribute(attr.name);
        continue;
      }

      if (name === 'href') {
        const safe = resolveContentUrl(value, baseUrl, { allowData: false });
        if (!safe) {
          el.removeAttribute(attr.name);
        } else {
          el.setAttribute('href', safe);
          if (el.tagName.toLowerCase() === 'a') {
            el.setAttribute('target', '_blank');
            el.setAttribute('rel', 'noopener noreferrer');
          }
        }
        continue;
      }

      if (name === 'src') {
        const safe = resolveContentUrl(value, baseUrl, { allowData: true });
        if (!safe) el.removeAttribute(attr.name);
        else el.setAttribute('src', safe);
        continue;
      }

      if (name === 'srcset') {
        el.removeAttribute(attr.name);
      }
    }
  });

  normalizeLegacyCodeMarkup(template.content);
  return template.innerHTML;
}

function preserveInlineHtmlPlaceholders(text) {
  const placeholders = [];
  const inlineTagRe = /<\/?(mark|kbd|samp|sub|sup|br|em|strong|tt|ins|del)\b[^>]*>/gi;
  const sanitizeInlineTag = (rawTag) => {
    const match = String(rawTag || '').match(/^<\s*(\/?)\s*([a-z0-9-]+)\b[^>]*>$/i);
    if (!match) return '';
    const isClosing = !!match[1];
    const tag = String(match[2] || '').toLowerCase();
    if (!tag) return '';

    if (isClosing) {
      if (tag === 'br') return '';
      return `</${tag}>`;
    }

    if (tag === 'br') return '<br>';
    return `<${tag}>`;
  };

  const tokenizedText = String(text || '').replace(inlineTagRe, (rawTag) => {
    const sanitizedTag = sanitizeInlineTag(rawTag);
    if (!sanitizedTag) return '';
    const placeholder = `@@BLOGHTMLTAG${placeholders.length}@@`;
    placeholders.push({ placeholder, html: sanitizedTag });
    return placeholder;
  });
  return { tokenizedText, placeholders };
}

function restoreInlineHtmlPlaceholders(text, placeholders) {
  let output = String(text || '');
  for (const entry of placeholders || []) {
    output = output.split(entry.placeholder).join(entry.html);
  }
  return output;
}

function normalizeReferenceLabel(label) {
  return String(label || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function extractMarkdownReferenceDefinitions(lines, baseUrl) {
  const contentLines = [];
  const references = new Map();
  let codeFenceMarker = '';

  for (const rawLine of lines || []) {
    const line = String(rawLine || '');
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^(```|~~~)/);

    if (fenceMatch) {
      if (codeFenceMarker) {
        if (fenceMatch[1] === codeFenceMarker) codeFenceMarker = '';
      } else {
        codeFenceMarker = fenceMatch[1];
      }
      contentLines.push(line);
      continue;
    }

    if (codeFenceMarker) {
      contentLines.push(line);
      continue;
    }

    const refMatch = line.match(/^\s{0,3}\[([^\]]+)\]:\s*(\S+)(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]+)\)))?\s*$/);
    if (!refMatch) {
      contentLines.push(line);
      continue;
    }

    const key = normalizeReferenceLabel(refMatch[1]);
    if (!key) continue;

    let rawUrl = String(refMatch[2] || '').trim();
    if (rawUrl.startsWith('<') && rawUrl.endsWith('>')) {
      rawUrl = rawUrl.slice(1, -1).trim();
    }
    const safeUrl = resolveContentUrl(rawUrl, baseUrl, { allowData: false });
    if (!safeUrl) continue;

    const title = String(refMatch[3] || refMatch[4] || refMatch[5] || '').trim();
    references.set(key, { url: safeUrl, title });
  }

  return { contentLines, references };
}

function getMarkdownReferenceLink(referenceMap, label) {
  if (!(referenceMap instanceof Map)) return null;
  const key = normalizeReferenceLabel(label);
  if (!key) return null;
  return referenceMap.get(key) || null;
}

function parseShortcodeArgs(rawArgs) {
  const text = String(rawArgs || '');
  const tokens = [];
  let token = '';
  let quote = '';
  let escaped = false;

  const pushToken = () => {
    const value = token.trim();
    if (value) tokens.push(value);
    token = '';
  };

  for (const ch of text) {
    if (escaped) {
      token += ch;
      escaped = false;
      continue;
    }

    if (quote) {
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) {
        quote = '';
        continue;
      }
      token += ch;
      continue;
    }

    if (ch === '"' || ch === '\'') {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      pushToken();
      continue;
    }

    token += ch;
  }
  pushToken();

  const named = new Map();
  const positional = [];

  for (const rawToken of tokens) {
    const eqIdx = rawToken.indexOf('=');
    if (eqIdx > 0) {
      const key = rawToken.slice(0, eqIdx).trim().toLowerCase();
      const value = rawToken.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && value) named.set(key, value);
      continue;
    }
    positional.push(rawToken);
  }

  return { named, positional };
}

function shortcodeNamedOrPositional(parsedArgs, key, positionalIndex = 0) {
  if (!parsedArgs || typeof parsedArgs !== 'object') return '';
  const named = parsedArgs.named instanceof Map ? parsedArgs.named : new Map();
  const positional = Array.isArray(parsedArgs.positional) ? parsedArgs.positional : [];

  const namedValue = String(named.get(String(key || '').toLowerCase()) || '').trim();
  if (namedValue) return namedValue;

  return String(positional[positionalIndex] || '').trim();
}

function renderHugoShortcodeLink(rawUrl, label, baseUrl) {
  const safeUrl = resolveContentUrl(rawUrl, baseUrl, { allowData: false });
  if (!safeUrl) return '';
  const linkLabel = String(label || '').trim() || 'Open linked content';
  return `<p class="hugo-shortcode-link"><a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(linkLabel)}</a></p>`;
}

function renderHugoFigureShortcode(rawArgs, baseUrl) {
  const parsed = parseShortcodeArgs(rawArgs);
  const rawSrc = shortcodeNamedOrPositional(parsed, 'src', 0);
  const safeSrc = resolveContentUrl(rawSrc, baseUrl, { allowData: true });
  if (!safeSrc) return '';

  const caption = shortcodeNamedOrPositional(parsed, 'caption', 1);
  const title = shortcodeNamedOrPositional(parsed, 'title', 2);
  const alt = shortcodeNamedOrPositional(parsed, 'alt', 3) || caption || title;
  const rawLink = shortcodeNamedOrPositional(parsed, 'link', 4);
  const safeLink = resolveContentUrl(rawLink, baseUrl, { allowData: false });
  const attr = shortcodeNamedOrPositional(parsed, 'attr', 5);
  const rawAttrLink = shortcodeNamedOrPositional(parsed, 'attrlink', 6);
  const safeAttrLink = resolveContentUrl(rawAttrLink, baseUrl, { allowData: false });

  const imgHtml = `<img src="${escapeHtml(safeSrc)}" alt="${escapeHtml(alt || '')}" loading="lazy">`;
  const mediaHtml = safeLink
    ? `<a href="${escapeHtml(safeLink)}" target="_blank" rel="noopener noreferrer">${imgHtml}</a>`
    : imgHtml;

  const captionParts = [];
  if (title) captionParts.push(escapeHtml(title));
  if (caption && (!title || caption !== title)) captionParts.push(escapeHtml(caption));
  if (attr) {
    const sourceLink = safeAttrLink
      ? `<a href="${escapeHtml(safeAttrLink)}" target="_blank" rel="noopener noreferrer">${escapeHtml(attr)}</a>`
      : escapeHtml(attr);
    captionParts.push(`Source: ${sourceLink}`);
  }

  return `<figure class="hugo-figure">${mediaHtml}${captionParts.length ? `<figcaption>${captionParts.join(' · ')}</figcaption>` : ''}</figure>`;
}

function renderHugoHighlightShortcode(rawArgs, rawCodeBody) {
  const parsed = parseShortcodeArgs(rawArgs);
  const language = (
    shortcodeNamedOrPositional(parsed, 'lang', 0)
    || shortcodeNamedOrPositional(parsed, 'language', 0)
  ).replace(/[^A-Za-z0-9_+-]/g, '').toLowerCase();
  const codeBody = String(rawCodeBody || '').replace(/^\n+/, '').replace(/\n+$/, '');
  return `\n\`\`\`${language}\n${codeBody}\n\`\`\`\n`;
}

function preserveMarkdownCodeFencePlaceholders(markdownText) {
  const lines = String(markdownText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const placeholders = [];
  const outputLines = [];
  let codeFenceMarker = '';
  let codeFenceLines = [];

  const flushCodeFence = () => {
    if (!codeFenceLines.length) return;
    const placeholder = `@@BLOGCODEFENCE${placeholders.length}@@`;
    placeholders.push({ placeholder, content: codeFenceLines.join('\n') });
    outputLines.push(placeholder);
    codeFenceLines = [];
  };

  for (const line of lines) {
    const trimmed = String(line || '').trim();
    const fenceMatch = trimmed.match(/^(```|~~~)\s*.*$/);

    if (codeFenceMarker) {
      codeFenceLines.push(line);
      if (fenceMatch && fenceMatch[1] === codeFenceMarker) {
        codeFenceMarker = '';
        flushCodeFence();
      }
      continue;
    }

    if (fenceMatch) {
      codeFenceMarker = fenceMatch[1];
      codeFenceLines = [line];
      continue;
    }

    outputLines.push(line);
  }

  // Keep unterminated fences untouched.
  if (codeFenceLines.length) outputLines.push(...codeFenceLines);
  return { tokenizedText: outputLines.join('\n'), placeholders };
}

function restoreMarkdownCodeFencePlaceholders(text, placeholders) {
  let output = String(text || '');
  for (const entry of placeholders || []) {
    output = output.split(entry.placeholder).join(entry.content);
  }
  return output;
}

function transformHugoShortcodes(markdownText, baseUrl) {
  let output = String(markdownText || '');
  if (!output) return '';

  const { tokenizedText, placeholders } = preserveMarkdownCodeFencePlaceholders(output);
  output = tokenizedText;

  output = output.replace(/<!--\s*more\s*-->/gi, '');

  output = output.replace(
    /\{\{[%<]\s*highlight\s*([\s\S]*?)\s*[>%]\}\}([\s\S]*?)\{\{[%<]\s*\/\s*highlight\s*[>%]\}\}/gi,
    (_, rawArgs, codeBody) => renderHugoHighlightShortcode(rawArgs, codeBody),
  );

  output = output.replace(/\{\{[%<]\s*figure\s+([\s\S]*?)\s*[>%]\}\}/gi, (_, rawArgs) => {
    const html = renderHugoFigureShortcode(rawArgs, baseUrl);
    return html ? `\n${html}\n` : '\n';
  });

  output = output.replace(/\{\{[%<]\s*(youtube|vimeo|tweet)\s+([\s\S]*?)\s*[>%]\}\}/gi, (_, kind, rawArgs) => {
    const parsed = parseShortcodeArgs(rawArgs);
    const key = String(kind || '').toLowerCase();
    const id = shortcodeNamedOrPositional(parsed, 'id', 0) || shortcodeNamedOrPositional(parsed, key, 0);
    if (!id) return '';

    if (key === 'youtube') {
      return renderHugoShortcodeLink(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`, 'Watch on YouTube', baseUrl);
    }
    if (key === 'vimeo') {
      return renderHugoShortcodeLink(`https://vimeo.com/${encodeURIComponent(id)}`, 'Watch on Vimeo', baseUrl);
    }
    return renderHugoShortcodeLink(`https://x.com/i/web/status/${encodeURIComponent(id)}`, 'Open Tweet', baseUrl);
  });

  output = output.replace(/\{\{[%<]\s*gist\s+([\s\S]*?)\s*[>%]\}\}/gi, (_, rawArgs) => {
    const parsed = parseShortcodeArgs(rawArgs);
    const first = shortcodeNamedOrPositional(parsed, 'id', 0) || shortcodeNamedOrPositional(parsed, 'gist', 0);
    const second = shortcodeNamedOrPositional(parsed, 'file', 1) || shortcodeNamedOrPositional(parsed, 'name', 1);
    let gistUrl = '';

    if (/^https?:\/\//i.test(first)) {
      gistUrl = first;
    } else if (first && second) {
      gistUrl = `https://gist.github.com/${first}/${second}`;
    } else if (first) {
      gistUrl = `https://gist.github.com/${first}`;
    }

    return renderHugoShortcodeLink(gistUrl, 'Open Gist', baseUrl);
  });

  output = output.replace(/\{\{[%<]\s*(?:relref|ref)\s+([\s\S]*?)\s*[>%]\}\}/gi, (_, rawArgs) => {
    const parsed = parseShortcodeArgs(rawArgs);
    const target = shortcodeNamedOrPositional(parsed, 'path', 0) || shortcodeNamedOrPositional(parsed, 'url', 0);
    const safeTarget = resolveContentUrl(target, baseUrl, { allowData: false });
    return safeTarget || '';
  });

  // Drop unknown standalone shortcodes that would otherwise show as raw markup.
  output = output.replace(/^\s*\{\{[%<][\s\S]*?[>%]\}\}\s*$/gm, '');
  output = output.replace(/\n{3,}/g, '\n\n').trim();
  return restoreMarkdownCodeFencePlaceholders(output, placeholders);
}

function isLikelyHugoBlogSource(paper) {
  if (!paper || typeof paper !== 'object') return false;

  const source = String(paper.source || '').trim().toLowerCase();
  if (BLOG_SOURCE_SLUG_ALIASES.has(source)) return true;

  const sourceUrl = String(paper.sourceUrl || '').trim();
  if (/^https?:\/\/(?:www\.)?blog\.llvm\.org\//i.test(sourceUrl)) return true;

  const paperUrl = String(paper.paperUrl || '').trim();
  return /github\.com\/llvm\/(?:llvm-blog-www|llvm-www-blog)\b/i.test(paperUrl);
}

function formatInlineMarkdown(text, baseUrl, referenceMap) {
  if (!text) return '';
  const { tokenizedText, placeholders } = preserveInlineHtmlPlaceholders(text);
  let html = escapeHtml(tokenizedText);

  html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, url, title) => {
    const safeUrl = resolveContentUrl(url, baseUrl, { allowData: true });
    if (!safeUrl) return '';
    const altText = escapeHtml(alt || '');
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    return `<img src="${escapeHtml(safeUrl)}" alt="${altText}" loading="lazy"${titleAttr}>`;
  });

  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, label, url, title) => {
    const safeUrl = resolveContentUrl(url, baseUrl, { allowData: false });
    if (!safeUrl) return escapeHtml(label || '');
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    return `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${escapeHtml(label || '')}</a>`;
  });

  html = html.replace(/!\[([^\]]*)\]\[([^\]]*)\]/g, (match, alt, label) => {
    const refLabel = label || alt;
    const ref = getMarkdownReferenceLink(referenceMap, refLabel);
    if (!ref || !ref.url) return match;
    const titleAttr = ref.title ? ` title="${escapeHtml(ref.title)}"` : '';
    return `<img src="${escapeHtml(ref.url)}" alt="${escapeHtml(alt || '')}" loading="lazy"${titleAttr}>`;
  });

  html = html.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (match, label, refLabel) => {
    const lookup = refLabel || label;
    const ref = getMarkdownReferenceLink(referenceMap, lookup);
    if (!ref || !ref.url) return match;
    const titleAttr = ref.title ? ` title="${escapeHtml(ref.title)}"` : '';
    return `<a href="${escapeHtml(ref.url)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${escapeHtml(label || '')}</a>`;
  });

  html = html.replace(/\[([^\]]+)\]/g, (match, label, offset, fullText) => {
    const previousChar = offset > 0 ? fullText.charAt(offset - 1) : '';
    const nextChar = fullText.charAt(offset + match.length) || '';
    if (previousChar === '!' || nextChar === '(') return match;

    const ref = getMarkdownReferenceLink(referenceMap, label);
    if (!ref || !ref.url) return match;
    const titleAttr = ref.title ? ` title="${escapeHtml(ref.title)}"` : '';
    return `<a href="${escapeHtml(ref.url)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${escapeHtml(label || '')}</a>`;
  });

  html = html.replace(/`([^`]+)`/g, (_, code) => `<code>${escapeHtml(code)}</code>`);
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  return restoreInlineHtmlPlaceholders(html, placeholders);
}

function renderMarkdownToHtml(markdownText, baseUrl) {
  const rawLines = String(markdownText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const { contentLines: lines, references } = extractMarkdownReferenceDefinitions(rawLines, baseUrl);
  const out = [];
  let paragraph = [];
  let listType = '';
  let listItems = [];
  let codeFenceMarker = '';
  let codeFenceLanguage = '';
  let codeLines = [];
  const htmlTagRe = /<\/?(a|p|div|span|img|h[1-6]|ul|ol|li|blockquote|table|thead|tbody|tr|td|th|pre|code|br|hr|details|summary|figure|figcaption|mark|kbd|samp)\b/i;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join(' ').replace(/\s+/g, ' ').trim();
    if (text) out.push(`<p>${formatInlineMarkdown(text, baseUrl, references)}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listType || !listItems.length) {
      listType = '';
      listItems = [];
      return;
    }
    out.push(`<${listType}>${listItems.map((item) => `<li>${formatInlineMarkdown(item, baseUrl, references)}</li>`).join('')}</${listType}>`);
    listType = '';
    listItems = [];
  };

  const flushCode = () => {
    if (!codeFenceMarker) return;
    const language = codeFenceLanguage.replace(/[^a-z0-9_+-]/gi, '').toLowerCase();
    const classAttr = language ? ` class="language-${escapeHtml(language)}"` : '';
    out.push(`<pre><code${classAttr}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
    codeFenceMarker = '';
    codeFenceLanguage = '';
    codeLines = [];
  };

  for (const rawLine of lines) {
    const line = rawLine || '';
    const trimmed = line.trim();

    const fenceMatch = trimmed.match(/^(```|~~~)\s*([A-Za-z0-9_+-]*)\s*$/);
    if (fenceMatch) {
      if (codeFenceMarker) {
        if (fenceMatch[1] === codeFenceMarker) {
          flushCode();
        } else {
          codeLines.push(line);
        }
      } else {
        flushParagraph();
        flushList();
        codeFenceMarker = fenceMatch[1] || '';
        codeFenceLanguage = fenceMatch[2] || '';
        codeLines = [];
      }
      continue;
    }

    if (codeFenceMarker) {
      codeLines.push(line);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    if (/^<[^>]+>/.test(trimmed) && htmlTagRe.test(trimmed)) {
      flushParagraph();
      flushList();
      out.push(sanitizeHtmlFragment(trimmed, baseUrl));
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      out.push(`<h${level}>${formatInlineMarkdown(headingMatch[2], baseUrl, references)}</h${level}>`);
      continue;
    }

    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      flushParagraph();
      flushList();
      out.push('<hr>');
      continue;
    }

    const unordered = trimmed.match(/^[-*+]\s+(.*)$/);
    if (unordered) {
      flushParagraph();
      if (listType && listType !== 'ul') flushList();
      listType = 'ul';
      listItems.push(unordered[1]);
      continue;
    }

    const ordered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (ordered) {
      flushParagraph();
      if (listType && listType !== 'ol') flushList();
      listType = 'ol';
      listItems.push(ordered[1]);
      continue;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      out.push(`<blockquote><p>${formatInlineMarkdown(quote[1], baseUrl, references)}</p></blockquote>`);
      continue;
    }

    paragraph.push(trimmed);
  }

  flushCode();
  flushParagraph();
  flushList();

  return out.join('\n');
}

function renderBlogContent(paper) {
  let body = String(paper.content || '').trim();
  if (!body) {
    return '<p><em>Blog content unavailable in local cache. Use the links above to open the original post.</em></p>';
  }
  const format = String(paper.contentFormat || '').toLowerCase();
  const baseUrl = paper.sourceUrl || paper.paperUrl || window.location.href;

  if (format === 'html') {
    return sanitizeHtmlFragment(body, baseUrl);
  }

  if (isLikelyHugoBlogSource(paper)) {
    const transformed = transformHugoShortcodes(body, baseUrl);
    if (transformed) body = transformed;
  }

  return renderMarkdownToHtml(body, baseUrl);
}

function renderAbstract(abstract) {
  if (!abstract) return '<p><em>No abstract available.</em></p>';

  const paras = abstract
    .split(/\n{2,}|\r\n\r\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return paras.map((para) => {
    const lines = para.split(/\n/).map((line) => line.trim()).filter(Boolean);
    const isList = lines.length > 1 && lines.every((line) => /^[-*•]/.test(line));
    if (isList) {
      const items = lines.map((line) => `<li>${escapeHtml(line.replace(/^[-*•]\s*/, ''))}</li>`).join('');
      return `<ul>${items}</ul>`;
    }
    return `<p>${escapeHtml(para.replace(/\n/g, ' '))}</p>`;
  }).join('\n');
}

function renderAuthors(authors, paper) {
  if (!authors || authors.length === 0) {
    return '<p style="color: var(--color-text-muted); font-size: var(--font-size-sm);">Author information not available.</p>';
  }

  return authors.map((author) => {
    const name = escapeHtml(author.name);
    const affiliation = author.affiliation
      ? `<br><span class="speaker-affiliation">${escapeHtml(author.affiliation)}</span>`
      : '';
    return `
      <div class="speaker-chip">
        <div>
          <a href="${buildSpeakerWorkUrl(author.name, paper)}" class="speaker-name-link" aria-label="View talks and papers by ${name}">${name}</a>
          ${affiliation}
        </div>
      </div>`;
  }).join('');
}

// ============================================================
// Related Papers
// ============================================================

const _PAPER_PLACEHOLDER = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><polyline points="14 2 14 7 19 7"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="14" y2="17"/></svg>`;

function getRelatedPapers(paper, allPapers) {
  const MAX_TOTAL = 6;
  const sameYear = allPapers
    .filter((candidate) => candidate.id !== paper.id && candidate._year && candidate._year === paper._year)
    .slice(0, 4);
  const seen = new Set(sameYear.map((candidate) => candidate.id));

  const tagSet = new Set((paper.tags || []).map((tag) => tag.toLowerCase()));
  const tagRelated = allPapers
    .filter((candidate) => candidate.id !== paper.id && !seen.has(candidate.id))
    .map((candidate) => {
      const overlap = (candidate.tags || []).filter((tag) => tagSet.has(String(tag || '').toLowerCase())).length;
      return { candidate, overlap };
    })
    .filter((entry) => entry.overlap > 0)
    .sort((a, b) => {
      const overlapDiff = b.overlap - a.overlap;
      if (overlapDiff !== 0) return overlapDiff;
      const yearDiff = String(b.candidate._year || '').localeCompare(String(a.candidate._year || ''));
      if (yearDiff !== 0) return yearDiff;
      return String(a.candidate.title || '').localeCompare(String(b.candidate.title || ''));
    })
    .slice(0, Math.max(0, MAX_TOTAL - sameYear.length))
    .map((entry) => entry.candidate);

  return [...sameYear, ...tagRelated];
}

function renderRelatedCard(paper) {
  const blogEntry = isBlogPaper(paper);
  const badgeClass = blogEntry ? 'badge-blog' : 'badge-paper';
  const badgeLabel = blogEntry ? 'Blog' : 'Paper';
  const speakerLinksHtml = (paper.authors || []).length
    ? paper.authors.map((author) =>
      `<a href="${buildSpeakerWorkUrl(author.name, paper)}" class="card-speaker-link" aria-label="View talks and papers by ${escapeHtml(author.name)}">${escapeHtml(author.name)}</a>`
    ).join('<span class="speaker-btn-sep">, </span>')
    : '';

  const relatedLabel = `${escapeHtml(paper.title)}${speakerLinksHtml ? ` by ${escapeHtml((paper.authors || []).map((author) => author.name).join(', '))}` : ''}`;
  const dateOrYear = blogEntry
    ? escapeHtml(paper._publishedDateLabel || paper._year || 'Unknown date')
    : escapeHtml(paper._year || 'Unknown year');

  return `
    <article class="talk-card paper-card">
      <a href="paper.html?id=${escapeHtml(paper.id)}&from=${blogEntry ? 'blogs' : 'papers'}" class="card-link-wrap" aria-label="${relatedLabel}">
        <div class="card-thumbnail paper-thumbnail" aria-hidden="true">
          <div class="card-thumbnail-placeholder paper-thumbnail-placeholder">
            ${_PAPER_PLACEHOLDER}
            <span class="paper-thumbnail-label">${escapeHtml(badgeLabel)}</span>
          </div>
        </div>
        <div class="card-body">
          <div class="card-meta">
            <span class="badge ${badgeClass}">${escapeHtml(badgeLabel)}</span>
            <span class="meeting-label">${dateOrYear}</span>
          </div>
          <p class="card-title">${escapeHtml(paper.title)}</p>
          ${speakerLinksHtml ? `<p class="card-speakers">${speakerLinksHtml}</p>` : ''}
        </div>
      </a>
    </article>`;
}

// ============================================================
// Page Rendering
// ============================================================

function renderPaperDetail(paper, allPapers) {
  const root = document.getElementById('paper-detail-root');
  const blogEntry = isBlogPaper(paper);
  const listingPath = getListingPathForPaper(paper);
  const listingLabel = getListingLabelForPaper(paper);
  const authorsHtml = renderAuthors(paper.authors, paper);
  const citationCount = Number.isFinite(paper.citationCount) ? paper.citationCount : 0;
  const doiUrl = doiUrlFromValue(paper.doi);
  const badgeClass = blogEntry ? 'badge-blog' : 'badge-paper';
  const badgeLabel = blogEntry ? 'Blog' : 'Paper';

  const infoParts = [];
  if (blogEntry && paper._publishedDateLabel) infoParts.push(paper._publishedDateLabel);
  else if (paper._year) infoParts.push(paper._year);
  if (paper.publication) infoParts.push(paper.publication);
  if (paper.venue && paper.venue !== paper.publication) infoParts.push(paper.venue);

  const links = [];
  if (paper.paperUrl) {
    const isPdf = /\.pdf(?:$|[?#])/i.test(paper.paperUrl);
    const linkLabel = blogEntry ? 'Open Repository Post' : (isPdf ? 'Open PDF' : 'Open Paper');
    links.push(`
      <a href="${escapeHtml(paper.paperUrl)}" class="link-btn" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(linkLabel)} for ${escapeHtml(paper.title)} (opens in new tab)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        ${escapeHtml(linkLabel)}
      </a>`);
  }
  if (paper.sourceUrl) {
    const sourceLabel = blogEntry ? 'Open Blog' : 'Source Listing';
    links.push(`
      <a href="${escapeHtml(paper.sourceUrl)}" class="link-btn" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(sourceLabel)} for ${escapeHtml(paper.title)} (opens in new tab)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l1.41-1.41a5 5 0 1 0-7.07-7.07L10 6"/><path d="M14 11a5 5 0 0 0-7.07 0L5.52 12.4a5 5 0 0 0 7.07 7.07L14 18"/></svg>
        ${escapeHtml(sourceLabel)}
      </a>`);
  }
  if (doiUrl) {
    links.push(`
      <a href="${escapeHtml(doiUrl)}" class="link-btn" target="_blank" rel="noopener noreferrer" aria-label="Open DOI for ${escapeHtml(paper.title)} (opens in new tab)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l1.41-1.41a5 5 0 0 0-7.07-7.07L10 6"/><path d="M14 11a5 5 0 0 0-7.07 0L5.52 12.4a5 5 0 1 0 7.07 7.07L14 18"/></svg>
        DOI
      </a>`);
  }
  if (paper.openalexId) {
    links.push(`
      <a href="${escapeHtml(paper.openalexId)}" class="link-btn" target="_blank" rel="noopener noreferrer" aria-label="Open OpenAlex record for ${escapeHtml(paper.title)} (opens in new tab)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>
        OpenAlex
      </a>`);
  }
  links.push(`
    <a href="https://github.com/bwatsonllvm/library/issues/new" class="link-btn report-issue-link" id="report-issue-btn" aria-label="Report an issue with this paper (opens in new tab)">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="12" y1="7" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      Report issue
    </a>`);

  const keyTopics = getPaperKeyTopics(paper, 18);
  const keyTopicsHtml = keyTopics.length
    ? `<section class="tags-section" aria-label="Key Topics">
        <div class="section-label" aria-hidden="true">Key Topics</div>
        <div class="detail-tags">
          ${keyTopics.map((topic) =>
            `<a href="${listingPath}?tag=${encodeURIComponent(topic)}" class="detail-tag" aria-label="Browse ${listingLabel} for key topic ${escapeHtml(topic)}">${escapeHtml(topic)}</a>`
          ).join('')}
        </div>
      </section>`
    : '';

  const publicationHtml = paper.publication
    ? `<section class="tags-section" aria-label="Publication">
        <div class="section-label" aria-hidden="true">Publication</div>
        <div class="detail-tags">
          <a href="${listingPath}?q=${encodeURIComponent(paper.publication)}" class="detail-tag" aria-label="Search ${listingLabel} for ${escapeHtml(paper.publication)}">${escapeHtml(paper.publication)}</a>
        </div>
      </section>`
    : '';

  const metadataItems = [];
  if (citationCount > 0) {
    metadataItems.push(`<span class="detail-tag detail-tag--meta" aria-label="${citationCount.toLocaleString()} citation${citationCount === 1 ? '' : 's'}">Cited by ${citationCount.toLocaleString()}</span>`);
  }
  if (paper.doi) {
    metadataItems.push(`<a href="${escapeHtml(doiUrl)}" class="detail-tag" target="_blank" rel="noopener noreferrer" aria-label="Open DOI ${escapeHtml(paper.doi)} (opens in new tab)">DOI: ${escapeHtml(paper.doi)}</a>`);
  }
  if (paper.openalexId) {
    metadataItems.push(`<a href="${escapeHtml(paper.openalexId)}" class="detail-tag" target="_blank" rel="noopener noreferrer" aria-label="Open OpenAlex record (opens in new tab)">OpenAlex record</a>`);
  }
  metadataItems.push('<button type="button" class="detail-tag detail-tag--button" id="copy-bibtex-btn" aria-label="Copy BibTeX citation">Copy BibTeX</button>');
  const citationMetaHtml = `
    <section class="tags-section" aria-label="Citation metadata">
      <div class="section-label" aria-hidden="true">Citation Data</div>
      <div class="detail-tags">
        ${metadataItems.join('')}
      </div>
    </section>`;

  const related = getRelatedPapers(paper, allPapers);

  root.innerHTML = `
    <div class="talk-detail">
      <a href="${listingPath}" class="back-btn" id="back-btn" aria-label="Back to all ${listingLabel}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
        <span aria-hidden="true">${escapeHtml(blogEntry ? 'All Blogs' : 'All Papers')}</span>
      </a>

      <div class="talk-header">
        <div class="talk-header-meta">
          <span class="badge ${badgeClass}">${badgeLabel}</span>
          ${infoParts.length ? `<span class="meeting-info-badge">${escapeHtml(infoParts.join(' · '))}</span>` : ''}
        </div>
        <h1 class="talk-title">${escapeHtml(paper.title)}</h1>
      </div>

      <section class="speakers-section" aria-label="Authors">
        <div class="section-label" aria-hidden="true">Authors</div>
        <div class="speakers-list">${authorsHtml}</div>
      </section>

      ${links.length ? `<div class="links-bar" aria-label="Resources">${links.join('')}</div>` : ''}

      <section class="abstract-section" aria-label="${blogEntry ? 'Blog post content' : 'Abstract'}">
        <div class="section-label" aria-hidden="true">${blogEntry ? 'Article' : 'Abstract'}</div>
        <div class="abstract-body${blogEntry ? ' blog-content' : ''}">
          ${blogEntry ? renderBlogContent(paper) : renderAbstract(paper.abstract)}
        </div>
      </section>

      ${citationMetaHtml}
      ${publicationHtml}
      ${keyTopicsHtml}
    </div>

    ${related.length ? `
    <section class="related-section" aria-label="Related ${blogEntry ? 'content' : 'papers'}">
      <h2>${blogEntry ? 'Related Content' : 'Related Papers'}</h2>
      <div class="related-grid">
        ${related.map((relatedPaper) => renderRelatedCard(relatedPaper)).join('')}
      </div>
    </section>` : ''}
  `;

  const backBtn = document.getElementById('back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', (event) => {
      if (window.history.length > 1) {
        event.preventDefault();
        window.history.back();
      }
    });
  }

  const copyBibtexBtn = document.getElementById('copy-bibtex-btn');
  if (copyBibtexBtn) {
    const defaultLabel = copyBibtexBtn.textContent;
    copyBibtexBtn.addEventListener('click', async () => {
      const copied = await copyTextToClipboard(buildBibtexEntry(paper));
      copyBibtexBtn.textContent = copied ? 'BibTeX copied' : 'Copy failed';
      window.setTimeout(() => {
        copyBibtexBtn.textContent = defaultLabel;
      }, 1600);
    });
  }
}

function renderNotFound(id, listingPath = fallbackListingPathFromUrl()) {
  const root = document.getElementById('paper-detail-root');
  const listingLabel = listingPath === BLOGS_PAGE_PATH ? 'blogs' : 'papers';
  const listingTitle = listingPath === BLOGS_PAGE_PATH ? 'All Blogs' : 'All Papers';
  root.innerHTML = `
    <div class="talk-detail">
      <a href="${listingPath}" class="back-btn" aria-label="Back to all ${listingLabel}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
        <span aria-hidden="true">${listingTitle}</span>
      </a>
      <div class="empty-state">
        <div class="empty-state-icon" aria-hidden="true">!</div>
        <h2>Paper not found</h2>
        <p>No paper found with ID <code>${escapeHtml(id || '(none)')}</code>.</p>
      </div>
    </div>`;
}

// ============================================================
// Customization (Theme + Text Size)
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

// ============================================================
// Init
// ============================================================

async function init() {
  initTheme();
  initTextSize();
  initCustomizationMenu();
  initMobileNavMenu();

  const params = new URLSearchParams(window.location.search);
  const paperId = params.get('id');
  const fallbackListingPath = fallbackListingPathFromUrl();
  syncHeaderNavForPaper({ _isBlog: fallbackListingPath === BLOGS_PAGE_PATH });
  setIssueContext({
    pageType: 'Paper',
    itemType: fallbackListingPath === BLOGS_PAGE_PATH ? 'Blog' : 'Paper',
    itemId: String(paperId || '').trim(),
  });
  const allPapers = await loadPapers();

  if (!allPapers) {
    const root = document.getElementById('paper-detail-root');
    root.innerHTML = `
      <div class="talk-detail">
        <div class="empty-state" role="alert">
          <div class="empty-state-icon" aria-hidden="true">!</div>
          <h2>Could not load data</h2>
          <p>Ensure <code>papers/index.json</code> and <code>papers/*.json</code> are available and that <code>js/papers-data.js</code> loads first.</p>
        </div>
      </div>`;
    initShareMenu();
    return;
  }

  if (!paperId) {
    renderNotFound(null, fallbackListingPath);
    const missingItemLabel = fallbackListingPath === BLOGS_PAGE_PATH ? 'Blog' : 'Paper';
    setIssueContext({
      itemTitle: `Missing ${missingItemLabel.toLowerCase()} ID`,
      issueTitle: `[${missingItemLabel}] Missing ${missingItemLabel.toLowerCase()} ID`,
    });
    initShareMenu();
    return;
  }

  const paper = allPapers.find((candidate) => candidate.id === paperId);
  if (!paper) {
    renderNotFound(paperId, fallbackListingPath);
    const missingItemLabel = fallbackListingPath === BLOGS_PAGE_PATH ? 'Blog' : 'Paper';
    setIssueContext({
      itemTitle: `Unknown ${missingItemLabel.toLowerCase()} ID: ${paperId}`,
      issueTitle: `[${missingItemLabel}] Unknown ${missingItemLabel.toLowerCase()} ID: ${paperId}`,
    });
    initShareMenu();
    return;
  }

  document.title = `${paper.title} — LLVM Research Library`;
  updatePaperSeoMetadata(paper);
  syncHeaderNavForPaper(paper);
  renderPaperDetail(paper, allPapers);
  setIssueContextForPaper(paper);
  initShareMenu();
}

init();

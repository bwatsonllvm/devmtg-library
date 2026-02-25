/**
 * updates.js — Render update log (talks/slides/videos/papers/blogs/docs additions).
 */

const UPDATE_LOG_PATH = 'updates/index.json';
const INITIAL_RENDER_BATCH_SIZE = 60;
const RENDER_BATCH_SIZE = 40;
const LOAD_MORE_ROOT_MARGIN = '900px 0px';
const DIRECT_PDF_URL_RE = /\.pdf(?:$|[?#])|\/pdf(?:$|[/?#])|[?&](?:format|type|output)=pdf(?:$|[&#])|[?&]filename=[^&#]*\.pdf(?:$|[&#])/i;
let activeRenderEntries = [];
let renderedCount = 0;
let loadMoreObserver = null;
let loadMoreScrollHandler = null;
const HubUtils = window.LLVMHubUtils || {};
const PageShell = typeof HubUtils.createPageShell === 'function'
  ? HubUtils.createPageShell()
  : null;

const initTheme = PageShell ? () => PageShell.initTheme() : () => {};
const initTextSize = PageShell ? () => PageShell.initTextSize() : () => {};
const initCustomizationMenu = PageShell ? () => PageShell.initCustomizationMenu() : () => {};
const initMobileNavMenu = PageShell ? () => PageShell.initMobileNavMenu() : () => {};
const initShareMenu = PageShell ? () => PageShell.initShareMenu() : () => {};

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function collapseWs(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sanitizeExternalUrl(value) {
  const raw = collapseWs(value);
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

function sanitizeLinkUrl(value, { allowRelative = false, allowHash = false } = {}) {
  const raw = collapseWs(value);
  if (!raw) return '';
  if (allowHash && raw.startsWith('#')) return raw;

  if (raw.startsWith('//')) {
    return sanitizeExternalUrl(`https:${raw}`);
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    return sanitizeExternalUrl(raw);
  }

  if (!allowRelative) return '';
  if (/[\u0000-\u001F\u007F]/.test(raw)) return '';
  return raw;
}

function normalizeLibraryUrl(value) {
  const raw = collapseWs(value);
  if (!raw) return '#';
  let normalized = raw;
  if (normalized.startsWith('/devmtg/')) normalized = normalized.slice('/devmtg/'.length);
  if (normalized.startsWith('/')) {
    normalized = normalized
      .replace(/^\/talk\.html/i, 'talks/talk.html')
      .replace(/^\/paper\.html/i, 'papers/paper.html')
      .replace(/^\/events\.html/i, 'talks/events.html')
      .replace(/^\/papers\.html/i, 'papers/')
      .replace(/^\/blogs\.html/i, 'blogs/')
      .replace(/^\/people\.html/i, 'people/')
      .replace(/^\/about\.html/i, 'about/')
      .replace(/^\/updates\.html/i, 'updates/');
    if (normalized.startsWith('/')) normalized = normalized.slice(1);
  }
  return sanitizeLinkUrl(normalized, { allowRelative: true, allowHash: true }) || '#';
}

function formatLoggedAt(value) {
  const raw = collapseWs(value);
  if (!raw) return 'Unknown time';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function parseLoggedAtTimestamp(entry) {
  if (!entry || typeof entry !== 'object') return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(collapseWs(entry.loggedAt));
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function sortEntriesMostRecent(entries) {
  if (!Array.isArray(entries)) return [];
  return [...entries].sort((left, right) => parseLoggedAtTimestamp(right) - parseLoggedAtTimestamp(left));
}

function normalizePartKeys(parts) {
  const values = Array.isArray(parts) ? parts : [];
  const seen = new Set();
  const out = [];
  for (const part of values) {
    const key = collapseWs(part).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function formatKeyTopics(topics, limit = 8) {
  const values = Array.isArray(topics) ? topics : [];
  const out = [];
  const seen = new Set();
  for (const topic of values) {
    const label = collapseWs(topic);
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= limit) break;
  }
  return out;
}

function topicFilterHref(kind, topic) {
  const label = collapseWs(topic);
  if (!label) return '#';
  if (kind === 'talk') return `talks/?tag=${encodeURIComponent(label)}`;
  if (kind === 'blog') return `blogs/?tag=${encodeURIComponent(label)}`;
  if (kind === 'docs') return `work.html?mode=search&scope=docs&q=${encodeURIComponent(label)}`;
  return `papers/?tag=${encodeURIComponent(label)}`;
}

function isDirectPdfUrl(url) {
  return DIRECT_PDF_URL_RE.test(String(url || '').trim());
}

function sourceNameFromHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
  if (!host) return 'External Source';
  if (host === 'youtu.be' || host.endsWith('youtube.com')) return 'YouTube';
  if (host === 'devimages.apple.com') return 'Apple Developer';
  return host;
}

function videoLinkLabel(videoUrl) {
  const href = sanitizeExternalUrl(videoUrl);
  if (!href) return 'Video';
  try {
    const parsed = new URL(href);
    const sourceName = sourceNameFromHost(parsed.hostname);
    const isYouTube = sourceName === 'YouTube';
    const isDownload =
      /\.(mov|m4v|mp4|mkv|avi|wmv|webm)$/i.test(parsed.pathname) ||
      /download/i.test(parsed.pathname) ||
      /download/i.test(parsed.search);
    if (isDownload) return isYouTube ? 'Download' : `Download (${sourceName})`;
    if (!isYouTube) return `Watch on ${sourceName}`;
    return 'Watch';
  } catch {
    return 'Video';
  }
}

function formatIncludedParts(entry, kind) {
  const parts = normalizePartKeys(entry.parts);
  const out = [];
  const seen = new Set();
  const add = (label) => {
    const text = collapseWs(label);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) return;
    seen.add(key);
    out.push(text);
  };

  for (const part of parts) {
    if (part === 'talk') add('Talk');
    else if (part === 'slides') add('Slides');
    else if (part === 'video') add(videoLinkLabel(entry.videoUrl));
    else if (part === 'paper') add(isDirectPdfUrl(entry.paperUrl) ? 'PDF' : 'Paper');
    else if (part === 'blog') add('Post');
    else if (part === 'docs') add('Docs');
  }

  if (!out.length) {
    if (kind === 'talk') add('Talk');
    else if (kind === 'blog') add('Post');
    else if (kind === 'docs') add('Docs');
    else add(isDirectPdfUrl(entry.paperUrl) ? 'PDF' : 'Paper');
  }
  return out;
}

function detailLinkLabel(kind) {
  if (kind === 'talk') return 'Talk Details';
  if (kind === 'blog') return 'Blog Details';
  if (kind === 'docs') return 'Docs Home';
  return 'Paper Details';
}

function renderLinkTag(url, label, external = false) {
  const safeUrl = external ? sanitizeExternalUrl(url) : normalizeLibraryUrl(url);
  if (!safeUrl) return '';
  const attrs = external
    ? ' target="_blank" rel="noopener noreferrer"'
    : '';
  return `<a class="card-tag" href="${escapeHtml(safeUrl)}"${attrs}>${escapeHtml(label)}</a>`;
}

function renderEntry(entry) {
  const kindKey = collapseWs(entry.kind).toLowerCase();
  const kind = kindKey === 'blog'
    ? 'blog'
    : (kindKey === 'paper'
      ? 'paper'
      : (kindKey === 'docs' ? 'docs' : 'talk'));
  const kindLabel = kind === 'talk' ? 'Talk' : (kind === 'blog' ? 'Blog' : (kind === 'docs' ? 'Docs' : 'Paper'));
  const title = collapseWs(entry.title) || '(Untitled)';
  const url = normalizeLibraryUrl(entry.url);
  const loggedAtLabel = formatLoggedAt(entry.loggedAt);
  const includedLabels = formatIncludedParts(entry, kind);
  const keyTopics = formatKeyTopics(entry.keyTopics).filter((topic) => {
    const lower = collapseWs(topic).toLowerCase();
    return lower !== 'paper' && lower !== 'blog' && lower !== 'docs';
  });

  let context = '';
  if (kind === 'talk') {
    const pieces = [
      collapseWs(entry.meetingName),
      collapseWs(entry.meetingDate),
      collapseWs(entry.meetingSlug),
    ].filter(Boolean);
    context = pieces.join(' · ');
  } else if (kind === 'docs') {
    const revision = collapseWs(entry.sourceRevision) || collapseWs(entry.sourceHeadRevision);
    const revisionLabel = revision ? `rev ${revision.slice(0, 12)}` : '';
    const pieces = [
      collapseWs(entry.docsSourceName),
      collapseWs(entry.releaseName) || collapseWs(entry.releaseTag),
      revisionLabel,
      collapseWs(entry.source),
    ].filter(Boolean);
    context = pieces.join(' · ');
  } else {
    const pieces = [collapseWs(entry.year), collapseWs(entry.source)].filter(Boolean);
    context = pieces.join(' · ');
  }

  const linkItems = [];
  const addLink = (href, label, external) => {
    const rawHref = collapseWs(href);
    const rawLabel = collapseWs(label);
    if (!rawHref || !rawLabel) return;
    linkItems.push({ href: rawHref, label: rawLabel, external: !!external });
  };
  addLink(url, detailLinkLabel(kind), false);

  if (kind === 'talk') {
    addLink(entry.slidesUrl, 'Slides', true);
    addLink(entry.videoUrl, videoLinkLabel(entry.videoUrl), true);
  } else if (kind === 'blog') {
    const blogUrl = sanitizeExternalUrl(entry.blogUrl) || sanitizeExternalUrl(entry.sourceUrl);
    const repoUrl = sanitizeExternalUrl(entry.paperUrl);
    if (blogUrl) addLink(blogUrl, 'Post', true);
    if (repoUrl && repoUrl !== blogUrl) {
      addLink(repoUrl, 'Repo Source', true);
    } else if (!blogUrl && repoUrl) {
      addLink(repoUrl, 'Post', true);
    }
  } else if (kind === 'docs') {
    addLink(entry.sourceUrl, 'Upstream Docs', true);
    addLink(entry.sourceCommitUrl, 'Source Commit', true);
    addLink(entry.releaseUrl, 'Release', true);
  } else {
    const paperHref = sanitizeExternalUrl(entry.paperUrl);
    const sourceHref = sanitizeExternalUrl(entry.sourceUrl);
    const paperIsPdf = isDirectPdfUrl(paperHref);
    const sourceIsPdf = isDirectPdfUrl(sourceHref);
    if (paperHref) addLink(paperHref, paperIsPdf ? 'PDF' : 'Paper', true);
    if (sourceHref && sourceHref !== paperHref) {
      const sourceLabel = sourceIsPdf && !paperIsPdf ? 'PDF' : 'Source Listing';
      addLink(sourceHref, sourceLabel, true);
    }
  }

  const uniqueLinks = [];
  const seenLinks = new Set();
  for (const link of linkItems) {
    const key = `${link.external ? 'ext' : 'int'}|${link.href}|${link.label.toLowerCase()}`;
    if (!key || seenLinks.has(key)) continue;
    seenLinks.add(key);
    uniqueLinks.push(renderLinkTag(link.href, link.label, link.external));
  }

  const partHtml = includedLabels
    .map((label) => `<span class="card-tag card-tag--paper">${escapeHtml(label)}</span>`)
    .join('');
  const topicHtml = keyTopics
    .map((topic) => {
      const href = topicFilterHref(kind, topic);
      const browseScope = kind === 'talk' ? 'talks' : (kind === 'blog' ? 'blogs' : (kind === 'docs' ? 'docs pages' : 'papers'));
      return `<a class="card-tag" href="${escapeHtml(href)}" aria-label="Browse ${browseScope} for key topic ${escapeHtml(topic)}">${escapeHtml(topic)}</a>`;
    })
    .join('');

  return `
    <article class="update-entry">
      <div class="update-meta">
        <span class="update-kind ${kind}">${kindLabel}</span>
        <span>${escapeHtml(loggedAtLabel)}</span>
      </div>
      <h2 class="update-title"><a href="${escapeHtml(url)}">${escapeHtml(title)}</a></h2>
      ${context ? `<div class="update-context">${escapeHtml(context)}</div>` : ''}
      ${partHtml ? `<div class="update-row"><div class="update-row-label">What's included:</div><div class="card-tags update-parts" aria-label="What's included">${partHtml}</div></div>` : ''}
      ${topicHtml ? `<div class="update-row"><div class="update-row-label">Key topics:</div><div class="card-tags update-topics" aria-label="Key topics">${topicHtml}</div></div>` : ''}
      ${uniqueLinks.length ? `<div class="update-row"><div class="update-row-label">Links:</div><div class="card-tags update-links" aria-label="Resource links">${uniqueLinks.join('')}</div></div>` : ''}
    </article>
  `;
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

async function loadUpdateLog() {
  const payload = await fetchJson(UPDATE_LOG_PATH);
  if (!payload || typeof payload !== 'object') {
    throw new Error(`${UPDATE_LOG_PATH}: expected JSON object`);
  }
  const entries = sortEntriesMostRecent(payload.entries);
  const lastLibraryUpdateCompletedAt = collapseWs(payload.lastLibraryUpdateCompletedAt) || collapseWs(payload.generatedAt);
  return {
    lastLibraryUpdateCompletedAt,
    entries,
  };
}

function updateSubtitle(entries, lastLibraryUpdateCompletedAt) {
  const subtitle = document.getElementById('updates-subtitle');
  if (!subtitle) return;
  const count = entries.length;
  if (!count) {
    subtitle.textContent = 'No update entries recorded yet.';
    return;
  }
  const completedLabel = lastLibraryUpdateCompletedAt
    ? ` · last library update completed ${formatLoggedAt(lastLibraryUpdateCompletedAt)}`
    : '';
  subtitle.textContent = `${count.toLocaleString()} update entr${count === 1 ? 'y' : 'ies'}${completedLabel}`;
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

  const sentinel = document.getElementById('updates-load-sentinel');
  if (sentinel) sentinel.remove();
}

function ensureLoadMoreSentinel(root) {
  let sentinel = document.getElementById('updates-load-sentinel');
  if (!sentinel) {
    sentinel = document.createElement('div');
    sentinel.id = 'updates-load-sentinel';
    sentinel.setAttribute('aria-hidden', 'true');
    sentinel.style.width = '100%';
    sentinel.style.height = '1px';
    sentinel.style.gridColumn = '1 / -1';
  }
  root.appendChild(sentinel);
  return sentinel;
}

function setLoadStatus(message) {
  const root = document.getElementById('updates-root');
  if (!root) return;

  let status = document.getElementById('updates-load-status');
  if (!message) {
    if (status) status.remove();
    return;
  }

  if (!status) {
    status = document.createElement('p');
    status.id = 'updates-load-status';
    status.className = 'updates-load-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
  }
  status.textContent = message;
  root.appendChild(status);
}

function appendNextEntriesBatch(forceBatchSize = RENDER_BATCH_SIZE) {
  const root = document.getElementById('updates-root');
  if (!root) return;

  if (!activeRenderEntries.length || renderedCount >= activeRenderEntries.length) {
    teardownInfiniteLoader();
    if (activeRenderEntries.length) {
      setLoadStatus(`Loaded all ${activeRenderEntries.length.toLocaleString()} updates.`);
    } else {
      setLoadStatus('');
    }
    return;
  }

  const nextCount = Math.min(renderedCount + forceBatchSize, activeRenderEntries.length);
  const nextHtml = activeRenderEntries
    .slice(renderedCount, nextCount)
    .map((entry) => renderEntry(entry))
    .join('');

  root.insertAdjacentHTML('beforeend', nextHtml);
  renderedCount = nextCount;

  if (renderedCount >= activeRenderEntries.length) {
    teardownInfiniteLoader();
    setLoadStatus(`Loaded all ${activeRenderEntries.length.toLocaleString()} updates.`);
    return;
  }

  ensureLoadMoreSentinel(root);
  setLoadStatus(`Showing ${renderedCount.toLocaleString()} of ${activeRenderEntries.length.toLocaleString()} updates...`);
}

function setupInfiniteLoader() {
  const root = document.getElementById('updates-root');
  if (!root) return;

  teardownInfiniteLoader();
  if (renderedCount >= activeRenderEntries.length) return;

  const sentinel = ensureLoadMoreSentinel(root);

  if ('IntersectionObserver' in window) {
    loadMoreObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          appendNextEntriesBatch();
          break;
        }
      }
    }, { root: null, rootMargin: LOAD_MORE_ROOT_MARGIN, threshold: 0 });

    loadMoreObserver.observe(sentinel);
    return;
  }

  loadMoreScrollHandler = () => {
    const activeSentinel = document.getElementById('updates-load-sentinel');
    if (!activeSentinel) return;
    const rect = activeSentinel.getBoundingClientRect();
    if (rect.top <= window.innerHeight + 900) {
      appendNextEntriesBatch();
    }
  };

  window.addEventListener('scroll', loadMoreScrollHandler, { passive: true });
  window.addEventListener('resize', loadMoreScrollHandler);
  loadMoreScrollHandler();
}

function renderEntries(entries) {
  const root = document.getElementById('updates-root');
  if (!root) return;

  teardownInfiniteLoader();
  activeRenderEntries = [];
  renderedCount = 0;

  if (!entries.length) {
    setLoadStatus('');
    root.innerHTML = '<section class="updates-empty"><h2>No updates yet</h2><p>Newly added talks, slides, videos, papers, blogs, and docs updates will appear here after sync runs.</p></section>';
    return;
  }

  activeRenderEntries = entries;
  root.innerHTML = '';
  appendNextEntriesBatch(INITIAL_RENDER_BATCH_SIZE);
  setupInfiniteLoader();
}

function showError(message) {
  teardownInfiniteLoader();
  activeRenderEntries = [];
  renderedCount = 0;
  setLoadStatus('');
  const root = document.getElementById('updates-root');
  if (!root) return;
  root.innerHTML = `<section class="updates-empty"><h2>Could not load updates</h2><p>${escapeHtml(message)}</p></section>`;
}

async function init() {
  initTheme();
  initTextSize();
  initCustomizationMenu();
  initMobileNavMenu();
  initShareMenu();

  try {
    const { entries, lastLibraryUpdateCompletedAt } = await loadUpdateLog();
    updateSubtitle(entries, lastLibraryUpdateCompletedAt);
    renderEntries(entries);
  } catch (error) {
    showError(String(error && error.message ? error.message : error));
  }
}

init();

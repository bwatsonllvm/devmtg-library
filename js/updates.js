/**
 * updates.js — Render update log (talks/slides/videos/papers/blogs/docs additions).
 */

const UPDATE_LOG_PATH = 'updates/index.json';
const INITIAL_RENDER_BATCH_SIZE = 60;
const RENDER_BATCH_SIZE = 40;
const LOAD_MORE_ROOT_MARGIN = '900px 0px';
const INITIAL_BATCH_ENTRY_RENDER_SIZE = 60;
const BATCH_ENTRY_RENDER_SIZE = 40;
const BATCH_ENTRY_LOAD_ROOT_MARGIN = '600px 0px';
const DIRECT_PDF_URL_RE = /\.pdf(?:$|[?#])|\/pdf(?:$|[/?#])|[?&](?:format|type|output)=pdf(?:$|[&#])|[?&]filename=[^&#]*\.pdf(?:$|[&#])/i;
const UPDATE_KIND_ORDER = ['paper', 'docs', 'talk', 'blog'];
const UPDATE_KIND_LABELS = {
  paper: ['paper', 'papers'],
  docs: ['docs update', 'docs updates'],
  talk: ['talk update', 'talk updates'],
  blog: ['blog post', 'blog posts'],
};
let activeRenderBatches = [];
let renderedBatchCount = 0;
let renderedEntryCount = 0;
let loadMoreObserver = null;
let loadMoreScrollHandler = null;
const batchEntryRenderState = new Map();
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

function normalizeUpdateKind(rawKind) {
  const kindKey = collapseWs(rawKind).toLowerCase();
  if (kindKey === 'blog') return 'blog';
  if (kindKey === 'paper') return 'paper';
  if (kindKey === 'docs') return 'docs';
  return 'talk';
}

function batchKeyForEntry(entry, index) {
  const explicitBatchId = collapseWs(entry && entry.batchId);
  if (explicitBatchId) return `batch:${explicitBatchId}`;
  const loggedAt = collapseWs(entry && entry.loggedAt);
  if (loggedAt) return `logged:${loggedAt}`;
  const fingerprint = collapseWs(entry && entry.fingerprint);
  if (fingerprint) return `fp:${fingerprint}`;
  return `entry:${index + 1}`;
}

function formatBatchKindSummary(kindCounts) {
  const pieces = [];
  const counts = kindCounts && typeof kindCounts === 'object' ? kindCounts : {};
  for (const kind of UPDATE_KIND_ORDER) {
    const count = Number(counts[kind] || 0);
    if (!Number.isFinite(count) || count <= 0) continue;
    const [singular, plural] = UPDATE_KIND_LABELS[kind] || ['update', 'updates'];
    pieces.push(`${count.toLocaleString()} ${count === 1 ? singular : plural}`);
  }
  return pieces.join(' · ');
}

function groupEntriesIntoBatches(entries) {
  const groups = new Map();
  const sortedEntries = sortEntriesMostRecent(entries);
  sortedEntries.forEach((entry, index) => {
    const batchKey = batchKeyForEntry(entry, index);
    const entryLoggedAt = collapseWs(entry && entry.loggedAt);
    if (!groups.has(batchKey)) {
      groups.set(batchKey, {
        batchKey,
        batchId: collapseWs(entry && entry.batchId),
        loggedAt: entryLoggedAt,
        entries: [],
      });
    }
    const group = groups.get(batchKey);
    group.entries.push(entry);
    if (!group.loggedAt && entryLoggedAt) group.loggedAt = entryLoggedAt;
  });

  const batches = Array.from(groups.values())
    .map((group, index) => {
      const entriesInBatch = sortEntriesMostRecent(group.entries);
      const kindCounts = {};
      for (const entry of entriesInBatch) {
        const kind = normalizeUpdateKind(entry && entry.kind);
        kindCounts[kind] = (kindCounts[kind] || 0) + 1;
      }
      return {
        ...group,
        entries: entriesInBatch,
        entryCount: entriesInBatch.length,
        kindCounts,
        kindSummary: formatBatchKindSummary(kindCounts),
        sortTimestamp: parseLoggedAtTimestamp({ loggedAt: group.loggedAt }),
        domId: `updates-batch-${index + 1}`,
      };
    })
    .sort((left, right) => right.sortTimestamp - left.sortTimestamp)
    .map((batch, index) => ({
      ...batch,
      domId: `updates-batch-${index + 1}`,
    }));

  return batches;
}

function totalEntriesInBatches(batches) {
  if (!Array.isArray(batches)) return 0;
  return batches.reduce((sum, batch) => sum + Number(batch && batch.entryCount ? batch.entryCount : 0), 0);
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
  const kind = normalizeUpdateKind(entry.kind);
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

function renderBatch(batch, batchIndex) {
  const entryCount = Number(batch.entryCount || 0);
  const loggedAtLabel = batch.loggedAt ? formatLoggedAt(batch.loggedAt) : 'Unknown time';
  const countLabel = `${entryCount.toLocaleString()} update${entryCount === 1 ? '' : 's'}`;
  const summaryLabel = batch.kindSummary ? `${countLabel} · ${batch.kindSummary}` : countLabel;
  const safeDomId = escapeHtml(collapseWs(batch.domId) || `updates-batch-${Math.random().toString(16).slice(2)}`);
  const safeBatchKey = escapeHtml(collapseWs(batch.batchKey) || safeDomId);
  const safeBatchIndex = Number.isFinite(Number(batchIndex)) ? String(Number(batchIndex)) : '-1';

  return `
    <section class="update-batch" data-batch-key="${safeBatchKey}">
      <button class="update-batch-toggle" type="button" aria-expanded="false" aria-controls="${safeDomId}">
        <span class="update-batch-heading">Update Batch · ${escapeHtml(loggedAtLabel)}</span>
        <span class="update-batch-subheading">${escapeHtml(summaryLabel)}</span>
        <span class="update-batch-chevron" aria-hidden="true">⌄</span>
      </button>
      <div class="update-batch-panel" id="${safeDomId}" data-batch-index="${safeBatchIndex}" hidden>
        <div class="update-batch-entries" data-batch-entries></div>
        <p class="update-batch-load-status" data-batch-load-status hidden></p>
        <div class="update-batch-load-sentinel" data-batch-load-sentinel aria-hidden="true" hidden></div>
      </div>
    </section>
  `;
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

async function loadUpdateLog() {
  const payload = await fetchJson(UPDATE_LOG_PATH);
  if (!payload || typeof payload !== 'object') {
    throw new Error(`${UPDATE_LOG_PATH}: expected JSON object`);
  }
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  const batches = groupEntriesIntoBatches(entries);
  const lastLibraryUpdateCompletedAt = collapseWs(payload.lastLibraryUpdateCompletedAt) || collapseWs(payload.generatedAt);
  return {
    lastLibraryUpdateCompletedAt,
    entries,
    batches,
  };
}

function updateSubtitle(entries, batches, lastLibraryUpdateCompletedAt) {
  const subtitle = document.getElementById('updates-subtitle');
  if (!subtitle) return;
  const count = entries.length;
  const batchCount = Array.isArray(batches) ? batches.length : 0;
  if (!count) {
    subtitle.textContent = 'No update entries recorded yet.';
    return;
  }
  const completedLabel = lastLibraryUpdateCompletedAt
    ? ` · last library update completed ${formatLoggedAt(lastLibraryUpdateCompletedAt)}`
    : '';
  subtitle.textContent = `${count.toLocaleString()} update entr${count === 1 ? 'y' : 'ies'} in ${batchCount.toLocaleString()} batch${batchCount === 1 ? '' : 'es'}${completedLabel}`;
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

function batchStateKeyForNode(batchNode) {
  return collapseWs(batchNode && batchNode.getAttribute && batchNode.getAttribute('data-batch-key'));
}

function getExistingBatchEntryState(batchNode) {
  const stateKey = batchStateKeyForNode(batchNode);
  if (!stateKey) return null;
  return batchEntryRenderState.get(stateKey) || null;
}

function ensureBatchEntryState(batchNode) {
  const stateKey = batchStateKeyForNode(batchNode);
  if (!stateKey) return null;
  if (!batchEntryRenderState.has(stateKey)) {
    batchEntryRenderState.set(stateKey, {
      initialized: false,
      renderedCount: 0,
      observer: null,
      scrollHandler: null,
      isAppending: false,
    });
  }
  return batchEntryRenderState.get(stateKey) || null;
}

function teardownBatchEntryLoader(batchNode) {
  const state = getExistingBatchEntryState(batchNode);
  if (!state) return;

  if (state.observer) {
    state.observer.disconnect();
    state.observer = null;
  }

  if (state.scrollHandler) {
    window.removeEventListener('scroll', state.scrollHandler);
    window.removeEventListener('resize', state.scrollHandler);
    state.scrollHandler = null;
  }
}

function teardownAllBatchEntryLoaders() {
  for (const state of batchEntryRenderState.values()) {
    if (state && state.observer) state.observer.disconnect();
    if (state && state.scrollHandler) {
      window.removeEventListener('scroll', state.scrollHandler);
      window.removeEventListener('resize', state.scrollHandler);
    }
  }
  batchEntryRenderState.clear();
}

function batchForNode(batchNode) {
  if (!batchNode) return null;
  const panel = batchNode.querySelector('.update-batch-panel');
  if (!panel) return null;
  const batchIndex = Number.parseInt(collapseWs(panel.dataset.batchIndex), 10);
  if (!Number.isInteger(batchIndex) || batchIndex < 0 || batchIndex >= activeRenderBatches.length) return null;
  return activeRenderBatches[batchIndex] || null;
}

function updateBatchLoadStatus(panel, message) {
  const status = panel ? panel.querySelector('[data-batch-load-status]') : null;
  if (!status) return;
  if (!message) {
    status.hidden = true;
    status.textContent = '';
    return;
  }
  status.hidden = false;
  status.textContent = message;
}

function appendEntriesForBatch(batchNode, count) {
  if (!batchNode) return;
  const panel = batchNode.querySelector('.update-batch-panel');
  const entriesRoot = panel ? panel.querySelector('[data-batch-entries]') : null;
  const sentinel = panel ? panel.querySelector('[data-batch-load-sentinel]') : null;
  const batch = batchForNode(batchNode);
  const state = ensureBatchEntryState(batchNode);
  if (!panel || !entriesRoot || !sentinel || !batch || !state || state.isAppending) return;

  const entries = Array.isArray(batch.entries) ? batch.entries : [];
  const total = entries.length;
  if (!total) {
    sentinel.hidden = true;
    updateBatchLoadStatus(panel, '');
    return;
  }

  if (state.renderedCount >= total) {
    sentinel.hidden = true;
    updateBatchLoadStatus(panel, total > INITIAL_BATCH_ENTRY_RENDER_SIZE ? `Loaded all ${total.toLocaleString()} updates in this batch.` : '');
    return;
  }

  const chunkSize = Number.isFinite(Number(count)) && Number(count) > 0
    ? Number(count)
    : BATCH_ENTRY_RENDER_SIZE;

  state.isAppending = true;
  try {
    const nextCount = Math.min(state.renderedCount + chunkSize, total);
    const nextSlice = entries.slice(state.renderedCount, nextCount);
    const html = nextSlice.map((entry) => renderEntry(entry)).join('');
    if (html) entriesRoot.insertAdjacentHTML('beforeend', html);
    state.renderedCount = nextCount;
  } finally {
    state.isAppending = false;
  }

  if (state.renderedCount >= total) {
    sentinel.hidden = true;
    updateBatchLoadStatus(panel, total > INITIAL_BATCH_ENTRY_RENDER_SIZE ? `Loaded all ${total.toLocaleString()} updates in this batch.` : '');
    teardownBatchEntryLoader(batchNode);
    return;
  }

  sentinel.hidden = false;
  updateBatchLoadStatus(
    panel,
    `Showing ${state.renderedCount.toLocaleString()} of ${total.toLocaleString()} updates in this batch...`
  );
}

function ensureBatchEntriesInitialized(batchNode) {
  const state = ensureBatchEntryState(batchNode);
  if (!state || state.initialized) return;
  state.initialized = true;
  appendEntriesForBatch(batchNode, INITIAL_BATCH_ENTRY_RENDER_SIZE);
}

function setupBatchEntryLoader(batchNode) {
  const panel = batchNode ? batchNode.querySelector('.update-batch-panel') : null;
  const sentinel = panel ? panel.querySelector('[data-batch-load-sentinel]') : null;
  const batch = batchForNode(batchNode);
  const state = ensureBatchEntryState(batchNode);
  if (!panel || !sentinel || !batch || !state) return;

  teardownBatchEntryLoader(batchNode);
  const total = Array.isArray(batch.entries) ? batch.entries.length : 0;
  if (!total || state.renderedCount >= total || panel.hidden) {
    sentinel.hidden = true;
    return;
  }
  sentinel.hidden = false;

  if ('IntersectionObserver' in window) {
    state.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          appendEntriesForBatch(batchNode, BATCH_ENTRY_RENDER_SIZE);
          break;
        }
      }
    }, { root: null, rootMargin: BATCH_ENTRY_LOAD_ROOT_MARGIN, threshold: 0 });
    state.observer.observe(sentinel);
    return;
  }

  state.scrollHandler = () => {
    const rect = sentinel.getBoundingClientRect();
    if (rect.top <= window.innerHeight + 650) {
      appendEntriesForBatch(batchNode, BATCH_ENTRY_RENDER_SIZE);
    }
  };
  window.addEventListener('scroll', state.scrollHandler, { passive: true });
  window.addEventListener('resize', state.scrollHandler);
  state.scrollHandler();
}

function setBatchExpandedState(batchNode, expanded) {
  if (!batchNode) return;
  const toggle = batchNode.querySelector('.update-batch-toggle');
  const panel = batchNode.querySelector('.update-batch-panel');
  if (!toggle || !panel) return;
  const nextExpanded = !!expanded;
  toggle.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
  batchNode.classList.toggle('is-open', nextExpanded);
  panel.hidden = !nextExpanded;
}

function bindBatchToggleDelegation() {
  const root = document.getElementById('updates-root');
  if (!root || root.dataset.batchToggleBound === '1') return;
  root.dataset.batchToggleBound = '1';

  root.addEventListener('click', (event) => {
    const toggle = event.target && event.target.closest
      ? event.target.closest('.update-batch-toggle')
      : null;
    if (!toggle) return;
    const batchNode = toggle.closest('.update-batch');
    if (!batchNode) return;
    const expanded = String(toggle.getAttribute('aria-expanded') || '').toLowerCase() === 'true';
    const nextExpanded = !expanded;
    setBatchExpandedState(batchNode, nextExpanded);

    if (nextExpanded) {
      ensureBatchEntriesInitialized(batchNode);
      setupBatchEntryLoader(batchNode);
    } else {
      teardownBatchEntryLoader(batchNode);
    }
  });
}

function appendNextEntriesBatch(forceBatchSize = RENDER_BATCH_SIZE) {
  const root = document.getElementById('updates-root');
  if (!root) return;

  if (!activeRenderBatches.length || renderedBatchCount >= activeRenderBatches.length) {
    teardownInfiniteLoader();
    if (activeRenderBatches.length) {
      const totalEntries = totalEntriesInBatches(activeRenderBatches);
      setLoadStatus(
        `Loaded ${activeRenderBatches.length.toLocaleString()} batches `
        + `(${totalEntries.toLocaleString()} updates). Expand a batch to load entries.`
      );
    } else {
      setLoadStatus('');
    }
    return;
  }

  const nextBatchCount = Math.min(renderedBatchCount + forceBatchSize, activeRenderBatches.length);
  const nextSlice = activeRenderBatches.slice(renderedBatchCount, nextBatchCount);
  const batchStartIndex = renderedBatchCount;
  const nextHtml = nextSlice
    .map((batch, index) => renderBatch(batch, batchStartIndex + index))
    .join('');

  root.insertAdjacentHTML('beforeend', nextHtml);
  renderedBatchCount = nextBatchCount;
  renderedEntryCount += totalEntriesInBatches(nextSlice);

  if (renderedBatchCount >= activeRenderBatches.length) {
    teardownInfiniteLoader();
    const totalEntries = totalEntriesInBatches(activeRenderBatches);
    setLoadStatus(
      `Loaded ${activeRenderBatches.length.toLocaleString()} batches `
      + `(${totalEntries.toLocaleString()} updates). Expand a batch to load entries.`
    );
    return;
  }

  ensureLoadMoreSentinel(root);
  const totalEntries = totalEntriesInBatches(activeRenderBatches);
  setLoadStatus(
    `Loaded ${renderedBatchCount.toLocaleString()} of ${activeRenderBatches.length.toLocaleString()} batch`
    + `${renderedBatchCount === 1 ? '' : 'es'} `
    + `(${renderedEntryCount.toLocaleString()} of ${totalEntries.toLocaleString()} updates indexed)...`
  );
}

function setupInfiniteLoader() {
  const root = document.getElementById('updates-root');
  if (!root) return;

  teardownInfiniteLoader();
  if (renderedBatchCount >= activeRenderBatches.length) return;

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

function renderEntries(batches) {
  const root = document.getElementById('updates-root');
  if (!root) return;

  teardownInfiniteLoader();
  teardownAllBatchEntryLoaders();
  activeRenderBatches = [];
  renderedBatchCount = 0;
  renderedEntryCount = 0;

  if (!batches.length) {
    setLoadStatus('');
    root.innerHTML = '<section class="updates-empty"><h2>No updates yet</h2><p>Newly added talks, slides, videos, papers, blogs, and docs updates will appear here after sync runs.</p></section>';
    return;
  }

  activeRenderBatches = batches;
  root.innerHTML = '';
  bindBatchToggleDelegation();
  appendNextEntriesBatch(INITIAL_RENDER_BATCH_SIZE);
  setupInfiniteLoader();
}

function showError(message) {
  teardownInfiniteLoader();
  teardownAllBatchEntryLoaders();
  activeRenderBatches = [];
  renderedBatchCount = 0;
  renderedEntryCount = 0;
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
    const { entries, batches, lastLibraryUpdateCompletedAt } = await loadUpdateLog();
    updateSubtitle(entries, batches, lastLibraryUpdateCompletedAt);
    renderEntries(batches);
  } catch (error) {
    showError(String(error && error.message ? error.message : error));
  }
}

init();

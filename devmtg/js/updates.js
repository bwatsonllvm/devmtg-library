/**
 * updates.js — Render update log (talks/slides/videos/papers/blogs additions).
 */

const UPDATE_LOG_PATH = 'updates/index.json';
const INITIAL_RENDER_BATCH_SIZE = 60;
const RENDER_BATCH_SIZE = 40;
const LOAD_MORE_ROOT_MARGIN = '900px 0px';
let activeRenderEntries = [];
let renderedCount = 0;
let loadMoreObserver = null;
let loadMoreScrollHandler = null;

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

function isAbsoluteUrl(value) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value);
}

function normalizeLibraryUrl(value) {
  const raw = collapseWs(value);
  if (!raw) return '#';
  if (isAbsoluteUrl(raw)) return raw;
  if (raw.startsWith('/devmtg/')) return raw.slice('/devmtg/'.length);
  if (raw.startsWith('/talk.html') || raw.startsWith('/paper.html')) return raw.slice(1);
  return raw;
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

function formatParts(parts) {
  const values = Array.isArray(parts) ? parts : [];
  const labels = {
    talk: 'Talk',
    slides: 'Slides',
    video: 'Video',
    paper: 'Paper',
    blog: 'Blog',
  };
  const seen = new Set();
  const out = [];
  for (const part of values) {
    const key = collapseWs(part).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(labels[key] || key);
  }
  return out;
}

function renderEntry(entry) {
  const kindKey = collapseWs(entry.kind).toLowerCase();
  const kind = kindKey === 'blog' ? 'blog' : (kindKey === 'paper' ? 'paper' : 'talk');
  const title = collapseWs(entry.title) || '(Untitled)';
  const url = normalizeLibraryUrl(entry.url);
  const loggedAtLabel = formatLoggedAt(entry.loggedAt);
  const partLabels = formatParts(entry.parts);

  let context = '';
  if (kind === 'talk') {
    const pieces = [
      collapseWs(entry.meetingName),
      collapseWs(entry.meetingDate),
      collapseWs(entry.meetingSlug),
    ].filter(Boolean);
    context = pieces.join(' · ');
  } else {
    const pieces = [collapseWs(entry.year), collapseWs(entry.source)].filter(Boolean);
    context = pieces.join(' · ');
  }

  const links = [];
  links.push(`<a href="${escapeHtml(url)}">Open in Library</a>`);

  if (kind === 'talk') {
    const slidesUrl = collapseWs(entry.slidesUrl);
    const videoUrl = collapseWs(entry.videoUrl);
    if (slidesUrl) links.push(`<a href="${escapeHtml(slidesUrl)}" target="_blank" rel="noopener noreferrer">Slides</a>`);
    if (videoUrl) links.push(`<a href="${escapeHtml(videoUrl)}" target="_blank" rel="noopener noreferrer">Video</a>`);
  } else if (kind === 'blog') {
    const blogUrl = collapseWs(entry.blogUrl) || collapseWs(entry.sourceUrl);
    const repoUrl = collapseWs(entry.paperUrl);
    if (blogUrl) links.push(`<a href="${escapeHtml(blogUrl)}" target="_blank" rel="noopener noreferrer">Blog post</a>`);
    if (repoUrl && repoUrl !== blogUrl) {
      links.push(`<a href="${escapeHtml(repoUrl)}" target="_blank" rel="noopener noreferrer">Repo source</a>`);
    } else if (!blogUrl && repoUrl) {
      links.push(`<a href="${escapeHtml(repoUrl)}" target="_blank" rel="noopener noreferrer">Source</a>`);
    }
  } else {
    const paperUrl = collapseWs(entry.paperUrl);
    const sourceUrl = collapseWs(entry.sourceUrl);
    if (paperUrl) links.push(`<a href="${escapeHtml(paperUrl)}" target="_blank" rel="noopener noreferrer">Paper URL</a>`);
    if (sourceUrl) links.push(`<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">Source URL</a>`);
  }

  const partHtml = partLabels.map((label) => `<span class="update-part">${escapeHtml(label)}</span>`).join('');

  return `
    <article class="update-entry">
      <div class="update-meta">
        <span>${escapeHtml(loggedAtLabel)}</span>
      </div>
      <h2 class="update-title"><a href="${escapeHtml(url)}">${escapeHtml(title)}</a></h2>
      ${context ? `<div class="update-context">${escapeHtml(context)}</div>` : ''}
      ${partHtml ? `<div class="update-parts">${partHtml}</div>` : ''}
      <div class="update-links">${links.join('')}</div>
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
  return {
    generatedAt: collapseWs(payload.generatedAt),
    entries,
  };
}

function updateSubtitle(entries, generatedAt) {
  const subtitle = document.getElementById('updates-subtitle');
  if (!subtitle) return;
  const count = entries.length;
  if (!count) {
    subtitle.textContent = 'No update entries recorded yet.';
    return;
  }
  const generatedLabel = generatedAt ? ` · generated ${formatLoggedAt(generatedAt)}` : '';
  subtitle.textContent = `${count.toLocaleString()} update entr${count === 1 ? 'y' : 'ies'}${generatedLabel}`;
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
    root.innerHTML = '<section class="updates-empty"><h2>No updates yet</h2><p>Newly added talks, slides, videos, papers, and blogs will appear here after sync runs.</p></section>';
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
    link.addEventListener('click', () => closeMenu());
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
  if (textSize === 'default') document.documentElement.removeAttribute('data-text-size');
  else document.documentElement.setAttribute('data-text-size', textSize);
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

async function init() {
  initTheme();
  initTextSize();
  initCustomizationMenu();
  initMobileNavMenu();
  initShareMenu();

  try {
    const { entries, generatedAt } = await loadUpdateLog();
    updateSubtitle(entries, generatedAt);
    renderEntries(entries);
  } catch (error) {
    showError(String(error && error.message ? error.message : error));
  }
}

init();

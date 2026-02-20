/**
 * papers.js - Academic papers listing page for LLVM Developers' Meeting Library
 */

let allPapers = [];
const state = {
  query: '',
  activeTag: '',
};

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

function normalizePaperRecord(rawPaper) {
  if (!rawPaper || typeof rawPaper !== 'object') return null;
  const paper = { ...rawPaper };
  paper.id = String(paper.id || '').trim();
  paper.title = String(paper.title || '').trim();
  paper.abstract = String(paper.abstract || '').trim();
  paper.year = String(paper.year || '').trim();
  paper.venue = String(paper.venue || '').trim();
  paper.type = String(paper.type || '').trim();
  paper.paperUrl = String(paper.paperUrl || '').trim();
  paper.sourceUrl = String(paper.sourceUrl || '').trim();

  paper.authors = Array.isArray(paper.authors)
    ? paper.authors
      .map((author) => {
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

  if (!paper.id || !paper.title) return null;

  const authorsFlat = paper.authors.map((author) => `${author.name} ${author.affiliation || ''}`).join(' ');
  const tagsFlat = paper.tags.join(' ');
  paper._searchText = [paper.title, paper.abstract, paper.venue, paper.year, authorsFlat, tagsFlat]
    .join(' ')
    .toLowerCase();

  return paper;
}

function getAuthorSummary(authors) {
  if (!Array.isArray(authors) || authors.length === 0) {
    return 'Authors unknown';
  }
  return authors.map((author) => {
    if (author.affiliation) return `${author.name} (${author.affiliation})`;
    return author.name;
  }).join(', ');
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
  const shareTitle = document.title || "LLVM Developers' Meeting Library";
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

  if (nativeShareBtn) {
    nativeShareBtn.hidden = !supportsNativeShare;
  }

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
// Rendering
// ============================================================

function renderTagFilters(papers) {
  const container = document.getElementById('paper-tag-filters');
  if (!container) return;

  const counts = {};
  for (const paper of papers) {
    for (const tag of (paper.tags || [])) {
      counts[tag] = (counts[tag] || 0) + 1;
    }
  }

  const sortedTags = Object.entries(counts)
    .sort((a, b) => a[0].localeCompare(b[0]));

  if (!sortedTags.length) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = sortedTags.map(([tag, count]) => {
    const active = state.activeTag === tag;
    return `<button class="filter-chip filter-chip--tag ${active ? 'active' : ''}" data-paper-tag="${escapeHtml(tag)}" role="switch" aria-checked="${active ? 'true' : 'false'}">${escapeHtml(tag)} <span class="filter-chip-count">${count.toLocaleString()}</span></button>`;
  }).join('');

  container.querySelectorAll('button[data-paper-tag]').forEach((button) => {
    button.addEventListener('click', () => {
      const tag = button.dataset.paperTag || '';
      if (!tag) return;
      state.activeTag = state.activeTag === tag ? '' : tag;
      syncUrl();
      render();
    });
  });
}

function renderPaperCard(paper) {
  const titleEsc = escapeHtml(paper.title);
  const authorSummary = getAuthorSummary(paper.authors);
  const authorEsc = escapeHtml(authorSummary);
  const yearLabel = escapeHtml(paper.year || 'Unknown year');
  const venueLabel = escapeHtml(paper.venue || 'Academic paper');
  const sourceLink = paper.sourceUrl
    ? `<a href="${escapeHtml(paper.sourceUrl)}" class="card-link-btn" target="_blank" rel="noopener noreferrer" aria-label="View source listing for ${titleEsc} (opens in new tab)"><span aria-hidden="true">Source</span></a>`
    : '';
  const paperLink = paper.paperUrl
    ? `<a href="${escapeHtml(paper.paperUrl)}" class="card-link-btn card-link-btn--video" target="_blank" rel="noopener noreferrer" aria-label="Open paper PDF for ${titleEsc} (opens in new tab)"><span aria-hidden="true">PDF</span></a>`
    : '';

  const tagsHtml = paper.tags.length
    ? `<div class="card-tags-wrap"><div class="card-tags" aria-label="Paper tags">${paper.tags.map((tag) => `<span class="card-tag card-tag--paper">${escapeHtml(tag)}</span>`).join('')}</div></div>`
    : '';

  return `
    <article class="talk-card paper-card">
      <div class="card-link-wrap">
        <div class="card-body">
          <div class="card-meta">
            <span class="badge badge-paper">Paper</span>
            <span class="meeting-label">${yearLabel}</span>
            <span class="meeting-label">${venueLabel}</span>
          </div>
          <p class="card-title">${titleEsc}</p>
          <p class="card-speakers paper-authors">${authorEsc}</p>
          <p class="card-abstract">${escapeHtml(paper.abstract || 'No abstract available.')}</p>
        </div>
      </div>
      ${tagsHtml}
      ${(paperLink || sourceLink) ? `<div class="card-footer">${paperLink}${sourceLink}</div>` : ''}
    </article>`;
}

function applyFilters() {
  const query = state.query.trim().toLowerCase();

  return allPapers.filter((paper) => {
    if (state.activeTag && !(paper.tags || []).includes(state.activeTag)) return false;
    if (query && !paper._searchText.includes(query)) return false;
    return true;
  }).sort((a, b) => {
    const yearCmp = String(b.year || '').localeCompare(String(a.year || ''));
    if (yearCmp !== 0) return yearCmp;
    return String(a.title || '').localeCompare(String(b.title || ''));
  });
}

function renderPapersGrid(papers) {
  const root = document.getElementById('papers-root');
  if (!root) return;

  if (!papers.length) {
    root.innerHTML = `
      <div class="empty-state" role="status">
        <div class="empty-state-icon" aria-hidden="true">PDF</div>
        <h2>No papers found</h2>
        <p>No papers match the current search and tag filters.</p>
      </div>`;
    return;
  }

  root.innerHTML = papers.map((paper) => renderPaperCard(paper)).join('');
}

function updateSubtitle(resultsCount) {
  const el = document.getElementById('papers-subtitle');
  if (!el) return;
  el.textContent = `${resultsCount.toLocaleString()} of ${allPapers.length.toLocaleString()} paper${allPapers.length === 1 ? '' : 's'}`;
}

function render() {
  const results = applyFilters();
  renderTagFilters(allPapers);
  renderPapersGrid(results);
  updateSubtitle(results.length);
  syncSearchControls();
}

function syncSearchControls() {
  const input = document.getElementById('papers-search-input');
  const clearBtn = document.getElementById('papers-search-clear');
  if (input && input.value !== state.query) input.value = state.query;
  if (clearBtn) clearBtn.hidden = !state.query;
}

function initSearch() {
  const input = document.getElementById('papers-search-input');
  const clearBtn = document.getElementById('papers-search-clear');
  if (!input) return;

  input.addEventListener('input', () => {
    state.query = input.value || '';
    syncUrl();
    render();
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      state.query = '';
      state.activeTag = '';
      syncUrl();
      render();
      input.focus();
    });
  }
}

// ============================================================
// URL sync
// ============================================================

function syncUrl() {
  const params = new URLSearchParams();
  if (state.query) params.set('q', state.query);
  if (state.activeTag) params.set('tag', state.activeTag);

  const newUrl = params.toString()
    ? `${window.location.pathname}?${params.toString()}`
    : window.location.pathname;
  history.replaceState(null, '', newUrl);
}

function loadStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  state.query = String(params.get('q') || '').trim();
  state.activeTag = String(params.get('tag') || '').trim();
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
  document.documentElement.style.backgroundColor = resolved === 'dark' ? '#000000' : '#f6f8fa';
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

// ============================================================
// Boot
// ============================================================

(async function init() {
  initTheme();
  initTextSize();
  initCustomizationMenu();
  initMobileNavMenu();
  initShareMenu();

  const { papers } = await loadData();
  allPapers = Array.isArray(papers)
    ? papers.map(normalizePaperRecord).filter(Boolean)
    : [];

  loadStateFromUrl();
  initSearch();
  render();
})();

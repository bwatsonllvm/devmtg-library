/**
 * paper.js — Paper detail page logic for LLVM Developers' Meeting Library
 */

const HubUtils = window.LLVMHubUtils || {};

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

function normalizePaperRecord(rawPaper) {
  if (!rawPaper || typeof rawPaper !== 'object') return null;

  const paper = { ...rawPaper };
  paper.id = String(paper.id || '').trim();
  paper.title = String(paper.title || '').trim();
  paper.abstract = String(paper.abstract || '').trim();
  paper.year = String(paper.year || '').trim();
  const metadata = normalizePublicationAndVenue(paper.publication, paper.venue);
  paper.publication = metadata.publication;
  paper.venue = metadata.venue;
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
  paper._year = /^\d{4}$/.test(paper.year) ? paper.year : '';
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

function renderAuthors(authors) {
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
          <a href="papers.html?speaker=${encodeURIComponent(author.name)}" class="speaker-name-link" aria-label="View all papers by ${name}">${name}</a>
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
  const speakerLinksHtml = (paper.authors || []).length
    ? paper.authors.map((author) =>
      `<a href="papers.html?speaker=${encodeURIComponent(author.name)}" class="card-speaker-link" aria-label="View all papers by ${escapeHtml(author.name)}">${escapeHtml(author.name)}</a>`
    ).join('<span class="speaker-btn-sep">, </span>')
    : '';

  const relatedLabel = `${escapeHtml(paper.title)}${speakerLinksHtml ? ` by ${escapeHtml((paper.authors || []).map((author) => author.name).join(', '))}` : ''}`;
  const year = escapeHtml(paper._year || 'Unknown year');

  return `
    <article class="talk-card paper-card">
      <a href="paper.html?id=${escapeHtml(paper.id)}" class="card-link-wrap" aria-label="${relatedLabel}">
        <div class="card-thumbnail paper-thumbnail" aria-hidden="true">
          <div class="card-thumbnail-placeholder paper-thumbnail-placeholder">
            ${_PAPER_PLACEHOLDER}
            <span class="paper-thumbnail-label">Paper</span>
          </div>
        </div>
        <div class="card-body">
          <div class="card-meta">
            <span class="badge badge-paper">Paper</span>
            <span class="meeting-label">${year}</span>
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
  const authorsHtml = renderAuthors(paper.authors);

  const infoParts = [];
  if (paper._year) infoParts.push(paper._year);
  if (paper.publication) infoParts.push(paper.publication);
  if (paper.venue && paper.venue !== paper.publication) infoParts.push(paper.venue);

  const links = [];
  if (paper.paperUrl) {
    const isPdf = /\.pdf(?:$|[?#])/i.test(paper.paperUrl);
    links.push(`
      <a href="${escapeHtml(paper.paperUrl)}" class="link-btn" target="_blank" rel="noopener noreferrer" aria-label="Open ${isPdf ? 'PDF' : 'paper'} for ${escapeHtml(paper.title)} (opens in new tab)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        ${isPdf ? 'Open PDF' : 'Open Paper'}
      </a>`);
  }
  if (paper.sourceUrl) {
    links.push(`
      <a href="${escapeHtml(paper.sourceUrl)}" class="link-btn" target="_blank" rel="noopener noreferrer" aria-label="Open source listing for ${escapeHtml(paper.title)} (opens in new tab)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l1.41-1.41a5 5 0 1 0-7.07-7.07L10 6"/><path d="M14 11a5 5 0 0 0-7.07 0L5.52 12.4a5 5 0 0 0 7.07 7.07L14 18"/></svg>
        Source Listing
      </a>`);
  }

  const tagsHtml = (paper.tags || []).length
    ? `<section class="tags-section" aria-label="Topics">
        <div class="section-label" aria-hidden="true">Topics</div>
        <div class="detail-tags">
          ${(paper.tags || []).map((tag) =>
            `<a href="papers.html?tag=${encodeURIComponent(tag)}" class="detail-tag" aria-label="Browse papers tagged ${escapeHtml(tag)}">${escapeHtml(tag)}</a>`
          ).join('')}
        </div>
      </section>`
    : '';

  const publicationHtml = paper.publication
    ? `<section class="tags-section" aria-label="Publication">
        <div class="section-label" aria-hidden="true">Publication</div>
        <div class="detail-tags">
          <a href="papers.html?q=${encodeURIComponent(paper.publication)}" class="detail-tag" aria-label="Search papers for ${escapeHtml(paper.publication)}">${escapeHtml(paper.publication)}</a>
        </div>
      </section>`
    : '';

  const related = getRelatedPapers(paper, allPapers);

  root.innerHTML = `
    <div class="talk-detail">
      <a href="papers.html" class="back-btn" id="back-btn" aria-label="Back to all papers">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
        <span aria-hidden="true">All Papers</span>
      </a>

      <div class="talk-header">
        <div class="talk-header-meta">
          <span class="badge badge-paper">Paper</span>
          ${infoParts.length ? `<span class="meeting-info-badge">${escapeHtml(infoParts.join(' · '))}</span>` : ''}
        </div>
        <h1 class="talk-title">${escapeHtml(paper.title)}</h1>
      </div>

      <section class="speakers-section" aria-label="Authors">
        <div class="section-label" aria-hidden="true">Authors</div>
        <div class="speakers-list">${authorsHtml}</div>
      </section>

      ${links.length ? `<div class="links-bar" aria-label="Resources">${links.join('')}</div>` : ''}

      <section class="abstract-section" aria-label="Abstract">
        <div class="section-label" aria-hidden="true">Abstract</div>
        <div class="abstract-body">
          ${renderAbstract(paper.abstract)}
        </div>
      </section>

      ${publicationHtml}
      ${tagsHtml}
    </div>

    ${related.length ? `
    <section class="related-section" aria-label="Related papers">
      <h2>Related Papers</h2>
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
}

function renderNotFound(id) {
  const root = document.getElementById('paper-detail-root');
  root.innerHTML = `
    <div class="talk-detail">
      <a href="papers.html" class="back-btn" aria-label="Back to all papers">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
        <span aria-hidden="true">All Papers</span>
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
  document.documentElement.style.backgroundColor = resolved === 'dark' ? '#fafafa' : '#0b0d10';
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
    renderNotFound(null);
    initShareMenu();
    return;
  }

  const paper = allPapers.find((candidate) => candidate.id === paperId);
  if (!paper) {
    renderNotFound(paperId);
    initShareMenu();
    return;
  }

  document.title = `${paper.title} — LLVM Developers' Meeting Library`;
  renderPaperDetail(paper, allPapers);
  initShareMenu();
}

init();

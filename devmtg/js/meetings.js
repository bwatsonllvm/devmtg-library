/**
 * meetings.js — Meetings grid page for LLVM Developers' Meeting Library
 */

const HubUtils = window.LLVMHubUtils || {};

// ============================================================
// Data Loading
// ============================================================

async function loadData() {
  if (typeof window.loadEventData !== 'function') {
    return { talks: [], meetings: [] };
  }
  try {
    return await window.loadEventData();
  } catch {
    return { talks: [], meetings: [] };
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

function formatMeetingDate(value) {
  if (typeof HubUtils.formatMeetingDateUniversal === 'function') {
    return HubUtils.formatMeetingDateUniversal(value);
  }
  return String(value || '').trim();
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

function renderMeetingCard(meeting, talkCount, slideCount) {
  const href = `index.html?meeting=${encodeURIComponent(meeting.slug)}`;
  const hasNoContent = talkCount === 0 && slideCount === 0;
  const isDisabled = meeting.canceled || hasNoContent;
  const classes = ['meeting-card'];
  if (meeting.canceled) classes.push('canceled');
  if (isDisabled) classes.push('meeting-card--disabled');
  const className = classes.join(' ');
  const labelSuffix = meeting.canceled
    ? ' (canceled)'
    : (hasNoContent ? ' (no talks or slides published)' : '');
  const meetingDate = formatMeetingDate(meeting.date) || 'Date TBD';

  const footerHtml = `
      <div class="meeting-card-footer">
        ${talkCount > 0
          ? `<span class="talk-count-badge" aria-label="${talkCount.toLocaleString()} talk${talkCount !== 1 ? 's' : ''}">
               <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
               <span aria-hidden="true">${talkCount.toLocaleString()} talk${talkCount !== 1 ? 's' : ''}</span>
             </span>`
          : `<span class="talk-count-badge talk-count-badge--empty" aria-label="${hasNoContent ? 'No talks or slides published' : 'No talks scheduled yet'}">${hasNoContent ? 'No talks/slides' : 'No talks yet'}</span>`}
        ${isDisabled
          ? `<span class="view-talks-link meeting-card-disabled-label" aria-hidden="true">Unavailable</span>`
          : `<span class="view-talks-link">
               Browse talks
               <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
             </span>`}
      </div>`;

  const cardInnerHtml = `
      <div class="meeting-card-header">
        <div class="meeting-card-title">${escapeHtml(meeting.name)}</div>
        ${meeting.canceled ? '<span class="canceled-badge">Canceled</span>' : ''}
      </div>

      <div class="meeting-card-date">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        ${escapeHtml(meetingDate)}
      </div>

      <div class="meeting-card-location">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        ${escapeHtml(meeting.location || 'Location TBD')}
      </div>

      ${footerHtml}`;

  if (isDisabled) {
    return `
    <div class="${className}" role="group" aria-disabled="true" aria-label="${escapeHtml(meeting.name)}${labelSuffix}">
      ${cardInnerHtml}
    </div>`;
  }

  return `
    <a href="${escapeHtml(href)}" class="${className}" aria-label="${escapeHtml(meeting.name)}${labelSuffix}">
      ${cardInnerHtml}
    </a>`;
}

function renderMeetingsGrid(meetings, talkCounts, slideCounts) {
  const root = document.getElementById('meetings-root');

  // Group by year (descending)
  const byYear = {};
  for (const m of meetings) {
    const year = m.slug?.slice(0, 4) || 'Unknown';
    if (!byYear[year]) byYear[year] = [];
    byYear[year].push(m);
  }

  const years = Object.keys(byYear).sort((a, b) => b.localeCompare(a));

  if (years.length === 0) {
    root.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon" aria-hidden="true">📅</div>
        <h2>No meetings found</h2>
        <p>Ensure <code>events/index.json</code> and <code>events/*.json</code> are present.</p>
      </div>`;
    return;
  }

  root.innerHTML = years.map(year => {
    const yearMeetings = byYear[year];
    const cardsHtml = yearMeetings.map(m => renderMeetingCard(
      m,
      talkCounts[m.slug] || 0,
      slideCounts[m.slug] || 0,
    )).join('');
    return `
      <div class="meetings-year-group">
        <h2 class="year-heading">${escapeHtml(year)}</h2>
        <div class="meetings-grid">
          ${cardsHtml}
        </div>
      </div>`;
  }).join('');
}

function updateSubtitle(meetings, totalTalks) {
  const el = document.getElementById('meetings-subtitle');
  if (!el) return;
  const count = meetings.length;
  el.textContent = `${count} meeting${count !== 1 ? 's' : ''} · ${totalTalks.toLocaleString()} talks total`;
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

  // Always start closed, even when restoring from BFCache/session history.
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
// Init
// ============================================================

async function init() {
  initTheme();
  initTextSize();
  initCustomizationMenu();
  initMobileNavMenu();
  initShareMenu();

  const { talks, meetings } = await loadData();

  // Compute talk counts per meeting
  const talkCounts = {};
  const slideCounts = {};
  for (const t of talks) {
    if (t.meeting) talkCounts[t.meeting] = (talkCounts[t.meeting] || 0) + 1;
    if (t.meeting && t.slidesUrl && String(t.slidesUrl).trim()) {
      slideCounts[t.meeting] = (slideCounts[t.meeting] || 0) + 1;
    }
  }

  // Enrich meetings with computed talk counts
  const enriched = meetings.map(m => ({
    ...m,
    talkCount: talkCounts[m.slug] || 0,
  }));

  // Sort: newest first, then by slug
  enriched.sort((a, b) => b.slug.localeCompare(a.slug));

  updateSubtitle(enriched, talks.length);
  renderMeetingsGrid(enriched, talkCounts, slideCounts);
}

init();

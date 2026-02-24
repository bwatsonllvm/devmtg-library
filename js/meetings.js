/**
 * meetings.js — Meetings grid page for LLVM Research Library
 */

const HubUtils = window.LLVMHubUtils || {};
const PageShell = typeof HubUtils.createPageShell === 'function'
  ? HubUtils.createPageShell()
  : null;

const initTheme = PageShell ? () => PageShell.initTheme() : () => {};
const initTextSize = PageShell ? () => PageShell.initTextSize() : () => {};
const initCustomizationMenu = PageShell ? () => PageShell.initCustomizationMenu() : () => {};
const initMobileNavMenu = PageShell ? () => PageShell.initMobileNavMenu() : () => {};
const initShareMenu = PageShell ? () => PageShell.initShareMenu() : () => {};

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


// ============================================================
// Rendering
// ============================================================

function renderMeetingCard(meeting, talkCount, slideCount) {
  const href = `talks/?meeting=${encodeURIComponent(meeting.slug)}`;
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
        <p>Ensure <code>devmtg/events/index.json</code> and <code>devmtg/events/*.json</code> are present.</p>
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

function updateSubtitle(meetings) {
  const el = document.getElementById('meetings-subtitle');
  if (!el) return;
  const activeMeetings = meetings.filter((meeting) => !meeting?.canceled);
  const totalEvents = activeMeetings.length;
  const llvmDevelopersMeetingCount = activeMeetings.filter((meeting) => (
    /developers['’]? meeting/i.test(String(meeting?.name || ''))
  )).length;
  const otherEventsCount = Math.max(0, totalEvents - llvmDevelopersMeetingCount);
  el.textContent = `${llvmDevelopersMeetingCount.toLocaleString()} LLVM Developers' Meetings · ${otherEventsCount.toLocaleString()} other Events`;
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

  updateSubtitle(enriched);
  renderMeetingsGrid(enriched, talkCounts, slideCounts);
}

init();

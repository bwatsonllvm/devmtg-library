/**
 * about.js — Static about page enhancements.
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

function initAboutHeroSearch() {
  const input = document.getElementById('about-search-input');
  const clearBtn = document.getElementById('about-search-clear');
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

function setText(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value;
}

function formatCount(value) {
  return Number(value || 0).toLocaleString();
}

function normalizeTalks(rawTalks) {
  if (typeof HubUtils.normalizeTalks === 'function') {
    return HubUtils.normalizeTalks(rawTalks);
  }
  return Array.isArray(rawTalks) ? rawTalks : [];
}

function normalizePapers(rawPapers) {
  return Array.isArray(rawPapers)
    ? rawPapers.filter((paper) => paper && typeof paper === 'object')
    : [];
}

const BLOG_SOURCE_SLUGS = new Set(['llvm-blog-www', 'llvm-www-blog']);

function isBlogPaperRecord(paper) {
  if (!paper || typeof paper !== 'object') return false;
  if (paper._isBlog === true) return true;

  const source = String(paper.source || '').trim().toLowerCase();
  const type = String(paper.type || '').trim().toLowerCase();
  const sourceUrl = String(paper.sourceUrl || '').trim();
  const paperUrl = String(paper.paperUrl || '').trim();

  if (BLOG_SOURCE_SLUGS.has(source)) return true;
  if (type === 'blog' || type === 'blog-post') return true;
  if (/^https?:\/\/(?:www\.)?blog\.llvm\.org\//i.test(sourceUrl)) return true;
  if (/github\.com\/llvm\/(?:llvm-blog-www|llvm-www-blog)\b/i.test(paperUrl)) return true;
  return false;
}

function isValidPaperRecord(paper) {
  if (!paper || typeof paper !== 'object') return false;
  const id = String(paper.id || '').trim();
  const title = String(paper.title || '').trim();
  return !!(id && title);
}

function countPaperRecordsForPapersPage(papers) {
  return papers.filter((paper) => isValidPaperRecord(paper) && !isBlogPaperRecord(paper)).length;
}

function isCanceledMeeting(meeting) {
  if (!meeting || typeof meeting !== 'object') return false;
  if (meeting.canceled === true) return true;
  const location = String(meeting.location || '').toLowerCase();
  return location.includes('canceled') || location.includes('cancelled');
}

function isDevelopersMeeting(meeting) {
  if (!meeting || typeof meeting !== 'object') return false;
  if (isCanceledMeeting(meeting)) return false;
  const name = String(meeting.name || '').toLowerCase();
  return name.includes("llvm developers' meeting");
}

async function loadAndRenderStats() {
  let meetings = [];
  let talks = [];
  let papers = [];

  try {
    if (typeof window.loadEventData === 'function') {
      const events = await window.loadEventData();
      talks = normalizeTalks(events && events.talks);
      meetings = Array.isArray(events && events.meetings) ? events.meetings : [];
    }
    if (typeof window.loadPaperData === 'function') {
      const paperPayload = await window.loadPaperData();
      papers = normalizePapers(paperPayload && paperPayload.papers);
    }
  } catch {
    // Keep defaults if any data source fails.
  }

  const uniqueMeetings = new Set(
    meetings
      .filter((meeting) => isDevelopersMeeting(meeting))
      .map((meeting) => String(meeting.slug || meeting.name || '').trim())
      .filter(Boolean)
  );

  let peopleCount = 0;
  if (typeof HubUtils.buildPeopleIndex === 'function') {
    try {
      peopleCount = HubUtils.buildPeopleIndex(talks, papers).length;
    } catch {
      peopleCount = 0;
    }
  }

  setText('about-stat-talks', formatCount(talks.length));
  setText('about-stat-papers', formatCount(countPaperRecordsForPapersPage(papers)));
  setText('about-stat-people', formatCount(peopleCount));
  setText('about-stat-meetings', formatCount(uniqueMeetings.size));
}

async function init() {
  initTheme();
  initTextSize();
  initCustomizationMenu();
  initMobileNavMenu();
  initShareMenu();
  initAboutHeroSearch();
  await loadAndRenderStats();
}

init();

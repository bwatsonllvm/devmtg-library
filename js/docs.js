/**
 * docs.js — Documentation page interactions and shared header controls.
 */

const HubUtils = window.LLVMHubUtils || {};
const BLOG_SOURCE_SLUGS = new Set(['llvm-blog-www', 'llvm-www-blog']);
const PageShell = typeof HubUtils.createPageShell === 'function'
  ? HubUtils.createPageShell()
  : null;

const initTheme = PageShell ? () => PageShell.initTheme() : () => {};
const initTextSize = PageShell ? () => PageShell.initTextSize() : () => {};
const initCustomizationMenu = PageShell ? () => PageShell.initCustomizationMenu() : () => {};
const initMobileNavMenu = PageShell ? () => PageShell.initMobileNavMenu() : () => {};
const initShareMenu = PageShell ? () => PageShell.initShareMenu() : () => {};

function initDocsHeroSearch() {
  const input = document.getElementById('docs-search-input');
  const clearBtn = document.getElementById('docs-search-clear');
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

  setText('docs-stat-talks', formatCount(talks.length));
  setText('docs-stat-papers', formatCount(countPaperRecordsForPapersPage(papers)));
  setText('docs-stat-people', formatCount(peopleCount));
  setText('docs-stat-meetings', formatCount(uniqueMeetings.size));
}

function initDocsTocControls() {
  const toc = document.getElementById('docs-toc');
  const filterInput = document.getElementById('docs-toc-filter');
  const expandAllBtn = document.getElementById('docs-expand-all');
  const collapseAllBtn = document.getElementById('docs-collapse-all');
  if (!toc) return;

  const chapters = Array.from(toc.querySelectorAll('.docs-toc-chapter'));
  const links = Array.from(toc.querySelectorAll('.docs-toc-link'));

  const normalize = (value) => String(value || '').trim().toLowerCase();

  const expandAll = () => {
    chapters.forEach((chapter) => {
      chapter.open = true;
    });
  };

  const collapseAll = () => {
    chapters.forEach((chapter) => {
      chapter.open = false;
    });
  };

  if (expandAllBtn) {
    expandAllBtn.addEventListener('click', () => {
      expandAll();
      if (filterInput) filterInput.focus();
    });
  }

  if (collapseAllBtn) {
    collapseAllBtn.addEventListener('click', () => {
      collapseAll();
      if (filterInput) filterInput.focus();
    });
  }

  if (filterInput) {
    const applyFilter = () => {
      const query = normalize(filterInput.value);

      chapters.forEach((chapter) => {
        const summary = chapter.querySelector('summary');
        const summaryText = normalize(summary ? summary.textContent : '');
        const items = Array.from(chapter.querySelectorAll('li'));
        const chapterMatches = [];

        items.forEach((item) => {
          const link = item.querySelector('.docs-toc-link');
          const label = normalize(link ? link.textContent : '');
          const match = !query || summaryText.includes(query) || label.includes(query);
          item.classList.toggle('hidden', !match);
          if (link) link.classList.toggle('hidden', !match);
          if (match) chapterMatches.push(item);
        });

        const hasMatch = chapterMatches.length > 0;
        chapter.classList.toggle('hidden', !hasMatch);
        if (query && hasMatch) {
          chapter.open = true;
        }
      });
    };

    filterInput.addEventListener('input', applyFilter);
    applyFilter();
  }

  const sectionIds = links
    .map((link) => (link.getAttribute('href') || '').trim())
    .filter((href) => href.startsWith('#'))
    .map((href) => href.slice(1));

  const sections = sectionIds
    .map((id) => document.getElementById(id))
    .filter((section) => section && section.classList.contains('doc-section'));

  const linkById = new Map();
  links.forEach((link) => {
    const href = (link.getAttribute('href') || '').trim();
    if (!href.startsWith('#')) return;
    const id = href.slice(1);
    linkById.set(id, link);

    link.addEventListener('click', () => {
      setActiveLink(id);
      const chapter = link.closest('.docs-toc-chapter');
      if (chapter) chapter.open = true;
    });
  });

  function setActiveLink(id) {
    links.forEach((link) => {
      const href = (link.getAttribute('href') || '').trim();
      const active = href === `#${id}`;
      link.classList.toggle('active', active);
      if (active) {
        const chapter = link.closest('.docs-toc-chapter');
        if (chapter) chapter.open = true;
      }
    });
  }

  let activeId = '';

  const updateByViewport = () => {
    if (!sections.length) return;
    let best = null;
    let bestTop = Number.POSITIVE_INFINITY;

    sections.forEach((section) => {
      const rect = section.getBoundingClientRect();
      const thresholdTop = Math.max(90, window.innerHeight * 0.2);
      if (rect.top <= thresholdTop && Math.abs(rect.top - thresholdTop) < bestTop) {
        bestTop = Math.abs(rect.top - thresholdTop);
        best = section;
      }
    });

    if (!best) {
      best = sections.find((section) => section.getBoundingClientRect().top > 0) || sections[sections.length - 1];
    }

    if (!best) return;
    if (activeId !== best.id) {
      activeId = best.id;
      setActiveLink(activeId);
    }
  };

  if ('IntersectionObserver' in window && sections.length) {
    const observer = new IntersectionObserver((entries) => {
      let bestEntry = null;
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        if (!bestEntry || entry.boundingClientRect.top < bestEntry.boundingClientRect.top) {
          bestEntry = entry;
        }
      });

      if (bestEntry && bestEntry.target && bestEntry.target.id) {
        const nextId = bestEntry.target.id;
        if (activeId !== nextId) {
          activeId = nextId;
          setActiveLink(activeId);
        }
      }
    }, {
      rootMargin: '-15% 0px -70% 0px',
      threshold: [0, 0.25, 0.6, 1],
    });

    sections.forEach((section) => observer.observe(section));
  }

  window.addEventListener('scroll', updateByViewport, { passive: true });
  window.addEventListener('resize', updateByViewport, { passive: true });
  window.addEventListener('hashchange', () => {
    const id = String(window.location.hash || '').replace(/^#/, '');
    if (!id) return;
    setActiveLink(id);
  });

  const initialHash = String(window.location.hash || '').replace(/^#/, '');
  if (initialHash && linkById.has(initialHash)) {
    activeId = initialHash;
    setActiveLink(initialHash);
  } else {
    updateByViewport();
  }
}

async function init() {
  initTheme();
  initTextSize();
  initCustomizationMenu();
  initMobileNavMenu();
  initShareMenu();
  initDocsHeroSearch();
  initDocsTocControls();
  await loadAndRenderStats();
}

init();

/**
 * people.js — Unified speaker/author directory.
 */

const HubUtils = window.LLVMHubUtils || {};
const PEOPLE_SORT_MODES = new Set(['works', 'citations', 'alpha', 'alpha-desc']);

const state = {
  query: '',
  filter: 'all', // all | talks | papers | merged
  sortBy: 'works',
};

let allPeople = [];

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeTalks(rawTalks) {
  if (typeof HubUtils.normalizeTalks === 'function') return HubUtils.normalizeTalks(rawTalks);
  return Array.isArray(rawTalks) ? rawTalks : [];
}

function normalizePapers(rawPapers) {
  if (!Array.isArray(rawPapers)) return [];
  return rawPapers.map((rawPaper) => {
    const paper = { ...rawPaper };
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
            if (!name) return null;
            return { name, affiliation: String(author.affiliation || '').trim() };
          })
          .filter(Boolean)
      : [];
    return paper;
  });
}

function tokenizeQuery(query) {
  return String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function highlightText(text, tokens) {
  let html = escapeHtml(text);
  for (const token of (tokens || [])) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
  }
  return html;
}

function getPersonSearchBlob(person) {
  return [
    person.name,
    ...(person.variantNames || []),
  ].join(' ').toLowerCase();
}

function filterPeople() {
  const tokens = tokenizeQuery(state.query);

  return allPeople.filter((person) => {
    if (state.filter === 'talks' && person.talkCount === 0) return false;
    if (state.filter === 'papers' && person.paperCount === 0) return false;
    if (state.filter === 'merged' && (person.variantNames || []).length < 2) return false;

    if (!tokens.length) return true;
    const blob = getPersonSearchBlob(person);
    return tokens.every((token) => blob.includes(token));
  });
}

function sortPeople(people) {
  const entries = [...(people || [])];

  if (state.sortBy === 'citations') {
    entries.sort((a, b) =>
      (b.citationCount || 0) - (a.citationCount || 0) ||
      b.totalCount - a.totalCount ||
      a.name.localeCompare(b.name));
    return entries;
  }

  if (state.sortBy === 'alpha') {
    entries.sort((a, b) => a.name.localeCompare(b.name));
    return entries;
  }

  if (state.sortBy === 'alpha-desc') {
    entries.sort((a, b) => b.name.localeCompare(a.name));
    return entries;
  }

  entries.sort((a, b) =>
    b.totalCount - a.totalCount ||
    (b.citationCount || 0) - (a.citationCount || 0) ||
    a.name.localeCompare(b.name));
  return entries;
}

function renderPersonCard(person, tokens) {
  const nameHtml = highlightText(person.name, tokens);
  const citationHtml = Number(person.citationCount || 0) > 0
    ? `<span class="meeting-label">${Number(person.citationCount || 0).toLocaleString()} citations</span>`
    : '';

  const normalizeNameKey = (name) => {
    if (typeof HubUtils.normalizePersonKey === 'function') return HubUtils.normalizePersonKey(name);
    return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  };
  const personNameKey = normalizeNameKey(person.name);
  const seenVariantKeys = new Set();
  const variantNames = (person.variantNames || []).filter((name) => {
    const key = normalizeNameKey(name);
    if (!key || key === personNameKey || seenVariantKeys.has(key)) return false;
    seenVariantKeys.add(key);
    return true;
  });
  const variantsHtml = variantNames.length
    ? `<div class="person-variants" aria-label="Name variants">
        <span class="person-variants-label">Also appears as</span>
        ${variantNames.slice(0, 4).map((name) => `<span class="person-variant-pill">${escapeHtml(name)}</span>`).join('')}
      </div>`
    : '';

  const talksLink = person.talkCount > 0
    ? `<a class="card-link-btn" href="index.html?speaker=${encodeURIComponent(person.talkFilterName || person.name)}" aria-label="View talks by ${escapeHtml(person.name)}">
        <span aria-hidden="true">Talks ${person.talkCount.toLocaleString()}</span>
      </a>`
    : `<span class="card-link-btn card-link-btn--disabled" aria-hidden="true">Talks 0</span>`;

  const papersLink = person.paperCount > 0
    ? `<a class="card-link-btn" href="papers.html?speaker=${encodeURIComponent(person.paperFilterName || person.name)}" aria-label="View papers by ${escapeHtml(person.name)}">
        <span aria-hidden="true">Papers ${person.paperCount.toLocaleString()}</span>
      </a>`
    : `<span class="card-link-btn card-link-btn--disabled" aria-hidden="true">Papers 0</span>`;

  const allWorkLink = `<a class="card-link-btn card-link-btn--video" href="work.html?mode=search&q=${encodeURIComponent(person.name)}" aria-label="Search all work for ${escapeHtml(person.name)}">
      <span aria-hidden="true">All Work</span>
    </a>`;

  return `
    <article class="talk-card person-card">
      <a href="work.html?mode=search&q=${encodeURIComponent(person.name)}" class="card-link-wrap" aria-label="Open all work for ${escapeHtml(person.name)}">
        <div class="card-body">
          <div class="card-meta">
            <span class="meeting-label">${person.totalCount.toLocaleString()} works</span>
            ${citationHtml}
          </div>
          <p class="card-title">${nameHtml}</p>
          ${variantsHtml}
        </div>
      </a>
      <div class="card-footer person-card-footer">
        ${talksLink}
        ${papersLink}
        ${allWorkLink}
      </div>
    </article>`;
}

function render() {
  const people = sortPeople(filterPeople());
  const grid = document.getElementById('people-grid');
  const count = document.getElementById('people-results-count');
  const subtitle = document.getElementById('people-subtitle');
  if (!grid || !count || !subtitle) return;

  const tokens = tokenizeQuery(state.query);
  count.innerHTML = `<strong>${people.length.toLocaleString()}</strong> people`;

  if (state.query) {
    subtitle.innerHTML = `Results for <strong>${escapeHtml(state.query)}</strong>`;
  } else {
    subtitle.innerHTML = `Browse <strong>${allPeople.length.toLocaleString()}</strong> unified speaker/author profiles`;
  }

  if (!people.length) {
    grid.setAttribute('aria-busy', 'false');
    grid.innerHTML = `
      <div class="empty-state" role="status">
        <div class="empty-state-icon" aria-hidden="true">🔎</div>
        <h2>No people found</h2>
        <p>No speakers/authors match the current search or filter.</p>
      </div>`;
    return;
  }

  grid.setAttribute('aria-busy', 'false');
  grid.innerHTML = people.map((person) => renderPersonCard(person, tokens)).join('');
}

function syncSortControl() {
  const select = document.getElementById('people-sort-select');
  if (!select) return;
  select.value = PEOPLE_SORT_MODES.has(state.sortBy) ? state.sortBy : 'works';
}

function initSortControl() {
  const select = document.getElementById('people-sort-select');
  if (!select) return;

  select.addEventListener('change', () => {
    const next = String(select.value || '').trim();
    state.sortBy = PEOPLE_SORT_MODES.has(next) ? next : 'works';
    syncSortControl();
    render();
  });

  syncSortControl();
}

function syncFilterChips() {
  document.querySelectorAll('[data-people-filter]').forEach((chip) => {
    const active = chip.dataset.peopleFilter === state.filter;
    chip.classList.toggle('active', active);
    chip.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function initFilterChips() {
  document.querySelectorAll('[data-people-filter]').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.filter = chip.dataset.peopleFilter || 'all';
      syncFilterChips();
      render();
    });
  });
  syncFilterChips();
}

function initSearch() {
  const input = document.getElementById('people-search');
  const clearBtn = document.getElementById('people-search-clear');
  if (!input || !clearBtn) return;

  input.addEventListener('input', () => {
    state.query = input.value.trim();
    clearBtn.classList.toggle('visible', state.query.length > 0);
    render();
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      state.query = input.value.trim();
      clearBtn.classList.toggle('visible', state.query.length > 0);
      render();
      input.blur();
    } else if (event.key === 'Escape') {
      input.blur();
    }
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    state.query = '';
    clearBtn.classList.remove('visible');
    render();
    input.focus();
  });
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

async function init() {
  initMobileNavMenu();
  initSearch();
  initFilterChips();
  initSortControl();

  let talks = [];
  let papers = [];

  try {
    if (typeof window.loadEventData === 'function') {
      const payload = await window.loadEventData();
      talks = normalizeTalks(payload.talks || []);
    }
    if (typeof window.loadPaperData === 'function') {
      const payload = await window.loadPaperData();
      papers = normalizePapers(payload.papers || []);
    }
  } catch {
    // Keep arrays empty and let rendering show fallback state.
  }

  if (typeof HubUtils.buildPeopleIndex === 'function') {
    allPeople = HubUtils.buildPeopleIndex(talks, papers);
  } else {
    allPeople = [];
  }

  render();
}

init();

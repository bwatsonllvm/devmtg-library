/**
 * people.js — Unified speaker/author directory.
 */

const HubUtils = window.LLVMHubUtils || {};
const PEOPLE_SORT_MODES = new Set(['works', 'citations', 'alpha', 'alpha-desc']);
const INITIAL_RENDER_BATCH_SIZE = 60;
const RENDER_BATCH_SIZE = 40;
const LOAD_MORE_ROOT_MARGIN = '900px 0px';

const state = {
  query: '',
  filter: 'all', // all | talks | papers | merged
  sortBy: 'works',
};

let allPeople = [];
let allTalks = [];
let allPapers = [];
let autocompleteIndex = {
  topics: [],
  people: [],
  talks: [],
  papers: [],
};
let dropdownActiveIdx = -1;
let activeRenderResults = [];
let activeRenderTokens = [];
let renderedCount = 0;
let loadMoreObserver = null;
let loadMoreScrollHandler = null;

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

function getTalkKeyTopics(talk, limit = Infinity) {
  if (typeof HubUtils.getTalkKeyTopics === 'function') {
    return HubUtils.getTalkKeyTopics(talk, limit);
  }
  const tags = Array.isArray(talk && talk.tags) ? talk.tags : [];
  return Number.isFinite(limit) ? tags.slice(0, limit) : tags;
}

function getPaperKeyTopics(paper, limit = Infinity) {
  if (typeof HubUtils.getPaperKeyTopics === 'function') {
    return HubUtils.getPaperKeyTopics(paper, limit);
  }
  const tags = Array.isArray(paper && paper.tags) ? paper.tags : [];
  const keywords = Array.isArray(paper && paper.keywords) ? paper.keywords : [];
  const out = [];
  const seen = new Set();
  for (const value of [...tags, ...keywords]) {
    const label = String(value || '').trim();
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (Number.isFinite(limit) && out.length >= limit) break;
  }
  return out;
}

function tokenizeQuery(query) {
  return String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function normalizeFilterValue(value) {
  return String(value || '').trim().toLowerCase();
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

function getTalkSearchBlob(talk) {
  return [
    String(talk.title || ''),
    (talk.speakers || []).map((speaker) => String((speaker && speaker.name) || '')).join(' '),
    String(talk.abstract || ''),
    getTalkKeyTopics(talk, 12).join(' '),
    String(talk.meetingName || ''),
    String(talk.meetingLocation || ''),
    String(talk.meetingDate || ''),
    String(talk.meeting || ''),
  ].join(' ').toLowerCase();
}

function getPaperSearchBlob(paper) {
  return [
    String(paper.title || ''),
    (paper.authors || []).map((author) => String((author && author.name) || '')).join(' '),
    String(paper.abstract || ''),
    getPaperKeyTopics(paper, 12).join(' '),
    String(paper.publication || ''),
    String(paper.venue || ''),
    String(paper.year || ''),
    String(paper.type || ''),
  ].join(' ').toLowerCase();
}

function addCountToMap(map, label) {
  const value = String(label || '').trim();
  if (!value) return;
  map.set(value, (map.get(value) || 0) + 1);
}

function mapToAlphaEntries(map) {
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function mapToSortedEntries(map) {
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function buildAutocompleteIndex() {
  const topicCounts = new Map();
  const personCounts = new Map();
  const talkTitleCounts = new Map();
  const paperTitleCounts = new Map();

  const addPerson = (name, count = 1) => {
    const label = String(name || '').trim();
    if (!label) return;
    const key = typeof HubUtils.normalizePersonKey === 'function'
      ? HubUtils.normalizePersonKey(label)
      : normalizeFilterValue(label);
    if (!key) return;
    if (!personCounts.has(key)) {
      personCounts.set(key, { count: 0, labels: new Map() });
    }
    const bucket = personCounts.get(key);
    bucket.count += count;
    bucket.labels.set(label, (bucket.labels.get(label) || 0) + count);
  };

  for (const talk of allTalks) {
    for (const topic of getTalkKeyTopics(talk, 12)) addCountToMap(topicCounts, topic);
    addCountToMap(talkTitleCounts, talk.title);
    for (const speaker of (talk.speakers || [])) addPerson(speaker && speaker.name, 1);
  }

  for (const paper of allPapers) {
    for (const topic of getPaperKeyTopics(paper, 12)) addCountToMap(topicCounts, topic);
    addCountToMap(paperTitleCounts, paper.title);
    for (const author of (paper.authors || [])) addPerson(author && author.name, 1);
  }

  for (const person of allPeople) {
    addPerson(person.name, person.totalCount || 1);
    for (const variant of (person.variantNames || [])) addPerson(variant, 0);
  }

  autocompleteIndex.topics = mapToSortedEntries(topicCounts);
  autocompleteIndex.people = [...personCounts.values()]
    .map((entry) => {
      const label = [...entry.labels.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || '';
      const searchText = [...entry.labels.keys()].join(' ').toLowerCase();
      return { label, count: entry.count, searchText };
    })
    .filter((entry) => entry.label)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  autocompleteIndex.talks = mapToAlphaEntries(talkTitleCounts);
  autocompleteIndex.papers = mapToAlphaEntries(paperTitleCounts);
}

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escapeHtml(text).replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
}

function renderDropdown(query) {
  const dropdown = document.getElementById('search-dropdown');
  if (!dropdown) return;

  if (!query || query.length < 1) {
    dropdown.classList.add('hidden');
    dropdownActiveIdx = -1;
    return;
  }

  const q = query.toLowerCase();
  const matchedTopics = autocompleteIndex.topics.filter((item) => item.label.toLowerCase().includes(q)).slice(0, 6);
  const matchedPeople = autocompleteIndex.people
    .filter((item) => item.label.toLowerCase().includes(q) || String(item.searchText || '').includes(q))
    .slice(0, 6);
  const matchedTalkTitles = autocompleteIndex.talks.filter((item) => item.label.toLowerCase().includes(q)).slice(0, 4);
  const matchedPaperTitles = autocompleteIndex.papers.filter((item) => item.label.toLowerCase().includes(q)).slice(0, 4);

  if (!matchedTopics.length && !matchedPeople.length && !matchedTalkTitles.length && !matchedPaperTitles.length) {
    dropdown.classList.add('hidden');
    dropdownActiveIdx = -1;
    return;
  }

  const tagIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`;
  const personIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
  const talkIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  const paperIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;

  const sections = [];

  if (matchedTopics.length) {
    sections.push(`
      <div class="search-dropdown-section">
        <div class="search-dropdown-label" aria-hidden="true">Key Topics</div>
        ${matchedTopics.map((item) => `
          <button class="search-dropdown-item" role="option" aria-selected="false"
                  data-autocomplete-type="topic" data-autocomplete-value="${escapeHtml(item.label)}">
            <span class="search-dropdown-item-icon">${tagIcon}</span>
            <span class="search-dropdown-item-label">${highlightMatch(item.label, query)}</span>
            <span class="search-dropdown-item-count">${item.count.toLocaleString()}</span>
          </button>`).join('')}
      </div>`);
  }

  if (matchedPeople.length) {
    sections.push(`
      <div class="search-dropdown-section">
        <div class="search-dropdown-label" aria-hidden="true">Speakers + Authors</div>
        ${matchedPeople.map((item) => `
          <button class="search-dropdown-item" role="option" aria-selected="false"
                  data-autocomplete-type="person" data-autocomplete-value="${escapeHtml(item.label)}">
            <span class="search-dropdown-item-icon">${personIcon}</span>
            <span class="search-dropdown-item-label">${highlightMatch(item.label, query)}</span>
            <span class="search-dropdown-item-count">${item.count.toLocaleString()} work${item.count === 1 ? '' : 's'}</span>
          </button>`).join('')}
      </div>`);
  }

  if (matchedTalkTitles.length) {
    sections.push(`
      <div class="search-dropdown-section">
        <div class="search-dropdown-label" aria-hidden="true">Talk Titles</div>
        ${matchedTalkTitles.map((item) => `
          <button class="search-dropdown-item" role="option" aria-selected="false"
                  data-autocomplete-type="talk" data-autocomplete-value="${escapeHtml(item.label)}">
            <span class="search-dropdown-item-icon">${talkIcon}</span>
            <span class="search-dropdown-item-label">${highlightMatch(item.label, query)}</span>
            <span class="search-dropdown-item-count">Talk</span>
          </button>`).join('')}
      </div>`);
  }

  if (matchedPaperTitles.length) {
    sections.push(`
      <div class="search-dropdown-section">
        <div class="search-dropdown-label" aria-hidden="true">Paper Titles</div>
        ${matchedPaperTitles.map((item) => `
          <button class="search-dropdown-item" role="option" aria-selected="false"
                  data-autocomplete-type="paper" data-autocomplete-value="${escapeHtml(item.label)}">
            <span class="search-dropdown-item-icon">${paperIcon}</span>
            <span class="search-dropdown-item-label">${highlightMatch(item.label, query)}</span>
            <span class="search-dropdown-item-count">Paper</span>
          </button>`).join('')}
      </div>`);
  }

  dropdown.innerHTML = sections.join('<div class="search-dropdown-divider"></div>');
  dropdown.classList.remove('hidden');
  dropdownActiveIdx = -1;

  dropdown.querySelectorAll('.search-dropdown-item').forEach((item) => {
    item.addEventListener('mousedown', (event) => {
      event.preventDefault();
      selectAutocompleteItem(item);
    });
  });
}

function closeDropdown() {
  const dropdown = document.getElementById('search-dropdown');
  if (!dropdown) return;
  dropdown.classList.add('hidden');
  dropdownActiveIdx = -1;
}

function navigateDropdown(direction) {
  const dropdown = document.getElementById('search-dropdown');
  if (!dropdown || dropdown.classList.contains('hidden')) return false;

  const items = Array.from(dropdown.querySelectorAll('.search-dropdown-item'));
  if (!items.length) return false;

  if (dropdownActiveIdx >= 0 && dropdownActiveIdx < items.length) {
    items[dropdownActiveIdx].setAttribute('aria-selected', 'false');
  }

  dropdownActiveIdx += direction;
  if (dropdownActiveIdx < 0) dropdownActiveIdx = items.length - 1;
  if (dropdownActiveIdx >= items.length) dropdownActiveIdx = 0;

  items[dropdownActiveIdx].setAttribute('aria-selected', 'true');
  items[dropdownActiveIdx].scrollIntoView({ block: 'nearest' });
  return true;
}

function findExactAutocompleteEntry(entries, value) {
  const normalized = normalizeFilterValue(value);
  if (!normalized) return null;
  return entries.find((entry) => normalizeFilterValue(entry.label) === normalized) || null;
}

function findPersonEntry(value) {
  return findExactAutocompleteEntry(autocompleteIndex.people, value);
}

function findTalkTitleEntry(value) {
  return findExactAutocompleteEntry(autocompleteIndex.talks, value);
}

function findPaperTitleEntry(value) {
  return findExactAutocompleteEntry(autocompleteIndex.papers, value);
}

function hasPeopleMatchesForQuery(query) {
  const tokens = tokenizeQuery(query);
  if (!tokens.length) return false;
  return allPeople.some((person) => {
    const blob = getPersonSearchBlob(person);
    return tokens.every((token) => blob.includes(token));
  });
}

function countTalkMatchesForQuery(query) {
  const tokens = tokenizeQuery(query);
  if (!tokens.length) return 0;
  let count = 0;
  for (const talk of allTalks) {
    const blob = getTalkSearchBlob(talk);
    if (tokens.every((token) => blob.includes(token))) count += 1;
  }
  return count;
}

function countPaperMatchesForQuery(query) {
  const tokens = tokenizeQuery(query);
  if (!tokens.length) return 0;
  let count = 0;
  for (const paper of allPapers) {
    const blob = getPaperSearchBlob(paper);
    if (tokens.every((token) => blob.includes(token))) count += 1;
  }
  return count;
}

function buildGlobalSearchUrl(query) {
  const params = new URLSearchParams();
  params.set('mode', 'search');
  params.set('q', String(query || '').trim());
  return `work.html?${params.toString()}`;
}

function routeToGlobalSearch(query) {
  const value = String(query || '').trim();
  if (!value) return false;
  window.location.href = buildGlobalSearchUrl(value);
  return true;
}

function shouldRouteToGlobalSearch(query) {
  const value = String(query || '').trim();
  if (!value) return false;

  const personMatch = findPersonEntry(value);
  if (personMatch) return false;

  if (findTalkTitleEntry(value) || findPaperTitleEntry(value)) return true;

  const hasPeople = hasPeopleMatchesForQuery(value);
  if (hasPeople) return false;

  return countTalkMatchesForQuery(value) > 0 || countPaperMatchesForQuery(value) > 0;
}

function applyAutocompleteSelection(type, value) {
  const input = document.getElementById('people-search');
  state.query = String(value || '').trim();
  if (input) input.value = state.query;
  closeDropdown();
  render();
  return 'local';
}

function selectAutocompleteItem(item) {
  const value = item.dataset.autocompleteValue;
  const type = item.dataset.autocompleteType;
  const input = document.getElementById('people-search');
  const mode = applyAutocompleteSelection(type, value);
  if (mode !== 'global' && input) input.focus();
}

function commitSearchValue(rawValue, allowGlobalRouting = true) {
  const committed = String(rawValue || '').trim();
  if (allowGlobalRouting && committed) {
    closeDropdown();
    routeToGlobalSearch(committed);
    return 'global';
  }

  state.query = committed;
  closeDropdown();
  render();
  return 'local';
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
    ? `<a class="card-link-btn" href="talks/?speaker=${encodeURIComponent(person.talkFilterName || person.name)}" aria-label="View talks by ${escapeHtml(person.name)}">
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

  const sentinel = document.getElementById('people-load-sentinel');
  if (sentinel) sentinel.remove();
}

function ensureLoadMoreSentinel(grid) {
  let sentinel = document.getElementById('people-load-sentinel');
  if (!sentinel) {
    sentinel = document.createElement('div');
    sentinel.id = 'people-load-sentinel';
    sentinel.setAttribute('aria-hidden', 'true');
    sentinel.style.width = '100%';
    sentinel.style.height = '1px';
    sentinel.style.gridColumn = '1 / -1';
  }
  grid.appendChild(sentinel);
  return sentinel;
}

function appendNextResultsBatch(forceBatchSize = RENDER_BATCH_SIZE) {
  const grid = document.getElementById('people-grid');
  if (!grid) return;

  if (!activeRenderResults.length || renderedCount >= activeRenderResults.length) {
    teardownInfiniteLoader();
    return;
  }

  const nextCount = Math.min(renderedCount + forceBatchSize, activeRenderResults.length);
  const nextHtml = activeRenderResults
    .slice(renderedCount, nextCount)
    .map((person) => renderPersonCard(person, activeRenderTokens))
    .join('');

  grid.insertAdjacentHTML('beforeend', nextHtml);
  renderedCount = nextCount;

  if (renderedCount >= activeRenderResults.length) {
    teardownInfiniteLoader();
    return;
  }

  ensureLoadMoreSentinel(grid);
}

function setupInfiniteLoader() {
  const grid = document.getElementById('people-grid');
  if (!grid) return;

  teardownInfiniteLoader();
  if (renderedCount >= activeRenderResults.length) return;

  const sentinel = ensureLoadMoreSentinel(grid);

  if ('IntersectionObserver' in window) {
    loadMoreObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          appendNextResultsBatch();
          break;
        }
      }
    }, { root: null, rootMargin: LOAD_MORE_ROOT_MARGIN, threshold: 0 });

    loadMoreObserver.observe(sentinel);
    return;
  }

  loadMoreScrollHandler = () => {
    const activeSentinel = document.getElementById('people-load-sentinel');
    if (!activeSentinel) return;
    const rect = activeSentinel.getBoundingClientRect();
    if (rect.top <= window.innerHeight + 900) {
      appendNextResultsBatch();
    }
  };

  window.addEventListener('scroll', loadMoreScrollHandler, { passive: true });
  window.addEventListener('resize', loadMoreScrollHandler);
  loadMoreScrollHandler();
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
    teardownInfiniteLoader();
    activeRenderResults = [];
    activeRenderTokens = [];
    renderedCount = 0;
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
  activeRenderResults = people;
  activeRenderTokens = tokens;
  renderedCount = 0;
  grid.innerHTML = '';
  appendNextResultsBatch(INITIAL_RENDER_BATCH_SIZE);
  setupInfiniteLoader();
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
  const globalBtn = document.getElementById('search-global');
  if (!input || !clearBtn) return;

  const syncClearButton = () => {
    clearBtn.classList.toggle('visible', state.query.length > 0);
  };

  input.addEventListener('input', () => {
    state.query = input.value.trim();
    syncClearButton();
    renderDropdown(state.query);
    render();
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      navigateDropdown(1);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      navigateDropdown(-1);
      return;
    }

    if (event.key === 'Enter') {
      const dropdown = document.getElementById('search-dropdown');
      if (dropdown && !dropdown.classList.contains('hidden') && dropdownActiveIdx >= 0) {
        event.preventDefault();
        const items = dropdown.querySelectorAll('.search-dropdown-item');
        if (items[dropdownActiveIdx]) selectAutocompleteItem(items[dropdownActiveIdx]);
        return;
      }

      event.preventDefault();
      const mode = commitSearchValue(input.value, false);
      syncClearButton();
      if (mode !== 'global') input.blur();
      return;
    }

    if (event.key === 'Escape') {
      const dropdown = document.getElementById('search-dropdown');
      if (dropdown && !dropdown.classList.contains('hidden')) {
        closeDropdown();
        return;
      }
      input.blur();
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(closeDropdown, 150);
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    state.query = '';
    syncClearButton();
    closeDropdown();
    render();
    input.focus();
  });

  if (globalBtn) {
    globalBtn.addEventListener('click', (event) => {
      event.preventDefault();
      const value = String(input.value || state.query || '').trim();
      if (!value) {
        input.focus();
        return;
      }
      routeToGlobalSearch(value);
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && document.activeElement !== input) {
      event.preventDefault();
      input.focus();
      input.select();
    }
  });

  syncClearButton();
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
  nativeShareBtn.hidden = !supportsNativeShare;

  closeMenu();

  toggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (menu.classList.contains('open')) closeMenu();
    else openMenu();
  });

  if (supportsNativeShare) {
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
    link.addEventListener('click', closeMenu);
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
  initTheme();
  initTextSize();
  initCustomizationMenu();
  initMobileNavMenu();
  initShareMenu();
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

  allTalks = talks;
  allPapers = papers;

  if (typeof HubUtils.buildPeopleIndex === 'function') {
    allPeople = HubUtils.buildPeopleIndex(talks, papers);
  } else {
    allPeople = [];
  }

  buildAutocompleteIndex();
  initSearch();
  render();
}

init();

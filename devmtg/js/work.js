/**
 * work.js — Unified talks + papers view for a selected speaker/topic.
 */

const HubUtils = window.LLVMHubUtils || {};

const TALK_BATCH_SIZE = 24;
const PAPER_BATCH_SIZE = 24;

const state = {
  mode: 'entity', // 'entity' | 'search'
  kind: 'topic', // 'speaker' | 'topic'
  value: '',
  query: '',
  from: 'talks', // 'talks' | 'papers'
};

let filteredTalks = [];
let filteredPapers = [];
let renderedTalkCount = 0;
let renderedPaperCount = 0;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeValue(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeTopicKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function getPaperKeyTopics(paper, limit = Infinity) {
  const out = [];
  const seen = new Set();

  const add = (value) => {
    const label = String(value || '').trim();
    const key = normalizeTopicKey(label);
    if (!label || !key || seen.has(key)) return;
    seen.add(key);
    out.push(label);
  };

  for (const tag of (paper.tags || [])) add(tag);
  for (const keyword of (paper.keywords || [])) add(keyword);

  return Number.isFinite(limit) ? out.slice(0, limit) : out;
}

function toTitleCaseSlug(slug) {
  return String(slug || '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function buildWorkUrl(kind, value) {
  const params = new URLSearchParams();
  params.set('kind', kind);
  params.set('value', String(value || '').trim());
  params.set('from', 'work');
  return `work.html?${params.toString()}`;
}

function parseStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const kindParam = normalizeValue(params.get('kind'));
  const kind = kindParam === 'speaker' ? 'speaker' : 'topic';
  const valueParam = String(params.get('value') || '').trim();
  const queryParam = String(params.get('q') || '').trim();
  const modeParam = normalizeValue(params.get('mode'));
  const fromParam = normalizeValue(params.get('from'));
  const from = fromParam === 'papers' ? 'papers' : 'talks';
  const hasEntityContext = Boolean(valueParam || kindParam);
  const isSearchMode = modeParam === 'search' || (!hasEntityContext && !!queryParam);

  state.kind = kind;
  state.mode = isSearchMode ? 'search' : 'entity';
  state.query = isSearchMode ? queryParam : '';
  state.value = isSearchMode ? '' : String(valueParam || queryParam || '').trim();
  state.from = from;
}

function syncGlobalSearchInput() {
  const input = document.querySelector('.global-search-input');
  if (!input) return;
  input.value = state.mode === 'search' ? state.query : state.value;
}

function normalizePaperRecord(rawPaper) {
  if (!rawPaper || typeof rawPaper !== 'object') return null;

  const paper = { ...rawPaper };
  paper.id = String(paper.id || '').trim();
  paper.title = String(paper.title || '').trim();
  paper.abstract = String(paper.abstract || '').trim();
  paper.year = String(paper.year || '').trim();
  paper.publication = String(paper.publication || '').trim();
  paper.venue = String(paper.venue || '').trim();
  paper.type = String(paper.type || '').trim();
  paper.paperUrl = String(paper.paperUrl || '').trim();

  paper.authors = Array.isArray(paper.authors)
    ? paper.authors
      .map((author) => {
        if (!author || typeof author !== 'object') return null;
        const name = String(author.name || '').trim();
        if (!name) return null;
        return { name };
      })
      .filter(Boolean)
    : [];

  paper.tags = Array.isArray(paper.tags)
    ? paper.tags.map((tag) => String(tag || '').trim()).filter(Boolean)
    : [];
  paper.keywords = Array.isArray(paper.keywords)
    ? paper.keywords.map((keyword) => String(keyword || '').trim()).filter(Boolean)
    : [];
  if (!paper.keywords.length && paper.tags.length) {
    paper.keywords = [...paper.tags];
  }

  if (!paper.id || !paper.title) return null;

  paper._year = /^\d{4}$/.test(paper.year) ? paper.year : '';
  return paper;
}

function compareTalksNewestFirst(a, b) {
  const meetingDiff = String(b.meeting || '').localeCompare(String(a.meeting || ''));
  if (meetingDiff !== 0) return meetingDiff;

  const titleDiff = String(a.title || '').localeCompare(String(b.title || ''));
  if (titleDiff !== 0) return titleDiff;

  return String(a.id || '').localeCompare(String(b.id || ''));
}

function comparePapersNewestFirst(a, b) {
  const yearDiff = String(b._year || '').localeCompare(String(a._year || ''));
  if (yearDiff !== 0) return yearDiff;

  const titleDiff = String(a.title || '').localeCompare(String(b.title || ''));
  if (titleDiff !== 0) return titleDiff;

  return String(a.id || '').localeCompare(String(b.id || ''));
}

function tokenizeQuery(query) {
  if (typeof HubUtils.tokenizeQuery === 'function') return HubUtils.tokenizeQuery(query);
  const tokens = [];
  const re = /"([^"]+)"|(\S+)/g;
  let match;
  while ((match = re.exec(String(query || ''))) !== null) {
    const token = (match[1] || match[2] || '').toLowerCase().trim();
    if (token.length >= 2) tokens.push(token);
  }
  return tokens;
}

function indexTalkForSearch(talk) {
  return {
    ...talk,
    _titleLower: String(talk.title || '').toLowerCase(),
    _speakerLower: (talk.speakers || []).map((speaker) => speaker.name).join(' ').toLowerCase(),
    _abstractLower: String(talk.abstract || '').toLowerCase(),
    _tagsLower: (talk.tags || []).join(' ').toLowerCase(),
    _meetingLower: `${talk.meetingName || ''} ${talk.meetingLocation || ''} ${talk.meetingDate || ''}`.toLowerCase(),
    _year: talk.meeting ? String(talk.meeting).slice(0, 4) : '',
  };
}

function scorePaperForQuery(paper, tokens) {
  if (!tokens.length) return 0;

  let total = 0;
  const title = String(paper.title || '').toLowerCase();
  const authors = (paper.authors || []).map((author) => `${author.name || ''}`).join(' ').toLowerCase();
  const abstractText = String(paper.abstract || '').toLowerCase();
  const tags = (paper.tags || []).join(' ').toLowerCase();
  const keywords = (paper.keywords || []).join(' ').toLowerCase();
  const publication = String(paper.publication || '').toLowerCase();
  const venue = String(paper.venue || '').toLowerCase();
  const year = String(paper._year || '').toLowerCase();

  for (const token of tokens) {
    let tokenScore = 0;
    const titleIdx = title.indexOf(token);
    if (titleIdx !== -1) tokenScore += titleIdx === 0 ? 100 : 50;
    if (authors.includes(token)) tokenScore += 34;
    if (tags.includes(token)) tokenScore += 20;
    if (keywords.includes(token)) tokenScore += 16;
    if (abstractText.includes(token)) tokenScore += 12;
    if (publication.includes(token)) tokenScore += 10;
    if (venue.includes(token)) tokenScore += 8;
    if (year.includes(token)) tokenScore += 6;
    if (tokenScore === 0) return 0;
    total += tokenScore;
  }

  const yearNumber = Number.parseInt(String(paper._year || ''), 10);
  total += (Number.isFinite(yearNumber) ? yearNumber : 2002) * 0.01;
  return total;
}

function rankTalksForQuery(talks, query) {
  const indexedTalks = (talks || []).map(indexTalkForSearch);
  const tokens = tokenizeQuery(query);
  if (!tokens.length) return indexedTalks.sort(compareTalksNewestFirst);

  if (typeof HubUtils.rankTalksByQuery === 'function') {
    return HubUtils.rankTalksByQuery(indexedTalks, query);
  }

  if (typeof HubUtils.scoreMatch === 'function') {
    const scored = [];
    for (const talk of indexedTalks) {
      const score = HubUtils.scoreMatch(talk, tokens);
      if (score > 0) scored.push({ talk, score });
    }
    scored.sort((a, b) => (b.score - a.score) || compareTalksNewestFirst(a.talk, b.talk));
    return scored.map((entry) => entry.talk);
  }

  return indexedTalks.sort(compareTalksNewestFirst);
}

function rankPapersForQuery(papers, query) {
  const tokens = tokenizeQuery(query);
  if (!tokens.length) return [...papers].sort(comparePapersNewestFirst);

  const scored = [];
  for (const paper of papers) {
    const score = scorePaperForQuery(paper, tokens);
    if (score > 0) scored.push({ paper, score });
  }

  scored.sort((a, b) => (b.score - a.score) || comparePapersNewestFirst(a.paper, b.paper));
  return scored.map((entry) => entry.paper);
}

function matchesTalkEntity(talk, normalizedNeedle) {
  if (state.kind === 'speaker') {
    return (talk.speakers || []).some((speaker) => normalizeValue(speaker.name) === normalizedNeedle);
  }

  return (talk.tags || []).some((tag) => normalizeValue(tag) === normalizedNeedle);
}

function matchesPaperEntity(paper, normalizedNeedle) {
  if (state.kind === 'speaker') {
    return (paper.authors || []).some((author) => normalizeValue(author.name) === normalizedNeedle);
  }

  return [...(paper.tags || []), ...(paper.keywords || [])]
    .some((tag) => normalizeValue(tag) === normalizedNeedle);
}

function renderEntityLinks(items, kind) {
  if (!items || items.length === 0) return '';

  return items
    .map((label) => {
      const value = String(label || '').trim();
      if (!value) return '';
      return `<a class="speaker-btn" href="${escapeHtml(buildWorkUrl(kind, value))}">${escapeHtml(value)}</a>`;
    })
    .filter(Boolean)
    .join('<span class="speaker-btn-sep">, </span>');
}

function renderTagLinks(tags) {
  if (!tags || tags.length === 0) return '';

  const shown = tags.slice(0, 5);
  return `<div class="card-tags-wrap"><div class="card-tags" aria-label="Key Topics">${shown
    .map((tag) => `<a class="card-tag" href="${escapeHtml(buildWorkUrl('topic', tag))}">${escapeHtml(tag)}</a>`)
    .join('')}${tags.length > shown.length ? `<span class="card-tag card-tag--more" aria-hidden="true">+${tags.length - shown.length}</span>` : ''}</div></div>`;
}

function renderTalkCard(talk) {
  const title = escapeHtml(talk.title || 'Untitled talk');
  const meetingLabel = escapeHtml(talk.meetingName || talk.meeting || talk._year || 'Meeting');
  const talkType = escapeHtml(toTitleCaseSlug(talk.category || 'talk'));
  const speakerNames = (talk.speakers || []).map((speaker) => speaker.name).filter(Boolean);
  const speakersHtml = renderEntityLinks(speakerNames, 'speaker');

  return `
    <article class="talk-card">
      <a href="talk.html?id=${escapeHtml(talk.id || '')}" class="card-link-wrap" aria-label="${title}">
        <div class="card-body">
          <div class="card-meta">
            <span class="badge badge-technical-talk">${talkType}</span>
            <span class="meeting-label">${meetingLabel}</span>
          </div>
          <p class="card-title">${title}</p>
        </div>
      </a>
      ${speakersHtml ? `<p class="card-speakers">${speakersHtml}</p>` : ''}
      ${renderTagLinks(talk.tags || [])}
    </article>`;
}

function renderPaperCard(paper) {
  const title = escapeHtml(paper.title || 'Untitled paper');
  const venue = escapeHtml(paper.publication || paper.venue || toTitleCaseSlug(paper.type || 'paper'));
  const year = escapeHtml(paper._year || 'Unknown year');
  const authorNames = (paper.authors || []).map((author) => author.name).filter(Boolean);
  const authorsHtml = renderEntityLinks(authorNames, 'speaker');
  const topics = getPaperKeyTopics(paper, 8);

  return `
    <article class="talk-card paper-card">
      <a href="paper.html?id=${escapeHtml(paper.id || '')}" class="card-link-wrap" aria-label="${title}">
        <div class="card-body">
          <div class="card-meta">
            <span class="badge badge-paper">Paper</span>
            <span class="meeting-label">${year}</span>
            <span class="meeting-label">${venue}</span>
          </div>
          <p class="card-title">${title}</p>
        </div>
      </a>
      ${authorsHtml ? `<p class="card-speakers paper-authors">${authorsHtml}</p>` : ''}
      ${renderTagLinks(topics)}
    </article>`;
}

function setEmptyState(gridId, label) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  grid.setAttribute('aria-busy', 'false');
  const scopeValue = state.mode === 'search' ? state.query : state.value;
  const scope = scopeValue ? ` for "${escapeHtml(scopeValue)}"` : '';
  grid.innerHTML = `<div class="work-empty-state">No ${escapeHtml(label)} found${scope}.</div>`;
}

function renderTalkBatch(reset = false) {
  const grid = document.getElementById('work-talks-grid');
  const moreBtn = document.getElementById('work-talks-more');
  if (!grid || !moreBtn) return;

  if (reset) {
    grid.innerHTML = '';
    renderedTalkCount = 0;
  }

  if (!filteredTalks.length) {
    moreBtn.classList.add('hidden');
    setEmptyState('work-talks-grid', 'talks');
    return;
  }

  const nextCount = Math.min(renderedTalkCount + TALK_BATCH_SIZE, filteredTalks.length);
  const html = filteredTalks.slice(renderedTalkCount, nextCount).map(renderTalkCard).join('');
  grid.insertAdjacentHTML('beforeend', html);
  grid.setAttribute('aria-busy', 'false');
  renderedTalkCount = nextCount;

  const remaining = filteredTalks.length - renderedTalkCount;
  if (remaining > 0) {
    moreBtn.textContent = `Show more talks (${remaining.toLocaleString()} left)`;
    moreBtn.classList.remove('hidden');
  } else {
    moreBtn.classList.add('hidden');
  }
}

function renderPaperBatch(reset = false) {
  const grid = document.getElementById('work-papers-grid');
  const moreBtn = document.getElementById('work-papers-more');
  if (!grid || !moreBtn) return;

  if (reset) {
    grid.innerHTML = '';
    renderedPaperCount = 0;
  }

  if (!filteredPapers.length) {
    moreBtn.classList.add('hidden');
    setEmptyState('work-papers-grid', 'papers');
    return;
  }

  const nextCount = Math.min(renderedPaperCount + PAPER_BATCH_SIZE, filteredPapers.length);
  const html = filteredPapers.slice(renderedPaperCount, nextCount).map(renderPaperCard).join('');
  grid.insertAdjacentHTML('beforeend', html);
  grid.setAttribute('aria-busy', 'false');
  renderedPaperCount = nextCount;

  const remaining = filteredPapers.length - renderedPaperCount;
  if (remaining > 0) {
    moreBtn.textContent = `Show more papers (${remaining.toLocaleString()} left)`;
    moreBtn.classList.remove('hidden');
  } else {
    moreBtn.classList.add('hidden');
  }
}

function applyHeaderState() {
  const titleEl = document.getElementById('work-title');
  const subtitleEl = document.getElementById('work-subtitle');
  const summaryEl = document.getElementById('work-results-summary');
  const talksCountEl = document.getElementById('work-talks-count');
  const papersCountEl = document.getElementById('work-papers-count');
  const backLink = document.getElementById('work-back-link');
  const secondaryBackLink = document.getElementById('work-secondary-back-link');

  const entityLabel = state.kind === 'speaker' ? 'Speaker' : 'Key Topic';
  const backHref = state.from === 'papers' ? 'papers.html' : 'index.html';
  const backText = state.from === 'papers' ? 'Back to papers' : 'Back to talks';

  if (backLink) {
    backLink.href = backHref;
    backLink.textContent = backText;
  }
  if (secondaryBackLink) {
    secondaryBackLink.href = backHref;
    secondaryBackLink.textContent = backText;
  }

  if (state.mode === 'search') {
    if (!state.query) {
      if (titleEl) titleEl.textContent = 'Global Search';
      if (subtitleEl) subtitleEl.textContent = 'Search talks and papers from one place.';
      if (summaryEl) summaryEl.textContent = 'No search query provided';
      if (talksCountEl) talksCountEl.textContent = '';
      if (papersCountEl) papersCountEl.textContent = '';
      return;
    }

    if (titleEl) titleEl.textContent = 'Global Search';
    if (subtitleEl) subtitleEl.innerHTML = `Results for <strong>${escapeHtml(state.query)}</strong> across talks and papers`;
  } else {
    if (!state.value) {
      if (titleEl) titleEl.textContent = 'All Work';
      if (subtitleEl) subtitleEl.textContent = 'Choose a speaker or key topic from Talks or Papers to view all related work.';
      if (summaryEl) summaryEl.textContent = 'No speaker/key topic selected';
      if (talksCountEl) talksCountEl.textContent = '';
      if (papersCountEl) papersCountEl.textContent = '';
      return;
    }

    if (titleEl) titleEl.textContent = `${entityLabel}: ${state.value}`;
    if (subtitleEl) subtitleEl.innerHTML = `Showing talks and papers for <strong>${escapeHtml(state.value)}</strong>`;
  }

  if (talksCountEl) {
    talksCountEl.textContent = `${filteredTalks.length.toLocaleString()} talk${filteredTalks.length === 1 ? '' : 's'}`;
  }

  if (papersCountEl) {
    papersCountEl.textContent = `${filteredPapers.length.toLocaleString()} paper${filteredPapers.length === 1 ? '' : 's'}`;
  }

  if (summaryEl) {
    const total = filteredTalks.length + filteredPapers.length;
    summaryEl.innerHTML = `<strong>${total.toLocaleString()}</strong> total results · ${filteredTalks.length.toLocaleString()} talks · ${filteredPapers.length.toLocaleString()} papers`;
  }
}

function renderError(message) {
  const talksGrid = document.getElementById('work-talks-grid');
  const papersGrid = document.getElementById('work-papers-grid');
  const summaryEl = document.getElementById('work-results-summary');

  if (summaryEl) summaryEl.textContent = 'Could not load all work';

  const html = `<div class="work-empty-state">${escapeHtml(message)}</div>`;

  if (talksGrid) {
    talksGrid.setAttribute('aria-busy', 'false');
    talksGrid.innerHTML = html;
  }

  if (papersGrid) {
    papersGrid.setAttribute('aria-busy', 'false');
    papersGrid.innerHTML = html;
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

async function init() {
  initMobileNavMenu();
  parseStateFromUrl();
  syncGlobalSearchInput();

  if (state.mode === 'search' && !state.query) {
    applyHeaderState();
    setEmptyState('work-talks-grid', 'talks');
    setEmptyState('work-papers-grid', 'papers');
    return;
  }

  if (state.mode === 'entity' && !state.value) {
    applyHeaderState();
    setEmptyState('work-talks-grid', 'talks');
    setEmptyState('work-papers-grid', 'papers');
    return;
  }

  if (typeof window.loadEventData !== 'function' || typeof window.loadPaperData !== 'function') {
    renderError('Data loaders are unavailable on this page.');
    return;
  }

  try {
    const [eventPayload, paperPayload] = await Promise.all([
      window.loadEventData(),
      window.loadPaperData(),
    ]);

    const talks = typeof HubUtils.normalizeTalks === 'function'
      ? HubUtils.normalizeTalks(eventPayload.talks || [])
      : (Array.isArray(eventPayload.talks) ? eventPayload.talks : []);

    const papers = Array.isArray(paperPayload.papers)
      ? paperPayload.papers.map(normalizePaperRecord).filter(Boolean)
      : [];

    if (state.mode === 'search') {
      filteredTalks = rankTalksForQuery(talks, state.query);
      filteredPapers = rankPapersForQuery(papers, state.query);
    } else {
      const normalizedNeedle = normalizeValue(state.value);
      filteredTalks = talks
        .filter((talk) => matchesTalkEntity(talk, normalizedNeedle))
        .sort(compareTalksNewestFirst);

      filteredPapers = papers
        .filter((paper) => matchesPaperEntity(paper, normalizedNeedle))
        .sort(comparePapersNewestFirst);
    }

    applyHeaderState();
    renderTalkBatch(true);
    renderPaperBatch(true);

    const talksMoreBtn = document.getElementById('work-talks-more');
    const papersMoreBtn = document.getElementById('work-papers-more');

    if (talksMoreBtn) talksMoreBtn.addEventListener('click', () => renderTalkBatch(false));
    if (papersMoreBtn) papersMoreBtn.addEventListener('click', () => renderPaperBatch(false));
  } catch (error) {
    renderError(`Could not load data: ${String(error && error.message ? error.message : error)}`);
  }
}

init();

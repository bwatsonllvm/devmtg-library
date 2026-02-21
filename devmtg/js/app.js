/**
 * app.js — Main search, filter, and card rendering for LLVM Developers' Meeting Library
 */

// ============================================================
// State
// ============================================================

let allTalks = [];
let searchIndex = [];
let viewMode = 'grid'; // 'grid' | 'list'
let debounceTimer = null;
let searchMode = 'browse'; // 'browse' | 'exact' | 'fuzzy'
let meetingOptions = [];
let yearFilterTouched = false; // true once user directly toggles a year chip this session

const state = {
  query: '',
  activeSpeaker: '', // set when a speaker is chosen from autocomplete dropdown
  activeTag: '',     // set when a tag is chosen from autocomplete dropdown
  speaker: '',       // exact speaker name filter (set by clicking a speaker anywhere)
  categories: new Set(),
  years: new Set(),
  hasVideo: false,
  hasSlides: false,
  meeting: '',       // slug filter set when arriving from meetings page
  meetingName: '',   // display name for the meeting pill
};

// All canonical tags in display order
const ALL_TAGS = [
  'AI','Autovectorization','Backend','Beginner','C++','C++ Libs','CIRCT','Clang',
  'ClangIR','C Libs','Community Building','CUDA','D&I','Debug Information',
  'Dynamic Analysis','Embedded','Flang','Frontend','GPU','Incubator','Infrastructure',
  'IR','JIT','Libraries','LLD','LLDB','Loop transformations','LTO','MCP','ML','MLIR',
  'Mojo','OpenCL','Optimizations','Performance','PGO','Polly','Programming Languages',
  'Quantum Computing','Rust','Security','Static Analysis','Swift','Testing','VPlan',
];

// Category display names and order
const CATEGORY_META = {
  'keynote':        { label: 'Keynote',        order: 0 },
  'technical-talk': { label: 'Technical Talk',  order: 1 },
  'tutorial':       { label: 'Tutorial',        order: 2 },
  'panel':          { label: 'Panel',           order: 3 },
  'quick-talk':     { label: 'Quick Talk',      order: 4 },
  'lightning-talk': { label: 'Lightning Talk',  order: 5 },
  'student-talk':   { label: 'Student Talk',    order: 6 },
  'bof':            { label: 'BoF',             order: 7 },
  'poster':         { label: 'Poster',          order: 8 },
  'workshop':       { label: 'Workshop',        order: 9 },
  'other':          { label: 'Other',           order: 10 },
};

// ============================================================
// Data Loading
// ============================================================

const HubUtils = window.LLVMHubUtils || {};

function normalizeTalks(rawTalks) {
  if (typeof HubUtils.normalizeTalks === 'function') {
    return HubUtils.normalizeTalks(rawTalks);
  }
  return Array.isArray(rawTalks) ? rawTalks : [];
}

async function loadData() {
  if (typeof window.loadEventData !== 'function') {
    showError('Could not load event data loader. Ensure <code>js/events-data.js</code> is included before this script.');
    return false;
  }

  try {
    const { talks } = await window.loadEventData();
    allTalks = normalizeTalks(talks);
  } catch (err) {
    showError(`Could not load event JSON data: <code>${escapeHtml(String(err.message || err))}</code>`);
    return false;
  }

  if (!allTalks.length) {
    showError('No talks were loaded from <code>events/*.json</code>.');
    return false;
  }

  return true;
}

// ============================================================
// Search Index
// ============================================================

function buildSearchIndex() {
  const uniqueTokens = (parts) => {
    const seen = new Set();
    const out = [];
    for (const part of parts) {
      const chunks = String(part || '')
        .toLowerCase()
        .split(/[^a-z0-9+#.]+/)
        .map((chunk) => chunk.trim())
        .filter((chunk) => chunk.length >= 2);
      for (const chunk of chunks) {
        if (!seen.has(chunk)) {
          seen.add(chunk);
          out.push(chunk);
        }
      }
    }
    return out;
  };

  searchIndex = allTalks.map(talk => ({
    ...talk,
    _titleLower:   talk.title.toLowerCase(),
    _speakerLower: talk.speakers.map(s => s.name).join(' ').toLowerCase(),
    _abstractLower: talk.abstract.toLowerCase(),
    _tagsLower:    (talk.tags || []).join(' ').toLowerCase(),
    _meetingLower: (talk.meetingName + ' ' + talk.meetingLocation + ' ' + talk.meetingDate).toLowerCase(),
    _year:         talk.meeting ? talk.meeting.slice(0, 4) : '',
    _fuzzyTitle: uniqueTokens([talk.title]),
    _fuzzySpeakers: uniqueTokens((talk.speakers || []).map((s) => s.name)),
    _fuzzyTags: uniqueTokens(talk.tags || []),
    _fuzzyMeeting: uniqueTokens([talk.meetingName, talk.meetingLocation, talk.meetingDate, talk.meeting]),
  }));
}

function tokenize(query) {
  if (typeof HubUtils.tokenizeQuery === 'function') {
    return HubUtils.tokenizeQuery(query);
  }
  return [];
}

function scoreMatch(indexed, tokens) {
  if (typeof HubUtils.scoreMatch === 'function') {
    return HubUtils.scoreMatch(indexed, tokens);
  }
  return 0;
}

function isSubsequence(needle, haystack) {
  let i = 0;
  let j = 0;
  while (i < needle.length && j < haystack.length) {
    if (needle[i] === haystack[j]) i += 1;
    j += 1;
  }
  return i === needle.length;
}

function boundedLevenshtein(a, b, maxDistance) {
  const lenA = a.length;
  const lenB = b.length;
  if (Math.abs(lenA - lenB) > maxDistance) return maxDistance + 1;

  let prev = new Array(lenB + 1);
  let curr = new Array(lenB + 1);
  for (let j = 0; j <= lenB; j += 1) prev[j] = j;

  for (let i = 1; i <= lenA; i += 1) {
    curr[0] = i;
    let minInRow = curr[0];

    for (let j = 1; j <= lenB; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
      if (curr[j] < minInRow) minInRow = curr[j];
    }

    if (minInRow > maxDistance) return maxDistance + 1;
    const swap = prev;
    prev = curr;
    curr = swap;
  }

  return prev[lenB];
}

function fuzzyTokenScore(token, words) {
  if (!token || !words || words.length === 0) return 0;
  let best = 0;

  for (const word of words) {
    if (!word) continue;
    if (word === token) return 20;
    if (word.startsWith(token)) best = Math.max(best, 16);
    else if (word.includes(token)) best = Math.max(best, 14);
    else if (token.length >= 3 && isSubsequence(token, word)) best = Math.max(best, 11);

    if (token.length >= 4) {
      const maxDist = token.length >= 7 ? 2 : 1;
      const dist = boundedLevenshtein(token, word, maxDist);
      if (dist <= maxDist) {
        best = Math.max(best, dist === 1 ? 10 : 8);
      }
    }
  }

  return best;
}

function fuzzyScoreTalk(indexedTalk, tokens) {
  let total = 0;
  for (const token of tokens) {
    const titleScore = fuzzyTokenScore(token, indexedTalk._fuzzyTitle || []);
    const speakerScore = fuzzyTokenScore(token, indexedTalk._fuzzySpeakers || []);
    const tagScore = fuzzyTokenScore(token, indexedTalk._fuzzyTags || []);
    const meetingScore = fuzzyTokenScore(token, indexedTalk._fuzzyMeeting || []);
    const best = Math.max(
      titleScore ? titleScore + 3 : 0,
      speakerScore ? speakerScore + 2 : 0,
      tagScore ? tagScore + 2 : 0,
      meetingScore,
    );
    if (best <= 0) return 0; // AND semantics across query tokens
    total += best;
  }
  return total;
}

// ============================================================
// Filter + Sort Pipeline
// ============================================================

function filterAndSort() {
  let results = searchIndex;
  const tokens = state.query.length >= 2 ? tokenize(state.query) : [];
  searchMode = tokens.length > 0 ? 'exact' : 'browse';

  if (tokens.length > 0) {
    if (typeof HubUtils.rankTalksByQuery === 'function') {
      results = HubUtils.rankTalksByQuery(results, state.query);
    } else {
      const scored = [];
      for (const t of results) {
        const s = scoreMatch(t, tokens);
        if (s > 0) scored.push({ talk: t, score: s });
      }
      scored.sort((a, b) => b.score - a.score);
      results = scored.map((x) => x.talk);
    }

    if (results.length === 0) {
      const fuzzy = [];
      for (const t of searchIndex) {
        const score = fuzzyScoreTalk(t, tokens);
        if (score > 0) fuzzy.push({ talk: t, score });
      }
      fuzzy.sort((a, b) => {
        const scoreDiff = b.score - a.score;
        if (scoreDiff !== 0) return scoreDiff;
        const meetingDiff = String(b.talk.meeting || '').localeCompare(String(a.talk.meeting || ''));
        if (meetingDiff !== 0) return meetingDiff;
        return String(a.talk.title || '').localeCompare(String(b.talk.title || ''));
      });
      results = fuzzy.map((entry) => entry.talk);
      if (results.length > 0) searchMode = 'fuzzy';
    }
  } else {
    // Default: newest first
    results = [...results].sort((a, b) => b.meeting.localeCompare(a.meeting));
  }

  if (state.meeting) {
    results = results.filter(t => t.meeting === state.meeting);
  }
  if (state.speaker) {
    const spLower = state.speaker.toLowerCase();
    results = results.filter(t =>
      (t.speakers || []).some(s => s.name.toLowerCase() === spLower)
    );
  }
  if (state.categories.size > 0) {
    results = results.filter(t => state.categories.has(t.category));
  }
  if (state.years.size > 0) {
    results = results.filter(t => state.years.has(t._year));
  }
  if (state.hasVideo)  results = results.filter(t => t.videoUrl);
  if (state.hasSlides) results = results.filter(t => t.slidesUrl);

  return results;
}

// ============================================================
// Rendering
// ============================================================

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function highlightText(text, tokens) {
  if (!tokens || tokens.length === 0) return escapeHtml(text);
  let result = escapeHtml(text);
  for (const token of tokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(
      new RegExp(`(${escaped})`, 'gi'),
      '<mark>$1</mark>'
    );
  }
  return result;
}

function categoryLabel(cat) {
  return CATEGORY_META[cat]?.label ?? cat;
}

function formatSpeakers(speakers) {
  if (!speakers || speakers.length === 0) return '';
  return speakers.map(s => s.name).join(', ');
}

function sourceNameFromHost(hostname) {
  const host = (hostname || '').toLowerCase().replace(/^www\./, '');
  if (!host) return 'External Source';
  if (host === 'youtu.be' || host.endsWith('youtube.com')) return 'YouTube';
  if (host === 'devimages.apple.com') return 'Apple Developer';
  return host;
}

function isAppleDeveloperVideoUrl(videoUrl) {
  if (!videoUrl) return false;
  try {
    const host = new URL(videoUrl).hostname.toLowerCase().replace(/^www\./, '');
    return host === 'devimages.apple.com';
  } catch {
    return false;
  }
}

function getVideoLinkMeta(videoUrl, titleEsc) {
  const fallback = {
    text: 'Watch',
    ariaLabel: `Watch video: ${titleEsc} (opens in new tab)`,
    icon: 'play',
  };
  if (!videoUrl) return fallback;

  try {
    const url = new URL(videoUrl);
    const sourceName = sourceNameFromHost(url.hostname);
    const isYouTube = sourceName === 'YouTube';
    const isDownload =
      /\.(mov|m4v|mp4|mkv|avi|wmv|webm)$/i.test(url.pathname) ||
      /download/i.test(url.pathname) ||
      /download/i.test(url.search);

    if (isDownload) {
      const sourceText = isYouTube ? '' : ` (${sourceName})`;
      return {
        text: `Download${sourceText}`,
        ariaLabel: `Download video${isYouTube ? '' : ` from ${sourceName}`}: ${titleEsc} (opens in new tab)`,
        icon: sourceName === 'Apple Developer' ? 'tv' : 'download',
      };
    }

    if (!isYouTube) {
      return {
        text: `Watch on ${sourceName}`,
        ariaLabel: `Watch on ${sourceName}: ${titleEsc} (opens in new tab)`,
        icon: 'play',
      };
    }

    return {
      text: 'Watch',
      ariaLabel: `Watch on YouTube: ${titleEsc} (opens in new tab)`,
      icon: 'play',
    };
  } catch {
    return fallback;
  }
}

/**
 * Render each speaker name as a clickable button that triggers filterBySpeaker().
 * If state.activeSpeaker or state.speaker is set, highlight the matching name.
 * Tokens from text search also highlight via <mark>.
 */
function renderSpeakerButtons(speakers, tokens) {
  if (!speakers || speakers.length === 0) return '';
  const activeLower = (state.activeSpeaker || state.speaker || '').toLowerCase();

  return speakers.map(s => {
    let nameHtml;
    if (activeLower && s.name.toLowerCase() === activeLower) {
      nameHtml = `<mark>${escapeHtml(s.name)}</mark>`;
    } else {
      nameHtml = highlightText(s.name, tokens);
    }
    return `<button class="speaker-btn" onclick="event.stopPropagation();filterBySpeaker(${JSON.stringify(s.name)})" aria-label="View all talks by ${escapeHtml(s.name)}">${nameHtml}</button>`;
  }).join('<span class="speaker-btn-sep">, </span>');
}

// SVG icons for no-video placeholder (defined outside renderCard to avoid HTML-escaping issues)
const _SVG_DOC = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`;
const _SVG_TOOL = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;
const _SVG_CHAT = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
const _SVG_TV = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2" ry="2"/><line x1="8" y1="20" x2="16" y2="20"/><line x1="12" y1="17" x2="12" y2="20"/><polygon points="10 9 15 11 10 13 10 9" fill="currentColor" stroke="none"/></svg>`;

function placeholderSvgForCategory(category) {
  return { workshop: _SVG_TOOL, panel: _SVG_CHAT, bof: _SVG_CHAT }[category] ?? _SVG_DOC;
}

function placeholderSvgForTalk(talk) {
  if (isAppleDeveloperVideoUrl(talk.videoUrl)) return _SVG_TV;
  return placeholderSvgForCategory(talk.category);
}

// Called from img onerror to swap broken YouTube thumbnail with a category-appropriate placeholder
window.thumbnailError = function(img, category) {
  const div = document.createElement('div');
  div.className = 'card-thumbnail-placeholder';
  div.innerHTML = placeholderSvgForCategory(category);
  img.parentElement.replaceChild(div, img);
};

function renderCard(talk, tokens) {
  const speakerText = formatSpeakers(talk.speakers);
  const abstractPreview = talk.abstract ? talk.abstract.slice(0, 300) : '';
  const thumbnailUrl = talk.videoId
    ? `https://img.youtube.com/vi/${talk.videoId}/hqdefault.jpg`
    : '';
  // Use full meetingName for the card label; fall back to year
  const meetingLabel = talk.meetingName || (talk._year || talk.meeting?.slice(0, 4) || '');
  const badgeCls = `badge badge-${escapeHtml(talk.category || 'other')}`;

  const placeholderHtml = `<div class="card-thumbnail-placeholder">${placeholderSvgForTalk(talk)}</div>`;

  const thumbnailHtml = thumbnailUrl
    ? `<img src="${escapeHtml(thumbnailUrl)}" alt="" loading="lazy" onerror="thumbnailError(this,'${escapeHtml(talk.category || '')}')">`
    : placeholderHtml;

  // Tags (up to 4 shown on card)
  const tags = talk.tags || [];
  const tagsHtml = tags.length
    ? `<div class="card-tags" aria-label="Topics">${tags.slice(0, 4).map(tag =>
        `<button class="card-tag" data-tag="${escapeHtml(tag)}" onclick="event.stopPropagation();filterByTag(${JSON.stringify(tag)})" aria-label="Filter by topic: ${escapeHtml(tag)}">${escapeHtml(tag)}</button>`
      ).join('')}${tags.length > 4 ? `<span class="card-tag card-tag--more" aria-hidden="true">+${tags.length - 4}</span>` : ''}</div>`
    : '';

  // Footer action buttons — outside the card link to avoid nested interactives
  const titleEsc = escapeHtml(talk.title);
  const videoMeta = getVideoLinkMeta(talk.videoUrl, titleEsc);
  const videoIcon = videoMeta.icon === 'download'
    ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 21h16"/></svg>`
    : videoMeta.icon === 'tv'
      ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2" ry="2"/><line x1="8" y1="20" x2="16" y2="20"/><line x1="12" y1="17" x2="12" y2="20"/></svg>`
      : `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  const videoLinkHtml = talk.videoUrl
    ? `<a href="${escapeHtml(talk.videoUrl)}" class="card-link-btn card-link-btn--video" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(videoMeta.ariaLabel)}">
        ${videoIcon}
        <span aria-hidden="true">${escapeHtml(videoMeta.text)}</span>
      </a>`
    : '';

  const slidesLinkHtml = talk.slidesUrl
    ? `<a href="${escapeHtml(talk.slidesUrl)}" class="card-link-btn" target="_blank" rel="noopener noreferrer" aria-label="View slides: ${titleEsc} (opens in new tab)">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span aria-hidden="true">Slides</span>
      </a>`
    : '';

  const githubLinkHtml = talk.projectGithub
    ? `<a href="${escapeHtml(talk.projectGithub)}" class="card-link-btn" target="_blank" rel="noopener noreferrer" aria-label="GitHub repository: ${titleEsc} (opens in new tab)">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
        <span aria-hidden="true">GitHub</span>
      </a>`
    : '';

  const hasActions = videoLinkHtml || slidesLinkHtml || githubLinkHtml;
  const speakerLabel = speakerText ? ` by ${speakerText}` : '';

  const speakerButtonsHtml = speakerText ? renderSpeakerButtons(talk.speakers, tokens) : '';

  return `
    <article class="talk-card">
      <a href="talk.html?id=${escapeHtml(talk.id)}" class="card-link-wrap" aria-label="${titleEsc}${escapeHtml(speakerLabel)}">
        <div class="card-thumbnail" aria-hidden="true">
          ${thumbnailHtml}
          ${talk.videoId ? `<div class="play-overlay" aria-hidden="true"><div class="play-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg></div></div>` : ''}
        </div>

        <div class="card-body">
          <div class="card-meta">
            <span class="${badgeCls}">${escapeHtml(categoryLabel(talk.category || 'other'))}</span>
            <span class="meeting-label">${escapeHtml(meetingLabel)}</span>
          </div>
          <p class="card-title">${highlightText(talk.title, tokens)}</p>
          ${abstractPreview ? `<p class="card-abstract">${highlightText(abstractPreview, tokens)}</p>` : ''}
        </div>
      </a>

      ${speakerButtonsHtml ? `<p class="card-speakers">${speakerButtonsHtml}</p>` : ''}
      ${tagsHtml ? `<div class="card-tags-wrap">${tagsHtml}</div>` : ''}
      ${hasActions ? `<div class="card-footer">${videoLinkHtml}${slidesLinkHtml}${githubLinkHtml}</div>` : ''}
    </article>`;
}

function formatMeetingMonth(meetingSlug) {
  const monthMap = {
    '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr',
    '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Aug',
    '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec',
  };
  const parts = meetingSlug.split('-');
  if (parts.length >= 2) return monthMap[parts[1]] ?? '';
  return '';
}

function renderCards(results) {
  const grid = document.getElementById('talks-grid');
  grid.setAttribute('aria-busy', 'false');

  if (results.length === 0) {
    const query = state.query;
    const suggestions = ['MLIR', 'LLDB', 'vectorization', 'Clang', 'loop optimization', 'Rust'];
    const recoveryActions = [];
    if (state.years.size > 0) recoveryActions.push({ id: 'clear-year', label: 'Clear year' });
    if (state.activeTag) recoveryActions.push({ id: 'clear-topic', label: 'Clear topic' });
    else if (state.query) recoveryActions.push({ id: 'clear-search', label: 'Clear search' });
    recoveryActions.push({ id: 'reset-all', label: 'Reset all' });

    grid.innerHTML = `
      <div class="empty-state" role="status">
        <div class="empty-state-icon" aria-hidden="true">🔍</div>
        <h2>No results found</h2>
        <p>${query ? `No talks match "<strong>${escapeHtml(query)}</strong>". Try a different search or remove some filters.` : 'No talks match the current filters.'}</p>
        <div class="empty-state-actions" aria-label="Recovery actions">
          ${recoveryActions.map((action) => `<button class="empty-action-btn" data-empty-action="${escapeHtml(action.id)}">${escapeHtml(action.label)}</button>`).join('')}
        </div>
        <div class="empty-state-suggestions" aria-label="Search suggestions">
          ${suggestions.map(s => `<button class="suggestion-chip" data-suggestion="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}
        </div>
      </div>`;

    grid.querySelectorAll('.empty-action-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.emptyAction;
        if (action === 'clear-year') {
          state.years.clear();
          document.querySelectorAll('.filter-chip[data-type="year"]').forEach((chip) => {
            chip.classList.remove('active');
            chip.setAttribute('aria-checked', 'false');
          });
          updateClearBtn();
          syncUrl();
          render();
          return;
        }
        if (action === 'clear-topic') {
          clearQuery();
          return;
        }
        if (action === 'clear-search') {
          clearQuery();
          return;
        }
        if (action === 'reset-all') {
          clearFilters();
        }
      });
    });

    grid.querySelectorAll('.suggestion-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const input = document.getElementById('search-input');
        input.value = chip.dataset.suggestion;
        state.query = chip.dataset.suggestion;
        updateClearBtn();
        render();
      });
    });
    return;
  }

  const tokens = state.query.length >= 2 ? tokenize(state.query) : [];
  const limit = 120; // render at most 120 cards at once
  const shown = results.slice(0, limit);

  grid.innerHTML = shown.map(t => renderCard(t, tokens)).join('');
}

function renderResultCount(count) {
  const el = document.getElementById('results-count');
  const contextEl = document.getElementById('results-context');
  const total = allTalks.length;
  const activeFilterCount =
    (state.query ? 1 : 0) +
    (state.meeting ? 1 : 0) +
    (state.speaker ? 1 : 0) +
    state.categories.size +
    state.years.size +
    (state.hasVideo ? 1 : 0) +
    (state.hasSlides ? 1 : 0);

  const noActiveFilters =
    !state.query &&
    !state.meeting &&
    !state.speaker &&
    state.categories.size === 0 &&
    state.years.size === 0 &&
    !state.hasVideo &&
    !state.hasSlides;
  if (count === total && noActiveFilters) {
    el.innerHTML = `<strong>${total.toLocaleString()}</strong> talks`;
  } else {
    el.innerHTML = `<strong>${count.toLocaleString()}</strong> of ${total.toLocaleString()} talks`;
  }

  if (!contextEl) return;
  const parts = [];
  parts.push(activeFilterCount > 0
    ? `${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} active`
    : 'All results');
  if (searchMode === 'fuzzy') parts.push('Fuzzy match');
  contextEl.textContent = `· ${parts.join(' · ')}`;
}

// ============================================================
// Filters
// ============================================================

function syncYearChipsFromState() {
  document.querySelectorAll('.filter-chip[data-type="year"]').forEach((chip) => {
    const isActive = state.years.has(chip.dataset.value);
    chip.classList.toggle('active', isActive);
    chip.setAttribute('aria-checked', isActive ? 'true' : 'false');
  });
}

function buildMeetingOptions() {
  const map = new Map();
  for (const talk of allTalks) {
    const slug = String(talk.meeting || '').trim();
    if (!slug || map.has(slug)) continue;
    const year = slug.slice(0, 4);
    const name = String(talk.meetingName || slug).trim() || slug;
    const formattedDate = typeof HubUtils.formatMeetingDateUniversal === 'function'
      ? HubUtils.formatMeetingDateUniversal(talk.meetingDate || '')
      : String(talk.meetingDate || '').trim();
    const location = String(talk.meetingLocation || '').trim();
    const details = [formattedDate || year, location].filter(Boolean).join(' · ');
    const label = details ? `${name} — ${details}` : name;
    map.set(slug, { slug, year, name, label });
  }
  meetingOptions = Array.from(map.values()).sort((a, b) => b.slug.localeCompare(a.slug));
}

function renderMeetingFilterOptions() {
  const select = document.getElementById('filter-meeting-select');
  const hint = document.getElementById('filter-meeting-hint');
  if (!select) return;

  const hasYearFilter = state.years.size > 0;
  const visibleOptions = hasYearFilter
    ? meetingOptions.filter((option) => state.years.has(option.year))
    : meetingOptions;

  select.innerHTML = `<option value="">All events</option>${visibleOptions.map((option) =>
    `<option value="${escapeHtml(option.slug)}">${escapeHtml(option.label)}</option>`).join('')}`;

  if (state.meeting && visibleOptions.some((option) => option.slug === state.meeting)) {
    select.value = state.meeting;
  } else {
    if (state.meeting) {
      state.meeting = '';
      state.meetingName = '';
    }
    select.value = '';
  }

  if (!hint) return;
  if (visibleOptions.length === 0) {
    hint.textContent = 'No events match selected year filters';
  } else if (hasYearFilter) {
    hint.textContent = `${visibleOptions.length} event${visibleOptions.length === 1 ? '' : 's'} in selected year${state.years.size === 1 ? '' : 's'}`;
  } else {
    hint.textContent = `${visibleOptions.length} total events`;
  }
}

function syncMeetingFilterForState() {
  if (!state.meeting) {
    renderMeetingFilterOptions();
    return;
  }

  const option = meetingOptions.find((item) => item.slug === state.meeting);
  if (!option) {
    state.meeting = '';
    state.meetingName = '';
    renderMeetingFilterOptions();
    return;
  }

  state.meetingName = state.meetingName || option.name;
  renderMeetingFilterOptions();
}

function initFilters() {
  // Categories: derive from data
  const catCounts = {};
  for (const t of allTalks) {
    const c = t.category || 'other';
    catCounts[c] = (catCounts[c] || 0) + 1;
  }

  const cats = typeof HubUtils.sortCategoryEntries === 'function'
    ? HubUtils.sortCategoryEntries(catCounts, CATEGORY_META)
    : Object.entries(catCounts).sort((a, b) => {
      const ao = CATEGORY_META[a[0]]?.order ?? 99;
      const bo = CATEGORY_META[b[0]]?.order ?? 99;
      return ao - bo;
    });

  const catContainer = document.getElementById('filter-categories');
  catContainer.innerHTML = cats.map(([cat, count]) => `
    <button class="filter-chip" data-type="category" data-value="${escapeHtml(cat)}"
            role="switch" aria-checked="false">
      ${escapeHtml(categoryLabel(cat))}
      <span class="filter-chip-count">${count.toLocaleString()}</span>
    </button>`).join('');

  // Years: derive from data, newest first
  const yearCounts = {};
  for (const t of allTalks) {
    const y = t.meeting?.slice(0, 4);
    if (y) yearCounts[y] = (yearCounts[y] || 0) + 1;
  }
  const years = Object.entries(yearCounts).sort((a, b) => b[0].localeCompare(a[0]));

  const yearContainer = document.getElementById('filter-years');
  yearContainer.innerHTML = years.map(([year, count]) => `
    <button class="filter-chip" data-type="year" data-value="${escapeHtml(year)}"
            role="switch" aria-checked="false">
      ${escapeHtml(year)}
      <span class="filter-chip-count">${count.toLocaleString()}</span>
    </button>`).join('');

  // Meeting events
  buildMeetingOptions();
  renderMeetingFilterOptions();
  const meetingSelect = document.getElementById('filter-meeting-select');
  if (meetingSelect) {
    meetingSelect.addEventListener('change', () => {
      const slug = String(meetingSelect.value || '').trim();
      if (!slug) {
        state.meeting = '';
        state.meetingName = '';
        renderMeetingFilterOptions();
        updateClearBtn();
        syncUrl();
        render();
        return;
      }

      const option = meetingOptions.find((item) => item.slug === slug);
      state.meeting = slug;
      state.meetingName = option ? option.name : slug;
      if (!yearFilterTouched && state.years.size > 0) {
        state.years.clear();
        syncYearChipsFromState();
      }
      renderMeetingFilterOptions();
      updateClearBtn();
      syncUrl();
      render();
    });
  }

  // Topic filters — alphabetical for predictable scanning
  const tagCounts = {};
  for (const t of allTalks) {
    for (const tag of (t.tags || [])) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }
  const activeTags = ALL_TAGS
    .filter(tag => tagCounts[tag] > 0)
    .sort((a, b) => a.localeCompare(b));
  const tagContainer = document.getElementById('filter-tags');
  if (tagContainer) {
    tagContainer.innerHTML = activeTags.map(tag => `
      <button class="filter-chip filter-chip--tag" data-type="tag" data-value="${escapeHtml(tag)}"
              role="switch" aria-checked="false">
        ${escapeHtml(tag)}
        <span class="filter-chip-count">${(tagCounts[tag] || 0).toLocaleString()}</span>
      </button>`).join('');
  }

  // Wire up chip clicks
  document.querySelectorAll('.filter-chip[data-type]').forEach(chip => {
    chip.addEventListener('click', () => {
      const type = chip.dataset.type;
      const value = chip.dataset.value;

      if (type === 'category') {
        if (state.categories.has(value)) {
          state.categories.delete(value);
          chip.classList.remove('active');
          chip.setAttribute('aria-checked', 'false');
        } else {
          state.categories.add(value);
          chip.classList.add('active');
          chip.setAttribute('aria-checked', 'true');
        }
      } else if (type === 'year') {
        if (state.years.has(value)) {
          state.years.delete(value);
          chip.classList.remove('active');
          chip.setAttribute('aria-checked', 'false');
        } else {
          state.years.add(value);
          chip.classList.add('active');
          chip.setAttribute('aria-checked', 'true');
        }
        yearFilterTouched = true;
        if (state.meeting) {
          const selectedMeeting = meetingOptions.find((item) => item.slug === state.meeting);
          if (!selectedMeeting || (state.years.size > 0 && !state.years.has(selectedMeeting.year))) {
            state.meeting = '';
            state.meetingName = '';
          }
        }
        renderMeetingFilterOptions();
      } else if (type === 'tag') {
        applyAutocompleteSelection('tag', value, 'sidebar');
        return;
      }

      updateClearBtn();
      syncUrl();
      render();
    });
  });

  // Boolean toggle chips
  document.getElementById('filter-video').addEventListener('click', function() {
    state.hasVideo = !state.hasVideo;
    this.classList.toggle('active', state.hasVideo);
    this.setAttribute('aria-checked', state.hasVideo);
    updateClearBtn();
    syncUrl();
    render();
  });

  document.getElementById('filter-slides').addEventListener('click', function() {
    state.hasSlides = !state.hasSlides;
    this.classList.toggle('active', state.hasSlides);
    this.setAttribute('aria-checked', state.hasSlides);
    updateClearBtn();
    syncUrl();
    render();
  });

  // Clear all
  document.getElementById('clear-filters').addEventListener('click', clearFilters);
}

function setFilterAccordionOpen(name, open, persist = true) {
  const section = document.querySelector(`.filter-accordion[data-accordion="${CSS.escape(name)}"]`);
  if (!section) return;

  const toggle = section.querySelector('.filter-accordion-toggle');
  const panel = section.querySelector('.filter-accordion-panel');
  if (!toggle || !panel) return;

  section.classList.toggle('is-collapsed', !open);
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  panel.hidden = !open;
}

function initFilterAccordions() {
  const sections = document.querySelectorAll('.filter-accordion[data-accordion]');
  if (!sections.length) return;

  sections.forEach(section => {
    const name = section.dataset.accordion;
    const toggle = section.querySelector('.filter-accordion-toggle');
    if (!name || !toggle) return;

    // Always initialize expanded so no filter set is hidden on first load.
    setFilterAccordionOpen(name, true, false);

    toggle.addEventListener('click', () => {
      const currentlyOpen = toggle.getAttribute('aria-expanded') === 'true';
      setFilterAccordionOpen(name, !currentlyOpen, false);
    });
  });
}

function setFilterSidebarCollapsed(collapsed, persist = true) {
  const collapseBtn = document.getElementById('filter-collapse-btn');
  if (!collapseBtn) return;

  document.body.classList.toggle('filter-collapsed', collapsed);
  collapseBtn.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
  collapseBtn.setAttribute('aria-label', collapsed ? 'Expand filters' : 'Collapse filters');
  collapseBtn.setAttribute('title', collapsed ? 'Expand filters' : 'Collapse filters');

  if (persist) {
    sessionStorage.setItem('llvm-hub-filter-sidebar-collapsed', collapsed ? '1' : '0');
  }
}

function initFilterSidebarCollapse() {
  const collapseBtn = document.getElementById('filter-collapse-btn');
  const filterSection = document.querySelector('.filter-section');
  const mobileOpenBtn = document.getElementById('mobile-filter-open');
  const mobileCloseBtn = document.getElementById('mobile-filter-close');
  const mobileApplyBtn = document.getElementById('mobile-filter-apply');
  const mobileClearBtn = document.getElementById('mobile-filter-clear');
  const mobileScrim = document.getElementById('mobile-filter-scrim');
  if (!collapseBtn) return;
  const mobileMq = window.matchMedia('(max-width: 1180px)');

  const setMobileDrawerOpen = (open) => {
    const isMobile = mobileMq.matches;
    const active = isMobile && open;
    document.body.classList.toggle('mobile-filters-open', active);
    if (mobileOpenBtn) mobileOpenBtn.setAttribute('aria-expanded', active ? 'true' : 'false');
    if (mobileScrim) {
      mobileScrim.classList.toggle('hidden', !active);
      mobileScrim.setAttribute('aria-hidden', active ? 'false' : 'true');
    }

    if (filterSection) {
      if (isMobile) {
        filterSection.hidden = !active;
        if (active) {
          filterSection.removeAttribute('inert');
        } else {
          filterSection.setAttribute('inert', '');
        }
      } else {
        filterSection.hidden = false;
        filterSection.removeAttribute('inert');
      }
    }
  };

  const syncSidebarMode = () => {
    if (mobileMq.matches) {
      document.body.classList.remove('filter-collapsed');
      collapseBtn.setAttribute('aria-pressed', 'false');
      collapseBtn.setAttribute('aria-label', 'Collapse filters');
      collapseBtn.setAttribute('title', 'Collapse filters');
      setMobileDrawerOpen(false);
      return;
    }

    // Always start expanded so filters remain discoverable and fully scrollable.
    sessionStorage.removeItem('llvm-hub-filter-sidebar-collapsed');
    setFilterSidebarCollapsed(false, false);
    setMobileDrawerOpen(false);
  };

  syncSidebarMode();
  if (typeof mobileMq.addEventListener === 'function') {
    mobileMq.addEventListener('change', syncSidebarMode);
  } else if (typeof mobileMq.addListener === 'function') {
    mobileMq.addListener(syncSidebarMode);
  }

  collapseBtn.addEventListener('click', () => {
    if (mobileMq.matches) return;
    const next = !document.body.classList.contains('filter-collapsed');
    setFilterSidebarCollapsed(next, true);
  });

  if (mobileOpenBtn) {
    mobileOpenBtn.addEventListener('click', () => {
      if (!mobileMq.matches) return;
      setMobileDrawerOpen(true);
    });
  }

  if (mobileCloseBtn) {
    mobileCloseBtn.addEventListener('click', () => {
      setMobileDrawerOpen(false);
      if (mobileOpenBtn) mobileOpenBtn.focus();
    });
  }

  if (mobileScrim) {
    mobileScrim.addEventListener('click', () => {
      setMobileDrawerOpen(false);
      if (mobileOpenBtn) mobileOpenBtn.focus();
    });
  }

  if (mobileApplyBtn) {
    mobileApplyBtn.addEventListener('click', () => {
      setMobileDrawerOpen(false);
      if (mobileOpenBtn) mobileOpenBtn.focus();
    });
  }

  if (mobileClearBtn) {
    mobileClearBtn.addEventListener('click', () => {
      clearFilters();
      setMobileDrawerOpen(false);
      if (mobileOpenBtn) mobileOpenBtn.focus();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('mobile-filters-open')) {
      setMobileDrawerOpen(false);
      if (mobileOpenBtn) mobileOpenBtn.focus();
    }
  });
}

function clearFilters() {
  state.meeting = '';
  state.meetingName = '';
  state.speaker = '';
  state.query = '';
  state.activeSpeaker = '';
  state.activeTag = '';
  state.categories.clear();
  state.years.clear();
  yearFilterTouched = false;
  state.hasVideo = false;
  state.hasSlides = false;

  const input = document.getElementById('search-input');
  if (input) input.value = '';

  document.querySelectorAll('.filter-chip.active').forEach(c => {
    c.classList.remove('active');
    c.setAttribute('aria-checked', 'false');
  });

  renderMeetingFilterOptions();
  closeDropdown();
  updateClearBtn();
  syncUrl();
  render();
}

function clearQuery() {
  const input = document.getElementById('search-input');
  if (input) input.value = '';
  state.query = '';
  state.activeSpeaker = '';
  state.activeTag     = '';
  syncTopicChipState();
  closeDropdown();
  updateClearBtn();
  syncUrl();
  render();
}

// ============================================================
// URL State Sync
// ============================================================

function syncUrl() {
  const params = new URLSearchParams();
  if (state.meeting)         params.set('meeting',  state.meeting);
  if (state.speaker)         params.set('speaker',  state.speaker);
  if (state.query)           params.set('q', state.query);
  if (state.categories.size) params.set('category', [...state.categories].join(','));
  if (state.years.size)      params.set('year',     [...state.years].join(','));
  if (state.hasVideo)        params.set('video',    '1');
  if (state.hasSlides)       params.set('slides',   '1');

  const newUrl = params.toString()
    ? `${window.location.pathname}?${params.toString()}`
    : window.location.pathname;
  history.replaceState(null, '', newUrl);
}

function loadStateFromUrl() {
  if (typeof HubUtils.parseUrlState === 'function') {
    const parsed = HubUtils.parseUrlState(window.location.search, allTalks);
    const legacyTag = parsed.tags && parsed.tags.length ? parsed.tags[0] : '';
    state.query = parsed.query || legacyTag || '';
    state.speaker = parsed.speaker || '';
    state.meeting = parsed.meeting || '';
    state.meetingName = parsed.meetingName || '';
    state.categories = new Set(parsed.categories || []);
    state.years = new Set(parsed.years || []);
    state.hasVideo = !!parsed.hasVideo;
    state.hasSlides = !!parsed.hasSlides;
  } else {
    const params = new URLSearchParams(window.location.search);
    if (params.get('q')) state.query = params.get('q');
    if (params.get('speaker')) state.speaker = params.get('speaker');
    if (params.get('meeting')) {
      state.meeting = params.get('meeting');
      const sample = allTalks.find((talk) => talk.meeting === state.meeting);
      state.meetingName = sample ? sample.meetingName : state.meeting;
    }
    if (params.get('category')) params.get('category').split(',').forEach((c) => state.categories.add(c.trim()));
    if (params.get('year')) params.get('year').split(',').forEach((y) => state.years.add(y.trim()));
    if (!state.query && params.get('tag')) {
      const legacyTag = params.get('tag').split(',').map((t) => t.trim()).filter(Boolean)[0];
      if (legacyTag) state.query = legacyTag;
    }
    state.hasVideo = params.get('video') === '1';
    state.hasSlides = params.get('slides') === '1';
  }

  yearFilterTouched = false;
  state.activeTag = resolveCanonicalTag(state.query);
  if (state.meeting) {
    const selectedMeeting = meetingOptions.find((item) => item.slug === state.meeting);
    if (!selectedMeeting) {
      state.meeting = '';
      state.meetingName = '';
    } else {
      state.meetingName = selectedMeeting.name;
    }
  } else {
    state.meetingName = '';
  }

  if (state.query) {
    document.getElementById('search-input').value = state.query;
  }
}

function applyUrlFilters() {
  // Activate chips that match loaded state
  document.querySelectorAll('.filter-chip[data-type="category"]').forEach(c => {
    const isActive = state.categories.has(c.dataset.value);
    c.classList.toggle('active', isActive);
    c.setAttribute('aria-checked', isActive ? 'true' : 'false');
  });
  syncMeetingFilterForState();
  syncYearChipsFromState();
  syncTopicChipState();
  const videoBtn = document.getElementById('filter-video');
  if (videoBtn) {
    videoBtn.classList.toggle('active', state.hasVideo);
    videoBtn.setAttribute('aria-checked', state.hasVideo ? 'true' : 'false');
  }
  const slidesBtn = document.getElementById('filter-slides');
  if (slidesBtn) {
    slidesBtn.classList.toggle('active', state.hasSlides);
    slidesBtn.setAttribute('aria-checked', state.hasSlides ? 'true' : 'false');
  }
  updateClearBtn();
}

// ============================================================
// Back-button state (session storage)
// ============================================================

function saveNavigationState() {
  sessionStorage.setItem('llvm-hub-search-state', JSON.stringify({
    query: state.query,
    speaker: state.speaker,
    categories: [...state.categories],
    years: [...state.years],
    hasVideo: state.hasVideo,
    hasSlides: state.hasSlides,
    scrollY: window.scrollY,
  }));
}

function restoreNavigationState() {
  const saved = sessionStorage.getItem('llvm-hub-search-state');
  if (!saved) return;
  sessionStorage.removeItem('llvm-hub-search-state');

  const s = typeof HubUtils.parseNavigationState === 'function'
    ? HubUtils.parseNavigationState(saved)
    : JSON.parse(saved);
  if (!s) return;

  if (s.query) {
    state.query = s.query;
    document.getElementById('search-input').value = s.query;
  }
  if (s.speaker)    state.speaker   = s.speaker;
  if (s.categories) s.categories.forEach(c => state.categories.add(c));
  if (s.years)      s.years.forEach(y => state.years.add(y));
  // Legacy back-state support from older sessions
  if (!state.query && s.tags && s.tags.length) state.query = s.tags[0];
  if (s.hasVideo)   state.hasVideo  = true;
  if (s.hasSlides)  state.hasSlides = true;

  state.activeTag = resolveCanonicalTag(state.query);
  if (state.query) document.getElementById('search-input').value = state.query;

  applyUrlFilters();
  render();

  requestAnimationFrame(() => {
    if (s.scrollY) window.scrollTo(0, s.scrollY);
  });
}

// ============================================================
// View Mode
// ============================================================

function setViewMode(mode) {
  viewMode = mode;
  const grid = document.getElementById('talks-grid');
  grid.className = mode === 'list' ? 'talks-list' : 'talks-grid';

  document.getElementById('view-grid').classList.toggle('active', mode === 'grid');
  document.getElementById('view-list').classList.toggle('active', mode === 'list');
  document.getElementById('view-grid').setAttribute('aria-pressed', mode === 'grid');
  document.getElementById('view-list').setAttribute('aria-pressed', mode === 'list');

  localStorage.setItem('llvm-hub-view', mode);
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
// Total count in hero
// ============================================================

function updateHeroCount() {
  const el = document.getElementById('total-count');
  if (el) el.textContent = allTalks.length.toLocaleString();
}

function updateHeroSubtitle() {
  const el = document.getElementById('hero-subtitle');
  if (!el) return;
  if (state.speaker) {
    el.innerHTML = `Showing all talks by <strong>${escapeHtml(state.speaker)}</strong>`;
  } else if (state.activeTag && state.query && !state.meeting) {
    el.innerHTML = `Showing all talks tagged <strong>${escapeHtml(state.activeTag)}</strong>`;
  } else {
    el.innerHTML = `Browse <strong id="total-count">${allTalks.length.toLocaleString()}</strong> talks from 2007 to present`;
  }
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to legacy copy
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
// Error Display
// ============================================================

function showError(html) {
  const grid = document.getElementById('talks-grid');
  grid.innerHTML = `
    <div class="empty-state" role="alert">
      <div class="empty-state-icon" aria-hidden="true">⚠️</div>
      <h2>Could not load data</h2>
      <p>${html}</p>
    </div>`;
}

// ============================================================
// Active Filters Strip
// ============================================================

const _xIcon = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

function createActiveFilterPill(typeLabel, valueLabel, ariaLabel, onRemove) {
  const pill = document.createElement('span');
  pill.className = 'active-filter-pill';

  const type = document.createElement('span');
  type.className = 'active-filter-pill__type';
  type.textContent = typeLabel;
  pill.appendChild(type);
  pill.appendChild(document.createTextNode(` ${valueLabel}`));

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'active-filter-pill__remove';
  button.setAttribute('aria-label', ariaLabel);
  button.innerHTML = _xIcon;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onRemove();
  });
  pill.appendChild(button);

  return pill;
}

function renderActiveFilters() {
  const el = document.getElementById('active-filters');
  if (!el) return;

  const pills = [];

  // Meeting pill — shown when arriving from the meetings page
  if (state.meeting) {
    const label = state.meetingName || state.meeting;
    pills.push(createActiveFilterPill(
      'Meeting',
      label,
      `Remove meeting filter: ${label}`,
      removeMeetingFilter
    ));
  }

  // Speaker pill — set by clicking a speaker name
  if (state.speaker) {
    pills.push(createActiveFilterPill(
      'Speaker',
      state.speaker,
      `Remove speaker filter: ${state.speaker}`,
      removeSpeakerFilter
    ));
  }

  // Query pill — labelled as "Speaker", "Topic", or "Search"
  if (state.query) {
    let typeLabel = 'Search';
    if (state.activeSpeaker && state.activeSpeaker.toLowerCase() === state.query.toLowerCase()) {
      typeLabel = 'Speaker';
    } else if (state.activeTag && state.activeTag.toLowerCase() === state.query.toLowerCase()) {
      typeLabel = 'Topic';
    }
    pills.push(createActiveFilterPill(
      typeLabel,
      state.query,
      `Remove ${typeLabel} filter: ${state.query}`,
      clearQuery
    ));
  }

  // Category pills
  for (const cat of state.categories) {
    const label = categoryLabel(cat);
    pills.push(createActiveFilterPill(
      'Talk Type',
      label,
      `Remove category filter: ${label}`,
      () => removeCategoryFilter(cat)
    ));
  }

  // Year pills
  for (const year of [...state.years].sort().reverse()) {
    pills.push(createActiveFilterPill(
      'Year',
      year,
      `Remove year filter: ${year}`,
      () => removeYearFilter(year)
    ));
  }

  // With Video / With Slides
  if (state.hasVideo) {
    pills.push(createActiveFilterPill(
      'Resources',
      'With Video',
      'Remove With Video filter',
      removeVideoFilter
    ));
  }
  if (state.hasSlides) {
    pills.push(createActiveFilterPill(
      'Resources',
      'With Slides',
      'Remove With Slides filter',
      removeSlidesFilter
    ));
  }

  if (pills.length > 0) {
    el.innerHTML = '';
    for (const pill of pills) el.appendChild(pill);
    el.classList.remove('hidden');
  } else {
    el.innerHTML = '';
    el.classList.add('hidden');
  }
}

function normalizeFilterValue(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveCanonicalTag(value) {
  const normalized = normalizeFilterValue(value);
  if (!normalized) return '';
  const matched = ALL_TAGS.find((tag) => normalizeFilterValue(tag) === normalized);
  return matched || '';
}

function syncTopicChipState() {
  const activeTopic = normalizeFilterValue(state.activeTag);
  document.querySelectorAll('.filter-chip[data-type="tag"]').forEach((chip) => {
    const isActive = !!activeTopic && normalizeFilterValue(chip.dataset.value) === activeTopic;
    chip.classList.toggle('active', isActive);
    chip.setAttribute('aria-checked', isActive ? 'true' : 'false');
  });
}

function applyTopicSearchFilter(tag) {
  const input = document.getElementById('search-input');
  state.activeSpeaker = '';
  state.speaker = '';
  state.activeTag = resolveCanonicalTag(tag);
  state.query = state.activeTag || tag;

  if (input) input.value = state.query;
  syncTopicChipState();

  closeDropdown();
  updateClearBtn();
  syncUrl();
  render();
}

function applyAutocompleteSelection(type, value, source = 'search') {
  const input = document.getElementById('search-input');
  const normalizedValue = normalizeFilterValue(value);

  if (type === 'tag') {
    const sameActiveTopic =
      normalizedValue &&
      normalizedValue === normalizeFilterValue(state.activeTag) &&
      normalizedValue === normalizeFilterValue(state.query);
    if (source === 'sidebar' && sameActiveTopic) {
      clearQuery();
      return;
    }
    applyTopicSearchFilter(value);
    return;
  }

  // speaker | generic
  state.speaker = '';
  state.activeTag = '';
  syncTopicChipState();
  if (type === 'speaker') {
    state.activeSpeaker = value;
    state.query = value;
  } else {
    state.activeSpeaker = '';
    state.query = value;
  }
  if (input) input.value = state.query;
  closeDropdown();
  updateClearBtn();
  syncUrl();
  render();
}

function removeMeetingFilter() {
  state.meeting = '';
  state.meetingName = '';
  renderMeetingFilterOptions();
  updateClearBtn(); syncUrl(); render();
}

function removeSpeakerFilter() {
  const removedSpeaker = state.speaker;
  state.speaker = '';
  if (removedSpeaker && state.query && state.query.toLowerCase() === removedSpeaker.toLowerCase()) {
    state.query = '';
    state.activeSpeaker = '';
    const input = document.getElementById('search-input');
    if (input) input.value = '';
    closeDropdown();
  }
  updateClearBtn(); syncUrl(); render();
}

function removeCategoryFilter(cat) {
  const target = normalizeFilterValue(cat);
  for (const currentCategory of [...state.categories]) {
    if (normalizeFilterValue(currentCategory) === target) {
      state.categories.delete(currentCategory);
    }
  }
  document.querySelectorAll('.filter-chip[data-type="category"]').forEach((chip) => {
    if (normalizeFilterValue(chip.dataset.value) === target) {
      chip.classList.remove('active');
      chip.setAttribute('aria-checked', 'false');
    }
  });
  updateClearBtn(); syncUrl(); render();
}

function removeYearFilter(year) {
  const target = normalizeFilterValue(year);
  for (const currentYear of [...state.years]) {
    if (normalizeFilterValue(currentYear) === target) {
      state.years.delete(currentYear);
    }
  }
  document.querySelectorAll('.filter-chip[data-type="year"]').forEach((chip) => {
    if (normalizeFilterValue(chip.dataset.value) === target) {
      chip.classList.remove('active');
      chip.setAttribute('aria-checked', 'false');
    }
  });
  yearFilterTouched = true;
  if (state.meeting) {
    const selectedMeeting = meetingOptions.find((item) => item.slug === state.meeting);
    if (!selectedMeeting || (state.years.size > 0 && !state.years.has(selectedMeeting.year))) {
      state.meeting = '';
      state.meetingName = '';
    }
  }
  renderMeetingFilterOptions();
  updateClearBtn(); syncUrl(); render();
}

function removeVideoFilter() {
  state.hasVideo = false;
  const btn = document.getElementById('filter-video');
  if (btn) { btn.classList.remove('active'); btn.setAttribute('aria-checked', 'false'); }
  updateClearBtn(); syncUrl(); render();
}

function removeSlidesFilter() {
  state.hasSlides = false;
  const btn = document.getElementById('filter-slides');
  if (btn) { btn.classList.remove('active'); btn.setAttribute('aria-checked', 'false'); }
  updateClearBtn(); syncUrl(); render();
}

// ============================================================
// Main Render
// ============================================================

function render() {
  const results = filterAndSort();
  renderCards(results);
  renderResultCount(results.length);
  renderActiveFilters();
  updateHeroSubtitle();
  updateClearBtn();
}

// ============================================================
// Wire up search input
// ============================================================

function updateClearBtn() {
  const hasActivity = state.query.length > 0 || state.meeting || state.speaker ||
    state.categories.size > 0 || state.years.size > 0 ||
    state.hasVideo || state.hasSlides;
  const clearBtn = document.getElementById('clear-filters');
  if (clearBtn) clearBtn.classList.toggle('hidden', !hasActivity);
  document.getElementById('search-clear').classList.toggle('visible', state.query.length > 0);
}

// ============================================================
// Search Autocomplete
// ============================================================

let autocompleteIndex = { tags: [], speakers: [] };
let dropdownActiveIdx = -1;

function buildAutocompleteIndex() {
  // Tags with counts (already computed in initFilters, but rebuild here independently)
  const tagCounts = {};
  for (const t of allTalks) {
    for (const tag of (t.tags || [])) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
  }
  autocompleteIndex.tags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({ label: tag, count }));

  // Unique speaker names with talk counts
  const speakerCounts = {};
  for (const t of allTalks) {
    for (const s of (t.speakers || [])) {
      if (s.name) speakerCounts[s.name] = (speakerCounts[s.name] || 0) + 1;
    }
  }
  autocompleteIndex.speakers = Object.entries(speakerCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ label: name, count }));
}

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escapeHtml(text).replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
}

function renderDropdown(query) {
  const dropdown = document.getElementById('search-dropdown');
  if (!query || query.length < 1) {
    dropdown.classList.add('hidden');
    dropdownActiveIdx = -1;
    return;
  }

  const q = query.toLowerCase();

  const matchedTags = autocompleteIndex.tags
    .filter(t => t.label.toLowerCase().includes(q))
    .slice(0, 6);

  const matchedSpeakers = autocompleteIndex.speakers
    .filter(s => s.label.toLowerCase().includes(q))
    .slice(0, 5);

  if (matchedTags.length === 0 && matchedSpeakers.length === 0) {
    dropdown.classList.add('hidden');
    dropdownActiveIdx = -1;
    return;
  }

  const tagIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`;
  const speakerIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

  let html = '';

  if (matchedTags.length > 0) {
    html += `<div class="search-dropdown-section">
      <div class="search-dropdown-label" aria-hidden="true">Topics</div>
      ${matchedTags.map((t, i) => `
        <button class="search-dropdown-item" role="option" aria-selected="false"
                data-autocomplete-type="tag" data-autocomplete-value="${escapeHtml(t.label)}">
          <span class="search-dropdown-item-icon">${tagIcon}</span>
          <span class="search-dropdown-item-label">${highlightMatch(t.label, query)}</span>
          <span class="search-dropdown-item-count">${t.count.toLocaleString()}</span>
        </button>`).join('')}
    </div>`;
  }

  if (matchedSpeakers.length > 0) {
    if (matchedTags.length > 0) html += `<div class="search-dropdown-divider"></div>`;
    html += `<div class="search-dropdown-section">
      <div class="search-dropdown-label" aria-hidden="true">Speakers</div>
      ${matchedSpeakers.map((s, i) => `
        <button class="search-dropdown-item" role="option" aria-selected="false"
                data-autocomplete-type="speaker" data-autocomplete-value="${escapeHtml(s.label)}">
          <span class="search-dropdown-item-icon">${speakerIcon}</span>
          <span class="search-dropdown-item-label">${highlightMatch(s.label, query)}</span>
          <span class="search-dropdown-item-count">${s.count.toLocaleString()} talk${s.count !== 1 ? 's' : ''}</span>
        </button>`).join('')}
    </div>`;
  }

  dropdown.innerHTML = html;
  dropdown.classList.remove('hidden');
  dropdownActiveIdx = -1;

  // Wire up item clicks
  dropdown.querySelectorAll('.search-dropdown-item').forEach(item => {
    item.addEventListener('mousedown', e => {
      e.preventDefault(); // prevent blur before click
      selectAutocompleteItem(item);
    });
  });
}

function selectAutocompleteItem(item) {
  const value = item.dataset.autocompleteValue;
  const type  = item.dataset.autocompleteType; // 'speaker' | 'tag'
  const input = document.getElementById('search-input');
  applyAutocompleteSelection(type, value, 'search');
  input.focus();
}

function closeDropdown() {
  document.getElementById('search-dropdown').classList.add('hidden');
  dropdownActiveIdx = -1;
}

function navigateDropdown(direction) {
  const dropdown = document.getElementById('search-dropdown');
  if (dropdown.classList.contains('hidden')) return false;
  const items = Array.from(dropdown.querySelectorAll('.search-dropdown-item'));
  if (items.length === 0) return false;

  // Clear previous
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

function initSearch() {
  const input = document.getElementById('search-input');
  const clearBtn = document.getElementById('search-clear');

  buildAutocompleteIndex();

  input.addEventListener('input', () => {
    const rawValue = input.value;
    // Typing a new query clears any active speaker/tag autocomplete context
    if (rawValue.trim() !== state.activeSpeaker) state.activeSpeaker = '';
    if (rawValue.trim() !== state.activeTag) {
      state.activeTag = '';
      syncTopicChipState();
    }
    // Typing also clears the exact-speaker filter so the two don't silently AND together
    if (rawValue.trim() && state.speaker) state.speaker = '';
    renderDropdown(rawValue.trim());
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      state.query = rawValue.trim();
      updateClearBtn();
      syncUrl();
      render();
    }, 150);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigateDropdown(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateDropdown(-1);
    } else if (e.key === 'Enter') {
      const dropdown = document.getElementById('search-dropdown');
      if (!dropdown.classList.contains('hidden') && dropdownActiveIdx >= 0) {
        e.preventDefault();
        const items = dropdown.querySelectorAll('.search-dropdown-item');
        if (items[dropdownActiveIdx]) selectAutocompleteItem(items[dropdownActiveIdx]);
      }
    } else if (e.key === 'Escape') {
      if (!document.getElementById('search-dropdown').classList.contains('hidden')) {
        closeDropdown();
      } else {
        input.blur();
      }
    }
  });

  input.addEventListener('blur', () => {
    // Delay close so mousedown click can fire first
    setTimeout(closeDropdown, 150);
  });

  clearBtn.addEventListener('click', () => {
    clearQuery();
    input.focus();
  });

  // Keyboard shortcut: / to focus search
  document.addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement !== input) {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
}

// ============================================================
// Save state before navigating to talk detail
// ============================================================

function initCardNavigation() {
  document.getElementById('talks-grid').addEventListener('click', e => {
    const cardLink = e.target.closest('a.card-link-wrap');
    if (cardLink && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      saveNavigationState();
    }
  });
}

// ============================================================
// filterBySpeaker — called from speaker name buttons on cards
// ============================================================

function filterBySpeaker(name) {
  applyAutocompleteSelection('speaker', name, 'search');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ============================================================
// filterByTag — called from card tag buttons
// ============================================================

function filterByTag(tag) {
  applyAutocompleteSelection('tag', tag, 'search');
  // Scroll to top to show filtered results
  window.scrollTo({ top: 0, behavior: 'smooth' });
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

  // View mode
  const savedView = localStorage.getItem('llvm-hub-view') || 'grid';
  setViewMode(savedView);
  document.getElementById('view-grid').addEventListener('click', () => setViewMode('grid'));
  document.getElementById('view-list').addEventListener('click', () => setViewMode('list'));

  // Load data
  const ok = await loadData();
  if (!ok) return;

  buildSearchIndex();
  updateHeroCount();
  initFilters();
  initFilterAccordions();
  initFilterSidebarCollapse();
  initSearch();

  // URL params take priority over saved sessionStorage state.
  // sessionStorage is only for back-button from a talk detail page to a bare index.html.
  const urlParams = new URLSearchParams(window.location.search);
  const hasUrlState = urlParams.has('speaker') || urlParams.has('q') || urlParams.has('tag') ||
    urlParams.has('meeting') || urlParams.has('category') || urlParams.has('year') ||
    urlParams.has('video') || urlParams.has('slides');

  const hasBackState = sessionStorage.getItem('llvm-hub-search-state');

  if (hasBackState && !hasUrlState) {
    // Back-button from talk detail: restore saved search state
    restoreNavigationState();
  } else {
    // Direct navigation or speaker/tag/meeting link: honour URL params
    if (hasBackState) sessionStorage.removeItem('llvm-hub-search-state');
    loadStateFromUrl();
    applyUrlFilters();
    render();
  }

  initCardNavigation();
}

init();

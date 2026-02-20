/**
 * library-utils.js — Shared pure helpers used across pages.
 */

(function (root) {
  const CATEGORY_ORDER = {
    'keynote': 0,
    'technical-talk': 1,
    'tutorial': 2,
    'panel': 3,
    'quick-talk': 4,
    'lightning-talk': 5,
    'student-talk': 6,
    'bof': 7,
    'poster': 8,
    'workshop': 9,
    'other': 10,
  };

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim() !== '';
  }

  function isYouTubeVideoId(value) {
    return /^[A-Za-z0-9_-]{11}$/.test(value || '');
  }

  function extractYouTubeId(videoUrl) {
    if (!videoUrl || typeof videoUrl !== 'string') return null;

    try {
      const url = new URL(videoUrl);
      const host = url.hostname.toLowerCase().replace(/^www\./, '');

      let candidate = null;
      if (host === 'youtu.be') {
        candidate = url.pathname.split('/').filter(Boolean)[0] || null;
      } else if (host.endsWith('youtube.com')) {
        if (url.pathname === '/watch') {
          candidate = url.searchParams.get('v');
        } else {
          const parts = url.pathname.split('/').filter(Boolean);
          if (parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live' || parts[0] === 'v') {
            candidate = parts[1] || null;
          }
        }
        if (!candidate) candidate = url.searchParams.get('vi');
      }

      return isYouTubeVideoId(candidate) ? candidate : null;
    } catch {
      return null;
    }
  }

  function normalizeTalkRecord(talk) {
    if (!talk || typeof talk !== 'object') return talk;

    const normalized = { ...talk };
    const explicitVideoId = isYouTubeVideoId(normalized.videoId) ? normalized.videoId : null;
    const derivedVideoId = explicitVideoId || extractYouTubeId(normalized.videoUrl);

    normalized.videoId = derivedVideoId;
    if (!normalized.videoUrl && derivedVideoId) {
      normalized.videoUrl = `https://youtu.be/${derivedVideoId}`;
    }
    return normalized;
  }

  function normalizeTalks(rawTalks) {
    return Array.isArray(rawTalks) ? rawTalks.map(normalizeTalkRecord) : [];
  }

  function parseCsvParam(value) {
    if (!isNonEmptyString(value)) return [];
    return value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function parseQueryString(search) {
    const query = String(search || '').replace(/^\?/, '');
    if (!query) return {};

    const out = {};
    for (const pair of query.split('&')) {
      if (!pair) continue;
      const parts = pair.split('=');
      const key = decodeURIComponent(parts[0] || '').trim();
      if (!key) continue;
      const encodedValue = parts.slice(1).join('=');
      const decodedValue = decodeURIComponent(encodedValue.replace(/\+/g, ' '));
      out[key] = decodedValue;
    }
    return out;
  }

  const MONTH_LOOKUP = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12,
  };

  const MONTH_NAME_BY_INDEX = {
    1: 'January',
    2: 'February',
    3: 'March',
    4: 'April',
    5: 'May',
    6: 'June',
    7: 'July',
    8: 'August',
    9: 'September',
    10: 'October',
    11: 'November',
    12: 'December',
  };

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function toIsoDate(year, month, day) {
    return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
  }

  function parseDayToken(rawDay) {
    const day = parseInt(String(rawDay || '').toLowerCase().replace(/(st|nd|rd|th)$/i, ''), 10);
    if (!Number.isFinite(day) || day < 1 || day > 31) return null;
    return day;
  }

  function parseMeetingDateRange(rawDate) {
    if (!isNonEmptyString(rawDate)) return null;

    const normalized = String(rawDate)
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\s*,\s*/g, ', ')
      .replace(/\s*\/\s*/g, '/')
      .replace(/\s*-\s*/g, '-');

    const match = normalized.match(/^([A-Za-z]+)\s+(\d{1,2}(?:st|nd|rd|th)?)(?:\s*(?:-|\/|to)\s*(\d{1,2}(?:st|nd|rd|th)?))?,?\s*(\d{4})$/i);
    if (!match) return null;

    const monthToken = String(match[1] || '').toLowerCase();
    const month = MONTH_LOOKUP[monthToken];
    const startDay = parseDayToken(match[2]);
    const endDay = parseDayToken(match[3] || match[2]);
    const year = parseInt(match[4], 10);

    if (!month || !startDay || !endDay || !Number.isFinite(year)) return null;

    return {
      month,
      monthName: MONTH_NAME_BY_INDEX[month],
      year,
      startDay,
      endDay,
      start: toIsoDate(year, month, startDay),
      end: toIsoDate(year, month, endDay),
    };
  }

  function formatMeetingDateUniversal(rawDate) {
    if (!isNonEmptyString(rawDate)) return '';
    const parsed = parseMeetingDateRange(rawDate);
    if (!parsed) return String(rawDate).trim();
    if (parsed.startDay === parsed.endDay) {
      return `${parsed.monthName} ${parsed.startDay}, ${parsed.year}`;
    }
    return `${parsed.monthName} ${parsed.startDay}-${parsed.endDay}, ${parsed.year}`;
  }

  function tokenizeQuery(query) {
    const tokens = [];
    const re = /"([^"]+)"|(\S+)/g;
    let match;
    while ((match = re.exec(String(query || ''))) !== null) {
      const token = (match[1] || match[2] || '').toLowerCase().trim();
      if (token.length >= 2) tokens.push(token);
    }
    return tokens;
  }

  function scoreMatch(indexedTalk, tokens) {
    if (!tokens.length) return 0;
    let totalScore = 0;

    for (const token of tokens) {
      let tokenScore = 0;

      const title = String(indexedTalk._titleLower || '');
      const speakers = String(indexedTalk._speakerLower || '');
      const abstract = String(indexedTalk._abstractLower || '');
      const tags = String(indexedTalk._tagsLower || '');
      const meeting = String(indexedTalk._meetingLower || '');
      const category = String(indexedTalk.category || '');

      const titleIdx = title.indexOf(token);
      if (titleIdx !== -1) tokenScore += titleIdx === 0 ? 100 : 50;
      if (speakers.indexOf(token) !== -1) tokenScore += 30;
      if (abstract.includes(token)) tokenScore += 10;
      if (tags.includes(token)) tokenScore += 15;
      if (meeting.includes(token)) tokenScore += 5;
      if (category.includes(token)) tokenScore += 5;

      if (tokenScore === 0) return 0; // AND semantics
      totalScore += tokenScore;
    }

    const year = parseInt(indexedTalk._year || '2007', 10);
    const safeYear = Number.isNaN(year) ? 2007 : year;
    totalScore += (safeYear - 2007) * 0.1;
    return totalScore;
  }

  function compareRankedEntries(a, b) {
    const scoreDiff = (b.score || 0) - (a.score || 0);
    if (scoreDiff !== 0) return scoreDiff;

    const aMeeting = String((a.talk && a.talk.meeting) || '');
    const bMeeting = String((b.talk && b.talk.meeting) || '');
    const meetingDiff = bMeeting.localeCompare(aMeeting);
    if (meetingDiff !== 0) return meetingDiff;

    const aId = String((a.talk && a.talk.id) || '');
    const bId = String((b.talk && b.talk.id) || '');
    const idDiff = aId.localeCompare(bId);
    if (idDiff !== 0) return idDiff;

    const aTitle = String((a.talk && a.talk.title) || '');
    const bTitle = String((b.talk && b.talk.title) || '');
    return aTitle.localeCompare(bTitle);
  }

  function rankTalksByQuery(indexedTalks, query) {
    const talks = Array.isArray(indexedTalks) ? indexedTalks : [];
    const tokens = tokenizeQuery(query);

    if (!tokens.length) {
      return [...talks].sort((a, b) => String(b.meeting || '').localeCompare(String(a.meeting || '')));
    }

    const scored = [];
    for (const talk of talks) {
      const score = scoreMatch(talk, tokens);
      if (score > 0) scored.push({ talk, score });
    }
    scored.sort(compareRankedEntries);
    return scored.map((entry) => entry.talk);
  }

  function parseUrlState(search, talks) {
    const params = parseQueryString(search);
    const meeting = isNonEmptyString(params.meeting) ? params.meeting.trim() : '';
    let meetingName = '';
    if (meeting) {
      const sample = Array.isArray(talks)
        ? talks.find((talk) => talk && talk.meeting === meeting && isNonEmptyString(talk.meetingName))
        : null;
      meetingName = sample ? sample.meetingName : meeting;
    }

    return {
      query: isNonEmptyString(params.q) ? params.q.trim() : '',
      speaker: isNonEmptyString(params.speaker) ? params.speaker.trim() : '',
      meeting,
      meetingName,
      categories: parseCsvParam(params.category),
      years: parseCsvParam(params.year),
      tags: parseCsvParam(params.tag),
      hasVideo: params.video === '1' || params.video === 'true',
      hasSlides: params.slides === '1' || params.slides === 'true',
    };
  }

  function parseNavigationState(rawJson) {
    if (!isNonEmptyString(rawJson)) return null;
    let parsed;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;

    const scroll = Number(parsed.scrollY);
    return {
      query: isNonEmptyString(parsed.query) ? parsed.query : '',
      speaker: isNonEmptyString(parsed.speaker) ? parsed.speaker : '',
      categories: Array.isArray(parsed.categories) ? parsed.categories.filter(isNonEmptyString) : [],
      years: Array.isArray(parsed.years) ? parsed.years.filter(isNonEmptyString) : [],
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter(isNonEmptyString) : [],
      hasVideo: parsed.hasVideo === true,
      hasSlides: parsed.hasSlides === true,
      scrollY: Number.isFinite(scroll) && scroll > 0 ? scroll : 0,
    };
  }

  function resolveCategoryMeta(category, categoryMeta) {
    const source = categoryMeta || {};
    if (source[category]) return source[category];
    return { label: category, order: CATEGORY_ORDER[category] ?? 99 };
  }

  function sortCategoryEntries(catCounts, categoryMeta) {
    return Object.entries(catCounts || {}).sort((a, b) => {
      const aMeta = resolveCategoryMeta(a[0], categoryMeta);
      const bMeta = resolveCategoryMeta(b[0], categoryMeta);
      const orderDiff = (aMeta.order ?? 99) - (bMeta.order ?? 99);
      if (orderDiff !== 0) return orderDiff;

      const labelA = String(aMeta.label || a[0]);
      const labelB = String(bMeta.label || b[0]);
      return labelA.localeCompare(labelB);
    });
  }

  const api = {
    CATEGORY_ORDER,
    compareRankedEntries,
    extractYouTubeId,
    formatMeetingDateUniversal,
    isYouTubeVideoId,
    normalizeTalkRecord,
    normalizeTalks,
    parseMeetingDateRange,
    parseNavigationState,
    parseUrlState,
    rankTalksByQuery,
    scoreMatch,
    sortCategoryEntries,
    tokenizeQuery,
  };

  root.LLVMHubUtils = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);

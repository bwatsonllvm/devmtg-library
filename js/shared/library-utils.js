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
    'llvm-foundation': 7,
    'bof': 8,
    'poster': 9,
    'workshop': 10,
    'other': 11,
  };
  const KNOWN_TALK_CATEGORIES = new Set(Object.keys(CATEGORY_ORDER));
  const TALK_CATEGORY_ALIAS_MAP = {
    keynote: 'keynote',
    keynotes: 'keynote',
    'key-note': 'keynote',

    'technical-talk': 'technical-talk',
    'technical-talks': 'technical-talk',
    technical: 'technical-talk',
    'technical-session': 'technical-talk',
    'technical-sessions': 'technical-talk',
    'tech-talk': 'technical-talk',
    'tech-talks': 'technical-talk',

    tutorial: 'tutorial',
    tutorials: 'tutorial',

    panel: 'panel',
    panels: 'panel',

    'quick-talk': 'quick-talk',
    'quick-talks': 'quick-talk',
    quick: 'quick-talk',

    'lightning-talk': 'lightning-talk',
    'lightning-talks': 'lightning-talk',
    lightning: 'lightning-talk',

    'student-talk': 'student-talk',
    'student-talks': 'student-talk',
    'student-technical-talk': 'student-talk',
    'student-technical-talks': 'student-talk',
    'student-technical': 'student-talk',
    'student-talk-session': 'student-talk',
    'student-talk-sessions': 'student-talk',

    'llvm-foundation': 'llvm-foundation',
    foundation: 'llvm-foundation',
    'foundation-update': 'llvm-foundation',
    'foundation-updates': 'llvm-foundation',
    'llvm-foundation-update': 'llvm-foundation',
    'llvm-foundation-updates': 'llvm-foundation',

    bof: 'bof',
    'birds-of-feather': 'bof',
    'birds-of-a-feather': 'bof',
    'birds-feather': 'bof',
    'birds-a-feather': 'bof',
    'round-table': 'bof',
    'round-tables': 'bof',

    poster: 'poster',
    posters: 'poster',

    workshop: 'workshop',
    workshops: 'workshop',

    other: 'other',
  };
  const BLOG_SOURCE_SLUGS = new Set(['llvm-blog-www', 'llvm-www-blog']);

  function normalizeCategoryKey(value) {
    return String(value || '')
      .toLowerCase()
      .trim()
      .replace(/&/g, ' and ')
      .replace(/\+/g, ' plus ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function normalizeTalkCategory(value) {
    const key = normalizeCategoryKey(value);
    if (!key) return 'other';

    const aliasMatch = TALK_CATEGORY_ALIAS_MAP[key];
    if (aliasMatch) return aliasMatch;
    if (KNOWN_TALK_CATEGORIES.has(key)) return key;
    return 'other';
  }

  function normalizeTalkCategoryList(values) {
    if (!Array.isArray(values)) return [];
    const out = [];
    const seen = new Set();
    for (const value of values) {
      const normalized = normalizeTalkCategory(value);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
    return out;
  }

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

  const SPEAKER_AFFILIATION_HINT_RE = /\b(university|college|institute|laboratory|lab|labs|research|center|centre|foundation|inc\.?|corp\.?|corporation|company|ltd\.?|llc|gmbh|technologies|technology|systems|intel|apple|google|microsoft|meta|facebook|amazon|ibm|amd|nvidia|arm|qualcomm|oracle|xilinx|broadcom|moderator)\b/i;

  function collapseWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function looksLikeAffiliationLabel(value) {
    const text = collapseWhitespace(value);
    if (!text) return false;
    if (SPEAKER_AFFILIATION_HINT_RE.test(text)) return true;
    if (/[\/&]/.test(text)) return true;
    if (/^[A-Z]{2,}(?:\s+[A-Za-z][\w.-]*)*$/.test(text)) return true;
    return false;
  }

  function splitSpeakerName(rawName) {
    const input = collapseWhitespace(rawName);
    if (!input) return { name: '', affiliation: '' };

    let name = input;
    let extractedAffiliation = '';

    const parenMatch = name.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    if (parenMatch && looksLikeAffiliationLabel(parenMatch[2])) {
      name = collapseWhitespace(parenMatch[1]);
      extractedAffiliation = collapseWhitespace(parenMatch[2]);
    }

    if (!extractedAffiliation) {
      const dashMatch = name.match(/^(.*?)\s+-\s+(.+)$/);
      if (dashMatch && looksLikeAffiliationLabel(dashMatch[2])) {
        name = collapseWhitespace(dashMatch[1]);
        extractedAffiliation = collapseWhitespace(dashMatch[2]);
      }
    }

    if (!extractedAffiliation) {
      const commaMatch = name.match(/^(.*?),\s+(.+)$/);
      if (commaMatch && looksLikeAffiliationLabel(commaMatch[2])) {
        name = collapseWhitespace(commaMatch[1]);
        extractedAffiliation = collapseWhitespace(commaMatch[2]);
      }
    }

    return {
      name: name || input,
      affiliation: extractedAffiliation,
    };
  }

  function stripDiacritics(value) {
    const text = String(value || '');
    if (!text) return '';
    return text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  }

  function normalizePersonDisplayName(value) {
    let text = collapseWhitespace(value);
    if (!text) return '';

    // Handle "Last, First" as "First Last" when comma appears once.
    const commaMatch = text.match(/^([^,]+),\s*(.+)$/);
    if (commaMatch) {
      const left = collapseWhitespace(commaMatch[1]);
      const right = collapseWhitespace(commaMatch[2]);
      if (left && right) text = `${right} ${left}`;
    }

    text = text
      .replace(/\s+([.,;:])/g, '$1')
      .replace(/\s*-\s*/g, '-')
      .replace(/\s*&\s*$/g, '')
      .replace(/[;,:-]+$/g, '')
      .replace(/\s{2,}/g, ' ');

    return text.trim();
  }

  function normalizeAffiliation(value) {
    let text = collapseWhitespace(value);
    if (!text) return '';

    const lower = text.toLowerCase();
    if (lower === 'none' || lower === 'null' || lower === 'n/a' || lower === 'na' || lower === 'unknown') {
      return '';
    }

    text = text
      .replace(/\bUniv\.\b/gi, 'University')
      .replace(/\bUniv\b/gi, 'University')
      .replace(/\bInst\.\b/gi, 'Institute')
      .replace(/\bInst\b/gi, 'Institute')
      .replace(/\bDept\.\b/gi, 'Department')
      .replace(/\bDept\b/gi, 'Department')
      .replace(/\bLab\.\b/gi, 'Lab')
      .replace(/\s*&\s*/g, ' & ')
      .replace(/\s+,/g, ',')
      .replace(/\(\s*United States\s*\)$/i, '')
      .replace(/\(\s*USA\s*\)$/i, '')
      .replace(/\(\s*United Kingdom\s*\)$/i, '')
      .replace(/\(\s*UK\s*\)$/i, '');

    return collapseWhitespace(text);
  }

  function normalizePersonName(value) {
    const parsed = splitSpeakerName(value);
    return normalizePersonDisplayName(parsed.name || value);
  }

  function normalizePersonRecord(rawPerson) {
    const person = (rawPerson && typeof rawPerson === 'object')
      ? { ...rawPerson }
      : { name: String(rawPerson || '') };

    const parsed = splitSpeakerName(person.name);
    const explicitName = normalizePersonDisplayName(parsed.name || person.name);
    const explicitAffiliation = normalizeAffiliation(person.affiliation);
    const parsedAffiliation = normalizeAffiliation(parsed.affiliation);

    person.name = explicitName;
    person.affiliation = explicitAffiliation || parsedAffiliation;
    return person;
  }

  function tokenizePersonName(value) {
    return stripDiacritics(String(value || '').toLowerCase())
      .replace(/[^a-z0-9' -]+/g, ' ')
      .split(/[\s-]+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function normalizePersonKey(value) {
    return tokenizePersonName(value).join('');
  }

  function normalizeAffiliationKey(value) {
    return stripDiacritics(normalizeAffiliation(value).toLowerCase())
      .replace(/[^a-z0-9]+/g, '');
  }

  function buildPersonSignature(value) {
    const tokens = tokenizePersonName(value);
    if (!tokens.length) {
      return {
        first: '',
        last: '',
        middleInitials: '',
        baseKey: '',
        exactKey: '',
      };
    }

    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    const middleInitials = tokens.slice(1, -1).map((token) => token[0] || '').join('');

    return {
      first,
      last,
      middleInitials,
      baseKey: `${first}|${last}`,
      exactKey: tokens.join('|'),
    };
  }

  function arePersonMiddleVariants(nameA, nameB) {
    const a = buildPersonSignature(nameA);
    const b = buildPersonSignature(nameB);
    if (!a.baseKey || !b.baseKey) return false;
    if (a.baseKey !== b.baseKey) return false;
    if (a.exactKey === b.exactKey) return true;

    const miA = a.middleInitials;
    const miB = b.middleInitials;
    if (!miA || !miB) return true;
    if (miA === miB) return true;
    return miA.startsWith(miB) || miB.startsWith(miA);
  }

  function chooseBestDisplayName(nameCounts) {
    const entries = [...nameCounts.entries()];
    if (!entries.length) return '';

    const scoreName = (name, count) => {
      const signature = buildPersonSignature(name);
      const middlePenalty = signature.middleInitials.length;
      const initialPenalty = /\b[A-Z]\.?(\s|$)/.test(name) ? 0.8 : 0;
      const lengthPenalty = Math.max(0, name.length - 40) * 0.02;
      return (count * 100) - (middlePenalty * 2) - initialPenalty - lengthPenalty;
    };

    entries.sort((a, b) => {
      const scoreDiff = scoreName(b[0], b[1]) - scoreName(a[0], a[1]);
      if (scoreDiff !== 0) return scoreDiff;
      return a[0].localeCompare(b[0]);
    });

    return entries[0][0];
  }

  function mergePeopleBuckets(target, source) {
    target.talkCount += source.talkCount;
    target.paperCount += source.paperCount;
    target.blogCount += source.blogCount;
    target.citationCount += source.citationCount;

    for (const [name, count] of source.nameCounts.entries()) {
      target.nameCounts.set(name, (target.nameCounts.get(name) || 0) + count);
    }
    for (const [aff, count] of source.affiliationCounts.entries()) {
      target.affiliationCounts.set(aff, (target.affiliationCounts.get(aff) || 0) + count);
    }
    for (const [name, count] of source.talkNameCounts.entries()) {
      target.talkNameCounts.set(name, (target.talkNameCounts.get(name) || 0) + count);
    }
    for (const [name, count] of source.paperNameCounts.entries()) {
      target.paperNameCounts.set(name, (target.paperNameCounts.get(name) || 0) + count);
    }
    for (const [name, count] of source.blogNameCounts.entries()) {
      target.blogNameCounts.set(name, (target.blogNameCounts.get(name) || 0) + count);
    }
  }

  function shouldMergePeopleBuckets(a, b) {
    const nameA = chooseBestDisplayName(a.nameCounts);
    const nameB = chooseBestDisplayName(b.nameCounts);
    if (!nameA || !nameB) return false;
    if (!arePersonMiddleVariants(nameA, nameB)) return false;

    const affKeysA = new Set(
      [...a.affiliationCounts.keys()]
        .map((aff) => normalizeAffiliationKey(aff))
        .filter(Boolean)
    );
    const affKeysB = new Set(
      [...b.affiliationCounts.keys()]
        .map((aff) => normalizeAffiliationKey(aff))
        .filter(Boolean)
    );

    if (affKeysA.size && affKeysB.size) {
      for (const key of affKeysA) {
        if (affKeysB.has(key)) return true;
      }
      return false;
    }

    // If only one side has affiliation data, allow merge for middle-initial variants.
    if ((affKeysA.size === 0) !== (affKeysB.size === 0)) return true;
    return false;
  }

  function parsePaperCitationCount(paper) {
    if (!paper || typeof paper !== 'object') return 0;
    const raw = paper._citationCount ?? paper.citationCount;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.round(numeric);
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

  function buildPeopleIndex(talks, papers) {
    const buckets = new Map();

    const ensureBucketByName = (name) => {
      const key = normalizePersonKey(name);
      if (!key) return null;
      if (!buckets.has(key)) {
        const signature = buildPersonSignature(name);
        buckets.set(key, {
          signature,
          talkCount: 0,
          paperCount: 0,
          blogCount: 0,
          citationCount: 0,
          nameCounts: new Map(),
          affiliationCounts: new Map(),
          talkNameCounts: new Map(),
          paperNameCounts: new Map(),
          blogNameCounts: new Map(),
        });
      }
      return buckets.get(key);
    };

    for (const talk of (Array.isArray(talks) ? talks : [])) {
      for (const rawSpeaker of (talk.speakers || [])) {
        const speaker = normalizePersonRecord(rawSpeaker);
        if (!speaker.name) continue;
        const bucket = ensureBucketByName(speaker.name);
        if (!bucket) continue;
        bucket.talkCount += 1;
        bucket.nameCounts.set(speaker.name, (bucket.nameCounts.get(speaker.name) || 0) + 1);
        bucket.talkNameCounts.set(speaker.name, (bucket.talkNameCounts.get(speaker.name) || 0) + 1);
        if (speaker.affiliation) {
          bucket.affiliationCounts.set(
            speaker.affiliation,
            (bucket.affiliationCounts.get(speaker.affiliation) || 0) + 1
          );
        }
      }
    }

    for (const paper of (Array.isArray(papers) ? papers : [])) {
      const paperCitationCount = parsePaperCitationCount(paper);
      const isBlog = isBlogPaperRecord(paper);
      for (const rawAuthor of (paper.authors || [])) {
        const author = normalizePersonRecord(rawAuthor);
        if (!author.name) continue;
        const bucket = ensureBucketByName(author.name);
        if (!bucket) continue;
        if (isBlog) bucket.blogCount += 1;
        else bucket.paperCount += 1;
        bucket.citationCount += paperCitationCount;
        bucket.nameCounts.set(author.name, (bucket.nameCounts.get(author.name) || 0) + 1);
        if (isBlog) {
          bucket.blogNameCounts.set(author.name, (bucket.blogNameCounts.get(author.name) || 0) + 1);
        } else {
          bucket.paperNameCounts.set(author.name, (bucket.paperNameCounts.get(author.name) || 0) + 1);
        }
        if (author.affiliation) {
          bucket.affiliationCounts.set(
            author.affiliation,
            (bucket.affiliationCounts.get(author.affiliation) || 0) + 1
          );
        }
      }
    }

    const groupedByBaseKey = new Map();
    const ungroupedBuckets = [];
    for (const bucket of buckets.values()) {
      const baseKey = bucket.signature.baseKey;
      if (!baseKey) {
        ungroupedBuckets.push(bucket);
        continue;
      }
      if (!groupedByBaseKey.has(baseKey)) groupedByBaseKey.set(baseKey, []);
      groupedByBaseKey.get(baseKey).push(bucket);
    }

    for (const group of groupedByBaseKey.values()) {
      if (!group || group.length < 2) continue;
      let merged = true;
      while (merged) {
        merged = false;
        for (let i = 0; i < group.length; i += 1) {
          for (let j = i + 1; j < group.length; j += 1) {
            const a = group[i];
            const b = group[j];
            if (!a || !b) continue;
            if (!shouldMergePeopleBuckets(a, b)) continue;
            mergePeopleBuckets(a, b);
            group.splice(j, 1);
            merged = true;
            break;
          }
          if (merged) break;
        }
      }
    }

    const mergedBuckets = [...ungroupedBuckets];
    for (const group of groupedByBaseKey.values()) {
      mergedBuckets.push(...group);
    }

    const people = mergedBuckets
      .map((bucket) => {
        const displayName = chooseBestDisplayName(bucket.nameCounts);
        const seenVariantKeys = new Set();
        const variantNames = [...bucket.nameCounts.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([name]) => name)
          .filter((name) => {
            const key = normalizePersonKey(name);
            if (!key || seenVariantKeys.has(key)) return false;
            seenVariantKeys.add(key);
            return true;
          });

        const talkFilterName = chooseBestDisplayName(bucket.talkNameCounts) || displayName;
        const paperFilterName = chooseBestDisplayName(bucket.paperNameCounts) || displayName;
        const blogFilterName = chooseBestDisplayName(bucket.blogNameCounts) || displayName;

        return {
          id: normalizePersonKey(displayName) || normalizePersonKey(variantNames[0] || ''),
          name: displayName || variantNames[0] || '',
          talkFilterName: talkFilterName || '',
          paperFilterName: paperFilterName || '',
          blogFilterName: blogFilterName || '',
          variantNames,
          talkCount: bucket.talkCount,
          paperCount: bucket.paperCount,
          blogCount: bucket.blogCount,
          citationCount: bucket.citationCount || 0,
          totalCount: bucket.talkCount + bucket.paperCount + bucket.blogCount,
        };
      })
      .filter((person) => person.name)
      .sort((a, b) => b.totalCount - a.totalCount || a.name.localeCompare(b.name));

    return people;
  }

  function normalizeSpeakerName(value) {
    return normalizePersonName(value);
  }

  function normalizeSpeakerRecord(rawSpeaker) {
    return normalizePersonRecord(rawSpeaker);
  }

  function looksLikeStudentTalkFromMetadata(talk) {
    if (!talk || typeof talk !== 'object') return false;
    const title = String(talk.title || '').toLowerCase();
    if (/\bstudent(?:\s+technical)?\s+talks?\b/.test(title)) return true;

    const slidesUrl = String(talk.slidesUrl || '').toLowerCase();
    if (!slidesUrl) return false;
    return (
      slidesUrl.includes('/student-talks/') ||
      slidesUrl.includes('/student_talks/') ||
      slidesUrl.includes('/student-talk/') ||
      slidesUrl.includes('/student_talk/') ||
      slidesUrl.includes('/studenttalks/') ||
      slidesUrl.includes('/student_technical_talk/') ||
      slidesUrl.includes('/student-technical-talk/')
    );
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

    normalized.speakers = Array.isArray(normalized.speakers)
      ? normalized.speakers
          .map(normalizeSpeakerRecord)
          .filter((speaker) => isNonEmptyString(speaker.name))
      : [];
    let normalizedCategory = normalizeTalkCategory(normalized.category);
    if (looksLikeStudentTalkFromMetadata(normalized)) {
      normalizedCategory = 'student-talk';
    }
    normalized.category = normalizedCategory;

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

  const SEARCH_STOPWORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
    'how', 'i', 'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or',
    'that', 'the', 'their', 'this', 'to', 'was', 'what', 'when', 'where',
    'which', 'who', 'why', 'with', 'without', 'using', 'use', 'used',
    'about', 'can', 'could', 'should', 'would', 'do', 'does', 'did',
    'we', 'you', 'your', 'our', 'my', 'me', 'us',
  ]);

  const BEGINNER_INTENT_TOKENS = new Set([
    'beginner', 'beginners', 'intro', 'introduction', 'newcomer', 'newcomers',
    'starter', 'start', 'starting', 'basics', 'basic', 'learn',
  ]);
  const BEGINNER_SIGNAL_RE = /\bbeginner(?:s)?\b|\bintro(?:duction)?\b|\btutorial(?:s)?\b|\bgetting started\b|\bbasic(?:s)?\b/;
  const SEARCH_BROAD_TOKENS = new Set([
    'llvm', 'compiler', 'compilers', 'toolchain', 'project', 'projects',
    'research', 'talk', 'talks', 'paper', 'papers', 'blog', 'blogs',
    'session', 'sessions', 'meeting', 'meetings', 'developers', 'library',
  ]);

  const SEARCH_TOKEN_ALIAS_MAP = {
    llvms: 'llvm',
    clangg: 'clang',
    clangd: 'clang',
    mlirs: 'mlir',
    libomp: 'openmp',
    sanitiser: 'sanitizer',
    sanitisers: 'sanitizer',
    sanitizers: 'sanitizer',
    machinelearning: 'ml',
    deeplearning: 'ml',
    artificialintelligence: 'ai',
    webassembly: 'wasm',
    riscv: 'risc-v',
    x8664: 'x86-64',
    arm64: 'aarch64',
    cxx: 'c++',
    cpp: 'c++',
    linktime: 'lto',
    profileguided: 'pgo',
  };

  const SEARCH_TOKEN_SYNONYMS_RAW = {
    beginner: ['intro', 'tutorial', 'getting', 'started'],
    beginners: ['beginner', 'intro', 'tutorial'],
    intro: ['introduction', 'beginner', 'tutorial'],
    introduction: ['intro', 'beginner'],
    compiler: ['llvm', 'clang', 'toolchain', 'codegen'],
    compilers: ['compiler', 'llvm', 'clang'],
    clang: ['frontend', 'c++'],
    llvm: ['compiler', 'toolchain'],
    debug: ['lldb', 'debugging', 'dwarf'],
    debugger: ['lldb', 'debug'],
    debugging: ['debug', 'lldb'],
    lldb: ['debug', 'debugger'],
    linker: ['lld', 'linking'],
    linking: ['lld', 'linker'],
    lld: ['linker', 'linking'],
    optimizations: ['optimization', 'performance', 'codegen'],
    optimization: ['optimizations', 'performance'],
    optimizer: ['optimizations', 'performance'],
    optimizers: ['optimizations', 'performance'],
    optimise: ['optimizations', 'performance'],
    performance: ['optimizations', 'benchmark'],
    perf: ['performance', 'optimizations'],
    benchmark: ['performance', 'optimizations'],
    analysis: ['static', 'dynamic'],
    analyzer: ['analysis', 'static'],
    analyser: ['analysis', 'static'],
    static: ['analysis', 'analyzer'],
    dynamic: ['analysis'],
    sanitizer: ['asan', 'tsan', 'ubsan', 'security', 'compiler-rt'],
    security: ['sanitizer', 'cfi'],
    runtime: ['compiler-rt', 'sanitizer'],
    parallel: ['openmp', 'threading'],
    parallelism: ['parallel', 'openmp'],
    multithreading: ['parallel', 'openmp'],
    multithreaded: ['parallel', 'openmp'],
    openmp: ['parallel', 'threading'],
    gpu: ['cuda', 'hip', 'opencl'],
    cuda: ['gpu'],
    hip: ['gpu'],
    opencl: ['gpu'],
    ml: ['machine', 'learning', 'ai'],
    ai: ['ml', 'machine', 'learning'],
    wasm: ['webassembly'],
    webassembly: ['wasm'],
    toolchain: ['llvm', 'compiler'],
    cfi: ['security'],
    rust: ['frontend', 'backend'],
    swift: ['frontend', 'backend'],
    tutorial: ['beginner', 'intro'],
  };

  const SEARCH_TOKEN_SYNONYMS = {};
  for (const [sourceToken, rawSynonyms] of Object.entries(SEARCH_TOKEN_SYNONYMS_RAW)) {
    const source = normalizeSearchToken(sourceToken);
    if (!source) continue;
    const dedup = [];
    const seen = new Set();
    for (const candidate of rawSynonyms) {
      const normalized = normalizeSearchToken(candidate);
      if (!normalized || normalized === source || seen.has(normalized)) continue;
      seen.add(normalized);
      dedup.push(normalized);
    }
    if (dedup.length) SEARCH_TOKEN_SYNONYMS[source] = dedup;
  }

  const TALK_SEARCH_DOC_CACHE = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  const PAPER_SEARCH_DOC_CACHE = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function normalizeSearchToken(value) {
    const raw = stripDiacritics(String(value || '').toLowerCase())
      .replace(/[’']/g, '')
      .trim();
    if (!raw) return '';
    const compact = raw
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9+#.-]+/g, '')
      .replace(/^-+|-+$/g, '')
      .replace(/^\.+|\.+$/g, '');
    if (!compact) return '';
    return SEARCH_TOKEN_ALIAS_MAP[compact] || compact;
  }

  function normalizeSearchText(value) {
    return stripDiacritics(String(value || '').toLowerCase())
      .replace(/[’']/g, '')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9+#.-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokenizeSearchText(value, minLength = 2) {
    const normalized = normalizeSearchText(value);
    if (!normalized) return [];
    return normalized
      .split(/\s+/)
      .map((part) => normalizeSearchToken(part))
      .filter((part) => part && part.length >= minLength);
  }

  function parseQuerySegments(query) {
    const raw = String(query || '');
    const tokens = [];
    const phrases = [];
    const re = /"([^"]+)"|(\S+)/g;
    let match;

    while ((match = re.exec(raw)) !== null) {
      const phraseSource = match[1];
      const chunkSource = match[2];
      if (phraseSource) {
        const normalizedPhrase = normalizeSearchText(phraseSource);
        if (normalizedPhrase.length >= 3) phrases.push(normalizedPhrase);
        for (const token of tokenizeSearchText(phraseSource, 2)) tokens.push(token);
      } else if (chunkSource) {
        const normalizedToken = normalizeSearchToken(chunkSource);
        if (normalizedToken.length >= 2) tokens.push(normalizedToken);
      }
    }

    return { tokens, phrases };
  }

  function tokenizeQuery(query) {
    return parseQuerySegments(query).tokens;
  }

  function stemSearchToken(token) {
    const value = String(token || '');
    if (value.length <= 3) return value;
    if (value.endsWith('ies') && value.length > 4) return `${value.slice(0, -3)}y`;
    if (value.endsWith('ing') && value.length > 5) return value.slice(0, -3);
    if (value.endsWith('ed') && value.length > 4) return value.slice(0, -2);
    if (value.endsWith('es') && value.length > 4) return value.slice(0, -2);
    if (value.endsWith('s') && value.length > 3 && !value.endsWith('ss')) return value.slice(0, -1);
    return value;
  }

  function buildQueryClauses(tokens) {
    const sourceTokens = Array.isArray(tokens) ? tokens : [];
    const core = sourceTokens.filter((token) => !SEARCH_STOPWORDS.has(token));
    const activeTokens = core.length ? core : sourceTokens;
    const deduped = [];
    const seen = new Set();

    for (const token of activeTokens) {
      const normalized = normalizeSearchToken(token);
      if (!normalized || normalized.length < 2 || seen.has(normalized)) continue;
      seen.add(normalized);
      deduped.push(normalized);
    }

    return deduped.map((token) => {
      const variantMap = new Map();
      const addVariant = (candidate, weight) => {
        const normalized = normalizeSearchToken(candidate);
        if (!normalized || normalized.length < 2) return;
        const prev = variantMap.get(normalized) || 0;
        if (weight > prev) variantMap.set(normalized, weight);
      };

      addVariant(token, 1.0);
      const stem = stemSearchToken(token);
      if (stem && stem !== token) addVariant(stem, 0.88);
      const stripped = token.replace(/[^a-z0-9]+/g, '');
      if (stripped && stripped !== token) addVariant(stripped, 0.74);

      const synonyms = SEARCH_TOKEN_SYNONYMS[token] || [];
      for (const synonym of synonyms) addVariant(synonym, 0.72);

      return {
        token,
        isBroad: SEARCH_BROAD_TOKENS.has(token),
        specificity: 1 + Math.min(0.75, Math.max(0, token.length - 2) * 0.08),
        variants: [...variantMap.entries()].map(([term, weight]) => ({ term, weight })),
      };
    });
  }

  function buildSearchQueryModel(input) {
    const isArrayInput = Array.isArray(input);
    const fromArrayTokens = isArrayInput
      ? input.map((value) => normalizeSearchToken(value)).filter((value) => value.length >= 2)
      : [];
    const parsed = isArrayInput ? { tokens: fromArrayTokens, phrases: [] } : parseQuerySegments(input);
    const tokens = parsed.tokens;
    const clauses = buildQueryClauses(tokens);
    const normalizedQuery = normalizeSearchText(isArrayInput ? fromArrayTokens.join(' ') : String(input || ''));
    const phrases = [];
    const phraseSeen = new Set();

    for (const phrase of parsed.phrases || []) {
      if (!phrase || phraseSeen.has(phrase)) continue;
      phraseSeen.add(phrase);
      phrases.push({ value: phrase, weight: 1.0 });
    }

    if (normalizedQuery && normalizedQuery.includes(' ') && normalizedQuery.length <= 80 && !phraseSeen.has(normalizedQuery)) {
      phrases.push({ value: normalizedQuery, weight: 0.52 });
      phraseSeen.add(normalizedQuery);
    }

    const beginnerIntent = tokens.some((token) => BEGINNER_INTENT_TOKENS.has(token));
    const hasNarrowClauses = clauses.some((clause) => !clause.isBroad);
    const requiredClauseCount = hasNarrowClauses
      ? clauses.filter((clause) => !clause.isBroad).length
      : clauses.length;

    return {
      rawTokens: tokens,
      clauses,
      requiredClauseCount,
      phrases,
      normalizedQuery,
      beginnerIntent,
    };
  }

  function parseYearNumber(value) {
    const match = String(value || '').match(/\b(19|20)\d{2}\b/);
    if (!match) return 0;
    const year = parseInt(match[0], 10);
    return Number.isFinite(year) ? year : 0;
  }

  function isSubsequence(needle, haystack) {
    if (!needle || !haystack) return false;
    let i = 0;
    let j = 0;
    while (i < needle.length && j < haystack.length) {
      if (needle[i] === haystack[j]) i += 1;
      j += 1;
    }
    return i === needle.length;
  }

  function boundedLevenshtein(a, b, maxDistance) {
    const source = String(a || '');
    const target = String(b || '');
    const lenA = source.length;
    const lenB = target.length;
    if (!lenA || !lenB) return Math.max(lenA, lenB);
    if (Math.abs(lenA - lenB) > maxDistance) return maxDistance + 1;

    let prev = new Array(lenB + 1);
    let curr = new Array(lenB + 1);
    for (let j = 0; j <= lenB; j += 1) prev[j] = j;

    for (let i = 1; i <= lenA; i += 1) {
      curr[0] = i;
      let rowMin = curr[0];
      for (let j = 1; j <= lenB; j += 1) {
        const cost = source[i - 1] === target[j - 1] ? 0 : 1;
        curr[j] = Math.min(
          prev[j] + 1,
          curr[j - 1] + 1,
          prev[j - 1] + cost
        );
        if (curr[j] < rowMin) rowMin = curr[j];
      }
      if (rowMin > maxDistance) return maxDistance + 1;
      const swap = prev;
      prev = curr;
      curr = swap;
    }

    return prev[lenB];
  }

  function makeSearchField(value) {
    const text = normalizeSearchText(value);
    return {
      text,
      words: text ? text.split(/\s+/).filter((word) => word.length >= 2) : [],
    };
  }

  function computeWordMatchScore(term, words) {
    if (!term || !Array.isArray(words) || !words.length) return 0;
    let best = 0;
    for (const word of words) {
      if (!word) continue;
      if (word === term) return 1;

      if (word.startsWith(term)) {
        best = Math.max(best, 0.88);
      } else if (term.length >= 4 && term.startsWith(word)) {
        best = Math.max(best, 0.8);
      } else if (word.includes(term)) {
        best = Math.max(best, 0.68);
      } else if (term.length >= 3 && isSubsequence(term, word)) {
        best = Math.max(best, 0.5);
      }

      if (term.length >= 4 && word.length >= 4) {
        const maxDistance = term.length >= 8 ? 2 : 1;
        const distance = boundedLevenshtein(term, word, maxDistance);
        if (distance <= maxDistance) {
          best = Math.max(best, distance === 1 ? 0.62 : 0.5);
        }
      }

      if (best >= 0.96) return best;
    }
    return best;
  }

  function computeFieldMatchScore(term, field, allowFuzzy = true) {
    if (!term || !field || !field.text) return 0;
    const text = field.text;
    const escapedTerm = escapeRegExp(term);
    const tokenBoundary = new RegExp(`(^|\\s)${escapedTerm}(\\s|$)`);

    if (text === term) return 1.12;
    if (text.startsWith(`${term} `) || text.startsWith(term)) return 1.02;
    if (tokenBoundary.test(text)) return 0.94;
    if (text.includes(term)) return 0.74;
    if (!allowFuzzy) return 0;

    return computeWordMatchScore(term, field.words);
  }

  function scorePhraseAgainstField(phrase, field) {
    if (!phrase || !field || !field.text) return 0;
    const text = field.text;
    if (text === phrase) return 1.15;
    if (text.startsWith(`${phrase} `) || text.startsWith(phrase)) return 1.05;
    if (text.includes(phrase)) return 0.88;
    return 0;
  }

  function scoreClauseAgainstFields(clause, fields, fieldConfig) {
    if (!clause || !Array.isArray(clause.variants) || !clause.variants.length) return 0;
    let bestClauseScore = 0;

    for (const variant of clause.variants) {
      const term = variant.term;
      const variantWeight = variant.weight || 0;
      if (!term || variantWeight <= 0) continue;

      let bestVariantScore = 0;
      for (const config of fieldConfig) {
        const field = fields[config.key];
        if (!field || !field.text) continue;
        const fieldBaseScore = computeFieldMatchScore(term, field, config.fuzzy !== false);
        if (fieldBaseScore <= 0) continue;
        const weightedScore = fieldBaseScore * (config.weight || 1);
        if (weightedScore > bestVariantScore) bestVariantScore = weightedScore;
      }

      const scoredVariant = bestVariantScore * variantWeight;
      if (scoredVariant > bestClauseScore) bestClauseScore = scoredVariant;
    }

    return bestClauseScore;
  }

  function scoreQueryModelAgainstDoc(model, doc, options = {}) {
    if (!model || !Array.isArray(model.clauses) || !model.clauses.length) return 0;
    if (!doc || !doc.fields) return 0;

    const fieldConfig = options.fieldConfig || [];
    const phraseFieldConfig = options.phraseFieldConfig || fieldConfig;
    const relaxed = options.relaxed === true;

    let total = 0;
    let matchedClauses = 0;
    let matchedRequiredClauses = 0;
    const clauseCount = model.clauses.length;
    const requiredClauseCount = Number.isFinite(model.requiredClauseCount) && model.requiredClauseCount > 0
      ? Math.min(clauseCount, Math.floor(model.requiredClauseCount))
      : clauseCount;
    const treatAllClausesAsRequired = requiredClauseCount === clauseCount;

    for (const clause of model.clauses) {
      const clauseScore = scoreClauseAgainstFields(clause, doc.fields, fieldConfig);
      if (clauseScore > 0) {
        matchedClauses += 1;
        if (treatAllClausesAsRequired || !clause.isBroad) matchedRequiredClauses += 1;
      }
      total += clauseScore * (clause.specificity || 1);
    }

    if (matchedClauses === 0) return 0;

    const coverage = matchedClauses / clauseCount;
    const requiredCoverage = matchedRequiredClauses / requiredClauseCount;
    if (!relaxed) {
      if (requiredClauseCount >= 3 && requiredCoverage < 0.67) return 0;
      if (requiredClauseCount === 2 && requiredCoverage < 1) return 0;
      if (requiredClauseCount === 1 && requiredCoverage < 1) return 0;
    } else {
      if (requiredClauseCount >= 3 && requiredCoverage < 0.34) return 0;
      if (requiredClauseCount === 2 && requiredCoverage < 0.5) return 0;
      if (requiredClauseCount === 1 && requiredCoverage < 1) return 0;
    }

    const effectiveCoverage = (requiredCoverage * 0.72) + (coverage * 0.28);
    const coverageMultiplier = relaxed
      ? (0.52 + (effectiveCoverage * 1.02))
      : (0.28 + (Math.pow(effectiveCoverage, 1.5) * 1.16));
    total *= coverageMultiplier;

    if (Array.isArray(model.phrases) && model.phrases.length) {
      let phraseBonus = 0;
      for (const phraseEntry of model.phrases) {
        const phrase = phraseEntry.value;
        const weight = phraseEntry.weight || 1;
        if (!phrase) continue;

        let bestPhraseField = 0;
        for (const config of phraseFieldConfig) {
          const field = doc.fields[config.key];
          if (!field || !field.text) continue;
          const phraseScore = scorePhraseAgainstField(phrase, field) * (config.weight || 1);
          if (phraseScore > bestPhraseField) bestPhraseField = phraseScore;
        }
        phraseBonus += bestPhraseField * weight;
      }
      total += phraseBonus * 1.8;
    }

    return total;
  }

  function buildTalkSearchDoc(indexedTalk) {
    if (!indexedTalk || typeof indexedTalk !== 'object') return null;
    if (TALK_SEARCH_DOC_CACHE && TALK_SEARCH_DOC_CACHE.has(indexedTalk)) {
      return TALK_SEARCH_DOC_CACHE.get(indexedTalk);
    }

    const doc = {
      fields: {
        title: makeSearchField(indexedTalk._titleLower || indexedTalk.title || ''),
        speakers: makeSearchField(indexedTalk._speakerLower || ''),
        tags: makeSearchField(indexedTalk._tagsLower || ''),
        meeting: makeSearchField(indexedTalk._meetingLower || ''),
        abstract: makeSearchField(indexedTalk._abstractLower || indexedTalk.abstract || ''),
        category: makeSearchField(indexedTalk.category || ''),
        year: makeSearchField(indexedTalk._year || ''),
      },
      year: parseYearNumber(indexedTalk._year || indexedTalk.meeting || ''),
    };

    if (TALK_SEARCH_DOC_CACHE) TALK_SEARCH_DOC_CACHE.set(indexedTalk, doc);
    return doc;
  }

  function hasBeginnerSignal(doc) {
    const fields = doc && doc.fields ? doc.fields : {};
    const text = [
      fields.title && fields.title.text,
      fields.tags && fields.tags.text,
      fields.topics && fields.topics.text,
      fields.abstract && fields.abstract.text,
      fields.content && fields.content.text,
      fields.category && fields.category.text,
      fields.publication && fields.publication.text,
      fields.venue && fields.venue.text,
    ].filter(Boolean).join(' ');
    if (!text) return false;
    return BEGINNER_SIGNAL_RE.test(text);
  }

  function scoreTalkWithModel(indexedTalk, model, relaxed = false) {
    const doc = buildTalkSearchDoc(indexedTalk);
    if (!doc) return 0;

    const base = scoreQueryModelAgainstDoc(model, doc, {
      relaxed,
      fieldConfig: [
        { key: 'title', weight: 15.0, fuzzy: true },
        { key: 'speakers', weight: 12.0, fuzzy: true },
        { key: 'tags', weight: 10.5, fuzzy: true },
        { key: 'meeting', weight: 4.6, fuzzy: true },
        { key: 'abstract', weight: 3.1, fuzzy: false },
        { key: 'category', weight: 2.4, fuzzy: false },
        { key: 'year', weight: 1.6, fuzzy: false },
      ],
      phraseFieldConfig: [
        { key: 'title', weight: 6.2 },
        { key: 'speakers', weight: 4.8 },
        { key: 'tags', weight: 4.5 },
        { key: 'meeting', weight: 2.3 },
        { key: 'abstract', weight: 1.4 },
      ],
    });
    if (base <= 0) return 0;

    let total = base;
    const beginnerSignal = model.beginnerIntent ? hasBeginnerSignal(doc) : false;
    if (model.beginnerIntent && !beginnerSignal && !relaxed) return 0;
    if (doc.year) {
      total += Math.max(0, doc.year - 2006) * 0.14;
    }
    if (model.beginnerIntent) {
      if (doc.fields.tags.text.includes('beginner')) total += 11;
      if (doc.fields.category.text.includes('tutorial')) total += 5;
      if (beginnerSignal) total += 4;
    }
    return total;
  }

  function scoreMatch(indexedTalk, tokensOrQuery) {
    const model = buildSearchQueryModel(tokensOrQuery);
    if (!model.clauses.length) return 0;
    return scoreTalkWithModel(indexedTalk, model, false);
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
    const model = buildSearchQueryModel(query);

    if (!model.clauses.length) {
      return [...talks].sort((a, b) => String(b.meeting || '').localeCompare(String(a.meeting || '')));
    }

    let scored = [];
    for (const talk of talks) {
      const score = scoreTalkWithModel(talk, model, false);
      if (score > 0) scored.push({ talk, score });
    }

    if (!scored.length && model.clauses.length >= 2) {
      for (const talk of talks) {
        const score = scoreTalkWithModel(talk, model, true);
        if (score > 0) scored.push({ talk, score });
      }
    }

    scored.sort(compareRankedEntries);
    return scored.map((entry) => entry.talk);
  }

  function parseCitationCount(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.round(numeric);
  }

  function buildPaperSearchDoc(rawPaper) {
    if (!rawPaper || typeof rawPaper !== 'object') return null;
    if (PAPER_SEARCH_DOC_CACHE && PAPER_SEARCH_DOC_CACHE.has(rawPaper)) {
      return PAPER_SEARCH_DOC_CACHE.get(rawPaper);
    }

    const paper = rawPaper;
    const title = paper._titleLower || paper.title || '';
    const authors = paper._authorsLower
      || (Array.isArray(paper.authors) ? paper.authors.map((author) => (author && author.name) || '').join(' ') : '');
    const topics = paper._topicsLower
      || `${Array.isArray(paper.tags) ? paper.tags.join(' ') : ''} ${Array.isArray(paper.keywords) ? paper.keywords.join(' ') : ''}`;
    const abstractText = paper._abstractLower || paper.abstract || '';
    const content = paper._contentLower
      || paper.content
      || paper.body
      || paper.markdown
      || paper.html
      || '';
    const publication = paper._publicationLower || paper.publication || '';
    const venue = paper._venueLower || paper.venue || '';
    const yearField = paper._yearLower || paper._year || paper.year || '';

    const doc = {
      fields: {
        title: makeSearchField(title),
        authors: makeSearchField(authors),
        topics: makeSearchField(topics),
        abstract: makeSearchField(abstractText),
        content: makeSearchField(content),
        publication: makeSearchField(publication),
        venue: makeSearchField(venue),
        year: makeSearchField(yearField),
      },
      year: parseYearNumber(yearField),
      citationCount: parseCitationCount(paper._citationCount || paper.citationCount),
    };

    if (PAPER_SEARCH_DOC_CACHE) PAPER_SEARCH_DOC_CACHE.set(rawPaper, doc);
    return doc;
  }

  function scorePaperWithModel(paper, model, relaxed = false) {
    const doc = buildPaperSearchDoc(paper);
    if (!doc) return 0;

    const base = scoreQueryModelAgainstDoc(model, doc, {
      relaxed,
      fieldConfig: [
        { key: 'title', weight: 15.4, fuzzy: true },
        { key: 'authors', weight: 11.1, fuzzy: true },
        { key: 'topics', weight: 10.2, fuzzy: true },
        { key: 'publication', weight: 4.7, fuzzy: true },
        { key: 'venue', weight: 4.2, fuzzy: true },
        { key: 'abstract', weight: 3.3, fuzzy: false },
        { key: 'content', weight: 2.1, fuzzy: false },
        { key: 'year', weight: 1.7, fuzzy: false },
      ],
      phraseFieldConfig: [
        { key: 'title', weight: 6.4 },
        { key: 'authors', weight: 4.7 },
        { key: 'topics', weight: 4.5 },
        { key: 'publication', weight: 2.3 },
        { key: 'venue', weight: 2.0 },
        { key: 'abstract', weight: 1.2 },
        { key: 'content', weight: 0.9 },
      ],
    });
    if (base <= 0) return 0;

    let total = base;
    const beginnerSignal = model.beginnerIntent ? hasBeginnerSignal(doc) : false;
    if (model.beginnerIntent && !beginnerSignal && !relaxed) return 0;
    if (doc.year) total += Math.max(0, doc.year - 2000) * 0.12;
    if (doc.citationCount > 0) total += Math.min(8, Math.log1p(doc.citationCount) * 1.3);
    if (model.beginnerIntent && doc.fields.topics.text.includes('beginner')) total += 8;
    if (model.beginnerIntent && beginnerSignal) total += 4;
    return total;
  }

  function compareRankedPaperEntries(a, b) {
    const scoreDiff = (b.score || 0) - (a.score || 0);
    if (scoreDiff !== 0) return scoreDiff;

    const aYear = parseYearNumber((a.paper && (a.paper._year || a.paper.year)) || '');
    const bYear = parseYearNumber((b.paper && (b.paper._year || b.paper.year)) || '');
    if (aYear !== bYear) return bYear - aYear;

    const aCitations = parseCitationCount((a.paper && (a.paper._citationCount || a.paper.citationCount)) || 0);
    const bCitations = parseCitationCount((b.paper && (b.paper._citationCount || b.paper.citationCount)) || 0);
    if (aCitations !== bCitations) return bCitations - aCitations;

    const aTitle = String((a.paper && a.paper.title) || '');
    const bTitle = String((b.paper && b.paper.title) || '');
    return aTitle.localeCompare(bTitle);
  }

  function rankPaperRecordsByQuery(papers, query) {
    const records = Array.isArray(papers) ? papers : [];
    const model = buildSearchQueryModel(query);

    if (!model.clauses.length) {
      return [...records].sort((a, b) => {
        const aYear = parseYearNumber((a && (a._year || a.year)) || '');
        const bYear = parseYearNumber((b && (b._year || b.year)) || '');
        if (aYear !== bYear) return bYear - aYear;
        const aTitle = String((a && a.title) || '');
        const bTitle = String((b && b.title) || '');
        return aTitle.localeCompare(bTitle);
      });
    }

    let scored = [];
    for (const paper of records) {
      const score = scorePaperWithModel(paper, model, false);
      if (score > 0) scored.push({ paper, score });
    }

    if (!scored.length && model.clauses.length >= 2) {
      for (const paper of records) {
        const score = scorePaperWithModel(paper, model, true);
        if (score > 0) scored.push({ paper, score });
      }
    }

    scored.sort(compareRankedPaperEntries);
    return scored.map((entry) => entry.paper);
  }

  function compareAutocompleteEntries(a, b) {
    const scoreDiff = (b.score || 0) - (a.score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    const countDiff = (b.count || 0) - (a.count || 0);
    if (countDiff !== 0) return countDiff;
    const aLabel = String((a.entry && a.entry.label) || '');
    const bLabel = String((b.entry && b.entry.label) || '');
    return aLabel.localeCompare(bLabel);
  }

  function rankAutocompleteEntries(entries, query, options = {}) {
    const values = Array.isArray(entries) ? entries : [];
    const limit = Number.isFinite(options.limit) && options.limit > 0
      ? Math.floor(options.limit)
      : values.length;
    const countField = String(options.countField || 'count');
    const model = buildSearchQueryModel(query);

    if (!model.clauses.length && !model.normalizedQuery) {
      return [...values]
        .sort((a, b) => (Number(b[countField] || 0) - Number(a[countField] || 0)) || String(a.label || '').localeCompare(String(b.label || '')))
        .slice(0, limit);
    }

    if (!model.clauses.length && model.normalizedQuery) {
      const q = model.normalizedQuery;
      const fallbackScored = [];
      for (const entry of values) {
        const label = String((entry && entry.label) || '').trim();
        if (!label) continue;
        const field = makeSearchField(label);
        if (!field.text) continue;
        let score = 0;
        if (field.text === q) score += 160;
        else if (field.text.startsWith(`${q} `) || field.text.startsWith(q)) score += 120;
        else if (field.text.includes(q)) score += 70;
        else continue;

        const popularity = Number(entry[countField] || 0);
        if (Number.isFinite(popularity) && popularity > 0) {
          score += Math.log1p(popularity) * 4.5;
        }
        fallbackScored.push({ entry, score, count: popularity });
      }
      fallbackScored.sort(compareAutocompleteEntries);
      return fallbackScored.slice(0, limit).map((item) => item.entry);
    }

    const scored = [];
    for (const entry of values) {
      const label = String((entry && entry.label) || '').trim();
      if (!label) continue;

      const labelField = makeSearchField(label);
      if (!labelField.text) continue;

      let score = scoreQueryModelAgainstDoc(model, { fields: { label: labelField } }, {
        fieldConfig: [{ key: 'label', weight: 9.5, fuzzy: true }],
        phraseFieldConfig: [{ key: 'label', weight: 4.8 }],
      });
      if (score <= 0) continue;

      if (model.normalizedQuery) {
        if (labelField.text === model.normalizedQuery) score += 160;
        else if (labelField.text.startsWith(`${model.normalizedQuery} `) || labelField.text.startsWith(model.normalizedQuery)) score += 112;
        else if (labelField.text.includes(model.normalizedQuery)) score += 56;
      }

      const popularity = Number(entry[countField] || 0);
      if (Number.isFinite(popularity) && popularity > 0) {
        score += Math.log1p(popularity) * 4.5;
      }
      if (model.beginnerIntent && labelField.text.includes('beginner')) score += 12;

      scored.push({ entry, score, count: popularity });
    }

    scored.sort(compareAutocompleteEntries);
    return scored.slice(0, limit).map((item) => item.entry);
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
      speaker: isNonEmptyString(params.speaker) ? normalizeSpeakerName(params.speaker) : '',
      meeting,
      meetingName,
      categories: normalizeTalkCategoryList(parseCsvParam(params.category)),
      years: parseCsvParam(params.year),
      tags: parseCsvParam(params.tag),
      sort: isNonEmptyString(params.sort) ? params.sort.trim().toLowerCase() : '',
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
      speaker: isNonEmptyString(parsed.speaker) ? normalizeSpeakerName(parsed.speaker) : '',
      categories: normalizeTalkCategoryList(Array.isArray(parsed.categories) ? parsed.categories.filter(isNonEmptyString) : []),
      years: Array.isArray(parsed.years) ? parsed.years.filter(isNonEmptyString) : [],
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter(isNonEmptyString) : [],
      sortBy: isNonEmptyString(parsed.sortBy)
        ? parsed.sortBy.trim().toLowerCase()
        : (isNonEmptyString(parsed.sort) ? parsed.sort.trim().toLowerCase() : ''),
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

  const KEY_TOPIC_CANONICAL = [
    'LLVM',
    'Clang',
    'MLIR',
    'Flang',
    'LLD',
    'LLDB',
    'CIRCT',
    'Polly',
    'OpenMP',
    'compiler-rt',
    'libc++',
    'libc',
    'BOLT',
    'ORC JIT',
    'IR',
    'ClangIR',
    'Backend',
    'Frontend',
    'Code Generation',
    'Optimizations',
    'Autovectorization',
    'Loop transformations',
    'Register Allocation',
    'Instruction Selection',
    'Instruction Scheduling',
    'JIT',
    'LTO',
    'PGO',
    'Debug Information',
    'Static Analysis',
    'Dynamic Analysis',
    'Testing',
    'Sanitizers',
    'Security',
    'Performance',
    'Infrastructure',
    'Libraries',
    'GPU',
    'CUDA',
    'OpenCL',
    'HIP',
    'Embedded',
    'RISC-V',
    'AArch64',
    'x86-64',
    'WASM',
    'AI',
    'ML',
    'C++',
    'C++ Libs',
    'C Libs',
    'Programming Languages',
    'Rust',
    'Swift',
    'Quantum Computing',
    'LLVM Foundation',
    'Community Building',
    'D&I',
    'Incubator',
    'MCP',
    'VPlan',
    'Mojo',
    'Beginner',
  ];

  function normalizeTopicKey(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9+]+/g, '');
  }

  const KEY_TOPIC_CANONICAL_BY_KEY = new Map();
  for (const topic of KEY_TOPIC_CANONICAL) {
    KEY_TOPIC_CANONICAL_BY_KEY.set(normalizeTopicKey(topic), topic);
  }

  const KEY_TOPIC_ALIAS_MAP_RAW = {
    llvm: 'LLVM',
    clang: 'Clang',
    clangd: 'Clang',
    clangir: 'ClangIR',
    mlir: 'MLIR',
    flang: 'Flang',
    lld: 'LLD',
    lldb: 'LLDB',
    circt: 'CIRCT',
    polly: 'Polly',
    openmp: 'OpenMP',
    libomp: 'OpenMP',
    compilerrt: 'compiler-rt',
    'compiler-rt': 'compiler-rt',
    libfuzzer: 'compiler-rt',
    libcxx: 'libc++',
    'libc++': 'libc++',
    libc: 'libc',
    bolt: 'BOLT',
    orc: 'ORC JIT',
    orcjit: 'ORC JIT',
    ir: 'IR',
    llvmir: 'IR',
    intermediaterepresentation: 'IR',
    backend: 'Backend',
    frontend: 'Frontend',
    codegen: 'Code Generation',
    codegeneration: 'Code Generation',
    optimization: 'Optimizations',
    optimizations: 'Optimizations',
    optimisation: 'Optimizations',
    vectorization: 'Autovectorization',
    autovectorization: 'Autovectorization',
    loopoptimization: 'Loop transformations',
    loopoptimizations: 'Loop transformations',
    loopoptimisation: 'Loop transformations',
    looptransformations: 'Loop transformations',
    registerallocation: 'Register Allocation',
    registerallocator: 'Register Allocation',
    instructionselection: 'Instruction Selection',
    instructionscheduling: 'Instruction Scheduling',
    machinescheduler: 'Instruction Scheduling',
    jit: 'JIT',
    lto: 'LTO',
    pgo: 'PGO',
    debuginformation: 'Debug Information',
    dwarf: 'Debug Information',
    staticanalysis: 'Static Analysis',
    staticanalyzer: 'Static Analysis',
    dynamicanalysis: 'Dynamic Analysis',
    testing: 'Testing',
    fuzzing: 'Testing',
    sanitizers: 'Sanitizers',
    sanitizer: 'Sanitizers',
    asan: 'Sanitizers',
    tsan: 'Sanitizers',
    ubsan: 'Sanitizers',
    security: 'Security',
    memorysafety: 'Security',
    cfi: 'Security',
    performance: 'Performance',
    infrastructure: 'Infrastructure',
    toolchain: 'Infrastructure',
    libraries: 'Libraries',
    gpu: 'GPU',
    cuda: 'CUDA',
    opencl: 'OpenCL',
    hip: 'HIP',
    rocm: 'HIP',
    embedded: 'Embedded',
    riscv: 'RISC-V',
    aarch64: 'AArch64',
    arm64: 'AArch64',
    x8664: 'x86-64',
    x86_64: 'x86-64',
    wasm: 'WASM',
    wasm32: 'WASM',
    wasm64: 'WASM',
    webassembly: 'WASM',
    ai: 'AI',
    artificialintelligence: 'AI',
    ml: 'ML',
    machinelearning: 'ML',
    deeplearning: 'ML',
    reinforcementlearning: 'ML',
    cpp: 'C++',
    cxx: 'C++',
    'c++': 'C++',
    cpplibs: 'C++ Libs',
    cxxlibs: 'C++ Libs',
    clibs: 'C Libs',
    programminglanguages: 'Programming Languages',
    rust: 'Rust',
    swift: 'Swift',
    quantumcomputing: 'Quantum Computing',
    llvmfoundation: 'LLVM Foundation',
    foundation: 'LLVM Foundation',
    foundationupdates: 'LLVM Foundation',
    communitybuilding: 'Community Building',
    diversityinclusion: 'D&I',
    incubation: 'Incubator',
    incubator: 'Incubator',
    mcp: 'MCP',
    vplan: 'VPlan',
    mojo: 'Mojo',
    beginner: 'Beginner',
  };

  const KEY_TOPIC_BY_KEY = new Map(KEY_TOPIC_CANONICAL_BY_KEY);
  for (const [alias, canonical] of Object.entries(KEY_TOPIC_ALIAS_MAP_RAW)) {
    const canonicalTopic = KEY_TOPIC_CANONICAL_BY_KEY.get(normalizeTopicKey(canonical));
    if (!canonicalTopic) continue;
    KEY_TOPIC_BY_KEY.set(normalizeTopicKey(alias), canonicalTopic);
  }

  const KEY_TOPIC_TEXT_RULES = [
    { topic: 'LLVM', pattern: /\bllvm\b/i },
    { topic: 'Clang', pattern: /\bclang(?:d)?\b/i },
    { topic: 'MLIR', pattern: /\bmlir\b|\bmulti[- ]level intermediate representation\b/i },
    { topic: 'Flang', pattern: /\bflang\b/i },
    { topic: 'LLD', pattern: /\blld\b/i },
    { topic: 'LLDB', pattern: /\blldb\b/i },
    { topic: 'CIRCT', pattern: /\bcirct\b/i },
    { topic: 'Polly', pattern: /\bpolly\b/i },
    { topic: 'OpenMP', pattern: /\bopenmp\b|\blibomp\b/i },
    { topic: 'compiler-rt', pattern: /\bcompiler[- ]?rt\b|\blibfuzzer\b/i },
    { topic: 'libc++', pattern: /\blibc\+\+\b/i },
    { topic: 'libc', pattern: /\blibc\b/i },
    { topic: 'BOLT', pattern: /\bbolt\b/i },
    { topic: 'ORC JIT', pattern: /\borc(?:\s*jit)?\b/i },
    { topic: 'ClangIR', pattern: /\bclangir\b|\bclang\s+ir\b/i },
    { topic: 'IR', pattern: /\bllvm\s+ir\b|\bintermediate representation\b|\bssa\b/i },
    { topic: 'JIT', pattern: /\bjust[- ]in[- ]time\b|\bjit\b/i },
    { topic: 'LTO', pattern: /\blto\b|\blink[- ]time optimization\b/i },
    { topic: 'PGO', pattern: /\bpgo\b|\bprofile[- ]guided optimization\b/i },
    { topic: 'Autovectorization', pattern: /\bauto[- ]?vectori[sz]ation\b|\bvectori[sz]ation\b/i },
    { topic: 'Loop transformations', pattern: /\bloop (?:transform(?:ation|ations)?|optimization|optimisation|unroll(?:ing)?|fusion|tiling|interchange)\b/i },
    { topic: 'Register Allocation', pattern: /\bregister allocation\b|\bregister allocator\b/i },
    { topic: 'Instruction Scheduling', pattern: /\binstruction scheduling\b|\bmachine scheduler\b/i },
    { topic: 'Instruction Selection', pattern: /\binstruction selection\b/i },
    { topic: 'Code Generation', pattern: /\bcode generation\b|\bcodegen\b/i },
    { topic: 'Debug Information', pattern: /\bdebug information\b|\bdwarf\b/i },
    { topic: 'Static Analysis', pattern: /\bstatic analysis\b|\bstatic analyzer\b/i },
    { topic: 'Dynamic Analysis', pattern: /\bdynamic analysis\b/i },
    { topic: 'Testing', pattern: /\btesting\b|\bfuzz(?:ing|er|ers)?\b/i },
    { topic: 'Sanitizers', pattern: /\bsanitizer(?:s)?\b|\baddresssanitizer\b|\bthreadsanitizer\b|\bubsan\b|\basan\b|\btsan\b/i },
    { topic: 'Security', pattern: /\bsecurity\b|\bmemory safety\b|\bcontrol flow integrity\b|\bcfi\b/i },
    { topic: 'Performance', pattern: /\bperformance\b/i },
    { topic: 'Optimizations', pattern: /\boptimizations?\b|\boptimisation\b/i },
    { topic: 'Infrastructure', pattern: /\binfrastructure\b|\btoolchain\b/i },
    { topic: 'GPU', pattern: /\bgpu(?:s)?\b/i },
    { topic: 'CUDA', pattern: /\bcuda\b/i },
    { topic: 'OpenCL', pattern: /\bopencl\b/i },
    { topic: 'HIP', pattern: /\bhip\b|\brocm\b/i },
    { topic: 'Embedded', pattern: /\bembedded\b/i },
    { topic: 'RISC-V', pattern: /\brisc[- ]?v\b/i },
    { topic: 'AArch64', pattern: /\baarch64\b|\barm64\b/i },
    { topic: 'x86-64', pattern: /\bx86[-_ ]?64\b/i },
    { topic: 'WASM', pattern: /\bwebassembly\b|\bwasm(?:32|64)?\b/i },
    { topic: 'AI', pattern: /\bartificial intelligence\b|\bagentic ai\b|\bai\b/i },
    { topic: 'ML', pattern: /\bmachine learning\b|\bdeep learning\b|\breinforcement learning\b|\bml\b/i },
    { topic: 'Rust', pattern: /\brust\b/i },
    { topic: 'Swift', pattern: /\bswift\b/i },
    { topic: 'Quantum Computing', pattern: /\bquantum (?:computing|compiler|compilation)\b/i },
    { topic: 'LLVM Foundation', pattern: /\bllvm foundation\b|\bfoundation update(?:s)?\b/i },
    { topic: 'MCP', pattern: /\bmcp\b/i },
    { topic: 'VPlan', pattern: /\bvplan\b/i },
    { topic: 'Mojo', pattern: /\bmojo\b/i },
  ];

  const TALK_KEY_TOPIC_CACHE = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  const PAPER_KEY_TOPIC_CACHE = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

  function canonicalizeKeyTopic(value) {
    const key = normalizeTopicKey(collapseWhitespace(value));
    if (!key) return '';
    return KEY_TOPIC_BY_KEY.get(key) || '';
  }

  function collectCanonicalTopics(rawValues, text) {
    const out = [];
    const seen = new Set();

    const add = (value) => {
      const topic = canonicalizeKeyTopic(value);
      const key = normalizeTopicKey(topic);
      if (!topic || !key || seen.has(key)) return;
      seen.add(key);
      out.push(topic);
    };

    for (const value of (rawValues || [])) add(value);

    const haystack = String(text || '');
    if (haystack) {
      for (const rule of KEY_TOPIC_TEXT_RULES) {
        if (rule.pattern.test(haystack)) add(rule.topic);
      }
    }

    return out;
  }

  function computeTalkKeyTopics(talk) {
    const seed = [
      ...((talk && talk.tags) || []),
      ...((talk && talk.keywords) || []),
    ];
    const text = `${collapseWhitespace(talk && talk.title)} ${collapseWhitespace(talk && talk.abstract)}`.trim();
    return collectCanonicalTopics(seed, text);
  }

  function computePaperKeyTopics(paper) {
    const seed = [
      ...((paper && paper.tags) || []),
      ...((paper && paper.keywords) || []),
    ];
    const text = [
      collapseWhitespace(paper && paper.title),
      collapseWhitespace(paper && paper.abstract),
      collapseWhitespace(paper && paper.publication),
      collapseWhitespace(paper && paper.venue),
    ].filter(Boolean).join(' ');
    return collectCanonicalTopics(seed, text);
  }

  function getTalkKeyTopics(talk, limit = Infinity) {
    if (!talk || typeof talk !== 'object') return [];

    let cached = null;
    if (TALK_KEY_TOPIC_CACHE && TALK_KEY_TOPIC_CACHE.has(talk)) {
      cached = TALK_KEY_TOPIC_CACHE.get(talk);
    } else {
      cached = computeTalkKeyTopics(talk);
      if (TALK_KEY_TOPIC_CACHE) TALK_KEY_TOPIC_CACHE.set(talk, cached);
    }

    if (!Number.isFinite(limit)) return [...cached];
    return cached.slice(0, Math.max(0, Math.floor(limit)));
  }

  function getPaperKeyTopics(paper, limit = Infinity) {
    if (!paper || typeof paper !== 'object') return [];

    let cached = null;
    if (PAPER_KEY_TOPIC_CACHE && PAPER_KEY_TOPIC_CACHE.has(paper)) {
      cached = PAPER_KEY_TOPIC_CACHE.get(paper);
    } else {
      cached = computePaperKeyTopics(paper);
      if (PAPER_KEY_TOPIC_CACHE) PAPER_KEY_TOPIC_CACHE.set(paper, cached);
    }

    if (!Number.isFinite(limit)) return [...cached];
    return cached.slice(0, Math.max(0, Math.floor(limit)));
  }

  const api = {
    arePersonMiddleVariants,
    buildPeopleIndex,
    CATEGORY_ORDER,
    compareRankedEntries,
    extractYouTubeId,
    formatMeetingDateUniversal,
    getPaperKeyTopics,
    getTalkKeyTopics,
    isYouTubeVideoId,
    normalizeAffiliation,
    normalizeAffiliationKey,
    normalizePersonDisplayName,
    normalizePersonName,
    normalizePersonRecord,
    normalizePersonKey,
    normalizeSpeakerName,
    normalizeTalkCategory,
    normalizeTalkRecord,
    normalizeTalks,
    parseMeetingDateRange,
    parseNavigationState,
    parseUrlState,
    rankAutocompleteEntries,
    rankPaperRecordsByQuery,
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

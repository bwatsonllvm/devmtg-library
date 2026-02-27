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

  function toAffiliationAliasKey(value) {
    return stripDiacritics(collapseWhitespace(value).toLowerCase())
      .replace(/&/g, ' and ')
      .replace(/['".,()]/g, '')
      .replace(/[^a-z0-9]+/g, '');
  }

  const AFFILIATION_ALIAS_MAP = new Map([
    ['mit', 'Massachusetts Institute of Technology'],
    ['massachusettsinstituteoftechnology', 'Massachusetts Institute of Technology'],
    ['massachussettsinstituteoftechnology', 'Massachusetts Institute of Technology'],
    ['massachusettsinsituteoftechnology', 'Massachusetts Institute of Technology'],
    ['massachussettsinsituteoftechnology', 'Massachusetts Institute of Technology'],
    ['massachusettsinstoftechnology', 'Massachusetts Institute of Technology'],
    ['massachussettsinstoftechnology', 'Massachusetts Institute of Technology'],
    ['carnegiemellon', 'Carnegie Mellon University'],
    ['carnegiemellonuniversity', 'Carnegie Mellon University'],
    ['cmu', 'Carnegie Mellon University'],
    ['caltech', 'California Institute of Technology'],
    ['uiuc', 'University of Illinois Urbana-Champaign'],
    ['universityofillinoisaturbanachampaign', 'University of Illinois Urbana-Champaign'],
    ['universityofillinoisurbanachampaign', 'University of Illinois Urbana-Champaign'],
    ['ethzurich', 'ETH Zurich'],
    ['eidgenossischetechnischehochschulezurich', 'ETH Zurich'],
    ['epfl', 'EPFL'],
    ['ecolepolytechniquefederaledelausanne', 'EPFL'],
  ]);

  const UC_CAMPUS_ALIAS_MAP = new Map([
    ['berkeley', 'Berkeley'],
    ['ucb', 'Berkeley'],
    ['davis', 'Davis'],
    ['ucd', 'Davis'],
    ['irvine', 'Irvine'],
    ['uci', 'Irvine'],
    ['losangeles', 'Los Angeles'],
    ['la', 'Los Angeles'],
    ['ucla', 'Los Angeles'],
    ['merced', 'Merced'],
    ['ucm', 'Merced'],
    ['riverside', 'Riverside'],
    ['ucr', 'Riverside'],
    ['sandiego', 'San Diego'],
    ['sd', 'San Diego'],
    ['ucsd', 'San Diego'],
    ['sanfrancisco', 'San Francisco'],
    ['sf', 'San Francisco'],
    ['ucsf', 'San Francisco'],
    ['santabarbara', 'Santa Barbara'],
    ['sb', 'Santa Barbara'],
    ['ucsb', 'Santa Barbara'],
    ['santacruz', 'Santa Cruz'],
    ['sc', 'Santa Cruz'],
    ['ucsc', 'Santa Cruz'],
  ]);

  const CORPORATE_REGIONAL_BASES = new Set([
    'intel',
    'google',
    'microsoft',
    'meta',
    'facebook',
    'amazon',
    'apple',
    'nvidia',
    'amd',
    'arm',
    'qualcomm',
    'ibm',
    'oracle',
    'samsung',
    'huawei',
    'xilinx',
    'broadcom',
  ]);

  const CORPORATE_AFFILIATION_HINT_RE = /\b(inc|corp|corporation|company|llc|ltd|gmbh|technologies|technology|systems|labs?)\b/i;
  const ACADEMIC_AFFILIATION_HINT_RE = /\b(university|college|institute|school|department|faculty|laboratory|centre|center|hospital|clinic|academy)\b/i;
  const COUNTRY_REGION_QUALIFIER_KEYS = new Set([
    'argentina',
    'australia',
    'austria',
    'belgium',
    'brazil',
    'canada',
    'chile',
    'china',
    'colombia',
    'croatia',
    'czechrepublic',
    'denmark',
    'estonia',
    'finland',
    'france',
    'germany',
    'greece',
    'hungary',
    'iceland',
    'india',
    'indonesia',
    'ireland',
    'israel',
    'italy',
    'japan',
    'latvia',
    'lithuania',
    'luxembourg',
    'malaysia',
    'mexico',
    'netherlands',
    'newzealand',
    'norway',
    'philippines',
    'poland',
    'portugal',
    'romania',
    'saudiarabia',
    'singapore',
    'slovakia',
    'slovenia',
    'southafrica',
    'southkorea',
    'spain',
    'sweden',
    'switzerland',
    'taiwan',
    'thailand',
    'turkey',
    'uae',
    'uk',
    'ukraine',
    'unitedarabemirates',
    'unitedkingdom',
    'unitedstates',
    'usa',
    'vietnam',
  ]);
  const MISSING_METADATA_TOKENS = new Set(['', 'none', 'null', 'nan', 'n/a', 'na', 'unknown']);
  const PUBLICATION_ACRONYM_BLOCKLIST = new Set([
    'acm',
    'ieee',
    'ifip',
    'usenix',
    'sigplan',
    'sigsoft',
    'sigbed',
    'sigops',
    'proc',
    'vol',
    'issue',
    'the',
    'and',
    'for',
    'of',
    'in',
    'on',
  ]);
  const PUBLICATION_STOPWORDS = new Set([
    'a',
    'an',
    'and',
    'for',
    'from',
    'in',
    'of',
    'on',
    'the',
    'to',
    'proceedings',
    'proceeding',
    'proc',
    'conference',
    'conferences',
    'symposium',
    'symposia',
    'workshop',
    'workshops',
    'international',
    'annual',
    'volume',
    'vol',
    'issue',
    'acm',
    'ieee',
    'ifip',
    'usenix',
    'sigplan',
    'sigsoft',
    'sigbed',
    'sigops',
    'edition',
  ]);

  function isCorporateAffiliationBase(base) {
    const cleaned = collapseWhitespace(base);
    if (!cleaned) return false;

    const lowered = cleaned.toLowerCase();
    const aliasKey = toAffiliationAliasKey(cleaned);
    if (CORPORATE_REGIONAL_BASES.has(aliasKey) || CORPORATE_REGIONAL_BASES.has(lowered)) {
      return true;
    }
    if (CORPORATE_AFFILIATION_HINT_RE.test(cleaned)) {
      return true;
    }
    if (ACADEMIC_AFFILIATION_HINT_RE.test(cleaned)) {
      return false;
    }
    if (cleaned.includes(',')) {
      return false;
    }
    const tokenCount = (cleaned.match(/[A-Za-z0-9][A-Za-z0-9&'./-]*/g) || []).length;
    return tokenCount >= 1 && tokenCount <= 5;
  }

  function normalizeUcCampusName(value) {
    const cleaned = collapseWhitespace(value)
      .replace(/^(?:campus|at|the)\s+/i, '')
      .replace(/^[,.;:\-]+|[,.;:\-]+$/g, '');
    if (!cleaned) return '';

    const key = toAffiliationAliasKey(cleaned);
    const mapped = UC_CAMPUS_ALIAS_MAP.get(key);
    if (mapped) return mapped;

    return cleaned
      .split(/\s+/)
      .map((part) => {
        if (!part) return '';
        if (part.length <= 2) return part.toUpperCase();
        return part[0].toUpperCase() + part.slice(1).toLowerCase();
      })
      .join(' ');
  }

  function canonicalizeUniversityOfCaliforniaAffiliation(value) {
    const text = collapseWhitespace(value);
    if (!text) return '';

    if (/^university\s+of\s+california$/i.test(text)) {
      return 'University of California';
    }

    const match = text.match(
      /^(?:university\s+of\s+california(?:\s*,\s*|\s+at\s+|\s+-\s+|\s+)|u\.?\s*c\.?\s*(?:,\s*|\s+-\s+|\s+)?)(.+)$/i
    );
    if (!match) return '';

    const campus = normalizeUcCampusName(match[1]);
    if (!campus) return 'University of California';
    return `University of California, ${campus}`;
  }

  function collapseCorporateRegionalQualifier(value) {
    const text = collapseWhitespace(value);
    if (!text) return '';

    const match = text.match(/^([^()]{2,120})\s*\(([^()]{2,80})\)$/);
    if (!match) return text;

    const base = collapseWhitespace(match[1]).replace(/^[,.;:\-]+|[,.;:\-]+$/g, '');
    const qualifier = collapseWhitespace(match[2]);
    if (!base || !qualifier) return text;
    if (!/^[A-Za-z][A-Za-z .,'-]{1,79}$/.test(qualifier)) return text;
    if (COUNTRY_REGION_QUALIFIER_KEYS.has(toAffiliationAliasKey(qualifier))) {
      return base;
    }

    if (!isCorporateAffiliationBase(base)) {
      return text;
    }

    return base;
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
      .replace(/\(\s*UK\s*\)$/i, '')
      .replace(/\bMassachussetts\b/gi, 'Massachusetts')
      .replace(/\bInsitute\b/gi, 'Institute');

    text = collapseCorporateRegionalQualifier(text);

    const ucCanonical = canonicalizeUniversityOfCaliforniaAffiliation(text);
    if (ucCanonical) {
      return collapseWhitespace(ucCanonical);
    }

    const aliasKey = toAffiliationAliasKey(text);
    if (AFFILIATION_ALIAS_MAP.has(aliasKey)) {
      return AFFILIATION_ALIAS_MAP.get(aliasKey) || '';
    }

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

  function cleanMetadataValue(value) {
    const clean = collapseWhitespace(String(value || '').replace(/&amp;/gi, '&'));
    if (!clean) return '';
    if (MISSING_METADATA_TOKENS.has(clean.toLowerCase())) return '';
    return clean;
  }

  function normalizePublication(value) {
    let text = cleanMetadataValue(value);
    if (!text) return '';

    text = text
      .replace(/\s+,/g, ',')
      .replace(/\s+([):;,.])/g, '$1')
      .replace(/([(:])\s+/g, '$1')
      .replace(/^\s*['"`]+|['"`]+\s*$/g, '');

    text = text
      .replace(/^proceedings of eedings(?: of)?(?:\s+|\/)+/i, 'Proceedings of ')
      .replace(/^proceedings of proceedings of\s+/i, 'Proceedings of ');

    if (/^arxiv(?:\.org)?(?:\s*\(cornell university\))?$/i.test(text)) {
      return 'arXiv';
    }
    if (/^llvm project blog$/i.test(text)) {
      return 'LLVM Project Blog';
    }
    if (/^(?:m\.?\s*s\.?|masters?)\s+thesis$/i.test(text)) {
      return 'Masters Thesis';
    }
    if (/^(?:ph\.?\s*d\.?|doctoral)\s+thesis$/i.test(text)) {
      return 'Ph.D. Thesis';
    }
    if (/^(?:b\.?\s*s?c\.?|bachelor(?:'s)?|undergraduate)\s+thesis$/i.test(text)) {
      return 'Bachelor Thesis';
    }

    const procPrefixRe = /^proc(?:\.|\b)\s*(?:of\s+)?(?:the\s+)?/i;
    if (procPrefixRe.test(text)) {
      const tail = collapseWhitespace(text.replace(procPrefixRe, ''));
      if (tail) text = `Proceedings of ${tail}`;
    } else {
      text = text.replace(/^proceedings\s+of\s+the\s+/i, 'Proceedings of ');
    }

    if (/^proceedings of acm on programming languages$/i.test(text)) {
      text = 'Proceedings of the ACM on Programming Languages';
    } else if (/^proceedings of (?:the )?institute for system programming of (?:the )?ras$/i.test(text)) {
      text = 'Proceedings of the Institute for System Programming of the RAS';
    }

    return collapseWhitespace(text);
  }

  function getPaperPrimaryPublication(paper) {
    if (!paper || typeof paper !== 'object') return '';

    const explicitPublication = normalizePublication(paper.publication);
    if (explicitPublication) return explicitPublication;

    const venue = cleanMetadataValue(paper.venue);
    if (!venue) return '';

    const venueParts = String(venue)
      .split('|')
      .map((part) => normalizePublication(part))
      .filter(Boolean);

    for (const part of venueParts) {
      if (/^vol\./i.test(part) || /^issue\b/i.test(part)) continue;
      return part;
    }
    return '';
  }

  function extractPublicationAcronym(value) {
    const text = normalizePublication(value);
    if (!text) return '';

    const parenMatches = text.match(/\(([^()]{2,30})\)/g) || [];
    for (const raw of parenMatches) {
      const inner = raw.replace(/^\(|\)$/g, '');
      const candidate = stripDiacritics(inner)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .replace(/\d+$/g, '');
      if (!candidate) continue;
      if (!/[A-Z]/.test(candidate)) continue;
      if (candidate.length < 2 || candidate.length > 10) continue;
      if (PUBLICATION_ACRONYM_BLOCKLIST.has(candidate.toLowerCase())) continue;
      return candidate;
    }

    const upperTokens = text.match(/\b[A-Z][A-Z0-9-]{1,9}\b/g) || [];
    for (const token of upperTokens) {
      const candidate = token.replace(/[^A-Z0-9]/g, '').replace(/\d+$/g, '');
      if (!candidate) continue;
      if (candidate.length < 2 || candidate.length > 10) continue;
      if (PUBLICATION_ACRONYM_BLOCKLIST.has(candidate.toLowerCase())) continue;
      return candidate;
    }

    return '';
  }

  function normalizePublicationKey(value) {
    const publication = normalizePublication(value);
    if (!publication) return '';

    const explicitAcronym = extractPublicationAcronym(publication);
    if (explicitAcronym) return `acro:${explicitAcronym.toLowerCase()}`;

    let text = stripDiacritics(publication).toLowerCase();
    text = text
      .replace(/^proceedings\s+of\s+(?:the\s+)?/i, '')
      .replace(/^proc\.?\s*(?:of\s+)?(?:the\s+)?/i, '')
      .replace(/\(([^)]*)\)/g, ' $1 ')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9 ]+/g, ' ');

    const tokens = text
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean)
      .filter((token) => !/^\d{2,4}$/.test(token))
      .filter((token) => !/^\d+(?:st|nd|rd|th)$/.test(token))
      .filter((token) => !PUBLICATION_STOPWORDS.has(token));

    if (!tokens.length) return '';

    const acronymTokens = tokens.filter((token) => token.length >= 3);
    const derivedAcronym = acronymTokens.map((token) => token[0]).join('');
    if (
      derivedAcronym.length >= 3
      && derivedAcronym.length <= 8
      && !PUBLICATION_ACRONYM_BLOCKLIST.has(derivedAcronym.toLowerCase())
    ) {
      return `acro:${derivedAcronym.toLowerCase()}`;
    }

    return `text:${tokens.join('')}`;
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
    for (const [aff, count] of source.paperAffiliationCounts.entries()) {
      target.paperAffiliationCounts.set(aff, (target.paperAffiliationCounts.get(aff) || 0) + count);
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
    for (const [topic, count] of source.topicCounts.entries()) {
      target.topicCounts.set(topic, (target.topicCounts.get(topic) || 0) + count);
    }
    for (const [publication, count] of source.publicationCounts.entries()) {
      target.publicationCounts.set(publication, (target.publicationCounts.get(publication) || 0) + count);
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
          paperAffiliationCounts: new Map(),
          talkNameCounts: new Map(),
          paperNameCounts: new Map(),
          blogNameCounts: new Map(),
          topicCounts: new Map(),
          publicationCounts: new Map(),
        });
      }
      return buckets.get(key);
    };

    const addTopicCounts = (bucket, rawTopics) => {
      for (const rawTopic of (rawTopics || [])) {
        const canonicalTopic = canonicalizeKeyTopic(rawTopic) || collapseWhitespace(rawTopic);
        if (!canonicalTopic) continue;
        bucket.topicCounts.set(
          canonicalTopic,
          (bucket.topicCounts.get(canonicalTopic) || 0) + 1
        );
      }
    };

    for (const talk of (Array.isArray(talks) ? talks : [])) {
      const talkTopics = getTalkKeyTopics(talk, Infinity);
      for (const rawSpeaker of (talk.speakers || [])) {
        const speaker = normalizePersonRecord(rawSpeaker);
        if (!speaker.name) continue;
        const bucket = ensureBucketByName(speaker.name);
        if (!bucket) continue;
        bucket.talkCount += 1;
        bucket.nameCounts.set(speaker.name, (bucket.nameCounts.get(speaker.name) || 0) + 1);
        bucket.talkNameCounts.set(speaker.name, (bucket.talkNameCounts.get(speaker.name) || 0) + 1);
        addTopicCounts(bucket, talkTopics);
        if (speaker.affiliation) {
          const affiliation = normalizeAffiliation(speaker.affiliation);
          if (!affiliation) continue;
          bucket.affiliationCounts.set(
            affiliation,
            (bucket.affiliationCounts.get(affiliation) || 0) + 1
          );
        }
      }
    }

    for (const paper of (Array.isArray(papers) ? papers : [])) {
      const paperCitationCount = parsePaperCitationCount(paper);
      const isBlog = isBlogPaperRecord(paper);
      const paperTopics = getPaperKeyTopics(paper, Infinity);
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
        addTopicCounts(bucket, paperTopics);
        if (author.affiliation) {
          const affiliation = normalizeAffiliation(author.affiliation);
          if (!affiliation) continue;
          bucket.affiliationCounts.set(
            affiliation,
            (bucket.affiliationCounts.get(affiliation) || 0) + 1
          );
          bucket.paperAffiliationCounts.set(
            affiliation,
            (bucket.paperAffiliationCounts.get(affiliation) || 0) + 1
          );
        }
        if (!isBlog) {
          const publication = getPaperPrimaryPublication(paper);
          if (publication) {
            bucket.publicationCounts.set(
              publication,
              (bucket.publicationCounts.get(publication) || 0) + 1
            );
          }
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
        const topicBuckets = new Map();
        for (const [rawTopic, rawCount] of bucket.topicCounts.entries()) {
          const topic = canonicalizeKeyTopic(rawTopic) || collapseWhitespace(rawTopic);
          const count = Number(rawCount);
          if (!topic || !Number.isFinite(count) || count <= 0) continue;
          const key = normalizeTopicKey(topic);
          if (!key) continue;
          if (!topicBuckets.has(key)) {
            topicBuckets.set(key, { count: 0, labels: new Map() });
          }
          const topicBucket = topicBuckets.get(key);
          topicBucket.count += count;
          topicBucket.labels.set(topic, (topicBucket.labels.get(topic) || 0) + count);
        }

        const topics = [...topicBuckets.values()]
          .map((entry) => {
            const label = [...entry.labels.entries()]
              .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || '';
            return {
              name: label,
              count: Math.round(entry.count),
            };
          })
          .filter((entry) => entry.name && entry.count > 0)
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

        const affiliationBuckets = new Map();
        for (const [rawAffiliation, rawCount] of bucket.paperAffiliationCounts.entries()) {
          const affiliation = normalizeAffiliation(rawAffiliation);
          const count = Number(rawCount);
          if (!affiliation || !Number.isFinite(count) || count <= 0) continue;
          const key = normalizeAffiliationKey(affiliation);
          if (!key) continue;
          if (!affiliationBuckets.has(key)) {
            affiliationBuckets.set(key, { count: 0, labels: new Map() });
          }
          const affiliationBucket = affiliationBuckets.get(key);
          affiliationBucket.count += count;
          affiliationBucket.labels.set(
            affiliation,
            (affiliationBucket.labels.get(affiliation) || 0) + count
          );
        }

        const affiliations = [...affiliationBuckets.values()]
          .map((entry) => {
            const label = [...entry.labels.entries()]
              .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || '';
            return {
              name: label,
              count: Math.round(entry.count),
            };
          })
          .filter((entry) => entry.name && entry.count > 0)
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

        const publicationBuckets = new Map();
        for (const [rawPublication, rawCount] of bucket.publicationCounts.entries()) {
          const publication = normalizePublication(rawPublication);
          const count = Number(rawCount);
          if (!publication || !Number.isFinite(count) || count <= 0) continue;
          const key = normalizePublicationKey(publication);
          if (!key) continue;
          if (!publicationBuckets.has(key)) {
            publicationBuckets.set(key, { count: 0, labels: new Map() });
          }
          const publicationBucket = publicationBuckets.get(key);
          publicationBucket.count += count;
          publicationBucket.labels.set(
            publication,
            (publicationBucket.labels.get(publication) || 0) + count
          );
        }

        const scorePublicationLabel = (label, count) => {
          const clean = normalizePublication(label);
          const lower = clean.toLowerCase();
          let score = count * 100;
          if (/^proc\./i.test(clean) || /^proceedings of /i.test(clean)) score -= 5;
          if (/\btechnical report\b/i.test(lower)) score -= 4;
          if (/^masters thesis$/i.test(clean) || /^ph\.d\. thesis$/i.test(clean) || /^bachelor thesis$/i.test(clean)) score -= 2;
          score -= Math.max(0, clean.length - 100) * 0.03;
          return score;
        };

        const publications = [...publicationBuckets.values()]
          .map((entry) => {
            const label = [...entry.labels.entries()]
              .sort((a, b) =>
                scorePublicationLabel(b[0], b[1]) - scorePublicationLabel(a[0], a[1])
                || b[1] - a[1]
                || a[0].localeCompare(b[0])
              )[0]?.[0] || '';
            return {
              name: label,
              count: Math.round(entry.count),
            };
          })
          .filter((entry) => entry.name && entry.count > 0)
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

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
          topics,
          primaryTopic: topics[0]?.name || '',
          affiliations,
          primaryAffiliation: affiliations[0]?.name || '',
          publications,
          primaryPublication: publications[0]?.name || '',
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

  function safeDecodeURIComponent(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return String(value || '');
    }
  }

  function parseQueryString(search) {
    const query = String(search || '').replace(/^\?/, '');
    if (!query) return {};

    const out = {};
    for (const pair of query.split('&')) {
      if (!pair) continue;
      const parts = pair.split('=');
      const key = safeDecodeURIComponent(parts[0] || '').trim();
      if (!key) continue;
      const encodedValue = parts.slice(1).join('=');
      const decodedValue = safeDecodeURIComponent(encodedValue.replace(/\+/g, ' '));
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
    'beginner', 'beginners', 'intro', 'introduction', 'introductory',
    'newcomer', 'newcomers', 'starter', 'basics', 'tutorial', 'tutorials',
    'learn', 'novice', 'novices', 'primer', 'onboarding', 'foundations',
  ]);
  const BEGINNER_STRONG_INTENT_TOKENS = new Set([
    'beginner', 'beginners', 'newcomer', 'newcomers', 'starter', 'basics',
    'tutorial', 'tutorials', 'learn', 'novice', 'novices', 'primer',
    'onboarding', 'foundations',
  ]);
  const BEGINNER_INTRO_INTENT_TOKENS = new Set(['intro', 'introduction', 'introductory']);
  const BEGINNER_INTENT_PHRASE_RE = /\bfor beginners\b|\bgetting started\b|\bnew to\b|\bfirst steps?\b|\blearn llvm\b|\bbeginner[- ]friendly\b|\bfor new contributors\b/;
  const BEGINNER_INTRO_INTENT_PHRASE_RE = /\bintro(?:duction)?(?:\s+to)?\b/;
  const BEGINNER_SIGNAL_RE = /\bbeginner(?:s)?\b|\bfor beginners\b|\btutorial(?:s)?\b|\bgetting started\b|\bbasics\b|\bintro(?:duction)?\b|\bnew to\b|\bfirst steps?\b/;
  const BEGINNER_STRONG_SIGNAL_RE = /\bbeginner(?:s)?\b|\bfor beginners\b|\btutorial(?:s)?\b|\bgetting started\b|\bbasics\b|\bnew to\b|\bfirst steps?\b/;
  const BEGINNER_INTRO_SIGNAL_RE = /\bintro(?:duction)?(?:\s+to)?\b|\bintroductory\b/;
  const BEGINNER_AMBIGUOUS_SIGNAL_RE = BEGINNER_INTRO_SIGNAL_RE;
  const BEGINNER_ADVANCED_SIGNAL_RE = /\badvanced\b|\binternals?\b|\bdeep dive\b|\bexpert\b|\bproduction\b|\bstate of the art\b/;
  const BEGINNER_FALSE_POSITIVE_SIGNAL_RE = /\bbasic block(?:s)?\b|\bbasic-block(?:s)?\b/g;
  const FUNDAMENTALS_INTENT_TOKENS = new Set([
    'fundamental', 'fundamentals', 'overview', 'tutorial', 'tutorials',
    'guide', 'walkthrough', 'learn', 'learning',
  ]);
  const FUNDAMENTALS_INTENT_PHRASE_RE = /\bllvm fundamentals?\b|\bcompiler fundamentals?\b|\bhow llvm works\b|\blearning llvm\b|\blearn llvm\b/;
  const FUNDAMENTALS_SIGNAL_RE = /\bfundamentals?\b|\boverview\b|\btutorial(?:s)?\b|\bwalkthrough\b|\bguide\b|\blearn\b|\bintro(?:duction)?\b|\bgetting started\b|\bbasics\b/;
  const ADVANCED_RESEARCH_INTENT_TOKENS = new Set([
    'advanced', 'internals', 'architecture', 'research', 'benchmark', 'evaluation',
    'polyhedral', 'formal', 'proof', 'novel', 'survey', 'publication', 'papers',
    'theory', 'experimental', 'quantitative', 'analysis',
  ]);
  const ADVANCED_RESEARCH_INTENT_PHRASE_RE = /\bstate of the art\b|\bdeep dive\b|\bformal verification\b|\bcompiler research\b|\bexperimental evaluation\b|\bprogram analysis\b|\bperformance analysis\b|\bnovel (?:approach|method|technique)\b|\bpolyhedral\b/;
  const ADVANCED_RESEARCH_SIGNAL_RE = /\badvanced\b|\binternals?\b|\bdeep dive\b|\bresearch\b|\bbenchmark(?:ing)?\b|\bevaluation\b|\banalysis\b|\bpolyhedral\b|\bformal\b|\bnovel\b|\bstate of the art\b|\bsurvey\b|\bpublication\b/;
  const LLVM_SUBPROJECT_TOPICS = new Set([
    'LLVM',
    'llvm-libgcc',
    'Clang',
    'clang-tools-extra',
    'MLIR',
    'Flang',
    'flang-rt',
    'LLD',
    'LLDB',
    'CIRCT',
    'Polly',
    'OpenMP',
    'offload',
    'compiler-rt',
    'runtimes',
    'libc++',
    'libc++abi',
    'libc',
    'libclc',
    'libsycl',
    'libunwind',
    'BOLT',
    'orc-rt',
    'ORC JIT',
    'ClangIR',
    'cross-project-tests',
  ]);
  const SEARCH_BROAD_TOKENS = new Set([
    'llvm', 'compiler', 'compilers', 'toolchain', 'project', 'projects',
    'research', 'talk', 'talks', 'paper', 'papers', 'blog', 'blogs',
    'session', 'sessions', 'meeting', 'meetings', 'developers', 'library',
  ]);
  const SEARCH_LOW_SIGNAL_SYNONYMS = new Set([
    'start', 'starting', 'started', 'getting', 'learn', 'learning', 'basic', 'basics',
  ]);

  const SEARCH_TOKEN_ALIAS_MAP = {
    llvms: 'llvm',
    clangg: 'clang',
    clangd: 'clang',
    mlirs: 'mlir',
    clangtoolsextra: 'clang-tools-extra',
    libomp: 'openmp',
    libclc: 'libclc',
    libcxx: 'libc++',
    libcxxabi: 'libc++abi',
    llvmlibgcc: 'llvm-libgcc',
    orcrt: 'orc-rt',
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
    beginner: ['intro', 'introduction', 'introductory', 'tutorial', 'primer', 'novice'],
    beginners: ['beginner', 'intro', 'introduction', 'introductory', 'tutorial', 'novice'],
    intro: ['introduction', 'introductory', 'beginner', 'tutorial', 'primer', 'newcomer'],
    introduction: ['intro', 'introductory', 'beginner', 'tutorial', 'primer', 'newcomer'],
    introductory: ['intro', 'introduction', 'beginner', 'tutorial', 'primer'],
    novice: ['beginner', 'introduction', 'tutorial', 'starter'],
    novices: ['novice', 'beginner', 'introduction'],
    primer: ['introduction', 'intro', 'beginner', 'tutorial'],
    onboarding: ['beginner', 'introduction', 'tutorial', 'newcomer'],
    foundations: ['fundamentals', 'introduction', 'beginner'],
    compiler: ['llvm', 'clang', 'toolchain', 'codegen'],
    compilers: ['compiler', 'llvm', 'clang'],
    clang: ['frontend', 'c++'],
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
  const SEARCH_TOKEN_NORMALIZE_CACHE_MAX = 2048;
  const SEARCH_TOKEN_NORMALIZE_CACHE = new Map();

  let SEARCH_TOKEN_SYNONYMS = null;

  const SEARCH_QUERY_FIELD_ALIASES = {
    title: 'title',
    abstract: 'abstract',
    author: 'authors',
    authors: 'authors',
    speaker: 'authors',
    speakers: 'authors',
    person: 'authors',
    people: 'authors',
    topic: 'topics',
    topics: 'topics',
    tag: 'topics',
    tags: 'topics',
    keyword: 'topics',
    keywords: 'topics',
    subproject: 'topics',
    project: 'topics',
    component: 'topics',
    venue: 'venue',
    publication: 'venue',
    journal: 'venue',
    conference: 'venue',
    source: 'venue',
    type: 'type',
    kind: 'type',
    doctype: 'type',
    doc: 'type',
    year: 'year',
    since: 'since',
    after: 'since',
    from: 'since',
    before: 'before',
    until: 'before',
    to: 'before',
  };
  const SEARCH_QUERY_MODEL_FIELDS = ['title', 'abstract', 'authors', 'topics', 'venue', 'type'];
  const SEARCH_QUERY_WHERE_SCOPE_ALIASES = {
    any: 'anywhere',
    anywhere: 'anywhere',
    all: 'anywhere',
    anyfield: 'anywhere',
    anyfields: 'anywhere',
    anylocation: 'anywhere',
    title: 'title',
    titles: 'title',
    intitle: 'title',
    headline: 'title',
    abstract: 'abstract',
    abstracts: 'abstract',
    inabstract: 'abstract',
    content: 'abstract',
    body: 'abstract',
    fulltext: 'abstract',
  };

  const TALK_SEARCH_DOC_CACHE = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  const PAPER_SEARCH_DOC_CACHE = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  const TALK_TOPIC_TREND_INDEX_CACHE = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  const PAPER_TOPIC_TREND_INDEX_CACHE = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  const TALK_COMBO_TREND_INDEX_CACHE = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  const PAPER_COMBO_TREND_INDEX_CACHE = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  const TALK_COMBO_SET_CACHE = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  const PAPER_COMBO_SET_CACHE = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  const QUERY_COMBO_PROFILE_CACHE_MAX = 64;
  const QUERY_COMBO_PROFILE_CACHE = new Map();
  const SEARCH_CONTEXT_COMBO_TOPIC_HINTS = Object.freeze({
    llvm: ['pass', 'pipeline', 'optimization', 'codegen', 'frontend', 'backend', 'tutorial', 'introduction'],
    clang: ['frontend', 'ast', 'libtooling', 'diagnostics', 'tidy', 'tutorial'],
    mlir: ['dialect', 'transform', 'lowering', 'canonicalization', 'pipeline', 'scheduling', 'tutorial'],
    lldb: ['debugger', 'debug', 'symbol', 'dwarf', 'breakpoint', 'expression'],
    lld: ['linker', 'linking', 'relocation', 'lto', 'thinlto'],
    circt: ['hardware', 'dialect', 'lowering', 'pipeline', 'scheduling'],
    polly: ['polyhedral', 'optimization', 'scheduling', 'analysis'],
    openmp: ['parallel', 'offload', 'runtime', 'threads'],
    compilerrt: ['sanitizer', 'runtime', 'asan', 'ubsan', 'tsan'],
    bolt: ['postlink', 'optimization', 'profiling'],
    orcjit: ['jit', 'runtime', 'execution', 'linking'],
  });
  const TOPIC_TREND_QUERY_EXPANSIONS_MAX = 8;
  const SEARCH_SNIPPET_QUERY_MODEL_CACHE_MAX = 192;
  const SEARCH_SNIPPET_QUERY_MODEL_CACHE = new Map();
  const SEARCH_HIGHLIGHT_NEEDLE_CACHE_MAX = 192;
  const SEARCH_HIGHLIGHT_NEEDLE_CACHE = new Map();

  function cacheGet(cache, key) {
    if (!(cache instanceof Map) || !cache.has(key)) return null;
    const value = cache.get(key);
    cache.delete(key);
    cache.set(key, value);
    return value;
  }

  function cacheSet(cache, key, value, maxSize) {
    if (!(cache instanceof Map)) return value;
    if (cache.has(key)) cache.delete(key);
    else if (cache.size >= maxSize) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, value);
    return value;
  }

  function getSnippetQueryModelCacheKey(queryOrTokens) {
    if (typeof queryOrTokens === 'string') {
      const text = queryOrTokens.trim();
      return text ? `str:${text}` : '';
    }
    if (Array.isArray(queryOrTokens)) {
      const parts = queryOrTokens.map((value) => String(value || '').trim()).filter(Boolean);
      return parts.length ? `arr:${parts.join('\u0001')}` : '';
    }
    return '';
  }

  function resolveSnippetQueryModel(queryOrTokens) {
    const cacheKey = getSnippetQueryModelCacheKey(queryOrTokens);
    if (!cacheKey) return buildSearchQueryModel(queryOrTokens);
    const cached = cacheGet(SEARCH_SNIPPET_QUERY_MODEL_CACHE, cacheKey);
    if (cached) return cached;
    const model = buildSearchQueryModel(queryOrTokens);
    return cacheSet(SEARCH_SNIPPET_QUERY_MODEL_CACHE, cacheKey, model, SEARCH_SNIPPET_QUERY_MODEL_CACHE_MAX);
  }

  function normalizeSearchToken(value) {
    const cacheKey = String(value || '');
    const cached = cacheGet(SEARCH_TOKEN_NORMALIZE_CACHE, cacheKey);
    if (typeof cached === 'string') return cached;

    const raw = stripDiacritics(cacheKey.toLowerCase())
      .replace(/[’']/g, '')
      .trim();
    if (!raw) return cacheSet(SEARCH_TOKEN_NORMALIZE_CACHE, cacheKey, '', SEARCH_TOKEN_NORMALIZE_CACHE_MAX);
    const compact = raw
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9+#.-]+/g, '')
      .replace(/^-+|-+$/g, '')
      .replace(/^\.+|\.+$/g, '');
    if (!compact) return cacheSet(SEARCH_TOKEN_NORMALIZE_CACHE, cacheKey, '', SEARCH_TOKEN_NORMALIZE_CACHE_MAX);
    return cacheSet(
      SEARCH_TOKEN_NORMALIZE_CACHE,
      cacheKey,
      SEARCH_TOKEN_ALIAS_MAP[compact] || compact,
      SEARCH_TOKEN_NORMALIZE_CACHE_MAX
    );
  }

  function buildSearchTokenSynonyms() {
    const normalizedSynonyms = {};
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
      if (dedup.length) normalizedSynonyms[source] = dedup;
    }
    return normalizedSynonyms;
  }

  function getSearchTokenSynonymsForNormalizedToken(token) {
    const normalized = String(token || '');
    if (!normalized) return [];
    if (!SEARCH_TOKEN_SYNONYMS) SEARCH_TOKEN_SYNONYMS = buildSearchTokenSynonyms();
    return SEARCH_TOKEN_SYNONYMS[normalized] || [];
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

  function normalizeSearchFieldKey(value) {
    const key = String(value || '').trim().toLowerCase();
    if (!key) return '';
    return SEARCH_QUERY_FIELD_ALIASES[key] || '';
  }

  function normalizeSearchWhereScope(value) {
    const key = String(value || '').trim().toLowerCase();
    if (!key) return 'anywhere';
    return SEARCH_QUERY_WHERE_SCOPE_ALIASES[key] || 'anywhere';
  }

  function createEmptyFieldTermMap() {
    return {
      title: [],
      abstract: [],
      authors: [],
      topics: [],
      venue: [],
      type: [],
    };
  }

  function appendUniqueValue(list, value) {
    const source = Array.isArray(list) ? list : [];
    const normalized = collapseWhitespace(String(value || ''));
    if (!normalized) return;
    if (!source.includes(normalized)) source.push(normalized);
  }

  function appendUniqueToken(list, value) {
    const source = Array.isArray(list) ? list : [];
    const normalized = normalizeSearchToken(value);
    if (!normalized || normalized.length < 2) return;
    if (!source.includes(normalized)) source.push(normalized);
  }

  function parseAdvancedTermInput(value) {
    const tokens = [];
    const phrases = [];
    const input = String(value || '');
    if (!input.trim()) return { tokens, phrases };

    const re = /"([^"]+)"|(\S+)/g;
    let match;
    while ((match = re.exec(input)) !== null) {
      if (match[1]) {
        const phrase = normalizeSearchText(match[1]);
        if (phrase.length >= 3) appendUniqueValue(phrases, phrase);
        continue;
      }
      if (match[2]) appendUniqueToken(tokens, match[2]);
    }
    return { tokens, phrases };
  }

  function parseYearTerm(value) {
    const match = String(value || '').match(/\b(19|20)\d{2}\b/);
    if (!match) return 0;
    const year = parseInt(match[0], 10);
    return Number.isFinite(year) ? year : 0;
  }

  function normalizeYearRange(range) {
    if (!range || typeof range !== 'object') return { from: 0, to: 0 };
    const from = Number.isFinite(range.from) ? Math.floor(range.from) : 0;
    const to = Number.isFinite(range.to) ? Math.floor(range.to) : 0;
    if (from > 0 && to > 0) {
      if (from <= to) return { from, to };
      return { from: to, to: from };
    }
    return { from: from > 0 ? from : 0, to: to > 0 ? to : 0 };
  }

  function mergeYearRange(range, nextFrom = 0, nextTo = 0) {
    const normalized = normalizeYearRange(range);
    const sourceFrom = Number.isFinite(nextFrom) ? Math.floor(nextFrom) : 0;
    const sourceTo = Number.isFinite(nextTo) ? Math.floor(nextTo) : 0;
    if (sourceFrom > 0) {
      normalized.from = normalized.from > 0 ? Math.max(normalized.from, sourceFrom) : sourceFrom;
    }
    if (sourceTo > 0) {
      normalized.to = normalized.to > 0 ? Math.min(normalized.to, sourceTo) : sourceTo;
    }
    if (normalized.from > 0 && normalized.to > 0 && normalized.from > normalized.to) {
      normalized.from = 0;
      normalized.to = 0;
    }
    return normalized;
  }

  function parseYearRangeExpression(value) {
    const input = collapseWhitespace(String(value || ''));
    if (!input) return { from: 0, to: 0 };

    const rangeMatch = input.match(/\b((?:19|20)\d{2})\s*(?:-|to|:|\/)\s*((?:19|20)\d{2})\b/i);
    if (rangeMatch) {
      const from = parseInt(rangeMatch[1], 10);
      const to = parseInt(rangeMatch[2], 10);
      return normalizeYearRange({ from, to });
    }

    const single = parseYearTerm(input);
    if (single > 0) return { from: single, to: single };
    return { from: 0, to: 0 };
  }

  function buildFieldClauseMap(fieldTokens) {
    const out = {};
    const source = fieldTokens && typeof fieldTokens === 'object' ? fieldTokens : {};
    for (const field of SEARCH_QUERY_MODEL_FIELDS) {
      const clauses = buildQueryClauses(source[field]);
      if (clauses.length) out[field] = clauses;
    }
    return out;
  }

  function buildFieldPhraseMap(fieldPhrases) {
    const out = {};
    const source = fieldPhrases && typeof fieldPhrases === 'object' ? fieldPhrases : {};
    for (const field of SEARCH_QUERY_MODEL_FIELDS) {
      const values = [];
      const seen = new Set();
      for (const rawPhrase of (source[field] || [])) {
        const phrase = normalizeSearchText(rawPhrase);
        if (!phrase || phrase.length < 2 || seen.has(phrase)) continue;
        seen.add(phrase);
        values.push({ value: phrase, weight: 1.0 });
      }
      if (values.length) out[field] = values;
    }
    return out;
  }

  function hasFieldConstraints(fieldMap) {
    if (!fieldMap || typeof fieldMap !== 'object') return false;
    for (const field of SEARCH_QUERY_MODEL_FIELDS) {
      const clauses = fieldMap[field];
      if (Array.isArray(clauses) && clauses.length) return true;
    }
    return false;
  }

  function hasFieldPhraseConstraints(fieldMap) {
    if (!fieldMap || typeof fieldMap !== 'object') return false;
    for (const field of SEARCH_QUERY_MODEL_FIELDS) {
      const phrases = fieldMap[field];
      if (Array.isArray(phrases) && phrases.length) return true;
    }
    return false;
  }

  function modelHasSearchConstraints(model) {
    if (!model || typeof model !== 'object') return false;
    if (Array.isArray(model.clauses) && model.clauses.length) return true;
    if (Array.isArray(model.anyClauses) && model.anyClauses.length) return true;
    if (Array.isArray(model.excludeClauses) && model.excludeClauses.length) return true;
    if (Array.isArray(model.phrases) && model.phrases.length) return true;
    if (Array.isArray(model.requiredPhrases) && model.requiredPhrases.length) return true;
    if (Array.isArray(model.anyPhrases) && model.anyPhrases.length) return true;
    if (Array.isArray(model.excludePhrases) && model.excludePhrases.length) return true;
    if (hasFieldConstraints(model.fieldClauses)) return true;
    if (hasFieldConstraints(model.excludeFieldClauses)) return true;
    if (hasFieldPhraseConstraints(model.fieldPhrases)) return true;
    if (hasFieldPhraseConstraints(model.excludeFieldPhrases)) return true;
    if (model.yearRange && (model.yearRange.from > 0 || model.yearRange.to > 0)) return true;
    return false;
  }

  function parseQuerySegments(query) {
    const raw = String(query || '');
    const tokens = [];
    const excludeTokens = [];
    const phrases = [];
    const excludePhrases = [];
    const includeFieldTerms = createEmptyFieldTermMap();
    const excludeFieldTerms = createEmptyFieldTermMap();
    const includeFieldPhrases = createEmptyFieldTermMap();
    const excludeFieldPhrases = createEmptyFieldTermMap();
    let yearRange = { from: 0, to: 0 };
    const re = /([+-]?[A-Za-z][A-Za-z0-9_-]*:)"([^"]+)"|([+-])"([^"]+)"|"([^"]+)"|(\S+)/g;
    let match;

    const addGeneral = (value, excluded = false) => {
      const normalizedPhrase = normalizeSearchText(value);
      if (normalizedPhrase.length >= 3) {
        if (excluded) appendUniqueValue(excludePhrases, normalizedPhrase);
        else appendUniqueValue(phrases, normalizedPhrase);
      }
      const target = excluded ? excludeTokens : tokens;
      for (const token of tokenizeSearchText(value, 2)) appendUniqueToken(target, token);
    };

    const addField = (fieldKey, value, excluded = false, phraseMode = false) => {
      if (!fieldKey || !value) return;
      const normalizedField = normalizeSearchFieldKey(fieldKey);
      if (!normalizedField) return;

      if (normalizedField === 'since' || normalizedField === 'before' || normalizedField === 'year') {
        if (excluded) return;
        if (normalizedField === 'year') {
          const range = parseYearRangeExpression(value);
          yearRange = mergeYearRange(yearRange, range.from, range.to);
          return;
        }
        const year = parseYearTerm(value);
        if (!year) return;
        if (normalizedField === 'since') yearRange = mergeYearRange(yearRange, year, 0);
        else if (normalizedField === 'before') yearRange = mergeYearRange(yearRange, 0, year);
        return;
      }

      const termBucket = excluded ? excludeFieldTerms : includeFieldTerms;
      const phraseBucket = excluded ? excludeFieldPhrases : includeFieldPhrases;

      if (phraseMode) {
        const normalizedPhrase = normalizeSearchText(value);
        if (normalizedPhrase.length >= 3) appendUniqueValue(phraseBucket[normalizedField], normalizedPhrase);
      }

      for (const token of tokenizeSearchText(value, 2)) {
        appendUniqueToken(termBucket[normalizedField], token);
      }
    };

    while ((match = re.exec(raw)) !== null) {
      const fieldPrefix = match[1];
      const fieldPhraseSource = match[2];
      const signedPhrasePrefix = match[3];
      const signedPhraseSource = match[4];
      const plainPhraseSource = match[5];
      const chunkSource = match[6];

      if (fieldPrefix) {
        let rawPrefix = String(fieldPrefix || '').trim();
        let excluded = false;
        if (rawPrefix.startsWith('-')) {
          excluded = true;
          rawPrefix = rawPrefix.slice(1);
        } else if (rawPrefix.startsWith('+')) {
          rawPrefix = rawPrefix.slice(1);
        }
        const fieldKey = rawPrefix.endsWith(':') ? rawPrefix.slice(0, -1) : rawPrefix;
        addField(fieldKey, fieldPhraseSource, excluded, true);
        continue;
      }

      if (signedPhraseSource) {
        addGeneral(signedPhraseSource, signedPhrasePrefix === '-');
        continue;
      }

      if (plainPhraseSource) {
        addGeneral(plainPhraseSource, false);
        continue;
      }

      if (chunkSource) {
        let chunk = String(chunkSource || '').trim();
        if (!chunk) continue;

        let excluded = false;
        if (chunk.startsWith('-')) {
          excluded = true;
          chunk = chunk.slice(1);
        } else if (chunk.startsWith('+')) {
          chunk = chunk.slice(1);
        }
        if (!chunk) continue;

        const fieldMatch = chunk.match(/^([A-Za-z][A-Za-z0-9_-]*):(.*)$/);
        if (fieldMatch) {
          const fieldKey = fieldMatch[1];
          const fieldValue = collapseWhitespace(fieldMatch[2]);
          if (fieldValue) {
            addField(fieldKey, fieldValue, excluded, fieldValue.includes(' '));
            continue;
          }
        }

        const normalizedToken = normalizeSearchToken(chunk);
        if (normalizedToken.length >= 2) {
          if (excluded) appendUniqueToken(excludeTokens, normalizedToken);
          else appendUniqueToken(tokens, normalizedToken);
        }
      }
    }

    yearRange = normalizeYearRange(yearRange);
    return {
      tokens,
      excludeTokens,
      phrases,
      excludePhrases,
      includeFieldTerms,
      excludeFieldTerms,
      includeFieldPhrases,
      excludeFieldPhrases,
      yearRange,
    };
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

      const synonyms = getSearchTokenSynonymsForNormalizedToken(token);
      for (const synonym of synonyms) {
        const normalizedSynonym = normalizeSearchToken(synonym);
        if (!normalizedSynonym) continue;
        if (SEARCH_LOW_SIGNAL_SYNONYMS.has(normalizedSynonym)) continue;
        addVariant(normalizedSynonym, 0.64);
      }

      return {
        token,
        isBroad: SEARCH_BROAD_TOKENS.has(token),
        isBeginnerClause: BEGINNER_INTENT_TOKENS.has(token),
        specificity: 1 + Math.min(0.75, Math.max(0, token.length - 2) * 0.08),
        variants: [...variantMap.entries()].map(([term, weight]) => ({ term, weight })),
      };
    });
  }

  function collectCanonicalTopicsFromQuery(seedValues, textValues) {
    const seeds = [];
    for (const value of (seedValues || [])) {
      const token = normalizeSearchText(value);
      if (token) seeds.push(token);
    }

    const text = (textValues || [])
      .map((value) => normalizeSearchText(value))
      .filter(Boolean)
      .join(' ');

    return collectCanonicalTopics(seeds, text);
  }

  function computeSubprojectTopicsFromQuery(seedValues, textValues) {
    const topics = collectCanonicalTopicsFromQuery(seedValues, textValues);
    return topics.filter((topic) => LLVM_SUBPROJECT_TOPICS.has(topic));
  }

  function buildSearchQueryModel(input, options = {}) {
    const isArrayInput = Array.isArray(input);
    const fromArrayTokens = isArrayInput
      ? input.map((value) => normalizeSearchToken(value)).filter((value) => value.length >= 2)
      : [];
    const parsed = isArrayInput
      ? {
        tokens: fromArrayTokens,
        excludeTokens: [],
        phrases: [],
        excludePhrases: [],
        includeFieldTerms: createEmptyFieldTermMap(),
        excludeFieldTerms: createEmptyFieldTermMap(),
        includeFieldPhrases: createEmptyFieldTermMap(),
        excludeFieldPhrases: createEmptyFieldTermMap(),
        yearRange: { from: 0, to: 0 },
      }
      : parseQuerySegments(input);
    const advanced = options && typeof options === 'object' ? options : {};
    const requiredPhrases = [];
    const anyTokens = [];
    const anyPhrases = [];

    const appendTermsAsRequired = (value) => {
      const parsedTerms = parseAdvancedTermInput(value);
      for (const token of parsedTerms.tokens) appendUniqueToken(parsed.tokens, token);
      for (const phrase of parsedTerms.phrases) {
        appendUniqueValue(parsed.phrases, phrase);
        appendUniqueValue(requiredPhrases, phrase);
      }
    };

    const appendTermsAsAny = (value) => {
      const parsedTerms = parseAdvancedTermInput(value);
      for (const token of parsedTerms.tokens) appendUniqueToken(anyTokens, token);
      for (const phrase of parsedTerms.phrases) appendUniqueValue(anyPhrases, phrase);
    };

    const appendTermsAsExcluded = (value) => {
      const parsedTerms = parseAdvancedTermInput(value);
      for (const token of parsedTerms.tokens) appendUniqueToken(parsed.excludeTokens, token);
      for (const phrase of parsedTerms.phrases) appendUniqueValue(parsed.excludePhrases, phrase);
    };

    const appendFieldConstraint = (fieldKey, value) => {
      const normalizedField = normalizeSearchFieldKey(fieldKey);
      if (!normalizedField || normalizedField === 'since' || normalizedField === 'before' || normalizedField === 'year') {
        return;
      }
      const raw = collapseWhitespace(value);
      if (!raw) return;
      for (const token of tokenizeSearchText(raw, 2)) {
        appendUniqueToken(parsed.includeFieldTerms[normalizedField], token);
      }
      const phrase = normalizeSearchText(raw);
      if (phrase.length >= 3) appendUniqueValue(parsed.includeFieldPhrases[normalizedField], phrase);
    };

    appendTermsAsRequired(advanced.allWords);
    appendTermsAsAny(advanced.anyWords);
    appendTermsAsExcluded(advanced.withoutWords);

    const exactPhrase = normalizeSearchText(advanced.exactPhrase || '');
    if (exactPhrase.length >= 3) {
      appendUniqueValue(parsed.phrases, exactPhrase);
      appendUniqueValue(requiredPhrases, exactPhrase);
    }

    appendFieldConstraint('authors', advanced.author);
    appendFieldConstraint('venue', advanced.publication);

    const advancedYearFrom = parseYearTerm(advanced.yearFrom);
    const advancedYearTo = parseYearTerm(advanced.yearTo);
    parsed.yearRange = mergeYearRange(parsed.yearRange, advancedYearFrom, advancedYearTo);

    const whereScope = normalizeSearchWhereScope(advanced.where);
    const tokens = parsed.tokens;
    const clauses = buildQueryClauses(tokens);
    const anyClauses = buildQueryClauses(anyTokens);
    const excludeClauses = buildQueryClauses(parsed.excludeTokens || []);
    const fieldClauses = buildFieldClauseMap(parsed.includeFieldTerms);
    const excludeFieldClauses = buildFieldClauseMap(parsed.excludeFieldTerms);
    const fieldPhrases = buildFieldPhraseMap(parsed.includeFieldPhrases);
    const excludeFieldPhrases = buildFieldPhraseMap(parsed.excludeFieldPhrases);
    const normalizedQuery = normalizeSearchText(isArrayInput ? fromArrayTokens.join(' ') : String(input || ''));
    const phrases = [];
    const excludePhrases = [];
    const phraseSeen = new Set();
    const excludePhraseSeen = new Set();

    for (const phrase of parsed.phrases || []) {
      if (!phrase || phraseSeen.has(phrase)) continue;
      phraseSeen.add(phrase);
      phrases.push({ value: phrase, weight: 1.0 });
    }
    for (const phrase of parsed.excludePhrases || []) {
      if (!phrase || excludePhraseSeen.has(phrase)) continue;
      excludePhraseSeen.add(phrase);
      excludePhrases.push(phrase);
    }

    const requiredPhraseValues = [];
    const requiredPhraseSeen = new Set();
    for (const phrase of requiredPhrases) {
      const normalizedPhrase = normalizeSearchText(phrase);
      if (!normalizedPhrase || normalizedPhrase.length < 3 || requiredPhraseSeen.has(normalizedPhrase)) continue;
      requiredPhraseSeen.add(normalizedPhrase);
      requiredPhraseValues.push(normalizedPhrase);
    }

    const anyPhraseValues = [];
    const anyPhraseSeen = new Set();
    for (const phrase of anyPhrases) {
      const normalizedPhrase = normalizeSearchText(phrase);
      if (!normalizedPhrase || normalizedPhrase.length < 3 || anyPhraseSeen.has(normalizedPhrase)) continue;
      anyPhraseSeen.add(normalizedPhrase);
      anyPhraseValues.push(normalizedPhrase);
    }
    const requiredPhraseEntries = requiredPhraseValues.map((value) => ({ value, weight: 1 }));
    const anyPhraseEntries = anyPhraseValues.map((value) => ({ value, weight: 1 }));

    const intentTokens = [
      ...tokens,
      ...anyTokens,
      ...((parsed.includeFieldTerms && parsed.includeFieldTerms.topics) || []),
      ...((parsed.includeFieldTerms && parsed.includeFieldTerms.type) || []),
    ];
    const intentTexts = [
      normalizedQuery,
      ...requiredPhraseValues,
      ...anyPhraseValues,
      ...((parsed.includeFieldPhrases && parsed.includeFieldPhrases.topics) || []),
      ...((parsed.includeFieldPhrases && parsed.includeFieldPhrases.type) || []),
    ];

    const advancedResearchTokenIntent = intentTokens.some((token) => ADVANCED_RESEARCH_INTENT_TOKENS.has(token));
    const advancedResearchPhraseIntent = intentTexts.some((value) => {
      const text = String(value || '');
      return text ? ADVANCED_RESEARCH_INTENT_PHRASE_RE.test(text) : false;
    });
    const advancedResearchRawIntent = advancedResearchTokenIntent || advancedResearchPhraseIntent;

    const beginnerTokenIntent = intentTokens.some((token) => BEGINNER_INTENT_TOKENS.has(token));
    const beginnerStrongTokenIntent = intentTokens.some((token) => BEGINNER_STRONG_INTENT_TOKENS.has(token));
    const beginnerIntroTokenIntent = intentTokens.some((token) => BEGINNER_INTRO_INTENT_TOKENS.has(token));
    const beginnerStrongPhraseIntent = intentTexts.some((value) => {
      const text = String(value || '');
      return text ? BEGINNER_INTENT_PHRASE_RE.test(text) : false;
    });
    const beginnerIntroPhraseIntent = intentTexts.some((value) => {
      const text = String(value || '');
      return text ? BEGINNER_INTRO_INTENT_PHRASE_RE.test(text) : false;
    });
    const beginnerIntent = beginnerStrongTokenIntent
      || beginnerStrongPhraseIntent
      || ((beginnerTokenIntent || beginnerIntroTokenIntent || beginnerIntroPhraseIntent) && !advancedResearchRawIntent);

    const fundamentalsTokenIntent = intentTokens.some((token) => FUNDAMENTALS_INTENT_TOKENS.has(token));
    const fundamentalsPhraseIntent = intentTexts.some((value) => {
      const text = String(value || '');
      return text ? FUNDAMENTALS_INTENT_PHRASE_RE.test(text) : false;
    });
    const fundamentalsIntent = beginnerIntent || fundamentalsTokenIntent || fundamentalsPhraseIntent;

    const advancedResearchIntent = advancedResearchRawIntent
      && !(beginnerStrongTokenIntent || beginnerStrongPhraseIntent);

    const contextProfile = beginnerIntent
      ? 'beginner'
      : (advancedResearchIntent ? 'advanced-research' : (fundamentalsIntent ? 'fundamentals' : 'general'));

    const queryTopics = collectCanonicalTopicsFromQuery(
      [
        ...intentTokens,
        ...requiredPhraseValues,
        ...anyPhraseValues,
      ],
      intentTexts
    );
    const subprojectTopics = computeSubprojectTopicsFromQuery(
      [
        ...intentTokens,
        ...requiredPhraseValues,
        ...anyPhraseValues,
      ],
      intentTexts
    );
    const subprojectTopicKeys = subprojectTopics.map((topic) => normalizeTopicKey(topic));

    if (normalizedQuery && normalizedQuery.includes(' ') && normalizedQuery.length <= 80 && !phraseSeen.has(normalizedQuery)) {
      const implicitPhraseWeight = beginnerIntent
        ? 0.52
        : (tokens.length >= 4 ? 1.02 : (tokens.length === 3 ? 0.82 : 0.64));
      phrases.push({ value: normalizedQuery, weight: implicitPhraseWeight });
      phraseSeen.add(normalizedQuery);
    }

    const hasNarrowClauses = clauses.some((clause) => !clause.isBroad);
    const requiredClauseCount = hasNarrowClauses
      ? clauses.filter((clause) => !clause.isBroad).length
      : clauses.length;

    const queryModel = {
      rawTokens: tokens,
      clauses,
      anyClauses,
      excludeClauses,
      fieldClauses,
      excludeFieldClauses,
      fieldPhrases,
      excludeFieldPhrases,
      requiredPhrases: requiredPhraseValues,
      requiredPhraseEntries,
      anyPhrases: anyPhraseValues,
      anyPhraseEntries,
      excludePhrases,
      requiredClauseCount,
      phrases,
      normalizedQuery,
      beginnerIntent,
      fundamentalsIntent,
      advancedResearchIntent,
      contextProfile,
      queryTopics,
      subprojectTopics,
      subprojectTopicKeys,
      subprojectIntent: subprojectTopics.length > 0,
      whereScope,
      yearRange: normalizeYearRange(parsed.yearRange || {}),
      hasFilters: hasFieldConstraints(fieldClauses)
        || hasFieldConstraints(excludeFieldClauses)
        || hasFieldPhraseConstraints(fieldPhrases)
        || hasFieldPhraseConstraints(excludeFieldPhrases)
        || anyClauses.length > 0
        || anyPhraseValues.length > 0
        || requiredPhraseValues.length > 0
        || excludeClauses.length > 0
        || excludePhrases.length > 0
        || whereScope !== 'anywhere'
        || (parsed.yearRange && (parsed.yearRange.from > 0 || parsed.yearRange.to > 0)),
    };
    queryModel.hasSearchConstraints = modelHasSearchConstraints(queryModel);
    return queryModel;
  }

  function stripSearchSnippetSource(value) {
    const raw = String(value || '');
    if (!raw) return '';
    return collapseWhitespace(
      raw
        .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]+)]\([^)]*\)/g, '$1 ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[`*_>#~|]/g, ' ')
    );
  }

  function truncateSearchSnippet(text, maxLength) {
    const value = collapseWhitespace(text);
    if (!value) return '';
    if (value.length <= maxLength) return value;
    const hardSlice = value.slice(0, maxLength).trim();
    const softSlice = hardSlice.replace(/\s+\S*$/, '').trim();
    const trimmed = softSlice || hardSlice;
    return `${trimmed}...`;
  }

  function buildSearchSnippet(sourceText, queryOrTokens, options = {}) {
    const maxLength = Number.isFinite(options.maxLength)
      ? Math.max(90, Math.min(600, Math.floor(options.maxLength)))
      : 220;
    const text = stripSearchSnippetSource(sourceText);
    if (!text) return '';
    if (text.length <= maxLength) return text;

    const model = resolveSnippetQueryModel(queryOrTokens);
    if ((!model || !Array.isArray(model.clauses) || !model.clauses.length) && !(model && model.normalizedQuery)) {
      return truncateSearchSnippet(text, maxLength);
    }

    const haystack = text.toLowerCase();
    const candidates = [];
    const candidateSeen = new Set();

    const recordCandidate = (index, length, score) => {
      if (!Number.isFinite(index) || index < 0) return;
      if (!Number.isFinite(length) || length <= 0) return;
      if (!Number.isFinite(score)) return;
      const key = `${index}:${length}`;
      if (candidateSeen.has(key)) return;
      candidateSeen.add(key);
      candidates.push({ index, length, score });
    };

    const considerNeedle = (rawNeedle, baseScore) => {
      const rawValue = String(rawNeedle || '').trim().toLowerCase();
      if (!rawValue) return;
      const needle = rawValue.includes(' ')
        ? collapseWhitespace(rawValue)
        : normalizeSearchToken(rawValue);
      if (!needle || needle.length < 2) return;

      let matches = 0;
      let offset = 0;
      while (offset < haystack.length) {
        const index = haystack.indexOf(needle, offset);
        if (index < 0) break;

        const before = index > 0 ? haystack[index - 1] : ' ';
        const after = index + needle.length < haystack.length ? haystack[index + needle.length] : ' ';
        const startBoundary = /[^a-z0-9+#.]/.test(before);
        const endBoundary = /[^a-z0-9+#.]/.test(after);
        const boundaryBonus = (startBoundary ? 1.8 : 0) + (endBoundary ? 1.8 : 0);
        const score = baseScore + (needle.length * 0.22) + boundaryBonus - (index * 0.00035);
        recordCandidate(index, needle.length, score);

        offset = index + needle.length;
        matches += 1;
        if (matches >= 36) break;
      }
    };

    for (const phraseEntry of (model.phrases || [])) {
      const phrase = String(phraseEntry && phraseEntry.value || '').trim();
      if (!phrase || phrase.length < 2) continue;
      const phraseWeight = Number(phraseEntry && phraseEntry.weight) || 1;
      considerNeedle(phrase, 34 + (phraseWeight * 8));
    }

    for (const phraseEntry of (model.requiredPhraseEntries || [])) {
      const phrase = String(phraseEntry && phraseEntry.value || '').trim();
      if (!phrase || phrase.length < 2) continue;
      considerNeedle(phrase, 40);
    }

    for (const phraseEntry of (model.anyPhraseEntries || [])) {
      const phrase = String(phraseEntry && phraseEntry.value || '').trim();
      if (!phrase || phrase.length < 2) continue;
      considerNeedle(phrase, 30);
    }

    for (const clause of (model.clauses || [])) {
      if (!clause || !clause.token) continue;
      considerNeedle(clause.token, 23 + ((clause.specificity || 1) * 2));
      for (const variant of (clause.variants || [])) {
        if (!variant || !variant.term || variant.term === clause.token) continue;
        const variantWeight = Number(variant.weight) || 0;
        if (variantWeight <= 0) continue;
        const synonymPenalty = variantWeight < 0.7 ? 6 : 0;
        considerNeedle(variant.term, 16 + (variantWeight * 6) - synonymPenalty);
      }
    }

    for (const clause of (model.anyClauses || [])) {
      if (!clause || !clause.token) continue;
      considerNeedle(clause.token, 18 + ((clause.specificity || 1) * 1.4));
    }

    if (!candidates.length) {
      return truncateSearchSnippet(text, maxLength);
    }

    const clauseNeedles = [];
    const clauseNeedleSeen = new Set();
    for (const clause of (model.clauses || [])) {
      const token = normalizeSearchToken(clause && clause.token);
      if (!token || clauseNeedleSeen.has(token)) continue;
      clauseNeedleSeen.add(token);
      clauseNeedles.push(token);
    }
    for (const clause of (model.anyClauses || [])) {
      const token = normalizeSearchToken(clause && clause.token);
      if (!token || clauseNeedleSeen.has(token)) continue;
      clauseNeedleSeen.add(token);
      clauseNeedles.push(token);
    }
    const phraseNeedles = [];
    const phraseNeedleSeen = new Set();
    const appendPhraseNeedle = (value) => {
      const phrase = normalizeSearchText(value);
      if (!phrase || !phrase.includes(' ') || phraseNeedleSeen.has(phrase)) return;
      phraseNeedleSeen.add(phrase);
      phraseNeedles.push(phrase);
    };
    for (const phraseEntry of (model.requiredPhraseEntries || [])) appendPhraseNeedle(phraseEntry && phraseEntry.value);
    for (const phraseEntry of (model.anyPhraseEntries || [])) appendPhraseNeedle(phraseEntry && phraseEntry.value);
    for (const phraseEntry of (model.phrases || [])) appendPhraseNeedle(phraseEntry && phraseEntry.value);

    const alignSnippetWindow = (center) => {
      let start = Math.max(0, center - Math.floor(maxLength / 2));
      let end = Math.min(text.length, start + maxLength);
      if (end - start < maxLength) start = Math.max(0, end - maxLength);

      if (start > 0) {
        const nextSpace = text.indexOf(' ', start);
        if (nextSpace !== -1 && nextSpace - start <= 24) start = nextSpace + 1;
      }

      if (end < text.length) {
        const prevSpace = text.lastIndexOf(' ', end);
        if (prevSpace > start + Math.floor(maxLength * 0.55)) end = prevSpace;
      }
      return { start, end };
    };

    const scoreSnippetWindow = (start, end, baseScore) => {
      const windowText = haystack.slice(start, end);
      if (!windowText) return baseScore;

      let clauseHits = 0;
      for (const token of clauseNeedles) {
        if (hasSpaceDelimitedMatch(windowText, token) || windowText === token) clauseHits += 1;
      }

      let phraseHits = 0;
      for (const phrase of phraseNeedles) {
        if (windowText.includes(phrase)) phraseHits += 1;
      }

      const clauseCoverage = clauseNeedles.length ? (clauseHits / clauseNeedles.length) : 0;
      const phraseCoverage = phraseNeedles.length ? (phraseHits / phraseNeedles.length) : 0;

      return baseScore
        + (clauseHits * 3.2)
        + (phraseHits * 6.8)
        + (clauseCoverage * 10.6)
        + (phraseCoverage * 15.2)
        - (start * 0.00022);
    };

    let bestWindow = null;
    let bestWindowScore = -Infinity;
    for (const candidate of candidates) {
      const center = candidate.index + Math.floor(candidate.length / 2);
      const window = alignSnippetWindow(center);
      const windowScore = scoreSnippetWindow(window.start, window.end, candidate.score);
      if (windowScore <= bestWindowScore) continue;
      bestWindowScore = windowScore;
      bestWindow = window;
    }

    if (!bestWindow) return truncateSearchSnippet(text, maxLength);

    let snippet = text.slice(bestWindow.start, bestWindow.end).trim();
    if (!snippet) return truncateSearchSnippet(text, maxLength);
    if (bestWindow.start > 0) snippet = `...${snippet}`;
    if (bestWindow.end < text.length) snippet = `${snippet}...`;
    return snippet;
  }

  function escapeSearchHighlightHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeSearchRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function isSearchBoundaryChar(char) {
    return !char || /[^a-z0-9+#.]/.test(char);
  }

  function findBoundaryTermRanges(text, rawTerm, options = {}) {
    const source = String(text || '');
    const term = String(rawTerm || '').toLowerCase();
    if (!source || !term) return [];

    const maxMatches = Number.isFinite(options.maxMatches) && options.maxMatches > 0
      ? Math.floor(options.maxMatches)
      : Number.POSITIVE_INFINITY;
    const haystack = source.toLowerCase();
    const ranges = [];
    let offset = 0;
    while (offset < haystack.length && ranges.length < maxMatches) {
      const index = haystack.indexOf(term, offset);
      if (index < 0) break;
      const before = index > 0 ? haystack[index - 1] : ' ';
      const after = index + term.length < haystack.length ? haystack[index + term.length] : ' ';
      if (isSearchBoundaryChar(before) && isSearchBoundaryChar(after)) {
        ranges.push({ start: index, end: index + term.length });
      }
      offset = index + 1;
    }
    return ranges;
  }

  function findPhraseRanges(text, rawPhrase, options = {}) {
    const source = String(text || '');
    const phrase = normalizeSearchText(rawPhrase);
    if (!source || !phrase || !phrase.includes(' ')) return [];

    const parts = phrase.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return [];

    const maxMatches = Number.isFinite(options.maxMatches) && options.maxMatches > 0
      ? Math.floor(options.maxMatches)
      : Number.POSITIVE_INFINITY;
    const body = parts.map((part) => escapeSearchRegex(part)).join('\\s+');
    const regex = new RegExp(`(^|[^a-z0-9+#.])(${body})(?=$|[^a-z0-9+#.])`, 'gi');
    const ranges = [];
    let match;
    while ((match = regex.exec(source)) !== null && ranges.length < maxMatches) {
      const prefix = match[1] || '';
      const phraseValue = match[2] || '';
      const start = match.index + prefix.length;
      const end = start + phraseValue.length;
      ranges.push({ start, end });
      if (match[0].length === 0) regex.lastIndex += 1;
    }
    return ranges;
  }

  function collectHighlightNeedlesFromModel(model) {
    const phraseNeedles = [];
    const tokenNeedles = [];
    const phraseSeen = new Set();
    const tokenSeen = new Set();

    const appendPhrase = (value) => {
      const normalized = normalizeSearchText(value);
      if (!normalized || !normalized.includes(' ') || phraseSeen.has(normalized)) return;
      phraseSeen.add(normalized);
      phraseNeedles.push(normalized);
    };
    const appendToken = (value) => {
      const normalized = normalizeSearchToken(value);
      if (!normalized || normalized.length < 2 || tokenSeen.has(normalized)) return;
      tokenSeen.add(normalized);
      tokenNeedles.push(normalized);
    };

    for (const entry of (model && model.requiredPhraseEntries) || []) appendPhrase(entry && entry.value);
    for (const entry of (model && model.anyPhraseEntries) || []) appendPhrase(entry && entry.value);
    for (const entry of (model && model.phrases) || []) appendPhrase(entry && entry.value);
    appendPhrase(model && model.normalizedQuery);

    for (const clause of (model && model.clauses) || []) appendToken(clause && clause.token);
    for (const clause of (model && model.anyClauses) || []) appendToken(clause && clause.token);

    if (!phraseNeedles.length) {
      const rawTokens = Array.isArray(model && model.rawTokens) ? model.rawTokens : [];
      if (rawTokens.length >= 2) appendPhrase(rawTokens.join(' '));
    }

    phraseNeedles.sort((a, b) => b.length - a.length);
    tokenNeedles.sort((a, b) => b.length - a.length);

    return { phraseNeedles, tokenNeedles };
  }

  function resolveHighlightNeedles(queryOrTokens) {
    const modelLike = !!(
      queryOrTokens
      && typeof queryOrTokens === 'object'
      && !Array.isArray(queryOrTokens)
      && (
        Array.isArray(queryOrTokens.clauses)
        || Array.isArray(queryOrTokens.rawTokens)
        || typeof queryOrTokens.normalizedQuery === 'string'
      )
    );
    const cacheKey = modelLike ? '' : getSnippetQueryModelCacheKey(queryOrTokens);
    if (cacheKey) {
      const cached = cacheGet(SEARCH_HIGHLIGHT_NEEDLE_CACHE, cacheKey);
      if (cached) return cached;
    }

    const model = modelLike ? queryOrTokens : resolveSnippetQueryModel(queryOrTokens);
    const needles = collectHighlightNeedlesFromModel(model);
    if (cacheKey) {
      return cacheSet(SEARCH_HIGHLIGHT_NEEDLE_CACHE, cacheKey, needles, SEARCH_HIGHLIGHT_NEEDLE_CACHE_MAX);
    }
    return needles;
  }

  function mergeHighlightRanges(text, ranges) {
    const source = String(text || '');
    const entries = Array.isArray(ranges) ? ranges : [];
    if (!source || !entries.length) return [];

    const sorted = entries
      .map((entry) => ({
        start: Number.isFinite(entry && entry.start) ? Math.max(0, Math.floor(entry.start)) : 0,
        end: Number.isFinite(entry && entry.end) ? Math.max(0, Math.floor(entry.end)) : 0,
      }))
      .filter((entry) => entry.end > entry.start && entry.start < source.length)
      .sort((a, b) => a.start - b.start || a.end - b.end);
    if (!sorted.length) return [];

    const merged = [sorted[0]];
    const gapJoinRe = /^[\s\u00A0\-–—_/,:;()]+$/;
    for (let i = 1; i < sorted.length; i += 1) {
      const current = sorted[i];
      const last = merged[merged.length - 1];
      if (current.start <= last.end) {
        if (current.end > last.end) last.end = current.end;
        continue;
      }

      const gap = source.slice(last.end, current.start);
      if (gap && gapJoinRe.test(gap)) {
        last.end = Math.max(last.end, current.end);
        continue;
      }

      merged.push(current);
    }

    for (const range of merged) {
      if (range.end > source.length) range.end = source.length;
    }
    return merged;
  }

  function highlightSearchText(text, queryOrTokens) {
    const source = String(text || '');
    if (!source) return '';

    const needles = resolveHighlightNeedles(queryOrTokens);
    const phraseNeedles = Array.isArray(needles && needles.phraseNeedles) ? needles.phraseNeedles : [];
    const tokenNeedles = Array.isArray(needles && needles.tokenNeedles) ? needles.tokenNeedles : [];
    if (!phraseNeedles.length && !tokenNeedles.length) {
      return escapeSearchHighlightHtml(source);
    }

    const ranges = [];
    for (const phrase of phraseNeedles) {
      ranges.push(...findPhraseRanges(source, phrase, { maxMatches: 24 }));
    }
    for (const token of tokenNeedles) {
      ranges.push(...findBoundaryTermRanges(source, token, { maxMatches: 32 }));
    }

    const merged = mergeHighlightRanges(source, ranges);
    if (!merged.length) return escapeSearchHighlightHtml(source);

    let out = '';
    let cursor = 0;
    for (const range of merged) {
      out += escapeSearchHighlightHtml(source.slice(cursor, range.start));
      out += `<mark>${escapeSearchHighlightHtml(source.slice(range.start, range.end))}</mark>`;
      cursor = range.end;
    }
    if (cursor < source.length) out += escapeSearchHighlightHtml(source.slice(cursor));
    return out;
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

  function hasSpaceDelimitedMatch(text, term) {
    if (!text || !term) return false;
    let offset = 0;
    while (offset < text.length) {
      const index = text.indexOf(term, offset);
      if (index < 0) break;
      const startIndex = index - 1;
      const endIndex = index + term.length;
      const startBoundary = startIndex < 0 || text.charCodeAt(startIndex) === 32;
      const endBoundary = endIndex >= text.length || text.charCodeAt(endIndex) === 32;
      if (startBoundary && endBoundary) return true;
      offset = index + 1;
    }
    return false;
  }

  function computeFieldMatchScore(term, field, allowFuzzy = true) {
    if (!term || !field || !field.text) return 0;
    const text = field.text;

    if (text === term) return 1.12;
    if (text.startsWith(`${term} `) || text.startsWith(term)) return 1.02;
    if (hasSpaceDelimitedMatch(text, term)) return 0.94;
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
        const allowFuzzy = (config.fuzzy !== false) && clause.isBeginnerClause !== true;
        const fieldBaseScore = computeFieldMatchScore(term, field, allowFuzzy);
        if (fieldBaseScore <= 0) continue;
        const weightedScore = fieldBaseScore * (config.weight || 1);
        if (weightedScore > bestVariantScore) bestVariantScore = weightedScore;
      }

      const scoredVariant = bestVariantScore * variantWeight;
      if (scoredVariant > bestClauseScore) bestClauseScore = scoredVariant;
    }

    return bestClauseScore;
  }

  function findBestClauseMatchRangeInField(clause, fieldText) {
    if (!clause || !Array.isArray(clause.variants) || !clause.variants.length) return null;
    const text = String(fieldText || '');
    if (!text) return null;

    let best = null;
    for (const variant of clause.variants) {
      const term = normalizeSearchToken(variant && variant.term);
      const weight = Number(variant && variant.weight) || 0;
      if (!term || weight <= 0) continue;

      const matches = findBoundaryTermRanges(text, term, { maxMatches: 1 });
      if (!matches.length) continue;

      const match = matches[0];
      const score = (term.length * 0.24) + (weight * 1.6);
      if (!best || score > best.score || (score === best.score && match.start < best.start)) {
        best = {
          start: match.start,
          end: match.end,
          score,
        };
      }
    }

    return best;
  }

  function computeClauseContextSignalForField(clauses, fieldText) {
    const source = Array.isArray(clauses) ? clauses : [];
    const text = String(fieldText || '');
    if (!source.length || !text) return 0;

    const matches = [];
    for (const clause of source) {
      const match = findBestClauseMatchRangeInField(clause, text);
      if (match) matches.push(match);
    }
    if (matches.length < 2) return 0;

    matches.sort((a, b) => a.start - b.start || a.end - b.end);

    const clauseCount = source.length;
    const matchedCount = matches.length;
    const coverage = matchedCount / clauseCount;
    const span = Math.max(1, matches[matches.length - 1].end - matches[0].start);
    const avgSpanPerMatch = span / matchedCount;
    const compactness = 1 / (1 + Math.max(0, avgSpanPerMatch - 18) / 28);

    let adjacencyPairs = 0;
    for (let i = 1; i < matches.length; i += 1) {
      const prev = matches[i - 1];
      const next = matches[i];
      const gapLength = next.start - prev.end;
      if (gapLength < 0 || gapLength > 28) continue;
      const gapText = text.slice(prev.end, next.start);
      if (/[.!?]/.test(gapText)) continue;
      adjacencyPairs += 1;
    }
    const adjacency = matches.length > 1 ? adjacencyPairs / (matches.length - 1) : 0;

    let signal = (coverage * 0.54) + (compactness * 0.30) + (adjacency * 0.16);
    if (coverage < 0.5) signal *= 0.68;
    return Math.max(0, Math.min(1.35, signal));
  }

  function computeQueryContextSignal(model, fields, fieldConfig) {
    const sourceFields = fields && typeof fields === 'object' ? fields : {};
    const configs = Array.isArray(fieldConfig) ? fieldConfig : [];
    const clauses = Array.isArray(model && model.clauses) ? model.clauses : [];
    if (!configs.length || clauses.length < 2) return 0;

    const narrowClauses = clauses.filter((clause) => clause && clause.isBroad !== true);
    const targetClauses = narrowClauses.length >= 2 ? narrowClauses : clauses;
    if (targetClauses.length < 2) return 0;

    let bestSignal = 0;
    let aggregateSignal = 0;
    let aggregateWeight = 0;
    let fieldsWithSignal = 0;
    const combinedFieldText = [];
    for (const config of configs) {
      const fieldKey = String(config && config.key || '');
      const field = sourceFields[fieldKey];
      if (!field || !field.text) continue;
      combinedFieldText.push(field.text);
      const signal = computeClauseContextSignalForField(targetClauses, field.text);
      if (!(signal > 0)) continue;

      const weight = Number(config && config.weight) || 1;
      const weightedSignal = signal * (1 + Math.min(0.58, Math.log1p(Math.max(0.25, weight)) * 0.22));
      if (weightedSignal > bestSignal) bestSignal = weightedSignal;
      aggregateSignal += signal * Math.max(0.25, weight);
      aggregateWeight += Math.max(0.25, weight);
      fieldsWithSignal += 1;
    }

    const averagedSignal = aggregateWeight > 0 ? (aggregateSignal / aggregateWeight) : 0;
    const combinedSignal = computeClauseContextSignalForField(targetClauses, combinedFieldText.join(' . '));
    let signal = Math.max(bestSignal, (averagedSignal * 0.9) + (combinedSignal * 0.7));

    if (fieldsWithSignal > 1 && targetClauses.length >= 3) {
      signal *= 1 - Math.min(0.28, (fieldsWithSignal - 1) * 0.1);
    }
    return signal;
  }

  function resolveRarityClauses(clauses) {
    const source = Array.isArray(clauses) ? clauses : [];
    if (!source.length) return [];

    const narrow = source.filter((clause) => clause && clause.isBroad !== true);
    const active = narrow.length ? narrow : source;
    const seenTokens = new Set();
    const out = [];
    for (const clause of active) {
      const token = normalizeSearchToken(clause && clause.token);
      if (!token || seenTokens.has(token)) continue;
      seenTokens.add(token);
      out.push(clause);
    }
    return out;
  }

  function buildClauseRarityProfile(clauses, records, resolveDoc, fieldConfig, options = {}) {
    const targetClauses = resolveRarityClauses(clauses);
    const values = Array.isArray(records) ? records : [];
    if (!targetClauses.length || !values.length || typeof resolveDoc !== 'function') return null;

    const config = Array.isArray(fieldConfig) ? fieldConfig : [];
    if (!config.length) return null;

    const matchThreshold = Number.isFinite(options.matchThreshold) ? options.matchThreshold : 0.92;
    const idfByToken = new Map();
    const totalDocs = values.length;
    let maxIdf = 0;

    for (const clause of targetClauses) {
      const token = normalizeSearchToken(clause && clause.token);
      if (!token) continue;

      let docFreq = 0;
      for (const record of values) {
        const doc = resolveDoc(record);
        if (!doc || !doc.fields) continue;
        const score = scoreClauseAgainstFields(clause, doc.fields, config);
        if (score >= matchThreshold) docFreq += 1;
      }

      const idf = Math.log(1 + ((totalDocs - docFreq + 0.5) / (docFreq + 0.5)));
      idfByToken.set(token, idf);
      if (idf > maxIdf) maxIdf = idf;
    }

    return {
      clauses: targetClauses,
      idfByToken,
      maxIdf,
      totalDocs,
      matchThreshold,
    };
  }

  function computeClauseRarityBonus(doc, profile, fieldConfig, options = {}) {
    if (!doc || !doc.fields || !profile || !(profile.idfByToken instanceof Map)) return 0;

    const clauses = Array.isArray(profile.clauses) ? profile.clauses : [];
    if (!clauses.length) return 0;
    const config = Array.isArray(fieldConfig) ? fieldConfig : [];
    if (!config.length) return 0;

    const matchThreshold = Number.isFinite(options.matchThreshold)
      ? options.matchThreshold
      : (Number.isFinite(profile.matchThreshold) ? profile.matchThreshold : 0.92);
    const maxIdf = Number(profile.maxIdf || 0);

    let weightedMatched = 0;
    let weightedTotal = 0;
    let matchedCount = 0;
    let matchedRare = 0;

    for (const clause of clauses) {
      const token = normalizeSearchToken(clause && clause.token);
      if (!token) continue;

      const idf = Number(profile.idfByToken.get(token) || 0);
      const normalizedIdf = maxIdf > 0 ? idf / maxIdf : 0;
      const clauseWeight = 0.36 + (normalizedIdf * 0.96);
      weightedTotal += clauseWeight;

      const clauseScore = scoreClauseAgainstFields(clause, doc.fields, config);
      if (clauseScore < matchThreshold) continue;

      matchedCount += 1;
      if (normalizedIdf >= 0.64) matchedRare += 1;
      weightedMatched += clauseWeight * Math.min(1.22, clauseScore / Math.max(1, matchThreshold));
    }

    if (!(weightedTotal > 0)) return 0;
    if (!matchedCount) return clauses.length >= 3 ? -0.2 : -0.1;

    const weightedCoverage = weightedMatched / weightedTotal;
    const matchCoverage = matchedCount / clauses.length;
    let bonus = weightedCoverage * (0.55 + (matchCoverage * 0.45));
    if (matchedRare > 0) bonus += Math.min(0.28, matchedRare * 0.1);
    if (clauses.length >= 3 && weightedCoverage < 0.34) bonus *= 0.84;
    return Math.max(-0.35, Math.min(1.65, bonus));
  }

  function buildTokenComboSet(tokens, options = {}) {
    const source = Array.isArray(tokens) ? tokens : [];
    if (!source.length) return new Set();

    const minSize = Number.isFinite(options.minSize) ? Math.max(2, Math.floor(options.minSize)) : 2;
    const maxSize = Number.isFinite(options.maxSize) ? Math.max(minSize, Math.floor(options.maxSize)) : 3;
    const includeStopwordOnly = options.includeStopwordOnly === true;
    const out = new Set();

    const normalized = [];
    for (const token of source) {
      const value = normalizeSearchToken(token);
      if (!value || value.length < 2) continue;
      normalized.push(value);
    }
    if (!normalized.length) return out;

    for (let start = 0; start < normalized.length; start += 1) {
      for (let size = minSize; size <= maxSize; size += 1) {
        const end = start + size;
        if (end > normalized.length) break;
        const slice = normalized.slice(start, end);
        if (!slice.length) continue;

        const hasSignalToken = slice.some((part) => !SEARCH_STOPWORDS.has(part));
        if (!includeStopwordOnly && !hasSignalToken) continue;
        out.add(slice.join(' '));
      }
    }
    return out;
  }

  function buildDocComboSet(doc, fieldConfigs) {
    if (!doc || !doc.fields) return new Set();
    const config = Array.isArray(fieldConfigs) ? fieldConfigs : [];
    const out = new Set();

    for (const entry of config) {
      const key = String(entry && entry.key || '');
      if (!key) continue;
      const field = doc.fields[key];
      if (!field || !Array.isArray(field.words) || !field.words.length) continue;

      const maxWords = Number.isFinite(entry && entry.maxWords) && entry.maxWords > 0
        ? Math.floor(entry.maxWords)
        : field.words.length;
      const words = field.words.slice(0, maxWords);
      const combos = buildTokenComboSet(words, { minSize: 2, maxSize: 3 });
      for (const combo of combos) out.add(combo);
    }
    return out;
  }

  function resolveTalkComboSet(talk) {
    if (!talk || typeof talk !== 'object') return new Set();
    if (TALK_COMBO_SET_CACHE && TALK_COMBO_SET_CACHE.has(talk)) {
      return TALK_COMBO_SET_CACHE.get(talk);
    }

    const doc = buildTalkSearchDoc(talk);
    const combos = buildDocComboSet(doc, [
      { key: 'title', maxWords: 24 },
      { key: 'tags', maxWords: 32 },
      { key: 'abstract', maxWords: 80 },
      { key: 'meeting', maxWords: 18 },
      { key: 'category', maxWords: 8 },
    ]);
    if (TALK_COMBO_SET_CACHE) TALK_COMBO_SET_CACHE.set(talk, combos);
    return combos;
  }

  function resolvePaperComboSet(paper) {
    if (!paper || typeof paper !== 'object') return new Set();
    if (PAPER_COMBO_SET_CACHE && PAPER_COMBO_SET_CACHE.has(paper)) {
      return PAPER_COMBO_SET_CACHE.get(paper);
    }

    const doc = buildPaperSearchDoc(paper);
    const combos = buildDocComboSet(doc, [
      { key: 'title', maxWords: 28 },
      { key: 'topics', maxWords: 36 },
      { key: 'type', maxWords: 12 },
      { key: 'abstract', maxWords: 96 },
      { key: 'content', maxWords: 180 },
      { key: 'publication', maxWords: 24 },
      { key: 'venue', maxWords: 20 },
    ]);
    if (PAPER_COMBO_SET_CACHE) PAPER_COMBO_SET_CACHE.set(paper, combos);
    return combos;
  }

  function buildComboTrendIndex(records, kind = 'talk') {
    const values = Array.isArray(records) ? records : [];
    const comboStats = new Map();
    let maxCount = 0;

    for (const record of values) {
      const combos = kind === 'paper'
        ? resolvePaperComboSet(record)
        : resolveTalkComboSet(record);
      if (!(combos instanceof Set) || !combos.size) continue;

      for (const combo of combos) {
        const next = (comboStats.get(combo) || 0) + 1;
        comboStats.set(combo, next);
        if (next > maxCount) maxCount = next;
      }
    }

    return {
      comboStats,
      maxCount,
      totalRecords: values.length,
    };
  }

  function resolveComboTrendIndex(records, kind = 'talk') {
    const values = Array.isArray(records) ? records : [];
    const cache = kind === 'paper'
      ? PAPER_COMBO_TREND_INDEX_CACHE
      : TALK_COMBO_TREND_INDEX_CACHE;
    if (cache && cache.has(values)) return cache.get(values);

    const index = buildComboTrendIndex(values, kind);
    if (cache) cache.set(values, index);
    return index;
  }

  function getQueryComboProfileCacheKey(model, comboTrendIndex, kind) {
    const normalizedQuery = normalizeSearchText(model && model.normalizedQuery || '');
    const context = normalizeSearchText(model && model.contextProfile || '');
    const prefix = normalizeSearchText(kind || 'talk');
    const comboCount = Number(comboTrendIndex && comboTrendIndex.comboStats instanceof Map
      ? comboTrendIndex.comboStats.size
      : 0);
    const maxCount = Number(comboTrendIndex && comboTrendIndex.maxCount || 0);
    const totalRecords = Number(comboTrendIndex && comboTrendIndex.totalRecords || 0);
    if (!normalizedQuery) return '';
    return `${prefix}|${context}|${normalizedQuery}|${totalRecords}|${comboCount}|${maxCount}`;
  }

  function collectQueryComboSignalTokens(model) {
    const sourceModel = model && typeof model === 'object' ? model : null;
    if (!sourceModel) return new Set();

    const signalTokens = new Set();
    const rawTokenCount = Array.isArray(sourceModel.rawTokens) ? sourceModel.rawTokens.length : 0;
    const addToken = (value) => {
      const token = normalizeSearchToken(value);
      if (!token || token.length < 2 || SEARCH_STOPWORDS.has(token)) return;
      signalTokens.add(token);
    };
    const addText = (value) => {
      const normalized = normalizeSearchText(value);
      if (!normalized) return;
      for (const token of normalized.split(/\s+/)) addToken(token);
    };

    for (const token of (Array.isArray(sourceModel.rawTokens) ? sourceModel.rawTokens : [])) addToken(token);
    for (const clause of (Array.isArray(sourceModel.clauses) ? sourceModel.clauses : [])) {
      addToken(clause && clause.token);
      for (const variant of (clause && Array.isArray(clause.variants) ? clause.variants : [])) {
        if (!(Number(variant && variant.weight) >= 0.62)) continue;
        addToken(variant && variant.term);
      }
    }
    for (const clause of (Array.isArray(sourceModel.anyClauses) ? sourceModel.anyClauses : [])) {
      addToken(clause && clause.token);
    }
    for (const phrase of (Array.isArray(sourceModel.requiredPhrases) ? sourceModel.requiredPhrases : [])) addText(phrase);
    for (const phrase of (Array.isArray(sourceModel.anyPhrases) ? sourceModel.anyPhrases : [])) addText(phrase);
    addText(sourceModel.normalizedQuery || '');

    for (const topic of (Array.isArray(sourceModel.queryTopics) ? sourceModel.queryTopics : [])) {
      addText(topic);
    }

    const contextProfile = normalizeSearchText(sourceModel.contextProfile || '');
    const shouldAddContextSeeds = rawTokenCount <= 2 && signalTokens.size < 7;
    if (shouldAddContextSeeds) {
      const contextSeeds = contextProfile === 'beginner'
        ? ['beginner', 'beginners', 'introduction', 'intro', 'tutorial', 'tutorials', 'getting', 'started', 'basics', 'foundations', 'guide']
        : (
          contextProfile === 'advanced research' || contextProfile === 'advanced-research'
            ? ['advanced', 'internals', 'analysis', 'optimization', 'pipeline', 'dialect', 'lowering', 'benchmark', 'evaluation', 'polyhedral']
            : (sourceModel.fundamentalsIntent ? ['fundamentals', 'overview', 'guide', 'walkthrough', 'tutorial', 'basics', 'introduction'] : [])
        );
      for (const seed of contextSeeds) addToken(seed);
    }

    for (const topic of (Array.isArray(sourceModel.subprojectTopics) ? sourceModel.subprojectTopics : [])) {
      addText(topic);
      const topicKey = normalizeTopicKey(topic);
      const topicHints = topicKey ? (SEARCH_CONTEXT_COMBO_TOPIC_HINTS[topicKey] || []) : [];
      for (const hint of topicHints) addToken(hint);
    }
    return signalTokens;
  }

  function collectQueryComboCandidates(model) {
    if (!model || typeof model !== 'object') return [];
    const seen = new Set();
    const out = [];

    const addTokens = (tokens) => {
      const combos = buildTokenComboSet(tokens, { minSize: 2, maxSize: 3 });
      for (const combo of combos) {
        if (seen.has(combo)) continue;
        seen.add(combo);
        out.push(combo);
      }
    };

    const rawTokens = Array.isArray(model.rawTokens) ? model.rawTokens : [];
    if (rawTokens.length >= 2) addTokens(rawTokens);

    const clauseTokens = Array.isArray(model.clauses)
      ? model.clauses.map((clause) => normalizeSearchToken(clause && clause.token)).filter(Boolean)
      : [];
    if (clauseTokens.length >= 2) addTokens(clauseTokens);

    const phraseSources = [
      ...(Array.isArray(model.requiredPhrases) ? model.requiredPhrases : []),
      ...(Array.isArray(model.anyPhrases) ? model.anyPhrases : []),
      normalizeSearchText(model.normalizedQuery || ''),
    ].filter(Boolean);
    for (const phrase of phraseSources) {
      const tokens = normalizeSearchText(phrase).split(/\s+/).filter(Boolean);
      if (tokens.length >= 2) addTokens(tokens);
    }

    return out;
  }

  function buildQueryComboProfile(model, comboTrendIndex, kind = 'talk') {
    if (!model || !comboTrendIndex || !(comboTrendIndex.comboStats instanceof Map)) return null;
    const cacheKey = getQueryComboProfileCacheKey(model, comboTrendIndex, kind);
    if (cacheKey) {
      const cached = cacheGet(QUERY_COMBO_PROFILE_CACHE, cacheKey);
      if (cached) return cached;
    }

    const candidates = collectQueryComboCandidates(model);
    const querySignalTokens = collectQueryComboSignalTokens(model);
    if (!candidates.length && !querySignalTokens.size) return null;

    const entriesByCombo = new Map();
    const addEntry = (combo, weight, count, source) => {
      const key = normalizeSearchText(combo);
      if (!key) return;
      const normalizedWeight = Number(weight);
      if (!Number.isFinite(normalizedWeight) || normalizedWeight <= 0) return;
      const normalizedCount = Number(count);
      const safeCount = Number.isFinite(normalizedCount) && normalizedCount > 0
        ? normalizedCount
        : 0;
      const nextSource = source === 'direct' ? 'direct' : 'context';

      const existing = entriesByCombo.get(key);
      if (!existing) {
        entriesByCombo.set(key, {
          combo: key,
          weight: normalizedWeight,
          count: safeCount,
          source: nextSource,
        });
        return;
      }

      if (safeCount > existing.count) existing.count = safeCount;
      if (normalizedWeight > existing.weight) existing.weight = normalizedWeight;
      if (nextSource === 'direct') existing.source = 'direct';
    };

    for (const combo of candidates) {
      const count = Number(comboTrendIndex.comboStats.get(combo) || 0);
      if (count < 1) continue;

      const tokenCount = combo.split(' ').filter(Boolean).length;
      if (tokenCount < 2) continue;
      const rarityPenalty = comboTrendIndex.maxCount > 0
        ? Math.min(0.6, count / Math.max(1, comboTrendIndex.maxCount))
        : 0;
      const supportScale = count >= 2 ? 1 : 0.72;
      const sizeBoost = tokenCount >= 3 ? 1.28 : 1.08;
      const weight = Math.max(0.16, Math.log1p(count + 1) * supportScale * sizeBoost * (1 - (rarityPenalty * 0.42)));
      addEntry(combo, weight * 1.28, count, 'direct');
    }

    if (querySignalTokens.size) {
      const totalRecords = Number(comboTrendIndex.totalRecords || 0);
      const minSupport = totalRecords >= 48 ? 4 : (totalRecords >= 20 ? 3 : 2);

      for (const [combo, rawCount] of comboTrendIndex.comboStats.entries()) {
        const count = Number(rawCount || 0);
        if (count < minSupport) continue;
        if (entriesByCombo.has(combo)) continue;

        const comboTokens = combo.split(/\s+/).filter(Boolean);
        const tokenCount = comboTokens.length;
        if (tokenCount < 2 || tokenCount > 3) continue;

        let overlapCount = 0;
        let informativeCount = 0;
        for (const token of comboTokens) {
          if (!SEARCH_STOPWORDS.has(token)) informativeCount += 1;
          if (querySignalTokens.has(token)) overlapCount += 1;
        }
        if (!informativeCount || !overlapCount) continue;

        const overlapRatio = overlapCount / tokenCount;
        if (overlapCount < 2 && overlapRatio < 0.42) continue;

        const rarityPenalty = comboTrendIndex.maxCount > 0
          ? Math.min(0.66, count / Math.max(1, comboTrendIndex.maxCount))
          : 0;
        const overlapBoost = overlapCount >= 2 ? 1.24 : 0.9;
        const specificityBoost = informativeCount === tokenCount ? 1.08 : 1;
        const sizeBoost = tokenCount >= 3 ? 1.14 : 1;
        const weight = Math.max(
          0.1,
          Math.log1p(count)
            * (0.62 + (overlapRatio * 0.62))
            * overlapBoost
            * specificityBoost
            * sizeBoost
            * (1 - (rarityPenalty * 0.52))
        );
        addEntry(combo, weight, count, 'context');
      }
    }

    const entries = [...entriesByCombo.values()];
    if (!entries.length) return null;
    entries.sort((a, b) => {
      const sourceDiff = (b.source === 'direct' ? 1 : 0) - (a.source === 'direct' ? 1 : 0);
      if (sourceDiff !== 0) return sourceDiff;
      if (b.weight !== a.weight) return b.weight - a.weight;
      if (b.count !== a.count) return b.count - a.count;
      return a.combo.localeCompare(b.combo);
    });
    const capped = entries.slice(0, 14);

    let totalWeight = 0;
    let directWeight = 0;
    let contextWeight = 0;
    let directCount = 0;
    let contextCount = 0;
    for (const entry of capped) {
      const weight = Number(entry.weight || 0);
      if (!(weight > 0)) continue;
      totalWeight += weight;
      if (entry.source === 'direct') {
        directWeight += weight;
        directCount += 1;
      } else {
        contextWeight += weight;
        contextCount += 1;
      }
    }
    if (!entries.length || !(totalWeight > 0)) return null;

    const profile = {
      combos: capped,
      totalWeight,
      directWeight,
      contextWeight,
      directCount,
      contextCount,
      kind: normalizeSearchText(kind),
    };

    if (cacheKey) {
      return cacheSet(QUERY_COMBO_PROFILE_CACHE, cacheKey, profile, QUERY_COMBO_PROFILE_CACHE_MAX);
    }
    return profile;
  }

  function computeComboContextAdjustment(recordCombos, queryComboProfile) {
    const combos = recordCombos instanceof Set ? recordCombos : null;
    const profile = queryComboProfile && typeof queryComboProfile === 'object' ? queryComboProfile : null;
    if (!combos || !profile || !Array.isArray(profile.combos) || !profile.combos.length) return 0;

    let matchedWeight = 0;
    let matchedCount = 0;
    let matchedDirectWeight = 0;
    let matchedContextWeight = 0;
    let matchedDirectCount = 0;
    let matchedContextCount = 0;
    for (const entry of profile.combos) {
      const combo = entry && entry.combo;
      if (!combo || !combos.has(combo)) continue;
      matchedCount += 1;
      const weight = Number(entry.weight || 0);
      matchedWeight += weight;
      if (entry.source === 'direct') {
        matchedDirectCount += 1;
        matchedDirectWeight += weight;
      } else {
        matchedContextCount += 1;
        matchedContextWeight += weight;
      }
    }

    const directCount = Number(profile.directCount || 0);
    const contextCount = Number(profile.contextCount || 0);

    if (!matchedCount) {
      if (directCount > 0) return directCount >= 2 ? -0.28 : -0.14;
      return contextCount >= 3 ? -0.14 : -0.06;
    }

    const totalWeight = Number(profile.totalWeight || 0);
    if (!(totalWeight > 0)) return 0;

    const directWeight = Number(profile.directWeight || 0);
    const contextWeight = Number(profile.contextWeight || 0);
    const weightedCoverage = matchedWeight / totalWeight;
    const directCoverage = directWeight > 0 ? (matchedDirectWeight / directWeight) : 0;
    const contextCoverage = contextWeight > 0 ? (matchedContextWeight / contextWeight) : 0;
    const matchCoverage = matchedCount / profile.combos.length;

    let adjustment = (weightedCoverage * 0.6) + (directCoverage * 0.46) + (contextCoverage * 0.24) + (matchCoverage * 0.2);
    if (directCount > 0 && matchedDirectCount === directCount) adjustment += 0.14;
    if (directCount > 0 && matchedDirectCount === 0) adjustment -= directCount >= 2 ? 0.18 : 0.1;
    if (matchedDirectCount === 0 && matchedContextCount > 0) adjustment *= 0.86;
    if (matchedCount === profile.combos.length) adjustment += 0.08;
    return Math.max(-0.34, Math.min(1.24, adjustment));
  }

  function scorePhraseEntriesAgainstFields(phraseEntries, fields, fieldConfig) {
    const source = Array.isArray(phraseEntries) ? phraseEntries : [];
    if (!source.length) return 0;
    let total = 0;

    for (const phraseEntry of source) {
      const phrase = phraseEntry && phraseEntry.value ? phraseEntry.value : '';
      const weight = phraseEntry && Number.isFinite(phraseEntry.weight) ? phraseEntry.weight : 1;
      if (!phrase || !weight) continue;

      let bestPhraseField = 0;
      for (const config of (fieldConfig || [])) {
        const field = fields[config.key];
        if (!field || !field.text) continue;
        const phraseScore = scorePhraseAgainstField(phrase, field) * (config.weight || 1);
        if (phraseScore > bestPhraseField) bestPhraseField = phraseScore;
      }
      total += bestPhraseField * weight;
    }

    return total;
  }

  function uniqueFieldKeys(values) {
    const out = [];
    const seen = new Set();
    for (const value of (values || [])) {
      const key = String(value || '').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
    return out;
  }

  function resolveWhereScopeFieldKeys(whereScope, fields, whereScopeTargets) {
    const sourceFields = fields && typeof fields === 'object' ? fields : {};
    const allFieldKeys = uniqueFieldKeys(Object.keys(sourceFields));
    if (!allFieldKeys.length) return [];

    const scope = normalizeSearchWhereScope(whereScope);
    if (scope === 'anywhere') return allFieldKeys;

    const configured = uniqueFieldKeys((whereScopeTargets && whereScopeTargets[scope]) || []);
    if (!configured.length) return allFieldKeys;

    const allowed = new Set(configured);
    const scoped = allFieldKeys.filter((key) => allowed.has(key));
    return scoped.length ? scoped : allFieldKeys;
  }

  function filterFieldConfigByKeys(fieldConfig, allowedKeys) {
    const keys = new Set(uniqueFieldKeys(allowedKeys));
    const source = Array.isArray(fieldConfig) ? fieldConfig : [];
    if (!keys.size) return [];
    return source.filter((config) => config && keys.has(String(config.key || '').trim()));
  }

  function toPhraseEntries(values, defaultWeight = 1) {
    const source = Array.isArray(values) ? values : [];
    const entries = [];
    const seen = new Set();
    for (const raw of source) {
      const phrase = normalizeSearchText(raw);
      if (!phrase || phrase.length < 2 || seen.has(phrase)) continue;
      seen.add(phrase);
      entries.push({ value: phrase, weight: defaultWeight });
    }
    return entries;
  }

  function matchClauseCollection(clauses, fields, fieldKeys, options = {}) {
    const source = Array.isArray(clauses) ? clauses : [];
    if (!source.length) return { matchedCount: 0, clauseCount: 0, anyMatch: false };
    const keys = uniqueFieldKeys(fieldKeys);
    if (!keys.length) return { matchedCount: 0, clauseCount: source.length, anyMatch: false };

    const fieldConfig = keys.map((key) => ({
      key,
      weight: 1.0,
      fuzzy: options.fuzzy !== false,
    }));
    const threshold = Number.isFinite(options.threshold) ? options.threshold : 0.9;
    let matchedCount = 0;
    let anyMatch = false;

    for (const clause of source) {
      const score = scoreClauseAgainstFields(clause, fields, fieldConfig);
      if (score >= threshold) {
        matchedCount += 1;
        anyMatch = true;
      }
    }

    return {
      matchedCount,
      clauseCount: source.length,
      anyMatch,
    };
  }

  function matchPhraseCollection(phrases, fields, fieldKeys, options = {}) {
    const source = Array.isArray(phrases) ? phrases : [];
    if (!source.length) return { matchedCount: 0, phraseCount: 0, anyMatch: false };
    const keys = uniqueFieldKeys(fieldKeys);
    if (!keys.length) return { matchedCount: 0, phraseCount: source.length, anyMatch: false };

    const fieldConfig = keys.map((key) => ({ key, weight: 1.0 }));
    const threshold = Number.isFinite(options.threshold) ? options.threshold : 0.84;
    let matchedCount = 0;
    let anyMatch = false;

    for (const entry of source) {
      const phrase = entry && entry.value ? entry.value : '';
      if (!phrase) continue;
      const score = scorePhraseEntriesAgainstFields([entry], fields, fieldConfig);
      if (score >= threshold) {
        matchedCount += 1;
        anyMatch = true;
      }
    }

    return {
      matchedCount,
      phraseCount: source.length,
      anyMatch,
    };
  }

  function hasEntriesForFieldMap(fieldMap) {
    if (!fieldMap || typeof fieldMap !== 'object') return false;
    for (const field of SEARCH_QUERY_MODEL_FIELDS) {
      const entries = fieldMap[field];
      if (Array.isArray(entries) && entries.length) return true;
    }
    return false;
  }

  function evaluateFieldConstraintMap(fieldMap, fields, fieldTargets, options = {}) {
    if (!fieldMap || typeof fieldMap !== 'object') return true;
    const relaxed = options.relaxed === true;
    const threshold = Number.isFinite(options.threshold)
      ? options.threshold
      : (relaxed ? 0.72 : 0.94);
    const fuzzy = options.fuzzy !== false;

    for (const field of SEARCH_QUERY_MODEL_FIELDS) {
      const clauses = fieldMap[field];
      if (!Array.isArray(clauses) || !clauses.length) continue;
      const targets = uniqueFieldKeys((fieldTargets && fieldTargets[field]) || []);
      if (!targets.length) return false;

      const result = matchClauseCollection(clauses, fields, targets, {
        threshold,
        fuzzy,
      });
      if (!result.clauseCount) continue;
      const coverage = result.matchedCount / result.clauseCount;
      if (!relaxed) {
        if (coverage < 1) return false;
      } else {
        if (result.clauseCount >= 3 && coverage < 0.67) return false;
        if (result.clauseCount === 2 && coverage < 0.5) return false;
        if (result.clauseCount === 1 && coverage < 1) return false;
      }
    }
    return true;
  }

  function evaluateFieldPhraseMap(fieldMap, fields, fieldTargets, options = {}) {
    if (!fieldMap || typeof fieldMap !== 'object') return true;
    const relaxed = options.relaxed === true;
    const threshold = Number.isFinite(options.threshold)
      ? options.threshold
      : (relaxed ? 0.64 : 0.86);

    for (const field of SEARCH_QUERY_MODEL_FIELDS) {
      const phrases = fieldMap[field];
      if (!Array.isArray(phrases) || !phrases.length) continue;
      const targets = uniqueFieldKeys((fieldTargets && fieldTargets[field]) || []);
      if (!targets.length) return false;

      const result = matchPhraseCollection(phrases, fields, targets, { threshold });
      if (!result.phraseCount) continue;
      if (!relaxed && result.matchedCount < result.phraseCount) return false;
      if (relaxed && result.phraseCount >= 2 && result.matchedCount < 1) return false;
      if (relaxed && result.phraseCount === 1 && result.matchedCount < 1) return false;
    }
    return true;
  }

  function evaluateExcludeConstraints(model, doc, options = {}) {
    const fields = doc && doc.fields ? doc.fields : null;
    if (!fields) return true;
    const relaxed = options.relaxed === true;
    const fieldTargets = options.fieldTargets || {};
    const allFieldKeys = uniqueFieldKeys(Object.keys(fields));

    if (Array.isArray(model.excludeClauses) && model.excludeClauses.length) {
      const clauseResult = matchClauseCollection(model.excludeClauses, fields, allFieldKeys, {
        threshold: relaxed ? 0.74 : 0.92,
        fuzzy: true,
      });
      if (clauseResult.anyMatch) return false;
    }

    if (hasEntriesForFieldMap(model.excludeFieldClauses)) {
      for (const field of SEARCH_QUERY_MODEL_FIELDS) {
        const clauses = model.excludeFieldClauses[field];
        if (!Array.isArray(clauses) || !clauses.length) continue;
        const targets = uniqueFieldKeys((fieldTargets && fieldTargets[field]) || []);
        if (!targets.length) continue;
        const clauseResult = matchClauseCollection(clauses, fields, targets, {
          threshold: relaxed ? 0.74 : 0.92,
          fuzzy: true,
        });
        if (clauseResult.anyMatch) return false;
      }
    }

    if (Array.isArray(model.excludePhrases) && model.excludePhrases.length) {
      for (const rawPhrase of model.excludePhrases) {
        const phrase = String(rawPhrase || '').trim();
        if (!phrase) continue;
        for (const key of allFieldKeys) {
          const field = fields[key];
          if (!field || !field.text) continue;
          if (field.text.includes(phrase)) return false;
        }
      }
    }

    if (hasEntriesForFieldMap(model.excludeFieldPhrases)) {
      for (const field of SEARCH_QUERY_MODEL_FIELDS) {
        const phrases = model.excludeFieldPhrases[field];
        if (!Array.isArray(phrases) || !phrases.length) continue;
        const targets = uniqueFieldKeys((fieldTargets && fieldTargets[field]) || []);
        if (!targets.length) continue;
        for (const phraseEntry of phrases) {
          const phrase = String(phraseEntry && phraseEntry.value || '').trim();
          if (!phrase) continue;
          for (const key of targets) {
            const targetField = fields[key];
            if (!targetField || !targetField.text) continue;
            if (targetField.text.includes(phrase)) return false;
          }
        }
      }
    }

    return true;
  }

  function evaluateQueryModelFilters(model, doc, options = {}) {
    if (!model || !doc || !doc.fields) return true;
    const relaxed = options.relaxed === true;
    const fieldTargets = options.fieldTargets || {};
    const whereFieldKeys = resolveWhereScopeFieldKeys(model.whereScope, doc.fields, options.whereScopeTargets || {});
    const year = Number.isFinite(doc.year) ? doc.year : 0;
    const yearRange = normalizeYearRange(model.yearRange || {});

    if (yearRange.from > 0 || yearRange.to > 0) {
      if (!year) return false;
      if (yearRange.from > 0 && year < yearRange.from) return false;
      if (yearRange.to > 0 && year > yearRange.to) return false;
    }

    if (!evaluateExcludeConstraints(model, doc, { relaxed, fieldTargets })) return false;
    if (!evaluateFieldConstraintMap(model.fieldClauses, doc.fields, fieldTargets, { relaxed, threshold: relaxed ? 0.72 : 0.94, fuzzy: true })) return false;
    if (!evaluateFieldPhraseMap(model.fieldPhrases, doc.fields, fieldTargets, { relaxed, threshold: relaxed ? 0.64 : 0.86 })) return false;

    const requiredPhraseEntries = Array.isArray(model.requiredPhraseEntries)
      ? model.requiredPhraseEntries
      : toPhraseEntries(model.requiredPhrases || []);
    if (requiredPhraseEntries.length) {
      const requiredPhraseResult = matchPhraseCollection(
        requiredPhraseEntries,
        doc.fields,
        whereFieldKeys,
        { threshold: relaxed ? 0.68 : 0.86 }
      );
      if (requiredPhraseResult.matchedCount < requiredPhraseResult.phraseCount) return false;
    }

    const anyClauses = Array.isArray(model.anyClauses) ? model.anyClauses : [];
    const anyPhraseEntries = Array.isArray(model.anyPhraseEntries)
      ? model.anyPhraseEntries
      : toPhraseEntries(model.anyPhrases || []);
    if (anyClauses.length || anyPhraseEntries.length) {
      let matchedAny = false;
      if (anyClauses.length) {
        const anyClauseResult = matchClauseCollection(anyClauses, doc.fields, whereFieldKeys, {
          threshold: relaxed ? 0.72 : 0.92,
          fuzzy: true,
        });
        matchedAny = matchedAny || anyClauseResult.anyMatch;
      }
      if (!matchedAny && anyPhraseEntries.length) {
        const anyPhraseResult = matchPhraseCollection(anyPhraseEntries, doc.fields, whereFieldKeys, {
          threshold: relaxed ? 0.68 : 0.86,
        });
        matchedAny = matchedAny || anyPhraseResult.anyMatch;
      }
      if (!matchedAny) return false;
    }

    return true;
  }

  function scoreQueryModelAgainstDoc(model, doc, options = {}) {
    if (!model) return 0;
    if (!doc || !doc.fields) return 0;
    const allFieldConfig = Array.isArray(options.fieldConfig) ? options.fieldConfig : [];
    const allPhraseFieldConfig = Array.isArray(options.phraseFieldConfig) ? options.phraseFieldConfig : allFieldConfig;
    const allowedWhereKeys = resolveWhereScopeFieldKeys(model.whereScope, doc.fields, options.whereScopeTargets || {});
    const fieldConfig = filterFieldConfigByKeys(allFieldConfig, allowedWhereKeys);
    const phraseFieldConfig = filterFieldConfigByKeys(allPhraseFieldConfig, allowedWhereKeys);
    const relaxed = options.relaxed === true;
    const hasClauses = Array.isArray(model.clauses) && model.clauses.length > 0;
    const hasAnyClauses = Array.isArray(model.anyClauses) && model.anyClauses.length > 0;
    const hasSoftPhrases = Array.isArray(model.phrases) && model.phrases.length > 0;
    const requiredPhraseEntries = Array.isArray(model.requiredPhraseEntries)
      ? model.requiredPhraseEntries
      : toPhraseEntries(model.requiredPhrases || []);
    const anyPhraseEntries = Array.isArray(model.anyPhraseEntries)
      ? model.anyPhraseEntries
      : toPhraseEntries(model.anyPhrases || []);
    const hasAnyPhrases = anyPhraseEntries.length > 0;
    const hasRequiredPhrases = requiredPhraseEntries.length > 0;
    const narrowClauseCount = hasClauses
      ? model.clauses.filter((clause) => clause && clause.isBroad !== true).length
      : 0;
    const focusedContextIntent = !model.beginnerIntent && (narrowClauseCount >= 2 || hasRequiredPhrases);

    if (!hasClauses && !hasAnyClauses && !hasSoftPhrases && !hasAnyPhrases && !hasRequiredPhrases) return 0;
    if (!fieldConfig.length && !phraseFieldConfig.length) return 0;

    let total = 0;
    let matchedClauses = 0;
    let matchedRequiredClauses = 0;
    if (hasClauses) {
      const clauseCount = model.clauses.length;
      const requiredClauseCount = Number.isFinite(model.requiredClauseCount) && model.requiredClauseCount > 0
        ? Math.min(clauseCount, Math.floor(model.requiredClauseCount))
        : clauseCount;
      const treatAllClausesAsRequired = requiredClauseCount === clauseCount;
      const clauseCoverageThreshold = relaxed ? 0.9 : 1.45;

      for (const clause of model.clauses) {
        const clauseScore = scoreClauseAgainstFields(clause, doc.fields, fieldConfig);
        if (clauseScore >= clauseCoverageThreshold) {
          matchedClauses += 1;
          if (treatAllClausesAsRequired || !clause.isBroad) matchedRequiredClauses += 1;
        }
        total += clauseScore * (clause.specificity || 1);
      }
      if (matchedClauses === 0) return 0;

      const coverage = matchedClauses / clauseCount;
      const requiredCoverage = matchedRequiredClauses / requiredClauseCount;
      if (!relaxed) {
        if (requiredClauseCount >= 5 && requiredCoverage < 0.8) return 0;
        if (requiredClauseCount === 4 && requiredCoverage < 0.75) return 0;
        if (requiredClauseCount === 3 && requiredCoverage < 0.8) return 0;
        if (requiredClauseCount === 2 && requiredCoverage < 1) return 0;
        if (requiredClauseCount === 1 && requiredCoverage < 1) return 0;
      } else {
        if (requiredClauseCount >= 4 && requiredCoverage < 0.5) return 0;
        if (requiredClauseCount === 3 && requiredCoverage < 0.34) return 0;
        if (requiredClauseCount === 2 && requiredCoverage < 0.5) return 0;
        if (requiredClauseCount === 1 && requiredCoverage < 1) return 0;
      }

      const effectiveCoverage = (requiredCoverage * 0.72) + (coverage * 0.28);
      const coverageMultiplier = relaxed
        ? (0.52 + (effectiveCoverage * 1.02))
        : (0.28 + (Math.pow(effectiveCoverage, 1.5) * 1.16));
      total *= coverageMultiplier;
    } else {
      total += 1;
    }

    if (hasRequiredPhrases) {
      total += scorePhraseEntriesAgainstFields(requiredPhraseEntries, doc.fields, phraseFieldConfig) * 2.45;
    }

    if (hasAnyClauses || hasAnyPhrases) {
      let anyBonus = 0;
      if (hasAnyClauses) {
        for (const clause of model.anyClauses) {
          const score = scoreClauseAgainstFields(clause, doc.fields, fieldConfig);
          if (score > anyBonus) anyBonus = score;
        }
      }
      if (hasAnyPhrases) {
        const phraseScore = scorePhraseEntriesAgainstFields(anyPhraseEntries, doc.fields, phraseFieldConfig);
        if (phraseScore > anyBonus) anyBonus = phraseScore;
      }
      total += anyBonus * 0.95;
    }

    if (hasSoftPhrases) {
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

    if (hasClauses && fieldConfig.length) {
      const contextSignal = Math.max(0, Math.min(1.45, computeQueryContextSignal(model, doc.fields, fieldConfig)));
      if (contextSignal > 0) {
        const contextBoost = model.beginnerIntent ? 0.12 : (focusedContextIntent ? 0.31 : 0.18);
        total *= 1 + (contextSignal * contextBoost);
        if (focusedContextIntent && !relaxed && narrowClauseCount >= 3) {
          if (contextSignal < 0.24) total *= 0.7;
          else if (contextSignal < 0.34) total *= 0.82;
          else if (contextSignal < 0.46) total *= 0.9;
        }
      } else if (focusedContextIntent && !relaxed && narrowClauseCount >= 3) {
        total *= 0.74;
      }
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
      fields.type && fields.type.text,
      fields.abstract && fields.abstract.text,
      fields.content && fields.content.text,
      fields.category && fields.category.text,
      fields.publication && fields.publication.text,
      fields.venue && fields.venue.text,
    ].filter(Boolean).join(' ');
    if (!text) return false;
    const cleanedText = text.replace(BEGINNER_FALSE_POSITIVE_SIGNAL_RE, ' ');
    if (!cleanedText.trim()) return false;

    const tagText = [
      fields.tags && fields.tags.text,
      fields.topics && fields.topics.text,
      fields.type && fields.type.text,
      fields.category && fields.category.text,
    ].filter(Boolean).join(' ');
    const tutorialTagged = /\btutorial(?:s)?\b/.test(tagText);
    const beginnerTagged = /\bbeginner(?:s)?\b|\bfor beginners\b|\bgetting started\b|\bbasics\b/.test(tagText);
    const advancedSignal = BEGINNER_ADVANCED_SIGNAL_RE.test(cleanedText);
    const strongSignal = BEGINNER_STRONG_SIGNAL_RE.test(cleanedText) || tutorialTagged || beginnerTagged;
    if (strongSignal) return true;

    const introSignal = BEGINNER_INTRO_SIGNAL_RE.test(cleanedText);
    if (introSignal && !advancedSignal) return true;

    if (!BEGINNER_AMBIGUOUS_SIGNAL_RE.test(cleanedText)) return false;
    if (advancedSignal) return false;
    return BEGINNER_SIGNAL_RE.test(cleanedText);
  }

  function buildDocContextText(doc, options = {}) {
    const fields = doc && doc.fields ? doc.fields : {};
    const includeContent = options.includeContent !== false;
    return [
      fields.title && fields.title.text,
      fields.tags && fields.tags.text,
      fields.topics && fields.topics.text,
      fields.type && fields.type.text,
      fields.abstract && fields.abstract.text,
      includeContent ? (fields.content && fields.content.text) : '',
      fields.category && fields.category.text,
      fields.publication && fields.publication.text,
      fields.venue && fields.venue.text,
    ].filter(Boolean).join(' ');
  }

  function hasFundamentalsSignal(doc) {
    const text = buildDocContextText(doc, { includeContent: true })
      .replace(BEGINNER_FALSE_POSITIVE_SIGNAL_RE, ' ')
      .trim();
    if (!text) return false;
    if (!FUNDAMENTALS_SIGNAL_RE.test(text)) return false;
    if (!ADVANCED_RESEARCH_SIGNAL_RE.test(text)) return true;
    return /\bfundamentals?\b|\boverview\b|\bgetting started\b|\btutorial(?:s)?\b|\bguide\b|\bwalkthrough\b|\bbasics\b|\bintro(?:duction)?\b|\blearn\b/.test(text);
  }

  function hasAdvancedResearchSignal(doc) {
    const fields = doc && doc.fields ? doc.fields : {};
    const text = buildDocContextText(doc, { includeContent: true });
    if (!text) return false;
    if (ADVANCED_RESEARCH_SIGNAL_RE.test(text)) return true;
    const venueText = [
      fields.publication && fields.publication.text,
      fields.venue && fields.venue.text,
    ].filter(Boolean).join(' ');
    if (!venueText) return false;
    const researchVenue = /\bproceedings\b|\bjournal\b|\bconference\b|\bworkshop\b|\bsymposium\b|\btransactions\b|\barxiv\b/.test(venueText);
    const researchBody = /\bevaluation\b|\bbenchmark(?:ing)?\b|\banalysis\b|\bresults?\b|\binternals?\b|\bnovel\b/.test(text);
    return researchVenue && researchBody;
  }

  function computeSubprojectCoverage(model, topicValues, fallbackText = '') {
    const queryKeys = Array.isArray(model && model.subprojectTopicKeys)
      ? model.subprojectTopicKeys
      : [];
    if (!queryKeys.length) {
      return { matchedCount: 0, totalCount: 0, coverage: 0 };
    }

    const topics = collectCanonicalTopics(topicValues, fallbackText);
    if (!topics.length) {
      return { matchedCount: 0, totalCount: queryKeys.length, coverage: 0 };
    }

    const topicKeySet = new Set(topics.map((topic) => normalizeTopicKey(topic)));
    let matchedCount = 0;
    for (const topicKey of queryKeys) {
      if (topicKeySet.has(topicKey)) matchedCount += 1;
    }
    return {
      matchedCount,
      totalCount: queryKeys.length,
      coverage: queryKeys.length ? matchedCount / queryKeys.length : 0,
    };
  }

  function normalizeTopicKeyList(values) {
    const out = [];
    const seen = new Set();
    for (const value of (values || [])) {
      const key = normalizeTopicKey(value);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
    return out;
  }

  function topicTrendRecencyWeight(year) {
    const numeric = Number(year);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0.42;
    const bounded = Math.max(2005, Math.min(2035, Math.floor(numeric)));
    return 0.42 + (((bounded - 2005) / 30) * 0.9);
  }

  function addTopicTrendCoOccurrence(coOccurrence, topicKeys) {
    const keys = normalizeTopicKeyList(topicKeys);
    if (keys.length < 2) return;

    for (let i = 0; i < keys.length; i += 1) {
      const left = keys[i];
      for (let j = i + 1; j < keys.length; j += 1) {
        const right = keys[j];
        if (!left || !right || left === right) continue;

        let leftMap = coOccurrence.get(left);
        if (!leftMap) {
          leftMap = new Map();
          coOccurrence.set(left, leftMap);
        }
        leftMap.set(right, (leftMap.get(right) || 0) + 1);

        let rightMap = coOccurrence.get(right);
        if (!rightMap) {
          rightMap = new Map();
          coOccurrence.set(right, rightMap);
        }
        rightMap.set(left, (rightMap.get(left) || 0) + 1);
      }
    }
  }

  function buildTopicTrendIndex(records, kind = 'talk') {
    const values = Array.isArray(records) ? records : [];
    const topicStats = new Map();
    const coOccurrence = new Map();
    let maxCount = 0;
    let maxRecency = 0;

    for (const record of values) {
      const topics = kind === 'paper'
        ? getPaperKeyTopics(record, 12)
        : getTalkKeyTopics(record, 12);
      const topicKeys = normalizeTopicKeyList(topics);
      if (!topicKeys.length) continue;

      const year = kind === 'paper'
        ? parseYearNumber((record && (record._year || record.year || record.publishedDate || record.publishDate || record.date)) || '')
        : parseYearNumber((record && (record._year || record.meeting || record.meetingDate || record.date)) || '');
      const recency = topicTrendRecencyWeight(year);

      for (const key of topicKeys) {
        const prev = topicStats.get(key) || { count: 0, recency: 0 };
        const next = {
          count: prev.count + 1,
          recency: prev.recency + recency,
        };
        topicStats.set(key, next);
        if (next.count > maxCount) maxCount = next.count;
        if (next.recency > maxRecency) maxRecency = next.recency;
      }

      addTopicTrendCoOccurrence(coOccurrence, topicKeys);
    }

    return {
      topicStats,
      coOccurrence,
      maxCount,
      maxRecency,
      totalRecords: values.length,
    };
  }

  function resolveTopicTrendIndex(records, kind = 'talk') {
    const values = Array.isArray(records) ? records : [];
    const cache = kind === 'paper'
      ? PAPER_TOPIC_TREND_INDEX_CACHE
      : TALK_TOPIC_TREND_INDEX_CACHE;
    if (cache && cache.has(values)) return cache.get(values);

    const index = buildTopicTrendIndex(values, kind);
    if (cache) cache.set(values, index);
    return index;
  }

  function isBroadQueryTopicKey(topicKey) {
    const key = String(topicKey || '');
    return key === normalizeTopicKey('LLVM');
  }

  function collectQueryTopicKeys(model) {
    if (!model || typeof model !== 'object') return [];
    const subprojectTopicKeys = normalizeTopicKeyList(model.subprojectTopics);
    if (subprojectTopicKeys.length) return subprojectTopicKeys;
    return normalizeTopicKeyList(model.queryTopics);
  }

  function buildQueryTopicTrendProfile(model, trendIndex) {
    const queryTopicKeys = collectQueryTopicKeys(model);
    if (!queryTopicKeys.length || !trendIndex || !(trendIndex.topicStats instanceof Map)) return null;

    const queryKeySet = new Set(queryTopicKeys);
    const weights = new Map();
    let hasNarrowQueryTopics = false;

    for (const queryKey of queryTopicKeys) {
      if (!isBroadQueryTopicKey(queryKey)) hasNarrowQueryTopics = true;
      weights.set(queryKey, 1);
    }

    const expansionLimit = hasNarrowQueryTopics
      ? TOPIC_TREND_QUERY_EXPANSIONS_MAX
      : Math.max(2, Math.floor(TOPIC_TREND_QUERY_EXPANSIONS_MAX / 2));

    for (const queryKey of queryTopicKeys) {
      const queryStat = trendIndex.topicStats.get(queryKey);
      if (!queryStat || queryStat.count < 1) continue;
      const related = trendIndex.coOccurrence.get(queryKey);
      if (!(related instanceof Map) || !related.size) continue;

      const candidates = [];
      for (const [otherKey, count] of related.entries()) {
        if (!otherKey || queryKeySet.has(otherKey) || count < 1) continue;
        const otherStat = trendIndex.topicStats.get(otherKey);
        if (!otherStat || otherStat.count < 1) continue;
        const denominator = Math.sqrt(queryStat.count * otherStat.count);
        if (!(denominator > 0)) continue;
        const association = count / denominator;
        if (association < 0.18) continue;

        const popularity = trendIndex.maxCount > 0
          ? otherStat.count / trendIndex.maxCount
          : 0;
        const adjustedAssociation = association * (1 - Math.min(0.62, popularity * 0.62));
        if (adjustedAssociation <= 0.12) continue;
        candidates.push({ otherKey, adjustedAssociation });
      }

      candidates.sort((a, b) => b.adjustedAssociation - a.adjustedAssociation);
      for (let i = 0; i < candidates.length && i < expansionLimit; i += 1) {
        const candidate = candidates[i];
        const adjustedWeight = Math.min(
          0.82,
          Math.max(0.18, candidate.adjustedAssociation * (hasNarrowQueryTopics ? 1.3 : 0.95))
        );
        const previous = Number(weights.get(candidate.otherKey) || 0);
        if (adjustedWeight > previous) weights.set(candidate.otherKey, adjustedWeight);
      }
    }

    return {
      queryTopicKeys,
      queryKeySet,
      weights,
      hasNarrowQueryTopics,
    };
  }

  function computeTopicTrendBonus(topicValues, trendProfile, trendIndex) {
    if (!trendProfile || !(trendProfile.weights instanceof Map) || !trendProfile.weights.size) return 0;
    if (!trendIndex || !(trendIndex.topicStats instanceof Map)) return 0;

    const topicKeys = normalizeTopicKeyList(topicValues);
    if (!topicKeys.length) {
      return trendProfile.hasNarrowQueryTopics ? -0.4 : -0.12;
    }

    let matchedCount = 0;
    let directMatchCount = 0;
    let signal = 0;
    for (const topicKey of topicKeys) {
      const queryWeight = Number(trendProfile.weights.get(topicKey) || 0);
      if (!(queryWeight > 0)) continue;
      matchedCount += 1;
      if (trendProfile.queryKeySet.has(topicKey)) directMatchCount += 1;

      const stat = trendIndex.topicStats.get(topicKey);
      const popularity = stat && trendIndex.maxCount > 0
        ? stat.count / trendIndex.maxCount
        : 0;
      const recency = stat && trendIndex.maxRecency > 0
        ? stat.recency / trendIndex.maxRecency
        : 0;
      const trendStrength = (popularity * 0.62) + (recency * 0.38);
      signal += queryWeight * (0.56 + (trendStrength * 0.84));
    }

    if (!matchedCount) {
      return trendProfile.hasNarrowQueryTopics ? -0.5 : -0.15;
    }

    const coverage = matchedCount / Math.max(1, trendProfile.queryTopicKeys.length);
    let bonus = signal * (0.42 + (coverage * 0.78));
    if (directMatchCount > 0) bonus += Math.min(2.2, directMatchCount * 0.95);
    if (trendProfile.hasNarrowQueryTopics && coverage < 0.34) bonus *= 0.86;
    return bonus;
  }

  function scoreTalkWithModel(indexedTalk, model, relaxed = false) {
    const doc = buildTalkSearchDoc(indexedTalk);
    if (!doc) return 0;
    if (!evaluateQueryModelFilters(model, doc, {
      relaxed,
      fieldTargets: {
        title: ['title'],
        abstract: ['abstract'],
        authors: ['speakers'],
        topics: ['tags'],
        venue: ['meeting'],
        type: ['category'],
      },
      whereScopeTargets: {
        anywhere: ['title', 'speakers', 'tags', 'meeting', 'abstract', 'category', 'year'],
        title: ['title'],
        abstract: ['abstract'],
      },
    })) return 0;

    const hasCoreTerms = (
      (Array.isArray(model.clauses) && model.clauses.length > 0)
      || (Array.isArray(model.anyClauses) && model.anyClauses.length > 0)
      || (Array.isArray(model.requiredPhrases) && model.requiredPhrases.length > 0)
      || (Array.isArray(model.anyPhrases) && model.anyPhrases.length > 0)
      || (Array.isArray(model.phrases) && model.phrases.length > 0)
    );

    const base = hasCoreTerms
      ? scoreQueryModelAgainstDoc(model, doc, {
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
        whereScopeTargets: {
          anywhere: ['title', 'speakers', 'tags', 'meeting', 'abstract', 'category', 'year'],
          title: ['title'],
          abstract: ['abstract'],
        },
      })
      : 1;
    if (base <= 0) return 0;

    let total = base;
    const beginnerSignal = model.beginnerIntent ? hasBeginnerSignal(doc) : false;
    if (model.beginnerIntent && !beginnerSignal) return 0;
    const fundamentalsSignal = model.fundamentalsIntent ? hasFundamentalsSignal(doc) : false;
    const advancedSignal = model.advancedResearchIntent ? hasAdvancedResearchSignal(doc) : false;
    const topicCoverage = model.subprojectIntent
      ? computeSubprojectCoverage(
        model,
        getTalkKeyTopics(indexedTalk),
        `${indexedTalk.title || ''} ${indexedTalk.abstract || ''} ${(indexedTalk.tags || []).join(' ')} ${(indexedTalk.keywords || []).join(' ')}`
      )
      : { matchedCount: 0, totalCount: 0, coverage: 0 };
    const hasNarrowSubprojectIntent = !!(
      model.subprojectIntent
      && Array.isArray(model.subprojectTopics)
      && model.subprojectTopics.some((topic) => normalizeTopicKey(topic) !== normalizeTopicKey('LLVM'))
    );

    if (doc.year) {
      total += Math.max(0, doc.year - 2006) * 0.14;
    }
    if (model.beginnerIntent) {
      if (doc.fields.tags.text.includes('beginner')) total += 11;
      if (doc.fields.category.text.includes('tutorial')) total += 5;
      if (beginnerSignal) total += 4;
    } else if (model.fundamentalsIntent) {
      if (fundamentalsSignal) total += 7;
      if (beginnerSignal) total += 4;
      if (!fundamentalsSignal && !beginnerSignal && !relaxed) total *= 0.84;
      if (advancedSignal && !fundamentalsSignal && !beginnerSignal) total *= 0.9;
    }

    if (model.advancedResearchIntent) {
      if (advancedSignal) total += 9;
      else if (!relaxed) total *= 0.76;
      else total *= 0.86;
      if (fundamentalsSignal && !advancedSignal) total *= 0.92;
    }

    if (model.subprojectIntent) {
      if (topicCoverage.matchedCount > 0) {
        const baseBoost = hasNarrowSubprojectIntent ? 8 : 4;
        const coverageBoost = hasNarrowSubprojectIntent ? 14 : 8;
        total += baseBoost + (topicCoverage.coverage * coverageBoost);
      } else if (!relaxed) {
        total *= hasNarrowSubprojectIntent ? 0.74 : 0.9;
      } else {
        total *= hasNarrowSubprojectIntent ? 0.86 : 0.94;
      }
    }
    return total;
  }

  function scoreMatch(indexedTalk, tokensOrQuery) {
    const model = buildSearchQueryModel(tokensOrQuery);
    if (!modelHasSearchConstraints(model)) return 0;
    return scoreTalkWithModel(indexedTalk, model, false);
  }

  function scoreTalkRecordByModel(indexedTalk, model, options = {}) {
    if (!modelHasSearchConstraints(model)) return 0;
    const relaxed = options && options.relaxed === true;
    return scoreTalkWithModel(indexedTalk, model, relaxed);
  }

  function scoreTalkRecordByQuery(indexedTalk, query, options = {}) {
    const model = buildSearchQueryModel(query, options && options.advanced ? options.advanced : undefined);
    if (!modelHasSearchConstraints(model)) return 0;
    let score = scoreTalkWithModel(indexedTalk, model, false);
    if (score > 0 || !(options && options.relaxed === true)) return score;
    return scoreTalkWithModel(indexedTalk, model, true);
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

  function pruneScoredEntries(scoredEntries, model, options = {}) {
    const scored = Array.isArray(scoredEntries) ? scoredEntries : [];
    if (!scored.length) return [];
    const hasSignal = !!(
      model
      && (
        (Array.isArray(model.clauses) && model.clauses.length)
        || (Array.isArray(model.anyClauses) && model.anyClauses.length)
        || (Array.isArray(model.requiredPhrases) && model.requiredPhrases.length)
        || (Array.isArray(model.anyPhrases) && model.anyPhrases.length)
      )
    );
    if (!hasSignal) return scored;

    const topScore = Number(scored[0].score || 0);
    if (!(topScore > 0)) return scored;

    const clauseCount = Array.isArray(model && model.clauses) ? model.clauses.length : 0;
    const narrowClauseCount = Array.isArray(model && model.clauses)
      ? model.clauses.filter((clause) => clause && clause.isBroad !== true).length
      : 0;
    const requiredPhraseCount = Array.isArray(model && model.requiredPhrases)
      ? model.requiredPhrases.length
      : 0;
    const focusedIntent = narrowClauseCount >= 2 || requiredPhraseCount > 0;
    const highlySpecificIntent = narrowClauseCount >= 3 || requiredPhraseCount >= 1;

    let maxResults = Number.isFinite(options.maxResults) && options.maxResults > 0
      ? Math.floor(options.maxResults)
      : 1600;
    if (highlySpecificIntent) maxResults = Math.min(maxResults, 700);
    else if (focusedIntent) maxResults = Math.min(maxResults, 1000);

    let minTail = Number.isFinite(options.minTail) && options.minTail > 0
      ? Math.floor(options.minTail)
      : 120;
    if (highlySpecificIntent) minTail = Math.min(minTail, 100);

    let relativeFloor = Number.isFinite(options.relativeFloor)
      ? options.relativeFloor
      : (
        model.beginnerIntent
          ? 0.44
          : (clauseCount <= 2 ? 0.34 : 0.24)
      );
    if (focusedIntent) {
      relativeFloor = Math.max(relativeFloor, model.beginnerIntent ? 0.48 : 0.28);
    }
    if (highlySpecificIntent) {
      relativeFloor = Math.max(relativeFloor, model.beginnerIntent ? 0.54 : 0.34);
    }

    let absoluteFloor = Number.isFinite(options.absoluteFloor)
      ? options.absoluteFloor
      : (model.beginnerIntent ? 14 : 8);
    if (focusedIntent) absoluteFloor = Math.max(absoluteFloor, model.beginnerIntent ? 15 : 9);
    if (highlySpecificIntent) absoluteFloor = Math.max(absoluteFloor, model.beginnerIntent ? 16 : 11);

    const threshold = Math.max(absoluteFloor, topScore * Math.max(0.08, relativeFloor));
    const filtered = scored.filter((entry) => Number(entry.score || 0) >= threshold);
    if (filtered.length) return filtered.slice(0, maxResults);
    return scored.slice(0, Math.min(maxResults, minTail));
  }

  function rankTalksByQuery(indexedTalks, query, options = {}) {
    const talks = Array.isArray(indexedTalks) ? indexedTalks : [];
    const model = buildSearchQueryModel(query, options && options.advanced ? options.advanced : undefined);

    if (!modelHasSearchConstraints(model)) {
      return [...talks].sort((a, b) => String(b.meeting || '').localeCompare(String(a.meeting || '')));
    }

    // Guard expensive corpus-wide context signals on large collections to keep UI responsive.
    const useAdvancedCorpusSignals = talks.length <= 320;
    const talkTrendIndex = useAdvancedCorpusSignals ? resolveTopicTrendIndex(talks, 'talk') : null;
    const talkTrendProfile = useAdvancedCorpusSignals ? buildQueryTopicTrendProfile(model, talkTrendIndex) : null;
    const talkTrendScale = useAdvancedCorpusSignals
      ? (
        model.advancedResearchIntent
          ? 2.3
          : ((model.beginnerIntent || model.fundamentalsIntent) ? 1.8 : 2.0)
      )
      : 0;
    const talkComboTrendIndex = useAdvancedCorpusSignals ? resolveComboTrendIndex(talks, 'talk') : null;
    const talkComboProfile = useAdvancedCorpusSignals ? buildQueryComboProfile(model, talkComboTrendIndex, 'talk') : null;
    const talkRarityFieldConfig = useAdvancedCorpusSignals
      ? [
        { key: 'title', weight: 1.42, fuzzy: true },
        { key: 'tags', weight: 1.28, fuzzy: true },
        { key: 'abstract', weight: 0.96, fuzzy: false },
        { key: 'speakers', weight: 0.72, fuzzy: true },
        { key: 'meeting', weight: 0.58, fuzzy: true },
        { key: 'category', weight: 0.48, fuzzy: false },
      ]
      : [];
    const talkRarityProfile = useAdvancedCorpusSignals
      ? buildClauseRarityProfile(
        model && model.clauses,
        talks,
        buildTalkSearchDoc,
        talkRarityFieldConfig,
        { matchThreshold: 0.94 }
      )
      : null;

    let scored = [];
    for (const talk of talks) {
      let score = scoreTalkWithModel(talk, model, false);
      if (score > 0 && talkComboProfile) {
        const comboAdjustment = computeComboContextAdjustment(resolveTalkComboSet(talk), talkComboProfile);
        if (comboAdjustment > 0) score *= 1 + (comboAdjustment * 0.24);
        else score *= 1 + Math.max(-0.14, comboAdjustment * 0.32);
      }
      if (score > 0 && talkRarityProfile) {
        const doc = buildTalkSearchDoc(talk);
        const rarityBonus = computeClauseRarityBonus(doc, talkRarityProfile, talkRarityFieldConfig, {
          matchThreshold: 1.04,
        });
        if (rarityBonus > 0) score *= 1 + (rarityBonus * 0.18);
        else score *= 1 + Math.max(-0.12, rarityBonus * 0.3);
      }
      if (score > 0 && talkTrendProfile) {
        const trendBonus = computeTopicTrendBonus(
          getTalkKeyTopics(talk, 12),
          talkTrendProfile,
          talkTrendIndex
        );
        if (trendBonus !== 0) {
          score += trendBonus * talkTrendScale;
          if (trendBonus < 0) score *= 0.97;
        }
      }
      if (score > 0) scored.push({ talk, score });
    }

    if (!scored.length && (model.clauses.length >= 2 || model.hasFilters)) {
      for (const talk of talks) {
        let score = scoreTalkWithModel(talk, model, true);
        if (score > 0 && talkComboProfile) {
          const comboAdjustment = computeComboContextAdjustment(resolveTalkComboSet(talk), talkComboProfile);
          if (comboAdjustment > 0) score *= 1 + (comboAdjustment * 0.18);
          else score *= 1 + Math.max(-0.1, comboAdjustment * 0.24);
        }
        if (score > 0 && talkRarityProfile) {
          const doc = buildTalkSearchDoc(talk);
          const rarityBonus = computeClauseRarityBonus(doc, talkRarityProfile, talkRarityFieldConfig, {
            matchThreshold: 0.94,
          });
          if (rarityBonus > 0) score *= 1 + (rarityBonus * 0.14);
          else score *= 1 + Math.max(-0.08, rarityBonus * 0.22);
        }
        if (score > 0 && talkTrendProfile) {
          const trendBonus = computeTopicTrendBonus(
            getTalkKeyTopics(talk, 12),
            talkTrendProfile,
            talkTrendIndex
          );
          if (trendBonus !== 0) {
            score += trendBonus * (talkTrendScale * 0.9);
            if (trendBonus < 0) score *= 0.98;
          }
        }
        if (score > 0) scored.push({ talk, score });
      }
    }

    scored.sort(compareRankedEntries);
    const pruned = pruneScoredEntries(scored, model, {
      maxResults: 1600,
      minTail: 120,
      relativeFloor: model.beginnerIntent ? 0.46 : (model.clauses.length <= 2 ? 0.34 : 0.24),
      absoluteFloor: model.beginnerIntent ? 14 : 8,
    });
    return pruned.map((entry) => entry.talk);
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
      || `${Array.isArray(paper.tags) ? paper.tags.join(' ') : ''} ${Array.isArray(paper.keywords) ? paper.keywords.join(' ') : ''} ${Array.isArray(paper.matchedSubprojects) ? paper.matchedSubprojects.join(' ') : ''}`;
    const abstractText = paper._abstractLower || paper.abstract || '';
    const content = paper._contentLower
      || paper.content
      || paper.bodyText
      || paper.body
      || paper.fullText
      || paper.text
      || paper.markdown
      || paper.html
      || '';
    const publication = paper._publicationLower || paper.publication || '';
    const venue = paper._venueLower || paper.venue || '';
    const yearField = paper._yearLower || paper._year || paper.year || '';
    const reviewSignal = /\b(review|survey|systematic review|literature review|meta analysis|meta-analysis)\b/i
      .test(`${paper.title || ''} ${paper.abstract || ''} ${paper.type || ''}`);
    const tutorialSignal = /\btutorial(?:s)?\b/i.test(`${paper.title || ''} ${paper.abstract || ''} ${paper.type || ''}`);
    const typeField = [
      paper.type || '',
      paper._isBlog ? 'blog' : 'paper',
      reviewSignal ? 'review' : '',
      tutorialSignal ? 'tutorial' : '',
    ].filter(Boolean).join(' ');

    const doc = {
      fields: {
        title: makeSearchField(title),
        authors: makeSearchField(authors),
        topics: makeSearchField(topics),
        type: makeSearchField(typeField),
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
    if (!evaluateQueryModelFilters(model, doc, {
      relaxed,
      fieldTargets: {
        title: ['title'],
        abstract: ['abstract', 'content'],
        authors: ['authors'],
        topics: ['topics'],
        venue: ['publication', 'venue'],
        type: ['type', 'topics'],
      },
      whereScopeTargets: {
        anywhere: ['title', 'authors', 'topics', 'type', 'publication', 'venue', 'abstract', 'content', 'year'],
        title: ['title'],
        abstract: ['abstract', 'content'],
      },
    })) return 0;

    const hasCoreTerms = (
      (Array.isArray(model.clauses) && model.clauses.length > 0)
      || (Array.isArray(model.anyClauses) && model.anyClauses.length > 0)
      || (Array.isArray(model.requiredPhrases) && model.requiredPhrases.length > 0)
      || (Array.isArray(model.anyPhrases) && model.anyPhrases.length > 0)
      || (Array.isArray(model.phrases) && model.phrases.length > 0)
    );

    const base = hasCoreTerms
      ? scoreQueryModelAgainstDoc(model, doc, {
        relaxed,
        fieldConfig: [
          { key: 'title', weight: 15.4, fuzzy: true },
          { key: 'authors', weight: 11.1, fuzzy: true },
          { key: 'topics', weight: 10.2, fuzzy: true },
          { key: 'type', weight: 7.6, fuzzy: true },
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
          { key: 'type', weight: 3.1 },
          { key: 'publication', weight: 2.3 },
          { key: 'venue', weight: 2.0 },
          { key: 'abstract', weight: 1.2 },
          { key: 'content', weight: 0.9 },
        ],
        whereScopeTargets: {
          anywhere: ['title', 'authors', 'topics', 'type', 'publication', 'venue', 'abstract', 'content', 'year'],
          title: ['title'],
          abstract: ['abstract', 'content'],
        },
      })
      : 1;
    if (base <= 0) return 0;

    let total = base;
    const beginnerSignal = model.beginnerIntent ? hasBeginnerSignal(doc) : false;
    if (model.beginnerIntent && !beginnerSignal) return 0;
    const fundamentalsSignal = model.fundamentalsIntent ? hasFundamentalsSignal(doc) : false;
    const advancedSignal = model.advancedResearchIntent ? hasAdvancedResearchSignal(doc) : false;
    const topicCoverage = model.subprojectIntent
      ? computeSubprojectCoverage(
        model,
        getPaperKeyTopics(paper),
        `${paper.title || ''} ${paper.abstract || ''} ${paper.publication || ''} ${paper.venue || ''} ${(paper.tags || []).join(' ')} ${(paper.keywords || []).join(' ')}`
      )
      : { matchedCount: 0, totalCount: 0, coverage: 0 };
    const hasNarrowSubprojectIntent = !!(
      model.subprojectIntent
      && Array.isArray(model.subprojectTopics)
      && model.subprojectTopics.some((topic) => normalizeTopicKey(topic) !== normalizeTopicKey('LLVM'))
    );

    if (doc.year) total += Math.max(0, doc.year - 2000) * 0.12;
    if (doc.citationCount > 0) total += Math.min(8, Math.log1p(doc.citationCount) * 1.3);
    if (model.beginnerIntent && doc.fields.topics.text.includes('beginner')) total += 8;
    if (model.beginnerIntent && beginnerSignal) total += 4;
    if (!model.beginnerIntent && model.fundamentalsIntent) {
      if (fundamentalsSignal) total += 7;
      if (!fundamentalsSignal && !relaxed) total *= 0.84;
      if (advancedSignal && !fundamentalsSignal) total *= 0.92;
    }
    if (model.advancedResearchIntent) {
      if (advancedSignal) total += 10;
      else if (!relaxed) total *= 0.74;
      else total *= 0.84;
      if (fundamentalsSignal && !advancedSignal) total *= 0.9;
    }
    if (model.subprojectIntent) {
      if (topicCoverage.matchedCount > 0) {
        const baseBoost = hasNarrowSubprojectIntent ? 8 : 4;
        const coverageBoost = hasNarrowSubprojectIntent ? 16 : 9;
        total += baseBoost + (topicCoverage.coverage * coverageBoost);
      } else if (!relaxed) total *= hasNarrowSubprojectIntent ? 0.76 : 0.9;
      else total *= hasNarrowSubprojectIntent ? 0.88 : 0.95;
    }
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

  const CROSS_TYPE_KIND_PRIOR = Object.freeze({
    talk: 1.02,
    paper: 1.0,
    blog: 0.98,
    docs: 0.94,
    person: 0.92,
  });

  const CROSS_TYPE_TIER_MULTIPLIER = Object.freeze({
    strict: 1.0,
    relaxed: 0.84,
    fallback: 0.62,
  });

  function boundCrossTypeValue(value, min, max) {
    if (!Number.isFinite(value)) return min;
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }

  function composeCrossTypeRelevance(rawScore, options = {}) {
    const raw = Number(rawScore);
    if (!Number.isFinite(raw) || raw <= 0) return 0;

    const opts = options && typeof options === 'object' ? options : {};
    const kindTopCandidate = Number(opts.kindTopScore);
    const kindTopScore = Number.isFinite(kindTopCandidate) && kindTopCandidate > 0
      ? kindTopCandidate
      : raw;
    const globalTopCandidate = Number(opts.globalTopScore);
    const globalTopScore = Number.isFinite(globalTopCandidate) && globalTopCandidate > 0
      ? globalTopCandidate
      : raw;

    const rankRaw = Number(opts.rankIndex);
    const rankIndex = Number.isFinite(rankRaw) && rankRaw >= 0 ? Math.floor(rankRaw) : 0;
    const kind = normalizeSearchText(opts.kind || '');
    const tier = normalizeSearchText(opts.tier || 'strict');

    const kindPrior = CROSS_TYPE_KIND_PRIOR[kind] || 1;
    const tierMultiplier = CROSS_TYPE_TIER_MULTIPLIER[tier] || 1;

    const kindRatio = boundCrossTypeValue(raw / kindTopScore, 0.06, 1.8);
    const globalRatio = boundCrossTypeValue(raw / globalTopScore, 0.04, 1.4);
    const rankSignal = 1 / Math.log2(rankIndex + 2);

    const rawSignal = Math.log1p(raw) * 34;
    const ratioSignal = (kindRatio * 96) + (globalRatio * 72);
    const rankBonus = rankSignal * 26;

    let score = (rawSignal + ratioSignal + rankBonus) * tierMultiplier * kindPrior;
    if (globalRatio < 0.15) score *= 0.84;
    if (globalRatio < 0.08) score *= 0.72;
    return score > 0 ? score : 0;
  }

  function rankPaperRecordsByQuery(papers, query, options = {}) {
    const records = Array.isArray(papers) ? papers : [];
    const model = buildSearchQueryModel(query, options && options.advanced ? options.advanced : undefined);

    if (!modelHasSearchConstraints(model)) {
      return [...records].sort((a, b) => {
        const aYear = parseYearNumber((a && (a._year || a.year)) || '');
        const bYear = parseYearNumber((b && (b._year || b.year)) || '');
        if (aYear !== bYear) return bYear - aYear;
        const aTitle = String((a && a.title) || '');
        const bTitle = String((b && b.title) || '');
        return aTitle.localeCompare(bTitle);
      });
    }

    // Guard expensive corpus-wide context signals on large collections to keep UI responsive.
    const useAdvancedCorpusSignals = records.length <= 320;
    const paperTrendIndex = useAdvancedCorpusSignals ? resolveTopicTrendIndex(records, 'paper') : null;
    const paperTrendProfile = useAdvancedCorpusSignals ? buildQueryTopicTrendProfile(model, paperTrendIndex) : null;
    const paperTrendScale = useAdvancedCorpusSignals
      ? (
        model.advancedResearchIntent
          ? 2.55
          : ((model.beginnerIntent || model.fundamentalsIntent) ? 1.9 : 2.2)
      )
      : 0;
    const paperComboTrendIndex = useAdvancedCorpusSignals ? resolveComboTrendIndex(records, 'paper') : null;
    const paperComboProfile = useAdvancedCorpusSignals ? buildQueryComboProfile(model, paperComboTrendIndex, 'paper') : null;
    const paperRarityFieldConfig = useAdvancedCorpusSignals
      ? [
        { key: 'title', weight: 1.5, fuzzy: true },
        { key: 'topics', weight: 1.36, fuzzy: true },
        { key: 'abstract', weight: 1.02, fuzzy: false },
        { key: 'content', weight: 0.9, fuzzy: false },
        { key: 'publication', weight: 0.72, fuzzy: true },
        { key: 'venue', weight: 0.66, fuzzy: true },
        { key: 'authors', weight: 0.62, fuzzy: true },
        { key: 'type', weight: 0.54, fuzzy: true },
      ]
      : [];
    const paperRarityProfile = useAdvancedCorpusSignals
      ? buildClauseRarityProfile(
        model && model.clauses,
        records,
        buildPaperSearchDoc,
        paperRarityFieldConfig,
        { matchThreshold: 0.92 }
      )
      : null;

    let scored = [];
    for (const paper of records) {
      let score = scorePaperWithModel(paper, model, false);
      if (score > 0 && paperComboProfile) {
        const comboAdjustment = computeComboContextAdjustment(resolvePaperComboSet(paper), paperComboProfile);
        if (comboAdjustment > 0) score *= 1 + (comboAdjustment * 0.27);
        else score *= 1 + Math.max(-0.16, comboAdjustment * 0.34);
      }
      if (score > 0 && paperRarityProfile) {
        const doc = buildPaperSearchDoc(paper);
        const rarityBonus = computeClauseRarityBonus(doc, paperRarityProfile, paperRarityFieldConfig, {
          matchThreshold: 1.02,
        });
        if (rarityBonus > 0) score *= 1 + (rarityBonus * 0.22);
        else score *= 1 + Math.max(-0.15, rarityBonus * 0.34);
      }
      if (score > 0 && paperTrendProfile) {
        const trendBonus = computeTopicTrendBonus(
          getPaperKeyTopics(paper, 12),
          paperTrendProfile,
          paperTrendIndex
        );
        if (trendBonus !== 0) {
          score += trendBonus * paperTrendScale;
          if (trendBonus < 0) score *= 0.97;
        }
      }
      if (score > 0) scored.push({ paper, score });
    }

    if (!scored.length && (model.clauses.length >= 2 || model.hasFilters)) {
      for (const paper of records) {
        let score = scorePaperWithModel(paper, model, true);
        if (score > 0 && paperComboProfile) {
          const comboAdjustment = computeComboContextAdjustment(resolvePaperComboSet(paper), paperComboProfile);
          if (comboAdjustment > 0) score *= 1 + (comboAdjustment * 0.2);
          else score *= 1 + Math.max(-0.12, comboAdjustment * 0.26);
        }
        if (score > 0 && paperRarityProfile) {
          const doc = buildPaperSearchDoc(paper);
          const rarityBonus = computeClauseRarityBonus(doc, paperRarityProfile, paperRarityFieldConfig, {
            matchThreshold: 0.92,
          });
          if (rarityBonus > 0) score *= 1 + (rarityBonus * 0.16);
          else score *= 1 + Math.max(-0.1, rarityBonus * 0.26);
        }
        if (score > 0 && paperTrendProfile) {
          const trendBonus = computeTopicTrendBonus(
            getPaperKeyTopics(paper, 12),
            paperTrendProfile,
            paperTrendIndex
          );
          if (trendBonus !== 0) {
            score += trendBonus * (paperTrendScale * 0.9);
            if (trendBonus < 0) score *= 0.98;
          }
        }
        if (score > 0) scored.push({ paper, score });
      }
    }

    scored.sort(compareRankedPaperEntries);
    const pruned = pruneScoredEntries(scored, model, {
      maxResults: 1800,
      minTail: 140,
      relativeFloor: model.beginnerIntent ? 0.44 : (model.clauses.length <= 2 ? 0.32 : 0.22),
      absoluteFloor: model.beginnerIntent ? 14 : 7,
    });
    return pruned.map((entry) => entry.paper);
  }

  function scorePaperRecordByModel(paper, model, options = {}) {
    if (!modelHasSearchConstraints(model)) return 0;
    const relaxed = options && options.relaxed === true;
    return scorePaperWithModel(paper, model, relaxed);
  }

  function scorePaperRecordByQuery(paper, query, options = {}) {
    const model = buildSearchQueryModel(query, options && options.advanced ? options.advanced : undefined);
    if (!modelHasSearchConstraints(model)) return 0;
    let score = scorePaperWithModel(paper, model, false);
    if (score > 0 || !(options && options.relaxed === true)) return score;
    return scorePaperWithModel(paper, model, true);
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
    'llvm-libgcc',
    'Clang',
    'clang-tools-extra',
    'MLIR',
    'Flang',
    'flang-rt',
    'LLD',
    'LLDB',
    'CIRCT',
    'Polly',
    'cmake',
    'cross-project-tests',
    'OpenMP',
    'offload',
    'compiler-rt',
    'runtimes',
    'libc++',
    'libc++abi',
    'libc',
    'libclc',
    'libsycl',
    'libunwind',
    'BOLT',
    'orc-rt',
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
    llvmlibgcc: 'llvm-libgcc',
    'llvm-libgcc': 'llvm-libgcc',
    clang: 'Clang',
    clangd: 'Clang',
    clangtoolsextra: 'clang-tools-extra',
    'clang-tools-extra': 'clang-tools-extra',
    clangtools: 'clang-tools-extra',
    clangir: 'ClangIR',
    mlir: 'MLIR',
    flang: 'Flang',
    flangrt: 'flang-rt',
    'flang-rt': 'flang-rt',
    lld: 'LLD',
    lldb: 'LLDB',
    circt: 'CIRCT',
    polly: 'Polly',
    cmake: 'cmake',
    crossprojecttests: 'cross-project-tests',
    'cross-project-tests': 'cross-project-tests',
    openmp: 'OpenMP',
    offload: 'offload',
    offloading: 'offload',
    libomp: 'OpenMP',
    compilerrt: 'compiler-rt',
    'compiler-rt': 'compiler-rt',
    libfuzzer: 'compiler-rt',
    runtimes: 'runtimes',
    runtime: 'runtimes',
    libcxx: 'libc++',
    'libc++': 'libc++',
    libcxxabi: 'libc++abi',
    'libc++abi': 'libc++abi',
    libc: 'libc',
    libclc: 'libclc',
    libsycl: 'libsycl',
    libunwind: 'libunwind',
    bolt: 'BOLT',
    orcrt: 'orc-rt',
    'orc-rt': 'orc-rt',
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
    { topic: 'llvm-libgcc', pattern: /\bllvm[- ]?libgcc\b/i },
    { topic: 'Clang', pattern: /\bclang(?:d)?\b/i },
    { topic: 'clang-tools-extra', pattern: /\bclang[- ]tools[- ]extra\b|\bclang[- ](?:tidy|format|query)\b/i },
    { topic: 'MLIR', pattern: /\bmlir\b|\bmulti[- ]level intermediate representation\b/i },
    { topic: 'Flang', pattern: /\bflang\b/i },
    { topic: 'flang-rt', pattern: /\bflang[- ]?rt\b/i },
    { topic: 'LLD', pattern: /\blld\b/i },
    { topic: 'LLDB', pattern: /\blldb\b/i },
    { topic: 'CIRCT', pattern: /\bcirct\b/i },
    { topic: 'Polly', pattern: /\bpolly\b/i },
    { topic: 'cmake', pattern: /\bcmake\b/i },
    { topic: 'cross-project-tests', pattern: /\bcross[- ]project[- ]tests?\b/i },
    { topic: 'OpenMP', pattern: /\bopenmp\b|\blibomp\b/i },
    { topic: 'offload', pattern: /\boffload(?:ing|ed)?\b|\blibomptarget\b/i },
    { topic: 'compiler-rt', pattern: /\bcompiler[- ]?rt\b|\blibfuzzer\b/i },
    { topic: 'runtimes', pattern: /\bllvm[- ]runtimes?\b|\bruntime (?:libraries|library)\b/i },
    { topic: 'libc++', pattern: /\blibc\+\+\b/i },
    { topic: 'libc++abi', pattern: /\blibc\+\+abi\b|\blibcxxabi\b/i },
    { topic: 'libc', pattern: /\blibc\b/i },
    { topic: 'libclc', pattern: /\blibclc\b/i },
    { topic: 'libsycl', pattern: /\blibsycl\b|\bsycl\b/i },
    { topic: 'libunwind', pattern: /\blibunwind\b/i },
    { topic: 'BOLT', pattern: /\bbolt\b/i },
    { topic: 'orc-rt', pattern: /\borc[- ]?rt\b|\borc runtime\b/i },
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
      ...((paper && paper.matchedSubprojects) || []),
    ];
    const text = [
      collapseWhitespace(paper && paper.title),
      collapseWhitespace(paper && paper.abstract),
      collapseWhitespace(paper && paper.publication),
      collapseWhitespace(paper && paper.venue),
      collapseWhitespace(paper && paper.sourceName),
      collapseWhitespace(paper && paper.source),
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

  function safeStorageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function safeStorageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Ignore storage quota/security errors.
    }
  }

  function safeStorageRemove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore storage quota/security errors.
    }
  }

  function safeSessionSet(key, value) {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // Ignore storage quota/security errors.
    }
  }

  function safeSessionGet(key) {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function safeSessionRemove(key) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Ignore storage quota/security errors.
    }
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Fall through to legacy copy strategy.
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

  function getClosestTarget(event, selector) {
    const target = event && event.target;
    if (!target || typeof target.closest !== 'function') return null;
    return target.closest(selector);
  }

  const DISCLOSURE_MENU_CONTROLLERS = new WeakMap();

  function ensureDisclosureMenu({ menu, toggle, panel, closeOnPanelSelector = 'a,button', onPanelClick = null }) {
    if (!menu || !toggle || !panel) return null;

    let controller = DISCLOSURE_MENU_CONTROLLERS.get(menu);
    if (!controller) {
      controller = {
        menu,
        toggle,
        panel,
        closeOnPanelSelector,
        onPanelClick,
      };

      controller.open = () => {
        controller.menu.classList.add('open');
        controller.panel.hidden = false;
        controller.toggle.setAttribute('aria-expanded', 'true');
      };

      controller.close = () => {
        controller.menu.classList.remove('open');
        controller.panel.hidden = true;
        controller.toggle.setAttribute('aria-expanded', 'false');
      };

      controller.isInside = (target) => !!target && controller.menu.contains(target);

      controller.handleToggleClick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (controller.menu.classList.contains('open')) controller.close();
        else controller.open();
      };

      controller.handlePanelClick = (event) => {
        if (typeof controller.onPanelClick === 'function') {
          const handled = controller.onPanelClick(event, controller);
          if (handled) return;
        }
        const target = controller.closeOnPanelSelector
          ? getClosestTarget(event, controller.closeOnPanelSelector)
          : null;
        if (target) controller.close();
      };

      controller.handlePointerDown = (event) => {
        if (!controller.isInside(event.target)) controller.close();
      };

      controller.handleFocusIn = (event) => {
        if (!controller.isInside(event.target)) controller.close();
      };

      controller.handleKeyDown = (event) => {
        if (event.key === 'Escape' && controller.menu.classList.contains('open')) {
          controller.close();
          controller.toggle.focus();
        }
      };

      controller.toggle.addEventListener('click', controller.handleToggleClick);
      controller.panel.addEventListener('click', controller.handlePanelClick);
      document.addEventListener('pointerdown', controller.handlePointerDown);
      document.addEventListener('focusin', controller.handleFocusIn);
      document.addEventListener('keydown', controller.handleKeyDown);

      DISCLOSURE_MENU_CONTROLLERS.set(menu, controller);
    } else {
      controller.menu = menu;
      controller.toggle = toggle;
      controller.panel = panel;
      controller.closeOnPanelSelector = closeOnPanelSelector;
      controller.onPanelClick = onPanelClick;
    }

    controller.close();
    return controller;
  }

  function createPageShell(options = {}) {
    const themePrefKey = String(options.themePrefKey || 'llvm-hub-theme-preference');
    const textSizeKey = String(options.textSizeKey || 'llvm-hub-text-size');
    const themePrefValues = new Set(Array.isArray(options.themePrefValues) && options.themePrefValues.length
      ? options.themePrefValues
      : ['system', 'light', 'dark']);
    const textSizeValues = new Set(Array.isArray(options.textSizeValues) && options.textSizeValues.length
      ? options.textSizeValues
      : ['small', 'default', 'large']);
    const mobileHeaderActionMap = (options.mobileHeaderActionMap && typeof options.mobileHeaderActionMap === 'object')
      ? options.mobileHeaderActionMap
      : null;
    const popoverTargets = Array.isArray(options.mobileHeaderPopoverTargets) && options.mobileHeaderPopoverTargets.length
      ? options.mobileHeaderPopoverTargets
      : [
        { menuId: 'share-menu', panelId: 'share-panel', toggleId: 'share-btn' },
        { menuId: 'customization-menu', panelId: 'customization-panel', toggleId: 'customization-toggle' },
      ];

    let systemThemeQuery = null;

    function getThemePreference() {
      const saved = safeStorageGet(themePrefKey);
      return themePrefValues.has(saved) ? saved : 'system';
    }

    function resolveTheme(preference) {
      if (preference === 'light' || preference === 'dark') return preference;
      if (typeof window.matchMedia !== 'function') return 'light';
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function applyTheme(preference, persist = false) {
      const pref = themePrefValues.has(preference) ? preference : 'system';
      const resolved = resolveTheme(pref);
      document.documentElement.setAttribute('data-theme', resolved);
      document.documentElement.setAttribute('data-theme-preference', pref);
      document.documentElement.style.backgroundColor = resolved === 'dark' ? '#000000' : '#f5f5f5';
      if (persist) safeStorageSet(themePrefKey, pref);
    }

    function getTextSizePreference() {
      const saved = safeStorageGet(textSizeKey);
      return textSizeValues.has(saved) ? saved : 'default';
    }

    function applyTextSize(size, persist = false) {
      const textSize = textSizeValues.has(size) ? size : 'default';
      if (textSize === 'default') {
        document.documentElement.removeAttribute('data-text-size');
      } else {
        document.documentElement.setAttribute('data-text-size', textSize);
      }
      if (persist) safeStorageSet(textSizeKey, textSize);
    }

    function syncCustomizationMenuControls() {
      const themePreference = getThemePreference();
      const textSizePreference = getTextSizePreference();
      const themeSelectIds = ['custom-theme-select', 'mobile-theme-select'];
      const textSizeSelectIds = ['custom-text-size-select', 'mobile-text-size-select'];

      themeSelectIds.forEach((id) => {
        const select = document.getElementById(id);
        if (select) select.value = themePreference;
      });
      textSizeSelectIds.forEach((id) => {
        const select = document.getElementById(id);
        if (select) select.value = textSizePreference;
      });
    }

    function handleSystemThemeChange() {
      if (getThemePreference() === 'system') {
        applyTheme('system');
        syncCustomizationMenuControls();
      }
    }

    function initTheme() {
      applyTheme(getThemePreference());
      if (systemThemeQuery || typeof window.matchMedia !== 'function') return;

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
      ensureDisclosureMenu({ menu, toggle, panel });

      if (menu.dataset.pageShellBound === '1') return;
      menu.dataset.pageShellBound = '1';

      themeSelect.addEventListener('change', () => {
        const preference = themePrefValues.has(themeSelect.value) ? themeSelect.value : 'system';
        applyTheme(preference, true);
        syncCustomizationMenuControls();
      });

      textSizeSelect.addEventListener('change', () => {
        const size = textSizeValues.has(textSizeSelect.value) ? textSizeSelect.value : 'default';
        applyTextSize(size, true);
        syncCustomizationMenuControls();
      });

      resetBtn.addEventListener('click', () => {
        safeStorageRemove(themePrefKey);
        safeStorageRemove(textSizeKey);
        applyTheme('system');
        applyTextSize('default');
        syncCustomizationMenuControls();
      });
    }

    function closeHeaderPopover(menuId, panelId, toggleId) {
      const menu = document.getElementById(menuId);
      const panel = document.getElementById(panelId);
      const toggle = document.getElementById(toggleId);
      if (menu) menu.classList.remove('open');
      if (panel) panel.hidden = true;
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    }

    function closeHeaderPopovers() {
      for (const target of popoverTargets) {
        closeHeaderPopover(target.menuId, target.panelId, target.toggleId);
      }
    }

    function ensureMobileToggleIcon(toggle) {
      if (!toggle || toggle.dataset.mobileToggleNormalized === '1') return;
      const iconMarkup = `
        <span class="mobile-nav-toggle-icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="4" y1="7" x2="20" y2="7"></line>
            <line x1="4" y1="12" x2="20" y2="12"></line>
            <line x1="4" y1="17" x2="20" y2="17"></line>
          </svg>
        </span>
        <span>Menu</span>`;
      toggle.innerHTML = iconMarkup;
      toggle.dataset.mobileToggleNormalized = '1';
    }

    function readMobilePanelLinkEntries(panel) {
      const nodes = [...panel.querySelectorAll('a.mobile-nav-link[href]')];
      const seen = new Set();
      const browseLinks = [];
      const docsLinks = [];

      nodes.forEach((node) => {
        const href = String(node.getAttribute('href') || '').trim();
        const label = String(node.textContent || '').replace(/\s+/g, ' ').trim();
        if (!href || !label) return;

        const key = `${href}|${label.toLowerCase()}`;
        if (seen.has(key)) return;
        seen.add(key);

        const isDocsHref = /(^|\/)docs(?:\/|$)/i.test(href);
        const isDocsLabel = /^docs\b/i.test(label);
        const entry = {
          href,
          label: label.replace(/^docs:\s*/i, ''),
          active: node.classList.contains('active') || node.getAttribute('aria-current') === 'page',
          current: node.getAttribute('aria-current') === 'page',
        };
        if (isDocsHref || isDocsLabel) docsLinks.push(entry);
        else browseLinks.push(entry);
      });

      if (!docsLinks.length) {
        docsLinks.push(
          { href: 'docs/', label: 'LLVM Core', active: false, current: false },
          { href: 'docs/clang/', label: 'Clang', active: false, current: false },
          { href: 'docs/lldb/', label: 'LLDB', active: false, current: false },
        );
      }

      return { browseLinks, docsLinks };
    }

    function buildMobileNavGroup(groupLabel, groupAriaLabel, links) {
      const group = document.createElement('div');
      group.className = 'mobile-nav-group';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', groupAriaLabel);

      const label = document.createElement('p');
      label.className = 'mobile-nav-group-label';
      label.textContent = groupLabel;
      group.appendChild(label);

      links.forEach((entry) => {
        const link = document.createElement('a');
        link.className = 'mobile-nav-link';
        link.href = entry.href;
        link.textContent = entry.label;
        if (entry.active) link.classList.add('active');
        if (entry.current) link.setAttribute('aria-current', 'page');
        group.appendChild(link);
      });

      return group;
    }

    function normalizeMobileNavPanelGroups(panel) {
      if (!panel) return;
      const hasGroupNodes = !!panel.querySelector('.mobile-nav-group');
      const hasTopLevelLinks = [...panel.children].some((node) => (
        node
        && node.nodeType === 1
        && node.matches
        && node.matches('a.mobile-nav-link')
      ));

      if (hasGroupNodes && !hasTopLevelLinks) {
        ensureMobileSettingsGroup(panel);
        return;
      }

      const { browseLinks, docsLinks } = readMobilePanelLinkEntries(panel);
      panel.innerHTML = '';
      if (browseLinks.length) {
        panel.appendChild(buildMobileNavGroup('Browse', 'Browse', browseLinks));
      }
      if (docsLinks.length) {
        panel.appendChild(buildMobileNavGroup('Docs', 'Documentation sources', docsLinks));
      }
      ensureMobileSettingsGroup(panel);
    }

    function ensureMobileSettingsGroup(panel) {
      if (!panel) return;
      panel.querySelectorAll('.mobile-nav-group[data-mobile-group="tools"]').forEach((node) => {
        if (node && node.parentNode) node.parentNode.removeChild(node);
      });
      panel.querySelectorAll('[data-mobile-header-action]').forEach((node) => {
        const group = node.closest('.mobile-nav-group');
        if (group && group.parentNode) group.parentNode.removeChild(group);
        else if (node && node.parentNode) node.parentNode.removeChild(node);
      });

      if (panel.querySelector('.mobile-nav-group[data-mobile-group="settings"]')) return;

      const group = document.createElement('div');
      group.className = 'mobile-nav-group mobile-nav-group-settings';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', 'Display settings');
      group.setAttribute('data-mobile-group', 'settings');
      group.innerHTML = `
        <p class="mobile-nav-group-label">Settings</p>
        <label class="mobile-nav-setting" for="mobile-theme-select">
          <span class="mobile-nav-setting-label">Theme</span>
          <select class="customization-select mobile-nav-setting-select" id="mobile-theme-select" aria-label="Theme preference">
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label class="mobile-nav-setting" for="mobile-text-size-select">
          <span class="mobile-nav-setting-label">Text Size</span>
          <select class="customization-select mobile-nav-setting-select" id="mobile-text-size-select" aria-label="Text size">
            <option value="small">Small</option>
            <option value="default">Default</option>
            <option value="large">Large</option>
          </select>
        </label>`;
      panel.appendChild(group);
    }

    function initMobileNavMenu() {
      const menu = document.getElementById('mobile-nav-menu');
      const toggle = document.getElementById('mobile-nav-toggle');
      const panel = document.getElementById('mobile-nav-panel');
      if (!menu || !toggle || !panel) return;

      ensureMobileToggleIcon(toggle);
      normalizeMobileNavPanelGroups(panel);
      syncCustomizationMenuControls();

      const disclosure = ensureDisclosureMenu({
        menu,
        toggle,
        panel,
        onPanelClick: (event, controller) => {
          const linkTarget = getClosestTarget(event, 'a.mobile-nav-link');
          if (linkTarget) {
            controller.close();
            return true;
          }

          const actionTarget = getClosestTarget(event, '[data-mobile-header-action]');
          if (!actionTarget || !mobileHeaderActionMap) return false;

          const action = String(actionTarget.getAttribute('data-mobile-header-action') || '').trim();
          const targetId = mobileHeaderActionMap[action];
          if (!targetId) return false;

          event.preventDefault();
          event.stopPropagation();
          controller.close();
          closeHeaderPopovers();
          window.requestAnimationFrame(() => {
            const targetToggle = document.getElementById(targetId);
            if (targetToggle) targetToggle.click();
          });
          return true;
        },
      });

      const mobileThemeSelect = document.getElementById('mobile-theme-select');
      const mobileTextSizeSelect = document.getElementById('mobile-text-size-select');
      if (mobileThemeSelect && mobileTextSizeSelect && panel.dataset.mobileSettingsBound !== '1') {
        panel.dataset.mobileSettingsBound = '1';

        mobileThemeSelect.addEventListener('change', () => {
          const preference = themePrefValues.has(mobileThemeSelect.value) ? mobileThemeSelect.value : 'system';
          applyTheme(preference, true);
          syncCustomizationMenuControls();
        });

        mobileTextSizeSelect.addEventListener('change', () => {
          const size = textSizeValues.has(mobileTextSizeSelect.value) ? mobileTextSizeSelect.value : 'default';
          applyTextSize(size, true);
          syncCustomizationMenuControls();
        });
      }

      if (
        disclosure
        && mobileHeaderActionMap
        && !disclosure.mobilePopoverCloseWrapped
      ) {
        const baseOpen = disclosure.open;
        disclosure.open = () => {
          closeHeaderPopovers();
          baseOpen();
        };
        disclosure.mobilePopoverCloseWrapped = true;
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

      const disclosure = ensureDisclosureMenu({
        menu,
        toggle,
        panel,
        closeOnPanelSelector: null,
      });
      if (!disclosure) return;

      const shareUrl = window.location.href;
      const shareTitle = document.title || 'LLVM Research Library';

      emailLink.href = `mailto:?subject=${encodeURIComponent(shareTitle)}&body=${encodeURIComponent(`${shareTitle} - ${shareUrl}`)}`;
      xLink.href = `https://x.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareTitle)}`;
      linkedInLink.href = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;

      if (!disclosure.shareState) {
        disclosure.shareState = {
          defaultLabel: toggle.textContent.trim() || 'Share',
          resetTimer: null,
          shareUrl,
          shareTitle,
        };
      } else {
        disclosure.shareState.shareUrl = shareUrl;
        disclosure.shareState.shareTitle = shareTitle;
      }

      const setButtonState = (label, success = false) => {
        toggle.textContent = label;
        toggle.classList.toggle('is-success', success);
        if (disclosure.shareState.resetTimer) {
          window.clearTimeout(disclosure.shareState.resetTimer);
        }
        disclosure.shareState.resetTimer = window.setTimeout(() => {
          toggle.textContent = disclosure.shareState.defaultLabel;
          toggle.classList.remove('is-success');
        }, 1500);
      };

      const supportsNativeShare = typeof navigator.share === 'function';
      if (nativeShareBtn) nativeShareBtn.hidden = !supportsNativeShare;

      if (menu.dataset.pageShellBound === '1') return;
      menu.dataset.pageShellBound = '1';

      if (nativeShareBtn && supportsNativeShare) {
        nativeShareBtn.addEventListener('click', async (event) => {
          event.preventDefault();
          try {
            await navigator.share({
              title: disclosure.shareState.shareTitle,
              url: disclosure.shareState.shareUrl,
            });
            setButtonState('Shared', true);
          } catch (error) {
            if (error && error.name === 'AbortError') return;
            setButtonState('Share failed', false);
          }
          disclosure.close();
        });
      }

      copyBtn.addEventListener('click', async (event) => {
        event.preventDefault();
        const copied = await copyTextToClipboard(disclosure.shareState.shareUrl);
        setButtonState(copied ? 'Link copied' : 'Copy failed', copied);
        if (copied) disclosure.close();
      });

      [emailLink, xLink, linkedInLink].forEach((link) => {
        link.addEventListener('click', () => {
          disclosure.close();
        });
      });
    }

    return {
      applyTextSize,
      applyTheme,
      copyTextToClipboard,
      getTextSizePreference,
      getThemePreference,
      initCustomizationMenu,
      initMobileNavMenu,
      initShareMenu,
      initTextSize,
      initTheme,
      safeSessionGet,
      safeSessionRemove,
      safeSessionSet,
      safeStorageGet,
      safeStorageRemove,
      safeStorageSet,
    };
  }

  const api = {
    arePersonMiddleVariants,
    buildPeopleIndex,
    buildSearchQueryModel,
    buildSearchSnippet,
    CATEGORY_ORDER,
    compareRankedEntries,
    extractYouTubeId,
    formatMeetingDateUniversal,
    getPaperKeyTopics,
    getTalkKeyTopics,
    highlightSearchText,
    isYouTubeVideoId,
    normalizeAffiliation,
    normalizeAffiliationKey,
    normalizePublication,
    normalizePublicationKey,
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
    composeCrossTypeRelevance,
    rankPaperRecordsByQuery,
    rankTalksByQuery,
    scorePaperRecordByModel,
    scorePaperRecordByQuery,
    scoreMatch,
    createPageShell,
    scoreTalkRecordByModel,
    scoreTalkRecordByQuery,
    sortCategoryEntries,
    tokenizeQuery,
    getPaperPrimaryPublication,
  };

  root.LLVMHubUtils = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);

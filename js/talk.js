/**
 * talk.js — Talk detail page logic for LLVM Research Library
 */

// ============================================================
// Data Loading
// ============================================================

const HubUtils = window.LLVMHubUtils || {};
const PageShell = typeof HubUtils.createPageShell === 'function'
  ? HubUtils.createPageShell()
  : null;

const safeSessionGet = PageShell ? PageShell.safeSessionGet : () => null;
const initTheme = PageShell ? () => PageShell.initTheme() : () => {};
const initTextSize = PageShell ? () => PageShell.initTextSize() : () => {};
const initCustomizationMenu = PageShell ? () => PageShell.initCustomizationMenu() : () => {};
const initMobileNavMenu = PageShell ? () => PageShell.initMobileNavMenu() : () => {};
const initShareMenu = PageShell ? () => PageShell.initShareMenu() : () => {};
const TALK_NAV_CACHE_KEY = 'llvm-hub-nav-talk-record';
const NAV_WINDOW_CACHE_PREFIX = 'llvm-hub-nav-cache:';
const NAV_RECORD_MAX_AGE_MS = 1000 * 60 * 30;

function uniqueNormalizedPaths(paths) {
  return [...new Set((Array.isArray(paths) ? paths : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
}

function normalizeEventPath(raw) {
  const value = String(raw || '').trim().replace(/^\/+/, '');
  if (!value) return '';
  if (value.startsWith('devmtg/events/')) return value;
  if (value.startsWith('events/')) return `devmtg/events/${value.slice('events/'.length)}`;
  return `devmtg/events/${value}`;
}

function buildTalkRecordPathCandidates(talkId) {
  const id = String(talkId || '').trim();
  if (!id) return [];
  const out = [];
  const dayMatch = id.match(/^(\d{4}-\d{2}-\d{2})-/);
  if (dayMatch && dayMatch[1]) out.push(`devmtg/events/${dayMatch[1]}.json`);
  const monthMatch = id.match(/^(\d{4}-\d{2})-/);
  if (monthMatch && monthMatch[1]) out.push(`devmtg/events/${monthMatch[1]}.json`);
  return uniqueNormalizedPaths(out);
}

function resolveWorkerScriptUrl(relativePath) {
  try {
    return new URL(String(relativePath || ''), document.baseURI || window.location.href).toString();
  } catch {
    return '';
  }
}

function normalizeTalks(rawTalks) {
  if (typeof HubUtils.normalizeTalks === 'function') {
    return HubUtils.normalizeTalks(rawTalks);
  }
  return Array.isArray(rawTalks) ? rawTalks : null;
}

async function loadTalkRecordByIdViaWorker(talkId) {
  const id = String(talkId || '').trim();
  if (!id) return null;
  if (typeof Worker !== 'function') {
    return null;
  }

  const baseUrl = new URL('../', window.location.href).toString();
  const workerUrl = resolveWorkerScriptUrl('js/workers/talk-record-worker.js');
  if (!workerUrl) return null;

  try {
    const worker = new Worker(workerUrl);
    return await new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        try { worker.terminate(); } catch {}
        resolve(null);
      }, 45000);

      worker.onmessage = (event) => {
        window.clearTimeout(timeout);
        try { worker.terminate(); } catch {}
        const payload = event && event.data ? event.data : {};
        const normalized = normalizeTalks([payload && payload.talk]);
        resolve(Array.isArray(normalized) && normalized.length ? normalized[0] : null);
      };
      worker.onerror = () => {
        window.clearTimeout(timeout);
        try { worker.terminate(); } catch {}
        resolve(null);
      };
      worker.postMessage({
        id,
        baseUrl,
        candidatePaths: buildTalkRecordPathCandidates(id),
      });
    });
  } catch {
    return null;
  }
}

async function loadTalkRecordByIdDirect(talkId) {
  const id = String(talkId || '').trim();
  if (!id) return { talk: null, loadedAny: false };
  const result = { talk: null, loadedAny: false };
  const fetchJson = async (path) => {
    try {
      const response = await fetch(path, { cache: 'default' });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  };

  const manifest = await fetchJson('devmtg/events/index.json');
  if (manifest && typeof manifest === 'object') result.loadedAny = true;
  const manifestPaths = Array.isArray(manifest && manifest.eventFiles)
    ? manifest.eventFiles.map(normalizeEventPath)
    : (Array.isArray(manifest && manifest.events)
      ? manifest.events.map((entry) => normalizeEventPath(entry && (entry.file || entry.path)))
      : []);

  const candidatePaths = uniqueNormalizedPaths([
    ...buildTalkRecordPathCandidates(id),
    ...manifestPaths,
  ]);

  for (const path of candidatePaths) {
    const bundle = await fetchJson(path);
    if (!bundle || !Array.isArray(bundle.talks)) continue;
    result.loadedAny = true;
    const normalizedTalks = normalizeTalks(bundle.talks) || [];
    const talk = normalizedTalks.find((entry) => String((entry && entry.id) || '').trim() === id);
    if (talk) {
      result.talk = talk;
      return result;
    }
  }

  return result;
}

function readCachedTalkRecord(talkId) {
  const id = String(talkId || '').trim();
  if (!id) return null;

  const fromPayload = (payload) => {
    const payloadId = String(payload && payload.id || '').trim();
    if (payloadId !== id) return null;
    if (String(payload && payload.kind || '').trim().toLowerCase() === 'paper') return null;
    const savedAt = Number(payload && payload.savedAt);
    if (Number.isFinite(savedAt) && savedAt > 0 && (Date.now() - savedAt) > NAV_RECORD_MAX_AGE_MS) {
      return null;
    }
    const normalized = normalizeTalks([payload && payload.talk]);
    const talk = Array.isArray(normalized) && normalized.length ? normalized[0] : null;
    if (!talk) return null;
    if (String(talk.id || '').trim() !== id) return null;
    return talk;
  };

  const nameCache = String(window.name || '');
  if (nameCache.startsWith(NAV_WINDOW_CACHE_PREFIX)) {
    try {
      const payload = JSON.parse(nameCache.slice(NAV_WINDOW_CACHE_PREFIX.length));
      const talk = fromPayload(payload);
      if (talk) return talk;
    } catch {
      // Ignore malformed window.name cache payload.
    }
  }

  const raw = safeSessionGet(TALK_NAV_CACHE_KEY);
  if (!raw) return null;
  try {
    return fromPayload(JSON.parse(raw));
  } catch {
    return null;
  }
}

function cacheTalkNavigationRecord(talk) {
  const id = String(talk && talk.id || '').trim();
  if (!id) return;
  const payload = {
    kind: 'talk',
    id,
    savedAt: Date.now(),
    talk,
  };
  try {
    window.name = `${NAV_WINDOW_CACHE_PREFIX}${JSON.stringify(payload)}`;
  } catch {
    // Ignore window.name write failures.
  }
}

function resolveTalkIdFromHref(href) {
  const raw = String(href || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw, window.location.href);
    return String(parsed.searchParams.get('id') || '').trim();
  } catch {
    return '';
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

function sanitizeExternalUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw, window.location.href);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol === 'http:' || protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    return '';
  }
  return '';
}

function setIssueContext(context) {
  if (typeof window.setLibraryIssueContext !== 'function') return;
  if (!context || typeof context !== 'object') return;
  window.setLibraryIssueContext(context);
}

function setIssueContextForTalk(talk) {
  if (!talk || typeof talk !== 'object') return;
  setIssueContext({
    pageType: 'Talk',
    itemType: 'Talk',
    itemId: String(talk.id || '').trim(),
    itemTitle: String(talk.title || '').trim(),
    pageTitle: `${String(talk.title || '').trim()} — LLVM Research Library`,
    meeting: String(talk.meeting || '').trim(),
    meetingName: String(talk.meetingName || '').trim(),
    slidesUrl: String(talk.slidesUrl || '').trim(),
    videoUrl: String(talk.videoUrl || '').trim(),
    sourceUrl: String(talk.sourceUrl || '').trim(),
  });
}

const CATEGORY_META = {
  'keynote':        'Keynote',
  'technical-talk': 'Technical Talk',
  'tutorial':       'Tutorial',
  'panel':          'Panel',
  'quick-talk':     'Quick Talk',
  'lightning-talk': 'Lightning Talk',
  'student-talk':   'Student Technical Talk',
  'llvm-foundation': 'LLVM Foundation',
  'bof':            'BoF',
  'poster':         'Poster',
  'workshop':       'Workshop',
  'other':          'Other',
};

function categoryLabel(cat) {
  return CATEGORY_META[cat] ?? cat;
}

function formatMeetingDate(value) {
  if (typeof HubUtils.formatMeetingDateUniversal === 'function') {
    return HubUtils.formatMeetingDateUniversal(value);
  }
  return String(value || '').trim();
}

function getTalkKeyTopics(talk, limit = Infinity) {
  if (typeof HubUtils.getTalkKeyTopics === 'function') {
    return HubUtils.getTalkKeyTopics(talk, limit);
  }
  const tags = Array.isArray(talk && talk.tags) ? talk.tags : [];
  return Number.isFinite(limit) ? tags.slice(0, limit) : tags;
}

function truncateText(value, maxLength = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function upsertMetaTag(attrName, attrValue, content) {
  if (!content) return;
  const existing = Array.from(document.head.querySelectorAll(`meta[${attrName}]`))
    .find((meta) => meta.getAttribute(attrName) === attrValue);
  const el = existing || document.createElement('meta');
  if (!existing) {
    el.setAttribute(attrName, attrValue);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertCanonical(url) {
  if (!url) return;
  let link = document.head.querySelector('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', 'canonical');
    document.head.appendChild(link);
  }
  link.setAttribute('href', url);
}

function upsertJsonLd(scriptId, payload) {
  if (!payload) return;
  let script = document.getElementById(scriptId);
  if (!script) {
    script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = scriptId;
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(payload);
}

function meetingSlugToIsoDate(slug) {
  const text = String(slug || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})/);
  if (!match) return '';
  return `${match[1]}-${match[2]}-01`;
}

function updateTalkSeoMetadata(talk) {
  const canonical = new URL(window.location.href);
  canonical.search = '';
  canonical.hash = '';
  canonical.searchParams.set('id', talk.id);
  const canonicalUrl = canonical.toString();
  const description = truncateText(
    talk.abstract || `${talk.title}${talk.meetingName ? ` (${talk.meetingName})` : ''}`,
    180
  );
  const imageUrl = talk.videoId ? `https://img.youtube.com/vi/${talk.videoId}/hqdefault.jpg` : '';
  const talkDate = meetingSlugToIsoDate(talk.meeting);

  upsertCanonical(canonicalUrl);
  upsertMetaTag('name', 'description', description);

  upsertMetaTag('property', 'og:type', talk.videoUrl ? 'video.other' : 'article');
  upsertMetaTag('property', 'og:site_name', "LLVM Research Library");
  upsertMetaTag('property', 'og:title', talk.title);
  upsertMetaTag('property', 'og:description', description);
  upsertMetaTag('property', 'og:url', canonicalUrl);
  if (imageUrl) upsertMetaTag('property', 'og:image', imageUrl);

  upsertMetaTag('name', 'twitter:card', imageUrl ? 'summary_large_image' : 'summary');
  upsertMetaTag('name', 'twitter:title', talk.title);
  upsertMetaTag('name', 'twitter:description', description);
  if (imageUrl) upsertMetaTag('name', 'twitter:image', imageUrl);

  const speakers = (talk.speakers || [])
    .map((speaker) => String((speaker && speaker.name) || '').trim())
    .filter(Boolean);
  const keyTopics = getTalkKeyTopics(talk, 24);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': talk.videoUrl ? 'VideoObject' : 'CreativeWork',
    name: talk.title,
    description,
    url: canonicalUrl,
    uploadDate: talkDate || undefined,
    thumbnailUrl: imageUrl || undefined,
    keywords: keyTopics.join(', ') || undefined,
    author: speakers.map((name) => ({ '@type': 'Person', name })),
    isPartOf: {
      '@type': 'Event',
      name: talk.meetingName || talk.meeting || "LLVM Developers' Meeting",
      location: talk.meetingLocation || undefined,
      startDate: talkDate || undefined,
    },
    mainEntityOfPage: canonicalUrl,
  };
  upsertJsonLd('talk-jsonld', jsonLd);
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
    text: 'Watch Video',
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
      text: 'Watch on YouTube',
      ariaLabel: `Watch on YouTube: ${titleEsc} (opens in new tab)`,
      icon: 'play',
    };
  } catch {
    return fallback;
  }
}

// SVG icons for no-video placeholder (same as app.js)
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

window.thumbnailError = function(img, category) {
  if (!img || !img.parentElement) return;
  const div = document.createElement('div');
  div.className = 'card-thumbnail-placeholder';
  div.innerHTML = placeholderSvgForCategory(category);
  img.parentElement.replaceChild(div, img);
};

document.addEventListener('error', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLImageElement)) return;
  const category = target.getAttribute('data-thumbnail-category');
  if (!category) return;
  window.thumbnailError(target, category);
}, true);

// ============================================================
// Abstract Rendering
// ============================================================

function renderAbstract(abstract) {
  if (!abstract) return '<p><em>No abstract available.</em></p>';

  // Split into paragraphs on double newlines or \n
  const paras = abstract
    .split(/\n{2,}|\r\n\r\n/)
    .map(p => p.trim())
    .filter(Boolean);

  return paras.map(para => {
    // Detect bullet lists (lines starting with - or * or •)
    const lines = para.split(/\n/).map(l => l.trim());
    const isList = lines.length > 1 && lines.every(l => /^[-*•]/.test(l));

    if (isList) {
      const items = lines.map(l => `<li>${escapeHtml(l.replace(/^[-*•]\s*/, ''))}</li>`).join('');
      return `<ul>${items}</ul>`;
    }

    // Check for numbered list
    const isNumbered = lines.length > 1 && lines.every((l, i) => new RegExp(`^${i + 1}[.)]`).test(l));
    if (isNumbered) {
      const items = lines.map(l => `<li>${escapeHtml(l.replace(/^\d+[.)]\s*/, ''))}</li>`).join('');
      return `<ol>${items}</ol>`;
    }

    // Single line with embedded bullet points using * prefix
    if (para.includes('\n* ') || para.includes('\n- ')) {
      const [intro, ...rest] = para.split('\n');
      const introHtml = intro.trim() ? `<p>${escapeHtml(intro.trim())}</p>` : '';
      const items = rest.map(l => `<li>${escapeHtml(l.replace(/^[-*]\s*/, '').trim())}</li>`).join('');
      return `${introHtml}<ul>${items}</ul>`;
    }

    return `<p>${escapeHtml(para.replace(/\n/g, ' '))}</p>`;
  }).join('\n');
}

// ============================================================
// Speaker Rendering
// ============================================================

function githubSvg() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>`;
}

function linkedinSvg() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`;
}

function twitterSvg() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.734-8.838L1.254 2.25H8.08l4.259 5.632 5.905-5.632zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`;
}

function buildSpeakerWorkUrl(name) {
  const params = new URLSearchParams();
  params.set('mode', 'entity');
  params.set('kind', 'speaker');
  params.set('value', String(name || '').trim());
  params.set('from', 'talks');
  return `work.html?${params.toString()}`;
}

function renderSpeakers(speakers) {
  if (!speakers || speakers.length === 0) {
    return '<p style="color: var(--color-text-muted); font-size: var(--font-size-sm);">Speaker information not available.</p>';
  }

  return speakers.map(s => {
    const socialLinks = [];
    const githubHref = sanitizeExternalUrl(s.github);
    const linkedinHref = sanitizeExternalUrl(s.linkedin);
    const twitterHref = sanitizeExternalUrl(s.twitter);
    if (githubHref) socialLinks.push(`<a href="${escapeHtml(githubHref)}" class="speaker-social-link" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(s.name)} on GitHub (opens in new tab)">${githubSvg()}</a>`);
    if (linkedinHref) socialLinks.push(`<a href="${escapeHtml(linkedinHref)}" class="speaker-social-link" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(s.name)} on LinkedIn (opens in new tab)">${linkedinSvg()}</a>`);
    if (twitterHref) socialLinks.push(`<a href="${escapeHtml(twitterHref)}" class="speaker-social-link" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(s.name)} on X (opens in new tab)">${twitterSvg()}</a>`);

    return `
      <div class="speaker-chip">
        <div>
          <a href="${buildSpeakerWorkUrl(s.name)}" class="speaker-name-link" aria-label="View talks and papers by ${escapeHtml(s.name)}">${escapeHtml(s.name)}</a>
          ${s.affiliation ? `<br><span class="speaker-affiliation">${escapeHtml(s.affiliation)}</span>` : ''}
        </div>
        ${socialLinks.length ? `<div class="speaker-social" aria-label="Social links for ${escapeHtml(s.name)}">${socialLinks.join('')}</div>` : ''}
      </div>`;
  }).join('');
}

// ============================================================
// Related Talks
// ============================================================

function getRelatedTalks(talk, allTalks) {
  const MAX_SAME_MEETING = 4;
  const MAX_TOTAL = 6;

  const sameMeeting = allTalks
    .filter(t => t.meeting === talk.meeting && t.id !== talk.id)
    .slice(0, MAX_SAME_MEETING);

  const sameMeetingIds = new Set(sameMeeting.map(t => t.id));

  const sameCategory = allTalks
    .filter(t => t.category === talk.category && t.id !== talk.id && !sameMeetingIds.has(t.id))
    .sort(() => Math.random() - 0.5)
    .slice(0, MAX_TOTAL - sameMeeting.length);

  return [...sameMeeting, ...sameCategory];
}

function renderRelatedCard(talk) {
  const thumbnailUrl = talk.videoId
    ? `https://img.youtube.com/vi/${talk.videoId}/hqdefault.jpg`
    : '';
  const speakerText = talk.speakers?.map(s => s.name).join(', ') || '';
  const badgeCls = `badge badge-${escapeHtml(talk.category || 'other')}`;
  const tags = getTalkKeyTopics(talk, 8);
  const tagsHtml = tags.length
    ? `<div class="card-tags-wrap"><div class="card-tags" aria-label="Key Topics">${tags.slice(0, 4).map((tag) =>
        `<a href="talks/?tag=${encodeURIComponent(tag)}" class="card-tag" aria-label="Browse talks for key topic ${escapeHtml(tag)}">${escapeHtml(tag)}</a>`
      ).join('')}${tags.length > 4 ? `<span class="card-tag card-tag--more" aria-hidden="true">+${tags.length - 4}</span>` : ''}</div></div>`
    : '';

  // Per-name speaker links that navigate to speaker-filtered search
  const speakerLinksHtml = talk.speakers?.length
    ? talk.speakers.map(s =>
        `<a href="${buildSpeakerWorkUrl(s.name)}" class="card-speaker-link" aria-label="View talks and papers by ${escapeHtml(s.name)}">${escapeHtml(s.name)}</a>`
      ).join('<span class="speaker-btn-sep">, </span>')
    : '';

  const relatedLabel = speakerText
    ? `${escapeHtml(talk.title)} by ${escapeHtml(speakerText)}`
    : escapeHtml(talk.title);
  return `
    <article class="talk-card">
      <a href="talks/talk.html?id=${escapeHtml(talk.id)}" class="card-link-wrap" aria-label="${relatedLabel}">
        <div class="card-thumbnail" aria-hidden="true">
          ${thumbnailUrl
            ? `<img src="${escapeHtml(thumbnailUrl)}" alt="" loading="lazy" data-thumbnail-category="${escapeHtml(talk.category || '')}">`
            : `<div class="card-thumbnail-placeholder">${placeholderSvgForTalk(talk)}</div>`}
        </div>
        <div class="card-body">
          <div class="card-meta">
            <span class="${badgeCls}">${escapeHtml(categoryLabel(talk.category || 'other'))}</span>
            <span class="meeting-label">${escapeHtml(talk.meeting || '')}</span>
          </div>
          <p class="card-title">${escapeHtml(talk.title)}</p>
        </div>
      </a>
      ${speakerLinksHtml ? `<p class="card-speakers">${speakerLinksHtml}</p>` : ''}
      ${tagsHtml}
    </article>`;
}

// ============================================================
// Full Detail Render
// ============================================================

function renderTalkDetail(talk, allTalks) {
  const root = document.getElementById('talk-detail-root');
  const badgeCls = `badge badge-${escapeHtml(talk.category || 'other')}`;
  const speakersHtml = renderSpeakers(talk.speakers);

  // Video section
  let videoHtml = '';
  if (talk.videoId) {
    videoHtml = `
      <section class="video-section" aria-label="Video">
        <div class="section-label" aria-hidden="true">Video</div>
        <div class="video-embed">
          <iframe
            src="https://www.youtube.com/embed/${escapeHtml(talk.videoId)}"
            title="${escapeHtml(talk.title)}"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
            loading="lazy"
          ></iframe>
        </div>
      </section>`;
  }

  // Links bar
  const tEsc = escapeHtml(talk.title);
  const videoHref = sanitizeExternalUrl(talk.videoUrl);
  const slidesHref = sanitizeExternalUrl(talk.slidesUrl);
  const githubHref = sanitizeExternalUrl(talk.projectGithub);
  const linkItems = [];
  if (videoHref) {
    const videoMeta = getVideoLinkMeta(videoHref, tEsc);
    const videoIcon = videoMeta.icon === 'download'
      ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 21h16"/></svg>`
      : videoMeta.icon === 'tv'
        ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2" ry="2"/><line x1="8" y1="20" x2="16" y2="20"/><line x1="12" y1="17" x2="12" y2="20"/></svg>`
        : `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    linkItems.push(`
      <a href="${escapeHtml(videoHref)}" class="link-btn" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(videoMeta.ariaLabel)}">
        ${videoIcon}
        ${escapeHtml(videoMeta.text)}
      </a>`);
  }
  if (slidesHref) {
    linkItems.push(`
      <a href="${escapeHtml(slidesHref)}" class="link-btn" target="_blank" rel="noopener noreferrer" aria-label="View slides for ${tEsc} (opens in new tab)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        View Slides
      </a>`);
  }
  if (githubHref) {
    linkItems.push(`
      <a href="${escapeHtml(githubHref)}" class="link-btn" target="_blank" rel="noopener noreferrer" aria-label="Project on GitHub: ${tEsc} (opens in new tab)">
        ${githubSvg()}
        Project on GitHub
      </a>`);
  }
  linkItems.push(`
    <a href="https://github.com/bwatsonllvm/library/issues/new" class="link-btn report-issue-link" id="report-issue-btn" aria-label="Request edit for this talk (opens in new tab)">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="12" y1="7" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      Request Edit
    </a>`);
  const linksBarHtml = linkItems.length ? `
    <div class="links-bar" aria-label="Resources">
      ${linkItems.join('')}
    </div>` : '';

  // Tags
  const tags = getTalkKeyTopics(talk, 20);
  const tagsHtml = tags.length
    ? `<section class="tags-section" aria-label="Key Topics">
        <div class="section-label" aria-hidden="true">Key Topics</div>
        <div class="detail-tags">
          ${tags.map(tag =>
            `<a href="talks/?tag=${encodeURIComponent(tag)}" class="detail-tag" aria-label="Browse talks for key topic ${escapeHtml(tag)}">${escapeHtml(tag)}</a>`
          ).join('')}
        </div>
      </section>`
    : '';

  // Related talks
  const related = getRelatedTalks(talk, allTalks);

  // Meeting info
  const meetingInfoParts = [formatMeetingDate(talk.meetingDate), talk.meetingLocation].filter(Boolean);

  const html = `
    <div class="talk-detail">
      <a href="talks/" class="back-btn" id="back-btn" aria-label="Back">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
        <span aria-hidden="true">All Talks</span>
      </a>

      <div class="talk-header">
        <div class="talk-header-meta">
          <span class="${badgeCls}">${escapeHtml(categoryLabel(talk.category || 'other'))}</span>
          ${meetingInfoParts.length ? `
          <a href="talks/?meeting=${escapeHtml(talk.meeting)}" class="meeting-info-badge" aria-label="Browse talks from ${escapeHtml(meetingInfoParts.join(', '))}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span aria-hidden="true">${escapeHtml(meetingInfoParts.join(' · '))}</span>
          </a>` : ''}
        </div>
        <h1 class="talk-title">${escapeHtml(talk.title)}</h1>
      </div>

      <section class="speakers-section" aria-label="Speakers">
        <div class="section-label" aria-hidden="true">Speakers</div>
        <div class="speakers-list">
          ${speakersHtml}
        </div>
      </section>

      ${videoHtml}

      ${linksBarHtml}

      <section class="abstract-section" aria-label="Abstract">
        <div class="section-label" aria-hidden="true">Abstract</div>
        <div class="abstract-body">
          ${renderAbstract(talk.abstract)}
        </div>
      </section>

      ${tagsHtml}
    </div>

    ${related.length ? `
    <section class="related-section" aria-label="Related talks">
      <h2>More from ${escapeHtml(talk.meetingName || talk.meeting)}</h2>
      <div class="related-grid">
        ${related.map(t => renderRelatedCard(t)).join('')}
      </div>
    </section>` : ''}
  `;

  root.innerHTML = html;
  root.className = '';

  // Wire up back button — restore search state if available
  document.getElementById('back-btn').addEventListener('click', e => {
    const saved = safeSessionGet('llvm-hub-search-state');
    if (saved) {
      // Let the navigation happen; app.js will restore state
      return;
    }
    // Otherwise just go back in history if possible
    if (window.history.length > 1) {
      e.preventDefault();
      window.history.back();
    }
  });

  root.addEventListener('click', (event) => {
    if (!event || event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target && typeof event.target.closest === 'function'
      ? event.target.closest('a.card-link-wrap[href]')
      : null;
    if (!link) return;
    const nextId = resolveTalkIdFromHref(link.getAttribute('href') || '');
    if (!nextId) return;
    const nextTalk = (Array.isArray(allTalks) ? allTalks : [])
      .find((candidate) => String((candidate && candidate.id) || '').trim() === nextId);
    if (nextTalk) cacheTalkNavigationRecord(nextTalk);
  });
}

// ============================================================
// Not Found
// ============================================================

function renderNotFound(id) {
  const root = document.getElementById('talk-detail-root');
  root.innerHTML = `
    <div class="talk-detail">
      <a href="talks/" class="back-btn" aria-label="Back">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
        <span aria-hidden="true">All Talks</span>
      </a>
      <div class="empty-state">
        <div class="empty-state-icon" aria-hidden="true">🔍</div>
        <h2>Talk not found</h2>
        <p>No talk found with ID <code>${escapeHtml(id || '(none)')}</code>.</p>
        <p><a href="talks/">Browse all talks →</a></p>
      </div>
    </div>`;
}

function renderLoadError() {
  const root = document.getElementById('talk-detail-root');
  root.innerHTML = `
    <div class="talk-detail">
      <div class="empty-state" role="alert">
        <div class="empty-state-icon" aria-hidden="true">⚠️</div>
        <h2>Could not load data</h2>
        <p>Ensure <code>devmtg/events/index.json</code> and <code>devmtg/events/*.json</code> are available.</p>
      </div>
    </div>`;
}

// ============================================================
// Init
// ============================================================

async function init() {
  initTheme();
  initTextSize();
  initCustomizationMenu();
  initMobileNavMenu();

  const params = new URLSearchParams(window.location.search);
  const talkId = params.get('id');
  setIssueContext({
    pageType: 'Talk',
    itemType: 'Talk',
    itemId: String(talkId || '').trim(),
  });

  if (!talkId) {
    renderNotFound(null);
    setIssueContext({
      itemTitle: 'Missing talk ID',
      issueTitle: '[Talk] Missing talk ID',
    });
    initShareMenu();
    return;
  }

  const cachedTalk = readCachedTalkRecord(talkId);
  if (cachedTalk) {
    document.title = `${cachedTalk.title} — LLVM Research Library`;
    updateTalkSeoMetadata(cachedTalk);
    renderTalkDetail(cachedTalk, []);
    setIssueContextForTalk(cachedTalk);
    initShareMenu();
    return;
  }

  const workerTalk = await loadTalkRecordByIdViaWorker(talkId);
  if (workerTalk) {
    document.title = `${workerTalk.title} — LLVM Research Library`;
    updateTalkSeoMetadata(workerTalk);
    renderTalkDetail(workerTalk, []);
    setIssueContextForTalk(workerTalk);
    initShareMenu();
    return;
  }

  const directResult = await loadTalkRecordByIdDirect(talkId);
  if (!directResult || !directResult.talk) {
    if (!directResult || !directResult.loadedAny) {
      renderLoadError();
    } else {
      renderNotFound(talkId);
      setIssueContext({
        itemTitle: `Unknown talk ID: ${talkId}`,
        issueTitle: `[Talk] Unknown talk ID: ${talkId}`,
      });
    }
    initShareMenu();
    return;
  }
  const talk = directResult.talk;

  // Update page title
  document.title = `${talk.title} — LLVM Research Library`;
  updateTalkSeoMetadata(talk);

  renderTalkDetail(talk, []);
  setIssueContextForTalk(talk);
  initShareMenu();
}

init();

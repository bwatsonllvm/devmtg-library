/**
 * events-data.js — Load canonical meeting/talk data from devmtg/events/*.json files.
 */

(function () {
  let inMemoryCache = null;
  let inMemoryVersion = '';
  let manifestCache = null;
  let manifestLoadPromise = null;
  const bundleCache = new Map();
  const bundleLoadPromises = new Map();

  const MANIFEST_JSON_PATH = 'devmtg/events/index.json';
  const EVENTS_PREFIX = 'devmtg/events/';

  function normalizeManifestJson(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error(`${MANIFEST_JSON_PATH}: expected JSON object`);
    }

    const dataVersion = String(payload.dataVersion || '').trim();
    if (!dataVersion) {
      throw new Error(`${MANIFEST_JSON_PATH}: missing "dataVersion"`);
    }

    const files = Array.isArray(payload.eventFiles)
      ? payload.eventFiles
      : (Array.isArray(payload.events) ? payload.events.map((event) => event.file || event.path || '') : []);

    if (!files.length) {
      throw new Error(`${MANIFEST_JSON_PATH}: missing non-empty "eventFiles"`);
    }

    const eventRefs = files
      .map((file) => String(file || '').trim())
      .filter(Boolean)
      .map((file) => {
        const normalized = file.replace(/^\/+/, '');
        if (normalized.startsWith(EVENTS_PREFIX)) return normalized;
        if (normalized.startsWith('events/')) return `${EVENTS_PREFIX}${normalized.slice('events/'.length)}`;
        return `${EVENTS_PREFIX}${normalized}`;
      });

    for (const ref of eventRefs) {
      if (!ref.toLowerCase().endsWith('.json')) {
        throw new Error(`${MANIFEST_JSON_PATH}: eventFiles must reference .json files (${ref})`);
      }
    }

    return { dataVersion, eventRefs };
  }

  function normalizeEventBundle(payload, sourcePath) {
    if (!payload || typeof payload !== 'object') {
      throw new Error(`${sourcePath}: expected JSON object`);
    }
    if (!Array.isArray(payload.talks)) {
      throw new Error(`${sourcePath}: missing "talks" array`);
    }

    return {
      meeting: payload.meeting || null,
      talks: payload.talks,
    };
  }

  function resetBundleCaches() {
    bundleCache.clear();
    bundleLoadPromises.clear();
  }

  async function fetchJson(path) {
    const resp = await fetch(path, { cache: 'default' });
    if (!resp.ok) {
      throw new Error(`${path}: HTTP ${resp.status}`);
    }
    try {
      return await resp.json();
    } catch (err) {
      throw new Error(`${path}: invalid JSON (${err.message})`);
    }
  }

  async function loadManifest() {
    if (manifestCache) return manifestCache;
    if (manifestLoadPromise) return manifestLoadPromise;

    manifestLoadPromise = (async () => {
      const manifestPayload = await fetchJson(MANIFEST_JSON_PATH);
      const manifest = normalizeManifestJson(manifestPayload);
      if (inMemoryVersion && inMemoryVersion !== manifest.dataVersion) {
        inMemoryCache = null;
        inMemoryVersion = '';
        resetBundleCaches();
      }
      manifestCache = manifest;
      return manifest;
    })();

    try {
      return await manifestLoadPromise;
    } finally {
      manifestLoadPromise = null;
    }
  }

  async function loadEventBundle(path) {
    const cacheKey = String(path || '').trim();
    if (!cacheKey) return null;
    if (bundleCache.has(cacheKey)) return bundleCache.get(cacheKey);
    if (bundleLoadPromises.has(cacheKey)) return bundleLoadPromises.get(cacheKey);

    const loadPromise = (async () => {
      const payload = await fetchJson(cacheKey);
      const bundle = normalizeEventBundle(payload, cacheKey);
      bundleCache.set(cacheKey, bundle);
      return bundle;
    })();

    bundleLoadPromises.set(cacheKey, loadPromise);
    try {
      return await loadPromise;
    } finally {
      bundleLoadPromises.delete(cacheKey);
    }
  }

  function normalizeTalkId(value) {
    return String(value || '').trim();
  }

  function findTalkById(talks, talkId) {
    const target = normalizeTalkId(talkId);
    if (!target || !Array.isArray(talks)) return null;
    for (const talk of talks) {
      if (!talk || typeof talk !== 'object') continue;
      if (normalizeTalkId(talk.id) === target) return talk;
    }
    return null;
  }

  function resolveEventRefByTalkId(talkId, eventRefs) {
    const id = normalizeTalkId(talkId);
    if (!id) return '';
    const match = id.match(/^(\d{4}-\d{2})-\d+$/);
    if (!match) return '';
    const candidate = `${EVENTS_PREFIX}${match[1]}.json`;
    return Array.isArray(eventRefs) && eventRefs.includes(candidate) ? candidate : '';
  }

  async function loadEventData() {
    const manifest = await loadManifest();
    if (inMemoryCache && inMemoryVersion === manifest.dataVersion) {
      return inMemoryCache;
    }

    const bundles = await Promise.all(
      manifest.eventRefs.map(async (path) => {
        const bundle = await loadEventBundle(path);
        if (bundle) return bundle;
        return { meeting: null, talks: [] };
      })
    );

    const meetings = [];
    const talks = [];

    for (const bundle of bundles) {
      if (bundle.meeting) meetings.push(bundle.meeting);
      talks.push(...bundle.talks);
    }

    inMemoryCache = { talks, meetings };
    inMemoryVersion = manifest.dataVersion;
    return inMemoryCache;
  }

  async function loadTalkRecordById(talkId) {
    const targetId = normalizeTalkId(talkId);
    if (!targetId) return null;

    const manifest = await loadManifest();
    if (inMemoryCache && inMemoryVersion === manifest.dataVersion) {
      const cachedTalk = findTalkById(inMemoryCache.talks, targetId);
      if (cachedTalk) {
        return {
          talk: cachedTalk,
          talks: inMemoryCache.talks,
          meeting: null,
          dataVersion: manifest.dataVersion,
        };
      }
    }

    const eventRefs = Array.isArray(manifest.eventRefs) ? manifest.eventRefs : [];
    const prioritizedRef = resolveEventRefByTalkId(targetId, eventRefs);
    const orderedRefs = prioritizedRef
      ? [prioritizedRef, ...eventRefs.filter((ref) => ref !== prioritizedRef)]
      : eventRefs;

    for (const ref of orderedRefs) {
      const bundle = await loadEventBundle(ref);
      if (!bundle) continue;
      const talk = findTalkById(bundle.talks, targetId);
      if (talk) {
        return {
          talk,
          talks: bundle.talks,
          meeting: bundle.meeting || null,
          dataVersion: manifest.dataVersion,
        };
      }
    }

    return null;
  }

  window.loadEventData = loadEventData;
  window.loadTalkRecordById = loadTalkRecordById;
})();

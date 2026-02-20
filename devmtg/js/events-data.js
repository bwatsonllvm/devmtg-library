/**
 * events-data.js — Load canonical meeting/talk data from events/*.json files.
 */

(function () {
  let inMemoryCache = null;

  const MANIFEST_JSON_PATH = 'events/index.json';
  const CACHE_PREFIX = 'llvm-hub-event-data:v2:';

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
      .map((file) => file.startsWith('events/') ? file : `events/${file}`);

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

  async function fetchJson(path) {
    const resp = await fetch(path, { cache: 'no-store' });
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
    const manifestPayload = await fetchJson(MANIFEST_JSON_PATH);
    return normalizeManifestJson(manifestPayload);
  }

  function getStorage(kind) {
    try {
      return window[kind] || null;
    } catch {
      return null;
    }
  }

  function getCacheKey(dataVersion) {
    return `${CACHE_PREFIX}${dataVersion}`;
  }

  function isValidDataPayload(payload) {
    return payload &&
      typeof payload === 'object' &&
      Array.isArray(payload.talks) &&
      Array.isArray(payload.meetings);
  }

  function loadCachedPayload(cacheKey) {
    const storages = [getStorage('sessionStorage'), getStorage('localStorage')].filter(Boolean);
    for (const storage of storages) {
      try {
        const raw = storage.getItem(cacheKey);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (isValidDataPayload(parsed)) return parsed;
      } catch {
        // Ignore malformed cache and continue.
      }
    }
    return null;
  }

  function saveCachedPayload(cacheKey, payload) {
    const storages = [getStorage('sessionStorage'), getStorage('localStorage')].filter(Boolean);
    for (const storage of storages) {
      try {
        storage.setItem(cacheKey, JSON.stringify(payload));
      } catch {
        // Ignore storage quota/security errors.
      }
    }
  }

  function pruneStaleCaches(activeCacheKey) {
    const storages = [getStorage('sessionStorage'), getStorage('localStorage')].filter(Boolean);
    for (const storage of storages) {
      try {
        for (let i = storage.length - 1; i >= 0; i -= 1) {
          const key = storage.key(i);
          if (!key || !key.startsWith(CACHE_PREFIX) || key === activeCacheKey) continue;
          storage.removeItem(key);
        }
      } catch {
        // Ignore storage errors.
      }
    }
  }

  async function loadEventData() {
    if (inMemoryCache) return inMemoryCache;

    const manifest = await loadManifest();
    const cacheKey = getCacheKey(manifest.dataVersion);
    const cachedPayload = loadCachedPayload(cacheKey);
    if (cachedPayload) {
      inMemoryCache = cachedPayload;
      return inMemoryCache;
    }

    const bundles = await Promise.all(
      manifest.eventRefs.map(async (path) => {
        const payload = await fetchJson(path);
        return normalizeEventBundle(payload, path);
      })
    );

    const meetings = [];
    const talks = [];

    for (const bundle of bundles) {
      if (bundle.meeting) meetings.push(bundle.meeting);
      talks.push(...bundle.talks);
    }

    inMemoryCache = { talks, meetings };
    saveCachedPayload(cacheKey, inMemoryCache);
    pruneStaleCaches(cacheKey);
    return inMemoryCache;
  }

  window.loadEventData = loadEventData;
})();

/**
 * papers-data.js - Load canonical paper data from papers/*.json files.
 */

(function () {
  let inMemoryCache = null;

  const MANIFEST_JSON_CANDIDATES = ['../papers/index.json', 'papers/index.json', './papers/index.json'];
  const CACHE_PREFIX = 'llvm-hub-paper-data:v1:';

  function uniquePaths(paths) {
    return [...new Set(paths.map((p) => String(p || '').trim()).filter(Boolean))];
  }

  function normalizeManifestJson(payload, manifestRef) {
    const manifestLabel = String(manifestRef || 'papers/index.json');
    if (!payload || typeof payload !== 'object') {
      throw new Error(`${manifestLabel}: expected JSON object`);
    }

    const dataVersion = String(payload.dataVersion || '').trim();
    if (!dataVersion) {
      throw new Error(`${manifestLabel}: missing "dataVersion"`);
    }

    const files = Array.isArray(payload.paperFiles)
      ? payload.paperFiles
      : (Array.isArray(payload.files) ? payload.files : []);

    if (!files.length) {
      throw new Error(`${manifestLabel}: missing non-empty "paperFiles"`);
    }

    const manifestUrl = new URL(manifestLabel, window.location.href);
    const paperRefs = files
      .map((file) => String(file || '').trim())
      .filter(Boolean)
      .map((file) => {
        let normalized = file;
        if (normalized.startsWith('../papers/')) normalized = normalized.slice('../papers/'.length);
        else if (normalized.startsWith('papers/')) normalized = normalized.slice('papers/'.length);

        return new URL(normalized, manifestUrl).toString();
      });

    for (const ref of paperRefs) {
      if (!new URL(ref, window.location.href).pathname.toLowerCase().endsWith('.json')) {
        throw new Error(`${manifestLabel}: paperFiles must reference .json files (${ref})`);
      }
    }

    return { dataVersion, paperRefs, manifestRef: manifestLabel };
  }

  function normalizePaperBundle(payload, sourcePath) {
    if (!payload || typeof payload !== 'object') {
      throw new Error(`${sourcePath}: expected JSON object`);
    }
    if (!Array.isArray(payload.papers)) {
      throw new Error(`${sourcePath}: missing "papers" array`);
    }

    return {
      source: payload.source || null,
      papers: payload.papers,
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
    const candidates = uniquePaths(MANIFEST_JSON_CANDIDATES);
    const failures = [];

    for (const manifestRef of candidates) {
      try {
        const manifestPayload = await fetchJson(manifestRef);
        return normalizeManifestJson(manifestPayload, manifestRef);
      } catch (err) {
        failures.push(String(err && err.message ? err.message : err));
      }
    }

    throw new Error(`Could not load papers manifest from ${candidates.join(', ')} (${failures.join(' | ')})`);
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
      Array.isArray(payload.papers) &&
      Array.isArray(payload.sources);
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

  async function loadPaperData() {
    if (inMemoryCache) return inMemoryCache;

    const manifest = await loadManifest();
    const cacheKey = getCacheKey(manifest.dataVersion);
    const cachedPayload = loadCachedPayload(cacheKey);
    if (cachedPayload) {
      inMemoryCache = cachedPayload;
      return inMemoryCache;
    }

    const bundles = await Promise.all(
      manifest.paperRefs.map(async (path) => {
        const payload = await fetchJson(path);
        return normalizePaperBundle(payload, path);
      })
    );

    const sources = [];
    const papers = [];

    for (const bundle of bundles) {
      if (bundle.source) sources.push(bundle.source);
      papers.push(...bundle.papers);
    }

    inMemoryCache = { papers, sources };
    saveCachedPayload(cacheKey, inMemoryCache);
    pruneStaleCaches(cacheKey);
    return inMemoryCache;
  }

  window.loadPaperData = loadPaperData;
})();

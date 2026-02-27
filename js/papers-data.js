/**
 * papers-data.js - Load canonical paper data from papers/*.json files.
 */

(function () {
  let inMemoryCache = null;
  let inMemoryVersion = '';
  let manifestCache = null;
  let manifestLoadPromise = null;
  const bundleCache = new Map();
  const bundleLoadPromises = new Map();

  const MANIFEST_JSON_CANDIDATES = ['../papers/index.json', 'papers/index.json', './papers/index.json'];

  function uniquePaths(paths) {
    return [...new Set(paths.map((p) => String(p || '').trim()).filter(Boolean))];
  }

  function resolveUrl(ref, baseRef) {
    const rawRef = String(ref || '').trim();
    if (!rawRef) return '';
    try {
      return new URL(rawRef, baseRef || document.baseURI || window.location.href).toString();
    } catch {
      return rawRef;
    }
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

    const manifestUrl = new URL(manifestLabel, document.baseURI || window.location.href);
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

  async function fetchJsonWithMeta(path) {
    const resp = await fetch(path, { cache: 'default' });
    if (!resp.ok) {
      throw new Error(`${path}: HTTP ${resp.status}`);
    }
    try {
      return {
        payload: await resp.json(),
        url: String(resp.url || path),
      };
    } catch (err) {
      throw new Error(`${path}: invalid JSON (${err.message})`);
    }
  }

  async function loadManifest() {
    if (manifestCache) return manifestCache;
    if (manifestLoadPromise) return manifestLoadPromise;

    const candidates = uniquePaths(MANIFEST_JSON_CANDIDATES);
    manifestLoadPromise = (async () => {
      const failures = [];
      const baseRef = document.baseURI || window.location.href;

      for (const manifestRef of candidates) {
        try {
          const manifestUrl = resolveUrl(manifestRef, baseRef);
          const { payload, url } = await fetchJsonWithMeta(manifestUrl || manifestRef);
          const normalized = normalizeManifestJson(payload, url || manifestUrl || manifestRef);
          if (inMemoryVersion && inMemoryVersion !== normalized.dataVersion) {
            inMemoryCache = null;
            inMemoryVersion = '';
            resetBundleCaches();
          }
          manifestCache = normalized;
          return normalized;
        } catch (err) {
          failures.push(String(err && err.message ? err.message : err));
        }
      }

      throw new Error(`Could not load papers manifest from ${candidates.join(', ')} (${failures.join(' | ')})`);
    })();

    try {
      return await manifestLoadPromise;
    } finally {
      manifestLoadPromise = null;
    }
  }

  async function loadPaperBundle(path) {
    const cacheKey = String(path || '').trim();
    if (!cacheKey) return null;
    if (bundleCache.has(cacheKey)) return bundleCache.get(cacheKey);
    if (bundleLoadPromises.has(cacheKey)) return bundleLoadPromises.get(cacheKey);

    const loadPromise = (async () => {
      const payload = await fetchJson(cacheKey);
      const bundle = normalizePaperBundle(payload, cacheKey);
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

  function scorePaperRefForId(path, paperId) {
    const ref = String(path || '').toLowerCase();
    const id = String(paperId || '').trim().toLowerCase();
    if (!id) return 0;
    if ((id.startsWith('manual-') || id.startsWith('doi-')) && ref.includes('manual-added')) return 200;
    if (id.startsWith('blog-') && ref.includes('blog')) return 180;
    if (id.startsWith('pubs-') && ref.includes('pubs')) return 180;
    if (id.startsWith('openalex-') && ref.includes('openalex')) return 180;
    if (ref.includes('combined-all-papers-deduped')) return 140;
    if (ref.includes('combined')) return 120;
    if (ref.includes('manual-added')) return 80;
    return 0;
  }

  function orderPaperRefsForId(paperRefs, paperId) {
    const refs = Array.isArray(paperRefs) ? [...paperRefs] : [];
    refs.sort((a, b) => {
      const scoreDiff = scorePaperRefForId(b, paperId) - scorePaperRefForId(a, paperId);
      if (scoreDiff !== 0) return scoreDiff;
      return String(a).localeCompare(String(b));
    });
    return refs;
  }

  function findPaperById(papers, paperId) {
    if (!Array.isArray(papers)) return null;
    const targetId = String(paperId || '').trim();
    if (!targetId) return null;
    for (const candidate of papers) {
      if (!candidate || typeof candidate !== 'object') continue;
      if (String(candidate.id || '').trim() === targetId) return candidate;
    }
    return null;
  }

  async function loadPaperData() {
    const manifest = await loadManifest();
    if (inMemoryCache && inMemoryVersion === manifest.dataVersion) {
      return inMemoryCache;
    }

    const bundles = await Promise.all(
      manifest.paperRefs.map(async (path) => {
        const bundle = await loadPaperBundle(path);
        if (bundle) return bundle;
        return { source: null, papers: [] };
      })
    );

    const sources = [];
    const papers = [];

    for (const bundle of bundles) {
      if (bundle.source) sources.push(bundle.source);
      papers.push(...bundle.papers);
    }

    inMemoryCache = { papers, sources };
    inMemoryVersion = manifest.dataVersion;
    return inMemoryCache;
  }

  async function loadPaperRecordById(paperId) {
    const targetId = String(paperId || '').trim();
    if (!targetId) return null;

    const manifest = await loadManifest();
    if (inMemoryCache && inMemoryVersion === manifest.dataVersion) {
      const cachedPaper = findPaperById(inMemoryCache.papers, targetId);
      if (cachedPaper) {
        return {
          paper: cachedPaper,
          papers: inMemoryCache.papers,
          source: null,
          dataVersion: manifest.dataVersion,
        };
      }
    }

    const refs = orderPaperRefsForId(manifest.paperRefs, targetId);
    for (const ref of refs) {
      const bundle = await loadPaperBundle(ref);
      if (!bundle) continue;
      const paper = findPaperById(bundle.papers, targetId);
      if (paper) {
        return {
          paper,
          papers: bundle.papers,
          source: bundle.source || null,
          dataVersion: manifest.dataVersion,
        };
      }
    }

    return null;
  }

  window.loadPaperData = loadPaperData;
  window.loadPaperRecordById = loadPaperRecordById;
})();

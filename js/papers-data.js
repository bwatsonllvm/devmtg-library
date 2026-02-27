/**
 * papers-data.js - canonical paper data loader with bundle + by-id access.
 */

(function () {
  const MANIFEST_JSON_CANDIDATES = ['../papers/index.json', 'papers/index.json', './papers/index.json'];

  let manifestCache = null;
  let manifestLoadPromise = null;
  let fullDataCache = null;
  let fullDataVersion = '';

  const bundleCache = new Map();
  const bundleLoadPromises = new Map();

  function uniquePaths(paths) {
    return [...new Set((Array.isArray(paths) ? paths : []).map((p) => String(p || '').trim()).filter(Boolean))];
  }

  function resolveUrl(ref, baseRef) {
    const raw = String(ref || '').trim();
    if (!raw) return '';
    try {
      return new URL(raw, baseRef || document.baseURI || window.location.href).toString();
    } catch {
      return raw;
    }
  }

  function normalizeManifest(payload, manifestRef) {
    const label = String(manifestRef || 'papers/index.json');
    if (!payload || typeof payload !== 'object') {
      throw new Error(`${label}: expected JSON object`);
    }

    const dataVersion = String(payload.dataVersion || '').trim();
    if (!dataVersion) {
      throw new Error(`${label}: missing \"dataVersion\"`);
    }

    const files = Array.isArray(payload.paperFiles)
      ? payload.paperFiles
      : (Array.isArray(payload.files) ? payload.files : []);
    if (!files.length) {
      throw new Error(`${label}: missing non-empty \"paperFiles\"`);
    }

    const manifestUrl = new URL(label, document.baseURI || window.location.href);
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
        throw new Error(`${label}: paperFiles must reference .json files (${ref})`);
      }
    }

    return { dataVersion, paperRefs };
  }

  function normalizePaperBundle(payload, sourcePath) {
    if (!payload || typeof payload !== 'object') {
      throw new Error(`${sourcePath}: expected JSON object`);
    }
    if (!Array.isArray(payload.papers)) {
      throw new Error(`${sourcePath}: missing \"papers\" array`);
    }
    return {
      source: payload.source || null,
      papers: payload.papers,
    };
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
      return { payload: await resp.json(), url: String(resp.url || path) };
    } catch (err) {
      throw new Error(`${path}: invalid JSON (${err.message})`);
    }
  }

  function resetCachesForVersionChange() {
    fullDataCache = null;
    fullDataVersion = '';
    bundleCache.clear();
    bundleLoadPromises.clear();
  }

  async function loadManifest() {
    if (manifestCache) return manifestCache;
    if (manifestLoadPromise) return manifestLoadPromise;

    manifestLoadPromise = (async () => {
      const candidates = uniquePaths(MANIFEST_JSON_CANDIDATES);
      const failures = [];
      const baseRef = document.baseURI || window.location.href;

      for (const manifestRef of candidates) {
        try {
          const manifestUrl = resolveUrl(manifestRef, baseRef);
          const { payload, url } = await fetchJsonWithMeta(manifestUrl || manifestRef);
          const manifest = normalizeManifest(payload, url || manifestUrl || manifestRef);
          if (fullDataVersion && fullDataVersion !== manifest.dataVersion) {
            resetCachesForVersionChange();
          }
          manifestCache = manifest;
          return manifest;
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
    const key = String(path || '').trim();
    if (!key) return null;
    if (bundleCache.has(key)) return bundleCache.get(key);
    if (bundleLoadPromises.has(key)) return bundleLoadPromises.get(key);

    const promise = (async () => {
      const payload = await fetchJson(key);
      const bundle = normalizePaperBundle(payload, key);
      bundleCache.set(key, bundle);
      return bundle;
    })();

    bundleLoadPromises.set(key, promise);
    try {
      return await promise;
    } finally {
      bundleLoadPromises.delete(key);
    }
  }

  function findPaperById(papers, paperId) {
    const target = String(paperId || '').trim();
    if (!target || !Array.isArray(papers)) return null;
    for (const paper of papers) {
      if (!paper || typeof paper !== 'object') continue;
      if (String(paper.id || '').trim() === target) return paper;
    }
    return null;
  }

  function scoreRefForPaperId(path, paperId) {
    const ref = String(path || '').toLowerCase();
    const id = String(paperId || '').trim().toLowerCase();
    if (!id) return 0;
    if (id.startsWith('blog-') && ref.includes('blog')) return 300;
    if ((id.startsWith('manual-') || id.startsWith('doi-')) && ref.includes('manual')) return 280;
    if (id.startsWith('pubs-') && ref.includes('pubs')) return 260;
    if (id.startsWith('openalex-') && ref.includes('openalex')) return 240;
    if (ref.includes('combined-all-papers-deduped')) return 220;
    if (ref.includes('combined')) return 200;
    return 0;
  }

  function orderRefsForPaperId(paperRefs, paperId) {
    const refs = Array.isArray(paperRefs) ? [...paperRefs] : [];
    refs.sort((a, b) => {
      const scoreDiff = scoreRefForPaperId(b, paperId) - scoreRefForPaperId(a, paperId);
      if (scoreDiff !== 0) return scoreDiff;
      return String(a).localeCompare(String(b));
    });
    return refs;
  }

  async function loadPaperData() {
    const manifest = await loadManifest();
    if (fullDataCache && fullDataVersion === manifest.dataVersion) {
      return fullDataCache;
    }

    const bundles = await Promise.all(
      manifest.paperRefs.map(async (ref) => {
        const bundle = await loadPaperBundle(ref);
        return bundle || { source: null, papers: [] };
      })
    );

    const papers = [];
    const sources = [];
    for (const bundle of bundles) {
      papers.push(...(Array.isArray(bundle.papers) ? bundle.papers : []));
      if (bundle.source) sources.push(bundle.source);
    }

    fullDataCache = { papers, sources };
    fullDataVersion = manifest.dataVersion;
    return fullDataCache;
  }

  async function loadPaperRecordById(paperId) {
    const target = String(paperId || '').trim();
    if (!target) return null;

    const manifest = await loadManifest();

    if (fullDataCache && fullDataVersion === manifest.dataVersion) {
      const cached = findPaperById(fullDataCache.papers, target);
      if (cached) {
        return {
          paper: cached,
          papers: fullDataCache.papers,
          source: null,
          dataVersion: manifest.dataVersion,
        };
      }
    }

    const orderedRefs = orderRefsForPaperId(manifest.paperRefs, target);
    for (const ref of orderedRefs) {
      const bundle = await loadPaperBundle(ref);
      if (!bundle) continue;
      const match = findPaperById(bundle.papers, target);
      if (match) {
        return {
          paper: match,
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

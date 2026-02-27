/**
 * papers-data.js - Load canonical paper data from papers/*.json files.
 */

(function () {
  let inMemoryCache = null;
  let inMemoryVersion = '';

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

  async function fetchJsonWithMeta(path) {
    const resp = await fetch(path, { cache: 'no-store' });
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
    const candidates = uniquePaths(MANIFEST_JSON_CANDIDATES);
    const failures = [];
    const baseRef = document.baseURI || window.location.href;

    for (const manifestRef of candidates) {
      try {
        const manifestUrl = resolveUrl(manifestRef, baseRef);
        const { payload, url } = await fetchJsonWithMeta(manifestUrl || manifestRef);
        return normalizeManifestJson(payload, url || manifestUrl || manifestRef);
      } catch (err) {
        failures.push(String(err && err.message ? err.message : err));
      }
    }

    throw new Error(`Could not load papers manifest from ${candidates.join(', ')} (${failures.join(' | ')})`);
  }

  async function loadPaperData() {
    const manifest = await loadManifest();
    if (inMemoryCache && inMemoryVersion === manifest.dataVersion) {
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
    inMemoryVersion = manifest.dataVersion;
    return inMemoryCache;
  }

  window.loadPaperData = loadPaperData;
})();

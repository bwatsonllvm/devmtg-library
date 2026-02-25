/**
 * docs-wrapper.js — Embedded upstream docs wrapper for a single source.
 */

(function () {
  const DOCS_SOURCES_CATALOG_SRC = '../sources.json?v=20260225-01';
  const DEFAULT_DOCS_SOURCES = {
    'llvm-core': {
      id: 'llvm-core',
      name: 'LLVM Core',
      localPath: 'docs/llvm-core/',
      docsUrl: 'https://llvm.org/docs/',
      searchUrlTemplate: 'https://llvm.org/docs/search.html?q={query}',
    },
    clang: {
      id: 'clang',
      name: 'Clang',
      localPath: 'docs/clang/',
      docsUrl: 'https://clang.llvm.org/docs/',
      searchUrlTemplate: 'https://clang.llvm.org/docs/search.html?q={query}',
    },
    lldb: {
      id: 'lldb',
      name: 'LLDB',
      localPath: 'docs/lldb/',
      docsUrl: 'https://lldb.llvm.org/',
      searchUrlTemplate: 'https://lldb.llvm.org/search.html?q={query}',
    },
  };

  function normalizeText(value, maxLength = 320) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
  }

  function sanitizeExternalUrl(value) {
    const raw = normalizeText(value, 420);
    if (!raw) return '';
    try {
      const parsed = new URL(raw, window.location.href);
      const protocol = String(parsed.protocol || '').toLowerCase();
      if (protocol === 'http:' || protocol === 'https:') return parsed.toString();
    } catch {
      return '';
    }
    return '';
  }

  function normalizeSource(raw, fallbackId) {
    if (!raw || typeof raw !== 'object') return null;
    const id = normalizeText(raw.id || fallbackId, 80)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '') || fallbackId;
    const name = normalizeText(raw.name, 120) || fallbackId;
    const docsUrl = sanitizeExternalUrl(raw.docsUrl);
    const searchUrlTemplate = normalizeText(raw.searchUrlTemplate, 420);
    if (!docsUrl) return null;
    return {
      id,
      name,
      docsUrl,
      searchUrlTemplate,
    };
  }

  function resolveSearchUrl(source, query) {
    const trimmed = normalizeText(query, 320);
    const fallback = sanitizeExternalUrl(source && source.docsUrl);
    if (!trimmed) return fallback;

    const template = normalizeText(source && source.searchUrlTemplate, 420);
    if (!template) {
      try {
        const url = new URL(fallback || 'https://llvm.org/docs/');
        url.searchParams.set('q', trimmed);
        return url.toString();
      } catch {
        return fallback;
      }
    }

    if (template.includes('{query}')) {
      return template.replace(/\{query\}/g, encodeURIComponent(trimmed));
    }

    try {
      const url = new URL(template);
      if (!url.searchParams.has('q')) url.searchParams.set('q', trimmed);
      return url.toString();
    } catch {
      return template;
    }
  }

  async function loadSourceById(sourceId) {
    const fallback = DEFAULT_DOCS_SOURCES[sourceId] || DEFAULT_DOCS_SOURCES['llvm-core'];
    let fromCatalog = null;

    try {
      const response = await window.fetch(DOCS_SOURCES_CATALOG_SRC, { cache: 'no-store' });
      if (response.ok) {
        const payload = await response.json();
        const list = Array.isArray(payload && payload.sources) ? payload.sources : [];
        const match = list.find((item) => normalizeText(item && item.id, 80).toLowerCase() === sourceId);
        if (match) fromCatalog = match;
      }
    } catch {
      // fallback below
    }

    return normalizeSource(fromCatalog || fallback, sourceId) || normalizeSource(fallback, sourceId) || null;
  }

  function getQuery() {
    const params = new URLSearchParams(window.location.search);
    return normalizeText(params.get('q') || '', 320);
  }

  function updateLocationQuery(query) {
    const url = new URL(window.location.href);
    if (query) url.searchParams.set('q', query);
    else url.searchParams.delete('q');
    window.history.replaceState({}, '', url.toString());
  }

  async function init() {
    const root = document.body;
    if (!root) return;

    const sourceId = normalizeText(root.getAttribute('data-docs-source-id') || 'llvm-core', 80).toLowerCase();
    const source = await loadSourceById(sourceId);
    if (!source) return;

    const titleEl = document.getElementById('docs-wrapper-title');
    const subtitleEl = document.getElementById('docs-wrapper-subtitle');
    const frameEl = document.getElementById('docs-wrapper-frame');
    const inputEl = document.getElementById('docs-wrapper-query');
    const formEl = document.getElementById('docs-wrapper-form');
    const sourceLink = document.getElementById('docs-wrapper-source-link');

    if (titleEl) titleEl.textContent = `${source.name} Documentation`;
    if (subtitleEl) subtitleEl.textContent = `Wrapped upstream docs for ${source.name}.`;

    const applyQuery = (query) => {
      const destination = resolveSearchUrl(source, query);
      if (!destination) return;
      if (inputEl) inputEl.value = query;
      if (frameEl) frameEl.src = destination;
      if (sourceLink) sourceLink.href = destination;
      updateLocationQuery(query);
    };

    const initialQuery = getQuery();
    applyQuery(initialQuery);

    if (formEl && inputEl) {
      formEl.addEventListener('submit', (event) => {
        event.preventDefault();
        applyQuery(normalizeText(inputEl.value, 320));
      });
    }
  }

  init();
})();

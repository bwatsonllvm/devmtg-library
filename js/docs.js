/**
 * docs.js — Upstream docs hub interactions (source catalog + query routing).
 */

(function () {
  const HubUtils = window.LLVMHubUtils || {};
  const PageShell = typeof HubUtils.createPageShell === 'function'
    ? HubUtils.createPageShell()
    : null;

  const initTheme = PageShell ? () => PageShell.initTheme() : () => {};
  const initTextSize = PageShell ? () => PageShell.initTextSize() : () => {};
  const initCustomizationMenu = PageShell ? () => PageShell.initCustomizationMenu() : () => {};
  const initMobileNavMenu = PageShell ? () => PageShell.initMobileNavMenu() : () => {};
  const initShareMenu = PageShell ? () => PageShell.initShareMenu() : () => {};

  const DOCS_SOURCES_CATALOG_SRC = 'sources.json?v=20260225-01';
  const DEFAULT_DOCS_SOURCES = [
    {
      id: 'llvm-core',
      name: 'LLVM Core',
      docsUrl: 'https://llvm.org/docs/',
      searchUrlTemplate: 'https://llvm.org/docs/search.html?q={query}',
      description: 'LLVM core manuals, references, internals, and contributor documentation.',
      keywords: ['llvm', 'ir', 'passes', 'codegen', 'backend', 'optimization'],
    },
    {
      id: 'clang',
      name: 'Clang',
      docsUrl: 'https://clang.llvm.org/docs/',
      searchUrlTemplate: 'https://clang.llvm.org/docs/search.html?q={query}',
      description: 'Clang user guides, diagnostics, tooling, sanitizers, and frontend docs.',
      keywords: ['clang', 'frontend', 'diagnostics', 'clang-tidy', 'clang-format', 'sanitizers'],
    },
    {
      id: 'lldb',
      name: 'LLDB',
      docsUrl: 'https://lldb.llvm.org/',
      searchUrlTemplate: 'https://lldb.llvm.org/search.html?q={query}',
      description: 'LLDB debugger documentation, command references, scripting, and API docs.',
      keywords: ['lldb', 'debugger', 'debugging', 'breakpoints', 'python api', 'remote debugging'],
    },
  ];

  let docsSources = [];

  function normalizeText(value, maxLength = 300) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
  }

  function sanitizeExternalUrl(value) {
    const raw = normalizeText(value, 480);
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

  function normalizeSource(rawSource, index = 0) {
    if (!rawSource || typeof rawSource !== 'object') return null;

    const id = normalizeText(rawSource.id || `docs-source-${index + 1}`, 80)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '') || `docs-source-${index + 1}`;
    const name = normalizeText(rawSource.name, 120) || `Docs Source ${index + 1}`;
    const docsUrl = sanitizeExternalUrl(rawSource.docsUrl);
    const searchUrlTemplate = normalizeText(rawSource.searchUrlTemplate, 420);
    const description = normalizeText(rawSource.description, 420);
    const keywords = Array.isArray(rawSource.keywords)
      ? rawSource.keywords.map((value) => normalizeText(value, 80)).filter(Boolean).slice(0, 20)
      : [];

    if (!docsUrl) return null;

    return {
      id,
      name,
      docsUrl,
      searchUrlTemplate,
      description,
      keywords,
    };
  }

  function cloneDefaultSources() {
    return DEFAULT_DOCS_SOURCES
      .map((source, index) => normalizeSource(source, index))
      .filter(Boolean);
  }

  function resolveDocsSearchUrl(searchUrlTemplate, query, docsUrl) {
    const trimmedQuery = normalizeText(query, 320);
    const fallbackUrl = sanitizeExternalUrl(docsUrl);
    const template = normalizeText(searchUrlTemplate, 420);

    if (!trimmedQuery) return fallbackUrl;
    const encoded = encodeURIComponent(trimmedQuery);

    if (!template) {
      try {
        const url = new URL(fallbackUrl || 'https://llvm.org/docs/');
        url.searchParams.set('q', trimmedQuery);
        return url.toString();
      } catch {
        return fallbackUrl;
      }
    }

    if (template.includes('{query}')) {
      return template.replace(/\{query\}/g, encoded);
    }

    try {
      const url = new URL(template);
      if (!url.searchParams.has('q')) url.searchParams.set('q', trimmedQuery);
      return url.toString();
    } catch {
      return template;
    }
  }

  async function loadDocsSources() {
    const fallback = cloneDefaultSources();
    try {
      const response = await window.fetch(DOCS_SOURCES_CATALOG_SRC, { cache: 'no-store' });
      if (!response.ok) return fallback;
      const payload = await response.json();
      const rawSources = Array.isArray(payload && payload.sources) ? payload.sources : [];
      const normalized = rawSources
        .map((source, index) => normalizeSource(source, index))
        .filter(Boolean);
      return normalized.length ? normalized : fallback;
    } catch {
      return fallback;
    }
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getQueryParams() {
    const params = new URLSearchParams(window.location.search);
    const query = normalizeText(params.get('q') || '', 320);
    const source = normalizeText(params.get('source') || '', 80)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-');
    return { query, source };
  }

  function fillSourceSelect(sources, selectedSourceId = '') {
    const select = document.getElementById('docs-source-select');
    if (!select) return;

    select.innerHTML = sources
      .map((source) => {
        const selected = source.id === selectedSourceId ? ' selected' : '';
        return `<option value="${escapeHtml(source.id)}"${selected}>${escapeHtml(source.name)}</option>`;
      })
      .join('');

    if (!select.value && sources.length) select.value = sources[0].id;
  }

  function renderSourceCards(sources, activeQuery = '') {
    const grid = document.getElementById('docs-source-grid');
    if (!grid) return;

    const cards = sources.map((source) => {
      const keywords = source.keywords.length
        ? `<p class="card-speakers paper-authors">${escapeHtml(source.keywords.slice(0, 6).join(' · '))}</p>`
        : '';
      const searchUrl = resolveDocsSearchUrl(source.searchUrlTemplate, activeQuery, source.docsUrl);
      const actionLabel = activeQuery ? `Search ${source.name}` : `Open ${source.name}`;

      return `
        <article class="talk-card paper-card docs-card">
          <a href="${escapeHtml(searchUrl || source.docsUrl)}" class="card-link-wrap" aria-label="${escapeHtml(actionLabel)}">
            <div class="card-body">
              <div class="card-meta">
                <span class="badge badge-blog">Docs</span>
                <span class="meeting-label">Upstream</span>
              </div>
              <p class="card-title">${escapeHtml(source.name)} Documentation</p>
              ${source.description ? `<p class="card-abstract">${escapeHtml(source.description)}</p>` : ''}
              <p class="card-speakers paper-authors">${escapeHtml(source.docsUrl)}</p>
              ${keywords}
            </div>
          </a>
          <div class="card-footer">
            <a href="${escapeHtml(searchUrl || source.docsUrl)}" class="card-link-btn card-link-btn--video" aria-label="${escapeHtml(actionLabel)}">
              <span aria-hidden="true">${escapeHtml(activeQuery ? 'Search Docs' : 'Open Docs')}</span>
            </a>
            <a href="${escapeHtml(source.docsUrl)}" class="card-link-btn card-link-btn--slides" aria-label="Open ${escapeHtml(source.name)} home">
              <span aria-hidden="true">Source Home</span>
            </a>
          </div>
        </article>`;
    });

    grid.innerHTML = cards.join('');
  }

  function applyHeroQueryState(query) {
    const input = document.getElementById('docs-search-input');
    const clearBtn = document.getElementById('docs-search-clear');
    if (!input || !clearBtn) return;

    input.value = query || '';

    const syncClear = () => {
      const hasText = normalizeText(input.value, 320).length > 0;
      clearBtn.classList.toggle('visible', hasText);
    };

    input.addEventListener('input', syncClear);
    input.addEventListener('focus', syncClear);
    input.addEventListener('blur', () => window.setTimeout(syncClear, 150));
    clearBtn.addEventListener('click', (event) => {
      event.preventDefault();
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      syncClear();
    });

    syncClear();
  }

  function bindHubSearchForm() {
    const form = document.getElementById('docs-hub-search-form');
    const input = document.getElementById('docs-search-input');
    const select = document.getElementById('docs-source-select');
    if (!form || !input || !select) return;

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const query = normalizeText(input.value, 320);
      const sourceId = normalizeText(select.value, 80)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-');
      const source = docsSources.find((item) => item.id === sourceId) || docsSources[0];
      if (!source) return;

      const destination = resolveDocsSearchUrl(source.searchUrlTemplate, query, source.docsUrl);
      if (destination) {
        window.location.assign(destination);
      }
    });
  }

  async function init() {
    initTheme();
    initTextSize();
    initCustomizationMenu();
    initMobileNavMenu();
    initShareMenu();

    const { query, source } = getQueryParams();
    docsSources = await loadDocsSources();

    fillSourceSelect(docsSources, source);
    applyHeroQueryState(query);
    renderSourceCards(docsSources, query);
    bindHubSearchForm();
  }

  init();
})();

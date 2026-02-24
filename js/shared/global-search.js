/**
 * global-search.js — Header Global Search hydration + autocomplete (talks/papers/blogs/docs/people).
 */

(function () {
  const HubUtils = window.LLVMHubUtils || {};

  let dataLoadPromise = null;
  let indexBuildPromise = null;
  let docsIndexLoadPromise = null;
  const formStateMap = new WeakMap();
  const GLOBAL_SEARCH_LABEL = 'Global Search across talks, papers, blogs, docs, people, and key topics';
  const GLOBAL_SEARCH_PLACEHOLDER = 'Search the full library...';
  const DOCS_UNIVERSAL_INDEX_SRC = 'docs/_static/docs-universal-search-index.js?v=20260224-01';
  const ADVANCED_FIELDS = [
    'allWords',
    'exactPhrase',
    'anyWords',
    'withoutWords',
    'where',
    'author',
    'publication',
    'yearFrom',
    'yearTo',
  ];
  const ADVANCED_FIELD_SET = new Set(ADVANCED_FIELDS);
  const ADVANCED_WHERE_VALUES = new Set(['anywhere', 'title', 'abstract']);
  const SEARCH_SCOPE_VALUES = new Set(['all', 'talks', 'papers', 'blogs', 'docs', 'people']);
  const ADVANCED_FIELDS_BY_CONTEXT = {
    all: ['allWords', 'exactPhrase', 'anyWords', 'withoutWords', 'where', 'author', 'publication', 'yearFrom', 'yearTo'],
    talks: ['allWords', 'exactPhrase', 'anyWords', 'withoutWords', 'where', 'author', 'yearFrom', 'yearTo'],
    papers: ['allWords', 'exactPhrase', 'anyWords', 'withoutWords', 'where', 'author', 'publication', 'yearFrom', 'yearTo'],
    blogs: ['allWords', 'exactPhrase', 'anyWords', 'withoutWords', 'where', 'author', 'yearFrom', 'yearTo'],
    docs: ['allWords', 'exactPhrase', 'anyWords', 'withoutWords', 'where'],
    people: ['allWords', 'exactPhrase', 'anyWords', 'withoutWords', 'author', 'publication', 'yearFrom', 'yearTo'],
  };
  const LEGACY_GLOBAL_SEARCH_LABELS = new Set([
    'Search talks, papers, and people',
    'Search talks, papers, blogs, and people',
    'Global search across talks, papers, and people',
    'Global search across talks, papers, people, and key topics',
    'Global search across talks, papers, blogs, and people',
    'Global search across talks, papers, blogs, people, and key topics',
    'Global Search across talks, papers, blogs, people, and key topics',
  ]);

  const autocompleteIndex = {
    topics: [],
    people: [],
    talks: [],
    papers: [],
    docs: [],
  };

  function normalizeText(value, maxLength = 240) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
  }

  function normalizeWhere(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return ADVANCED_WHERE_VALUES.has(normalized) ? normalized : 'anywhere';
  }

  function normalizeYear(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    if (!/^\d{4}$/.test(normalized)) return '';
    const year = Number.parseInt(normalized, 10);
    if (!Number.isFinite(year) || year < 1900 || year > 2100) return '';
    return String(year);
  }

  function normalizeScope(value, fallback = 'all') {
    const normalized = String(value || '').trim().toLowerCase();
    if (SEARCH_SCOPE_VALUES.has(normalized)) return normalized;
    return SEARCH_SCOPE_VALUES.has(fallback) ? fallback : 'all';
  }

  function isWorkSearchPage() {
    const path = String(window.location.pathname || '').toLowerCase();
    return path.endsWith('/work.html') || path.endsWith('/work');
  }

  function resolveScopeLabel(scope) {
    if (scope === 'talks') return 'Talks';
    if (scope === 'papers') return 'Papers';
    if (scope === 'blogs') return 'Blogs';
    if (scope === 'docs') return 'Docs';
    if (scope === 'people') return 'People';
    return 'All';
  }

  function resolveContextBlurb(scope) {
    if (scope === 'talks') return 'Tailored for talks, speakers, and event content';
    if (scope === 'papers') return 'Tailored for papers, authors, venues, and abstracts';
    if (scope === 'blogs') return 'Tailored for blog posts, authors, and post content';
    if (scope === 'docs') return 'Tailored for LLVM docs pages, headings, and guide content';
    if (scope === 'people') return 'Tailored for people, expertise, affiliations, and publications';
    return 'Cross-type search across talks, papers, blogs, docs, and people';
  }

  function resolveAdvancedContextScope(defaultScope) {
    const normalized = normalizeScope(defaultScope, 'all');
    if (normalized === 'talks') return 'talks';
    if (normalized === 'papers') return 'papers';
    if (normalized === 'blogs') return 'blogs';
    if (normalized === 'docs') return 'docs';
    if (normalized === 'people') return 'people';
    return 'all';
  }

  function getContextAdvancedFields(contextScope) {
    const key = resolveAdvancedContextScope(contextScope);
    return ADVANCED_FIELDS_BY_CONTEXT[key] ? [...ADVANCED_FIELDS_BY_CONTEXT[key]] : [...ADVANCED_FIELDS_BY_CONTEXT.all];
  }

  function resolvePageDefaultScope() {
    const bodyScope = String(document.body && document.body.dataset ? document.body.dataset.contentScope : '')
      .trim()
      .toLowerCase();
    if (bodyScope === 'paper') return 'papers';
    if (bodyScope === 'blog') return 'blogs';
    if (bodyScope === 'docs' || bodyScope === 'doc') return 'docs';

    const path = String(window.location.pathname || '').toLowerCase();
    if (path.includes('/people/')) return 'people';
    if (path.includes('/blogs/')) return 'blogs';
    if (path.includes('/papers/')) return 'papers';
    if (path.includes('/talks/')) return 'talks';
    if (path.includes('/docs/')) return 'docs';
    return 'all';
  }

  function shouldEnableAdvancedSearch(form) {
    if (!form) return false;
    if (isWorkSearchPage()) return false;
    if (form.classList.contains('work-hero-search')) return false;
    if (form.querySelector('#work-search-input')) return false;
    if (document.getElementById('work-advanced-panel')) return false;
    return true;
  }

  function ensureHiddenInput(form, name, fallbackValue = '') {
    if (!form) return null;
    let input = form.querySelector(`input[type="hidden"][name="${name}"]`);
    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      form.prepend(input);
    }
    if (!String(input.value || '').trim() && fallbackValue !== undefined) {
      input.value = String(fallbackValue || '');
    }
    return input;
  }

  function normalizeAdvancedField(name, value) {
    if (name === 'where') return normalizeWhere(value);
    if (name === 'yearFrom' || name === 'yearTo') return normalizeYear(value);
    return normalizeText(value, 240);
  }

  function normalizeAdvancedYearRange(yearFrom, yearTo) {
    const from = normalizeYear(yearFrom);
    const to = normalizeYear(yearTo);
    if (from && to && Number.parseInt(from, 10) > Number.parseInt(to, 10)) {
      return { yearFrom: to, yearTo: from };
    }
    return { yearFrom: from, yearTo: to };
  }

  function renderWhereOptions(contextScope) {
    if (contextScope === 'talks') {
      return `
        <option value="anywhere">Anywhere in talks</option>
        <option value="title">Talk title</option>
        <option value="abstract">Talk summary</option>`;
    }
    if (contextScope === 'papers') {
      return `
        <option value="anywhere">Anywhere in papers</option>
        <option value="title">Paper title</option>
        <option value="abstract">Abstract/content</option>`;
    }
    if (contextScope === 'blogs') {
      return `
        <option value="anywhere">Anywhere in blogs</option>
        <option value="title">Post title</option>
        <option value="abstract">Post content</option>`;
    }
    if (contextScope === 'docs') {
      return `
        <option value="anywhere">Anywhere in docs</option>
        <option value="title">Doc/page title</option>
        <option value="abstract">Headings/content</option>`;
    }
    return `
      <option value="anywhere">Anywhere</option>
      <option value="title">Title</option>
      <option value="abstract">Abstract/content</option>`;
  }

  function renderAuthorFieldLabel(contextScope) {
    if (contextScope === 'talks') return 'Speaker';
    if (contextScope === 'people') return 'Person name';
    return 'Author';
  }

  function renderAuthorPlaceholder(contextScope) {
    if (contextScope === 'talks') return 'Chris Lattner';
    if (contextScope === 'people') return 'PJ Hayes';
    return 'PJ Hayes';
  }

  function renderPublicationLabel(contextScope) {
    if (contextScope === 'people') return 'Publication/venue';
    return 'Publication';
  }

  function renderPublicationPlaceholder(contextScope) {
    if (contextScope === 'people') return 'arXiv, CGO, PLDI';
    return 'Nature, arXiv, CGO';
  }

  function renderAdvancedField(field, contextScope) {
    if (field === 'allWords') {
      return `<label class="global-search-advanced-field">
          <span>With all words</span>
          <input type="search" class="global-search-advanced-input" data-advanced-field="allWords" autocomplete="off" spellcheck="false" placeholder="llvm mlir">
        </label>`;
    }
    if (field === 'exactPhrase') {
      return `<label class="global-search-advanced-field">
          <span>With exact phrase</span>
          <input type="search" class="global-search-advanced-input" data-advanced-field="exactPhrase" autocomplete="off" spellcheck="false" placeholder="MLIR for Beginners">
        </label>`;
    }
    if (field === 'anyWords') {
      return `<label class="global-search-advanced-field">
          <span>With at least one word</span>
          <input type="search" class="global-search-advanced-input" data-advanced-field="anyWords" autocomplete="off" spellcheck="false" placeholder="gpu tensor">
        </label>`;
    }
    if (field === 'withoutWords') {
      return `<label class="global-search-advanced-field">
          <span>Without words</span>
          <input type="search" class="global-search-advanced-input" data-advanced-field="withoutWords" autocomplete="off" spellcheck="false" placeholder="swift rust">
        </label>`;
    }
    if (field === 'where') {
      return `<label class="global-search-advanced-field">
          <span>Where words occur</span>
          <select class="global-search-advanced-input" data-advanced-field="where" aria-label="Where words should be matched">
            ${renderWhereOptions(contextScope)}
          </select>
        </label>`;
    }
    if (field === 'author') {
      return `<label class="global-search-advanced-field">
          <span>${renderAuthorFieldLabel(contextScope)}</span>
          <input type="search" class="global-search-advanced-input" data-advanced-field="author" autocomplete="off" spellcheck="false" placeholder="${renderAuthorPlaceholder(contextScope)}">
        </label>`;
    }
    if (field === 'publication') {
      return `<label class="global-search-advanced-field">
          <span>${renderPublicationLabel(contextScope)}</span>
          <input type="search" class="global-search-advanced-input" data-advanced-field="publication" autocomplete="off" spellcheck="false" placeholder="${renderPublicationPlaceholder(contextScope)}">
        </label>`;
    }
    if (field === 'yearFrom') {
      return `<div class="global-search-advanced-field global-search-advanced-field--year-range">
          <span>Publication year</span>
          <div class="global-search-advanced-date-range">
            <input type="number" class="global-search-advanced-input" data-advanced-field="yearFrom" min="1900" max="2100" step="1" inputmode="numeric" placeholder="From">
            <span class="global-search-advanced-date-sep">to</span>
            <input type="number" class="global-search-advanced-input" data-advanced-field="yearTo" min="1900" max="2100" step="1" inputmode="numeric" placeholder="To">
          </div>
        </div>`;
    }
    return '';
  }

  function buildAdvancedFieldsMarkup(contextScope, defaultScope) {
    const fields = getContextAdvancedFields(contextScope);
    const seen = new Set();
    const out = [];

    if (defaultScope !== 'all') {
      out.push(`<label class="global-search-advanced-field">
          <span>Search scope</span>
          <select class="global-search-advanced-input" data-advanced-field="scope" aria-label="Search scope">
            <option value="${defaultScope}">${resolveScopeLabel(defaultScope)} only</option>
            <option value="all">All content</option>
          </select>
        </label>`);
    }

    for (const field of fields) {
      if (field === 'yearTo') continue;
      if (seen.has(field)) continue;
      seen.add(field);
      const markup = renderAdvancedField(field, contextScope);
      if (markup) out.push(markup);
      if (field === 'yearFrom') seen.add('yearTo');
    }
    return out.join('');
  }

  function ensureAdvancedHiddenInputs(form, defaultScope) {
    ensureHiddenInput(form, 'mode', 'search');
    const scopeInput = ensureHiddenInput(form, 'scope', defaultScope);
    if (scopeInput) {
      scopeInput.value = normalizeScope(scopeInput.value, defaultScope);
    }
    for (const field of ADVANCED_FIELDS) {
      const fallback = field === 'where' ? 'anywhere' : '';
      const input = ensureHiddenInput(form, field, fallback);
      if (!input) continue;
      input.value = normalizeAdvancedField(field, input.value);
    }
    const yearFromInput = form.querySelector('input[type="hidden"][name="yearFrom"]');
    const yearToInput = form.querySelector('input[type="hidden"][name="yearTo"]');
    if (yearFromInput && yearToInput) {
      const normalizedYears = normalizeAdvancedYearRange(yearFromInput.value, yearToInput.value);
      yearFromInput.value = normalizedYears.yearFrom;
      yearToInput.value = normalizedYears.yearTo;
    }
  }

  function getAdvancedPanelState(form) {
    const state = getFormState(form);
    if (!state.advanced) {
      state.advanced = {
        defaultScope: 'all',
        contextScope: 'all',
        supportedFields: new Set(ADVANCED_FIELDS),
        toggle: null,
        panel: null,
        scopeButtons: [],
      };
    }
    return state.advanced;
  }

  function isAdvancedFieldSupported(form, field) {
    if (!ADVANCED_FIELD_SET.has(field)) return false;
    const advanced = getAdvancedPanelState(form);
    if (!advanced || !(advanced.supportedFields instanceof Set) || !advanced.supportedFields.size) return true;
    return advanced.supportedFields.has(field);
  }

  function sanitizeAdvancedFieldsForContext(form) {
    for (const field of ADVANCED_FIELDS) {
      const hidden = form.querySelector(`input[type="hidden"][name="${field}"]`);
      if (!hidden) continue;
      if (isAdvancedFieldSupported(form, field)) continue;
      hidden.value = field === 'where' ? 'anywhere' : '';
    }
  }

  function updateScopeButtonsState(form) {
    const advanced = getAdvancedPanelState(form);
    const buttons = Array.isArray(advanced.scopeButtons) ? advanced.scopeButtons : [];
    if (!buttons.length) return;
    const effectiveScope = getEffectiveScopeValue(form);
    for (const button of buttons) {
      const buttonScope = normalizeScope(button.getAttribute('data-advanced-scope') || '', advanced.defaultScope);
      const isActive = buttonScope === effectiveScope;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    }
  }

  function hasAdvancedHiddenValues(form) {
    if (!form) return false;
    for (const field of ADVANCED_FIELDS) {
      if (!isAdvancedFieldSupported(form, field)) continue;
      if (field === 'where') {
        const whereInput = form.querySelector('input[type="hidden"][name="where"]');
        if (whereInput && normalizeWhere(whereInput.value) !== 'anywhere') return true;
        continue;
      }
      const input = form.querySelector(`input[type="hidden"][name="${field}"]`);
      if (input && String(input.value || '').trim()) return true;
    }
    return false;
  }

  function getEffectiveScopeValue(form) {
    const advanced = getAdvancedPanelState(form);
    const scopeInput = form.querySelector('input[type="hidden"][name="scope"]');
    return normalizeScope(scopeInput ? scopeInput.value : '', advanced.defaultScope || 'all');
  }

  function hasAdvancedOverrides(form) {
    const advanced = getAdvancedPanelState(form);
    if (hasAdvancedHiddenValues(form)) return true;
    return getEffectiveScopeValue(form) !== normalizeScope(advanced.defaultScope, 'all');
  }

  function resolveSubmitType(form, requestedType) {
    const type = String(requestedType || 'query').trim().toLowerCase() || 'query';
    if (type === 'global') return 'global';
    return hasAdvancedOverrides(form) ? 'global' : type;
  }

  function normalizeScopeForGlobalSubmit(form) {
    const advanced = getAdvancedPanelState(form);
    const scopeInput = form.querySelector('input[type="hidden"][name="scope"]');
    if (!scopeInput) return;
    if (hasAdvancedHiddenValues(form)) return;

    const defaultScope = normalizeScope(advanced.defaultScope, 'all');
    const currentScope = normalizeScope(scopeInput.value, defaultScope);
    if (currentScope !== defaultScope) return;

    scopeInput.value = 'all';
    const scopeControl = advanced.panel
      ? advanced.panel.querySelector('[data-advanced-field="scope"]')
      : null;
    if (scopeControl) scopeControl.value = 'all';
    updateAdvancedToggleState(form);
  }

  function updateAdvancedToggleState(form) {
    const advanced = getAdvancedPanelState(form);
    const toggle = advanced.toggle;
    if (!toggle) return;

    const badge = toggle.querySelector('[data-advanced-count]');
    const stateLabel = toggle.querySelector('[data-advanced-state]');
    const panelOpen = !!(advanced.panel && !advanced.panel.classList.contains('hidden'));
    let count = 0;
    for (const field of ADVANCED_FIELDS) {
      if (!isAdvancedFieldSupported(form, field)) continue;
      const input = form.querySelector(`input[type="hidden"][name="${field}"]`);
      if (!input) continue;
      const value = String(input.value || '').trim();
      if (!value) continue;
      if (field === 'where' && normalizeWhere(value) === 'anywhere') continue;
      count += 1;
    }
    if (getEffectiveScopeValue(form) !== normalizeScope(advanced.defaultScope, 'all')) count += 1;

    const hasOverrides = count > 0;
    const isOn = hasOverrides || panelOpen;
    toggle.classList.toggle('active', isOn);
    toggle.classList.toggle('has-overrides', hasOverrides);
    if (stateLabel) stateLabel.textContent = isOn ? 'On' : 'Off';
    toggle.setAttribute('data-advanced-active', hasOverrides ? 'true' : 'false');
    toggle.setAttribute('data-advanced-open', panelOpen ? 'true' : 'false');
    toggle.setAttribute('aria-label', `Advanced search (${isOn ? 'On' : 'Off'})`);
    toggle.setAttribute('aria-pressed', panelOpen ? 'true' : 'false');
    if (badge) {
      badge.hidden = !hasOverrides;
      badge.textContent = hasOverrides ? String(count) : '';
    }
    updateScopeButtonsState(form);
  }

  function closeAdvancedPanel(form) {
    const advanced = getAdvancedPanelState(form);
    const panel = advanced.panel;
    const toggle = advanced.toggle;
    if (!panel || !toggle) return;
    panel.classList.add('hidden');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-pressed', 'false');
    form.classList.remove('advanced-open');
    updateAdvancedToggleState(form);
  }

  function openAdvancedPanel(form) {
    const advanced = getAdvancedPanelState(form);
    const panel = advanced.panel;
    const toggle = advanced.toggle;
    if (!panel || !toggle) return;
    panel.classList.remove('hidden');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-pressed', 'true');
    form.classList.add('advanced-open');
    updateAdvancedToggleState(form);
  }

  function syncHiddenFromAdvancedPanel(form) {
    const advanced = getAdvancedPanelState(form);
    const panel = advanced.panel;
    if (!panel) return;

    for (const field of ADVANCED_FIELDS) {
      if (!isAdvancedFieldSupported(form, field)) continue;
      const hidden = form.querySelector(`input[type="hidden"][name="${field}"]`);
      const control = panel.querySelector(`[data-advanced-field="${field}"]`);
      if (!hidden || !control) continue;
      hidden.value = normalizeAdvancedField(field, control.value);
    }

    const yearFromInput = form.querySelector('input[type="hidden"][name="yearFrom"]');
    const yearToInput = form.querySelector('input[type="hidden"][name="yearTo"]');
    if (yearFromInput && yearToInput) {
      const normalizedYears = normalizeAdvancedYearRange(yearFromInput.value, yearToInput.value);
      yearFromInput.value = normalizedYears.yearFrom;
      yearToInput.value = normalizedYears.yearTo;
      const fromControl = panel.querySelector('[data-advanced-field="yearFrom"]');
      const toControl = panel.querySelector('[data-advanced-field="yearTo"]');
      if (fromControl) fromControl.value = normalizedYears.yearFrom;
      if (toControl) toControl.value = normalizedYears.yearTo;
    }

    const scopeControl = panel.querySelector('[data-advanced-field="scope"]');
    const scopeHidden = form.querySelector('input[type="hidden"][name="scope"]');
    if (scopeControl && scopeHidden) {
      scopeHidden.value = normalizeScope(scopeControl.value, advanced.defaultScope);
    }

    updateAdvancedToggleState(form);
  }

  function syncAdvancedPanelFromHidden(form) {
    const advanced = getAdvancedPanelState(form);
    const panel = advanced.panel;
    if (!panel) return;

    for (const field of ADVANCED_FIELDS) {
      if (!isAdvancedFieldSupported(form, field)) continue;
      const hidden = form.querySelector(`input[type="hidden"][name="${field}"]`);
      const control = panel.querySelector(`[data-advanced-field="${field}"]`);
      if (!hidden || !control) continue;
      control.value = normalizeAdvancedField(field, hidden.value);
    }

    const scopeControl = panel.querySelector('[data-advanced-field="scope"]');
    const scopeHidden = form.querySelector('input[type="hidden"][name="scope"]');
    if (scopeControl && scopeHidden) {
      scopeControl.value = normalizeScope(scopeHidden.value, advanced.defaultScope);
    }

    updateAdvancedToggleState(form);
  }

  function applyAdvancedFieldsFromUrl(form, params) {
    if (!params || typeof params.get !== 'function') return;
    for (const field of ADVANCED_FIELDS) {
      if (!params.has(field)) continue;
      const hidden = form.querySelector(`input[type="hidden"][name="${field}"]`);
      if (!hidden) continue;
      hidden.value = normalizeAdvancedField(field, params.get(field));
    }

    const yearFromInput = form.querySelector('input[type="hidden"][name="yearFrom"]');
    const yearToInput = form.querySelector('input[type="hidden"][name="yearTo"]');
    if (yearFromInput && yearToInput) {
      const normalizedYears = normalizeAdvancedYearRange(yearFromInput.value, yearToInput.value);
      yearFromInput.value = normalizedYears.yearFrom;
      yearToInput.value = normalizedYears.yearTo;
    }

    if (params.has('scope')) {
      const advanced = getAdvancedPanelState(form);
      const scopeInput = form.querySelector('input[type="hidden"][name="scope"]');
      if (scopeInput) {
        scopeInput.value = normalizeScope(params.get('scope'), advanced.defaultScope || 'all');
      }
    }
  }

  function injectAdvancedSearchUi(form, params) {
    if (!shouldEnableAdvancedSearch(form)) return;
    if (form.dataset.globalSearchAdvancedReady === 'true') return;

    const advanced = getAdvancedPanelState(form);
    const defaultScope = normalizeScope(
      form.getAttribute('data-search-scope') || form.dataset.searchScope || resolvePageDefaultScope(),
      'all'
    );
    advanced.defaultScope = defaultScope;
    advanced.contextScope = resolveAdvancedContextScope(defaultScope);
    advanced.supportedFields = new Set(getContextAdvancedFields(advanced.contextScope));
    advanced.scopeButtons = [];

    form.classList.add('has-advanced-search');
    ensureAdvancedHiddenInputs(form, defaultScope);
    applyAdvancedFieldsFromUrl(form, params);
    sanitizeAdvancedFieldsForContext(form);
    const searchBoxMainRow = form.classList.contains('search-box')
      ? ensureSearchBoxLayout(form)
      : null;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'global-search-advanced-toggle';
    toggle.setAttribute('aria-label', 'Advanced search');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-pressed', 'false');
    const toggleLabel = form.classList.contains('search-box') ? 'Advanced' : 'Adv';
    toggle.innerHTML = `<span class="global-search-advanced-toggle-label">${toggleLabel}</span><span class="global-search-advanced-switch" aria-hidden="true"><span class="global-search-advanced-switch-knob"></span></span><span class="global-search-advanced-state" data-advanced-state>Off</span><span class="global-search-advanced-count" data-advanced-count hidden></span>`;

    const panel = document.createElement('div');
    panel.className = 'global-search-advanced-panel hidden';
    panel.setAttribute('aria-label', 'Advanced search fields');
    panel.innerHTML = `
      <div class="global-search-advanced-head">
        <p class="global-search-advanced-title">Advanced Search</p>
        <p class="global-search-advanced-context">${escapeHtml(resolveContextBlurb(advanced.contextScope))}</p>
      </div>
      <div class="global-search-advanced-grid">
        ${buildAdvancedFieldsMarkup(advanced.contextScope, defaultScope)}
      </div>
      <div class="global-search-advanced-actions">
        <button type="button" class="global-search-advanced-btn global-search-advanced-btn--primary" data-advanced-action="apply">Apply</button>
        <button type="button" class="global-search-advanced-btn" data-advanced-action="clear">Reset</button>
      </div>`;

    if (form.classList.contains('search-box')) {
      const toolsRow = document.createElement('div');
      toolsRow.className = 'global-search-tools-row';

      const leftTools = document.createElement('div');
      leftTools.className = 'global-search-tools-left';

      if (defaultScope !== 'all') {
        const scopeSwitch = document.createElement('div');
        scopeSwitch.className = 'global-search-scope-switch';
        scopeSwitch.setAttribute('role', 'group');
        scopeSwitch.setAttribute('aria-label', 'Search scope');
        const options = [
          { value: defaultScope, label: `${resolveScopeLabel(defaultScope)} only` },
          { value: 'all', label: 'All content' },
        ];
        for (const option of options) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'global-search-scope-btn';
          button.setAttribute('data-advanced-scope', option.value);
          button.setAttribute('aria-pressed', 'false');
          button.textContent = option.label;
          button.addEventListener('click', (event) => {
            event.preventDefault();
            const nextScope = normalizeScope(option.value, defaultScope);
            const scopeHidden = form.querySelector('input[type="hidden"][name="scope"]');
            if (scopeHidden) scopeHidden.value = nextScope;
            const scopeControl = panel.querySelector('[data-advanced-field="scope"]');
            if (scopeControl) scopeControl.value = nextScope;
            updateAdvancedToggleState(form);
          });
          scopeSwitch.appendChild(button);
          advanced.scopeButtons.push(button);
        }
        leftTools.appendChild(scopeSwitch);
      } else {
        const contextPill = document.createElement('span');
        contextPill.className = 'global-search-context-pill';
        contextPill.textContent = 'Cross-type search';
        leftTools.appendChild(contextPill);
      }

      toolsRow.appendChild(leftTools);
      toolsRow.appendChild(toggle);
      if (searchBoxMainRow && searchBoxMainRow.parentNode === form) {
        searchBoxMainRow.insertAdjacentElement('afterend', toolsRow);
      } else {
        form.appendChild(toolsRow);
      }
    } else {
      const submitButton = form.querySelector('.global-search-submit');
      if (submitButton) form.insertBefore(toggle, submitButton);
      else form.appendChild(toggle);
    }
    form.appendChild(panel);

    advanced.toggle = toggle;
    advanced.panel = panel;

    syncAdvancedPanelFromHidden(form);
    if (hasAdvancedOverrides(form)) {
      openAdvancedPanel(form);
    }

    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const isOpen = panel.classList.contains('hidden');
      if (isOpen) openAdvancedPanel(form);
      else closeAdvancedPanel(form);
    });

    panel.querySelectorAll('[data-advanced-field]').forEach((field) => {
      field.addEventListener('input', () => {
        syncHiddenFromAdvancedPanel(form);
      });
      field.addEventListener('change', () => {
        syncHiddenFromAdvancedPanel(form);
      });
      field.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          syncHiddenFromAdvancedPanel(form);
          form.dataset.searchSubmitType = 'global';
          form.dataset.searchSubmitSource = 'advanced';
          if (typeof form.requestSubmit === 'function') form.requestSubmit();
          else form.submit();
        }
      });
    });

    panel.querySelectorAll('[data-advanced-action]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        const action = String(button.getAttribute('data-advanced-action') || '').trim().toLowerCase();
        if (action === 'clear') {
          for (const field of ADVANCED_FIELDS) {
            const hidden = form.querySelector(`input[type="hidden"][name="${field}"]`);
            if (!hidden) continue;
            hidden.value = field === 'where' ? 'anywhere' : '';
          }
          const scopeHidden = form.querySelector('input[type="hidden"][name="scope"]');
          if (scopeHidden) scopeHidden.value = normalizeScope(defaultScope, 'all');
          sanitizeAdvancedFieldsForContext(form);
          syncAdvancedPanelFromHidden(form);
          return;
        }

        syncHiddenFromAdvancedPanel(form);
        form.dataset.searchSubmitType = 'global';
        form.dataset.searchSubmitSource = 'advanced';
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else form.submit();
      });
    });

    document.addEventListener('pointerdown', (event) => {
      if (form.contains(event.target)) return;
      closeAdvancedPanel(form);
    });

    document.addEventListener('focusin', (event) => {
      if (form.contains(event.target)) return;
      closeAdvancedPanel(form);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !panel.classList.contains('hidden')) {
        closeAdvancedPanel(form);
        toggle.focus();
      }
    });

    form.addEventListener('submit', () => {
      syncHiddenFromAdvancedPanel(form);
      sanitizeAdvancedFieldsForContext(form);
      const modeInput = form.querySelector('input[type="hidden"][name="mode"]');
      if (modeInput) modeInput.value = 'search';
      const scopeInput = form.querySelector('input[type="hidden"][name="scope"]');
      if (scopeInput) scopeInput.value = normalizeScope(scopeInput.value, defaultScope);
      const submitType = String(form.dataset.searchSubmitType || 'query').trim().toLowerCase();
      if (submitType === 'global') {
        normalizeScopeForGlobalSubmit(form);
      }
      if (hasAdvancedOverrides(form)) {
        form.dataset.searchSubmitType = 'global';
      }
      updateAdvancedToggleState(form);
    }, { capture: true });

    form.dataset.globalSearchAdvancedReady = 'true';
  }

  function pickFirstCsvValue(value) {
    return String(value || '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)[0] || '';
  }

  function deriveInitialQuery(params) {
    const mode = String(params.get('mode') || '').trim().toLowerCase();
    if (mode === 'search') {
      const q = String(params.get('q') || '').trim();
      if (q) return q;
    }

    const directCandidates = [
      params.get('q'),
      params.get('value'),
      params.get('speaker'),
    ];

    for (const candidate of directCandidates) {
      const value = String(candidate || '').trim();
      if (value) return value;
    }

    return pickFirstCsvValue(params.get('tag'));
  }

  function normalizeTalks(rawTalks) {
    if (typeof HubUtils.normalizeTalks === 'function') {
      return HubUtils.normalizeTalks(rawTalks);
    }
    return Array.isArray(rawTalks) ? rawTalks : [];
  }

  function getTalkKeyTopics(talk, limit = Infinity) {
    if (typeof HubUtils.getTalkKeyTopics === 'function') {
      return HubUtils.getTalkKeyTopics(talk, limit);
    }
    const tags = Array.isArray(talk && talk.tags) ? talk.tags : [];
    return Number.isFinite(limit) ? tags.slice(0, limit) : tags;
  }

  function getPaperKeyTopics(paper, limit = Infinity) {
    if (typeof HubUtils.getPaperKeyTopics === 'function') {
      return HubUtils.getPaperKeyTopics(paper, limit);
    }
    const tags = Array.isArray(paper && paper.tags) ? paper.tags : [];
    const keywords = Array.isArray(paper && paper.keywords) ? paper.keywords : [];
    const out = [];
    const seen = new Set();
    for (const value of [...tags, ...keywords]) {
      const label = String(value || '').trim();
      const key = label.toLowerCase();
      if (!label || seen.has(key)) continue;
      seen.add(key);
      out.push(label);
      if (Number.isFinite(limit) && out.length >= limit) break;
    }
    return out;
  }

  function normalizePersonKey(value) {
    if (typeof HubUtils.normalizePersonKey === 'function') {
      return HubUtils.normalizePersonKey(value);
    }
    return String(value || '').trim().toLowerCase();
  }

  function normalizePersonLabel(value) {
    if (typeof HubUtils.normalizePersonDisplayName === 'function') {
      return HubUtils.normalizePersonDisplayName(value);
    }
    return String(value || '').trim();
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function highlightMatch(text, query) {
    if (!query) return escapeHtml(text);
    const escaped = String(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escapeHtml(text).replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
  }

  function addCount(map, label) {
    const key = String(label || '').trim();
    if (!key) return;
    map.set(key, (map.get(key) || 0) + 1);
  }

  function mapToSortedEntries(map) {
    return [...map.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }

  function mapToAlphaEntries(map) {
    return [...map.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  function ensureScript(src) {
    return new Promise((resolve, reject) => {
      const existing = [...document.querySelectorAll('script[src]')]
        .find((script) => {
          const scriptSrc = script.getAttribute('src') || '';
          return scriptSrc === src || scriptSrc.startsWith(`${src}?`);
        });
      if (existing) {
        if (existing.dataset.loaded === 'true') {
          resolve();
          return;
        }
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Could not load ${src}`)), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.addEventListener('load', () => {
        script.dataset.loaded = 'true';
        resolve();
      }, { once: true });
      script.addEventListener('error', () => reject(new Error(`Could not load ${src}`)), { once: true });
      document.body.appendChild(script);
    });
  }

  async function ensureDocsIndexLoader() {
    if (docsIndexLoadPromise) return docsIndexLoadPromise;

    docsIndexLoadPromise = (async () => {
      if (window.LLVMDocsUniversalSearchIndex && Array.isArray(window.LLVMDocsUniversalSearchIndex.entries)) {
        return true;
      }
      await ensureScript(DOCS_UNIVERSAL_INDEX_SRC);
      return !!(window.LLVMDocsUniversalSearchIndex && Array.isArray(window.LLVMDocsUniversalSearchIndex.entries));
    })().catch(() => false);

    return docsIndexLoadPromise;
  }

  async function ensureDataLoaders() {
    if (dataLoadPromise) return dataLoadPromise;

    dataLoadPromise = (async () => {
      const tasks = [];
      if (typeof window.loadEventData !== 'function') {
        tasks.push(ensureScript('js/events-data.js'));
      }
      if (typeof window.loadPaperData !== 'function') {
        tasks.push(ensureScript('js/papers-data.js'));
      }
      tasks.push(ensureDocsIndexLoader());
      if (tasks.length) {
        await Promise.allSettled(tasks);
      }
    })();

    return dataLoadPromise;
  }

  async function buildAutocompleteIndex() {
    if (indexBuildPromise) return indexBuildPromise;

    indexBuildPromise = (async () => {
      await ensureDataLoaders();

      const topicCounts = new Map();
      const peopleBuckets = new Map();
      const talkTitleCounts = new Map();
      const paperTitleCounts = new Map();
      const docsTitleBuckets = new Map();

      const addPerson = (name) => {
        const label = normalizePersonLabel(name);
        const key = normalizePersonKey(label);
        if (!label || !key) return;
        if (!peopleBuckets.has(key)) peopleBuckets.set(key, { count: 0, labels: new Map() });
        const bucket = peopleBuckets.get(key);
        bucket.count += 1;
        bucket.labels.set(label, (bucket.labels.get(label) || 0) + 1);
      };

      const addDocTitle = (title, href) => {
        const label = normalizeText(title, 220);
        if (!label) return;
        const rawHref = normalizeText(href, 400);
        let url = '';
        if (rawHref) {
          if (/^https?:\/\//i.test(rawHref)) url = rawHref;
          else if (rawHref.startsWith('/')) url = rawHref;
          else if (rawHref.startsWith('docs/')) url = rawHref;
          else url = `docs/${rawHref}`.replace(/\/{2,}/g, '/');
        }
        if (!url) {
          url = 'docs/';
        }
        if (!docsTitleBuckets.has(label)) {
          docsTitleBuckets.set(label, { count: 0, url });
        }
        const bucket = docsTitleBuckets.get(label);
        bucket.count += 1;
      };

      if (typeof window.loadEventData === 'function') {
        try {
          const payload = await window.loadEventData();
          const talks = normalizeTalks(payload.talks || []);

          for (const talk of talks) {
            for (const topic of getTalkKeyTopics(talk, 12)) addCount(topicCounts, topic);
            for (const speaker of (talk.speakers || [])) addPerson(speaker && speaker.name);
            addCount(talkTitleCounts, talk.title);
          }
        } catch {
          // Ignore data-load failures here; autocomplete can still operate with partial data.
        }
      }

      if (typeof window.loadPaperData === 'function') {
        try {
          const payload = await window.loadPaperData();
          const papers = Array.isArray(payload.papers) ? payload.papers : [];

          for (const paper of papers) {
            for (const topic of getPaperKeyTopics(paper, 12)) addCount(topicCounts, topic);
            for (const author of (paper.authors || [])) addPerson(author && author.name);
            addCount(paperTitleCounts, paper.title);
          }
        } catch {
          // Ignore data-load failures here; autocomplete can still operate with partial data.
        }
      }

      if (window.LLVMDocsUniversalSearchIndex && Array.isArray(window.LLVMDocsUniversalSearchIndex.entries)) {
        try {
          for (const entry of window.LLVMDocsUniversalSearchIndex.entries) {
            if (!entry || typeof entry !== 'object') continue;
            addDocTitle(entry.title, entry.href);
          }
        } catch {
          // Ignore docs index parse failures; other autocomplete buckets remain available.
        }
      }

      autocompleteIndex.topics = mapToSortedEntries(topicCounts);
      autocompleteIndex.people = [...peopleBuckets.values()]
        .map((bucket) => {
          const label = [...bucket.labels.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
          return { label, count: bucket.count };
        })
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
      autocompleteIndex.talks = mapToAlphaEntries(talkTitleCounts);
      autocompleteIndex.papers = mapToAlphaEntries(paperTitleCounts);
      autocompleteIndex.docs = [...docsTitleBuckets.entries()]
        .map(([label, info]) => ({
          label,
          count: Number(info && info.count || 0),
          url: String(info && info.url || 'docs/'),
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
      return autocompleteIndex;
    })();

    return indexBuildPromise;
  }

  function ensureSearchBoxLayout(form) {
    if (!form || !form.classList.contains('search-box')) return null;
    if (form.classList.contains('work-hero-search')) return null;
    if (form.querySelector('#work-search-input')) return null;
    let mainRow = form.querySelector('.global-search-main-row');
    if (mainRow) return mainRow;

    mainRow = document.createElement('div');
    mainRow.className = 'global-search-main-row';

    const hiddenInputs = [...form.querySelectorAll('input[type="hidden"]')];
    const anchor = hiddenInputs.length ? hiddenInputs[hiddenInputs.length - 1] : null;

    const icon = form.querySelector('.search-icon');
    const input = form.querySelector('.global-search-input');
    const clearButton = form.querySelector('.search-clear');
    const submitButton = form.querySelector('.global-search-submit');

    if (anchor && anchor.parentNode === form) {
      anchor.insertAdjacentElement('afterend', mainRow);
    } else {
      form.prepend(mainRow);
    }

    const orderedNodes = [icon, input, clearButton, submitButton];
    for (const node of orderedNodes) {
      if (!node || node.parentNode !== form) continue;
      mainRow.appendChild(node);
    }

    const existingDropdowns = [...form.querySelectorAll('.search-dropdown')]
      .filter((node) => node && node.parentNode === form);
    for (const dropdown of existingDropdowns) {
      mainRow.appendChild(dropdown);
    }

    return mainRow;
  }

  function ensureDropdown(form) {
    let dropdown = form.querySelector('.global-search-dropdown');
    const mainRow = form.classList.contains('search-box')
      ? ensureSearchBoxLayout(form)
      : null;
    const dropdownParent = mainRow || form;

    if (dropdown) {
      if (dropdown.parentNode !== dropdownParent) {
        dropdownParent.appendChild(dropdown);
      }
      return dropdown;
    }

    dropdown = document.createElement('div');
    dropdown.className = 'search-dropdown global-search-dropdown hidden';
    dropdown.setAttribute('role', 'listbox');
    dropdown.setAttribute('aria-label', 'Global Search suggestions');
    dropdownParent.appendChild(dropdown);
    return dropdown;
  }

  function getFormState(form) {
    let state = formStateMap.get(form);
    if (!state) {
      state = {
        renderToken: 0,
        activeItemIndex: -1,
      };
      formStateMap.set(form, state);
    }
    return state;
  }

  function closeDropdown(form) {
    const dropdown = form.querySelector('.global-search-dropdown');
    if (!dropdown) return;
    dropdown.classList.add('hidden');
    getFormState(form).activeItemIndex = -1;
  }

  function rankAutocompleteMatches(entries, query, limit) {
    const list = Array.isArray(entries) ? entries : [];
    const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : list.length;
    if (typeof HubUtils.rankAutocompleteEntries === 'function') {
      return HubUtils.rankAutocompleteEntries(list, query, { limit: max });
    }

    const q = String(query || '').trim().toLowerCase();
    if (!q) return list.slice(0, max);
    return list
      .filter((item) => String((item && item.label) || '').toLowerCase().includes(q))
      .slice(0, max);
  }

  function collectMatches(query) {
    const rawQuery = String(query || '').trim();
    if (!rawQuery) {
      return { topics: [], people: [], talks: [], papers: [], docs: [] };
    }

    return {
      topics: rankAutocompleteMatches(autocompleteIndex.topics, rawQuery, 6),
      people: rankAutocompleteMatches(autocompleteIndex.people, rawQuery, 6),
      talks: rankAutocompleteMatches(autocompleteIndex.talks, rawQuery, 4),
      papers: rankAutocompleteMatches(autocompleteIndex.papers, rawQuery, 4),
      docs: rankAutocompleteMatches(autocompleteIndex.docs, rawQuery, 5),
    };
  }

  function renderDropdown(form, input, query) {
    const dropdown = ensureDropdown(form);
    const state = getFormState(form);
    const matches = collectMatches(query);
    const hasAny =
      matches.topics.length > 0 ||
      matches.people.length > 0 ||
      matches.talks.length > 0 ||
      matches.papers.length > 0 ||
      matches.docs.length > 0;

    if (!hasAny) {
      closeDropdown(form);
      return;
    }

    const tagIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`;
    const personIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
    const talkIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
    const paperIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    const docsIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`;
    const searchIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;

    const sections = [`
      <div class="search-dropdown-section search-dropdown-section--action">
        <button type="button" class="search-dropdown-item search-dropdown-item--action" role="option" aria-selected="false"
                data-autocomplete-type="global"
                data-autocomplete-value="${escapeHtml(String(query || '').trim())}">
          <span class="search-dropdown-item-icon">${searchIcon}</span>
          <span class="search-dropdown-item-label">Run Global Search for "${escapeHtml(String(query || '').trim())}"</span>
          <span class="search-dropdown-item-count">All</span>
        </button>
      </div>`];

    if (matches.topics.length) {
      sections.push(`
        <div class="search-dropdown-section">
          <div class="search-dropdown-label" aria-hidden="true">Key Topics</div>
          ${matches.topics.map((item) => `
            <button type="button" class="search-dropdown-item" role="option" aria-selected="false"
                    data-autocomplete-type="topic"
                    data-autocomplete-value="${escapeHtml(item.label)}">
              <span class="search-dropdown-item-icon">${tagIcon}</span>
              <span class="search-dropdown-item-label">${highlightMatch(item.label, query)}</span>
              <span class="search-dropdown-item-count">${item.count.toLocaleString()}</span>
            </button>`).join('')}
        </div>`);
    }

    if (matches.people.length) {
      sections.push(`
        <div class="search-dropdown-section">
          <div class="search-dropdown-label" aria-hidden="true">Speakers + Authors</div>
          ${matches.people.map((item) => `
            <button type="button" class="search-dropdown-item" role="option" aria-selected="false"
                    data-autocomplete-type="person"
                    data-autocomplete-value="${escapeHtml(item.label)}">
              <span class="search-dropdown-item-icon">${personIcon}</span>
              <span class="search-dropdown-item-label">${highlightMatch(item.label, query)}</span>
              <span class="search-dropdown-item-count">${item.count.toLocaleString()} work${item.count === 1 ? '' : 's'}</span>
            </button>`).join('')}
        </div>`);
    }

    if (matches.talks.length) {
      sections.push(`
        <div class="search-dropdown-section">
          <div class="search-dropdown-label" aria-hidden="true">Talk Titles</div>
          ${matches.talks.map((item) => `
            <button type="button" class="search-dropdown-item" role="option" aria-selected="false"
                    data-autocomplete-type="talk"
                    data-autocomplete-value="${escapeHtml(item.label)}">
              <span class="search-dropdown-item-icon">${talkIcon}</span>
              <span class="search-dropdown-item-label">${highlightMatch(item.label, query)}</span>
              <span class="search-dropdown-item-count">Talk</span>
            </button>`).join('')}
        </div>`);
    }

    if (matches.papers.length) {
      sections.push(`
        <div class="search-dropdown-section">
          <div class="search-dropdown-label" aria-hidden="true">Paper + Blog Titles</div>
          ${matches.papers.map((item) => `
            <button type="button" class="search-dropdown-item" role="option" aria-selected="false"
                    data-autocomplete-type="paper"
                    data-autocomplete-value="${escapeHtml(item.label)}">
              <span class="search-dropdown-item-icon">${paperIcon}</span>
              <span class="search-dropdown-item-label">${highlightMatch(item.label, query)}</span>
              <span class="search-dropdown-item-count">Paper/Blog</span>
            </button>`).join('')}
        </div>`);
    }

    if (matches.docs.length) {
      sections.push(`
        <div class="search-dropdown-section">
          <div class="search-dropdown-label" aria-hidden="true">Docs Pages</div>
          ${matches.docs.map((item) => `
            <button type="button" class="search-dropdown-item" role="option" aria-selected="false"
                    data-autocomplete-type="doc"
                    data-autocomplete-value="${escapeHtml(item.label)}"
                    data-autocomplete-doc-url="${escapeHtml(String(item.url || 'docs/'))}">
              <span class="search-dropdown-item-icon">${docsIcon}</span>
              <span class="search-dropdown-item-label">${highlightMatch(item.label, query)}</span>
              <span class="search-dropdown-item-count">Docs</span>
            </button>`).join('')}
        </div>`);
    }

    dropdown.innerHTML = sections.join('<div class="search-dropdown-divider"></div>');
    dropdown.classList.remove('hidden');
    state.activeItemIndex = -1;

    dropdown.querySelectorAll('.search-dropdown-item').forEach((item) => {
      let handled = false;
      const activate = (event) => {
        if (handled) return;
        handled = true;
        window.setTimeout(() => { handled = false; }, 0);
        event.preventDefault();
        event.stopPropagation();
        const requestedType = String(item.dataset.autocompleteType || 'query').trim().toLowerCase();
        if (requestedType === 'doc') {
          const directUrl = String(item.dataset.autocompleteDocUrl || '').trim();
          if (!directUrl) return;
          closeDropdown(form);
          window.location.assign(directUrl);
          return;
        }
        const submitType = resolveSubmitType(form, requestedType);
        form.dataset.searchSubmitType = submitType;
        if (submitType === 'global') normalizeScopeForGlobalSubmit(form);
        form.dataset.searchSubmitSource = 'autocomplete';
        const value = String(item.dataset.autocompleteValue || '').trim();
        if (!value) return;
        input.value = value;
        closeDropdown(form);
        if (typeof form.requestSubmit === 'function') {
          form.requestSubmit();
        } else {
          form.submit();
        }
      };
      item.addEventListener('mousedown', activate);
      item.addEventListener('click', activate);
      item.addEventListener('touchstart', activate, { passive: false });
    });
  }

  async function renderDropdownAsync(form, input, query) {
    const state = getFormState(form);
    const token = ++state.renderToken;
    await buildAutocompleteIndex();
    if (token !== state.renderToken) return;
    renderDropdown(form, input, query);
  }

  function navigateDropdown(form, direction) {
    const dropdown = form.querySelector('.global-search-dropdown');
    if (!dropdown || dropdown.classList.contains('hidden')) return false;
    const state = getFormState(form);

    const items = [...dropdown.querySelectorAll('.search-dropdown-item')];
    if (!items.length) return false;

    if (state.activeItemIndex >= 0 && state.activeItemIndex < items.length) {
      items[state.activeItemIndex].setAttribute('aria-selected', 'false');
    }

    state.activeItemIndex += direction;
    if (state.activeItemIndex < 0) state.activeItemIndex = items.length - 1;
    if (state.activeItemIndex >= items.length) state.activeItemIndex = 0;

    const activeItem = items[state.activeItemIndex];
    activeItem.setAttribute('aria-selected', 'true');
    activeItem.scrollIntoView({ block: 'nearest' });
    return true;
  }

  function initGlobalSearchInput(form, initialValue, params) {
    const input = form ? form.querySelector('.global-search-input') : null;
    if (!form || !input) return;

    if (!String(input.value || '').trim() && initialValue) {
      input.value = initialValue;
    }

    const currentFormLabel = String(form.getAttribute('aria-label') || '').trim();
    if (!currentFormLabel || /search talks, papers/i.test(currentFormLabel) || /global search/i.test(currentFormLabel)) {
      form.setAttribute('aria-label', GLOBAL_SEARCH_LABEL);
    }

    const currentLabel = String(input.getAttribute('aria-label') || '').trim();
    if (!currentLabel || LEGACY_GLOBAL_SEARCH_LABELS.has(currentLabel)) {
      input.setAttribute('aria-label', GLOBAL_SEARCH_LABEL);
    }
    if (!input.getAttribute('title')) {
      input.setAttribute('title', GLOBAL_SEARCH_LABEL);
    }
    const submitButton = form.querySelector('.global-search-submit');
    if (submitButton) {
      submitButton.setAttribute('aria-label', 'Run Global Search');
      if (!submitButton.getAttribute('title')) {
        submitButton.setAttribute('title', 'Run Global Search');
      }
    }
    input.setAttribute('placeholder', resolveSectionSearchPlaceholder(form));

    injectAdvancedSearchUi(form, params);
    ensureDropdown(form);

    input.addEventListener('focus', () => {
      const value = String(input.value || '').trim();
      if (value.length < 2) {
        closeDropdown(form);
        return;
      }
      renderDropdownAsync(form, input, value);
    });

    input.addEventListener('input', () => {
      const value = String(input.value || '').trim();
      if (value.length < 2) {
        closeDropdown(form);
        return;
      }
      renderDropdownAsync(form, input, value);
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        navigateDropdown(form, 1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        navigateDropdown(form, -1);
        return;
      }
      if (event.key === 'Enter') {
        const state = getFormState(form);
        const dropdown = form.querySelector('.global-search-dropdown');
        if (!dropdown || dropdown.classList.contains('hidden')) return;
        if (state.activeItemIndex < 0) {
          event.preventDefault();
          const submitType = resolveSubmitType(form, 'query');
          form.dataset.searchSubmitType = submitType;
          if (submitType === 'global') normalizeScopeForGlobalSubmit(form);
          form.dataset.searchSubmitSource = 'enter';
          closeDropdown(form);
          if (typeof form.requestSubmit === 'function') {
            form.requestSubmit();
          } else {
            form.submit();
          }
          return;
        }
        const items = dropdown.querySelectorAll('.search-dropdown-item');
        const activeItem = items[state.activeItemIndex];
        if (!activeItem) return;

        event.preventDefault();
        const requestedType = String(activeItem.dataset.autocompleteType || 'query').trim().toLowerCase();
        if (requestedType === 'doc') {
          const directUrl = String(activeItem.dataset.autocompleteDocUrl || '').trim();
          if (!directUrl) return;
          closeDropdown(form);
          window.location.assign(directUrl);
          return;
        }
        const submitType = resolveSubmitType(form, requestedType);
        form.dataset.searchSubmitType = submitType;
        if (submitType === 'global') normalizeScopeForGlobalSubmit(form);
        form.dataset.searchSubmitSource = 'enter';
        const value = String(activeItem.dataset.autocompleteValue || '').trim();
        if (!value) return;
        input.value = value;
        closeDropdown(form);
        if (typeof form.requestSubmit === 'function') {
          form.requestSubmit();
        } else {
          form.submit();
        }
      }
      if (event.key === 'Escape') {
        closeDropdown(form);
      }
    });

    input.addEventListener('blur', () => {
      window.setTimeout(() => closeDropdown(form), 150);
    });
  }

  function initGlobalSearchInputs() {
    const forms = [...document.querySelectorAll('.global-search-form')];
    if (!forms.length) return;

    const params = new URLSearchParams(window.location.search);
    const initialValue = deriveInitialQuery(params);
    for (const form of forms) {
      initGlobalSearchInput(form, initialValue, params);
    }
  }

  function resolveSectionSearchPlaceholder(form) {
    const scope = normalizeScope(
      form && (form.getAttribute('data-search-scope') || (form.dataset ? form.dataset.searchScope : '') || resolvePageDefaultScope()),
      'all'
    );
    if (scope === 'talks') return 'Search talks (titles, speakers, summaries)...';
    if (scope === 'papers') return 'Search papers (titles, authors, abstracts)...';
    if (scope === 'blogs') return 'Search blogs (titles, authors, content)...';
    if (scope === 'docs') return 'Search docs (titles, headings, content)...';
    if (scope === 'people') return 'Search people (names, expertise, affiliations)...';
    return GLOBAL_SEARCH_PLACEHOLDER;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGlobalSearchInputs);
  } else {
    initGlobalSearchInputs();
  }
})();

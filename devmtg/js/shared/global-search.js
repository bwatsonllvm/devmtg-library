/**
 * global-search.js — Hydrate header global search from URL state.
 */

(function () {
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

  function initGlobalSearchInput() {
    const input = document.querySelector('.global-search-input');
    if (!input) return;
    if (String(input.value || '').trim()) return;

    const params = new URLSearchParams(window.location.search);
    const initialValue = deriveInitialQuery(params);
    if (initialValue) input.value = initialValue;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGlobalSearchInput);
  } else {
    initGlobalSearchInput();
  }
})();

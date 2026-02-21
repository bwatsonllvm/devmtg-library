/**
 * global-search.js — Header global search hydration + autocomplete.
 */

(function () {
  const HubUtils = window.LLVMHubUtils || {};

  let dataLoadPromise = null;
  let indexBuildPromise = null;
  let renderToken = 0;
  let activeItemIndex = -1;

  const autocompleteIndex = {
    topics: [],
    people: [],
    talks: [],
    papers: [],
  };

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
      const peopleCounts = new Map();
      const talkTitleCounts = new Map();
      const paperTitleCounts = new Map();

      if (typeof window.loadEventData === 'function') {
        try {
          const payload = await window.loadEventData();
          const talks = normalizeTalks(payload.talks || []);

          for (const talk of talks) {
            for (const tag of (talk.tags || [])) addCount(topicCounts, tag);
            for (const speaker of (talk.speakers || [])) addCount(peopleCounts, speaker && speaker.name);
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
            for (const tag of (paper.tags || [])) addCount(topicCounts, tag);
            for (const author of (paper.authors || [])) addCount(peopleCounts, author && author.name);
            addCount(paperTitleCounts, paper.title);
          }
        } catch {
          // Ignore data-load failures here; autocomplete can still operate with partial data.
        }
      }

      autocompleteIndex.topics = mapToSortedEntries(topicCounts);
      autocompleteIndex.people = mapToSortedEntries(peopleCounts);
      autocompleteIndex.talks = mapToAlphaEntries(talkTitleCounts);
      autocompleteIndex.papers = mapToAlphaEntries(paperTitleCounts);
      return autocompleteIndex;
    })();

    return indexBuildPromise;
  }

  function ensureDropdown(form) {
    let dropdown = form.querySelector('.global-search-dropdown');
    if (dropdown) return dropdown;

    dropdown = document.createElement('div');
    dropdown.className = 'search-dropdown global-search-dropdown hidden';
    dropdown.setAttribute('role', 'listbox');
    dropdown.setAttribute('aria-label', 'Global search suggestions');
    form.appendChild(dropdown);
    return dropdown;
  }

  function closeDropdown(form) {
    const dropdown = form.querySelector('.global-search-dropdown');
    if (!dropdown) return;
    dropdown.classList.add('hidden');
    activeItemIndex = -1;
  }

  function collectMatches(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) {
      return { topics: [], people: [], talks: [], papers: [] };
    }

    return {
      topics: autocompleteIndex.topics.filter((item) => item.label.toLowerCase().includes(q)).slice(0, 6),
      people: autocompleteIndex.people.filter((item) => item.label.toLowerCase().includes(q)).slice(0, 6),
      talks: autocompleteIndex.talks.filter((item) => item.label.toLowerCase().includes(q)).slice(0, 4),
      papers: autocompleteIndex.papers.filter((item) => item.label.toLowerCase().includes(q)).slice(0, 4),
    };
  }

  function renderDropdown(form, input, query) {
    const dropdown = ensureDropdown(form);
    const matches = collectMatches(query);
    const hasAny =
      matches.topics.length > 0 ||
      matches.people.length > 0 ||
      matches.talks.length > 0 ||
      matches.papers.length > 0;

    if (!hasAny) {
      closeDropdown(form);
      return;
    }

    const tagIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`;
    const personIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
    const talkIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
    const paperIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;

    const sections = [];

    if (matches.topics.length) {
      sections.push(`
        <div class="search-dropdown-section">
          <div class="search-dropdown-label" aria-hidden="true">Topics</div>
          ${matches.topics.map((item) => `
            <button class="search-dropdown-item" role="option" aria-selected="false"
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
            <button class="search-dropdown-item" role="option" aria-selected="false"
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
            <button class="search-dropdown-item" role="option" aria-selected="false"
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
          <div class="search-dropdown-label" aria-hidden="true">Paper Titles</div>
          ${matches.papers.map((item) => `
            <button class="search-dropdown-item" role="option" aria-selected="false"
                    data-autocomplete-value="${escapeHtml(item.label)}">
              <span class="search-dropdown-item-icon">${paperIcon}</span>
              <span class="search-dropdown-item-label">${highlightMatch(item.label, query)}</span>
              <span class="search-dropdown-item-count">Paper</span>
            </button>`).join('')}
        </div>`);
    }

    dropdown.innerHTML = sections.join('<div class="search-dropdown-divider"></div>');
    dropdown.classList.remove('hidden');
    activeItemIndex = -1;

    dropdown.querySelectorAll('.search-dropdown-item').forEach((item) => {
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        const value = String(item.dataset.autocompleteValue || '').trim();
        if (!value) return;
        input.value = value;
        closeDropdown(form);
        if (typeof form.requestSubmit === 'function') {
          form.requestSubmit();
        } else {
          form.submit();
        }
      });
    });
  }

  async function renderDropdownAsync(form, input, query) {
    const token = ++renderToken;
    await buildAutocompleteIndex();
    if (token !== renderToken) return;
    renderDropdown(form, input, query);
  }

  function navigateDropdown(form, direction) {
    const dropdown = form.querySelector('.global-search-dropdown');
    if (!dropdown || dropdown.classList.contains('hidden')) return false;

    const items = [...dropdown.querySelectorAll('.search-dropdown-item')];
    if (!items.length) return false;

    if (activeItemIndex >= 0 && activeItemIndex < items.length) {
      items[activeItemIndex].setAttribute('aria-selected', 'false');
    }

    activeItemIndex += direction;
    if (activeItemIndex < 0) activeItemIndex = items.length - 1;
    if (activeItemIndex >= items.length) activeItemIndex = 0;

    const activeItem = items[activeItemIndex];
    activeItem.setAttribute('aria-selected', 'true');
    activeItem.scrollIntoView({ block: 'nearest' });
    return true;
  }

  function initGlobalSearchInput() {
    const form = document.querySelector('.global-search-form');
    const input = form ? form.querySelector('.global-search-input') : null;
    if (!form || !input) return;

    if (!String(input.value || '').trim()) {
      const params = new URLSearchParams(window.location.search);
      const initialValue = deriveInitialQuery(params);
      if (initialValue) input.value = initialValue;
    }

    ensureDropdown(form);

    input.addEventListener('focus', () => {
      const value = String(input.value || '').trim();
      if (!value) return;
      renderDropdownAsync(form, input, value);
    });

    input.addEventListener('input', () => {
      const value = String(input.value || '').trim();
      if (!value) {
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
        const dropdown = form.querySelector('.global-search-dropdown');
        if (!dropdown || dropdown.classList.contains('hidden') || activeItemIndex < 0) return;
        const items = dropdown.querySelectorAll('.search-dropdown-item');
        const activeItem = items[activeItemIndex];
        if (!activeItem) return;

        event.preventDefault();
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGlobalSearchInput);
  } else {
    initGlobalSearchInput();
  }
})();

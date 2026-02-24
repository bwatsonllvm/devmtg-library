/**
 * home.js — Home page interactions.
 */

const HubUtils = window.LLVMHubUtils || {};
const PageShell = typeof HubUtils.createPageShell === 'function'
  ? HubUtils.createPageShell({
      mobileHeaderActionMap: {
        share: 'share-btn',
        display: 'customization-toggle',
      },
    })
  : null;

const initTheme = PageShell ? () => PageShell.initTheme() : () => {};
const initTextSize = PageShell ? () => PageShell.initTextSize() : () => {};
const initCustomizationMenu = PageShell ? () => PageShell.initCustomizationMenu() : () => {};
const initMobileNavMenu = PageShell ? () => PageShell.initMobileNavMenu() : () => {};
const initShareMenu = PageShell ? () => PageShell.initShareMenu() : () => {};

function initHomeHeroSearch() {
  const input = document.getElementById('home-search-input');
  const clearBtn = document.getElementById('home-search-clear');
  if (!input || !clearBtn) return;

  const syncClear = () => {
    const hasText = String(input.value || '').trim().length > 0;
    clearBtn.classList.toggle('visible', hasText);
  };

  input.addEventListener('input', syncClear);
  input.addEventListener('focus', syncClear);
  input.addEventListener('blur', () => {
    window.setTimeout(syncClear, 150);
  });

  clearBtn.addEventListener('click', (event) => {
    event.preventDefault();
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    syncClear();
  });

  syncClear();
}

function init() {
  initTheme();
  initTextSize();
  initCustomizationMenu();
  initMobileNavMenu();
  initShareMenu();
  initHomeHeroSearch();
}

init();

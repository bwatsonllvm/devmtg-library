const DOCUMENTATION_OPTIONS = {
    VERSION: '23.0.0git',
    LANGUAGE: 'en',
    COLLAPSE_INDEX: false,
    BUILDER: 'html',
    FILE_SUFFIX: '.html',
    LINK_SUFFIX: '.html',
    HAS_SOURCE: true,
    SOURCELINK_SUFFIX: '.txt',
    NAVIGATION_WITH_KEYS: false,
    SHOW_SEARCH_SUMMARY: true,
    ENABLE_SEARCH_SHORTCUTS: true,
};

// LLVM Library bridge: make mirrored docs inherit the main site shell and display settings.
(function () {
  document.documentElement.classList.add('library-docs-bridge');
  const DOCS_SIDEBAR_COLLAPSE_KEY = 'llvm-docs-book-sidebar-collapsed';
  const DOCS_NODE_COLLAPSE_KEY = 'llvm-docs-book-node-collapse-v1';
  const DOCS_SYNC_META_FILENAME = 'docs-sync-meta.json';
  const DOCS_REPORT_ISSUE_BASE = 'https://github.com/bwatsonllvm/library/issues/new';
  const DOCS_GITHUB_RELEASES_URL = 'https://github.com/llvm/llvm-project/releases';
  const DOCS_UNIVERSAL_SEARCH_FILENAME = 'docs-universal-search-index.js';
  const DOCS_UNIVERSAL_SEARCH_VERSION = '20260224-02';
  const DOCS_UNIVERSAL_SEARCH_MAX_SIDEBAR_RESULTS = 7;
  const DOCS_UNIVERSAL_SEARCH_MAX_PAGE_RESULTS = 80;
  const DOCS_SEARCH_STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in', 'into',
    'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'with',
  ]);
  const docsUniversalSearchLoadState = {
    state: 'idle',
    callbacks: [],
  };
  const DOCS_SEARCH_ALIASES = [
    { token: 'langref', label: 'LLVM Language Reference', slug: 'LangRef' },
    { token: 'llvm ir', label: 'LLVM Language Reference', slug: 'LangRef' },
    { token: 'jit', label: 'ORC Design and Implementation', slug: 'ORCv2' },
    { token: 'orc', label: 'ORC Design and Implementation', slug: 'ORCv2' },
    { token: 'tablegen', label: 'TableGen Overview', slug: 'TableGen/index' },
    { token: 'pass manager', label: 'Using the New Pass Manager', slug: 'NewPassManager' },
    { token: 'passes', label: 'LLVM Analysis and Transform Passes', slug: 'Passes' },
  ];
  const DOCS_SEARCH_TOKEN_SYNONYMS = {
    beginner: ['beginners', 'intro', 'introduction', 'tutorial', 'tutorials', 'getting started', 'quickstart', 'quick start', 'basics'],
    beginners: ['beginner', 'intro', 'introduction', 'tutorial', 'tutorials', 'getting started', 'quickstart', 'quick start', 'basics'],
    intro: ['introduction', 'beginner', 'tutorial', 'getting started'],
    introduction: ['intro', 'beginner', 'tutorial', 'getting started'],
    tutorial: ['tutorials', 'beginner', 'intro', 'introduction', 'getting started'],
    tutorials: ['tutorial', 'beginner', 'intro', 'introduction', 'getting started'],
    basics: ['basic', 'beginner', 'intro', 'tutorial'],
    basic: ['basics', 'beginner', 'intro', 'tutorial'],
    quickstart: ['quick start', 'getting started', 'intro'],
  };
  const DOCS_BEGINNER_INTENT_RE = /\bbeginner(?:s)?\b|\bintro(?:duction)?\b|\btutorial(?:s)?\b|\bgetting started\b|\bbasic(?:s)?\b/;
  const DOCS_BEGINNER_SIGNAL_RE = /\bbeginner(?:s)?\b|\btutorial(?:s)?\b|\bgetting started\b|\bquick\s?start\b|\bbasic(?:s)?\b/;
  const DOCS_BEGINNER_INTENT_TOKENS = new Set(['beginner', 'beginners', 'intro', 'introduction', 'tutorial', 'tutorials', 'basic', 'basics', 'quickstart']);
  const DOCS_STANDARD_SIDEBAR_GROUPS = [
    {
      id: 'documentation',
      title: 'Documentation',
      links: [
        { label: 'Getting Started/Tutorials', slug: 'GettingStartedTutorials' },
        { label: 'User Guides', slug: 'UserGuides' },
        { label: 'Reference', slug: 'Reference' },
      ],
    },
    {
      id: 'getting-involved',
      title: 'Getting Involved',
      links: [
        { label: 'Contributing to LLVM', slug: 'Contributing' },
        { label: 'Submitting Bug Reports', slug: 'HowToSubmitABug' },
        { label: 'Mailing Lists', slug: 'GettingInvolved', hash: 'mailing-lists' },
        { label: 'Discord', slug: 'GettingInvolved', hash: 'discord' },
        { label: 'Meetups and Social Events', slug: 'GettingInvolved', hash: 'meetups-and-social-events' },
      ],
    },
    {
      id: 'additional-links',
      title: 'Additional Links',
      links: [
        { label: 'FAQ', slug: 'FAQ' },
        { label: 'Glossary', slug: 'Lexicon' },
        { label: 'Publications', href: 'https://llvm.org/pubs' },
        { label: 'Github Repository', href: 'https://github.com/llvm/llvm-project/' },
      ],
    },
  ];

  function resolveRootPath() {
    const pathname = String(window.location.pathname || '/');
    const match = pathname.match(/^(.*?\/)docs(?:\/|$)/);
    if (match && match[1]) return match[1];
    return '/';
  }

  function ensureHeadTag(tagName, attrs) {
    const head = document.head || document.getElementsByTagName('head')[0];
    if (!head) return null;
    const selectorParts = [tagName];
    Object.entries(attrs).forEach(([key, value]) => {
      if (value == null || value === '') return;
      selectorParts.push(`[${key}="${String(value).replace(/"/g, '\\"')}"]`);
    });
    const selector = selectorParts.join('');
    let node = head.querySelector(selector);
    if (!node) {
      node = document.createElement(tagName);
      Object.entries(attrs).forEach(([key, value]) => {
        if (value == null || value === '') return;
        node.setAttribute(key, value);
      });
      head.appendChild(node);
    }
    return node;
  }

  function safeStorageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function safeStorageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (_) {
      // Ignore storage failures (private mode, quota, etc).
    }
  }

  function safeStorageRemove(key) {
    try {
      localStorage.removeItem(key);
    } catch (_) {
      // Ignore storage failures.
    }
  }

  function safeStorageGetObject(key) {
    const raw = safeStorageGet(key);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function safeStorageSetObject(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value || {}));
    } catch (_) {
      // Ignore storage failures.
    }
  }

  function ensureCriticalBridgeStyles() {
    const node = ensureHeadTag('style', { id: 'llvm-docs-bridge-critical' });
    if (!node) return;
    node.textContent = [
      'div.related,div.logo,div.clearer{display:none!important;}',
      '.library-docs-bridge .site-header a:visited{color:inherit!important;}',
      '.library-docs-bridge .sphinxsidebar a:visited{color:var(--color-text-muted,#6b7280)!important;}',
      '.library-docs-bridge .docs-hugo-content a:visited{color:var(--color-accent)!important;}',
      '.library-docs-bridge .docs-hugo-content h1,.library-docs-bridge .docs-hugo-content h2,.library-docs-bridge .docs-hugo-content h3,.library-docs-bridge .docs-hugo-content h4,.library-docs-bridge .docs-hugo-content h5,.library-docs-bridge .docs-hugo-content h6{color:var(--color-text,#111827)!important;background:transparent!important;border:0!important;padding:0!important;margin-left:0!important;margin-right:0!important;}',
    ].join('');
  }

  function ensureStyles(rootPath) {
    ensureCriticalBridgeStyles();
    ensureHeadTag('meta', { name: 'color-scheme', content: 'light dark' });
    ensureHeadTag('link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' });
    ensureHeadTag('link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: 'anonymous' });
    ensureHeadTag('link', {
      rel: 'stylesheet',
      href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
    });
    ensureHeadTag('link', { rel: 'stylesheet', href: `${rootPath}css/style.css?v=20260224-08` });
    ensureHeadTag('link', { rel: 'stylesheet', href: `${rootPath}css/docs-bridge.css?v=20260224-20` });
  }

  function applyStoredDisplayPreferences() {
    try {
      const storedTheme = localStorage.getItem('llvm-hub-theme-preference');
      const themePreference = (storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'system')
        ? storedTheme
        : 'system';
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      const resolvedTheme = themePreference === 'system' ? (prefersDark ? 'dark' : 'light') : themePreference;
      const storedTextSize = localStorage.getItem('llvm-hub-text-size');
      const textSize = (storedTextSize === 'small' || storedTextSize === 'large') ? storedTextSize : 'default';

      document.documentElement.setAttribute('data-theme', resolvedTheme);
      document.documentElement.setAttribute('data-theme-preference', themePreference);
      if (textSize === 'default') {
        document.documentElement.removeAttribute('data-text-size');
      } else {
        document.documentElement.setAttribute('data-text-size', textSize);
      }
      document.documentElement.style.backgroundColor = resolvedTheme === 'dark' ? '#000000' : '#f5f5f5';
    } catch (_) {
      const fallbackDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      const fallbackTheme = fallbackDark ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', fallbackTheme);
      document.documentElement.setAttribute('data-theme-preference', 'system');
      document.documentElement.style.backgroundColor = fallbackTheme === 'dark' ? '#000000' : '#f5f5f5';
    }
  }

  function buildHeader(rootPath) {
    return `
      <nav class="skip-links" aria-label="Skip links">
        <a href="#docs-content" class="skip-link">Skip to main content</a>
      </nav>
      <header class="site-header" id="llvm-docs-bridge-header">
        <a href="${rootPath}index.html" class="site-logo" aria-label="LLVM Research Library home">
          <img src="${rootPath}images/llvm-logo.png" alt="LLVM Foundation logo" class="site-logo-img">
          <span>LLVM Research Library</span>
        </a>
        <nav class="site-nav" aria-label="Main navigation">
          <a href="${rootPath}talks/" class="nav-link" aria-label="Talks"><span aria-hidden="true">Talks</span></a>
          <a href="${rootPath}talks/events.html" class="nav-link" aria-label="Events"><span aria-hidden="true">Events</span></a>
          <a href="${rootPath}papers/" class="nav-link" aria-label="Papers"><span aria-hidden="true">Papers</span></a>
          <a href="${rootPath}blogs/" class="nav-link" aria-label="Blogs"><span aria-hidden="true">Blogs</span></a>
          <a href="${rootPath}people/" class="nav-link" aria-label="People"><span aria-hidden="true">People</span></a>
          <a href="${rootPath}about/" class="nav-link" aria-label="About this site"><span aria-hidden="true">About</span></a>
          <a href="${rootPath}docs/" class="nav-link active" aria-current="page" aria-label="Documentation"><span aria-hidden="true">Docs</span></a>
          <a href="${rootPath}updates/" class="nav-link" aria-label="Update log"><span aria-hidden="true">Updates</span></a>
        </nav>
        <div class="mobile-nav-menu" id="mobile-nav-menu">
          <button class="mobile-nav-toggle" id="mobile-nav-toggle" aria-label="Open navigation menu" aria-haspopup="true" aria-expanded="false" aria-controls="mobile-nav-panel">
            Browse
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          <div class="mobile-nav-panel" id="mobile-nav-panel" hidden>
            <a href="${rootPath}talks/" class="mobile-nav-link">Talks</a>
            <a href="${rootPath}talks/events.html" class="mobile-nav-link">Events</a>
            <a href="${rootPath}papers/" class="mobile-nav-link">Papers</a>
            <a href="${rootPath}blogs/" class="mobile-nav-link">Blogs</a>
            <a href="${rootPath}people/" class="mobile-nav-link">People</a>
            <a href="${rootPath}about/" class="mobile-nav-link">About</a>
            <a href="${rootPath}docs/" class="mobile-nav-link active" aria-current="page">Docs</a>
            <a href="${rootPath}updates/" class="mobile-nav-link">Updates</a>
          </div>
        </div>
        <div class="header-right">
          <div class="share-menu" id="share-menu">
            <button class="header-action-btn share-toggle" id="share-btn" aria-label="Share this page" title="Share" aria-haspopup="true" aria-expanded="false" aria-controls="share-panel">
              Share
            </button>
            <div class="share-panel" id="share-panel" hidden>
              <button class="share-option" id="share-native-share" type="button" hidden>Share via device</button>
              <button class="share-option" id="share-copy-link" type="button">Copy link</button>
              <a class="share-option" id="share-email-link" href="#">Email</a>
              <a class="share-option" id="share-x-link" href="#" target="_blank" rel="noopener noreferrer">Share on X</a>
              <a class="share-option" id="share-linkedin-link" href="#" target="_blank" rel="noopener noreferrer">Share on LinkedIn</a>
            </div>
          </div>
          <div class="customization-menu" id="customization-menu">
            <button class="customization-toggle" id="customization-toggle" aria-label="Display settings" title="Display settings" aria-haspopup="true" aria-expanded="false" aria-controls="customization-panel">
              <svg class="icon-customize" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line>
                <line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line>
                <line x1="2" y1="14" x2="6" y2="14"></line><line x1="10" y1="8" x2="14" y2="8"></line><line x1="18" y1="16" x2="22" y2="16"></line>
              </svg>
            </button>
            <div class="customization-panel" id="customization-panel" hidden>
              <div class="customization-group">
                <label class="customization-label" for="custom-theme-select">Theme</label>
                <select class="customization-select" id="custom-theme-select" aria-label="Theme preference">
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </div>
              <div class="customization-group">
                <label class="customization-label" for="custom-text-size-select">Text Size</label>
                <select class="customization-select" id="custom-text-size-select" aria-label="Text size">
                  <option value="small">Small</option>
                  <option value="default">Default</option>
                  <option value="large">Large</option>
                </select>
              </div>
              <button class="customization-reset" id="custom-reset-display" type="button">Reset display settings</button>
            </div>
          </div>
        </div>
      </header>`;
  }

  function ensureHomeScript(rootPath) {
    const src = `${rootPath}js/home.js?v=20260222-02`;
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) return;
    const script = document.createElement('script');
    script.src = src;
    document.body.appendChild(script);
  }

  function slugToDocsHref(slug, rootPath) {
    const normalized = String(slug || '').trim();
    if (!normalized || normalized === 'index') return `${rootPath}docs/`;
    if (normalized.endsWith('/index')) return `${rootPath}docs/${normalized.slice(0, -6)}/`;
    return `${rootPath}docs/${normalized}.html`;
  }

  function resolveCurrentDocSlug(rootPath) {
    const pathname = String(window.location.pathname || '');
    const docsRoot = `${rootPath}docs`;
    if (pathname === docsRoot || pathname === `${docsRoot}/`) return 'index';
    if (!pathname.startsWith(`${docsRoot}/`)) return 'index';
    const isDirectoryPath = pathname.endsWith('/');
    let relative = pathname.slice(docsRoot.length + 1).replace(/^\/+|\/+$/g, '');
    if (!relative) return 'index';
    if (relative.endsWith('.html')) {
      relative = relative.slice(0, -5);
    } else if (isDirectoryPath && !relative.endsWith('/index')) {
      relative = `${relative}/index`;
    }
    try {
      return decodeURIComponent(relative) || 'index';
    } catch (_) {
      return relative || 'index';
    }
  }

  function resolveOriginalDocsUrl(rootPath) {
    const slug = resolveCurrentDocSlug(rootPath);
    if (!slug || slug === 'index') return 'https://llvm.org/docs/';
    if (slug.endsWith('/index')) return `https://llvm.org/docs/${slug.slice(0, -6)}/`;
    return `https://llvm.org/docs/${slug}.html`;
  }

  function formatSyncTimestamp(value) {
    const raw = String(value || '').trim();
    if (!raw) return 'Unknown';
    const asDate = new Date(raw);
    if (Number.isNaN(asDate.getTime())) return 'Unknown';
    try {
      return asDate.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      });
    } catch (_) {
      return asDate.toISOString();
    }
  }

  function getSyncStatusText() {
    const meta = window.LLVMDocsSyncMeta;
    if (!meta || typeof meta !== 'object') return 'Last synced: Unknown';
    return `Last synced: ${formatSyncTimestamp(meta.syncedAt)}`;
  }

  function refreshDocsSyncLabels() {
    const labelText = getSyncStatusText();
    const labels = document.querySelectorAll('[data-docs-sync-label]');
    labels.forEach((node) => {
      node.textContent = labelText;
    });
  }

  function buildReportIssueUrl(rootPath) {
    const pageUrl = window.location.href;
    const originalUrl = resolveOriginalDocsUrl(rootPath);
    const title = `Docs mirror issue: ${deriveFallbackTitle()}`;
    const body = [
      'Please describe the issue you found in the mirrored docs experience.',
      '',
      `Mirror page: ${pageUrl}`,
      `Original page: ${originalUrl}`,
      '',
      'What happened:',
      '',
      'What you expected:',
      '',
      'Any reproduction steps:',
      '',
    ].join('\n');
    return `${DOCS_REPORT_ISSUE_BASE}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  }

  function buildDocsTrustStrip(rootPath) {
    const strip = document.createElement('aside');
    strip.className = 'docs-trust-strip';
    strip.setAttribute('role', 'note');
    strip.setAttribute('aria-label', 'Docs mirror status');

    const badge = document.createElement('span');
    badge.className = 'docs-trust-badge';
    badge.textContent = 'Mirrored from llvm.org/docs';
    strip.appendChild(badge);

    const sourceLink = document.createElement('a');
    sourceLink.className = 'docs-trust-link';
    sourceLink.href = 'https://llvm.org/docs/';
    sourceLink.target = '_blank';
    sourceLink.rel = 'noopener noreferrer';
    sourceLink.textContent = 'Source';
    strip.appendChild(sourceLink);

    const originalLink = document.createElement('a');
    originalLink.className = 'docs-trust-link';
    originalLink.href = resolveOriginalDocsUrl(rootPath);
    originalLink.target = '_blank';
    originalLink.rel = 'noopener noreferrer';
    originalLink.textContent = 'View original';
    strip.appendChild(originalLink);

    const issueLink = document.createElement('a');
    issueLink.className = 'docs-trust-link';
    issueLink.href = buildReportIssueUrl(rootPath);
    issueLink.target = '_blank';
    issueLink.rel = 'noopener noreferrer';
    issueLink.textContent = 'Report issue';
    strip.appendChild(issueLink);

    const syncLabel = document.createElement('span');
    syncLabel.className = 'docs-sync-status';
    syncLabel.setAttribute('data-docs-sync-label', '1');
    syncLabel.textContent = getSyncStatusText();
    strip.appendChild(syncLabel);

    return strip;
  }

  function ensureSyncMetaData(rootPath, onReady) {
    if (window.LLVMDocsSyncMeta && typeof window.LLVMDocsSyncMeta === 'object') {
      onReady();
      return;
    }
    const metaUrl = `${rootPath}docs/_static/${DOCS_SYNC_META_FILENAME}`;
    if (!window.fetch) {
      onReady();
      return;
    }
    window.fetch(metaUrl, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) return null;
        return response.json();
      })
      .then((payload) => {
        if (payload && typeof payload === 'object') {
          window.LLVMDocsSyncMeta = payload;
        }
      })
      .catch(() => {
        // Keep default unknown-sync status if metadata fetch fails.
      })
      .finally(onReady);
  }

  function isEditableTarget(node) {
    const el = node && node.nodeType === 1 ? node : null;
    if (!el) return false;
    const tag = String(el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || !!el.isContentEditable;
  }

  function focusPreferredSearchInput() {
    const selector = [
      '.sphinxsidebar input[name="q"]',
      '.document .body form input[name="q"]',
      'input[name="q"]',
    ].join(',');
    const input = document.querySelector(selector);
    if (!input) return false;
    input.focus();
    if (typeof input.select === 'function') input.select();
    return true;
  }

  function initSearchShortcut() {
    if (!document.body || document.body.dataset.docsSearchShortcutInit === '1') return;
    document.body.dataset.docsSearchShortcutInit = '1';
    document.addEventListener('keydown', function (event) {
      if (event.defaultPrevented || event.key !== '/') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      if (!focusPreferredSearchInput()) return;
      event.preventDefault();
    });
  }

  function nodeContainsSlug(node, slug) {
    if (!node || !slug) return false;
    if (node.slug === slug) return true;
    const children = Array.isArray(node.children) ? node.children : [];
    return children.some((child) => nodeContainsSlug(child, slug));
  }

  function getSidebarCollapsedPreference() {
    return safeStorageGet(DOCS_SIDEBAR_COLLAPSE_KEY) === '1';
  }

  function setSidebarCollapsedPreference(collapsed) {
    if (collapsed) safeStorageSet(DOCS_SIDEBAR_COLLAPSE_KEY, '1');
    else safeStorageRemove(DOCS_SIDEBAR_COLLAPSE_KEY);
  }

  function getStoredNodeCollapseState(nodeId) {
    const key = String(nodeId || '').trim();
    if (!key) return null;
    const store = safeStorageGetObject(DOCS_NODE_COLLAPSE_KEY);
    if (!Object.prototype.hasOwnProperty.call(store, key)) return null;
    return store[key] ? true : false;
  }

  function setStoredNodeCollapseState(nodeId, collapsed) {
    const key = String(nodeId || '').trim();
    if (!key) return;
    const store = safeStorageGetObject(DOCS_NODE_COLLAPSE_KEY);
    store[key] = collapsed ? 1 : 0;
    safeStorageSetObject(DOCS_NODE_COLLAPSE_KEY, store);
  }

  function isMobileSidebarLayout() {
    return !!(window.matchMedia && window.matchMedia('(max-width: 1024px)').matches);
  }

  function applySidebarCollapsedState(collapsed, persist) {
    const shouldCollapse = !isMobileSidebarLayout() && !!collapsed;
    if (document.body) {
      document.body.classList.toggle('docs-book-sidebar-collapsed', shouldCollapse);
    }

    const toggle = document.getElementById('docs-book-sidebar-toggle');
    if (toggle) {
      toggle.setAttribute('aria-pressed', shouldCollapse ? 'true' : 'false');
      toggle.setAttribute('aria-label', shouldCollapse ? 'Expand sidebar' : 'Collapse sidebar');
      toggle.title = shouldCollapse ? 'Expand sidebar' : 'Collapse sidebar';
    }

    if (persist) {
      setSidebarCollapsedPreference(!!collapsed);
    }
  }

  function initSidebarCollapseControl() {
    if (!document.body) return;
    if (document.body.dataset.docsSidebarCollapseInit === '1') {
      applySidebarCollapsedState(getSidebarCollapsedPreference(), false);
      return;
    }

    const toggle = document.getElementById('docs-book-sidebar-toggle');
    if (!toggle) return;
    document.body.dataset.docsSidebarCollapseInit = '1';

    applySidebarCollapsedState(getSidebarCollapsedPreference(), false);

    toggle.addEventListener('click', function () {
      const next = !document.body.classList.contains('docs-book-sidebar-collapsed');
      applySidebarCollapsedState(next, true);
    });

    if (window.matchMedia) {
      const mq = window.matchMedia('(max-width: 1024px)');
      const onChange = function () {
        applySidebarCollapsedState(getSidebarCollapsedPreference(), false);
      };
      if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
      else if (typeof mq.addListener === 'function') mq.addListener(onChange);
    }
  }

  function buildDisclosureChevron() {
    return `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    `;
  }

  function buildOpenDocIcon() {
    return `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M14 5h5v5"></path>
        <path d="M10 14L19 5"></path>
        <path d="M19 14v5h-5"></path>
        <path d="M5 10V5h5"></path>
      </svg>
    `;
  }

  function setNodeToggleState(toggle, expanded, label) {
    if (!toggle) return;
    const isExpanded = !!expanded;
    toggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    toggle.setAttribute('aria-label', `${isExpanded ? 'Collapse' : 'Expand'} ${label}`);
    toggle.title = `${isExpanded ? 'Collapse' : 'Expand'} ${label}`;
  }

  function buildSidebarRelationBar(rootPath) {
    const relationBar = document.createElement('nav');
    relationBar.className = 'docs-book-relbar';
    relationBar.setAttribute('aria-label', 'Document relation links');

    const links = [
      { text: 'index', href: (document.querySelector('link[rel="index"]') || {}).href || `${rootPath}docs/genindex.html` },
      { text: 'previous', href: (document.querySelector('link[rel="prev"]') || {}).href || '' },
      { text: 'next', href: (document.querySelector('link[rel="next"]') || {}).href || '' },
    ];

    links.forEach((entry, idx) => {
      if (idx > 0) {
        const sep = document.createElement('span');
        sep.className = 'docs-book-rel-sep';
        sep.setAttribute('aria-hidden', 'true');
        sep.textContent = '|';
        relationBar.appendChild(sep);
      }

      if (entry.href) {
        const link = document.createElement('a');
        link.className = 'docs-book-rel-link';
        link.href = entry.href;
        link.textContent = entry.text;
        relationBar.appendChild(link);
      } else {
        const text = document.createElement('span');
        text.className = 'docs-book-rel-text is-disabled';
        text.textContent = entry.text;
        relationBar.appendChild(text);
      }
    });

    return relationBar;
  }

  function normalizeReleaseVersionValue(raw) {
    const source = String(raw || '').trim();
    if (!source) return '';
    let value = source.replace(/^llvmorg-/i, '');
    value = value.replace(/^LLVM\s+/i, '');
    return value.trim();
  }

  function getLatestReleaseModel(rootPath) {
    const metaRoot = (window.LLVMDocsSyncMeta && typeof window.LLVMDocsSyncMeta === 'object')
      ? window.LLVMDocsSyncMeta
      : null;
    const latestRelease = (metaRoot && metaRoot.latestRelease && typeof metaRoot.latestRelease === 'object')
      ? metaRoot.latestRelease
      : null;

    const fromMeta = latestRelease
      ? (latestRelease.version || latestRelease.name || latestRelease.tag || '')
      : '';
    const fromDocs = (typeof DOCUMENTATION_OPTIONS === 'object' && DOCUMENTATION_OPTIONS && DOCUMENTATION_OPTIONS.VERSION)
      ? DOCUMENTATION_OPTIONS.VERSION
      : '';

    const normalizedVersion = normalizeReleaseVersionValue(fromMeta)
      || normalizeReleaseVersionValue(fromDocs)
      || 'Unknown';

    const githubHref = latestRelease && String(latestRelease.githubUrl || '').trim()
      ? String(latestRelease.githubUrl).trim()
      : DOCS_GITHUB_RELEASES_URL;

    return {
      versionLabel: `Latest release: LLVM ${normalizedVersion}`,
      releaseNotesHref: slugToDocsHref('ReleaseNotes', rootPath),
      githubHref,
    };
  }

  function buildSidebarReleasePanel(rootPath) {
    const release = getLatestReleaseModel(rootPath);

    const panel = document.createElement('section');
    panel.className = 'docs-book-release';
    panel.setAttribute('aria-label', 'LLVM release and downloads');

    const title = document.createElement('h3');
    title.className = 'docs-book-release-title';
    title.textContent = 'Release';
    panel.appendChild(title);

    const version = document.createElement('p');
    version.className = 'docs-release-version';
    version.textContent = release.versionLabel;
    panel.appendChild(version);

    const links = document.createElement('div');
    links.className = 'docs-release-links';

    const notes = document.createElement('a');
    notes.className = 'docs-release-link';
    notes.href = release.releaseNotesHref;
    notes.textContent = 'Latest release notes';
    links.appendChild(notes);

    const download = document.createElement('a');
    download.className = 'docs-release-link';
    download.href = release.githubHref;
    download.target = '_blank';
    download.rel = 'noopener noreferrer';
    download.textContent = 'Download via GitHub';
    links.appendChild(download);

    panel.appendChild(links);
    return panel;
  }

  function refreshSidebarReleasePanel(rootPath) {
    const existing = document.querySelector('.sphinxsidebarwrapper .docs-book-release');
    if (!existing) return;
    const next = buildSidebarReleasePanel(rootPath);
    if (existing && existing.parentNode) {
      existing.parentNode.replaceChild(next, existing);
    }
  }

  function resolveSidebarGroupHref(link, rootPath) {
    if (!link || typeof link !== 'object') return `${rootPath}docs/`;
    const directHref = String(link.href || '').trim();
    if (directHref) return directHref;
    const slug = String(link.slug || '').trim();
    const base = slug ? slugToDocsHref(slug, rootPath) : `${rootPath}docs/`;
    const hash = String(link.hash || '').trim();
    if (!hash) return base;
    return `${base}#${hash}`;
  }

  function buildStandardSidebarGroups(rootPath) {
    const container = document.createElement('section');
    container.className = 'docs-standard-groups';
    container.setAttribute('aria-label', 'Standard LLVM docs links');

    DOCS_STANDARD_SIDEBAR_GROUPS.forEach((group) => {
      const stateId = `sidebar-group-${String(group.id || '').trim()}`;
      const storedCollapsed = getStoredNodeCollapseState(stateId);
      const expanded = storedCollapsed === null ? false : !storedCollapsed;

      const section = document.createElement('section');
      section.className = 'docs-book-chapter docs-standard-group';
      if (!expanded) section.classList.add('is-collapsed');

      const head = document.createElement('div');
      head.className = 'docs-book-chapter-head';
      head.setAttribute('role', 'button');
      head.setAttribute('tabindex', '0');

      const toggle = document.createElement('button');
      toggle.className = 'docs-book-chapter-toggle';
      toggle.type = 'button';
      toggle.innerHTML = buildDisclosureChevron();
      const bodyId = `docs-standard-group-${String(group.id || '').trim()}`;
      toggle.setAttribute('aria-controls', bodyId);
      setNodeToggleState(toggle, expanded, String(group.title || 'Section'));
      head.appendChild(toggle);
      head.setAttribute('aria-controls', bodyId);
      head.setAttribute('aria-expanded', expanded ? 'true' : 'false');

      const title = document.createElement('h4');
      title.className = 'docs-book-chapter-title';
      title.textContent = String(group.title || 'Section');
      head.appendChild(title);
      section.appendChild(head);

      const body = document.createElement('div');
      body.className = 'docs-book-chapter-body';
      body.id = bodyId;
      body.hidden = !expanded;

      const list = document.createElement('ul');
      list.className = 'docs-standard-link-list';
      const links = Array.isArray(group.links) ? group.links : [];
      links.forEach((entry) => {
        const li = document.createElement('li');
        li.className = 'docs-standard-link-item';

        const link = document.createElement('a');
        link.className = 'docs-standard-link';
        link.href = resolveSidebarGroupHref(entry, rootPath);
        link.textContent = String(entry.label || 'Untitled');
        li.appendChild(link);
        list.appendChild(li);
      });
      body.appendChild(list);
      section.appendChild(body);

      const toggleGroup = function () {
        const collapsed = section.classList.toggle('is-collapsed');
        body.hidden = collapsed;
        setStoredNodeCollapseState(stateId, collapsed);
        setNodeToggleState(toggle, !collapsed, String(group.title || 'Section'));
        head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      };

      toggle.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        toggleGroup();
      });

      head.addEventListener('click', function (event) {
        if (event.target && event.target.closest('.docs-book-chapter-toggle')) return;
        toggleGroup();
      });

      head.addEventListener('keydown', function (event) {
        if (event.target && event.target.closest('.docs-book-chapter-toggle')) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggleGroup();
      });

      container.appendChild(section);
    });

    return container;
  }

  function normalizeSearchInputPresentation(scope) {
    const root = scope && scope.querySelector ? scope : document;
    const labels = root.querySelectorAll('#searchlabel');
    labels.forEach((label) => {
      if (label && label.parentNode) {
        label.parentNode.removeChild(label);
      }
    });

    const searchInputs = root.querySelectorAll('input[name="q"], input[type="search"]');
    searchInputs.forEach((input) => {
      input.setAttribute('placeholder', 'Search docs...');
      input.removeAttribute('aria-labelledby');
      input.setAttribute('aria-label', 'Search docs');
    });
  }

  function buildSidebarSearchBox(rootPath) {
    const box = document.createElement('div');
    box.id = 'searchbox';
    box.setAttribute('role', 'search');

    const formWrap = document.createElement('div');
    formWrap.className = 'searchformwrapper';

    const form = document.createElement('form');
    form.className = 'search';
    form.action = buildDocsSearchUrl(rootPath, '');
    form.method = 'get';

    const input = document.createElement('input');
    input.type = 'text';
    input.name = 'q';
    input.autocomplete = 'off';
    input.autocorrect = 'off';
    input.autocapitalize = 'off';
    input.spellcheck = false;

    const submit = document.createElement('input');
    submit.type = 'submit';
    submit.value = 'Go';

    form.appendChild(input);
    form.appendChild(submit);
    formWrap.appendChild(form);
    box.appendChild(formWrap);

    normalizeSearchInputPresentation(box);
    return box;
  }

  function buildSearchAliasPanel(rootPath, searchInput) {
    const panel = document.createElement('div');
    panel.className = 'docs-search-alias-panel';

    const title = document.createElement('span');
    title.className = 'docs-search-alias-title';
    title.textContent = 'Helpful aliases';
    panel.appendChild(title);

    const unique = new Set();
    DOCS_SEARCH_ALIASES.forEach((alias) => {
      const key = `${alias.label}|${alias.slug}`;
      if (unique.has(key)) return;
      unique.add(key);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'docs-search-alias-chip';
      btn.textContent = alias.token;
      btn.setAttribute('aria-label', `Search docs for ${alias.token}`);
      btn.addEventListener('click', function () {
        if (searchInput) {
          searchInput.value = alias.token;
          searchInput.focus();
        }
        const href = slugToDocsHref(alias.slug, rootPath);
        window.location.assign(href);
      });
      panel.appendChild(btn);
    });

    return panel;
  }

  function resolveNoResultsSuggestions(query) {
    const text = String(query || '').toLowerCase();
    const matches = DOCS_SEARCH_ALIASES.filter((entry) => text.includes(entry.token)).slice(0, 3);
    if (matches.length) return matches;
    return DOCS_SEARCH_ALIASES.slice(0, 3);
  }

  function flushUniversalSearchCallbacks(success) {
    const callbacks = docsUniversalSearchLoadState.callbacks.slice();
    docsUniversalSearchLoadState.callbacks = [];
    callbacks.forEach((callback) => {
      try {
        callback(!!success);
      } catch (_) {
        // Avoid callback failures breaking search setup.
      }
    });
  }

  function buildDocsSearchUrl(rootPath, query) {
    const base = `${rootPath}docs/search.html`;
    const value = String(query || '').trim();
    if (!value) return base;
    return `${base}?q=${encodeURIComponent(value)}`;
  }

  function getUniversalSearchPayload() {
    const payload = window.LLVMDocsUniversalSearchIndex;
    if (!payload || typeof payload !== 'object') return null;
    if (!Array.isArray(payload.entries)) return null;
    return payload;
  }

  function ensureUniversalSearchIndexData(rootPath, onReady) {
    if (typeof onReady !== 'function') return;
    const payload = getUniversalSearchPayload();
    if (payload) {
      onReady(true);
      return;
    }

    if (docsUniversalSearchLoadState.state === 'failed') {
      onReady(false);
      return;
    }

    docsUniversalSearchLoadState.callbacks.push(onReady);
    if (docsUniversalSearchLoadState.state === 'loading') {
      return;
    }

    docsUniversalSearchLoadState.state = 'loading';
    const scriptId = 'llvm-docs-universal-search-index-script';
    let script = document.getElementById(scriptId);
    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = `${rootPath}docs/_static/${DOCS_UNIVERSAL_SEARCH_FILENAME}?v=${DOCS_UNIVERSAL_SEARCH_VERSION}`;
      script.async = true;
      script.addEventListener('load', function () {
        docsUniversalSearchLoadState.state = getUniversalSearchPayload() ? 'ready' : 'failed';
        flushUniversalSearchCallbacks(docsUniversalSearchLoadState.state === 'ready');
      }, { once: true });
      script.addEventListener('error', function () {
        docsUniversalSearchLoadState.state = 'failed';
        flushUniversalSearchCallbacks(false);
      }, { once: true });
      document.head.appendChild(script);
      return;
    }

    script.addEventListener('load', function () {
      docsUniversalSearchLoadState.state = getUniversalSearchPayload() ? 'ready' : 'failed';
      flushUniversalSearchCallbacks(docsUniversalSearchLoadState.state === 'ready');
    }, { once: true });
    script.addEventListener('error', function () {
      docsUniversalSearchLoadState.state = 'failed';
      flushUniversalSearchCallbacks(false);
    }, { once: true });
  }

  function normalizeUniversalSearchQuery(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeUniversalSearchText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9+#.]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeUniversalSearchToken(value) {
    return normalizeUniversalSearchText(value).replace(/\s+/g, '');
  }

  function stemUniversalSearchToken(token) {
    const value = normalizeUniversalSearchToken(token);
    if (value.length <= 3) return value;
    if (value.endsWith('ies') && value.length > 4) return `${value.slice(0, -3)}y`;
    if (value.endsWith('ing') && value.length > 5) return value.slice(0, -3);
    if (value.endsWith('ed') && value.length > 4) return value.slice(0, -2);
    if (value.endsWith('es') && value.length > 4) return value.slice(0, -2);
    if (value.endsWith('s') && value.length > 3 && !value.endsWith('ss')) return value.slice(0, -1);
    return value;
  }

  function tokenizeUniversalSearchQuery(value) {
    const normalized = normalizeUniversalSearchQuery(value);
    if (!normalized) return [];
    const tokens = [];
    const seen = new Set();
    const re = /"([^"]+)"|(\S+)/g;
    let match;
    while ((match = re.exec(normalized)) !== null) {
      const raw = match[1] || match[2] || '';
      const token = normalizeUniversalSearchToken(raw);
      if (token.length < 2 || DOCS_SEARCH_STOP_WORDS.has(token) || seen.has(token)) continue;
      seen.add(token);
      tokens.push(token);
      if (tokens.length >= 12) break;
    }
    return tokens;
  }

  function buildUniversalSearchClauses(tokens) {
    const source = Array.isArray(tokens) ? tokens : [];
    const clauses = [];
    source.forEach((token) => {
      const baseToken = normalizeUniversalSearchToken(token);
      if (!baseToken || baseToken.length < 2) return;
      const variantMap = new Map();
      const addVariant = function (term, weight) {
        const normalized = normalizeUniversalSearchText(term);
        if (!normalized) return;
        const compact = normalized.replace(/\s+/g, '');
        if (compact.length < 2) return;
        const prev = Number(variantMap.get(normalized) || 0);
        if (weight > prev) variantMap.set(normalized, weight);
      };

      addVariant(baseToken, 1.0);
      const stem = stemUniversalSearchToken(baseToken);
      if (stem && stem !== baseToken) addVariant(stem, 0.88);

      const synonyms = DOCS_SEARCH_TOKEN_SYNONYMS[baseToken] || [];
      synonyms.forEach((synonym) => addVariant(synonym, 0.72));

      const variants = Array.from(variantMap.entries()).map(function (entry) {
        return { term: entry[0], weight: Number(entry[1] || 0) };
      });
      if (!variants.length) return;
      clauses.push({
        token: baseToken,
        variants,
        strict: DOCS_BEGINNER_INTENT_TOKENS.has(baseToken),
      });
    });
    return clauses;
  }

  function prepareUniversalSearchEntry(entry) {
    if (!entry || entry._preparedForSearch === 1) return;
    entry._preparedForSearch = 1;

    const title = String(entry.title || '');
    const slug = String(entry.slug || '');
    const headings = Array.isArray(entry.headings) ? entry.headings : [];
    const headingText = headings
      .map((item) => (item && typeof item === 'object' ? String(item.text || '') : String(item || '')))
      .join(' ');
    const summary = String(entry.summary || '');
    const search = String(entry.search || '');

    entry._titleLower = title.toLowerCase();
    entry._slugLower = slug.toLowerCase();
    entry._headingsLower = headingText.toLowerCase();
    entry._summaryLower = summary.toLowerCase();
    entry._searchLower = (search || `${title} ${headingText} ${summary}`).toLowerCase();
    entry._blobLower = normalizeUniversalSearchText([title, headingText, summary, search, slug].join(' '));
  }

  function scoreUniversalSearchEntry(entry, queryLower, queryModel) {
    prepareUniversalSearchEntry(entry);
    const title = String(entry._titleLower || '');
    const slug = String(entry._slugLower || '');
    const headings = String(entry._headingsLower || '');
    const summary = String(entry._summaryLower || '');
    const search = String(entry._searchLower || '');
    const blob = String(entry._blobLower || '');
    if (!title && !search && !slug && !blob) return null;

    const model = queryModel && typeof queryModel === 'object' ? queryModel : {};
    const clauses = Array.isArray(model.clauses) ? model.clauses : [];
    const beginnerIntent = model.beginnerIntent === true;

    let score = 0;

    if (queryLower) {
      if (title === queryLower) score += 260;
      else if (title.startsWith(`${queryLower} `) || title.startsWith(queryLower)) score += 172;
      else if (title.includes(queryLower)) score += 128;

      if (headings.includes(queryLower)) score += 98;
      if (summary.includes(queryLower)) score += 72;
      if (slug === queryLower) score += 58;
      else if (slug.includes(queryLower)) score += 36;
      if (search.includes(queryLower)) score += 28;
    }

    let matchedTokens = 0;
    clauses.forEach((clause) => {
      let bestClauseScore = 0;
      (Array.isArray(clause.variants) ? clause.variants : []).forEach((variant) => {
        const term = normalizeUniversalSearchText(variant && variant.term);
        const weight = Number(variant && variant.weight || 0);
        if (!term || weight <= 0) return;
        let tokenScore = 0;
        if (title.includes(term)) tokenScore = Math.max(tokenScore, 56 * weight);
        if (headings.includes(term)) tokenScore = Math.max(tokenScore, 34 * weight);
        if (summary.includes(term)) tokenScore = Math.max(tokenScore, 22 * weight);
        if (slug.includes(term)) tokenScore = Math.max(tokenScore, 16 * weight);
        if (!(clause && clause.strict) && search.includes(term)) tokenScore = Math.max(tokenScore, 12 * weight);
        if (tokenScore > bestClauseScore) bestClauseScore = tokenScore;
      });
      if (bestClauseScore > 0) matchedTokens += 1;
      score += bestClauseScore;
    });

    const tokenCount = clauses.length;
    const coverage = tokenCount > 0 ? matchedTokens / tokenCount : (score > 0 ? 1 : 0);

    if (tokenCount >= 3 && coverage < 0.55) return null;
    if (tokenCount <= 2 && tokenCount > 0 && coverage < 1) return null;
    if (tokenCount > 0) {
      score += Math.round(coverage * 76);
      if (matchedTokens === tokenCount) score += 44;
    }

    if (beginnerIntent) {
      const beginnerSignal = DOCS_BEGINNER_SIGNAL_RE.test(blob);
      if (!beginnerSignal && tokenCount >= 2) return null;
      if (beginnerSignal) score += 30;
    }

    if (score <= 0) return null;
    return { score, coverage, matchedTokens };
  }

  function runUniversalDocsSearch(query, limit) {
    const payload = getUniversalSearchPayload();
    if (!payload) return [];

    const normalized = normalizeUniversalSearchQuery(query);
    if (!normalized) return [];
    const queryLower = normalizeUniversalSearchText(normalized);
    const tokens = tokenizeUniversalSearchQuery(normalized);
    const queryModel = {
      tokens,
      clauses: buildUniversalSearchClauses(tokens),
      beginnerIntent: DOCS_BEGINNER_INTENT_RE.test(queryLower),
    };

    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    const ranked = [];
    entries.forEach((entry, index) => {
      const rank = scoreUniversalSearchEntry(entry, queryLower, queryModel);
      if (!rank) return;
      ranked.push({
        entry,
        score: rank.score,
        coverage: rank.coverage,
        matchedTokens: rank.matchedTokens,
        index,
      });
    });

    ranked.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.coverage !== a.coverage) return b.coverage - a.coverage;
      if (b.matchedTokens !== a.matchedTokens) return b.matchedTokens - a.matchedTokens;
      return a.index - b.index;
    });

    let cap = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 12;
    if (queryModel.beginnerIntent) {
      cap = Math.min(cap, 36);
    }
    if (!ranked.length) return [];

    const clauseCount = queryModel.clauses.length;
    let relativeFloor = clauseCount <= 1 ? 0.2 : (clauseCount === 2 ? 0.36 : 0.24);
    let absoluteFloor = clauseCount <= 1 ? 8 : (clauseCount === 2 ? 13 : 9);
    if (queryModel.beginnerIntent) {
      relativeFloor = Math.max(relativeFloor, clauseCount <= 2 ? 0.9 : 0.72);
      absoluteFloor = Math.max(absoluteFloor, clauseCount <= 2 ? 24 : 18);
    }

    const topScore = Number(ranked[0].score || 0);
    const minScore = Math.max(absoluteFloor, topScore * relativeFloor);
    const filtered = ranked.filter((item) => Number(item.score || 0) >= minScore);
    const finalRanked = filtered.length ? filtered : ranked.slice(0, Math.min(cap, 10));
    return finalRanked.slice(0, cap);
  }

  function truncateSnippetText(value, maxChars) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= maxChars) return text;
    const clipped = text.slice(0, maxChars).trim();
    const safe = clipped.lastIndexOf(' ');
    if (safe > 48) {
      return `${clipped.slice(0, safe)}...`;
    }
    return `${clipped}...`;
  }

  function buildUniversalResultSnippet(entry, query) {
    const text = String(entry.search || entry.summary || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const lowered = text.toLowerCase();
    const queryLower = normalizeUniversalSearchQuery(query).toLowerCase();
    const tokens = tokenizeUniversalSearchQuery(query);

    let matchAt = queryLower ? lowered.indexOf(queryLower) : -1;
    if (matchAt < 0) {
      for (let idx = 0; idx < tokens.length; idx += 1) {
        matchAt = lowered.indexOf(tokens[idx]);
        if (matchAt >= 0) break;
      }
    }

    if (matchAt < 0) {
      return truncateSnippetText(text, 170);
    }

    const radius = 86;
    const start = Math.max(0, matchAt - radius);
    const end = Math.min(text.length, start + 180);
    let snippet = text.slice(start, end).trim();
    if (start > 0) snippet = `...${snippet}`;
    if (end < text.length) snippet = `${snippet}...`;
    return snippet;
  }

  function buildUniversalResultContext(entry) {
    const parts = [];
    const outline = String(entry.outline || '').trim();
    const chapter = String(entry.chapter || '').trim();
    const slug = String(entry.slug || '').trim();
    if (outline) parts.push(outline);
    if (chapter) parts.push(chapter);
    if (slug) parts.push(slug === 'index' ? 'docs/' : slug);
    return parts.join(' | ');
  }

  function buildUniversalResultHref(entry, rootPath) {
    if (!entry || typeof entry !== 'object') return `${rootPath}docs/`;
    const direct = String(entry.href || '').trim();
    if (direct) {
      if (/^https?:\/\//i.test(direct)) return direct;
      if (direct.startsWith('/')) return direct;
      return `${rootPath}docs/${direct}`.replace(/([^:]\/)\/+/g, '$1');
    }
    return slugToDocsHref(entry.slug, rootPath);
  }

  function renderUniversalSearchResultList(targetList, results, rootPath, query, mode) {
    if (!targetList) return;
    targetList.innerHTML = '';
    const compact = mode === 'sidebar';
    results.forEach((result) => {
      const entry = result && result.entry ? result.entry : null;
      if (!entry) return;

      const item = document.createElement('li');
      item.className = compact ? 'docs-universal-search-item is-compact' : 'docs-universal-search-item';

      const link = document.createElement('a');
      link.className = 'docs-universal-search-result';
      link.href = buildUniversalResultHref(entry, rootPath);

      const title = document.createElement('span');
      title.className = 'docs-universal-search-result-title';
      title.textContent = String(entry.title || 'Untitled');
      link.appendChild(title);

      const contextText = buildUniversalResultContext(entry);
      if (contextText) {
        const context = document.createElement('span');
        context.className = 'docs-universal-search-result-context';
        context.textContent = contextText;
        link.appendChild(context);
      }

      const snippetText = buildUniversalResultSnippet(entry, query);
      if (snippetText) {
        const snippet = document.createElement('span');
        snippet.className = 'docs-universal-search-result-snippet';
        snippet.textContent = snippetText;
        link.appendChild(snippet);
      }

      item.appendChild(link);
      targetList.appendChild(item);
    });
  }

  function buildUniversalSearchNoResultsPanel(rootPath, query) {
    const panel = document.createElement('aside');
    panel.className = 'docs-search-no-results';
    panel.hidden = true;

    const text = document.createElement('p');
    text.className = 'docs-search-no-results-text';
    text.textContent = 'No direct match yet. Try one of these canonical docs:';
    panel.appendChild(text);

    const links = document.createElement('div');
    links.className = 'docs-search-no-results-links';
    panel.appendChild(links);

    const suggestions = resolveNoResultsSuggestions(query);
    suggestions.forEach((entry) => {
      const link = document.createElement('a');
      link.className = 'docs-search-no-results-link';
      link.href = slugToDocsHref(entry.slug, rootPath);
      link.textContent = entry.label;
      links.appendChild(link);
    });

    return panel;
  }

  function initSidebarUniversalSearchForm(rootPath, searchForm) {
    if (!searchForm || searchForm.dataset.docsUniversalSidebarInit === '1') return;
    const searchInput = searchForm.querySelector('input[name="q"]');
    if (!searchInput) return;
    searchForm.dataset.docsUniversalSidebarInit = '1';

    const host = searchForm.closest('.searchformwrapper') || searchForm.parentElement || searchForm;
    const panel = document.createElement('div');
    panel.className = 'docs-universal-search-dropdown';
    panel.hidden = true;

    const status = document.createElement('p');
    status.className = 'docs-universal-search-dropdown-status';
    panel.appendChild(status);

    const list = document.createElement('ol');
    list.className = 'docs-universal-search-dropdown-list';
    panel.appendChild(list);

    const moreLink = document.createElement('a');
    moreLink.className = 'docs-universal-search-dropdown-more';
    moreLink.href = buildDocsSearchUrl(rootPath, '');
    moreLink.textContent = 'View full search results';
    panel.appendChild(moreLink);

    host.appendChild(panel);

    let debounceTimer = 0;
    let requestId = 0;

    const closePanel = function () {
      panel.hidden = true;
      status.textContent = '';
      list.innerHTML = '';
      moreLink.hidden = true;
    };

    const renderForQuery = function () {
      const query = normalizeUniversalSearchQuery(searchInput.value);
      if (query.length < 2) {
        closePanel();
        return;
      }

      const localRequestId = requestId + 1;
      requestId = localRequestId;
      panel.hidden = false;
      moreLink.hidden = false;
      moreLink.href = buildDocsSearchUrl(rootPath, query);
      moreLink.textContent = `View all results for \"${query}\"`;
      status.textContent = 'Searching docs index...';
      list.innerHTML = '';

      ensureUniversalSearchIndexData(rootPath, function (ok) {
        if (localRequestId !== requestId) return;
        if (!ok) {
          status.textContent = 'Universal index unavailable. Press Enter for docs search.';
          return;
        }
        const results = runUniversalDocsSearch(query, DOCS_UNIVERSAL_SEARCH_MAX_SIDEBAR_RESULTS);
        if (!results.length) {
          status.textContent = 'No quick matches. Press Enter for full docs search.';
          return;
        }
        status.textContent = `${results.length} quick result${results.length === 1 ? '' : 's'}`;
        renderUniversalSearchResultList(list, results, rootPath, query, 'sidebar');
      });
    };

    const scheduleRender = function () {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(renderForQuery, 110);
    };

    searchInput.addEventListener('focus', function () {
      ensureUniversalSearchIndexData(rootPath, function () {});
      if (normalizeUniversalSearchQuery(searchInput.value).length >= 2) {
        scheduleRender();
      }
    });
    searchInput.addEventListener('input', scheduleRender);
    searchInput.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closePanel();
    });

    document.addEventListener('pointerdown', function (event) {
      if (!host.contains(event.target)) closePanel();
    });

    searchForm.addEventListener('submit', function (event) {
      const query = normalizeUniversalSearchQuery(searchInput.value);
      if (!query) return;
      event.preventDefault();
      window.location.assign(buildDocsSearchUrl(rootPath, query));
    });
  }

  function initSearchPageUniversalResults(rootPath, searchForm, searchInput) {
    if (!searchForm || !searchInput || searchForm.dataset.docsUniversalPageInit === '1') return;
    const resultsRoot = document.getElementById('search-results');
    if (!resultsRoot || !resultsRoot.parentElement) return;
    const resultsHost = resultsRoot.parentElement;
    searchForm.dataset.docsUniversalPageInit = '1';

    const sphinxDetails = document.createElement('details');
    sphinxDetails.className = 'docs-sphinx-results-toggle';
    sphinxDetails.open = false;

    const sphinxSummary = document.createElement('summary');
    sphinxSummary.className = 'docs-sphinx-results-toggle-summary';
    sphinxSummary.textContent = 'Show exhaustive Sphinx matches';
    sphinxDetails.appendChild(sphinxSummary);

    resultsHost.insertBefore(sphinxDetails, resultsRoot);
    sphinxDetails.appendChild(resultsRoot);

    const panel = document.createElement('section');
    panel.className = 'docs-universal-search-page';

    const status = document.createElement('p');
    status.className = 'docs-universal-search-page-status';
    panel.appendChild(status);

    const list = document.createElement('ol');
    list.className = 'docs-universal-search-page-list';
    panel.appendChild(list);

    let noResultsPanel = null;
    const setNoResultsPanel = function (query) {
      if (noResultsPanel && noResultsPanel.parentNode) {
        noResultsPanel.parentNode.removeChild(noResultsPanel);
      }
      noResultsPanel = buildUniversalSearchNoResultsPanel(rootPath, query);
      noResultsPanel.hidden = false;
      panel.appendChild(noResultsPanel);
    };

    resultsHost.insertBefore(panel, sphinxDetails);

    const syncUrl = function (query, mode) {
      if (!window.history || !window.history.pushState) return;
      const nextUrl = buildDocsSearchUrl(rootPath, query);
      const current = `${window.location.pathname}${window.location.search}`;
      if (current === nextUrl) return;
      try {
        if (mode === 'push') window.history.pushState({}, '', nextUrl);
        else if (mode === 'replace') window.history.replaceState({}, '', nextUrl);
      } catch (_) {
        // Ignore URL sync failures (restricted browser environments).
      }
    };

    const syncSphinxToggleLabel = function (query) {
      if (!sphinxSummary) return;
      const value = normalizeUniversalSearchQuery(query);
      if (!value) {
        sphinxSummary.textContent = 'Show exhaustive Sphinx matches';
        return;
      }
      sphinxSummary.textContent = `Show exhaustive Sphinx matches for "${value}"`;
    };

    let pendingToken = 0;
    const renderQuery = function (rawQuery, urlMode) {
      const query = normalizeUniversalSearchQuery(rawQuery);
      if (urlMode) syncUrl(query, urlMode);
      syncSphinxToggleLabel(query);
      if (noResultsPanel && noResultsPanel.parentNode) {
        noResultsPanel.parentNode.removeChild(noResultsPanel);
        noResultsPanel = null;
      }

      if (!query) {
        status.textContent = 'Quick results appear here as you type. Full Sphinx results are shown below.';
        list.innerHTML = '';
        sphinxDetails.open = false;
        return;
      }

      const token = pendingToken + 1;
      pendingToken = token;
      status.textContent = 'Searching docs index...';
      list.innerHTML = '';

      ensureUniversalSearchIndexData(rootPath, function (ok) {
        if (token !== pendingToken) return;
        if (!ok) {
          status.textContent = 'Quick index unavailable. Full Sphinx search results are shown below.';
          setNoResultsPanel(query);
          sphinxDetails.open = true;
          return;
        }

        const results = runUniversalDocsSearch(query, DOCS_UNIVERSAL_SEARCH_MAX_PAGE_RESULTS);
        if (!results.length) {
          status.textContent = `No quick matches for \"${query}\". Check full Sphinx results below.`;
          setNoResultsPanel(query);
          sphinxDetails.open = true;
          return;
        }

        status.textContent = `${results.length} result${results.length === 1 ? '' : 's'} for \"${query}\"`;
        renderUniversalSearchResultList(list, results, rootPath, query, 'page');
        sphinxDetails.open = false;
      });
    };

    let inputDebounce = 0;
    searchInput.addEventListener('input', function () {
      if (inputDebounce) window.clearTimeout(inputDebounce);
      inputDebounce = window.setTimeout(function () {
        renderQuery(searchInput.value, null);
      }, 110);
    });

    window.addEventListener('popstate', function () {
      const params = new URLSearchParams(window.location.search || '');
      const query = normalizeUniversalSearchQuery(params.get('q') || '');
      searchInput.value = query;
      renderQuery(query, null);
    });

    const params = new URLSearchParams(window.location.search || '');
    const initialQuery = normalizeUniversalSearchQuery(params.get('q') || searchInput.value || '');
    if (initialQuery && !searchInput.value) {
      searchInput.value = initialQuery;
    }
    renderQuery(initialQuery, null);
  }

  function initDocsUniversalSearch(rootPath) {
    const sidebarForms = document.querySelectorAll('.sphinxsidebar form.search');
    sidebarForms.forEach((form) => initSidebarUniversalSearchForm(rootPath, form));

    const currentSlug = resolveCurrentDocSlug(rootPath);
    if (currentSlug !== 'search') return;

    const searchForm = document.querySelector('.document .body form[action=""], .document .body form[action="search.html"]');
    if (!searchForm) return;
    const searchInput = searchForm.querySelector('input[name="q"]');
    if (!searchInput) return;
    initSearchPageUniversalResults(rootPath, searchForm, searchInput);
  }

  function enhanceSearchPageExperience(rootPath) {
    const currentSlug = resolveCurrentDocSlug(rootPath);
    if (currentSlug !== 'search') return;
    const searchForm = document.querySelector('.document .body form[action=""], .document .body form[action="search.html"]');
    if (!searchForm) return;

    normalizeSearchInputPresentation(document);
    const searchInput = searchForm.querySelector('input[name="q"]');
    if (searchInput) {
      const params = new URLSearchParams(window.location.search || '');
      const query = String(params.get('q') || '').trim();
      if (query && !searchInput.value) searchInput.value = query;
    }

    if (searchInput && !document.querySelector('.document .body .docs-search-alias-panel')) {
      searchForm.insertAdjacentElement('afterend', buildSearchAliasPanel(rootPath, searchInput));
    }

    if (searchInput) {
      initSearchPageUniversalResults(rootPath, searchForm, searchInput);
    }
  }

  function slugifyHeadingText(value) {
    const source = String(value || '').trim().toLowerCase();
    if (!source) return '';
    return source
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function ensureHeadingId(heading, usedIds) {
    const existing = String(heading.id || '').trim();
    if (existing) {
      usedIds.add(existing);
      return existing;
    }
    const base = slugifyHeadingText(heading.textContent) || 'section';
    let candidate = base;
    let index = 2;
    while (usedIds.has(candidate) || document.getElementById(candidate)) {
      candidate = `${base}-${index}`;
      index += 1;
    }
    heading.id = candidate;
    usedIds.add(candidate);
    return candidate;
  }

  function installInlineTocObserver(tocRoot) {
    const links = Array.from(tocRoot.querySelectorAll('a[data-docs-toc-target]'));
    if (!links.length || !window.IntersectionObserver) return;

    const byId = new Map();
    links.forEach((link) => byId.set(link.getAttribute('data-docs-toc-target'), link));

    const setActive = function (id) {
      links.forEach((link) => {
        const active = link.getAttribute('data-docs-toc-target') === id;
        link.classList.toggle('is-active', active);
        if (active) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    };

    const observer = new IntersectionObserver((entries) => {
      let topMost = null;
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const id = entry.target.id;
        if (!id || !byId.has(id)) return;
        if (!topMost || entry.boundingClientRect.top < topMost.top) {
          topMost = { id, top: entry.boundingClientRect.top };
        }
      });
      if (topMost) setActive(topMost.id);
    }, { rootMargin: '-20% 0px -70% 0px', threshold: [0, 1] });

    byId.forEach((_, id) => {
      const target = document.getElementById(id);
      if (target) observer.observe(target);
    });

    if (links[0]) setActive(links[0].getAttribute('data-docs-toc-target'));
  }

  function buildInlinePageToc(articleBody) {
    const hasNativeSphinxContents = !!articleBody.querySelector('nav.contents, aside.topic.contents, div.topic.contents');
    if (hasNativeSphinxContents) return null;

    const headings = Array.from(articleBody.querySelectorAll('h2, h3, h4'))
      .filter((heading) => String(heading.textContent || '').trim().length > 0);
    if (headings.length < 2) return null;
    if (headings.length > 32) return null;

    const usedIds = new Set(Array.from(articleBody.querySelectorAll('[id]')).map((el) => el.id));
    const nav = document.createElement('nav');
    nav.className = 'docs-inline-toc';
    nav.setAttribute('aria-label', 'On this page');

    const title = document.createElement('h2');
    title.className = 'docs-inline-toc-title';
    title.textContent = 'On this page';
    nav.appendChild(title);

    const list = document.createElement('ol');
    list.className = 'docs-inline-toc-list';

    headings.forEach((heading) => {
      const id = ensureHeadingId(heading, usedIds);
      const item = document.createElement('li');
      const level = Number(String(heading.tagName || 'H2').replace('H', '')) || 2;
      item.className = `docs-inline-toc-item level-${Math.min(Math.max(level, 2), 4)}`;

      const link = document.createElement('a');
      link.className = 'docs-inline-toc-link';
      link.href = `#${id}`;
      link.setAttribute('data-docs-toc-target', id);
      link.textContent = String(heading.textContent || '').trim();
      item.appendChild(link);
      list.appendChild(item);
    });

    nav.appendChild(list);
    return nav;
  }

  function buildBookEntriesList(entries, chapterPrefix, rootPath, currentSlug, depth, pathPrefix) {
    const list = document.createElement('ol');
    list.className = depth === 0 ? 'docs-book-list' : 'docs-book-sublist';

    entries.forEach((entry, index) => {
      const number = `${chapterPrefix}.${index + 1}`;
      const nodePath = `${pathPrefix}-${index + 1}`;
      const item = document.createElement('li');
      item.className = 'docs-book-item';

      const isActivePath = nodeContainsSlug(entry, currentSlug);
      if (isActivePath) {
        item.classList.add('is-active-path');
      }

      const title = String(entry && entry.title ? entry.title : 'Untitled');
      const slug = entry && entry.slug ? String(entry.slug) : '';
      const children = Array.isArray(entry && entry.children) ? entry.children : [];
      const hasChildren = children.length > 0;
      const stateNodeId = `node-${nodePath}`;
      const storedCollapsed = hasChildren ? getStoredNodeCollapseState(stateNodeId) : null;
      const startExpanded = hasChildren ? (storedCollapsed === null ? false : !storedCollapsed) : true;

      if (hasChildren && !startExpanded) {
        item.classList.add('is-collapsed');
      }

      const row = document.createElement('div');
      row.className = 'docs-book-item-row';
      if (hasChildren) {
        row.classList.add('has-children');
      }

      let childList = null;
      let itemToggle = null;
      const childListId = `docs-book-node-${depth + 1}-${nodePath}`;

      if (hasChildren) {
        itemToggle = document.createElement('button');
        itemToggle.className = 'docs-book-item-toggle';
        itemToggle.type = 'button';
        itemToggle.setAttribute('aria-controls', childListId);
        itemToggle.innerHTML = buildDisclosureChevron();
        setNodeToggleState(itemToggle, startExpanded, `${number} ${title}`);
        row.appendChild(itemToggle);
      } else {
        const spacer = document.createElement('span');
        spacer.className = 'docs-book-item-spacer';
        spacer.setAttribute('aria-hidden', 'true');
        row.appendChild(spacer);
      }

      const link = document.createElement('a');
      link.className = 'docs-book-link';
      link.href = slugToDocsHref(slug, rootPath);
      link.setAttribute('aria-label', `${number} ${title}`);
      if (hasChildren) {
        link.classList.add('docs-book-section-link');
        link.setAttribute('aria-expanded', startExpanded ? 'true' : 'false');
        link.title = `Expand/collapse ${number} ${title}`;
      }

      if (slug === currentSlug) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
      }

      const numberSpan = document.createElement('span');
      numberSpan.className = 'docs-book-number';
      numberSpan.textContent = number;
      link.appendChild(numberSpan);

      const textSpan = document.createElement('span');
      textSpan.className = 'docs-book-text';
      textSpan.textContent = title;
      link.appendChild(textSpan);

      row.appendChild(link);

      const toggleNode = hasChildren ? function () {
        const collapsed = item.classList.toggle('is-collapsed');
        if (childList) childList.hidden = collapsed;
        setStoredNodeCollapseState(stateNodeId, collapsed);
        if (itemToggle) {
          setNodeToggleState(itemToggle, !collapsed, `${number} ${title}`);
        }
        link.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      } : null;

      if (hasChildren && toggleNode) {
        itemToggle.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          toggleNode();
        });

        link.addEventListener('click', function (event) {
          if (event.defaultPrevented) return;
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault();
          toggleNode();
        });

        const openLink = document.createElement('a');
        openLink.className = 'docs-book-open-link';
        openLink.href = slugToDocsHref(slug, rootPath);
        openLink.setAttribute('aria-label', `Open ${number} ${title}`);
        openLink.title = `Open ${number} ${title}`;
        openLink.innerHTML = buildOpenDocIcon();
        row.appendChild(openLink);
      }

      item.appendChild(row);

      if (hasChildren) {
        childList = buildBookEntriesList(children, number, rootPath, currentSlug, depth + 1, nodePath);
        childList.id = childListId;
        childList.hidden = !startExpanded;
        item.appendChild(childList);
      }

      list.appendChild(item);
    });

    return list;
  }

  function renderGeneratedBookIndexSidebar(rootPath) {
    const payload = window.LLVMDocsBookIndex;
    if (!payload || !Array.isArray(payload.chapters)) return false;

    const wrapper = document.querySelector('.sphinxsidebarwrapper');
    if (!wrapper) return false;

    const quickSearch = wrapper.querySelector('#searchbox');
    const quickSearchClone = quickSearch ? quickSearch.cloneNode(true) : null;
    const currentSlug = resolveCurrentDocSlug(rootPath);

    wrapper.innerHTML = '';

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'docs-book-sidebar-toggle';
    toggleBtn.id = 'docs-book-sidebar-toggle';
    toggleBtn.type = 'button';
    toggleBtn.setAttribute('aria-pressed', 'false');
    toggleBtn.setAttribute('aria-label', 'Collapse sidebar');
    toggleBtn.title = 'Collapse sidebar';
    toggleBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="15 18 9 12 15 6"></polyline>
      </svg>
    `;

    const sidebarTop = document.createElement('div');
    sidebarTop.className = 'docs-book-sidebar-top';
    sidebarTop.appendChild(buildSidebarRelationBar(rootPath));
    sidebarTop.appendChild(toggleBtn);
    wrapper.appendChild(sidebarTop);

    let sidebarSearch = quickSearchClone;
    if (!sidebarSearch) {
      sidebarSearch = buildSidebarSearchBox(rootPath);
    }
    if (sidebarSearch) {
      normalizeSearchInputPresentation(sidebarSearch);
      sidebarSearch.style.display = 'block';
      wrapper.appendChild(sidebarSearch);
    }

    wrapper.appendChild(buildSidebarReleasePanel(rootPath));
    wrapper.appendChild(buildStandardSidebarGroups(rootPath));

    const nav = document.createElement('nav');
    nav.className = 'docs-book-index';
    nav.setAttribute('aria-label', 'Documentation table of contents');

    const navHead = document.createElement('div');
    navHead.className = 'docs-book-index-head';

    const navTitle = document.createElement('h3');
    navTitle.className = 'docs-book-index-title';
    navTitle.textContent = 'Index';
    navHead.appendChild(navTitle);
    nav.appendChild(navHead);

    payload.chapters.forEach((chapter, chapterIdx) => {
      const entries = Array.isArray(chapter && chapter.entries) ? chapter.entries : [];
      if (!entries.length) return;
      const chapterNumber = chapterIdx + 1;
      const chapterLabel = `${chapterNumber}. ${String(chapter.title || `Chapter ${chapterNumber}`)}`;
      const chapterStateId = `chapter-${chapterNumber}`;
      const storedChapterCollapsed = getStoredNodeCollapseState(chapterStateId);
      const chapterExpanded = storedChapterCollapsed === null ? false : !storedChapterCollapsed;

      const chapterSection = document.createElement('section');
      chapterSection.className = 'docs-book-chapter';

      if (!chapterExpanded) {
        chapterSection.classList.add('is-collapsed');
      }

      const chapterHead = document.createElement('div');
      chapterHead.className = 'docs-book-chapter-head';
      chapterHead.setAttribute('role', 'button');
      chapterHead.setAttribute('tabindex', '0');

      const chapterToggle = document.createElement('button');
      chapterToggle.className = 'docs-book-chapter-toggle';
      chapterToggle.type = 'button';
      chapterToggle.innerHTML = buildDisclosureChevron();
      const chapterBodyId = `docs-book-chapter-${chapterNumber}`;
      chapterToggle.setAttribute('aria-controls', chapterBodyId);
      setNodeToggleState(chapterToggle, chapterExpanded, chapterLabel);
      chapterHead.appendChild(chapterToggle);
      chapterHead.setAttribute('aria-controls', chapterBodyId);
      chapterHead.setAttribute('aria-expanded', chapterExpanded ? 'true' : 'false');

      const chapterTitle = document.createElement('h4');
      chapterTitle.className = 'docs-book-chapter-title';
      chapterTitle.textContent = chapterLabel;
      chapterHead.appendChild(chapterTitle);
      chapterSection.appendChild(chapterHead);

      const chapterBody = document.createElement('div');
      chapterBody.className = 'docs-book-chapter-body';
      chapterBody.id = chapterBodyId;
      chapterBody.hidden = !chapterExpanded;
      chapterBody.appendChild(
        buildBookEntriesList(entries, String(chapterNumber), rootPath, currentSlug, 0, `c${chapterNumber}`),
      );
      chapterSection.appendChild(chapterBody);

      const toggleChapter = function () {
        const collapsed = chapterSection.classList.toggle('is-collapsed');
        chapterBody.hidden = collapsed;
        setStoredNodeCollapseState(chapterStateId, collapsed);
        setNodeToggleState(chapterToggle, !collapsed, chapterLabel);
        chapterHead.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      };

      chapterToggle.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        toggleChapter();
      });

      chapterHead.addEventListener('click', function (event) {
        if (event.target && event.target.closest('.docs-book-chapter-toggle')) return;
        toggleChapter();
      });

      chapterHead.addEventListener('keydown', function (event) {
        if (event.target && event.target.closest('.docs-book-chapter-toggle')) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggleChapter();
      });

      nav.appendChild(chapterSection);
    });

    wrapper.appendChild(nav);

    initSidebarCollapseControl();
    return true;
  }

  function installGeneratedBookIndexSidebar(rootPath, attempts) {
    if (renderGeneratedBookIndexSidebar(rootPath)) return;
    const remaining = Number.isFinite(attempts) ? attempts : 40;
    if (remaining <= 0) return;
    window.setTimeout(() => installGeneratedBookIndexSidebar(rootPath, remaining - 1), 80);
  }

  function ensureBookIndexData(rootPath, onReady) {
    if (window.LLVMDocsBookIndex && Array.isArray(window.LLVMDocsBookIndex.chapters)) {
      onReady();
      return;
    }

    const scriptId = 'llvm-docs-book-index-script';
    let script = document.getElementById(scriptId);
    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = `${rootPath}docs/_static/docs-book-index.js?v=20260224-01`;
      script.async = true;
      script.addEventListener('load', onReady, { once: true });
      script.addEventListener('error', () => {
        // If this fails, keep default sidebar rather than breaking docs navigation.
      }, { once: true });
      document.head.appendChild(script);
      return;
    }

    script.addEventListener('load', onReady, { once: true });
  }

  function deriveFallbackTitle() {
    const title = String(document.title || '').trim();
    const cleaned = title
      .replace(/\s+[\u2013\u2014-]\s+LLVM.*$/i, '')
      .replace(/\s+[\u2013\u2014-]\s+documentation$/i, '')
      .trim();
    return cleaned || 'LLVM Documentation';
  }

  function ensureFooterContentAlignment() {
    const footer = document.querySelector('.footer');
    if (!footer) return;
    if (footer.querySelector('.docs-footer-inner')) return;
    const inner = document.createElement('div');
    inner.className = 'docs-footer-inner';
    while (footer.firstChild) {
      inner.appendChild(footer.firstChild);
    }
    footer.appendChild(inner);
  }

  function bridgeSphinxBodyToHugoLayout(rootPath) {
    const docsBody = document.querySelector('.document .body');
    if (!docsBody || docsBody.dataset.docsHugoBridged === '1') return;
    docsBody.dataset.docsHugoBridged = '1';

    const shell = document.createElement('div');
    shell.className = 'talk-detail docs-hugo-shell';

    const header = document.createElement('div');
    header.className = 'talk-header';

    const headerMeta = document.createElement('div');
    headerMeta.className = 'talk-header-meta';
    const badge = document.createElement('span');
    badge.className = 'badge badge-blog';
    badge.textContent = 'Docs';
    headerMeta.appendChild(badge);
    header.appendChild(headerMeta);

    const firstHeading = docsBody.querySelector('h1');
    if (firstHeading) {
      firstHeading.classList.add('talk-title');
      header.appendChild(firstHeading);
    } else {
      const fallbackTitle = document.createElement('h1');
      fallbackTitle.className = 'talk-title';
      fallbackTitle.textContent = deriveFallbackTitle();
      header.appendChild(fallbackTitle);
    }
    shell.appendChild(header);

    shell.appendChild(buildDocsTrustStrip(rootPath));

    const articleSection = document.createElement('section');
    articleSection.className = 'abstract-section';
    articleSection.setAttribute('aria-label', 'Documentation content');

    const articleLabel = document.createElement('div');
    articleLabel.className = 'section-label';
    articleLabel.setAttribute('aria-hidden', 'true');
    articleLabel.textContent = 'Article';
    articleSection.appendChild(articleLabel);

    const articleBody = document.createElement('div');
    articleBody.className = 'abstract-body blog-content docs-hugo-content';

    while (docsBody.firstChild) {
      articleBody.appendChild(docsBody.firstChild);
    }

    const inlineToc = buildInlinePageToc(articleBody);
    if (inlineToc) {
      articleSection.appendChild(inlineToc);
    }

    articleSection.appendChild(articleBody);
    shell.appendChild(articleSection);
    docsBody.appendChild(shell);

    if (inlineToc) {
      installInlineTocObserver(inlineToc);
    }
  }

  const rootPath = resolveRootPath();
  ensureStyles(rootPath);
  applyStoredDisplayPreferences();

  document.addEventListener('DOMContentLoaded', function () {
    if (document.body) document.body.classList.add('library-docs-bridge');
    document.documentElement.classList.add('library-docs-bridge-ready');

    const existingHeader = document.getElementById('llvm-docs-bridge-header');
    if (!existingHeader && document.body) {
      document.body.insertAdjacentHTML('afterbegin', buildHeader(rootPath));
    }

    const documentRoot = document.querySelector('.document');
    if (documentRoot && !documentRoot.id) {
      documentRoot.id = 'docs-content';
      documentRoot.setAttribute('tabindex', '-1');
    }

    bridgeSphinxBodyToHugoLayout(rootPath);
    ensureFooterContentAlignment();
    ensureSyncMetaData(rootPath, function () {
      refreshDocsSyncLabels();
      refreshSidebarReleasePanel(rootPath);
    });

    normalizeSearchInputPresentation(document);
    enhanceSearchPageExperience(rootPath);
    initDocsUniversalSearch(rootPath);
    initSearchShortcut();

    ensureBookIndexData(rootPath, function () {
      installGeneratedBookIndexSidebar(rootPath, 60);
      normalizeSearchInputPresentation(document.querySelector('.sphinxsidebarwrapper') || document);
      initDocsUniversalSearch(rootPath);
    });

    ensureHomeScript(rootPath);
  });
})();

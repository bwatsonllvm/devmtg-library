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
    ensureHeadTag('link', { rel: 'stylesheet', href: `${rootPath}css/docs-bridge.css?v=20260224-07` });
    ensureHeadTag('script', {
      src: `${rootPath}docs/_static/docs-book-index.js?v=20260224-01`,
      defer: 'defer',
    });
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

  function nodeContainsSlug(node, slug) {
    if (!node || !slug) return false;
    if (node.slug === slug) return true;
    const children = Array.isArray(node.children) ? node.children : [];
    return children.some((child) => nodeContainsSlug(child, slug));
  }

  function buildBookEntriesList(entries, chapterPrefix, rootPath, currentSlug, depth) {
    const list = document.createElement('ol');
    list.className = depth === 0 ? 'docs-book-list' : 'docs-book-sublist';

    entries.forEach((entry, index) => {
      const number = `${chapterPrefix}.${index + 1}`;
      const item = document.createElement('li');
      item.className = 'docs-book-item';

      if (nodeContainsSlug(entry, currentSlug)) {
        item.classList.add('is-active-path');
      }

      const title = String(entry && entry.title ? entry.title : 'Untitled');
      const slug = entry && entry.slug ? String(entry.slug) : '';
      const link = document.createElement('a');
      link.className = 'docs-book-link';
      link.href = slugToDocsHref(slug, rootPath);
      link.setAttribute('aria-label', `${number} ${title}`);

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

      item.appendChild(link);

      const children = Array.isArray(entry && entry.children) ? entry.children : [];
      if (children.length) {
        item.appendChild(buildBookEntriesList(children, number, rootPath, currentSlug, depth + 1));
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

    const nav = document.createElement('nav');
    nav.className = 'docs-book-index';
    nav.setAttribute('aria-label', 'Book-style table of contents');

    const navTitle = document.createElement('h3');
    navTitle.className = 'docs-book-index-title';
    navTitle.textContent = 'Book Index';
    nav.appendChild(navTitle);

    payload.chapters.forEach((chapter, chapterIdx) => {
      const entries = Array.isArray(chapter && chapter.entries) ? chapter.entries : [];
      if (!entries.length) return;

      const chapterSection = document.createElement('section');
      chapterSection.className = 'docs-book-chapter';

      const chapterTitle = document.createElement('h4');
      chapterTitle.className = 'docs-book-chapter-title';
      chapterTitle.textContent = `${chapterIdx + 1}. ${String(chapter.title || `Chapter ${chapterIdx + 1}`)}`;
      chapterSection.appendChild(chapterTitle);

      chapterSection.appendChild(
        buildBookEntriesList(entries, String(chapterIdx + 1), rootPath, currentSlug, 0),
      );
      nav.appendChild(chapterSection);
    });

    wrapper.appendChild(nav);
    if (quickSearchClone) {
      quickSearchClone.style.display = 'block';
      wrapper.appendChild(quickSearchClone);
    }
    return true;
  }

  function installGeneratedBookIndexSidebar(rootPath, attempts) {
    if (renderGeneratedBookIndexSidebar(rootPath)) return;
    const remaining = Number.isFinite(attempts) ? attempts : 40;
    if (remaining <= 0) return;
    window.setTimeout(() => installGeneratedBookIndexSidebar(rootPath, remaining - 1), 80);
  }

  function deriveFallbackTitle() {
    const title = String(document.title || '').trim();
    const cleaned = title
      .replace(/\s+[\u2013\u2014-]\s+LLVM.*$/i, '')
      .replace(/\s+[\u2013\u2014-]\s+documentation$/i, '')
      .trim();
    return cleaned || 'LLVM Documentation';
  }

  function bridgeSphinxBodyToHugoLayout() {
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

    articleSection.appendChild(articleBody);
    shell.appendChild(articleSection);
    docsBody.appendChild(shell);
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

    bridgeSphinxBodyToHugoLayout();
    installGeneratedBookIndexSidebar(rootPath, 40);

    ensureHomeScript(rootPath);
  });
})();

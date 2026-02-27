/**
 * paper.js - minimal paper/blog detail runtime.
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

  const BLOGS_PAGE_PATH = 'blogs/';
  const PAPERS_PAGE_PATH = 'papers/';
  const BLOG_SOURCE_SLUGS = new Set(['llvm-blog-www', 'llvm-www-blog']);
  const PAPER_TO_TALK_REDIRECTS = Object.freeze({});

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sanitizeExternalUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw, window.location.href);
      const protocol = parsed.protocol.toLowerCase();
      if (protocol === 'http:' || protocol === 'https:') return parsed.toString();
    } catch {
      return '';
    }
    return '';
  }

  function normalizeIsoDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return '';
    const year = Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10);
    const day = Number.parseInt(match[3], 10);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return '';
    if (month < 1 || month > 12 || day < 1 || day > 31) return '';
    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  function formatIsoDateLabel(value) {
    const iso = normalizeIsoDate(value);
    if (!iso) return '';
    const [year, month, day] = iso.split('-').map((part) => Number.parseInt(part, 10));
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return '';
    const stamp = new Date(Date.UTC(year, month - 1, day));
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(stamp);
  }

  function normalizePeople(authors) {
    const values = Array.isArray(authors) ? authors : [];
    return values.map((author) => {
      if (typeof HubUtils.normalizePersonRecord === 'function') {
        const normalized = HubUtils.normalizePersonRecord(author);
        if (!normalized || !normalized.name) return null;
        const affiliation = author && typeof author === 'object'
          ? String(author.affiliation || '').trim()
          : '';
        return { name: normalized.name, affiliation };
      }
      if (!author || typeof author !== 'object') return null;
      const name = String(author.name || '').trim();
      if (!name) return null;
      return {
        name,
        affiliation: String(author.affiliation || '').trim(),
      };
    }).filter(Boolean);
  }

  function extractDoi(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const match = raw.match(/10\.\d{4,9}\/[\w.()\-;/:%+]+/i);
    return match ? String(match[0]).trim() : '';
  }

  function normalizeOpenAlexId(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return sanitizeExternalUrl(raw);
    const cleaned = raw.replace(/^https?:\/\/openalex\.org\//i, '').replace(/^works\//i, '').trim();
    if (!/^W\d+$/i.test(cleaned)) return '';
    return `https://openalex.org/${cleaned.toUpperCase()}`;
  }

  function normalizePaperRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const paper = { ...raw };
    paper.id = String(paper.id || '').trim();
    paper.title = String(paper.title || '').trim();
    paper.abstract = String(paper.abstract || '').trim();
    paper.year = String(paper.year || '').trim();
    paper.publishedDate = normalizeIsoDate(paper.publishedDate || paper.publishDate || paper.date);
    paper.publication = String(paper.publication || '').trim();
    paper.venue = String(paper.venue || '').trim();
    paper.source = String(paper.source || '').trim();
    paper.sourceName = String(paper.sourceName || '').trim();
    paper.type = String(paper.type || '').trim();
    paper.paperUrl = sanitizeExternalUrl(paper.paperUrl || '');
    paper.sourceUrl = sanitizeExternalUrl(paper.sourceUrl || '');
    paper.contentFormat = String(paper.contentFormat || paper.bodyFormat || '').trim().toLowerCase();
    paper.content = String(paper.content || paper.body || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    paper.citationCount = Number.isFinite(Number(paper.citationCount)) ? Number(paper.citationCount) : 0;
    paper.authors = normalizePeople(paper.authors);
    paper.tags = Array.isArray(paper.tags) ? paper.tags.map((v) => String(v || '').trim()).filter(Boolean) : [];
    paper.keywords = Array.isArray(paper.keywords) ? paper.keywords.map((v) => String(v || '').trim()).filter(Boolean) : [];
    if (!paper.keywords.length && paper.tags.length) paper.keywords = [...paper.tags];

    const doiCandidate = extractDoi(paper.doi) || extractDoi(paper.paperUrl) || extractDoi(paper.sourceUrl);
    paper.doi = doiCandidate;
    paper.openalexId = normalizeOpenAlexId(paper.openalexId || paper.openAlexId || '');

    if (!paper.id || !paper.title) return null;

    paper._year = /^\d{4}$/.test(paper.year) ? paper.year : '';
    paper._publishedDate = paper.publishedDate;
    paper._publishedDateLabel = formatIsoDateLabel(paper._publishedDate);

    const normalizedType = String(paper.type || '').trim().toLowerCase();
    const normalizedSource = String(paper.source || '').trim().toLowerCase();
    paper._isBlog = BLOG_SOURCE_SLUGS.has(normalizedSource) || normalizedType === 'blog-post' || normalizedType === 'blog';

    return paper;
  }

  function normalizePapers(rawPapers) {
    if (!Array.isArray(rawPapers)) return [];
    return rawPapers.map(normalizePaperRecord).filter(Boolean);
  }

  function getPaperTopics(paper, limit = Infinity) {
    if (typeof HubUtils.getPaperKeyTopics === 'function') {
      return HubUtils.getPaperKeyTopics(paper, limit);
    }
    const values = [
      ...(Array.isArray(paper && paper.tags) ? paper.tags : []),
      ...(Array.isArray(paper && paper.keywords) ? paper.keywords : []),
    ];
    const deduped = [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
    return Number.isFinite(limit) ? deduped.slice(0, Math.max(0, Math.floor(limit))) : deduped;
  }

  function isBlogPaper(paper) {
    return !!(paper && paper._isBlog);
  }

  function getListingPathForPaper(paper) {
    return isBlogPaper(paper) ? BLOGS_PAGE_PATH : PAPERS_PAGE_PATH;
  }

  function getListingLabelForPaper(paper) {
    return isBlogPaper(paper) ? 'blogs' : 'papers';
  }

  function fallbackListingPathFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const from = String(params.get('from') || '').trim().toLowerCase();
    if (from === 'blogs' || from === 'blog') return BLOGS_PAGE_PATH;
    return PAPERS_PAGE_PATH;
  }

  function buildSpeakerWorkUrl(name, paper) {
    const speaker = String(name || '').trim();
    if (!speaker) return 'work.html';
    const from = isBlogPaper(paper) ? 'blogs' : 'papers';
    return `work.html?kind=speaker&value=${encodeURIComponent(speaker)}&from=${from}`;
  }

  function setIssueContext(context) {
    if (typeof window.setLibraryIssueContext !== 'function') return;
    if (!context || typeof context !== 'object') return;
    window.setLibraryIssueContext(context);
  }

  function setIssueContextForPaper(paper) {
    if (!paper || typeof paper !== 'object') return;
    setIssueContext({
      pageType: 'Paper',
      itemType: isBlogPaper(paper) ? 'Blog' : 'Paper',
      itemId: String(paper.id || '').trim(),
      itemTitle: String(paper.title || '').trim(),
      pageTitle: `${String(paper.title || '').trim()} — LLVM Research Library`,
      year: String(paper._year || '').trim(),
      paperUrl: String(paper.paperUrl || '').trim(),
      sourceUrl: String(paper.sourceUrl || '').trim(),
      doi: String(paper.doi || '').trim(),
      openalexId: String(paper.openalexId || '').trim(),
    });
  }

  function upsertMeta(attrName, attrValue, content) {
    if (!content) return;
    const selector = `meta[${attrName}="${attrValue}"]`;
    let node = document.head.querySelector(selector);
    if (!node) {
      node = document.createElement('meta');
      node.setAttribute(attrName, attrValue);
      document.head.appendChild(node);
    }
    node.setAttribute('content', String(content));
  }

  function updateSeo(paper) {
    if (!paper || typeof paper !== 'object') return;
    const title = String(paper.title || '').trim();
    if (!title) return;
    const description = String(paper.abstract || '').replace(/\s+/g, ' ').trim().slice(0, 260);
    upsertMeta('name', 'description', description || `${title} details`);
    upsertMeta('property', 'og:type', 'article');
    upsertMeta('property', 'og:title', `${title} — LLVM Research Library`);
    upsertMeta('property', 'og:description', description || title);
    upsertMeta('property', 'og:url', window.location.href);
    upsertMeta('name', 'twitter:card', 'summary');
    upsertMeta('name', 'twitter:title', `${title} — LLVM Research Library`);
    upsertMeta('name', 'twitter:description', description || title);
  }

  function doiUrlFromValue(doi) {
    const normalized = extractDoi(doi);
    return normalized ? `https://doi.org/${normalized}` : '';
  }

  async function loadPaperDetailContextById(paperId) {
    const targetId = String(paperId || '').trim();
    if (!targetId) return { loaded: true, paper: null, relatedPool: [] };

    if (typeof window.loadPaperRecordById === 'function') {
      try {
        const payload = await window.loadPaperRecordById(targetId);
        if (!payload || typeof payload !== 'object') {
          return { loaded: true, paper: null, relatedPool: [] };
        }
        const paper = normalizePaperRecord(payload.paper);
        const relatedPool = Array.isArray(payload.papers) ? payload.papers : [];
        return { loaded: true, paper, relatedPool };
      } catch {
        // Fallback below.
      }
    }

    if (typeof window.loadPaperData !== 'function') {
      return { loaded: false, paper: null, relatedPool: [] };
    }

    try {
      const payload = await window.loadPaperData();
      const papers = normalizePapers(payload && payload.papers);
      const paper = papers.find((candidate) => candidate.id === targetId) || null;
      return { loaded: true, paper, relatedPool: papers };
    } catch {
      return { loaded: false, paper: null, relatedPool: [] };
    }
  }

  function renderAbstract(text) {
    const normalized = String(text || '').trim();
    if (!normalized) return '<p><em>No abstract available.</em></p>';
    return normalized
      .split(/\n{2,}|\r\n\r\n/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map((paragraph) => `<p>${escapeHtml(paragraph.replace(/\n/g, ' '))}</p>`)
      .join('\n');
  }

  function renderBlogContent(paper) {
    const content = String(paper && paper.content || '').trim();
    if (!content) return renderAbstract(paper && paper.abstract);
    return content
      .split(/\n{2,}|\r\n\r\n/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map((paragraph) => `<p>${escapeHtml(paragraph.replace(/\n/g, ' '))}</p>`)
      .join('\n');
  }

  function renderAuthors(authors, paper) {
    const values = Array.isArray(authors) ? authors : [];
    if (!values.length) {
      return '<p style="color: var(--color-text-muted); font-size: var(--font-size-sm);">Author information not available.</p>';
    }
    return values.map((author) => {
      const name = String(author && author.name || '').trim();
      if (!name) return '';
      const affiliation = String(author && author.affiliation || '').trim();
      return `
        <div class="speaker-chip">
          <div>
            <a href="${buildSpeakerWorkUrl(name, paper)}" class="speaker-name-link" aria-label="View talks and papers by ${escapeHtml(name)}">${escapeHtml(name)}</a>
            ${affiliation ? `<br><span class="speaker-affiliation">${escapeHtml(affiliation)}</span>` : ''}
          </div>
        </div>`;
    }).join('');
  }

  function countTagOverlap(candidate, tagSet) {
    if (!(tagSet instanceof Set) || !tagSet.size) return 0;
    const values = [
      ...(Array.isArray(candidate && candidate.tags) ? candidate.tags : []),
      ...(Array.isArray(candidate && candidate.keywords) ? candidate.keywords : []),
    ];
    let overlap = 0;
    for (const value of values) {
      const normalized = String(value || '').trim().toLowerCase();
      if (normalized && tagSet.has(normalized)) overlap += 1;
    }
    return overlap;
  }

  function getRelatedPapers(paper, relatedPool) {
    const values = Array.isArray(relatedPool) ? relatedPool : [];
    if (!values.length) return [];

    const targetId = String(paper && paper.id || '').trim();
    if (!targetId) return [];

    const targetIsBlog = isBlogPaper(paper);
    const targetYear = String(paper && paper._year || '').trim();
    const tagSet = new Set(
      [
        ...(Array.isArray(paper && paper.tags) ? paper.tags : []),
        ...(Array.isArray(paper && paper.keywords) ? paper.keywords : []),
      ]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
    );

    const MAX_SCAN = 8000;
    const stride = values.length > MAX_SCAN ? Math.ceil(values.length / MAX_SCAN) : 1;

    const scored = [];
    const seenIds = new Set();
    for (let index = 0; index < values.length; index += stride) {
      const candidate = values[index];
      if (!candidate || typeof candidate !== 'object') continue;
      const id = String(candidate.id || '').trim();
      if (!id || id === targetId || seenIds.has(id)) continue;
      seenIds.add(id);

      const normalized = normalizePaperRecord(candidate);
      if (!normalized) continue;

      const sameYear = !!(targetYear && normalized._year === targetYear);
      const overlap = countTagOverlap(normalized, tagSet);
      if (!sameYear && overlap < 1) continue;

      let score = 0;
      if (sameYear) score += 120;
      score += overlap * 28;
      if (isBlogPaper(normalized) === targetIsBlog) score += 10;
      if (normalized._year) score += Number.parseInt(normalized._year, 10) * 0.001;

      scored.push({ paper: normalized, score, overlap });
    }

    scored.sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;
      const overlapDiff = b.overlap - a.overlap;
      if (overlapDiff !== 0) return overlapDiff;
      return String(a.paper.title || '').localeCompare(String(b.paper.title || ''));
    });

    return scored.slice(0, 6).map((entry) => entry.paper);
  }

  function renderRelatedCard(paper) {
    const blogEntry = isBlogPaper(paper);
    const listingPath = getListingPathForPaper(paper);
    const label = `${String(paper.title || '').trim()}${paper.authors && paper.authors.length ? ` by ${paper.authors.map((author) => author.name).join(', ')}` : ''}`;
    const dateOrYear = blogEntry
      ? String(paper._publishedDateLabel || paper._year || 'Unknown date')
      : String(paper._year || 'Unknown year');

    return `
      <article class="talk-card paper-card">
        <a href="papers/paper.html?id=${encodeURIComponent(String(paper.id || '').trim())}&from=${blogEntry ? 'blogs' : 'papers'}" class="card-link-wrap" aria-label="${escapeHtml(label)}">
          <div class="card-body">
            <div class="card-meta">
              <span class="badge ${blogEntry ? 'badge-blog' : 'badge-paper'}">${blogEntry ? 'Blog' : 'Paper'}</span>
              <span class="meeting-label">${escapeHtml(dateOrYear)}</span>
            </div>
            <p class="card-title">${escapeHtml(String(paper.title || '').trim())}</p>
          </div>
        </a>
        ${(paper.authors || []).length
          ? `<p class="card-speakers">${paper.authors.map((author) =>
              `<a href="${buildSpeakerWorkUrl(author.name, paper)}" class="card-speaker-link" aria-label="View talks and papers by ${escapeHtml(author.name)}">${escapeHtml(author.name)}</a>`
            ).join('<span class="speaker-btn-sep">, </span>')}</p>`
          : ''}
        ${getPaperTopics(paper, 8).length
          ? `<div class="card-tags-wrap"><div class="card-tags" aria-label="Key Topics">${getPaperTopics(paper, 8).slice(0, 4).map((topic) =>
              `<a href="${listingPath}?tag=${encodeURIComponent(topic)}" class="card-tag" aria-label="Browse ${getListingLabelForPaper(paper)} for key topic ${escapeHtml(topic)}">${escapeHtml(topic)}</a>`
            ).join('')}</div></div>`
          : ''}
      </article>`;
  }

  function renderNotFound(id, listingPath) {
    const root = document.getElementById('paper-detail-root');
    if (!root) return;
    const label = listingPath === BLOGS_PAGE_PATH ? 'blogs' : 'papers';
    const title = listingPath === BLOGS_PAGE_PATH ? 'All Blogs' : 'All Papers';
    root.innerHTML = `
      <div class="talk-detail">
        <a href="${listingPath}" class="back-btn" aria-label="Back to all ${label}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          <span aria-hidden="true">${title}</span>
        </a>
        <div class="empty-state">
          <div class="empty-state-icon" aria-hidden="true">!</div>
          <h2>Paper not found</h2>
          <p>No paper found with ID <code>${escapeHtml(id || '(none)')}</code>.</p>
        </div>
      </div>`;
  }

  function renderLoadError() {
    const root = document.getElementById('paper-detail-root');
    if (!root) return;
    root.innerHTML = `
      <div class="talk-detail">
        <div class="empty-state" role="alert">
          <div class="empty-state-icon" aria-hidden="true">!</div>
          <h2>Could not load data</h2>
          <p>Ensure <code>papers/index.json</code> and <code>papers/*.json</code> are available and that <code>js/papers-data.js</code> loads first.</p>
        </div>
      </div>`;
  }

  function renderPaperDetail(paper, relatedPool) {
    const root = document.getElementById('paper-detail-root');
    if (!root) return;

    const blogEntry = isBlogPaper(paper);
    const listingPath = getListingPathForPaper(paper);
    const listingLabel = getListingLabelForPaper(paper);

    const infoParts = [];
    if (blogEntry && paper._publishedDateLabel) infoParts.push(paper._publishedDateLabel);
    else if (paper._year) infoParts.push(paper._year);
    if (paper.publication) infoParts.push(paper.publication);
    if (paper.venue && paper.venue !== paper.publication) infoParts.push(paper.venue);

    const links = [];
    if (paper.paperUrl) {
      links.push(`<a href="${escapeHtml(paper.paperUrl)}" class="link-btn" target="_blank" rel="noopener noreferrer">${blogEntry ? 'Open Repository Post' : 'Open Paper'}</a>`);
    }
    if (paper.sourceUrl && paper.sourceUrl !== paper.paperUrl) {
      links.push(`<a href="${escapeHtml(paper.sourceUrl)}" class="link-btn" target="_blank" rel="noopener noreferrer">${blogEntry ? 'Open Blog' : 'Source Listing'}</a>`);
    }
    const doiHref = sanitizeExternalUrl(doiUrlFromValue(paper.doi));
    if (doiHref) {
      links.push(`<a href="${escapeHtml(doiHref)}" class="link-btn" target="_blank" rel="noopener noreferrer">DOI</a>`);
    }
    if (paper.openalexId) {
      links.push(`<a href="${escapeHtml(paper.openalexId)}" class="link-btn" target="_blank" rel="noopener noreferrer">OpenAlex</a>`);
    }

    const topics = getPaperTopics(paper, 18);
    const topicsHtml = topics.length
      ? `<section class="tags-section" aria-label="Key Topics">
          <div class="section-label" aria-hidden="true">Key Topics</div>
          <div class="detail-tags">
            ${topics.map((topic) =>
              `<a href="${listingPath}?tag=${encodeURIComponent(topic)}" class="detail-tag" aria-label="Browse ${listingLabel} for key topic ${escapeHtml(topic)}">${escapeHtml(topic)}</a>`
            ).join('')}
          </div>
        </section>`
      : '';

    const related = getRelatedPapers(paper, relatedPool);

    root.innerHTML = `
      <div class="talk-detail">
        <a href="${listingPath}" class="back-btn" id="back-btn" aria-label="Back to all ${listingLabel}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          <span aria-hidden="true">${escapeHtml(blogEntry ? 'All Blogs' : 'All Papers')}</span>
        </a>

        <div class="talk-header">
          <div class="talk-header-meta">
            <span class="badge ${blogEntry ? 'badge-blog' : 'badge-paper'}">${blogEntry ? 'Blog' : 'Paper'}</span>
            ${infoParts.length ? `<span class="meeting-info-badge">${escapeHtml(infoParts.join(' · '))}</span>` : ''}
          </div>
          <h1 class="talk-title">${escapeHtml(paper.title)}</h1>
        </div>

        <section class="speakers-section" aria-label="Authors">
          <div class="section-label" aria-hidden="true">Authors</div>
          <div class="speakers-list">${renderAuthors(paper.authors, paper)}</div>
        </section>

        ${links.length ? `<div class="links-bar" aria-label="Resources">${links.join('')}</div>` : ''}

        <section class="abstract-section" aria-label="${blogEntry ? 'Blog post content' : 'Abstract'}">
          <div class="section-label" aria-hidden="true">${blogEntry ? 'Article' : 'Abstract'}</div>
          <div class="abstract-body${blogEntry ? ' blog-content' : ''}">
            ${blogEntry ? renderBlogContent(paper) : renderAbstract(paper.abstract)}
          </div>
        </section>

        ${topicsHtml}
      </div>

      ${related.length ? `
      <section class="related-section" aria-label="Related ${blogEntry ? 'content' : 'papers'}">
        <h2>${blogEntry ? 'Related Content' : 'Related Papers'}</h2>
        <div class="related-grid">
          ${related.map((item) => renderRelatedCard(item)).join('')}
        </div>
      </section>` : ''}`;

    const backBtn = document.getElementById('back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', (event) => {
        if (window.history.length > 1) {
          event.preventDefault();
          window.history.back();
        }
      });
    }
  }

  async function init() {
    initTheme();
    initTextSize();
    initCustomizationMenu();
    initMobileNavMenu();

    const params = new URLSearchParams(window.location.search);
    const paperId = String(params.get('id') || '').trim();
    const fallbackListingPath = fallbackListingPathFromUrl();

    setIssueContext({
      pageType: 'Paper',
      itemType: fallbackListingPath === BLOGS_PAGE_PATH ? 'Blog' : 'Paper',
      itemId: paperId,
    });

    if (!paperId) {
      renderNotFound(null, fallbackListingPath);
      setIssueContext({
        itemTitle: `Missing ${(fallbackListingPath === BLOGS_PAGE_PATH ? 'blog' : 'paper')} ID`,
        issueTitle: `[${fallbackListingPath === BLOGS_PAGE_PATH ? 'Blog' : 'Paper'}] Missing ${(fallbackListingPath === BLOGS_PAGE_PATH ? 'blog' : 'paper')} ID`,
      });
      initShareMenu();
      return;
    }

    const migratedTalkId = PAPER_TO_TALK_REDIRECTS[paperId];
    if (migratedTalkId) {
      window.location.replace(`../talks/talk.html?id=${encodeURIComponent(migratedTalkId)}`);
      return;
    }

    const context = await loadPaperDetailContextById(paperId);
    if (!context || context.loaded !== true) {
      renderLoadError();
      initShareMenu();
      return;
    }

    const paper = context.paper;
    if (!paper) {
      renderNotFound(paperId, fallbackListingPath);
      const typeLabel = fallbackListingPath === BLOGS_PAGE_PATH ? 'Blog' : 'Paper';
      setIssueContext({
        itemTitle: `Unknown ${typeLabel.toLowerCase()} ID: ${paperId}`,
        issueTitle: `[${typeLabel}] Unknown ${typeLabel.toLowerCase()} ID: ${paperId}`,
      });
      initShareMenu();
      return;
    }

    document.title = `${paper.title} — LLVM Research Library`;
    updateSeo(paper);
    renderPaperDetail(paper, context.relatedPool);
    setIssueContextForPaper(paper);
    initShareMenu();
  }

  init();
})();

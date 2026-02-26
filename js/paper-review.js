/*
 * paper-review.js
 * Admin review queue gated by server-side GitHub auth.
 */
(function () {
  'use strict';

  const BLOG_SOURCE_SLUGS = new Set(['llvm-blog-www', 'llvm-www-blog']);
  const REVIEW_STATE_KEY = 'llvm-hub-paper-review-state-v1';
  const RECENT_REVIEW_LIMIT = 40;
  const AUTO_LOGIN_ATTEMPT_KEY = 'llvm-hub-paper-review-auto-login-attempted-v1';
  const AUTO_LOGIN_COOLDOWN_MS = 2 * 60 * 1000;

  const adminCard = document.getElementById('review-admin-card');
  const adminHint = document.getElementById('review-admin-hint');
  const adminStatus = document.getElementById('review-admin-status');
  const adminLogin = document.getElementById('review-admin-login');
  const adminRefresh = document.getElementById('review-admin-refresh');
  const adminIdentity = document.getElementById('review-admin-identity');

  const reviewShell = document.getElementById('review-shell');
  const reviewStats = document.getElementById('review-stats');
  const reviewPosition = document.getElementById('review-position');
  const reviewStatus = document.getElementById('review-status');
  const reviewLockBtn = document.getElementById('review-lock-btn');
  const reviewResetBtn = document.getElementById('review-reset-btn');

  const currentCard = document.getElementById('review-current-card');
  const emptyCard = document.getElementById('review-empty-card');
  const titleEl = document.getElementById('review-title');
  const metaEl = document.getElementById('review-meta');
  const abstractEl = document.getElementById('review-abstract');
  const authorsEl = document.getElementById('review-authors');
  const markBtn = document.getElementById('review-mark-btn');
  const nextBtn = document.getElementById('review-next-btn');
  const detailLink = document.getElementById('review-detail-link');
  const paperLink = document.getElementById('review-paper-link');
  const sourceLink = document.getElementById('review-source-link');
  const editLink = document.getElementById('review-edit-link');
  const updateLink = document.getElementById('review-update-link');
  const resetAllBtn = document.getElementById('review-reset-all-btn');

  const recentList = document.getElementById('review-recent-list');

  if (
    !adminCard || !adminHint || !adminStatus || !adminLogin || !adminRefresh || !adminIdentity ||
    !reviewShell || !reviewStats || !reviewPosition || !reviewStatus || !reviewLockBtn || !reviewResetBtn ||
    !currentCard || !emptyCard || !titleEl || !metaEl || !abstractEl || !authorsEl || !markBtn || !nextBtn ||
    !detailLink || !paperLink || !sourceLink || !editLink || !updateLink || !resetAllBtn || !recentList
  ) {
    return;
  }

  const state = {
    initialized: false,
    allPapers: [],
    pending: [],
    currentIndex: 0,
    reviewed: {},
    auth: {
      authenticated: false,
      authorized: false,
      login: '',
    },
  };

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

  function storageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  function readAuthBase() {
    const meta = document.querySelector('meta[name="review-auth-base"]');
    const raw = String(meta && meta.content || '').trim();
    if (!raw) return '';
    try {
      const resolved = new URL(raw, window.location.href);
      return resolved.toString().replace(/\/+$/, '');
    } catch {
      return '';
    }
  }

  const AUTH_BASE = readAuthBase();

  function authUrl(pathname) {
    const path = String(pathname || '').trim();
    if (!path) return window.location.href;
    if (!AUTH_BASE) return path;
    return `${AUTH_BASE}${path}`;
  }

  function currentReturnPath() {
    return `${window.location.pathname}${window.location.search}`;
  }

  function buildLoginUrl() {
    const url = new URL(authUrl('/auth/review/login'), window.location.href);
    url.searchParams.set('return_to', currentReturnPath());
    return url.toString();
  }

  function buildLogoutUrl() {
    const url = new URL(authUrl('/auth/review/logout'), window.location.href);
    url.searchParams.set('return_to', currentReturnPath());
    return url.toString();
  }

  function setAdminStatus(message, kind) {
    adminStatus.textContent = message || '';
    adminStatus.classList.remove('error', 'success');
    if (kind) adminStatus.classList.add(kind);
  }

  function setReviewStatus(message, kind) {
    reviewStatus.textContent = message || '';
    reviewStatus.classList.remove('error', 'success');
    if (kind) reviewStatus.classList.add(kind);
  }

  function getSearchParams() {
    try {
      return new URLSearchParams(window.location.search || '');
    } catch {
      return new URLSearchParams('');
    }
  }

  function autoLoginDisabled() {
    const params = getSearchParams();
    const value = String(params.get('no_auto_login') || '').trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'yes';
  }

  function shouldAutoLoginNow() {
    if (autoLoginDisabled()) return false;
    const raw = storageGet(AUTO_LOGIN_ATTEMPT_KEY);
    const last = Number.parseInt(String(raw || '').trim(), 10);
    if (!Number.isFinite(last) || last <= 0) return true;
    return (Date.now() - last) > AUTO_LOGIN_COOLDOWN_MS;
  }

  function markAutoLoginAttempt() {
    storageSet(AUTO_LOGIN_ATTEMPT_KEY, String(Date.now()));
  }

  function normalizeIsoDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
    if (!match) return '';
    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  function formatIsoDate(value) {
    const iso = normalizeIsoDate(value);
    if (!iso) return '';
    const [year, month, day] = iso.split('-').map((piece) => Number.parseInt(piece, 10));
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return '';
    const stamp = new Date(Date.UTC(year, month - 1, day));
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(stamp);
  }

  function parseYear(rawYear) {
    const parsed = Number.parseInt(String(rawYear || '').trim(), 10);
    if (!Number.isFinite(parsed)) return 0;
    if (parsed < 1900 || parsed > 2100) return 0;
    return parsed;
  }

  function isBlogPaper(paper) {
    const source = String(paper && paper.source || '').trim().toLowerCase();
    const type = String(paper && paper.type || '').trim().toLowerCase();
    return BLOG_SOURCE_SLUGS.has(source) || type === 'blog' || type === 'blog-post';
  }

  function normalizePaperRecord(rawPaper) {
    if (!rawPaper || typeof rawPaper !== 'object') return null;

    const id = String(rawPaper.id || '').trim();
    const title = String(rawPaper.title || '').trim();
    if (!id || !title) return null;

    const year = String(rawPaper.year || '').trim();
    const publishedDate = normalizeIsoDate(rawPaper.publishedDate || rawPaper.publishDate || rawPaper.date);
    const authors = Array.isArray(rawPaper.authors)
      ? rawPaper.authors
        .map((author) => {
          if (!author || typeof author !== 'object') return null;
          const name = String(author.name || '').trim();
          const affiliation = String(author.affiliation || '').trim();
          if (!name) return null;
          return { name, affiliation };
        })
        .filter(Boolean)
      : [];

    return {
      id,
      title,
      year,
      _yearNum: parseYear(year),
      _publishedDate: publishedDate,
      _publishedDateLabel: formatIsoDate(publishedDate),
      publication: String(rawPaper.publication || '').trim(),
      venue: String(rawPaper.venue || '').trim(),
      abstract: String(rawPaper.abstract || '').trim(),
      type: String(rawPaper.type || '').trim(),
      source: String(rawPaper.source || '').trim(),
      paperUrl: sanitizeExternalUrl(rawPaper.paperUrl || ''),
      sourceUrl: sanitizeExternalUrl(rawPaper.sourceUrl || ''),
      authors,
    };
  }

  function comparePapers(a, b) {
    if (a._yearNum !== b._yearNum) return b._yearNum - a._yearNum;
    const dateA = String(a._publishedDate || '');
    const dateB = String(b._publishedDate || '');
    if (dateA !== dateB) return dateB.localeCompare(dateA);
    return String(a.title || '').localeCompare(String(b.title || ''));
  }

  function loadReviewState() {
    const fallback = { reviewed: {} };
    const raw = storageGet(REVIEW_STATE_KEY);
    if (!raw) return fallback;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return fallback;
      const reviewed = parsed.reviewed && typeof parsed.reviewed === 'object' ? parsed.reviewed : {};
      const normalized = {};
      for (const [id, entry] of Object.entries(reviewed)) {
        const paperId = String(id || '').trim();
        if (!paperId) continue;
        const reviewedAt = String(entry && entry.reviewedAt || '').trim();
        normalized[paperId] = {
          reviewedAt: reviewedAt || new Date(0).toISOString(),
          title: String(entry && entry.title || '').trim(),
          year: String(entry && entry.year || '').trim(),
        };
      }
      return { reviewed: normalized };
    } catch {
      return fallback;
    }
  }

  function saveReviewState() {
    const payload = { reviewed: state.reviewed };
    storageSet(REVIEW_STATE_KEY, JSON.stringify(payload));
  }

  function isReviewed(paperId) {
    return !!(paperId && state.reviewed[paperId]);
  }

  function reviewedEntriesSorted() {
    return Object.entries(state.reviewed)
      .map(([id, entry]) => ({
        id,
        reviewedAt: String(entry && entry.reviewedAt || ''),
        title: String(entry && entry.title || ''),
        year: String(entry && entry.year || ''),
      }))
      .sort((a, b) => String(b.reviewedAt || '').localeCompare(String(a.reviewedAt || '')));
  }

  function rebuildPendingQueue() {
    state.pending = state.allPapers.filter((paper) => !isReviewed(paper.id));
    if (state.currentIndex >= state.pending.length) state.currentIndex = 0;
    if (state.currentIndex < 0) state.currentIndex = 0;
  }

  function buildPaperAdminLinks(paper) {
    const paperId = String((paper && paper.id) || '').trim();
    const editHref = paperId ? `papers/edit.html?id=${encodeURIComponent(paperId)}` : '';
    const sourceUrl = sanitizeExternalUrl(paper && paper.sourceUrl);
    const paperUrl = sanitizeExternalUrl(paper && paper.paperUrl);
    const updateSourceUrl = sourceUrl || paperUrl;
    const updateHref = updateSourceUrl
      ? `papers/add-by-url.html?source_url=${encodeURIComponent(updateSourceUrl)}`
      : '';
    return { editHref, updateHref };
  }

  function currentPaper() {
    if (!state.pending.length) return null;
    return state.pending[state.currentIndex] || state.pending[0] || null;
  }

  function previewAbstract(paper) {
    const text = String(paper && paper.abstract || '').trim();
    if (!text) return 'No abstract available.';
    if (text.length <= 480) return text;
    const short = text.slice(0, 480).replace(/\s+\S*$/, '').trim();
    return `${short}...`;
  }

  function formatAffiliation(value) {
    return String(value || '')
      .split('|')
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' | ');
  }

  function renderAuthors(paper) {
    const authors = Array.isArray(paper && paper.authors) ? paper.authors : [];
    if (!authors.length) {
      authorsEl.innerHTML = '<li class="review-author review-author--empty">Authors unknown</li>';
      return;
    }
    authorsEl.innerHTML = authors
      .map((author) => {
        const name = escapeHtml(author.name || '');
        const affiliation = escapeHtml(formatAffiliation(author.affiliation || ''));
        if (!affiliation) return `<li class="review-author"><strong>${name}</strong></li>`;
        return `<li class="review-author"><strong>${name}</strong><span>${affiliation}</span></li>`;
      })
      .join('');
  }

  function setOptionalLink(anchor, href) {
    if (!anchor) return;
    const safe = sanitizeExternalUrl(href || '');
    if (!safe) {
      anchor.classList.add('hidden');
      anchor.removeAttribute('href');
      return;
    }
    anchor.href = safe;
    anchor.classList.remove('hidden');
  }

  function formatReviewTimestamp(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const stamp = new Date(text);
    if (Number.isNaN(stamp.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(stamp);
  }

  function renderRecentReviews() {
    const entries = reviewedEntriesSorted().slice(0, RECENT_REVIEW_LIMIT);
    if (!entries.length) {
      recentList.innerHTML = '<li class="review-recent-empty">No papers reviewed yet.</li>';
      return;
    }
    recentList.innerHTML = entries
      .map((entry) => {
        const detailHref = `papers/paper.html?id=${encodeURIComponent(entry.id)}&from=papers`;
        const timestamp = formatReviewTimestamp(entry.reviewedAt);
        const title = entry.title || entry.id;
        const yearLabel = entry.year ? ` (${entry.year})` : '';
        return `
          <li class="review-recent-item">
            <span class="review-check" aria-hidden="true">✓</span>
            <a href="${detailHref}">${escapeHtml(title)}${escapeHtml(yearLabel)}</a>
            ${timestamp ? `<time datetime="${escapeHtml(entry.reviewedAt)}">${escapeHtml(timestamp)}</time>` : ''}
          </li>`;
      })
      .join('');
  }

  function renderStats() {
    const total = state.allPapers.length;
    const pending = state.pending.length;
    const reviewed = total - pending;
    reviewStats.textContent = `Pending ${pending.toLocaleString()} | Reviewed ${reviewed.toLocaleString()} | Total ${total.toLocaleString()}`;

    if (!pending) {
      reviewPosition.textContent = 'Queue complete';
      return;
    }
    reviewPosition.textContent = `Queue position ${state.currentIndex + 1} of ${pending.toLocaleString()} pending`;
  }

  function renderQueue() {
    renderStats();
    renderRecentReviews();

    const paper = currentPaper();
    if (!paper) {
      currentCard.classList.add('hidden');
      emptyCard.classList.remove('hidden');
      return;
    }

    currentCard.classList.remove('hidden');
    emptyCard.classList.add('hidden');

    titleEl.textContent = paper.title;

    const metaParts = [];
    if (paper._yearNum > 0) metaParts.push(String(paper._yearNum));
    else if (paper.year) metaParts.push(paper.year);
    if (paper.publication) metaParts.push(paper.publication);
    if (paper.venue && paper.venue !== paper.publication) metaParts.push(paper.venue);
    metaEl.textContent = metaParts.join(' | ') || 'Metadata unavailable';

    abstractEl.textContent = previewAbstract(paper);
    renderAuthors(paper);

    detailLink.href = `papers/paper.html?id=${encodeURIComponent(paper.id)}&from=papers`;
    setOptionalLink(paperLink, paper.paperUrl);
    setOptionalLink(sourceLink, paper.sourceUrl);

    const adminLinks = buildPaperAdminLinks(paper);
    if (adminLinks.editHref) {
      editLink.href = adminLinks.editHref;
      editLink.classList.remove('hidden');
    } else {
      editLink.classList.add('hidden');
      editLink.removeAttribute('href');
    }

    if (adminLinks.updateHref) {
      updateLink.href = adminLinks.updateHref;
      updateLink.classList.remove('hidden');
    } else {
      updateLink.classList.add('hidden');
      updateLink.removeAttribute('href');
    }

    nextBtn.disabled = state.pending.length <= 1;
  }

  function markCurrentReviewed() {
    const paper = currentPaper();
    if (!paper) {
      setReviewStatus('No pending paper to review.', 'error');
      return;
    }
    state.reviewed[paper.id] = {
      reviewedAt: new Date().toISOString(),
      title: paper.title,
      year: paper.year,
    };
    saveReviewState();
    rebuildPendingQueue();
    setReviewStatus(`Reviewed ✓ ${paper.title}`, 'success');
    renderQueue();
  }

  function moveToNext() {
    if (!state.pending.length) {
      setReviewStatus('Queue is already complete.', 'success');
      return;
    }
    if (state.pending.length === 1) {
      setReviewStatus('Only one pending paper remains.', '');
      return;
    }
    state.currentIndex = (state.currentIndex + 1) % state.pending.length;
    setReviewStatus('', '');
    renderQueue();
  }

  function resetAllReviews() {
    if (!Object.keys(state.reviewed).length) {
      setReviewStatus('No reviewed papers to reset.', '');
      return;
    }
    const confirmed = window.confirm('Clear all reviewed marks and rebuild the full queue?');
    if (!confirmed) return;
    state.reviewed = {};
    saveReviewState();
    state.currentIndex = 0;
    rebuildPendingQueue();
    setReviewStatus('All reviewed marks were cleared.', 'success');
    renderQueue();
  }

  async function ensureDataLoaded() {
    if (state.initialized) return;
    if (typeof window.loadPaperData !== 'function') {
      throw new Error('Paper loader is unavailable. Ensure js/papers-data.js is loaded.');
    }
    const payload = await window.loadPaperData();
    const papers = Array.isArray(payload && payload.papers) ? payload.papers : [];
    state.allPapers = papers
      .map(normalizePaperRecord)
      .filter(Boolean)
      .filter((paper) => !isBlogPaper(paper))
      .sort(comparePapers);
    state.reviewed = loadReviewState().reviewed;
    rebuildPendingQueue();
    state.initialized = true;
  }

  async function fetchAuthSession() {
    const endpoint = authUrl('/auth/review/session');
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        return {
          ok: false,
          error: `Auth endpoint returned HTTP ${response.status}.`,
          authenticated: false,
          authorized: false,
          login: '',
          reason: '',
        };
      }

      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('application/json')) {
        return {
          ok: false,
          error: 'Auth endpoint did not return JSON.',
          authenticated: false,
          authorized: false,
          login: '',
          reason: '',
        };
      }

      const payload = await response.json();
      const authenticated = !!payload.authenticated;
      const authorized = !!payload.authorized;
      const login = String(payload.login || '').trim();
      const reason = String(payload.reason || '').trim();
      return { ok: true, authenticated, authorized, login, reason };
    } catch (err) {
      return {
        ok: false,
        error: err && err.message ? err.message : 'Could not reach auth endpoint.',
        authenticated: false,
        authorized: false,
        login: '',
        reason: '',
      };
    }
  }

  function setAuthLinks() {
    adminLogin.href = buildLoginUrl();
    adminLogin.rel = 'noopener noreferrer';
    reviewLockBtn.textContent = 'Sign Out';
  }

  function showAuthGate(sessionResult) {
    reviewShell.classList.add('hidden');
    adminCard.classList.remove('hidden');

    adminIdentity.textContent = AUTH_BASE
      ? `Auth service: ${AUTH_BASE}`
      : 'Auth service: same origin (/auth/review/*)';

    if (!sessionResult.ok) {
      adminHint.textContent = 'Sign in with an allowlisted GitHub account to access this queue.';
      setAdminStatus(`${sessionResult.error} If this is GitHub Pages directly, use the worker-protected domain.`, 'error');
      return;
    }

    if (!sessionResult.authenticated) {
      adminHint.textContent = 'Sign in with an allowlisted GitHub account to access this queue.';
      setAdminStatus('', '');
      if (shouldAutoLoginNow()) {
        markAutoLoginAttempt();
        setAdminStatus('Redirecting to GitHub sign-in...', '');
        window.setTimeout(() => {
          window.location.href = buildLoginUrl();
        }, 220);
      }
      return;
    }

    if (!sessionResult.authorized) {
      const login = sessionResult.login ? ` (${sessionResult.login})` : '';
      adminHint.textContent = `Signed in${login}, but this account is not allowlisted for review access.`;
      setAdminStatus('Your GitHub account is authenticated but not authorized.', 'error');
      return;
    }

    adminHint.textContent = 'Sign in with an allowlisted GitHub account to access this queue.';
    setAdminStatus('', '');
  }

  async function showQueue(sessionResult) {
    state.auth.authenticated = true;
    state.auth.authorized = true;
    state.auth.login = sessionResult.login;
    adminIdentity.textContent = sessionResult.login
      ? `Authenticated as @${sessionResult.login}`
      : 'Authenticated';
    adminCard.classList.add('hidden');
    reviewShell.classList.remove('hidden');
    await ensureDataLoaded();
    setReviewStatus('', '');
    renderQueue();
  }

  async function refreshAuthAndRender() {
    setAuthLinks();
    setAdminStatus('Checking admin session...', '');
    const session = await fetchAuthSession();
    if (session.ok && session.authenticated && session.authorized) {
      try {
        await showQueue(session);
      } catch (err) {
        reviewShell.classList.add('hidden');
        adminCard.classList.remove('hidden');
        setAdminStatus(err && err.message ? err.message : 'Failed to load review queue data.', 'error');
      }
      return;
    }
    showAuthGate(session);
  }

  function signOut() {
    window.location.href = buildLogoutUrl();
  }

  adminRefresh.addEventListener('click', () => {
    refreshAuthAndRender();
  });
  reviewLockBtn.addEventListener('click', signOut);
  reviewResetBtn.addEventListener('click', resetAllReviews);
  resetAllBtn.addEventListener('click', resetAllReviews);
  markBtn.addEventListener('click', markCurrentReviewed);
  nextBtn.addEventListener('click', moveToNext);

  refreshAuthAndRender();
})();

/*
 * paper-review.js
 * Staged paper-review queue: permanent checkmarks come only from merged PR data.
 */
(function () {
  'use strict';

  const BLOG_SOURCE_SLUGS = new Set(['llvm-blog-www', 'llvm-www-blog']);
  const STAGED_STATE_KEY = 'llvm-hub-paper-review-staged-v1';
  const REVIEW_RETURN_MESSAGE_KEY = 'llvm-hub-paper-review-return-message-v1';
  const REVIEWED_JSON_CANDIDATES = [
    'papers/reviewed-papers.json',
    '../papers/reviewed-papers.json',
    './papers/reviewed-papers.json',
  ];
  const RECENT_REVIEW_LIMIT = 40;

  const reviewShell = document.getElementById('review-shell');
  const reviewStats = document.getElementById('review-stats');
  const reviewPosition = document.getElementById('review-position');
  const reviewStatus = document.getElementById('review-status');

  const currentCard = document.getElementById('review-current-card');
  const emptyCard = document.getElementById('review-empty-card');
  const emptyCopy = document.getElementById('review-empty-copy');
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

  const clearStagedBtn = document.getElementById('review-clear-staged-btn');
  const clearStagedEmptyBtn = document.getElementById('review-clear-staged-empty-btn');

  const stagedList = document.getElementById('review-staged-list');
  const permanentList = document.getElementById('review-recent-list');

  const batchWorkflowLink = document.getElementById('review-batch-workflow-link');
  const batchCommand = document.getElementById('review-batch-command');
  const batchCopyBtn = document.getElementById('review-batch-copy-btn');
  const batchCopyJsonBtn = document.getElementById('review-batch-copy-json-btn');
  const batchStatus = document.getElementById('review-batch-status');

  if (
    !reviewShell || !reviewStats || !reviewPosition || !reviewStatus || !currentCard || !emptyCard ||
    !emptyCopy || !titleEl || !metaEl || !abstractEl || !authorsEl || !markBtn || !nextBtn ||
    !detailLink || !paperLink || !sourceLink || !editLink || !updateLink || !clearStagedBtn ||
    !clearStagedEmptyBtn || !stagedList || !permanentList || !batchWorkflowLink || !batchCommand ||
    !batchCopyBtn || !batchCopyJsonBtn || !batchStatus
  ) {
    return;
  }

  const state = {
    initialized: false,
    allPapers: [],
    paperById: {},
    pending: [],
    currentIndex: 0,
    staged: {},
    permanent: {},
    repoSlug: detectRepoSlug(),
  };

  function collapseWs(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function normalizeUpdatesPayload(value) {
    let parsed = value;
    if (typeof parsed === 'string') {
      const text = parsed.trim();
      if (!text) return {};
      try {
        parsed = JSON.parse(text);
      } catch {
        return {};
      }
    }

    if (!isPlainObject(parsed)) return {};

    const out = {};
    for (const [key, item] of Object.entries(parsed)) {
      const field = collapseWs(key);
      if (!field) continue;
      out[field] = item;
    }
    return out;
  }

  function detectRepoSlug() {
    const host = String(window.location.hostname || '').toLowerCase();
    const pathParts = String(window.location.pathname || '').split('/').filter(Boolean);
    if (host.endsWith('.github.io') && pathParts.length >= 1) {
      const owner = host.split('.')[0];
      const repo = pathParts[0];
      if (owner && repo) return `${owner}/${repo}`;
    }
    return 'llvm/library';
  }

  function shellSingleQuote(value) {
    return String(value || '').replace(/'/g, "'\"'\"'");
  }

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
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
    if (!match) return '';
    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  function formatIsoDate(value) {
    const iso = normalizeIsoDate(value);
    if (!iso) return '';
    const pieces = iso.split('-').map((piece) => Number.parseInt(piece, 10));
    const year = pieces[0];
    const month = pieces[1];
    const day = pieces[2];
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

  function normalizeTimestamp(raw) {
    const text = String(raw || '').trim();
    if (!text) return '';
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString();
  }

  function isBlogPaper(paper) {
    const source = String((paper && paper.source) || '').trim().toLowerCase();
    const type = String((paper && paper.type) || '').trim().toLowerCase();
    return BLOG_SOURCE_SLUGS.has(source) || type === 'blog' || type === 'blog-post';
  }

  function normalizePaperRecord(rawPaper) {
    if (!rawPaper || typeof rawPaper !== 'object') return null;

    const id = collapseWs(rawPaper.id || '');
    const title = collapseWs(rawPaper.title || '');
    if (!id || !title) return null;

    const year = collapseWs(rawPaper.year || '');
    const publishedDate = normalizeIsoDate(rawPaper.publishedDate || rawPaper.publishDate || rawPaper.date);
    const authors = Array.isArray(rawPaper.authors)
      ? rawPaper.authors
        .map((author) => {
          if (!author || typeof author !== 'object') return null;
          const name = collapseWs(author.name || '');
          const affiliation = collapseWs(author.affiliation || '');
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
      publication: collapseWs(rawPaper.publication || ''),
      venue: collapseWs(rawPaper.venue || ''),
      abstract: collapseWs(rawPaper.abstract || ''),
      type: collapseWs(rawPaper.type || ''),
      source: collapseWs(rawPaper.source || ''),
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

  function setBatchStatus(message, kind) {
    batchStatus.textContent = message || '';
    batchStatus.classList.remove('error', 'success');
    if (kind) batchStatus.classList.add(kind);
  }

  function setReviewStatus(message, kind) {
    reviewStatus.textContent = message || '';
    reviewStatus.classList.remove('error', 'success');
    if (kind) reviewStatus.classList.add(kind);
  }

  function formatAffiliation(value) {
    return String(value || '')
      .split('|')
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' | ');
  }

  function previewAbstract(paper) {
    const text = String((paper && paper.abstract) || '').trim();
    if (!text) return 'No abstract available.';
    if (text.length <= 480) return text;
    const short = text.slice(0, 480).replace(/\s+\S*$/, '').trim();
    return `${short}...`;
  }

  function formatTimestamp(value) {
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

  function setOptionalLink(anchor, href) {
    const safe = sanitizeExternalUrl(href || '');
    if (!safe) {
      anchor.classList.add('hidden');
      anchor.removeAttribute('href');
      return;
    }
    anchor.href = safe;
    anchor.classList.remove('hidden');
  }

  function buildPaperAdminLinks(paper) {
    const paperId = collapseWs((paper && paper.id) || '');
    const editHref = paperId ? `papers/edit.html?id=${encodeURIComponent(paperId)}` : '';
    const sourceUrl = sanitizeExternalUrl(paper && paper.sourceUrl);
    const paperUrl = sanitizeExternalUrl(paper && paper.paperUrl);
    const updateSourceUrl = sourceUrl || paperUrl;
    const updateHref = (paperId && updateSourceUrl)
      ? `papers/edit.html?id=${encodeURIComponent(paperId)}&source_url=${encodeURIComponent(updateSourceUrl)}&return_to=review`
      : '';
    return { editHref, updateHref };
  }

  function loadStagedState() {
    const fallback = { staged: {} };
    const raw = storageGet(STAGED_STATE_KEY);
    if (!raw) return fallback;

    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return fallback;
      const staged = parsed.staged && typeof parsed.staged === 'object' ? parsed.staged : {};
      const normalized = {};
      for (const [id, entry] of Object.entries(staged)) {
        const paperId = collapseWs(id || '');
        if (!paperId) continue;
        if (!entry || typeof entry !== 'object') continue;
        normalized[paperId] = {
          stagedAt: normalizeTimestamp(entry.stagedAt) || new Date(0).toISOString(),
          title: collapseWs(entry.title || ''),
          year: collapseWs(entry.year || ''),
          updates: normalizeUpdatesPayload(entry.updates || entry.updates_json),
        };
      }
      return { staged: normalized };
    } catch {
      return fallback;
    }
  }

  function saveStagedState() {
    storageSet(STAGED_STATE_KEY, JSON.stringify({ staged: state.staged }));
  }

  function isPermanentReviewed(paperId) {
    return !!(paperId && state.permanent[paperId]);
  }

  function isStaged(paperId) {
    return !!(paperId && state.staged[paperId]);
  }

  function fetchJsonCandidateUrls() {
    const base = document.baseURI || window.location.href;
    return [...new Set(REVIEWED_JSON_CANDIDATES.map((ref) => {
      try {
        return new URL(ref, base).toString();
      } catch {
        return ref;
      }
    }))];
  }

  function normalizeReviewedPayload(payload) {
    if (!payload || typeof payload !== 'object') return {};
    const reviews = Array.isArray(payload.reviews)
      ? payload.reviews
      : (Array.isArray(payload.reviewedPapers) ? payload.reviewedPapers : []);

    const out = {};
    for (const item of reviews) {
      if (!item || typeof item !== 'object') continue;
      const id = collapseWs(item.id || '');
      if (!id) continue;
      out[id] = {
        reviewedAt: normalizeTimestamp(item.reviewedAt || item.updatedAt) || '',
        title: collapseWs(item.title || ''),
        year: collapseWs(item.year || ''),
      };
    }
    return out;
  }

  async function loadPermanentReviewedState() {
    const attempts = fetchJsonCandidateUrls();
    const failures = [];

    for (const url of attempts) {
      try {
        const response = await fetch(url, { cache: 'default' });
        if (!response.ok) {
          failures.push(`${url}: HTTP ${response.status}`);
          continue;
        }
        const payload = await response.json();
        return normalizeReviewedPayload(payload);
      } catch (err) {
        failures.push(`${url}: ${err && err.message ? err.message : err}`);
      }
    }

    if (failures.length) {
      setBatchStatus('Permanent review data is unavailable. Queue is using empty permanent state.', 'error');
    }
    return {};
  }

  function rebuildPendingQueue() {
    state.pending = state.allPapers.filter((paper) => !isPermanentReviewed(paper.id) && !isStaged(paper.id));
    if (state.currentIndex >= state.pending.length) state.currentIndex = 0;
    if (state.currentIndex < 0) state.currentIndex = 0;
  }

  function stagedEntriesSorted() {
    return Object.entries(state.staged)
      .map(([id, entry]) => ({
        id,
        stagedAt: String((entry && entry.stagedAt) || ''),
        title: collapseWs((entry && entry.title) || ''),
        year: collapseWs((entry && entry.year) || ''),
        updates: normalizeUpdatesPayload(entry && entry.updates),
      }))
      .map((entry) => ({
        ...entry,
        updateFieldCount: Object.keys(entry.updates || {}).length,
      }))
      .sort((a, b) => String(b.stagedAt || '').localeCompare(String(a.stagedAt || '')));
  }

  function permanentEntriesSorted() {
    return Object.entries(state.permanent)
      .map(([id, entry]) => {
        const paper = state.paperById[id] || null;
        const title = collapseWs((entry && entry.title) || '') || collapseWs((paper && paper.title) || '') || id;
        const year = collapseWs((entry && entry.year) || '') || collapseWs((paper && paper.year) || '');
        return {
          id,
          reviewedAt: String((entry && entry.reviewedAt) || ''),
          title,
          year,
        };
      })
      .sort((a, b) => String(b.reviewedAt || '').localeCompare(String(a.reviewedAt || '')));
  }

  function currentPaper() {
    if (!state.pending.length) return null;
    return state.pending[state.currentIndex] || state.pending[0] || null;
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

  function renderStagedList() {
    const entries = stagedEntriesSorted();
    if (!entries.length) {
      stagedList.innerHTML = '<li class="review-recent-empty">No staged reviews. Mark papers to build a PR batch.</li>';
      return;
    }

    stagedList.innerHTML = entries
      .map((entry) => {
        const detailHref = `papers/paper.html?id=${encodeURIComponent(entry.id)}&from=papers`;
        const label = entry.year ? `${entry.title} (${entry.year})` : entry.title;
        const stagedAtText = formatTimestamp(entry.stagedAt);
        const pendingLabel = entry.updateFieldCount
          ? `Pending PR + ${entry.updateFieldCount} field update${entry.updateFieldCount === 1 ? '' : 's'}`
          : 'Pending PR';
        return `
          <li class="review-recent-item review-recent-item--staged">
            <span class="review-pending-pill">${escapeHtml(pendingLabel)}</span>
            <a href="${detailHref}">${escapeHtml(label)}</a>
            <button type="button" class="review-remove-staged" data-review-id="${escapeHtml(entry.id)}" aria-label="Remove ${escapeHtml(entry.title)} from staged batch">Remove</button>
            ${stagedAtText ? `<time datetime="${escapeHtml(entry.stagedAt)}">${escapeHtml(stagedAtText)}</time>` : '<span></span>'}
          </li>`;
      })
      .join('');
  }

  function renderPermanentList() {
    const entries = permanentEntriesSorted().slice(0, RECENT_REVIEW_LIMIT);
    if (!entries.length) {
      permanentList.innerHTML = '<li class="review-recent-empty">No permanently reviewed papers yet.</li>';
      return;
    }

    permanentList.innerHTML = entries
      .map((entry) => {
        const detailHref = `papers/paper.html?id=${encodeURIComponent(entry.id)}&from=papers`;
        const label = entry.year ? `${entry.title} (${entry.year})` : entry.title;
        const reviewedAtText = formatTimestamp(entry.reviewedAt);
        return `
          <li class="review-recent-item">
            <span class="review-check" aria-hidden="true">✓</span>
            <a href="${detailHref}">${escapeHtml(label)}</a>
            ${reviewedAtText ? `<time datetime="${escapeHtml(entry.reviewedAt)}">${escapeHtml(reviewedAtText)}</time>` : '<span></span>'}
          </li>`;
      })
      .join('');
  }

  function stagedBatchEntriesForCommand() {
    return stagedEntriesSorted().map((entry) => {
      const out = { id: entry.id };
      if (entry.updateFieldCount > 0) out.updates = entry.updates;
      return out;
    });
  }

  function buildBatchCommandFromEntries(entries) {
    const encodedBatch = JSON.stringify(entries);
    return `gh workflow run paper-review-batch-pr.yml --repo ${state.repoSlug} --ref main -f review_batch_json='${shellSingleQuote(encodedBatch)}'`;
  }

  function renderBatchControls() {
    const workflowUrl = `https://github.com/${state.repoSlug}/actions/workflows/paper-review-batch-pr.yml`;
    batchWorkflowLink.href = workflowUrl;

    const stagedBatch = stagedBatchEntriesForCommand();
    if (!stagedBatch.length) {
      batchCommand.textContent = `gh workflow run paper-review-batch-pr.yml --repo ${state.repoSlug} --ref main -f review_batch_json='[{"id":"openalex-w1234567890"}]'`;
      batchCopyBtn.disabled = true;
      batchCopyJsonBtn.disabled = true;
      return;
    }

    batchCommand.textContent = buildBatchCommandFromEntries(stagedBatch);
    batchCopyBtn.disabled = false;
    batchCopyJsonBtn.disabled = false;
  }

  function renderStats() {
    const total = state.allPapers.length;
    let permanent = 0;
    for (const paper of state.allPapers) {
      if (isPermanentReviewed(paper.id)) permanent += 1;
    }

    const staged = Object.keys(state.staged).length;
    const pending = state.pending.length;
    reviewStats.textContent = `Pending ${pending.toLocaleString()} | Permanent ${permanent.toLocaleString()} | Staged ${staged.toLocaleString()} | Total ${total.toLocaleString()}`;

    if (!pending) {
      reviewPosition.textContent = 'Queue complete';
      emptyCopy.textContent = staged
        ? 'No pending papers remain. Submit your staged review PR batch to make checkmarks permanent.'
        : 'No pending papers remain.';
      return;
    }

    reviewPosition.textContent = `Queue position ${state.currentIndex + 1} of ${pending.toLocaleString()} pending`;
  }

  function renderQueue() {
    renderStats();
    renderStagedList();
    renderPermanentList();
    renderBatchControls();

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

  function markCurrentStaged() {
    const paper = currentPaper();
    if (!paper) {
      setReviewStatus('No pending paper to review.', 'error');
      return;
    }

    state.staged[paper.id] = {
      stagedAt: new Date().toISOString(),
      title: paper.title,
      year: paper.year,
      updates: {},
    };
    saveStagedState();
    rebuildPendingQueue();
    setReviewStatus(`Staged for PR batch: ${paper.title}`, 'success');
    renderQueue();
  }

  function removeFromStaged(id) {
    const paperId = collapseWs(id || '');
    if (!paperId || !state.staged[paperId]) return;
    delete state.staged[paperId];
    saveStagedState();
    rebuildPendingQueue();
    setReviewStatus('Removed paper from staged batch.', 'success');
    renderQueue();
  }

  function clearStagedBatch() {
    if (!Object.keys(state.staged).length) {
      setReviewStatus('No staged review batch to clear.', '');
      return;
    }

    const confirmed = window.confirm('Clear the staged review batch for this browser?');
    if (!confirmed) return;

    state.staged = {};
    saveStagedState();
    rebuildPendingQueue();
    setReviewStatus('Staged review batch was cleared.', 'success');
    renderQueue();
  }

  async function copyBatchCommand() {
    const command = String(batchCommand.textContent || '').trim();
    if (!command || batchCopyBtn.disabled) {
      setBatchStatus('Stage at least one reviewed paper first.', 'error');
      return;
    }

    try {
      await navigator.clipboard.writeText(command);
      setBatchStatus('Workflow command copied.', 'success');
    } catch {
      setBatchStatus('Clipboard write failed. Copy command manually.', 'error');
    }
  }

  async function copyBatchJson() {
    const entries = stagedBatchEntriesForCommand();
    if (!entries.length) {
      setBatchStatus('Stage at least one reviewed paper first.', 'error');
      return;
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(entries));
      setBatchStatus('review_batch_json copied.', 'success');
    } catch {
      setBatchStatus('Clipboard write failed. Copy batch JSON manually.', 'error');
    }
  }

  function sanitizeStagedState() {
    let changed = false;

    for (const id of Object.keys(state.staged)) {
      if (!state.paperById[id] || isPermanentReviewed(id)) {
        delete state.staged[id];
        changed = true;
      }
    }

    if (changed) saveStagedState();
  }

  function consumeReturnMessage() {
    try {
      const message = String(window.sessionStorage.getItem(REVIEW_RETURN_MESSAGE_KEY) || '').trim();
      if (!message) return '';
      window.sessionStorage.removeItem(REVIEW_RETURN_MESSAGE_KEY);
      return message;
    } catch {
      return '';
    }
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

    state.paperById = {};
    for (const paper of state.allPapers) {
      state.paperById[paper.id] = paper;
    }

    state.permanent = await loadPermanentReviewedState();
    state.staged = loadStagedState().staged;
    sanitizeStagedState();
    rebuildPendingQueue();
    state.initialized = true;
  }

  async function init() {
    try {
      await ensureDataLoaded();
      reviewShell.classList.remove('hidden');
      renderQueue();
      const returnMessage = consumeReturnMessage();
      if (returnMessage) setReviewStatus(returnMessage, 'success');
      else setReviewStatus('', '');
      setBatchStatus('Permanent checkmarks are applied only after the review-batch PR is merged.', '');
    } catch (err) {
      const message = err && err.message ? err.message : 'Failed to initialize review queue.';
      setReviewStatus(message, 'error');
      setBatchStatus(message, 'error');
    }
  }

  markBtn.addEventListener('click', markCurrentStaged);
  nextBtn.addEventListener('click', moveToNext);
  clearStagedBtn.addEventListener('click', clearStagedBatch);
  clearStagedEmptyBtn.addEventListener('click', clearStagedBatch);
  batchCopyBtn.addEventListener('click', copyBatchCommand);
  batchCopyJsonBtn.addEventListener('click', copyBatchJson);
  stagedList.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.classList.contains('review-remove-staged')) return;
    const id = collapseWs(target.getAttribute('data-review-id') || '');
    if (!id) return;
    removeFromStaged(id);
  });

  batchCopyBtn.disabled = true;
  batchCopyJsonBtn.disabled = true;
  reviewShell.classList.remove('hidden');
  init();
})();

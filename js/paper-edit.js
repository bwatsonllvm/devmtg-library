/*
 * paper-edit.js
 * Load an existing paper, show original values, and generate updates_json for edit workflow.
 */
(function () {
  'use strict';

  const idInput = document.getElementById('paper-edit-id-input');
  const loadBtn = document.getElementById('paper-edit-load-btn');
  const loadStatus = document.getElementById('paper-edit-load-status');

  const originalCard = document.getElementById('paper-edit-original-card');
  const originalPre = document.getElementById('paper-edit-original-pre');

  const changeCard = document.getElementById('paper-edit-change-card');
  const generateBtn = document.getElementById('paper-edit-generate-btn');
  const resetBtn = document.getElementById('paper-edit-reset-btn');
  const genStatus = document.getElementById('paper-edit-generate-status');

  const outputCard = document.getElementById('paper-edit-output-card');
  const updatesJsonPre = document.getElementById('paper-edit-updates-json');
  const commandPre = document.getElementById('paper-edit-command');
  const copyJsonBtn = document.getElementById('paper-edit-copy-json-btn');
  const copyCommandBtn = document.getElementById('paper-edit-copy-command-btn');
  const workflowLink = document.getElementById('paper-edit-workflow-link');

  if (!idInput || !loadBtn || !loadStatus || !originalCard || !originalPre || !changeCard || !generateBtn || !resetBtn || !genStatus || !outputCard || !updatesJsonPre || !commandPre || !copyJsonBtn || !copyCommandBtn || !workflowLink) {
    return;
  }

  const fields = {
    title: document.getElementById('pe-title'),
    year: document.getElementById('pe-year'),
    paperUrl: document.getElementById('pe-paper-url'),
    sourceUrl: document.getElementById('pe-source-url'),
    publication: document.getElementById('pe-publication'),
    venue: document.getElementById('pe-venue'),
    tags: document.getElementById('pe-tags'),
    keywords: document.getElementById('pe-keywords'),
    matchedAuthors: document.getElementById('pe-matched-authors'),
    matchedSubprojects: document.getElementById('pe-matched-subprojects'),
    authors: document.getElementById('pe-authors'),
    abstract: document.getElementById('pe-abstract'),
  };

  function setStatus(el, message, kind) {
    if (!el) return;
    el.textContent = message || '';
    el.classList.remove('error', 'success');
    if (kind) el.classList.add(kind);
  }

  function parseIdInput(raw) {
    const text = String(raw || '').trim();
    if (!text) return '';
    if (!/^https?:\/\//i.test(text)) return text;
    try {
      const url = new URL(text);
      const id = String(url.searchParams.get('id') || '').trim();
      return id || text;
    } catch (_) {
      return text;
    }
  }

  function normalizeListInput(raw) {
    return String(raw || '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function authorsToLines(authors) {
    const list = Array.isArray(authors) ? authors : [];
    return list
      .map((a) => {
        const name = String(a && a.name ? a.name : '').trim();
        if (!name) return '';
        const affiliation = String(a && a.affiliation ? a.affiliation : '').trim();
        if (!affiliation) return name;
        const aff = affiliation
          .split('|')
          .map((part) => part.trim())
          .filter(Boolean)
          .join(' ; ');
        return `${name} | ${aff}`;
      })
      .filter(Boolean)
      .join('\n');
  }

  function parseAuthorsText(raw) {
    return String(raw || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        if (!line.includes('|')) return { name: line };
        const parts = line.split('|');
        const name = String(parts.shift() || '').trim();
        const right = String(parts.join('|') || '').trim();
        const author = { name };
        if (right) {
          const aff = right
            .split(';')
            .map((part) => part.trim())
            .filter(Boolean)
            .join(' | ');
          if (aff) author.affiliation = aff;
        }
        return author;
      })
      .filter((a) => a && a.name);
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

  const repoSlug = detectRepoSlug();
  const workflowUrl = `https://github.com/${repoSlug}/actions/workflows/manual-paper-edit-pr.yml`;
  workflowLink.href = workflowUrl;

  let paperCache = null;
  let originalPaper = null;
  let currentPaperId = '';
  let currentUpdatesMinified = '{}';

  async function ensurePapers() {
    if (paperCache) return paperCache;
    if (typeof window.loadPaperData !== 'function') {
      throw new Error('Paper loader is unavailable. Ensure js/papers-data.js is loaded.');
    }
    const payload = await window.loadPaperData();
    const papers = Array.isArray(payload && payload.papers) ? payload.papers : [];
    paperCache = papers;
    return paperCache;
  }

  function getOriginalPreview(paper) {
    const preview = {
      id: paper.id || '',
      title: paper.title || '',
      year: paper.year || '',
      paperUrl: paper.paperUrl || '',
      sourceUrl: paper.sourceUrl || '',
      publication: paper.publication || '',
      venue: paper.venue || '',
      tags: Array.isArray(paper.tags) ? paper.tags : [],
      keywords: Array.isArray(paper.keywords) ? paper.keywords : [],
      matchedAuthors: Array.isArray(paper.matchedAuthors) ? paper.matchedAuthors : [],
      matchedSubprojects: Array.isArray(paper.matchedSubprojects) ? paper.matchedSubprojects : [],
      authors: Array.isArray(paper.authors) ? paper.authors : [],
      abstract: paper.abstract || '',
    };
    return JSON.stringify(preview, null, 2);
  }

  function setFormFromOriginal(paper) {
    fields.title.value = String(paper.title || '');
    fields.year.value = String(paper.year || '');
    fields.paperUrl.value = String(paper.paperUrl || '');
    fields.sourceUrl.value = String(paper.sourceUrl || '');
    fields.publication.value = String(paper.publication || '');
    fields.venue.value = String(paper.venue || '');
    fields.tags.value = (Array.isArray(paper.tags) ? paper.tags : []).join(', ');
    fields.keywords.value = (Array.isArray(paper.keywords) ? paper.keywords : []).join(', ');
    fields.matchedAuthors.value = (Array.isArray(paper.matchedAuthors) ? paper.matchedAuthors : []).join(', ');
    fields.matchedSubprojects.value = (Array.isArray(paper.matchedSubprojects) ? paper.matchedSubprojects : []).join(', ');
    fields.authors.value = authorsToLines(Array.isArray(paper.authors) ? paper.authors : []);
    fields.abstract.value = String(paper.abstract || '');
  }

  function normalizeForCompare(value) {
    return JSON.stringify(value === undefined ? null : value);
  }

  function buildUpdatesFromForm() {
    if (!originalPaper) throw new Error('Load a paper first.');
    const updates = {};

    const candidate = {
      title: String(fields.title.value || '').trim(),
      year: String(fields.year.value || '').trim(),
      paperUrl: String(fields.paperUrl.value || '').trim(),
      sourceUrl: String(fields.sourceUrl.value || '').trim(),
      publication: String(fields.publication.value || '').trim(),
      venue: String(fields.venue.value || '').trim(),
      tags: normalizeListInput(fields.tags.value),
      keywords: normalizeListInput(fields.keywords.value),
      matchedAuthors: normalizeListInput(fields.matchedAuthors.value),
      matchedSubprojects: normalizeListInput(fields.matchedSubprojects.value),
      authors: parseAuthorsText(fields.authors.value),
      abstract: String(fields.abstract.value || '').trim(),
    };

    if (normalizeForCompare(candidate.title) !== normalizeForCompare(String(originalPaper.title || ''))) updates.title = candidate.title;
    if (normalizeForCompare(candidate.year) !== normalizeForCompare(String(originalPaper.year || ''))) updates.year = candidate.year;
    if (normalizeForCompare(candidate.paperUrl) !== normalizeForCompare(String(originalPaper.paperUrl || ''))) updates.paperUrl = candidate.paperUrl;
    if (normalizeForCompare(candidate.sourceUrl) !== normalizeForCompare(String(originalPaper.sourceUrl || ''))) updates.sourceUrl = candidate.sourceUrl;
    if (normalizeForCompare(candidate.publication) !== normalizeForCompare(String(originalPaper.publication || ''))) updates.publication = candidate.publication;
    if (normalizeForCompare(candidate.venue) !== normalizeForCompare(String(originalPaper.venue || ''))) updates.venue = candidate.venue;
    if (normalizeForCompare(candidate.tags) !== normalizeForCompare(Array.isArray(originalPaper.tags) ? originalPaper.tags : [])) updates.tags = candidate.tags;
    if (normalizeForCompare(candidate.keywords) !== normalizeForCompare(Array.isArray(originalPaper.keywords) ? originalPaper.keywords : [])) updates.keywords = candidate.keywords;
    if (normalizeForCompare(candidate.matchedAuthors) !== normalizeForCompare(Array.isArray(originalPaper.matchedAuthors) ? originalPaper.matchedAuthors : [])) updates.matchedAuthors = candidate.matchedAuthors;
    if (normalizeForCompare(candidate.matchedSubprojects) !== normalizeForCompare(Array.isArray(originalPaper.matchedSubprojects) ? originalPaper.matchedSubprojects : [])) updates.matchedSubprojects = candidate.matchedSubprojects;
    if (normalizeForCompare(candidate.authors) !== normalizeForCompare(Array.isArray(originalPaper.authors) ? originalPaper.authors : [])) updates.authors = candidate.authors;
    if (normalizeForCompare(candidate.abstract) !== normalizeForCompare(String(originalPaper.abstract || ''))) updates.abstract = candidate.abstract;

    return updates;
  }

  async function loadPaper() {
    setStatus(loadStatus, '', '');
    setStatus(genStatus, '', '');
    const requested = parseIdInput(idInput.value);
    if (!requested) {
      setStatus(loadStatus, 'Enter a paper id or paper URL.', 'error');
      return;
    }
    try {
      const papers = await ensurePapers();
      let found = papers.find((p) => String(p && p.id || '') === requested);
      if (!found) {
        const needle = requested.toLowerCase();
        found = papers.find((p) => String(p && p.id || '').toLowerCase() === needle);
      }
      if (!found) {
        setStatus(loadStatus, `Paper not found: ${requested}`, 'error');
        return;
      }
      originalPaper = JSON.parse(JSON.stringify(found));
      currentPaperId = String(found.id || '');
      originalPre.textContent = getOriginalPreview(found);
      setFormFromOriginal(found);
      originalCard.classList.remove('hidden');
      changeCard.classList.remove('hidden');
      outputCard.classList.add('hidden');
      updatesJsonPre.textContent = '{}';
      commandPre.textContent = '';
      currentUpdatesMinified = '{}';
      setStatus(loadStatus, `Loaded ${currentPaperId}`, 'success');
    } catch (err) {
      setStatus(loadStatus, err && err.message ? err.message : 'Failed to load paper data.', 'error');
    }
  }

  function generateUpdatesPayload() {
    setStatus(genStatus, '', '');
    if (!originalPaper || !currentPaperId) {
      setStatus(genStatus, 'Load a paper first.', 'error');
      return;
    }
    try {
      const updates = buildUpdatesFromForm();
      const keys = Object.keys(updates);
      if (!keys.length) {
        setStatus(genStatus, 'No changes detected.', 'error');
        return;
      }
      const pretty = JSON.stringify(updates, null, 2);
      currentUpdatesMinified = JSON.stringify(updates);
      updatesJsonPre.textContent = pretty;
      commandPre.textContent = `gh workflow run manual-paper-edit-pr.yml --repo ${repoSlug} --ref main -f paper_id='${shellSingleQuote(currentPaperId)}' -f updates_json='${shellSingleQuote(currentUpdatesMinified)}'`;
      outputCard.classList.remove('hidden');
      setStatus(genStatus, `Generated updates_json with ${keys.length} changed field(s).`, 'success');
    } catch (err) {
      setStatus(genStatus, err && err.message ? err.message : 'Failed to generate updates_json.', 'error');
    }
  }

  async function copyJson() {
    if (!currentUpdatesMinified || currentUpdatesMinified === '{}') {
      setStatus(genStatus, 'Generate updates_json first.', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(currentUpdatesMinified);
      setStatus(genStatus, 'updates_json copied.', 'success');
    } catch (_) {
      setStatus(genStatus, 'Clipboard write failed. Copy from output box.', 'error');
    }
  }

  async function copyCommand() {
    const command = String(commandPre.textContent || '').trim();
    if (!command) {
      setStatus(genStatus, 'Generate updates_json first.', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(command);
      setStatus(genStatus, 'Workflow command copied.', 'success');
    } catch (_) {
      setStatus(genStatus, 'Clipboard write failed. Copy from command box.', 'error');
    }
  }

  loadBtn.addEventListener('click', loadPaper);
  generateBtn.addEventListener('click', generateUpdatesPayload);
  copyJsonBtn.addEventListener('click', copyJson);
  copyCommandBtn.addEventListener('click', copyCommand);
  resetBtn.addEventListener('click', function () {
    if (!originalPaper) return;
    window.setTimeout(function () {
      setFormFromOriginal(originalPaper);
      setStatus(genStatus, 'Reset changes back to original values.', 'success');
    }, 0);
  });

  const query = new URLSearchParams(window.location.search || '');
  const idFromQuery = String(query.get('id') || '').trim();
  if (idFromQuery) {
    idInput.value = idFromQuery;
    loadPaper();
  }
})();

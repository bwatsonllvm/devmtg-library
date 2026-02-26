/*
 * paper-edit.js
 * Load an existing paper, preview URL-derived diffs, and generate updates_json for edit workflow.
 */
(function () {
  'use strict';

  const DIRECT_PDF_URL_RE = /\.pdf(?:$|[?#])|\/pdf(?:$|[/?#])|[?&](?:format|type|output)=pdf(?:$|[&#])|[?&]filename=[^&#]*\.pdf(?:$|[&#])/i;

  const idInput = document.getElementById('paper-edit-id-input');
  const loadBtn = document.getElementById('paper-edit-load-btn');
  const loadStatus = document.getElementById('paper-edit-load-status');

  const urlCard = document.getElementById('paper-edit-url-card');
  const urlInput = document.getElementById('paper-edit-url-input');
  const urlPreviewBtn = document.getElementById('paper-edit-url-preview-btn');
  const urlStatus = document.getElementById('paper-edit-url-status');
  const urlDiffShell = document.getElementById('paper-edit-url-diff-shell');
  const urlDiffList = document.getElementById('paper-edit-url-diff-list');
  const urlApplyBtn = document.getElementById('paper-edit-url-apply-btn');

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

  if (
    !idInput || !loadBtn || !loadStatus || !urlCard || !urlInput || !urlPreviewBtn || !urlStatus ||
    !urlDiffShell || !urlDiffList || !urlApplyBtn || !originalCard || !originalPre || !changeCard ||
    !generateBtn || !resetBtn || !genStatus || !outputCard || !updatesJsonPre || !commandPre ||
    !copyJsonBtn || !copyCommandBtn || !workflowLink
  ) {
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

  if (Object.values(fields).some((el) => !el)) return;

  function setStatus(el, message, kind) {
    if (!el) return;
    el.textContent = message || '';
    el.classList.remove('error', 'success');
    if (kind) el.classList.add(kind);
  }

  function collapseWs(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function sanitizeExternalUrl(value) {
    const raw = collapseWs(value);
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

  function normalizeYear(value) {
    const raw = collapseWs(value);
    if (!raw) return '';
    if (/^\d{4}$/.test(raw)) return raw;
    const match = raw.match(/\b(\d{4})\b/);
    return match ? match[1] : '';
  }

  function extractDoi(value) {
    const raw = collapseWs(value).toLowerCase();
    if (!raw) return '';
    const stripped = raw
      .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '')
      .replace(/^doi:\s*/, '');
    const match = stripped.match(/(10\.\d{4,9}\/\S+)/i);
    if (!match || !match[1]) return '';
    return String(match[1]).replace(/[.,;)]$/, '');
  }

  function isLikelyPdfUrl(value) {
    return DIRECT_PDF_URL_RE.test(String(value || '').trim());
  }

  function parseIdInput(raw) {
    const text = collapseWs(raw);
    if (!text) return '';
    if (!/^https?:\/\//i.test(text)) return text;
    try {
      const url = new URL(text);
      const id = collapseWs(url.searchParams.get('id') || '');
      return id || text;
    } catch {
      return text;
    }
  }

  function normalizeListInput(raw) {
    return String(raw || '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function dedupeCaseInsensitive(values) {
    const out = [];
    const seen = new Set();
    for (const value of values || []) {
      const text = collapseWs(value);
      const key = text.toLowerCase();
      if (!text || seen.has(key)) continue;
      seen.add(key);
      out.push(text);
    }
    return out;
  }

  function normalizeAuthorAffiliation(value) {
    return String(value || '')
      .split('|')
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' | ');
  }

  function authorsToLines(authors) {
    const list = Array.isArray(authors) ? authors : [];
    return list
      .map((author) => {
        const name = collapseWs(author && author.name ? author.name : '');
        if (!name) return '';
        const affiliation = normalizeAuthorAffiliation(author && author.affiliation ? author.affiliation : '');
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
        if (!line.includes('|')) return { name: collapseWs(line) };
        const parts = line.split('|');
        const name = collapseWs(parts.shift() || '');
        const right = collapseWs(parts.join('|') || '');
        const author = { name };
        if (right) {
          const affiliation = right
            .split(';')
            .map((part) => part.trim())
            .filter(Boolean)
            .join(' | ');
          if (affiliation) author.affiliation = affiliation;
        }
        return author;
      })
      .filter((author) => author && author.name);
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

  function normalizeForCompare(value) {
    return JSON.stringify(value === undefined ? null : value);
  }

  const repoSlug = detectRepoSlug();
  const workflowUrl = `https://github.com/${repoSlug}/actions/workflows/manual-paper-edit-pr.yml`;
  workflowLink.href = workflowUrl;

  let paperCache = null;
  let originalPaper = null;
  let currentPaperId = '';
  let currentUpdatesMinified = '{}';
  let pendingUrlCandidatePaper = null;
  let pendingUrlUpdates = {};

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

  function setFormFromPaper(paper) {
    fields.title.value = String(paper && paper.title || '');
    fields.year.value = String(paper && paper.year || '');
    fields.paperUrl.value = String(paper && paper.paperUrl || '');
    fields.sourceUrl.value = String(paper && paper.sourceUrl || '');
    fields.publication.value = String(paper && paper.publication || '');
    fields.venue.value = String(paper && paper.venue || '');
    fields.tags.value = (Array.isArray(paper && paper.tags) ? paper.tags : []).join(', ');
    fields.keywords.value = (Array.isArray(paper && paper.keywords) ? paper.keywords : []).join(', ');
    fields.matchedAuthors.value = (Array.isArray(paper && paper.matchedAuthors) ? paper.matchedAuthors : []).join(', ');
    fields.matchedSubprojects.value = (Array.isArray(paper && paper.matchedSubprojects) ? paper.matchedSubprojects : []).join(', ');
    fields.authors.value = authorsToLines(Array.isArray(paper && paper.authors) ? paper.authors : []);
    fields.abstract.value = String(paper && paper.abstract || '');
  }

  function buildCandidateFromForm() {
    return {
      title: collapseWs(fields.title.value),
      year: collapseWs(fields.year.value),
      paperUrl: collapseWs(fields.paperUrl.value),
      sourceUrl: collapseWs(fields.sourceUrl.value),
      publication: collapseWs(fields.publication.value),
      venue: collapseWs(fields.venue.value),
      tags: normalizeListInput(fields.tags.value),
      keywords: normalizeListInput(fields.keywords.value),
      matchedAuthors: normalizeListInput(fields.matchedAuthors.value),
      matchedSubprojects: normalizeListInput(fields.matchedSubprojects.value),
      authors: parseAuthorsText(fields.authors.value),
      abstract: collapseWs(fields.abstract.value),
    };
  }

  function buildUpdatesFromCandidate(candidate) {
    if (!originalPaper) throw new Error('Load a paper first.');
    const updates = {};

    const original = {
      title: String(originalPaper.title || ''),
      year: String(originalPaper.year || ''),
      paperUrl: String(originalPaper.paperUrl || ''),
      sourceUrl: String(originalPaper.sourceUrl || ''),
      publication: String(originalPaper.publication || ''),
      venue: String(originalPaper.venue || ''),
      tags: Array.isArray(originalPaper.tags) ? originalPaper.tags : [],
      keywords: Array.isArray(originalPaper.keywords) ? originalPaper.keywords : [],
      matchedAuthors: Array.isArray(originalPaper.matchedAuthors) ? originalPaper.matchedAuthors : [],
      matchedSubprojects: Array.isArray(originalPaper.matchedSubprojects) ? originalPaper.matchedSubprojects : [],
      authors: Array.isArray(originalPaper.authors) ? originalPaper.authors : [],
      abstract: String(originalPaper.abstract || ''),
    };

    if (normalizeForCompare(candidate.title) !== normalizeForCompare(original.title)) updates.title = candidate.title;
    if (normalizeForCompare(candidate.year) !== normalizeForCompare(original.year)) updates.year = candidate.year;
    if (normalizeForCompare(candidate.paperUrl) !== normalizeForCompare(original.paperUrl)) updates.paperUrl = candidate.paperUrl;
    if (normalizeForCompare(candidate.sourceUrl) !== normalizeForCompare(original.sourceUrl)) updates.sourceUrl = candidate.sourceUrl;
    if (normalizeForCompare(candidate.publication) !== normalizeForCompare(original.publication)) updates.publication = candidate.publication;
    if (normalizeForCompare(candidate.venue) !== normalizeForCompare(original.venue)) updates.venue = candidate.venue;
    if (normalizeForCompare(candidate.tags) !== normalizeForCompare(original.tags)) updates.tags = candidate.tags;
    if (normalizeForCompare(candidate.keywords) !== normalizeForCompare(original.keywords)) updates.keywords = candidate.keywords;
    if (normalizeForCompare(candidate.matchedAuthors) !== normalizeForCompare(original.matchedAuthors)) updates.matchedAuthors = candidate.matchedAuthors;
    if (normalizeForCompare(candidate.matchedSubprojects) !== normalizeForCompare(original.matchedSubprojects)) updates.matchedSubprojects = candidate.matchedSubprojects;
    if (normalizeForCompare(candidate.authors) !== normalizeForCompare(original.authors)) updates.authors = candidate.authors;
    if (normalizeForCompare(candidate.abstract) !== normalizeForCompare(original.abstract)) updates.abstract = candidate.abstract;

    return updates;
  }

  function formatFieldValueForDiff(field, value) {
    if (field === 'authors') {
      const lines = authorsToLines(Array.isArray(value) ? value : []);
      return lines || '(empty)';
    }
    if (Array.isArray(value)) {
      if (!value.length) return '(empty)';
      return value.join(', ');
    }
    const text = collapseWs(value);
    return text || '(empty)';
  }

  function fieldLabel(field) {
    const labels = {
      title: 'Title',
      year: 'Year',
      paperUrl: 'Paper URL (PDF)',
      sourceUrl: 'Source URL',
      publication: 'Publication',
      venue: 'Venue',
      tags: 'Tags',
      keywords: 'Keywords',
      matchedAuthors: 'Matched Authors',
      matchedSubprojects: 'Matched Subprojects',
      authors: 'Authors + Affiliations',
      abstract: 'Abstract',
    };
    return labels[field] || field;
  }

  function clearUrlDiffPreview() {
    pendingUrlCandidatePaper = null;
    pendingUrlUpdates = {};
    urlDiffList.innerHTML = '';
    urlDiffShell.classList.add('hidden');
    urlApplyBtn.disabled = true;
  }

  function renderUrlDiff(candidate, updates) {
    const fieldsWithDiff = Object.keys(updates);
    if (!fieldsWithDiff.length) {
      urlDiffList.innerHTML = '<div class="paper-edit-diff-item"><p class="paper-edit-diff-title">No changes detected</p><p class="paper-edit-status">The URL metadata did not introduce any field differences from the current record.</p></div>';
      urlDiffShell.classList.remove('hidden');
      urlApplyBtn.disabled = true;
      return;
    }

    const itemsHtml = fieldsWithDiff
      .map((field) => {
        const beforeValue = formatFieldValueForDiff(field, originalPaper && originalPaper[field]);
        const afterValue = formatFieldValueForDiff(field, candidate && candidate[field]);
        return `
          <article class="paper-edit-diff-item" aria-label="${fieldLabel(field)} diff">
            <h3 class="paper-edit-diff-title">${fieldLabel(field)}</h3>
            <div class="paper-edit-diff-grid">
              <div class="paper-edit-diff-col">
                <span class="paper-edit-diff-label">Removed / Previous</span>
                <pre class="paper-edit-diff-value del">- ${beforeValue.replace(/\n/g, '\n- ')}</pre>
              </div>
              <div class="paper-edit-diff-col">
                <span class="paper-edit-diff-label">Added / Proposed</span>
                <pre class="paper-edit-diff-value add">+ ${afterValue.replace(/\n/g, '\n+ ')}</pre>
              </div>
            </div>
          </article>`;
      })
      .join('');

    urlDiffList.innerHTML = itemsHtml;
    urlDiffShell.classList.remove('hidden');
    urlApplyBtn.disabled = false;
  }

  async function loadPaper() {
    setStatus(loadStatus, '', '');
    setStatus(genStatus, '', '');
    setStatus(urlStatus, '', '');

    const requested = parseIdInput(idInput.value);
    if (!requested) {
      setStatus(loadStatus, 'Enter a paper id or paper URL.', 'error');
      return false;
    }

    try {
      const papers = await ensurePapers();
      let found = papers.find((paper) => String(paper && paper.id || '') === requested);
      if (!found) {
        const needle = requested.toLowerCase();
        found = papers.find((paper) => String(paper && paper.id || '').toLowerCase() === needle);
      }
      if (!found) {
        setStatus(loadStatus, `Paper not found: ${requested}`, 'error');
        return false;
      }

      originalPaper = JSON.parse(JSON.stringify(found));
      currentPaperId = String(found.id || '');

      originalPre.textContent = getOriginalPreview(found);
      setFormFromPaper(found);

      originalCard.classList.remove('hidden');
      urlCard.classList.remove('hidden');
      changeCard.classList.remove('hidden');
      outputCard.classList.add('hidden');

      updatesJsonPre.textContent = '{}';
      commandPre.textContent = '';
      currentUpdatesMinified = '{}';

      clearUrlDiffPreview();
      setStatus(loadStatus, `Loaded ${currentPaperId}`, 'success');
      return true;
    } catch (err) {
      setStatus(loadStatus, err && err.message ? err.message : 'Failed to load paper data.', 'error');
      return false;
    }
  }

  function generateUpdatesPayload() {
    setStatus(genStatus, '', '');
    if (!originalPaper || !currentPaperId) {
      setStatus(genStatus, 'Load a paper first.', 'error');
      return false;
    }

    try {
      const candidate = buildCandidateFromForm();
      const updates = buildUpdatesFromCandidate(candidate);
      const keys = Object.keys(updates);
      if (!keys.length) {
        setStatus(genStatus, 'No changes detected.', 'error');
        return false;
      }

      const pretty = JSON.stringify(updates, null, 2);
      currentUpdatesMinified = JSON.stringify(updates);
      updatesJsonPre.textContent = pretty;
      commandPre.textContent = `gh workflow run manual-paper-edit-pr.yml --repo ${repoSlug} --ref main -f paper_id='${shellSingleQuote(currentPaperId)}' -f updates_json='${shellSingleQuote(currentUpdatesMinified)}'`;
      outputCard.classList.remove('hidden');
      setStatus(genStatus, `Generated updates_json with ${keys.length} changed field(s).`, 'success');
      return true;
    } catch (err) {
      setStatus(genStatus, err && err.message ? err.message : 'Failed to generate updates_json.', 'error');
      return false;
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
    } catch {
      setStatus(genStatus, 'Clipboard write failed. Copy from output box.', 'error');
    }
  }

  async function copyCommand() {
    const command = collapseWs(commandPre.textContent || '');
    if (!command) {
      setStatus(genStatus, 'Generate updates_json first.', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(command);
      setStatus(genStatus, 'Workflow command copied.', 'success');
    } catch {
      setStatus(genStatus, 'Clipboard write failed. Copy from command box.', 'error');
    }
  }

  async function fetchTextWithTimeout(url, timeoutMs = 25000) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller
      ? window.setTimeout(() => controller.abort(new Error('request timed out')), timeoutMs)
      : null;

    try {
      const response = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
        credentials: 'omit',
        signal: controller ? controller.signal : undefined,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const text = await response.text();
      return { text, finalUrl: String(response.url || url) };
    } finally {
      if (timer !== null) window.clearTimeout(timer);
    }
  }

  async function fetchJsonWithTimeout(url, timeoutMs = 25000) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller
      ? window.setTimeout(() => controller.abort(new Error('request timed out')), timeoutMs)
      : null;

    try {
      const response = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
        credentials: 'omit',
        signal: controller ? controller.signal : undefined,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } finally {
      if (timer !== null) window.clearTimeout(timer);
    }
  }

  function buildMetaMap(doc) {
    const out = new Map();
    const metas = Array.from(doc.querySelectorAll('meta'));
    for (const meta of metas) {
      for (const attrName of ['name', 'property', 'itemprop', 'http-equiv']) {
        const key = collapseWs(meta.getAttribute(attrName) || '').toLowerCase();
        const content = collapseWs(meta.getAttribute('content') || '');
        if (!key || !content) continue;
        if (!out.has(key)) out.set(key, []);
        out.get(key).push(content);
      }
    }
    return out;
  }

  function firstMeta(metaMap, keys) {
    for (const rawKey of keys) {
      const key = String(rawKey || '').toLowerCase();
      const values = metaMap.get(key) || [];
      for (const value of values) {
        const text = collapseWs(value);
        if (text) return text;
      }
    }
    return '';
  }

  function allMeta(metaMap, keys) {
    const out = [];
    const seen = new Set();
    for (const rawKey of keys) {
      const key = String(rawKey || '').toLowerCase();
      const values = metaMap.get(key) || [];
      for (const value of values) {
        const text = collapseWs(value);
        const token = text.toLowerCase();
        if (!text || seen.has(token)) continue;
        seen.add(token);
        out.push(text);
      }
    }
    return out;
  }

  function decodeHtmlToText(value) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${String(value || '')}</div>`, 'text/html');
    return collapseWs((doc.body && doc.body.textContent) || '');
  }

  function parseYearFromText(value) {
    return normalizeYear(value);
  }

  function parseSourceHtmlMetadata(htmlText, finalUrl) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(htmlText || ''), 'text/html');
    const metaMap = buildMetaMap(doc);

    const title = firstMeta(metaMap, [
      'citation_title',
      'dc.title',
      'dcterms.title',
      'og:title',
      'twitter:title',
    ]) || collapseWs((doc.querySelector('title') && doc.querySelector('title').textContent) || '');

    const abstract = decodeHtmlToText(firstMeta(metaMap, [
      'citation_abstract',
      'dc.description',
      'dcterms.description',
      'description',
      'og:description',
      'twitter:description',
    ]));

    const publication = firstMeta(metaMap, [
      'citation_journal_title',
      'citation_conference_title',
      'citation_inbook_title',
      'prism.publicationname',
      'og:site_name',
    ]);

    const venue = firstMeta(metaMap, [
      'citation_conference_title',
      'citation_journal_title',
      'citation_inbook_title',
      'prism.publicationname',
    ]) || publication;

    let year = parseYearFromText(firstMeta(metaMap, [
      'citation_publication_date',
      'citation_date',
      'dc.date',
      'dcterms.date',
      'prism.publicationdate',
      'article:published_time',
    ]));

    if (!year) {
      const yearMatch = String(htmlText || '').match(/\b(19|20)\d{2}\b/);
      if (yearMatch && yearMatch[0]) year = yearMatch[0];
    }

    const rawAuthors = allMeta(metaMap, [
      'citation_author',
      'dc.creator',
      'dcterms.creator',
      'author',
      'article:author',
    ]);

    const authors = dedupeCaseInsensitive(rawAuthors)
      .map((name) => ({ name }))
      .filter((author) => author && author.name);

    let doi = extractDoi(firstMeta(metaMap, [
      'citation_doi',
      'dc.identifier',
      'dcterms.identifier',
      'og:url',
    ]));
    if (!doi) doi = extractDoi(finalUrl);
    if (!doi) doi = extractDoi(htmlText);

    const pdfCandidates = [];
    const citationPdf = sanitizeExternalUrl(firstMeta(metaMap, ['citation_pdf_url']));
    if (citationPdf) pdfCandidates.push(citationPdf);

    const linkNodes = Array.from(doc.querySelectorAll('link[href], a[href]'));
    for (const node of linkNodes) {
      const hrefRaw = collapseWs(node.getAttribute('href') || '');
      if (!hrefRaw) continue;
      const absolute = sanitizeExternalUrl(new URL(hrefRaw, finalUrl).toString());
      if (!absolute) continue;
      const typeAttr = collapseWs(node.getAttribute('type') || '').toLowerCase();
      if (isLikelyPdfUrl(absolute) || typeAttr.includes('pdf')) {
        pdfCandidates.push(absolute);
      }
    }

    const paperUrl = dedupeCaseInsensitive(pdfCandidates)[0] || '';

    return {
      title,
      abstract,
      publication,
      venue,
      year,
      authors,
      doi,
      paperUrl,
    };
  }

  async function fetchSourceMetadata(sourceUrl) {
    try {
      const { text, finalUrl } = await fetchTextWithTimeout(sourceUrl);
      return {
        data: parseSourceHtmlMetadata(text, finalUrl || sourceUrl),
        warning: '',
      };
    } catch (err) {
      const reason = err && err.message ? err.message : 'blocked by CORS or remote policy';
      return {
        data: {},
        warning: `Could not read page metadata directly (${reason}). Continuing with DOI-based sources when possible.`,
      };
    }
  }

  function decodeOpenAlexAbstract(index) {
    if (!index || typeof index !== 'object') return '';
    const parts = [];
    for (const [token, positions] of Object.entries(index)) {
      if (!Array.isArray(positions)) continue;
      for (const position of positions) {
        if (Number.isInteger(position)) {
          parts.push([position, String(token || '')]);
        }
      }
    }
    if (!parts.length) return '';
    parts.sort((a, b) => a[0] - b[0]);
    return collapseWs(parts.map((item) => item[1]).join(' '));
  }

  function parseOpenAlexAuthors(authorships) {
    if (!Array.isArray(authorships)) return [];
    const authors = [];
    const seen = new Set();

    for (const authorship of authorships) {
      if (!authorship || typeof authorship !== 'object') continue;
      const authorObj = authorship.author;
      if (!authorObj || typeof authorObj !== 'object') continue;

      const name = collapseWs(authorObj.display_name || '');
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);

      const author = { name };
      if (Array.isArray(authorship.institutions)) {
        const affiliations = dedupeCaseInsensitive(
          authorship.institutions
            .map((inst) => collapseWs(inst && inst.display_name ? inst.display_name : ''))
            .filter(Boolean)
        );
        if (affiliations.length) author.affiliation = affiliations.join(' | ');
      }

      authors.push(author);
    }

    return authors;
  }

  function extractOpenAlexMetadata(work) {
    if (!work || typeof work !== 'object') return {};

    let publication = '';
    const primaryLocation = work.primary_location;
    if (primaryLocation && typeof primaryLocation === 'object') {
      const source = primaryLocation.source;
      if (source && typeof source === 'object') {
        publication = collapseWs(source.display_name || '');
      }
    }

    if (!publication && work.host_venue && typeof work.host_venue === 'object') {
      publication = collapseWs(work.host_venue.display_name || '');
    }

    const pdfCandidates = [];
    for (const key of ['best_oa_location', 'primary_location']) {
      const location = work[key];
      if (!location || typeof location !== 'object') continue;
      for (const field of ['pdf_url', 'landing_page_url']) {
        const url = sanitizeExternalUrl(location[field] || '');
        if (url) pdfCandidates.push(url);
      }
    }

    const paperUrl = dedupeCaseInsensitive(pdfCandidates).find((url) => isLikelyPdfUrl(url))
      || dedupeCaseInsensitive(pdfCandidates)[0]
      || '';

    return {
      title: collapseWs(work.title || ''),
      year: normalizeYear(work.publication_year || ''),
      publication,
      venue: publication,
      abstract: decodeOpenAlexAbstract(work.abstract_inverted_index),
      authors: parseOpenAlexAuthors(work.authorships),
      paperUrl,
      doi: extractDoi(work.doi || ''),
    };
  }

  async function fetchOpenAlexByDoi(doi) {
    const normalized = extractDoi(doi);
    if (!normalized) return { data: {}, warning: '' };

    const params = new URLSearchParams({
      filter: `doi:https://doi.org/${normalized}`,
      'per-page': '1',
      select: 'id,doi,title,publication_year,authorships,abstract_inverted_index,primary_location,best_oa_location,host_venue',
    });

    const url = `https://api.openalex.org/works?${params.toString()}`;
    try {
      const payload = await fetchJsonWithTimeout(url);
      const results = Array.isArray(payload && payload.results) ? payload.results : [];
      const first = results[0] && typeof results[0] === 'object' ? results[0] : null;
      return { data: first ? extractOpenAlexMetadata(first) : {}, warning: '' };
    } catch (err) {
      const reason = err && err.message ? err.message : 'request failed';
      return { data: {}, warning: `OpenAlex lookup failed (${reason}).` };
    }
  }

  function extractCrossrefAuthors(message) {
    if (!message || typeof message !== 'object') return [];
    if (!Array.isArray(message.author)) return [];

    const authors = [];
    const seen = new Set();

    for (const item of message.author) {
      if (!item || typeof item !== 'object') continue;
      let name = collapseWs(item.name || '');
      if (!name) {
        name = collapseWs(`${item.given || ''} ${item.family || ''}`);
      }
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);

      const author = { name };
      if (Array.isArray(item.affiliation)) {
        const affiliations = dedupeCaseInsensitive(
          item.affiliation
            .map((aff) => collapseWs(aff && aff.name ? aff.name : ''))
            .filter(Boolean)
        );
        if (affiliations.length) author.affiliation = affiliations.join(' | ');
      }
      authors.push(author);
    }

    return authors;
  }

  function extractCrossrefMetadata(message) {
    if (!message || typeof message !== 'object') return {};

    let title = '';
    if (Array.isArray(message.title)) {
      title = collapseWs(message.title.find((item) => collapseWs(item)) || '');
    }

    let year = '';
    for (const key of ['issued', 'published-print', 'published-online', 'created']) {
      const obj = message[key];
      if (!obj || typeof obj !== 'object') continue;
      const dateParts = Array.isArray(obj['date-parts']) ? obj['date-parts'] : [];
      if (!Array.isArray(dateParts[0]) || dateParts[0].length < 1) continue;
      const maybeYear = normalizeYear(String(dateParts[0][0] || ''));
      if (maybeYear) {
        year = maybeYear;
        break;
      }
    }

    let publication = '';
    if (Array.isArray(message['container-title'])) {
      publication = collapseWs(message['container-title'].find((item) => collapseWs(item)) || '');
    }

    const abstract = decodeHtmlToText(message.abstract || '');

    const pdfCandidates = [];
    if (Array.isArray(message.link)) {
      for (const link of message.link) {
        if (!link || typeof link !== 'object') continue;
        const href = sanitizeExternalUrl(link.URL || '');
        const ctype = collapseWs(link['content-type'] || '').toLowerCase();
        if (!href) continue;
        if (ctype.includes('pdf') || isLikelyPdfUrl(href)) pdfCandidates.push(href);
      }
    }
    const fallbackUrl = sanitizeExternalUrl(message.URL || '');
    if (fallbackUrl) pdfCandidates.push(fallbackUrl);

    const paperUrl = dedupeCaseInsensitive(pdfCandidates).find((url) => isLikelyPdfUrl(url))
      || dedupeCaseInsensitive(pdfCandidates)[0]
      || '';

    return {
      title,
      year,
      publication,
      venue: publication,
      abstract,
      authors: extractCrossrefAuthors(message),
      paperUrl,
      doi: extractDoi(message.DOI || ''),
    };
  }

  async function fetchCrossrefByDoi(doi) {
    const normalized = extractDoi(doi);
    if (!normalized) return { data: {}, warning: '' };

    const encoded = encodeURIComponent(normalized).replace(/%2F/g, '/');
    const url = `https://api.crossref.org/works/${encoded}`;

    try {
      const payload = await fetchJsonWithTimeout(url);
      const message = payload && typeof payload.message === 'object' ? payload.message : null;
      return { data: message ? extractCrossrefMetadata(message) : {}, warning: '' };
    } catch (err) {
      const reason = err && err.message ? err.message : 'request failed';
      return { data: {}, warning: `Crossref lookup failed (${reason}).` };
    }
  }

  function applySuggestion(suggestions, field, value, overwrite = false) {
    const hasExisting = Object.prototype.hasOwnProperty.call(suggestions, field);
    if (!overwrite && hasExisting) return;

    if (field === 'authors') {
      if (!Array.isArray(value) || !value.length) return;
      suggestions[field] = value;
      return;
    }

    const text = field === 'year' ? normalizeYear(value) : collapseWs(value);
    if (!text) return;
    if ((field === 'paperUrl' || field === 'sourceUrl') && !sanitizeExternalUrl(text)) return;
    suggestions[field] = text;
  }

  function mergeUrlSuggestionsIntoPaper(basePaper, sourceUrl, sourceMeta, crossrefMeta, openalexMeta) {
    const candidate = JSON.parse(JSON.stringify(basePaper || {}));
    const suggestions = {};

    applySuggestion(suggestions, 'sourceUrl', sanitizeExternalUrl(sourceUrl), true);

    applySuggestion(suggestions, 'title', sourceMeta.title);
    applySuggestion(suggestions, 'year', sourceMeta.year);
    applySuggestion(suggestions, 'publication', sourceMeta.publication);
    applySuggestion(suggestions, 'venue', sourceMeta.venue || sourceMeta.publication);
    applySuggestion(suggestions, 'abstract', sourceMeta.abstract);
    applySuggestion(suggestions, 'paperUrl', sourceMeta.paperUrl);
    applySuggestion(suggestions, 'authors', sourceMeta.authors);

    applySuggestion(suggestions, 'title', crossrefMeta.title);
    applySuggestion(suggestions, 'year', crossrefMeta.year);
    applySuggestion(suggestions, 'publication', crossrefMeta.publication);
    applySuggestion(suggestions, 'venue', crossrefMeta.venue || crossrefMeta.publication);
    applySuggestion(suggestions, 'abstract', crossrefMeta.abstract);
    applySuggestion(suggestions, 'paperUrl', crossrefMeta.paperUrl);
    applySuggestion(suggestions, 'authors', crossrefMeta.authors);

    applySuggestion(suggestions, 'title', openalexMeta.title);
    applySuggestion(suggestions, 'year', openalexMeta.year);
    applySuggestion(suggestions, 'publication', openalexMeta.publication);
    applySuggestion(suggestions, 'venue', openalexMeta.venue || openalexMeta.publication);
    applySuggestion(suggestions, 'abstract', openalexMeta.abstract);
    applySuggestion(suggestions, 'paperUrl', openalexMeta.paperUrl);
    applySuggestion(suggestions, 'authors', openalexMeta.authors, true);

    for (const [field, value] of Object.entries(suggestions)) {
      candidate[field] = value;
    }

    return candidate;
  }

  async function previewUpdateFromUrl() {
    setStatus(urlStatus, '', '');
    setStatus(genStatus, '', '');

    if (!originalPaper || !currentPaperId) {
      setStatus(urlStatus, 'Load a paper first.', 'error');
      return;
    }

    const sourceUrl = sanitizeExternalUrl(urlInput.value);
    if (!sourceUrl) {
      setStatus(urlStatus, 'Enter a valid http/https source URL.', 'error');
      return;
    }

    clearUrlDiffPreview();
    setStatus(urlStatus, 'Fetching metadata and building URL update preview...', '');

    const warnings = [];

    const sourceResult = await fetchSourceMetadata(sourceUrl);
    if (sourceResult.warning) warnings.push(sourceResult.warning);
    const sourceMeta = sourceResult.data || {};

    const doi = extractDoi(sourceMeta.doi || sourceUrl);

    let crossrefMeta = {};
    let openalexMeta = {};

    if (doi) {
      const [crossrefResult, openalexResult] = await Promise.all([
        fetchCrossrefByDoi(doi),
        fetchOpenAlexByDoi(doi),
      ]);
      crossrefMeta = crossrefResult.data || {};
      openalexMeta = openalexResult.data || {};
      if (crossrefResult.warning) warnings.push(crossrefResult.warning);
      if (openalexResult.warning) warnings.push(openalexResult.warning);
    } else {
      warnings.push('No DOI detected from the URL; URL metadata extraction is limited to directly readable page tags.');
    }

    const candidatePaper = mergeUrlSuggestionsIntoPaper(originalPaper, sourceUrl, sourceMeta, crossrefMeta, openalexMeta);
    const updates = buildUpdatesFromCandidate({
      title: collapseWs(candidatePaper.title || ''),
      year: collapseWs(candidatePaper.year || ''),
      paperUrl: collapseWs(candidatePaper.paperUrl || ''),
      sourceUrl: collapseWs(candidatePaper.sourceUrl || ''),
      publication: collapseWs(candidatePaper.publication || ''),
      venue: collapseWs(candidatePaper.venue || ''),
      tags: Array.isArray(candidatePaper.tags) ? candidatePaper.tags : [],
      keywords: Array.isArray(candidatePaper.keywords) ? candidatePaper.keywords : [],
      matchedAuthors: Array.isArray(candidatePaper.matchedAuthors) ? candidatePaper.matchedAuthors : [],
      matchedSubprojects: Array.isArray(candidatePaper.matchedSubprojects) ? candidatePaper.matchedSubprojects : [],
      authors: Array.isArray(candidatePaper.authors) ? candidatePaper.authors : [],
      abstract: collapseWs(candidatePaper.abstract || ''),
    });

    pendingUrlCandidatePaper = candidatePaper;
    pendingUrlUpdates = updates;

    renderUrlDiff(candidatePaper, updates);

    const changedFields = Object.keys(updates).length;
    if (!changedFields) {
      const warningSuffix = warnings.length ? ` ${warnings.join(' ')}` : '';
      setStatus(urlStatus, `No field changes detected from this URL.${warningSuffix}`, warnings.length ? 'error' : 'success');
      return;
    }

    const warningText = warnings.length ? ` ${warnings.join(' ')}` : '';
    setStatus(urlStatus, `Detected ${changedFields} changed field(s). Review the diff and click "Confirm And Apply Changes".${warningText}`, 'success');
  }

  function applyUrlPreviewChanges() {
    if (!pendingUrlCandidatePaper || !Object.keys(pendingUrlUpdates).length) {
      setStatus(urlStatus, 'No pending URL changes to apply.', 'error');
      return;
    }

    setFormFromPaper(pendingUrlCandidatePaper);
    const ok = generateUpdatesPayload();
    if (ok) {
      setStatus(urlStatus, `Applied ${Object.keys(pendingUrlUpdates).length} URL-derived field change(s) and generated updates_json.`, 'success');
    } else {
      setStatus(urlStatus, 'Applied URL changes to the form, but updates_json generation failed.', 'error');
    }
  }

  loadBtn.addEventListener('click', () => {
    loadPaper();
  });

  generateBtn.addEventListener('click', () => {
    generateUpdatesPayload();
  });

  urlPreviewBtn.addEventListener('click', () => {
    previewUpdateFromUrl();
  });

  urlApplyBtn.addEventListener('click', () => {
    applyUrlPreviewChanges();
  });

  copyJsonBtn.addEventListener('click', () => {
    copyJson();
  });

  copyCommandBtn.addEventListener('click', () => {
    copyCommand();
  });

  resetBtn.addEventListener('click', () => {
    if (!originalPaper) return;
    window.setTimeout(() => {
      setFormFromPaper(originalPaper);
      outputCard.classList.add('hidden');
      setStatus(genStatus, 'Reset changes back to original values.', 'success');
    }, 0);
  });

  const query = new URLSearchParams(window.location.search || '');
  const idFromQuery = collapseWs(query.get('id') || '');
  const sourceUrlFromQuery = collapseWs(query.get('source_url') || '');

  if (sourceUrlFromQuery) {
    urlInput.value = sourceUrlFromQuery;
  }

  if (idFromQuery) {
    idInput.value = idFromQuery;
    loadPaper().then((loaded) => {
      if (!loaded) return;
      if (sourceUrlFromQuery) {
        previewUpdateFromUrl();
      }
    });
  }
})();

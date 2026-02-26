/*
 * paper-manual-add.js
 * Build a normalized one-line JSON payload for manual paper intake workflow.
 */
(function () {
  'use strict';

  const form = document.getElementById('manual-paper-form');
  if (!form) return;

  const statusEl = document.getElementById('mp-status');
  const outputEl = document.getElementById('mp-json-output');
  const cliEl = document.getElementById('mp-gh-cli');

  const generateBtn = document.getElementById('mp-generate-btn');
  const copyBtn = document.getElementById('mp-copy-btn');
  const resetBtn = document.getElementById('mp-reset-btn');

  const value = (id) => {
    const el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  };

  const parseList = (raw) => String(raw || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  const parseAuthors = (raw) => {
    const lines = String(raw || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.map((line) => {
      if (!line.includes('|')) return { name: line };
      const [left, right] = line.split('|', 2);
      const name = left.trim();
      const affiliations = right
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean);
      const author = { name };
      if (affiliations.length) author.affiliation = affiliations.join(' | ');
      return author;
    }).filter((author) => author.name);
  };

  const isHttpUrl = (raw) => {
    if (!raw) return false;
    try {
      const url = new URL(raw);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
      return false;
    }
  };

  const isLikelyDoi = (raw) => !raw || /^((https?:\/\/(dx\.)?doi\.org\/)|doi:\s*)?10\.\d{4,9}\/\S+$/i.test(raw);
  const isLikelyOpenAlex = (raw) => !raw || /^((https?:\/\/)?openalex\.org\/)?w\d+$/i.test(raw.trim());

  function setStatus(message, kind) {
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.classList.remove('error', 'success');
    if (kind) statusEl.classList.add(kind);
  }

  function addIf(out, key, raw) {
    if (raw === undefined || raw === null) return;
    if (typeof raw === 'string') {
      const text = raw.trim();
      if (!text) return;
      out[key] = text;
      return;
    }
    if (Array.isArray(raw)) {
      if (!raw.length) return;
      out[key] = raw;
      return;
    }
    out[key] = raw;
  }

  function buildPayload() {
    const errors = [];

    const source = value('mp-source') || 'manual-added';
    const sourceName = value('mp-source-name') || 'Manual Added Papers';
    const id = value('mp-id');
    const title = value('mp-title');
    const authors = parseAuthors(value('mp-authors'));
    const year = value('mp-year');
    const publication = value('mp-publication');
    const venue = value('mp-venue');
    const type = value('mp-type') || 'research-paper';
    const paperUrl = value('mp-paper-url');
    const sourceUrl = value('mp-source-url');
    const doi = value('mp-doi');
    const openalexId = value('mp-openalex-id');
    const abstract = value('mp-abstract');
    const citationCountRaw = value('mp-citation-count');
    const tags = parseList(value('mp-tags'));
    const keywords = parseList(value('mp-keywords'));
    const matchedAuthors = parseList(value('mp-matched-authors'));
    const matchedSubprojects = parseList(value('mp-matched-subprojects'));
    const contentFormat = value('mp-content-format');
    const content = value('mp-content');

    if (!title) errors.push('Title is required.');
    if (!authors.length) errors.push('At least one author is required.');
    if (!/^\d{4}$/.test(year)) errors.push('Year is required and must be 4 digits.');
    if (!isHttpUrl(paperUrl)) errors.push('Paper URL is required and must be a valid http/https URL.');
    if (!isHttpUrl(sourceUrl)) errors.push('Source URL is required and must be a valid http/https URL.');
    if (!isLikelyDoi(doi)) errors.push('DOI is invalid.');
    if (!isLikelyOpenAlex(openalexId)) errors.push('OpenAlex ID is invalid (expected W123... or openalex.org/W123...).');

    let citationCount = 0;
    if (citationCountRaw) {
      citationCount = Number(citationCountRaw);
      if (!Number.isInteger(citationCount) || citationCount < 0) {
        errors.push('Citation count must be a non-negative integer.');
      }
    }

    if (errors.length) {
      const err = new Error(errors.join(' '));
      err.details = errors;
      throw err;
    }

    const payload = {};
    addIf(payload, 'id', id);
    addIf(payload, 'source', source);
    addIf(payload, 'sourceName', sourceName);
    addIf(payload, 'title', title);
    addIf(payload, 'authors', authors);
    addIf(payload, 'year', year);
    addIf(payload, 'publication', publication);
    addIf(payload, 'venue', venue);
    addIf(payload, 'type', type);
    addIf(payload, 'abstract', abstract);
    addIf(payload, 'paperUrl', paperUrl);
    addIf(payload, 'sourceUrl', sourceUrl);
    addIf(payload, 'doi', doi);
    addIf(payload, 'openalexId', openalexId);
    payload.citationCount = citationCount;
    addIf(payload, 'tags', tags);
    addIf(payload, 'keywords', keywords);
    addIf(payload, 'matchedAuthors', matchedAuthors);
    addIf(payload, 'matchedSubprojects', matchedSubprojects);
    addIf(payload, 'contentFormat', content ? (contentFormat || 'markdown') : '');
    addIf(payload, 'content', content);

    return payload;
  }

  function shellSingleQuote(value) {
    return String(value).replace(/'/g, "'\"'\"'");
  }

  function detectRepoSlug() {
    const host = String(window.location.hostname || '').toLowerCase();
    const pathParts = String(window.location.pathname || '')
      .split('/')
      .filter(Boolean);
    if (host.endsWith('.github.io') && pathParts.length >= 1) {
      const owner = host.split('.')[0];
      const repo = pathParts[0];
      if (owner && repo) return `${owner}/${repo}`;
    }
    return 'llvm/library';
  }

  function updateWorkflowLinks(repoSlug) {
    const workflowUrl = `https://github.com/${repoSlug}/actions/workflows/manual-paper-pr.yml`;
    const selectors = [
      'manual-paper-workflow-link-top',
      'manual-paper-workflow-link-inline',
    ];
    selectors.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.href = workflowUrl;
    });
    document.querySelectorAll('a[href="https://github.com/llvm/library/actions/workflows/manual-paper-pr.yml"]').forEach((el) => {
      el.href = workflowUrl;
    });
    return workflowUrl;
  }

  const repoSlug = detectRepoSlug();
  const workflowUrl = updateWorkflowLinks(repoSlug);

  function renderPayload() {
    try {
      const payload = buildPayload();
      const minified = JSON.stringify(payload);
      if (outputEl) {
        outputEl.value = minified;
        outputEl.dataset.payload = minified;
      }
      if (cliEl) {
        const sourceUrl = value('mp-source-url');
        const lines = ['GitHub CLI trigger (URL-only workflow):'];
        if (isHttpUrl(sourceUrl)) {
          lines.push(`gh workflow run manual-paper-pr.yml --repo ${repoSlug} --ref main -f source_url='${shellSingleQuote(sourceUrl)}'`);
        } else {
          lines.push("Set a valid Source URL field to generate the workflow command.");
        }
        lines.push('');
        lines.push('Optional local fallback (manual payload):');
        lines.push(`python3 scripts/add-manual-paper.py --paper-json '${shellSingleQuote(minified)}'`);
        lines.push('');
        lines.push(`Workflow URL: ${workflowUrl}`);
        cliEl.textContent = [
          ...lines,
        ].join('\n');
      }
      setStatus('Payload generated. For GitHub Action, run URL-only workflow input using Source URL.', 'success');
    } catch (err) {
      setStatus(err && err.message ? err.message : 'Failed to generate payload.', 'error');
    }
  }

  async function copyPayload() {
    const payload = outputEl ? String(outputEl.dataset.payload || outputEl.value || '').trim() : '';
    if (!payload) {
      setStatus('Generate payload first.', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(payload);
      setStatus('Payload copied to clipboard.', 'success');
    } catch (_) {
      setStatus('Clipboard write failed. Copy manually from the payload box.', 'error');
    }
  }

  if (generateBtn) {
    generateBtn.addEventListener('click', renderPayload);
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', copyPayload);
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      window.setTimeout(function () {
        if (outputEl) {
          outputEl.value = '';
          outputEl.dataset.payload = '';
        }
        if (cliEl) cliEl.textContent = '';
        setStatus('', '');
      }, 0);
    });
  }
})();

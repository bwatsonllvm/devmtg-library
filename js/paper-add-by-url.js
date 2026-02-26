/*
 * paper-add-by-url.js
 * Dedicated quick URL intake helper for manual paper workflow.
 */
(function () {
  'use strict';

  const sourceEl = document.getElementById('url-intake-source');
  const statusEl = document.getElementById('url-intake-status');
  const commandEl = document.getElementById('url-intake-command');
  const copyBtn = document.getElementById('url-intake-copy-command');
  const workflowLink = document.getElementById('url-intake-open-workflow');
  const advancedBtn = document.getElementById('url-intake-open-advanced');

  if (!sourceEl || !statusEl || !commandEl || !copyBtn || !workflowLink || !advancedBtn) return;

  function setStatus(message, kind) {
    statusEl.textContent = message || '';
    statusEl.classList.remove('error', 'success');
    if (kind) statusEl.classList.add(kind);
  }

  function shellSingleQuote(value) {
    return String(value || '').replace(/'/g, "'\"'\"'");
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

  function isHttpUrl(raw) {
    if (!raw) return false;
    try {
      const url = new URL(raw);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  const repoSlug = detectRepoSlug();
  const workflowUrl = `https://github.com/${repoSlug}/actions/workflows/manual-paper-pr.yml`;
  workflowLink.href = workflowUrl;

  function updateCommand() {
    const sourceUrl = String(sourceEl.value || '').trim();
    const base = `gh workflow run manual-paper-pr.yml --repo ${repoSlug} --ref main`;
    if (!isHttpUrl(sourceUrl)) {
      commandEl.textContent = `${base} -f source_url='https://example.com/paper'`;
      return '';
    }
    const command = `${base} -f source_url='${shellSingleQuote(sourceUrl)}'`;
    commandEl.textContent = command;
    return command;
  }

  sourceEl.addEventListener('input', function () {
    updateCommand();
    setStatus('', '');
  });

  copyBtn.addEventListener('click', async function () {
    const sourceUrl = String(sourceEl.value || '').trim();
    if (!isHttpUrl(sourceUrl)) {
      setStatus('Enter a valid http/https source URL first.', 'error');
      return;
    }
    const command = updateCommand();
    try {
      await navigator.clipboard.writeText(command);
      setStatus('Workflow command copied.', 'success');
    } catch (_) {
      setStatus('Clipboard write failed. Copy from the command box.', 'error');
    }
  });

  advancedBtn.addEventListener('click', function () {
    const sourceUrl = String(sourceEl.value || '').trim();
    if (!isHttpUrl(sourceUrl)) {
      window.location.href = 'papers/add.html';
      return;
    }
    window.location.href = `papers/add.html?source_url=${encodeURIComponent(sourceUrl)}`;
  });

  const query = new URLSearchParams(window.location.search || '');
  const fromQuery = String(query.get('source_url') || '').trim();
  if (isHttpUrl(fromQuery)) {
    sourceEl.value = fromQuery;
  }
  updateCommand();
})();

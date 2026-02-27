/**
 * report-issue.js - deterministic issue-link wiring for pages and detail views.
 */

(function () {
  const ISSUE_BASE_URL = 'https://github.com/bwatsonllvm/library/issues/new';
  const ISSUE_TEMPLATE_FILE = 'record-update.yml';
  const PUBLIC_SITE_BASE_URL = 'https://bwatsonllvm.github.io/library/';
  const DEFAULT_DETAILS_PROMPT = 'Describe what should be corrected or added.';

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function truncateText(value, maxLength) {
    const text = normalizeText(value);
    if (!text) return '';
    if (!Number.isFinite(maxLength) || maxLength <= 0 || text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
  }

  function safeUrl(value) {
    try {
      return new URL(String(value || ''), window.location.href);
    } catch {
      return null;
    }
  }

  function normalizeLibraryPath(url) {
    let path = String((url && url.pathname) || '').replace(/^\/+/, '');
    const libraryIndex = path.indexOf('library/');
    if (libraryIndex !== -1) {
      path = path.slice(libraryIndex + 'library/'.length);
    }
    if (path.startsWith('_site/')) path = path.slice('_site/'.length);
    if (!path || path === 'library' || path === '_site') return '';
    if (path.startsWith('devmtg/')) return path.slice('devmtg/'.length);
    return path;
  }

  function toPublicUrl(inputUrl) {
    const parsed = safeUrl(inputUrl || window.location.href);
    if (!parsed) return PUBLIC_SITE_BASE_URL;
    const path = normalizeLibraryPath(parsed);
    return `${PUBLIC_SITE_BASE_URL}${path}${parsed.search || ''}${parsed.hash || ''}`;
  }

  function setParamIfPresent(params, key, value, maxLength) {
    const text = normalizeText(value);
    if (!text) return;
    params.set(key, Number.isFinite(maxLength) ? truncateText(text, maxLength) : text);
  }

  function resolveItemType(context) {
    const raw = normalizeText(context.itemType || context.pageType).toLowerCase();
    if (raw.includes('talk')) return 'Talk';
    if (raw.includes('paper')) return 'Paper';
    if (raw.includes('blog')) return 'Paper';
    if (raw.includes('person') || raw.includes('people')) return 'Person';
    if (raw.includes('event') || raw.includes('meeting')) return 'Event';
    if (raw.includes('search') || raw.includes('listing') || raw.includes('work') || raw.includes('page')) return 'Search/Listing';
    return 'Other';
  }

  function deriveIssueTitle(context) {
    const explicit = normalizeText(context.issueTitle);
    if (explicit) return truncateText(explicit, 120);
    const itemType = normalizeText(context.itemType || context.pageType || 'Page');
    const itemTitle = normalizeText(context.itemTitle || context.pageTitle || document.title || 'LLVM Research Library');
    return truncateText(`[${itemType}] ${itemTitle}`, 120);
  }

  function deriveIssueButtonLabel(context) {
    const explicit = normalizeText(context.issueButtonLabel);
    return explicit || 'Request Edit';
  }

  function deriveRequestType(context, itemType) {
    const explicit = normalizeText(context.requestType);
    if (explicit) return explicit;
    if (itemType === 'Paper' && !normalizeText(context.itemId)) return 'Add missing paper';
    if (itemType === 'Talk' && !normalizeText(context.itemId)) return 'Add missing talk/slides/video';
    if (itemType === 'Person') return 'Correct person attribution';
    return 'Correct existing entry';
  }

  function deriveReferences(context, publicUrl) {
    const lines = [];
    const pageTitle = normalizeText(context.pageTitle || document.title || 'LLVM Research Library');
    if (pageTitle) lines.push(`- Page: ${pageTitle}`);
    if (publicUrl) lines.push(`- Public URL: ${publicUrl}`);
    const current = normalizeText(window.location.href);
    if (current && current !== publicUrl) lines.push(`- Current URL: ${current}`);
    return lines.join('\n');
  }

  function buildIssueHref(contextInput) {
    const context = (contextInput && typeof contextInput === 'object') ? contextInput : {};
    const publicUrl = normalizeText(context.pageUrl) || toPublicUrl(window.location.href);
    const itemType = resolveItemType(context);
    const params = new URLSearchParams();

    params.set('template', ISSUE_TEMPLATE_FILE);
    params.set('title', deriveIssueTitle(context));
    params.set('body', [
      `Requested change for ${normalizeText(context.itemType || context.pageType || 'entry') || 'entry'}.`,
      '',
      `Public URL: ${publicUrl}`,
      '',
      DEFAULT_DETAILS_PROMPT,
    ].join('\n'));

    setParamIfPresent(params, 'request_type', deriveRequestType(context, itemType));
    setParamIfPresent(params, 'public_url', publicUrl);
    setParamIfPresent(params, 'item_type', itemType);
    setParamIfPresent(params, 'item_id', context.itemId, 140);
    setParamIfPresent(params, 'item_title', context.itemTitle, 240);
    setParamIfPresent(params, 'meeting', context.meetingName || context.meeting, 160);
    setParamIfPresent(params, 'year', context.year, 8);
    setParamIfPresent(params, 'query', context.query, 180);
    setParamIfPresent(params, 'slides_url', context.slidesUrl);
    setParamIfPresent(params, 'video_url', context.videoUrl);
    setParamIfPresent(params, 'paper_url', context.paperUrl);
    setParamIfPresent(params, 'source_url', context.sourceUrl);
    setParamIfPresent(params, 'doi', context.doi, 160);
    setParamIfPresent(params, 'openalex', context.openalexId, 200);
    setParamIfPresent(params, 'details', context.details || DEFAULT_DETAILS_PROMPT, 1000);
    setParamIfPresent(params, 'references', deriveReferences(context, publicUrl), 2000);

    return `${ISSUE_BASE_URL}?${params.toString()}`;
  }

  function ensureInlineIssueButton(context) {
    const detailCard = document.querySelector('#talk-detail-root .talk-detail, #paper-detail-root .talk-detail');
    if (!detailCard) return null;

    let linksBar = detailCard.querySelector('.links-bar');
    if (!linksBar) {
      linksBar = document.createElement('div');
      linksBar.className = 'links-bar';
      linksBar.setAttribute('aria-label', 'Resources');
      const abstractSection = detailCard.querySelector('.abstract-section');
      if (abstractSection && abstractSection.parentNode === detailCard) {
        detailCard.insertBefore(linksBar, abstractSection);
      } else {
        detailCard.appendChild(linksBar);
      }
    }

    let button = linksBar.querySelector('#report-issue-btn');
    if (!button) {
      button = document.createElement('a');
      button.id = 'report-issue-btn';
      button.className = 'link-btn report-issue-link';
      button.innerHTML = [
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">',
        '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
        '<line x1="12" y1="7" x2="12" y2="13"/>',
        '<line x1="12" y1="17" x2="12.01" y2="17"/>',
        '</svg>',
        '<span aria-hidden="true" class="report-issue-label"></span>',
      ].join('');
      linksBar.appendChild(button);
    }

    const label = deriveIssueButtonLabel(context);
    const labelNode = button.querySelector('.report-issue-label');
    if (labelNode && labelNode.textContent !== label) {
      labelNode.textContent = label;
    }
    return button;
  }

  function applyIssueButtonHref() {
    const context = (window.LLVM_LIBRARY_ISSUE_CONTEXT && typeof window.LLVM_LIBRARY_ISSUE_CONTEXT === 'object')
      ? window.LLVM_LIBRARY_ISSUE_CONTEXT
      : {};

    const headerButtons = document.querySelectorAll('.site-header #report-issue-btn, .header-right #report-issue-btn');
    for (const stale of headerButtons) stale.remove();

    const inlineButton = ensureInlineIssueButton(context);
    const buttons = inlineButton
      ? [inlineButton]
      : Array.from(document.querySelectorAll('#report-issue-btn'));
    if (!buttons.length) return;

    const href = buildIssueHref(context);
    const label = deriveIssueButtonLabel(context);
    const ariaLabel = `${label} (opens in new tab)`;

    for (const button of buttons) {
      if (button.getAttribute('href') !== href) button.setAttribute('href', href);
      if (button.getAttribute('aria-label') !== ariaLabel) button.setAttribute('aria-label', ariaLabel);
      if (button.getAttribute('target') !== '_blank') button.setAttribute('target', '_blank');
      if (button.getAttribute('rel') !== 'noopener noreferrer') button.setAttribute('rel', 'noopener noreferrer');
      const labelNode = button.querySelector('.report-issue-label');
      if (labelNode && labelNode.textContent !== label) labelNode.textContent = label;
    }
  }

  window.buildLibraryIssueHref = function buildLibraryIssueHref(context) {
    return buildIssueHref(context);
  };

  window.setLibraryIssueContext = function setLibraryIssueContext(nextContext) {
    if (!nextContext || typeof nextContext !== 'object') return;
    const previous = (window.LLVM_LIBRARY_ISSUE_CONTEXT && typeof window.LLVM_LIBRARY_ISSUE_CONTEXT === 'object')
      ? window.LLVM_LIBRARY_ISSUE_CONTEXT
      : {};
    window.LLVM_LIBRARY_ISSUE_CONTEXT = { ...previous, ...nextContext };
    applyIssueButtonHref();
  };

  window.setLibraryIssueContext({
    pageType: 'Page',
    pageTitle: normalizeText(document.title) || 'LLVM Research Library',
    pageUrl: toPublicUrl(window.location.href),
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyIssueButtonHref, { once: true });
  } else {
    applyIssueButtonHref();
  }
})();

/**
 * report-issue.js - prefill public GitHub issue links with page/item context.
 */

(function () {
  const ISSUE_BASE_URL = 'https://github.com/bwatsonllvm/library/issues/new';
  const ISSUE_TEMPLATE_FILE = 'record-update.yml';
  const PUBLIC_SITE_BASE_URL = 'https://bwatsonllvm.github.io/library/';
  const DEFAULT_DETAILS_PROMPT = 'Describe what should be corrected or added.';

  function normalizeText(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function truncateText(value, maxLength) {
    const text = normalizeText(value);
    if (!text) return '';
    if (!Number.isFinite(maxLength) || maxLength <= 0) return text;
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 3)}...`;
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
    if (path === 'library' || path === 'devmtg' || path === '_site') {
      return '';
    }

    const devmtgIndex = path.indexOf('devmtg/');
    if (devmtgIndex !== -1) {
      return path.slice(devmtgIndex + 'devmtg/'.length);
    }

    const libraryIndex = path.indexOf('library/');
    if (libraryIndex !== -1) {
      path = path.slice(libraryIndex + 'library/'.length);
    }

    if (path.startsWith('_site/')) {
      path = path.slice('_site/'.length);
    }
    return path;
  }

  function toPublicUrl(inputUrl) {
    const parsed = safeUrl(inputUrl || window.location.href);
    if (!parsed) return PUBLIC_SITE_BASE_URL;

    const path = normalizeLibraryPath(parsed);
    const query = parsed.search || '';
    const hash = parsed.hash || '';
    return `${PUBLIC_SITE_BASE_URL}${path}${query}${hash}`;
  }

  function pushContextLine(lines, label, value) {
    const text = normalizeText(value);
    if (!text) return;
    lines.push(`- ${label}: ${text}`);
  }

  function deriveIssueTitle(context) {
    const explicit = normalizeText(context.issueTitle);
    if (explicit) return truncateText(explicit, 120);

    const itemType = normalizeText(context.itemType || context.pageType || 'Page');
    const itemTitle = normalizeText(context.itemTitle || context.pageTitle || document.title || 'LLVM Research Library');
    return truncateText(`[${itemType}] ${itemTitle}`, 120);
  }

  function resolveIssueItemType(context) {
    const raw = normalizeText(context.itemType || context.pageType).toLowerCase();
    if (!raw) return 'Other';
    if (raw.includes('talk')) return 'Talk';
    if (raw.includes('paper')) return 'Paper';
    if (raw.includes('person') || raw.includes('people')) return 'Person';
    if (raw.includes('event') || raw.includes('meeting')) return 'Event';
    if (raw.includes('search') || raw.includes('listing') || raw.includes('work') || raw.includes('page')) {
      return 'Search/Listing';
    }
    return 'Other';
  }

  function resolveRequestType(context, itemType) {
    if (itemType === 'Paper' && !normalizeText(context.itemId)) return 'Add missing paper';
    if (itemType === 'Talk' && !normalizeText(context.itemId)) return 'Add missing talk/slides/video';
    if (itemType === 'Person') return 'Correct person attribution';
    if (itemType === 'Search/Listing') return 'Other';
    return 'Correct existing entry';
  }

  function deriveReferences(context, publicUrl) {
    const lines = [];
    pushContextLine(lines, 'Page', context.pageTitle || document.title || 'LLVM Research Library');
    pushContextLine(lines, 'Public URL', publicUrl);

    const currentUrl = normalizeText(window.location.href);
    if (currentUrl && currentUrl !== publicUrl) {
      pushContextLine(lines, 'Current URL', currentUrl);
    }

    if (Array.isArray(context.extraLinks) && context.extraLinks.length) {
      lines.push('- Related links:');
      for (const entry of context.extraLinks) {
        if (!entry || typeof entry !== 'object') continue;
        const label = normalizeText(entry.label);
        const url = normalizeText(entry.url);
        if (!label || !url) continue;
        lines.push(`  - ${label}: ${url}`);
      }
    }

    return lines.join('\n');
  }

  function deriveBody(context, publicUrl) {
    const itemType = normalizeText(context.itemType || context.pageType || 'entry');
    return [
      `Requested change for ${itemType}.`,
      '',
      `Public URL: ${publicUrl}`,
      '',
      DEFAULT_DETAILS_PROMPT,
    ].join('\n');
  }

  function setParamIfPresent(params, key, value, maxLength = null) {
    const text = normalizeText(value);
    if (!text) return;

    const bounded = Number.isFinite(maxLength) && maxLength > 0
      ? truncateText(text, maxLength)
      : text;
    params.set(key, bounded);
  }

  function buildIssueButtonLabel(context) {
    return 'Report issue';
  }

  function createIssueButton(context) {
    const issueButton = document.createElement('a');
    issueButton.href = ISSUE_BASE_URL;
    issueButton.className = 'link-btn report-issue-link';
    issueButton.id = 'report-issue-btn';
    issueButton.setAttribute('data-report-issue-inline', 'true');
    issueButton.setAttribute('aria-label', `${buildIssueButtonLabel(context)} (opens in new tab)`);
    issueButton.innerHTML = [
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">',
      '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
      '<line x1="12" y1="7" x2="12" y2="13"/>',
      '<line x1="12" y1="17" x2="12.01" y2="17"/>',
      '</svg>',
      buildIssueButtonLabel(context),
    ].join('');
    return issueButton;
  }

  function isDetailPage() {
    return Boolean(document.getElementById('talk-detail-root') || document.getElementById('paper-detail-root'));
  }

  function ensureInlineIssueButtonPlacement(context) {
    const legacyHeaderButtons = Array.from(
      document.querySelectorAll('.site-header #report-issue-btn, .header-right #report-issue-btn')
    );

    // Keep issue links out of header-level controls.
    for (const legacyButton of legacyHeaderButtons) {
      legacyButton.remove();
    }

    if (!isDetailPage()) return;

    const detailCard = document.querySelector('#talk-detail-root .talk-detail, #paper-detail-root .talk-detail');
    if (!detailCard) return;

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

    const inlineButton = linksBar.querySelector('#report-issue-btn');
    if (inlineButton) {
      inlineButton.setAttribute('data-report-issue-inline', 'true');
      return;
    }

    linksBar.appendChild(createIssueButton(context));
  }

  function buildIssueHref(contextInput) {
    const context = (contextInput && typeof contextInput === 'object') ? contextInput : {};
    const publicUrl = normalizeText(context.pageUrl) || toPublicUrl(window.location.href);
    const itemType = resolveIssueItemType(context);
    const requestType = resolveRequestType(context, itemType);
    const references = deriveReferences(context, publicUrl);
    const details = normalizeText(context.details) || DEFAULT_DETAILS_PROMPT;
    const params = new URLSearchParams();
    params.set('template', ISSUE_TEMPLATE_FILE);
    params.set('title', deriveIssueTitle(context));
    params.set('body', deriveBody(context, publicUrl));

    setParamIfPresent(params, 'request_type', requestType);
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
    setParamIfPresent(params, 'details', details, 1000);
    setParamIfPresent(params, 'references', references, 2000);
    return `${ISSUE_BASE_URL}?${params.toString()}`;
  }

  function applyIssueButtonHref() {
    const context = (window.LLVM_LIBRARY_ISSUE_CONTEXT && typeof window.LLVM_LIBRARY_ISSUE_CONTEXT === 'object')
      ? window.LLVM_LIBRARY_ISSUE_CONTEXT
      : {};

    ensureInlineIssueButtonPlacement(context);

    const buttons = document.querySelectorAll('#report-issue-btn');
    if (!buttons.length) return;

    const href = buildIssueHref(context);
    for (const issueButton of buttons) {
      issueButton.href = href;
      issueButton.setAttribute('aria-label', `${buildIssueButtonLabel(context)} (opens in new tab)`);
      issueButton.setAttribute('target', '_blank');
      issueButton.setAttribute('rel', 'noopener noreferrer');
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

  if (window.MutationObserver && document.body) {
    const observer = new MutationObserver(() => {
      applyIssueButtonHref();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();

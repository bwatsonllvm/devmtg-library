/**
 * talk.js — Talk detail page logic for LLVM Developers' Meeting Library
 */

// ============================================================
// Data Loading
// ============================================================

const HubUtils = window.LLVMHubUtils || {};

function normalizeTalks(rawTalks) {
  if (typeof HubUtils.normalizeTalks === 'function') {
    return HubUtils.normalizeTalks(rawTalks);
  }
  return Array.isArray(rawTalks) ? rawTalks : null;
}

async function loadTalks() {
  if (typeof window.loadEventData !== 'function') {
    return null;
  }
  try {
    const { talks } = await window.loadEventData();
    return normalizeTalks(talks);
  } catch {
    return null;
  }
}

// ============================================================
// Helpers
// ============================================================

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CATEGORY_META = {
  'keynote':        'Keynote',
  'technical-talk': 'Technical Talk',
  'tutorial':       'Tutorial',
  'panel':          'Panel',
  'quick-talk':     'Quick Talk',
  'lightning-talk': 'Lightning Talk',
  'student-talk':   'Student Talk',
  'bof':            'BoF',
  'poster':         'Poster',
  'workshop':       'Workshop',
  'other':          'Other',
};

function categoryLabel(cat) {
  return CATEGORY_META[cat] ?? cat;
}

function formatMeetingDate(value) {
  if (typeof HubUtils.formatMeetingDateUniversal === 'function') {
    return HubUtils.formatMeetingDateUniversal(value);
  }
  return String(value || '').trim();
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through
    }
  }
  try {
    const input = document.createElement('input');
    input.value = text;
    input.setAttribute('readonly', 'readonly');
    input.style.position = 'absolute';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(input);
    return !!ok;
  } catch {
    return false;
  }
}

function initMobileNavMenu() {
  const menu = document.getElementById('mobile-nav-menu');
  const toggle = document.getElementById('mobile-nav-toggle');
  const panel = document.getElementById('mobile-nav-panel');
  if (!menu || !toggle || !panel) return;

  const openMenu = () => {
    menu.classList.add('open');
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
  };

  const closeMenu = () => {
    menu.classList.remove('open');
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  };

  const isInsideMenu = (target) => menu.contains(target);

  closeMenu();

  toggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (menu.classList.contains('open')) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  panel.addEventListener('click', (event) => {
    const target = event.target.closest('a,button');
    if (target) closeMenu();
  });

  document.addEventListener('pointerdown', (event) => {
    if (!isInsideMenu(event.target)) closeMenu();
  });

  document.addEventListener('focusin', (event) => {
    if (!isInsideMenu(event.target)) closeMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.classList.contains('open')) {
      closeMenu();
      toggle.focus();
    }
  });
}

function initShareMenu() {
  const menu = document.getElementById('share-menu');
  const toggle = document.getElementById('share-btn');
  const panel = document.getElementById('share-panel');
  const copyBtn = document.getElementById('share-copy-link');
  const nativeShareBtn = document.getElementById('share-native-share');
  const emailLink = document.getElementById('share-email-link');
  const xLink = document.getElementById('share-x-link');
  const linkedInLink = document.getElementById('share-linkedin-link');
  if (!menu || !toggle || !panel || !copyBtn || !emailLink || !xLink || !linkedInLink) return;

  const shareUrl = window.location.href;
  const shareTitle = document.title || "LLVM Developers' Meeting Library";
  const defaultLabel = toggle.textContent.trim() || 'Share';
  let resetTimer = null;

  emailLink.href = `mailto:?subject=${encodeURIComponent(shareTitle)}&body=${encodeURIComponent(`${shareTitle} - ${shareUrl}`)}`;
  xLink.href = `https://x.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareTitle)}`;
  linkedInLink.href = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;

  const setButtonState = (label, success = false) => {
    toggle.textContent = label;
    toggle.classList.toggle('is-success', success);
    if (resetTimer) window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      toggle.textContent = defaultLabel;
      toggle.classList.remove('is-success');
    }, 1500);
  };

  const openMenu = () => {
    menu.classList.add('open');
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
  };

  const closeMenu = () => {
    menu.classList.remove('open');
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  };

  const isInsideMenu = (target) => menu.contains(target);
  const supportsNativeShare = typeof navigator.share === 'function';

  if (nativeShareBtn) {
    nativeShareBtn.hidden = !supportsNativeShare;
  }

  closeMenu();

  toggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (menu.classList.contains('open')) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  if (nativeShareBtn && supportsNativeShare) {
    nativeShareBtn.addEventListener('click', async (event) => {
      event.preventDefault();
      try {
        await navigator.share({ title: shareTitle, url: shareUrl });
        setButtonState('Shared', true);
      } catch (error) {
        if (error && error.name === 'AbortError') return;
        setButtonState('Share failed', false);
      }
      closeMenu();
    });
  }

  copyBtn.addEventListener('click', async (event) => {
    event.preventDefault();
    const copied = await copyTextToClipboard(shareUrl);
    setButtonState(copied ? 'Link copied' : 'Copy failed', copied);
    if (copied) closeMenu();
  });

  [emailLink, xLink, linkedInLink].forEach((link) => {
    link.addEventListener('click', () => {
      closeMenu();
    });
  });

  document.addEventListener('pointerdown', (event) => {
    if (!isInsideMenu(event.target)) closeMenu();
  });

  document.addEventListener('focusin', (event) => {
    if (!isInsideMenu(event.target)) closeMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.classList.contains('open')) {
      closeMenu();
      toggle.focus();
    }
  });
}

function sourceNameFromHost(hostname) {
  const host = (hostname || '').toLowerCase().replace(/^www\./, '');
  if (!host) return 'External Source';
  if (host === 'youtu.be' || host.endsWith('youtube.com')) return 'YouTube';
  if (host === 'devimages.apple.com') return 'Apple Developer';
  return host;
}

function isAppleDeveloperVideoUrl(videoUrl) {
  if (!videoUrl) return false;
  try {
    const host = new URL(videoUrl).hostname.toLowerCase().replace(/^www\./, '');
    return host === 'devimages.apple.com';
  } catch {
    return false;
  }
}

function getVideoLinkMeta(videoUrl, titleEsc) {
  const fallback = {
    text: 'Watch Video',
    ariaLabel: `Watch video: ${titleEsc} (opens in new tab)`,
    icon: 'play',
  };
  if (!videoUrl) return fallback;

  try {
    const url = new URL(videoUrl);
    const sourceName = sourceNameFromHost(url.hostname);
    const isYouTube = sourceName === 'YouTube';
    const isDownload =
      /\.(mov|m4v|mp4|mkv|avi|wmv|webm)$/i.test(url.pathname) ||
      /download/i.test(url.pathname) ||
      /download/i.test(url.search);

    if (isDownload) {
      const sourceText = isYouTube ? '' : ` (${sourceName})`;
      return {
        text: `Download${sourceText}`,
        ariaLabel: `Download video${isYouTube ? '' : ` from ${sourceName}`}: ${titleEsc} (opens in new tab)`,
        icon: sourceName === 'Apple Developer' ? 'tv' : 'download',
      };
    }

    if (!isYouTube) {
      return {
        text: `Watch on ${sourceName}`,
        ariaLabel: `Watch on ${sourceName}: ${titleEsc} (opens in new tab)`,
        icon: 'play',
      };
    }

    return {
      text: 'Watch on YouTube',
      ariaLabel: `Watch on YouTube: ${titleEsc} (opens in new tab)`,
      icon: 'play',
    };
  } catch {
    return fallback;
  }
}

// SVG icons for no-video placeholder (same as app.js)
const _SVG_DOC = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`;
const _SVG_TOOL = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;
const _SVG_CHAT = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
const _SVG_TV = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2" ry="2"/><line x1="8" y1="20" x2="16" y2="20"/><line x1="12" y1="17" x2="12" y2="20"/><polygon points="10 9 15 11 10 13 10 9" fill="currentColor" stroke="none"/></svg>`;

function placeholderSvgForCategory(category) {
  return { workshop: _SVG_TOOL, panel: _SVG_CHAT, bof: _SVG_CHAT }[category] ?? _SVG_DOC;
}

function placeholderSvgForTalk(talk) {
  if (isAppleDeveloperVideoUrl(talk.videoUrl)) return _SVG_TV;
  return placeholderSvgForCategory(talk.category);
}

window.thumbnailError = function(img, category) {
  const div = document.createElement('div');
  div.className = 'card-thumbnail-placeholder';
  div.innerHTML = placeholderSvgForCategory(category);
  img.parentElement.replaceChild(div, img);
};

// ============================================================
// Abstract Rendering
// ============================================================

function renderAbstract(abstract) {
  if (!abstract) return '<p><em>No abstract available.</em></p>';

  // Split into paragraphs on double newlines or \n
  const paras = abstract
    .split(/\n{2,}|\r\n\r\n/)
    .map(p => p.trim())
    .filter(Boolean);

  return paras.map(para => {
    // Detect bullet lists (lines starting with - or * or •)
    const lines = para.split(/\n/).map(l => l.trim());
    const isList = lines.length > 1 && lines.every(l => /^[-*•]/.test(l));

    if (isList) {
      const items = lines.map(l => `<li>${escapeHtml(l.replace(/^[-*•]\s*/, ''))}</li>`).join('');
      return `<ul>${items}</ul>`;
    }

    // Check for numbered list
    const isNumbered = lines.length > 1 && lines.every((l, i) => new RegExp(`^${i + 1}[.)]`).test(l));
    if (isNumbered) {
      const items = lines.map(l => `<li>${escapeHtml(l.replace(/^\d+[.)]\s*/, ''))}</li>`).join('');
      return `<ol>${items}</ol>`;
    }

    // Single line with embedded bullet points using * prefix
    if (para.includes('\n* ') || para.includes('\n- ')) {
      const [intro, ...rest] = para.split('\n');
      const introHtml = intro.trim() ? `<p>${escapeHtml(intro.trim())}</p>` : '';
      const items = rest.map(l => `<li>${escapeHtml(l.replace(/^[-*]\s*/, '').trim())}</li>`).join('');
      return `${introHtml}<ul>${items}</ul>`;
    }

    return `<p>${escapeHtml(para.replace(/\n/g, ' '))}</p>`;
  }).join('\n');
}

// ============================================================
// Speaker Rendering
// ============================================================

function githubSvg() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>`;
}

function linkedinSvg() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`;
}

function twitterSvg() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.734-8.838L1.254 2.25H8.08l4.259 5.632 5.905-5.632zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`;
}

function renderSpeakers(speakers) {
  if (!speakers || speakers.length === 0) {
    return '<p style="color: var(--color-text-muted); font-size: var(--font-size-sm);">Speaker information not available.</p>';
  }

  return speakers.map(s => {
    const socialLinks = [];
    if (s.github)   socialLinks.push(`<a href="${escapeHtml(s.github)}"   class="speaker-social-link" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(s.name)} on GitHub (opens in new tab)">${githubSvg()}</a>`);
    if (s.linkedin) socialLinks.push(`<a href="${escapeHtml(s.linkedin)}" class="speaker-social-link" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(s.name)} on LinkedIn (opens in new tab)">${linkedinSvg()}</a>`);
    if (s.twitter)  socialLinks.push(`<a href="${escapeHtml(s.twitter)}"  class="speaker-social-link" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(s.name)} on X (opens in new tab)">${twitterSvg()}</a>`);

    return `
      <div class="speaker-chip">
        <div>
          <a href="index.html?speaker=${encodeURIComponent(s.name)}" class="speaker-name-link" aria-label="View all talks by ${escapeHtml(s.name)}">${escapeHtml(s.name)}</a>
          ${s.affiliation ? `<br><span class="speaker-affiliation">${escapeHtml(s.affiliation)}</span>` : ''}
        </div>
        ${socialLinks.length ? `<div class="speaker-social" aria-label="Social links for ${escapeHtml(s.name)}">${socialLinks.join('')}</div>` : ''}
      </div>`;
  }).join('');
}

// ============================================================
// Related Talks
// ============================================================

function getRelatedTalks(talk, allTalks) {
  const MAX_SAME_MEETING = 4;
  const MAX_TOTAL = 6;

  const sameMeeting = allTalks
    .filter(t => t.meeting === talk.meeting && t.id !== talk.id)
    .slice(0, MAX_SAME_MEETING);

  const sameMeetingIds = new Set(sameMeeting.map(t => t.id));

  const sameCategory = allTalks
    .filter(t => t.category === talk.category && t.id !== talk.id && !sameMeetingIds.has(t.id))
    .sort(() => Math.random() - 0.5)
    .slice(0, MAX_TOTAL - sameMeeting.length);

  return [...sameMeeting, ...sameCategory];
}

function renderRelatedCard(talk) {
  const thumbnailUrl = talk.videoId
    ? `https://img.youtube.com/vi/${talk.videoId}/hqdefault.jpg`
    : '';
  const speakerText = talk.speakers?.map(s => s.name).join(', ') || '';
  const badgeCls = `badge badge-${escapeHtml(talk.category || 'other')}`;

  // Per-name speaker links that navigate to speaker-filtered search
  const speakerLinksHtml = talk.speakers?.length
    ? talk.speakers.map(s =>
        `<a href="index.html?speaker=${encodeURIComponent(s.name)}" class="card-speaker-link" aria-label="View all talks by ${escapeHtml(s.name)}">${escapeHtml(s.name)}</a>`
      ).join('<span class="speaker-btn-sep">, </span>')
    : '';

  const relatedLabel = speakerText
    ? `${escapeHtml(talk.title)} by ${escapeHtml(speakerText)}`
    : escapeHtml(talk.title);
  return `
    <article class="talk-card">
      <a href="talk.html?id=${escapeHtml(talk.id)}" class="card-link-wrap" aria-label="${relatedLabel}">
        <div class="card-thumbnail" aria-hidden="true">
          ${thumbnailUrl
            ? `<img src="${escapeHtml(thumbnailUrl)}" alt="" loading="lazy" onerror="thumbnailError(this,'${escapeHtml(talk.category || '')}')">`
            : `<div class="card-thumbnail-placeholder">${placeholderSvgForTalk(talk)}</div>`}
        </div>
        <div class="card-body">
          <div class="card-meta">
            <span class="${badgeCls}">${escapeHtml(categoryLabel(talk.category || 'other'))}</span>
            <span class="meeting-label">${escapeHtml(talk.meeting || '')}</span>
          </div>
          <p class="card-title">${escapeHtml(talk.title)}</p>
          ${speakerLinksHtml ? `<p class="card-speakers">${speakerLinksHtml}</p>` : ''}
        </div>
      </a>
    </article>`;
}

// ============================================================
// Full Detail Render
// ============================================================

function renderTalkDetail(talk, allTalks) {
  const root = document.getElementById('talk-detail-root');
  const badgeCls = `badge badge-${escapeHtml(talk.category || 'other')}`;
  const speakersHtml = renderSpeakers(talk.speakers);

  // Video section
  let videoHtml = '';
  if (talk.videoId) {
    videoHtml = `
      <section class="video-section" aria-label="Video">
        <div class="section-label" aria-hidden="true">Video</div>
        <div class="video-embed">
          <iframe
            src="https://www.youtube.com/embed/${escapeHtml(talk.videoId)}"
            title="${escapeHtml(talk.title)}"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
            loading="lazy"
          ></iframe>
        </div>
      </section>`;
  }

  // Links bar
  const tEsc = escapeHtml(talk.title);
  const linkItems = [];
  if (talk.videoUrl) {
    const videoMeta = getVideoLinkMeta(talk.videoUrl, tEsc);
    const videoIcon = videoMeta.icon === 'download'
      ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 21h16"/></svg>`
      : videoMeta.icon === 'tv'
        ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2" ry="2"/><line x1="8" y1="20" x2="16" y2="20"/><line x1="12" y1="17" x2="12" y2="20"/></svg>`
        : `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    linkItems.push(`
      <a href="${escapeHtml(talk.videoUrl)}" class="link-btn" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(videoMeta.ariaLabel)}">
        ${videoIcon}
        ${escapeHtml(videoMeta.text)}
      </a>`);
  }
  if (talk.slidesUrl) {
    linkItems.push(`
      <a href="${escapeHtml(talk.slidesUrl)}" class="link-btn" target="_blank" rel="noopener noreferrer" aria-label="View slides for ${tEsc} (opens in new tab)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        View Slides
      </a>`);
  }
  if (talk.projectGithub) {
    linkItems.push(`
      <a href="${escapeHtml(talk.projectGithub)}" class="link-btn" target="_blank" rel="noopener noreferrer" aria-label="Project on GitHub: ${tEsc} (opens in new tab)">
        ${githubSvg()}
        Project on GitHub
      </a>`);
  }
  const linksBarHtml = linkItems.length ? `
    <div class="links-bar" aria-label="Resources">
      ${linkItems.join('')}
    </div>` : '';

  // Tags
  const tags = talk.tags || [];
  const tagsHtml = tags.length
    ? `<section class="tags-section" aria-label="Topics">
        <div class="section-label" aria-hidden="true">Topics</div>
        <div class="detail-tags">
          ${tags.map(tag =>
            `<a href="index.html?tag=${encodeURIComponent(tag)}" class="detail-tag" aria-label="Browse talks tagged ${escapeHtml(tag)}">${escapeHtml(tag)}</a>`
          ).join('')}
        </div>
      </section>`
    : '';

  // Related talks
  const related = getRelatedTalks(talk, allTalks);

  // Meeting info
  const meetingInfoParts = [formatMeetingDate(talk.meetingDate), talk.meetingLocation].filter(Boolean);

  const html = `
    <div class="talk-detail">
      <a href="index.html" class="back-btn" id="back-btn" aria-label="Back to all talks">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
        <span aria-hidden="true">All Talks</span>
      </a>

      <div class="talk-header">
        <div class="talk-header-meta">
          <span class="${badgeCls}">${escapeHtml(categoryLabel(talk.category || 'other'))}</span>
          ${meetingInfoParts.length ? `
          <a href="index.html?meeting=${escapeHtml(talk.meeting)}" class="meeting-info-badge" aria-label="Browse talks from ${escapeHtml(meetingInfoParts.join(', '))}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span aria-hidden="true">${escapeHtml(meetingInfoParts.join(' · '))}</span>
          </a>` : ''}
        </div>
        <h1 class="talk-title">${escapeHtml(talk.title)}</h1>
      </div>

      <section class="speakers-section" aria-label="Speakers">
        <div class="section-label" aria-hidden="true">Speakers</div>
        <div class="speakers-list">
          ${speakersHtml}
        </div>
      </section>

      ${videoHtml}

      ${linksBarHtml}

      <section class="abstract-section" aria-label="Abstract">
        <div class="section-label" aria-hidden="true">Abstract</div>
        <div class="abstract-body">
          ${renderAbstract(talk.abstract)}
        </div>
      </section>

      ${tagsHtml}
    </div>

    ${related.length ? `
    <section class="related-section" aria-label="Related talks">
      <h2>More from ${escapeHtml(talk.meetingName || talk.meeting)}</h2>
      <div class="related-grid">
        ${related.map(t => renderRelatedCard(t)).join('')}
      </div>
    </section>` : ''}
  `;

  root.innerHTML = html;
  root.className = '';

  // Wire up back button — restore search state if available
  document.getElementById('back-btn').addEventListener('click', e => {
    const saved = sessionStorage.getItem('llvm-hub-search-state');
    if (saved) {
      // Let the navigation happen; app.js will restore state
      return;
    }
    // Otherwise just go back in history if possible
    if (window.history.length > 1) {
      e.preventDefault();
      window.history.back();
    }
  });
}

// ============================================================
// Not Found
// ============================================================

function renderNotFound(id) {
  const root = document.getElementById('talk-detail-root');
  root.innerHTML = `
    <div class="talk-detail">
      <a href="index.html" class="back-btn" aria-label="Back to all talks">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
        <span aria-hidden="true">All Talks</span>
      </a>
      <div class="empty-state">
        <div class="empty-state-icon" aria-hidden="true">🔍</div>
        <h2>Talk not found</h2>
        <p>No talk found with ID <code>${escapeHtml(id || '(none)')}</code>.</p>
        <p><a href="index.html">Browse all talks →</a></p>
      </div>
    </div>`;
}

// ============================================================
// Customization (Theme + Text Size)
// ============================================================

const THEME_PREF_KEY = 'llvm-hub-theme-preference';
const TEXT_SIZE_KEY = 'llvm-hub-text-size';
const THEME_PREF_VALUES = new Set(['system', 'light', 'dark']);
const TEXT_SIZE_VALUES = new Set(['small', 'default', 'large']);
let systemThemeQuery = null;

function getThemePreference() {
  const saved = localStorage.getItem(THEME_PREF_KEY);
  return THEME_PREF_VALUES.has(saved) ? saved : 'system';
}

function resolveTheme(preference) {
  if (preference === 'light' || preference === 'dark') return preference;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(preference, persist = false) {
  const pref = THEME_PREF_VALUES.has(preference) ? preference : 'system';
  const resolved = resolveTheme(pref);
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.setAttribute('data-theme-preference', pref);
  document.documentElement.style.backgroundColor = resolved === 'dark' ? '#fafafa' : '#0b0d10';
  if (persist) localStorage.setItem(THEME_PREF_KEY, pref);
}

function getTextSizePreference() {
  const saved = localStorage.getItem(TEXT_SIZE_KEY);
  return TEXT_SIZE_VALUES.has(saved) ? saved : 'default';
}

function applyTextSize(size, persist = false) {
  const textSize = TEXT_SIZE_VALUES.has(size) ? size : 'default';
  if (textSize === 'default') {
    document.documentElement.removeAttribute('data-text-size');
  } else {
    document.documentElement.setAttribute('data-text-size', textSize);
  }
  if (persist) localStorage.setItem(TEXT_SIZE_KEY, textSize);
}

function syncCustomizationMenuControls() {
  const themeSelect = document.getElementById('custom-theme-select');
  const textSizeSelect = document.getElementById('custom-text-size-select');
  if (themeSelect) themeSelect.value = getThemePreference();
  if (textSizeSelect) textSizeSelect.value = getTextSizePreference();
}

function handleSystemThemeChange() {
  if (getThemePreference() === 'system') {
    applyTheme('system');
    syncCustomizationMenuControls();
  }
}

function initTheme() {
  applyTheme(getThemePreference());
  if (systemThemeQuery) return;
  systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  if (typeof systemThemeQuery.addEventListener === 'function') {
    systemThemeQuery.addEventListener('change', handleSystemThemeChange);
  } else if (typeof systemThemeQuery.addListener === 'function') {
    systemThemeQuery.addListener(handleSystemThemeChange);
  }
}

function initTextSize() {
  applyTextSize(getTextSizePreference());
}

function initCustomizationMenu() {
  const menu = document.getElementById('customization-menu');
  const toggle = document.getElementById('customization-toggle');
  const panel = document.getElementById('customization-panel');
  const themeSelect = document.getElementById('custom-theme-select');
  const textSizeSelect = document.getElementById('custom-text-size-select');
  const resetBtn = document.getElementById('custom-reset-display');
  if (!menu || !toggle || !panel || !themeSelect || !textSizeSelect || !resetBtn) return;

  syncCustomizationMenuControls();

  const openMenu = () => {
    menu.classList.add('open');
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
  };
  const closeMenu = () => {
    menu.classList.remove('open');
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  };
  const isInsideMenu = (target) => menu.contains(target);

  // Always start closed, even when restoring from BFCache/session history.
  closeMenu();

  toggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (menu.classList.contains('open')) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  themeSelect.addEventListener('change', () => {
    const preference = THEME_PREF_VALUES.has(themeSelect.value) ? themeSelect.value : 'system';
    applyTheme(preference, true);
    syncCustomizationMenuControls();
  });

  textSizeSelect.addEventListener('change', () => {
    const size = TEXT_SIZE_VALUES.has(textSizeSelect.value) ? textSizeSelect.value : 'default';
    applyTextSize(size, true);
    syncCustomizationMenuControls();
  });

  resetBtn.addEventListener('click', () => {
    localStorage.removeItem(THEME_PREF_KEY);
    localStorage.removeItem(TEXT_SIZE_KEY);
    applyTheme('system');
    applyTextSize('default');
    syncCustomizationMenuControls();
  });

  document.addEventListener('pointerdown', (event) => {
    if (!isInsideMenu(event.target)) closeMenu();
  });

  document.addEventListener('focusin', (event) => {
    if (!isInsideMenu(event.target)) closeMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.classList.contains('open')) {
      closeMenu();
      toggle.focus();
    }
  });
}

// ============================================================
// Init
// ============================================================

async function init() {
  initTheme();
  initTextSize();
  initCustomizationMenu();
  initMobileNavMenu();
  initShareMenu();

  const params = new URLSearchParams(window.location.search);
  const talkId = params.get('id');

  const allTalks = await loadTalks();

  if (!allTalks) {
    const root = document.getElementById('talk-detail-root');
    root.innerHTML = `
      <div class="talk-detail">
        <div class="empty-state" role="alert">
          <div class="empty-state-icon" aria-hidden="true">⚠️</div>
          <h2>Could not load data</h2>
          <p>Ensure <code>events/index.json</code> and <code>events/*.json</code> are available and that <code>js/events-data.js</code> loads first.</p>
        </div>
      </div>`;
    return;
  }

  if (!talkId) {
    renderNotFound(null);
    return;
  }

  const talk = allTalks.find(t => t.id === talkId);
  if (!talk) {
    renderNotFound(talkId);
    return;
  }

  // Update page title
  document.title = `${talk.title} — LLVM Developers' Meeting Library`;

  renderTalkDetail(talk, allTalks);
}

init();

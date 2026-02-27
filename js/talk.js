/**
 * talk.js - minimal talk detail runtime.
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
  const safeSessionGet = PageShell ? PageShell.safeSessionGet : () => null;

  function normalizeTalks(rawTalks) {
    if (typeof HubUtils.normalizeTalks === 'function') return HubUtils.normalizeTalks(rawTalks);
    return Array.isArray(rawTalks) ? rawTalks : [];
  }

  function getTalkTopics(talk, limit = Infinity) {
    if (typeof HubUtils.getTalkKeyTopics === 'function') {
      return HubUtils.getTalkKeyTopics(talk, limit);
    }
    const tags = Array.isArray(talk && talk.tags) ? talk.tags : [];
    return Number.isFinite(limit) ? tags.slice(0, Math.max(0, Math.floor(limit))) : tags;
  }

  function formatMeetingDate(value) {
    if (typeof HubUtils.formatMeetingDateUniversal === 'function') {
      return HubUtils.formatMeetingDateUniversal(value);
    }
    return String(value || '').trim();
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

  function updateSeo(talk) {
    if (!talk || typeof talk !== 'object') return;
    const title = String(talk.title || '').trim();
    if (!title) return;
    const description = String(talk.abstract || '').replace(/\s+/g, ' ').trim().slice(0, 260);
    upsertMeta('name', 'description', description || `${title} talk details`);
    upsertMeta('property', 'og:type', 'article');
    upsertMeta('property', 'og:title', `${title} — LLVM Research Library`);
    upsertMeta('property', 'og:description', description || title);
    upsertMeta('property', 'og:url', window.location.href);
    upsertMeta('name', 'twitter:card', 'summary');
    upsertMeta('name', 'twitter:title', `${title} — LLVM Research Library`);
    upsertMeta('name', 'twitter:description', description || title);
  }

  function setIssueContext(context) {
    if (typeof window.setLibraryIssueContext !== 'function') return;
    if (!context || typeof context !== 'object') return;
    window.setLibraryIssueContext(context);
  }

  function setIssueContextForTalk(talk) {
    if (!talk || typeof talk !== 'object') return;
    setIssueContext({
      pageType: 'Talk',
      itemType: 'Talk',
      itemId: String(talk.id || '').trim(),
      itemTitle: String(talk.title || '').trim(),
      pageTitle: `${String(talk.title || '').trim()} — LLVM Research Library`,
      meeting: String(talk.meeting || '').trim(),
      meetingName: String(talk.meetingName || '').trim(),
      slidesUrl: String(talk.slidesUrl || '').trim(),
      videoUrl: String(talk.videoUrl || '').trim(),
      sourceUrl: String(talk.sourceUrl || '').trim(),
    });
  }

  async function loadTalkDetailContextById(talkId) {
    const targetId = String(talkId || '').trim();
    if (!targetId) return { loaded: true, talk: null, relatedPool: [] };

    if (typeof window.loadTalkRecordById === 'function') {
      try {
        const payload = await window.loadTalkRecordById(targetId);
        if (!payload || typeof payload !== 'object') {
          return { loaded: true, talk: null, relatedPool: [] };
        }
        const normalizedTalk = normalizeTalks([payload.talk]);
        const talk = normalizedTalk.length ? normalizedTalk[0] : null;
        const relatedPool = normalizeTalks(payload.talks);
        return {
          loaded: true,
          talk,
          relatedPool: Array.isArray(relatedPool) ? relatedPool : [],
        };
      } catch {
        // Fallback below.
      }
    }

    if (typeof window.loadEventData !== 'function') {
      return { loaded: false, talk: null, relatedPool: [] };
    }

    try {
      const payload = await window.loadEventData();
      const talks = normalizeTalks(payload && payload.talks);
      const talk = talks.find((candidate) => String(candidate && candidate.id || '') === targetId) || null;
      return { loaded: true, talk, relatedPool: talks };
    } catch {
      return { loaded: false, talk: null, relatedPool: [] };
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

  function buildSpeakerWorkUrl(name) {
    const speaker = String(name || '').trim();
    if (!speaker) return 'work.html';
    return `work.html?kind=speaker&value=${encodeURIComponent(speaker)}&from=talks`;
  }

  function renderSpeakers(speakers) {
    const values = Array.isArray(speakers) ? speakers : [];
    if (!values.length) {
      return '<p style="color: var(--color-text-muted); font-size: var(--font-size-sm);">Speaker information not available.</p>';
    }

    return values.map((speaker) => {
      const name = String(speaker && speaker.name || '').trim();
      if (!name) return '';
      const affiliation = String(speaker && speaker.affiliation || '').trim();
      return `
        <div class="speaker-chip">
          <div>
            <a href="${buildSpeakerWorkUrl(name)}" class="speaker-name-link" aria-label="View talks and papers by ${escapeHtml(name)}">${escapeHtml(name)}</a>
            ${affiliation ? `<br><span class="speaker-affiliation">${escapeHtml(affiliation)}</span>` : ''}
          </div>
        </div>`;
    }).join('');
  }

  function getRelatedTalks(talk, relatedPool) {
    const values = Array.isArray(relatedPool) ? relatedPool : [];
    const targetId = String(talk && talk.id || '').trim();
    if (!targetId || !values.length) return [];

    const MAX = 6;
    const sameMeeting = [];
    const sameCategory = [];

    for (const candidate of values) {
      if (!candidate || typeof candidate !== 'object') continue;
      const candidateId = String(candidate.id || '').trim();
      if (!candidateId || candidateId === targetId) continue;

      if (candidate.meeting && talk.meeting && candidate.meeting === talk.meeting) {
        sameMeeting.push(candidate);
        continue;
      }
      if (candidate.category && talk.category && candidate.category === talk.category) {
        sameCategory.push(candidate);
      }
    }

    const out = [];
    const seen = new Set();
    for (const list of [sameMeeting, sameCategory]) {
      for (const item of list) {
        const id = String(item.id || '').trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(item);
        if (out.length >= MAX) return out;
      }
    }
    return out;
  }

  function renderRelatedCard(talk) {
    const title = String(talk && talk.title || '').trim() || '(untitled talk)';
    const meeting = String(talk && talk.meeting || '').trim();
    const speakers = Array.isArray(talk && talk.speakers)
      ? talk.speakers.map((s) => String(s && s.name || '').trim()).filter(Boolean)
      : [];
    const speakerText = speakers.join(', ');
    const label = speakerText ? `${title} by ${speakerText}` : title;

    return `
      <article class="talk-card">
        <a href="talks/talk.html?id=${encodeURIComponent(String(talk && talk.id || '').trim())}" class="card-link-wrap" aria-label="${escapeHtml(label)}">
          <div class="card-body">
            <div class="card-meta">
              ${meeting ? `<span class="meeting-label">${escapeHtml(meeting)}</span>` : ''}
            </div>
            <p class="card-title">${escapeHtml(title)}</p>
          </div>
        </a>
      </article>`;
  }

  function renderNotFound(id) {
    const root = document.getElementById('talk-detail-root');
    if (!root) return;
    root.innerHTML = `
      <div class="talk-detail">
        <a href="talks/" class="back-btn" aria-label="Back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          <span aria-hidden="true">All Talks</span>
        </a>
        <div class="empty-state">
          <div class="empty-state-icon" aria-hidden="true">!</div>
          <h2>Talk not found</h2>
          <p>No talk found with ID <code>${escapeHtml(id || '(none)')}</code>.</p>
          <p><a href="talks/">Browse all talks →</a></p>
        </div>
      </div>`;
  }

  function renderLoadError() {
    const root = document.getElementById('talk-detail-root');
    if (!root) return;
    root.innerHTML = `
      <div class="talk-detail">
        <div class="empty-state" role="alert">
          <div class="empty-state-icon" aria-hidden="true">!</div>
          <h2>Could not load data</h2>
          <p>Ensure <code>devmtg/events/index.json</code> and <code>devmtg/events/*.json</code> are available and that <code>js/events-data.js</code> loads first.</p>
        </div>
      </div>`;
  }

  function renderTalkDetail(talk, relatedPool) {
    const root = document.getElementById('talk-detail-root');
    if (!root) return;

    const title = String(talk.title || '').trim();
    const meetingDate = formatMeetingDate(talk.meetingDate);
    const meetingLocation = String(talk.meetingLocation || '').trim();
    const meetingMeta = [meetingDate, meetingLocation].filter(Boolean).join(' · ');

    const videoUrl = sanitizeExternalUrl(talk.videoUrl);
    const slidesUrl = sanitizeExternalUrl(talk.slidesUrl);
    const githubUrl = sanitizeExternalUrl(talk.projectGithub);
    const sourceUrl = sanitizeExternalUrl(talk.sourceUrl);

    const links = [];
    if (videoUrl) links.push(`<a href="${escapeHtml(videoUrl)}" class="link-btn" target="_blank" rel="noopener noreferrer">Watch Video</a>`);
    if (slidesUrl) links.push(`<a href="${escapeHtml(slidesUrl)}" class="link-btn" target="_blank" rel="noopener noreferrer">View Slides</a>`);
    if (githubUrl) links.push(`<a href="${escapeHtml(githubUrl)}" class="link-btn" target="_blank" rel="noopener noreferrer">Project on GitHub</a>`);
    if (sourceUrl) links.push(`<a href="${escapeHtml(sourceUrl)}" class="link-btn" target="_blank" rel="noopener noreferrer">Source Listing</a>`);

    const topics = getTalkTopics(talk, 18);
    const topicsHtml = topics.length
      ? `<section class="tags-section" aria-label="Key Topics">
          <div class="section-label" aria-hidden="true">Key Topics</div>
          <div class="detail-tags">
            ${topics.map((topic) =>
              `<a href="talks/?tag=${encodeURIComponent(topic)}" class="detail-tag" aria-label="Browse talks for key topic ${escapeHtml(topic)}">${escapeHtml(topic)}</a>`
            ).join('')}
          </div>
        </section>`
      : '';

    const related = getRelatedTalks(talk, relatedPool);

    root.innerHTML = `
      <div class="talk-detail">
        <a href="talks/" class="back-btn" id="back-btn" aria-label="Back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          <span aria-hidden="true">All Talks</span>
        </a>

        <div class="talk-header">
          <div class="talk-header-meta">
            ${meetingMeta ? `<span class="meeting-info-badge">${escapeHtml(meetingMeta)}</span>` : ''}
          </div>
          <h1 class="talk-title">${escapeHtml(title)}</h1>
        </div>

        <section class="speakers-section" aria-label="Speakers">
          <div class="section-label" aria-hidden="true">Speakers</div>
          <div class="speakers-list">${renderSpeakers(talk.speakers)}</div>
        </section>

        ${links.length ? `<div class="links-bar" aria-label="Resources">${links.join('')}</div>` : ''}

        <section class="abstract-section" aria-label="Abstract">
          <div class="section-label" aria-hidden="true">Abstract</div>
          <div class="abstract-body">${renderAbstract(talk.abstract)}</div>
        </section>

        ${topicsHtml}
      </div>

      ${related.length ? `
      <section class="related-section" aria-label="Related talks">
        <h2>Related Talks</h2>
        <div class="related-grid">
          ${related.map((item) => renderRelatedCard(item)).join('')}
        </div>
      </section>` : ''}`;

    const backBtn = document.getElementById('back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', (event) => {
        if (safeSessionGet('llvm-hub-search-state')) return;
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
    const talkId = String(params.get('id') || '').trim();

    setIssueContext({
      pageType: 'Talk',
      itemType: 'Talk',
      itemId: talkId,
    });

    if (!talkId) {
      renderNotFound(null);
      setIssueContext({ itemTitle: 'Missing talk ID', issueTitle: '[Talk] Missing talk ID' });
      initShareMenu();
      return;
    }

    const context = await loadTalkDetailContextById(talkId);
    if (!context || context.loaded !== true) {
      renderLoadError();
      initShareMenu();
      return;
    }

    const talk = context.talk;
    if (!talk) {
      renderNotFound(talkId);
      setIssueContext({ itemTitle: `Unknown talk ID: ${talkId}`, issueTitle: `[Talk] Unknown talk ID: ${talkId}` });
      initShareMenu();
      return;
    }

    document.title = `${String(talk.title || '').trim()} — LLVM Research Library`;
    updateSeo(talk);
    renderTalkDetail(talk, context.relatedPool);
    setIssueContextForTalk(talk);
    initShareMenu();
  }

  init();
})();

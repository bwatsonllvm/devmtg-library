/**
 * events-data.js — Load canonical meeting/talk data from devmtg/events/*.json files.
 */

(function () {
  let inMemoryCache = null;
  let inMemoryVersion = '';

  const MANIFEST_JSON_PATH = 'devmtg/events/index.json';
  const EVENTS_PREFIX = 'devmtg/events/';

  function normalizeManifestJson(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error(`${MANIFEST_JSON_PATH}: expected JSON object`);
    }

    const dataVersion = String(payload.dataVersion || '').trim();
    if (!dataVersion) {
      throw new Error(`${MANIFEST_JSON_PATH}: missing "dataVersion"`);
    }

    const files = Array.isArray(payload.eventFiles)
      ? payload.eventFiles
      : (Array.isArray(payload.events) ? payload.events.map((event) => event.file || event.path || '') : []);

    if (!files.length) {
      throw new Error(`${MANIFEST_JSON_PATH}: missing non-empty "eventFiles"`);
    }

    const eventRefs = files
      .map((file) => String(file || '').trim())
      .filter(Boolean)
      .map((file) => {
        const normalized = file.replace(/^\/+/, '');
        if (normalized.startsWith(EVENTS_PREFIX)) return normalized;
        if (normalized.startsWith('events/')) return `${EVENTS_PREFIX}${normalized.slice('events/'.length)}`;
        return `${EVENTS_PREFIX}${normalized}`;
      });

    for (const ref of eventRefs) {
      if (!ref.toLowerCase().endsWith('.json')) {
        throw new Error(`${MANIFEST_JSON_PATH}: eventFiles must reference .json files (${ref})`);
      }
    }

    return { dataVersion, eventRefs };
  }

  function normalizeEventBundle(payload, sourcePath) {
    if (!payload || typeof payload !== 'object') {
      throw new Error(`${sourcePath}: expected JSON object`);
    }
    if (!Array.isArray(payload.talks)) {
      throw new Error(`${sourcePath}: missing "talks" array`);
    }

    return {
      meeting: payload.meeting || null,
      talks: payload.talks,
    };
  }

  async function fetchJson(path) {
    const resp = await fetch(path, { cache: 'default' });
    if (!resp.ok) {
      throw new Error(`${path}: HTTP ${resp.status}`);
    }
    try {
      return await resp.json();
    } catch (err) {
      throw new Error(`${path}: invalid JSON (${err.message})`);
    }
  }

  async function loadManifest() {
    const manifestPayload = await fetchJson(MANIFEST_JSON_PATH);
    return normalizeManifestJson(manifestPayload);
  }

  async function loadEventData() {
    const manifest = await loadManifest();
    if (inMemoryCache && inMemoryVersion === manifest.dataVersion) {
      return inMemoryCache;
    }

    const bundles = await Promise.all(
      manifest.eventRefs.map(async (path) => {
        const payload = await fetchJson(path);
        return normalizeEventBundle(payload, path);
      })
    );

    const meetings = [];
    const talks = [];

    for (const bundle of bundles) {
      if (bundle.meeting) meetings.push(bundle.meeting);
      talks.push(...bundle.talks);
    }

    inMemoryCache = { talks, meetings };
    inMemoryVersion = manifest.dataVersion;
    return inMemoryCache;
  }

  window.loadEventData = loadEventData;
})();

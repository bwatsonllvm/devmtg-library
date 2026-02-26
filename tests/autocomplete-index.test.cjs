const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const AUTOCOMPLETE_INDEX_PATH = path.join(REPO_ROOT, 'js', 'data', 'autocomplete-index.json');
const GLOBAL_SEARCH_JS = path.join(REPO_ROOT, 'js', 'shared', 'global-search.js');

function parseJson(pathname) {
  const raw = fs.readFileSync(pathname, 'utf8');
  return JSON.parse(raw);
}

test('autocomplete index exists and exposes required arrays', () => {
  assert.ok(fs.existsSync(AUTOCOMPLETE_INDEX_PATH), 'js/data/autocomplete-index.json must exist');
  const payload = parseJson(AUTOCOMPLETE_INDEX_PATH);
  assert.ok(payload && typeof payload === 'object', 'payload must be an object');
  ['topics', 'people', 'talks', 'papers', 'docs'].forEach((key) => {
    assert.ok(Array.isArray(payload[key]), `${key} must be an array`);
  });
  assert.ok(payload.topics.length > 0 || payload.people.length > 0 || payload.talks.length > 0 || payload.papers.length > 0 || payload.docs.length > 0,
    'at least one autocomplete list should be non-empty');
});

test('global-search.js prefers prebuilt autocomplete artifact', () => {
  const raw = fs.readFileSync(GLOBAL_SEARCH_JS, 'utf8');
  assert.match(raw, /const AUTOCOMPLETE_INDEX_SRC\s*=\s*resolveAssetUrl\(['"]js\/data\/autocomplete-index\.json\?v=/,
    'global-search.js must reference the prebuilt autocomplete index');
  assert.match(raw, /async function loadPrebuiltAutocompleteIndex\(/,
    'global-search.js must define prebuilt autocomplete loader');
  assert.match(raw, /const loadedFromPrebuilt\s*=\s*await loadPrebuiltAutocompleteIndex\(/,
    'global-search.js should attempt prebuilt index before runtime corpus loading');
});

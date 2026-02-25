const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DOCS_SOURCES_PATH = path.join(REPO_ROOT, 'docs', 'sources.json');
const GLOBAL_SEARCH_JS = path.join(REPO_ROOT, 'js', 'shared', 'global-search.js');
const WORK_JS = path.join(REPO_ROOT, 'js', 'work.js');

function parseJson(pathname) {
  const raw = fs.readFileSync(pathname, 'utf8');
  return JSON.parse(raw);
}

test('docs sources catalog exists and contains valid entries', () => {
  assert.ok(fs.existsSync(DOCS_SOURCES_PATH), 'docs/sources.json must exist');
  const payload = parseJson(DOCS_SOURCES_PATH);
  assert.ok(payload && typeof payload === 'object', 'catalog payload must be an object');
  assert.ok(Array.isArray(payload.sources), 'catalog payload must expose a sources array');
  assert.ok(payload.sources.length > 0, 'catalog sources must not be empty');

  payload.sources.forEach((source, index) => {
    assert.ok(source && typeof source === 'object', `source[${index}] must be an object`);
    assert.ok(typeof source.id === 'string' && source.id.trim(), `source[${index}].id must be non-empty`);
    assert.ok(typeof source.name === 'string' && source.name.trim(), `source[${index}].name must be non-empty`);
    assert.ok(/^https?:\/\//.test(String(source.docsUrl || '')), `source[${index}].docsUrl must be http/https`);
    assert.ok(/^https?:\/\//.test(String(source.searchUrlTemplate || '')), `source[${index}].searchUrlTemplate must be http/https`);
  });
});

test('global-search.js uses docs sources catalog instead of local docs universal index files', () => {
  const raw = fs.readFileSync(GLOBAL_SEARCH_JS, 'utf8');
  assert.match(raw, /const DOCS_SOURCES_CATALOG_SRC\s*=\s*['"]docs\/sources\.json\?/, 'global-search.js must reference docs/sources.json');
  assert.match(raw, /ensureDocsSourcesLoader\(/, 'global-search.js must load docs sources via ensureDocsSourcesLoader');
  assert.doesNotMatch(raw, /docs-universal-search-index\.js/, 'global-search.js must not reference local docs-universal-search-index files');
});

test('work.js uses docs sources catalog instead of local docs universal index files', () => {
  const raw = fs.readFileSync(WORK_JS, 'utf8');
  assert.match(raw, /const DOCS_SOURCES_CATALOG_SRC\s*=\s*['"]docs\/sources\.json\?/, 'work.js must reference docs/sources.json');
  assert.match(raw, /loadDocsSourceCatalog\(/, 'work.js must load docs sources via loadDocsSourceCatalog');
  assert.doesNotMatch(raw, /docs-universal-search-index\.js/, 'work.js must not reference local docs-universal-search-index files');
});

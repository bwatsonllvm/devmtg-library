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

test('global-search.js uses local docs universal index files for formatted docs search', () => {
  const raw = fs.readFileSync(GLOBAL_SEARCH_JS, 'utf8');
  assert.match(raw, /const DOCS_UNIVERSAL_INDEX_SRC\s*=\s*['"]docs\/_static\/docs-universal-search-index\.js\?/, 'global-search.js must reference the local LLVM docs universal index');
  assert.match(raw, /const CLANG_DOCS_UNIVERSAL_INDEX_SRC\s*=\s*['"]docs\/clang\/_static\/docs-universal-search-index\.js\?/, 'global-search.js must reference the local Clang docs universal index');
  assert.match(raw, /const LLDB_DOCS_UNIVERSAL_INDEX_SRC\s*=\s*['"]docs\/lldb\/_static\/docs-universal-search-index\.js\?/, 'global-search.js must reference the local LLDB docs universal index');
  assert.match(raw, /ensureDocsIndexLoader\(/, 'global-search.js must load docs search data via ensureDocsIndexLoader');
});

test('work.js uses local docs universal index files for formatted docs search', () => {
  const raw = fs.readFileSync(WORK_JS, 'utf8');
  assert.match(raw, /const DOCS_UNIVERSAL_INDEX_SRC\s*=\s*['"]docs\/_static\/docs-universal-search-index\.js\?/, 'work.js must reference the local LLVM docs universal index');
  assert.match(raw, /const CLANG_DOCS_UNIVERSAL_INDEX_SRC\s*=\s*['"]docs\/clang\/_static\/docs-universal-search-index\.js\?/, 'work.js must reference the local Clang docs universal index');
  assert.match(raw, /const LLDB_DOCS_UNIVERSAL_INDEX_SRC\s*=\s*['"]docs\/lldb\/_static\/docs-universal-search-index\.js\?/, 'work.js must reference the local LLDB docs universal index');
  assert.match(raw, /loadDocsUniversalRecords\(/, 'work.js must load docs content via loadDocsUniversalRecords');
});

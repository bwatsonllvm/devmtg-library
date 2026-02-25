const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const CLANG_INDEX_PATH = path.join(
  REPO_ROOT,
  'docs',
  'clang',
  '_static',
  'docs-universal-search-index.js'
);
const LLDB_INDEX_PATH = path.join(
  REPO_ROOT,
  'docs',
  'lldb',
  '_static',
  'docs-universal-search-index.js'
);
const GLOBAL_SEARCH_JS = path.join(REPO_ROOT, 'js', 'shared', 'global-search.js');
const WORK_JS = path.join(REPO_ROOT, 'js', 'work.js');

function parseUniversalIndexPayload(rawJs, label) {
  const match = String(rawJs || '').match(
    /window\.LLVMDocsUniversalSearchIndex\s*=\s*(\{[\s\S]*\})\s*;\s*$/
  );
  assert.ok(match, `${label} must assign window.LLVMDocsUniversalSearchIndex`);
  return JSON.parse(match[1]);
}

test('clang docs universal index payload exists and is non-empty', () => {
  assert.ok(fs.existsSync(CLANG_INDEX_PATH), 'Clang docs universal index file must exist');
  const raw = fs.readFileSync(CLANG_INDEX_PATH, 'utf8');
  const payload = parseUniversalIndexPayload(raw, CLANG_INDEX_PATH);
  assert.ok(payload && typeof payload === 'object', 'payload must be an object');
  assert.ok(Array.isArray(payload.entries), 'payload.entries must be an array');
  assert.ok(payload.entries.length > 0, 'payload.entries must not be empty');
});

test('lldb docs universal index payload exists and is non-empty', () => {
  assert.ok(fs.existsSync(LLDB_INDEX_PATH), 'LLDB docs universal index file must exist');
  const raw = fs.readFileSync(LLDB_INDEX_PATH, 'utf8');
  const payload = parseUniversalIndexPayload(raw, LLDB_INDEX_PATH);
  assert.ok(payload && typeof payload === 'object', 'payload must be an object');
  assert.ok(Array.isArray(payload.entries), 'payload.entries must be an array');
  assert.ok(payload.entries.length > 0, 'payload.entries must not be empty');
});

test('global search wiring includes clang and lldb docs index sources', () => {
  const raw = fs.readFileSync(GLOBAL_SEARCH_JS, 'utf8');
  assert.match(
    raw,
    /const CLANG_DOCS_UNIVERSAL_INDEX_SRC\s*=\s*['"]docs\/clang\/_static\/docs-universal-search-index\.js\?/,
    'global-search.js must reference the Clang docs universal index source'
  );
  assert.match(
    raw,
    /LLVMClangDocsUniversalSearchIndex/,
    'global-search.js must load/handle LLVMClangDocsUniversalSearchIndex'
  );
  assert.match(
    raw,
    /const LLDB_DOCS_UNIVERSAL_INDEX_SRC\s*=\s*['"]docs\/lldb\/_static\/docs-universal-search-index\.js\?/,
    'global-search.js must reference the LLDB docs universal index source'
  );
  assert.match(
    raw,
    /LLVMLLDBDocsUniversalSearchIndex/,
    'global-search.js must load/handle LLVMLLDBDocsUniversalSearchIndex'
  );
});

test('work universal search wiring includes clang and lldb docs index sources', () => {
  const raw = fs.readFileSync(WORK_JS, 'utf8');
  assert.match(
    raw,
    /const CLANG_DOCS_UNIVERSAL_INDEX_SRC\s*=\s*['"]docs\/clang\/_static\/docs-universal-search-index\.js\?/,
    'work.js must reference the Clang docs universal index source'
  );
  assert.match(
    raw,
    /LLVMClangDocsUniversalSearchIndex/,
    'work.js must load/handle LLVMClangDocsUniversalSearchIndex'
  );
  assert.match(
    raw,
    /const LLDB_DOCS_UNIVERSAL_INDEX_SRC\s*=\s*['"]docs\/lldb\/_static\/docs-universal-search-index\.js\?/,
    'work.js must reference the LLDB docs universal index source'
  );
  assert.match(
    raw,
    /LLVMLLDBDocsUniversalSearchIndex/,
    'work.js must load/handle LLVMLLDBDocsUniversalSearchIndex'
  );
});

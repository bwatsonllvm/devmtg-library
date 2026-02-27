const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REQUIRE_DETAIL_SMOKE = process.env.REQUIRE_DETAIL_SMOKE === '1';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeEventBundlePath(fileRef) {
  const raw = String(fileRef || '').trim().replace(/^\/+/, '');
  if (!raw) return '';
  if (raw.startsWith('devmtg/events/')) return raw;
  if (raw.startsWith('events/')) return `devmtg/${raw}`;
  return `devmtg/events/${raw}`;
}

function pickTalkId(repoRoot) {
  const manifestPath = path.join(repoRoot, 'devmtg/events/index.json');
  const manifest = loadJsonFile(manifestPath);
  const files = Array.isArray(manifest.eventFiles)
    ? manifest.eventFiles
    : [];

  for (const fileRef of files) {
    const relativePath = normalizeEventBundlePath(fileRef);
    if (!relativePath) continue;
    const bundlePath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(bundlePath)) continue;
    const bundle = loadJsonFile(bundlePath);
    const talks = Array.isArray(bundle && bundle.talks) ? bundle.talks : [];
    const firstWithId = talks.find((talk) => talk && typeof talk.id === 'string' && talk.id.trim());
    if (firstWithId) return firstWithId.id.trim();
  }

  return '';
}

function pickPaperIds(repoRoot) {
  const bundlePath = path.join(repoRoot, 'papers/combined-all-papers-deduped.json');
  const payload = loadJsonFile(bundlePath);
  const papers = Array.isArray(payload && payload.papers) ? payload.papers : [];

  const firstOpenAlex = papers.find((paper) => {
    const id = String(paper && paper.id || '').trim().toLowerCase();
    return id.startsWith('openalex-');
  });
  const firstAny = papers.find((paper) => String(paper && paper.id || '').trim());
  const firstBlog = papers.find((paper) => {
    const id = String(paper && paper.id || '').trim().toLowerCase();
    return id.startsWith('blog-');
  });

  return {
    paperId: String((firstOpenAlex || firstAny || {}).id || '').trim(),
    blogId: String((firstBlog || {}).id || '').trim(),
  };
}

async function waitForHttpOk(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keep polling until deadline.
    }
    await sleep(120);
  }
  throw new Error(`Timed out waiting for server readiness: ${url}`);
}

async function assertDetailPageHealthy(page, url, rootSelector, label) {
  let crashed = false;
  page.on('crash', () => { crashed = true; });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector(`${rootSelector} .talk-title`, { timeout: 20000 });

  const emptyStateHeadings = (await page.locator(`${rootSelector} .empty-state h2`).allInnerTexts())
    .map((text) => String(text || '').trim().toLowerCase())
    .filter(Boolean);
  assert.ok(
    !emptyStateHeadings.some((heading) => heading.includes('could not load data')),
    `${label}: rendered load error state`
  );
  assert.ok(
    !emptyStateHeadings.some((heading) => heading.includes('not found')),
    `${label}: rendered not-found state`
  );

  const responsive = await page.evaluate(() => new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(false);
    }, 1500);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(true);
      });
    });
  }));

  assert.equal(responsive, true, `${label}: main thread appears unresponsive`);
  assert.equal(crashed, false, `${label}: browser page crashed`);
}

let playwright = null;
try {
  // Optional dependency by default; required only in smoke-gated CI.
  // eslint-disable-next-line global-require, import/no-extraneous-dependencies
  playwright = require('playwright');
} catch {
  playwright = null;
}

if (!playwright) {
  if (REQUIRE_DETAIL_SMOKE) {
    test('detail pages smoke test dependencies', () => {
      assert.fail('REQUIRE_DETAIL_SMOKE=1 but playwright is not installed');
    });
  } else {
    test('detail pages smoke test (skipped without playwright)', { skip: true }, () => {});
  }
} else {
  test('detail pages load and stay responsive', { timeout: 180000 }, async (t) => {
    const repoRoot = path.resolve(__dirname, '..');
    const host = '127.0.0.1';
    const port = 4173;
    const baseUrl = `http://${host}:${port}`;

    const talkId = pickTalkId(repoRoot);
    const { paperId, blogId } = pickPaperIds(repoRoot);

    assert.ok(talkId, 'Could not find a talk ID for smoke test');
    assert.ok(paperId, 'Could not find a paper ID for smoke test');

    const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', host], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
    t.after(() => {
      if (!server.killed) server.kill('SIGTERM');
    });

    await waitForHttpOk(`${baseUrl}/index.html`);

    const browser = await playwright.chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage'],
    });
    t.after(async () => {
      await browser.close();
    });

    const talkPage = await browser.newPage();
    await assertDetailPageHealthy(
      talkPage,
      `${baseUrl}/talks/talk.html?id=${encodeURIComponent(talkId)}`,
      '#talk-detail-root',
      'Talk detail page'
    );
    await talkPage.close();

    const paperPage = await browser.newPage();
    await assertDetailPageHealthy(
      paperPage,
      `${baseUrl}/papers/paper.html?id=${encodeURIComponent(paperId)}&from=paper`,
      '#paper-detail-root',
      'Paper detail page'
    );
    await paperPage.close();

    if (blogId) {
      const blogPage = await browser.newPage();
      await assertDetailPageHealthy(
        blogPage,
        `${baseUrl}/papers/paper.html?id=${encodeURIComponent(blogId)}&from=blogs`,
        '#paper-detail-root',
        'Blog detail page'
      );
      await blogPage.close();
    }
  });
}

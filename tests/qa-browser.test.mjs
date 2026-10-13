// QA harness behaviour in a real headless Chrome: clean pages must pass, small broken fixtures must fail
// with the right finding, and every script must produce what it promises (files, rows, exit codes).
//   node --test --test-concurrency=1 "tests/*.test.mjs"      CHROME_PATH=... to pick a binary, CHROME_ARGS=--no-sandbox on some CI runners
// Without Chrome these tests are skipped locally, but FAIL when CI=true: CI must not pass by skipping.
// axe.mjs tests run when axe-core is found (AXE_PATH, or node_modules/axe-core in the repo); otherwise skipped.
// One Chrome at a time: the tests in this file run sequentially and each script exits before the next starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const QA = join(ROOT, '.claude/skills/website-build/scripts/qa');
const SAMPLE = join(ROOT, 'examples/sample-site');
const { CHROME } = await import(pathToFileURL(join(QA, 'cdp.mjs')).href);
const hasChrome = CHROME !== 'chrome' ? existsSync(CHROME) : spawnSync('chrome', ['--version']).status === 0;
const CI = !!process.env.CI && process.env.CI !== 'false';
const opts = { skip: hasChrome || CI ? false : 'no Chrome found (set CHROME_PATH)', timeout: 120000 };
const AXE = [process.env.AXE_PATH, join(ROOT, 'node_modules/axe-core/axe.min.js')].find(p => p && existsSync(p));
const PY = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

test('CI has a Chrome to test with', { skip: CI ? false : 'not CI' }, () => {
  assert.ok(hasChrome, `no Chrome at ${CHROME}: install one or set CHROME_PATH`);
});

let port = 9700;
// async, so the in-process fixture server can answer while a script runs
const run = (script, args, env = {}) => {
  const p = spawn(process.execPath, [join(QA, script), ...args], { cwd: ROOT, env: { ...process.env, QA_PORT: String(port++), ...env } });
  let stdout = '', stderr = '';
  p.stdout.on('data', d => { stdout += d; }); p.stderr.on('data', d => { stderr += d; });
  const done = new Promise(res => p.on('close', (status, signal) => res({ status, signal, stdout, stderr, out: stdout + stderr })));
  done.proc = p;
  return done;
};

const PAGE = body => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>fixture</title></head><body>${body}</body></html>`;
function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'qa-fixture-'));
  for (const [rel, body] of Object.entries(typeof files === 'string' ? { 'page.html': PAGE(files) } : files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}
async function withDir(files, fn) { const dir = fixture(files); try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } }
// routes: path -> body string | { status, type, body, hang }
async function serve(routes, fn) {
  const hanging = [];
  const srv = createServer((req, res) => {
    const r = routes[req.url.split('?')[0]];
    if (r && r.hang) { hanging.push(res); return; }
    if (!r) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
    const o = typeof r === 'string' ? { body: r } : r;
    res.writeHead(o.status || 200, { 'content-type': o.type || 'text/html' }); res.end(o.body);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${srv.address().port}`); }
  finally { for (const r of hanging) r.destroy(); srv.closeAllConnections?.(); await new Promise(r => srv.close(r)); }
}

// ---- audit ---------------------------------------------------------------------------------------
test('audit: the sample site source is clean at desktop and the smallest phone width', opts, async () => {
  const r = await run('audit.mjs', [SAMPLE], { QA_WIDTHS: '1440x900,320x700' });
  assert.equal(r.status, 0, r.out);
  assert.match(r.stdout, /2 pages x 2 widths, 0 with issues/);
});

test('build chain: the multi-language output passes jscheck and audit', opts, async () => {
  const out = mkdtempSync(join(tmpdir(), 'qa-dist-'));
  try {
    const b = spawnSync(PY, [join(ROOT, 'examples/build-chain/build.py'), '--out', join(out, '_dist')], { encoding: 'utf8' });
    assert.equal(b.status, 0, b.stdout + b.stderr);
    const j = await run('jscheck.mjs', [join(out, '_dist')]);
    assert.equal(j.status, 0, j.out);
    assert.match(j.stdout, /3 html files, 2 inline scripts and 0 event handlers checked, 0 failures/);
    const a = await run('audit.mjs', [join(out, '_dist')], { QA_WIDTHS: '1440x900,360x780' });
    assert.equal(a.status, 0, a.out);
    assert.match(a.stdout, /ok {3}index-de\.html @360/);
    assert.match(a.stdout, /3 pages x 2 widths, 0 with issues/);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('audit: horizontal overflow on a phone fails', opts, () => withDir('<p style="width:900px">too wide for a phone</p>', async dir => {
  const r = await run('audit.mjs', [dir], { QA_WIDTHS: '390x844' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.stdout, /FAIL page\.html @390 overflow=1/);
}));

test('audit: a carousel track clipped by overflow:hidden is not overflow', opts, () => withDir(`
<div style="overflow:hidden;width:100%"><div style="display:flex;width:300%">
<div style="flex:0 0 33.33%;height:60px">slide 1</div><div style="flex:0 0 33.33%;height:60px">slide 2</div><div style="flex:0 0 33.33%;height:60px">slide 3</div>
</div></div>`, async dir => {
  const r = await run('audit.mjs', [dir], { QA_WIDTHS: '390x844' });
  assert.equal(r.status, 0, r.out);
  assert.match(r.stdout, /ok {3}page\.html @390 \(2 clipped by an overflow container, not counted\)/);
}));

test('audit: a broken image and a JS exception fail', opts, () => withDir('<img src="missing.png" width="10" height="10" alt=""><script>undefinedFunction()</script>', async dir => {
  const r = await run('audit.mjs', [dir], { QA_WIDTHS: '1440x900' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.stdout, /img=1 errs=[1-9]/);
}));

test('audit: pages in subfolders are audited (folder mode recurses)', opts, () => withDir({ 'index.html': PAGE('home'), 'de/index.html': PAGE('<p style="width:900px">zu breit</p>'), '_drafts/x.html': PAGE('skip me') }, async dir => {
  const r = await run('audit.mjs', [dir], { QA_WIDTHS: '390x844' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.stdout, /FAIL de\/index\.html @390 overflow=1/);
  assert.match(r.stdout, /2 pages x 1 widths, 1 with issues/);
}));

test('audit over http: favicon 404 ignored, sitemap rebased, QA_IGNORE drops known noise', opts, () => serve({
  '/sitemap.xml': { type: 'application/xml', body: '<urlset><url><loc>https://www.example.com/a.html</loc></url></urlset>' },
  '/a.html': PAGE('<script>console.error("known vendor noise")</script>ok'),
}, async base => {
  const noisy = await run('audit.mjs', [base], { QA_WIDTHS: '1440x900' });
  assert.equal(noisy.status, 1, noisy.out);
  assert.match(noisy.stdout, /FAIL \/a\.html @1440 .*errs=1/);
  assert.match(noisy.stdout, /known vendor noise/);
  assert.doesNotMatch(noisy.stdout, /favicon/);
  const quiet = await run('audit.mjs', [base], { QA_WIDTHS: '1440x900', QA_IGNORE: 'known vendor' });
  assert.equal(quiet.status, 0, quiet.out);
  assert.match(quiet.stdout, /ok {3}\/a\.html @1440/);
}));

// ---- navigation failures ------------------------------------------------------------------------------
test('navigation: HTTP 404 for the page itself fails the page', opts, () => serve({
  '/sitemap.xml': { type: 'application/xml', body: '<urlset><url><loc>https://x.example/gone.html</loc></url><url><loc>https://x.example/ok.html</loc></url></urlset>' },
  '/ok.html': PAGE('fine'),
  '/gone.html': { status: 404, body: PAGE('<h1>Not found</h1>') },
}, async base => {
  const r = await run('audit.mjs', [base], { QA_WIDTHS: '1440x900' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.stdout, /FAIL \/gone\.html @1440 HTTP 404 for the page itself/);
  assert.match(r.stdout, /ok {3}\/ok\.html @1440/);
}));

test('navigation: a refused connection fails the page instead of auditing an error page', opts, async () => {
  const r = await run('audit.mjs', ['http://127.0.0.1:9'], { QA_WIDTHS: '1440x900' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.stdout, /FAIL \/ @1440 navigation failed: net::ERR_/);
});

test('navigation: a page whose load event never fires times out and fails', opts, () => serve({
  '/sitemap.xml': { type: 'application/xml', body: '<urlset><url><loc>https://x.example/slow.html</loc></url></urlset>' },
  '/slow.html': PAGE('<img src="/never.png" alt="">'),
  '/never.png': { hang: true },
}, async base => {
  const t0 = Date.now();
  const r = await run('content.mjs', [base, 'struct'], { QA_LOAD_TIMEOUT: '1500' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.stdout, /FAIL \/slow\.html load event did not fire within 1500 ms/);
  assert.ok(Date.now() - t0 < 30000, 'the timeout must cut the wait short');
}));

// ---- anchors -------------------------------------------------------------------------------------------
test('anchors: every same-page link on the sample site lands below the fixed nav', opts, async () => {
  const r = await run('anchors.mjs', [SAMPLE, '390']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.stdout, /ok {3}index\.html page #features -> top/);
  assert.match(r.stdout, /\n0 failing anchors/);
});

test('anchors: a target hidden under a fixed nav fails', opts, () => withDir(`<nav style="position:fixed;top:0;left:0;right:0;height:300px;background:#000"></nav>
<a href="#t" style="display:block;margin-top:320px">jump</a><div style="height:2000px"></div>
<h2 id="t">target</h2><div style="height:2000px"></div>`, async dir => {
  const r = await run('anchors.mjs', [dir, '1440'], { QA_ANCHOR_MAX: '200' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.stdout, /1 failing anchors/);
}));

test('anchors: a smooth scroll is waited for, not cut off by a fixed sleep', opts, () => withDir(`<style>html{scroll-behavior:smooth}</style>
<a href="#far" style="display:block">jump</a><div style="height:6000px"></div><h2 id="far">far away</h2><div style="height:2000px"></div>`, async dir => {
  const r = await run('anchors.mjs', [dir, '1440']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.stdout, /ok {3}page\.html page #far -> top 0/);
}));

// ---- content -------------------------------------------------------------------------------------------
test('content text: writes one visible-copy dump per page', opts, async () => {
  const out = mkdtempSync(join(tmpdir(), 'qa-text-'));
  try {
    const r = await run('content.mjs', [SAMPLE, 'text', out]);
    assert.equal(r.status, 0, r.out);
    const dump = readFileSync(join(out, 'index.html.txt'), 'utf8');
    assert.match(dump, /^H1 :: Notes that find you again\.$/m);
    assert.deepEqual(readdirSync(out).sort(), ['index.html.txt', 'privacy.html.txt']);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('content struct: the sample passes, a heading without body copy fails', opts, async () => {
  const ok = await run('content.mjs', [SAMPLE, 'struct']);
  assert.equal(ok.status, 0, ok.out);
  await withDir('<main><div class="card"><h3>Lonely title</h3><img alt="" width="10" height="10" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></div></main>', async dir => {
    const r = await run('content.mjs', [dir, 'struct']);
    assert.equal(r.status, 1, r.out);
    assert.match(r.stdout, /H3 "Lonely title" \| box=div\.card/);
  });
});

test('content heads: a heading forced onto more lines than it needs is reported', opts, () => withDir(
  '<div style="width:900px"><h2>Short<br>heading<br>broken</h2></div>', async dir => {
    const r = await run('content.mjs', [dir, 'heads', '-', '1440']);
    assert.equal(r.status, 1, r.out);
    assert.match(r.stdout, /3 lines \(fits 1\)/);
  }));

// ---- screenshots, modes, wheel -------------------------------------------------------------------------
const isPng = p => readFileSync(p).subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

test('shots: writes scroll-tiled PNGs per page and width', opts, async () => {
  const out = mkdtempSync(join(tmpdir(), 'qa-shots-'));
  try {
    const r = await run('shots.mjs', [SAMPLE, out, '2'], { QA_PAGES: 'index.html', QA_WIDTHS: '1440x900,390x844' });
    assert.equal(r.status, 0, r.out);
    const files = readdirSync(out).sort();
    assert.deepEqual(files, ['index.html.1440.00.png', 'index.html.1440.01.png', 'index.html.390.00.png', 'index.html.390.01.png']);
    for (const f of files) assert.ok(isPng(join(out, f)), f);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('modes reduced: smooth scroll is off and three PNGs are written', opts, async () => {
  const out = mkdtempSync(join(tmpdir(), 'qa-modes-'));
  try {
    const r = await run('modes.mjs', [SAMPLE, out, 'reduced', '390'], { QA_PAGES: 'index.html' });
    assert.equal(r.status, 0, r.out);
    assert.match(r.stdout, /index\.html reduced .*"scrollBehavior":"auto"/);
    assert.deepEqual(readdirSync(out).sort(), [0, 1, 2].map(k => `index.html.reduced.390.${k}.png`));
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('modes dark: the site keeps its declared light color scheme', opts, async () => {
  const out = mkdtempSync(join(tmpdir(), 'qa-modes-'));
  try {
    const r = await run('modes.mjs', [SAMPLE, out, 'dark', '390'], { QA_PAGES: 'index.html' });
    assert.equal(r.status, 0, r.out);
    // Chrome serialises `only light` as "light only"; the background must stay white under a dark preference
    assert.match(r.stdout, /"colorScheme":"(light only|only light)","bodyBg":"rgb\(255, 255, 255\)"/);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('wheel: real wheel input scrolls the sample page down and back to the top', opts, async () => {
  const r = await run('wheel.mjs', [SAMPLE, '1440'], { QA_PAGES: 'index.html', QA_WATCH: 'document.documentElement.lang' });
  assert.equal(r.status, 0, r.out);
  const y = label => +new RegExp(`${label}\\s+\\{"y":(\\d+)`).exec(r.stdout)[1];
  assert.ok(y('down x3') > 0, r.stdout);
  assert.ok(y('down x10 more') > y('down x3'), r.stdout);
  assert.equal(y('UP to top'), 0);
  assert.match(r.stdout, /"watch":"en"/);
});

// ---- console sweep ---------------------------------------------------------------------------------------
test('console-sweep: clean pages exit 0, a console error and a failed request exit 1 with a report', opts, () => serve({
  '/sitemap.xml': { type: 'application/xml', body: '<urlset><url><loc>https://x.example/clean.html</loc></url><url><loc>https://x.example/noisy.html</loc></url></urlset>' },
  '/clean.html': PAGE('<p>clean</p>'),
  '/noisy.html': PAGE('<script>console.error("boom from page")</script><script src="/missing.js"></script>'),
}, async base => {
  const out = join(mkdtempSync(join(tmpdir(), 'qa-sweep-')), 'sweep.json');
  try {
    const clean = await run('console-sweep.mjs', [base, out], { QA_PAGES: 'clean', QA_WIDTHS: '1440x900' });
    assert.equal(clean.status, 0, clean.out);
    const noisy = await run('console-sweep.mjs', [base, out], { QA_WIDTHS: '1440x900' });
    assert.equal(noisy.status, 1, noisy.out);
    const rep = JSON.parse(readFileSync(out, 'utf8'));
    const issues = rep.pre[`${base}/noisy.html @1440`].join('\n');
    assert.match(issues, /boom from page/);
    assert.match(issues, /\[http 404\] .*missing\.js/);
    assert.equal(rep.pre[`${base}/clean.html @1440`], undefined);
  } finally { rmSync(dirname(out), { recursive: true, force: true }); }
}));

// ---- axe ------------------------------------------------------------------------------------------------
const axeOpts = { ...opts, skip: opts.skip || (AXE ? false : 'axe-core not found (set AXE_PATH or npm i axe-core)') };
test('axe: an image without alt text is a violation; a clean page passes', axeOpts, () => withDir({
  'bad.html': PAGE('<main><h1>Title</h1><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="10" height="10"></main>'),
  'good.html': PAGE('<main><h1>Title</h1><p>Text with enough contrast.</p></main>'),
}, async dir => {
  const out = join(dir, 'axe.json');
  const r = await run('axe.mjs', [dir, out], { AXE_PATH: AXE, QA_WIDTHS: '1440x900' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.stdout, /bad\.html 1440 bar: .*image-alt/);
  assert.match(r.stdout, /good\.html 1440 bar: - \| after: -/);
  assert.ok(existsSync(out));
}));

// ---- process cleanup ----------------------------------------------------------------------------------------
test('SIGTERM stops the run with exit 143 and takes Chrome down with it', { ...opts, skip: opts.skip || (process.platform === 'win32' ? 'POSIX signals only' : false) }, () => serve({
  '/sitemap.xml': { type: 'application/xml', body: '<urlset><url><loc>https://x.example/slow.html</loc></url></urlset>' },
  '/slow.html': PAGE('<img src="/never.png" alt="">'),
  '/never.png': { hang: true },
}, async base => {
  const p = port;
  const pending = run('audit.mjs', [base], { QA_WIDTHS: '1440x900', QA_LOAD_TIMEOUT: '60000' });
  for (let i = 0; i < 100; i++) {   // wait until this run's Chrome answers on its port
    try { await (await fetch(`http://127.0.0.1:${p}/json/version`)).json(); break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  await new Promise(r => setTimeout(r, 500));
  pending.proc.kill('SIGTERM');
  const r = await pending;
  assert.equal(r.status, 143, r.out);
  await new Promise(r => setTimeout(r, 500));
  await assert.rejects(fetch(`http://127.0.0.1:${p}/json/version`), 'Chrome must be gone');
}));

// QA harness tests that need no browser: argument handling and the exit-code contract of every script,
// jscheck on good and broken fixtures, target listing (folders, sitemaps), the CDP session's timeouts and
// buffers, and inapp.mjs's pure checks.
//   node --test --test-concurrency=1 "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const QA = join(ROOT, '.claude/skills/website-build/scripts/qa');
const SAMPLE = join(ROOT, 'examples/sample-site');
const NO_CHROME = join(ROOT, 'no-such-chrome-binary');
const run = (script, args = [], env = {}) =>
  spawnSync(process.execPath, [join(QA, script), ...args], { encoding: 'utf8', env: { ...process.env, ...env }, cwd: ROOT, timeout: 60000 });
const runAsync = (script, args = [], env = {}) => new Promise(res => {
  const p = spawn(process.execPath, [join(QA, script), ...args], { cwd: ROOT, env: { ...process.env, ...env } });
  let stdout = '', stderr = '';
  p.stdout.on('data', d => { stdout += d; }); p.stderr.on('data', d => { stderr += d; });
  p.on('close', status => res({ status, stdout, stderr }));
});
const cdp = await import(pathToFileURL(join(QA, 'cdp.mjs')).href);
const checks = await import(pathToFileURL(join(QA, 'inapp-checks.mjs')).href);

function tmp(files) {
  const dir = mkdtempSync(join(tmpdir(), 'qa-cli-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}
async function serve(routes) {
  const srv = createServer((req, res) => {
    const r = routes[req.url.split('?')[0]];
    if (!r) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': r.type || 'text/html' }); res.end(r.body ?? r);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise(r => srv.close(r)) };
}

// ---- exit 2: bad usage, before any browser is launched -------------------------------------------
const BAD_USAGE = [
  ['audit.mjs', []], ['audit.mjs', [join(ROOT, 'no-such-folder')]], ['audit.mjs', ['x'], { QA_WIDTHS: 'wide' }],
  ['anchors.mjs', []], ['anchors.mjs', ['x', 'wide']],
  ['axe.mjs', []],
  ['console-sweep.mjs', []], ['console-sweep.mjs', [SAMPLE], { QA_IGNORE: '(' }],
  ['content.mjs', []], ['content.mjs', ['x', 'nonsense']], ['content.mjs', ['x', 'text', 'out', 'wide']],
  ['jscheck.mjs', []], ['jscheck.mjs', [join(ROOT, 'no-such-folder')]],
  ['modes.mjs', []], ['modes.mjs', ['x']], ['modes.mjs', ['x', 'out', 'sepia']],
  ['shots.mjs', []], ['shots.mjs', ['x']], ['shots.mjs', ['x', 'out', 'many']],
  ['wheel.mjs', []], ['wheel.mjs', ['x', 'wide']],
  ['inapp.mjs', []], ['inapp.mjs', ['not-a-url']], ['inapp.mjs', ['https://example.com'], { CTX: 'ios-bogus' }],
  ['inapp.mjs', ['https://example.com'], { PAGES: 'no-slash' }],
];
for (const [script, args, env] of BAD_USAGE) {
  test(`exit 2: ${script} ${args.join(' ') || '(no args)'}${env ? ' ' + JSON.stringify(env) : ''}`, () => {
    const r = run(script, args, { CHROME_PATH: NO_CHROME, ...env });
    assert.equal(r.status, 2, r.stderr + r.stdout);
    assert.match(r.stderr, /usage/);
  });
}

// ---- exit 3: could not run --------------------------------------------------------------------------
const CANNOT_RUN = [
  ['audit.mjs', [SAMPLE]], ['anchors.mjs', [SAMPLE]], ['content.mjs', [SAMPLE, 'struct']],
  ['modes.mjs', [SAMPLE, 'out', 'dark']], ['shots.mjs', [SAMPLE, 'out']], ['wheel.mjs', [SAMPLE]],
  ['console-sweep.mjs', [SAMPLE, join(tmpdir(), 'qa-cli-sweep.json')]],
  ['axe.mjs', [SAMPLE], { AXE_PATH: join(QA, 'cdp.mjs') }],
];
for (const [script, args, env] of CANNOT_RUN) {
  test(`exit 3 when Chrome is missing: ${script}`, () => {
    const r = run(script, args, { CHROME_PATH: NO_CHROME, ...env });
    assert.equal(r.status, 3, r.stderr + r.stdout);
    assert.match(r.stderr, /could not run: chrome did not start/);
  });
}
test('exit 3: axe.mjs without axe-core', () => {
  const r = run('axe.mjs', [SAMPLE], { AXE_PATH: join(ROOT, 'does-not-exist.js'), CHROME_PATH: NO_CHROME });
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /axe-core not found/);
});
test('exit 3: inapp.mjs when Playwright cannot be loaded', () => {
  const r = run('inapp.mjs', ['https://example.com'], { PW: join(ROOT, 'no-such-playwright.mjs'), CTX: 'ios-safari' });
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /could not run: playwright not found/);
});

// ---- jscheck --------------------------------------------------------------------------------------
test('jscheck passes the sample site', () => {
  const r = run('jscheck.mjs', [SAMPLE]);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /0 failures/);
});

test('jscheck catches a syntax error, a control byte and nested pages, and skips data scripts', () => {
  const dir = tmp({
    'ok.html': `<!doctype html><script type="application/ld+json">{"a":1}</script>
<script type="text/x-template"><div>{{ not js }}</div></script><script type="module">import x from './x.js'; export {x};</script>
<script>const ok = 1;</script>`,
    'de/broken.html': '<!doctype html><script>function () {</script>',
    'ctrl.html': '<!doctype html><script>const s = "a\x01b";</script>',
  });
  try {
    const r = run('jscheck.mjs', [dir]);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /FAIL de\/broken\.html script #0 \(classic/);
    assert.match(r.stdout, /FAIL ctrl\.html: control character 0x01/);
    assert.doesNotMatch(r.stdout, /FAIL ok\.html/);
    assert.match(r.stdout, /3 html files, 4 inline scripts and 0 event handlers checked, 2 failures/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('jscheck reads attributes by name: data-src and data-type do not hide a broken script', () => {
  const dir = tmp({
    'a.html': '<script data-src="x.js">let = ;</script>',
    'b.html': '<script data-type="text/plain">let = ;</script>',
    'c.html': '<script src="real.js">let = ;</script><script type="text/plain">let = ;</script>',
  });
  try {
    const r = run('jscheck.mjs', [dir]);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /FAIL a\.html script #0/);
    assert.match(r.stdout, /FAIL b\.html script #0/);
    assert.doesNotMatch(r.stdout, /FAIL c\.html/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('jscheck checks classic scripts as browser scripts and modules as modules', () => {
  const dir = tmp({
    'ret.html': '<script>if (location.hash) {}\nreturn;</script>',
    'imp.html': '<script>import x from "./x.js";</script>',
    'await.html': '<script>await fetch("/");</script>',
    'mod.html': '<script type="module">const r = await fetch("/"); export default r;</script>',
    'modbad.html': '<script type="module">export default {;</script>',
  });
  try {
    const r = run('jscheck.mjs', [dir]);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /FAIL ret\.html script #0 \(classic, line 1\): .*return/i);
    assert.match(r.stdout, /FAIL imp\.html script #0 \(classic/);
    assert.match(r.stdout, /FAIL await\.html script #0 \(classic/);
    assert.match(r.stdout, /FAIL modbad\.html script #0 \(module/);
    assert.doesNotMatch(r.stdout, /FAIL mod\.html/);
    assert.match(r.stdout, /4 failures/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('jscheck checks on* handlers as function bodies, decodes entities, ignores comments and data-on*', () => {
  const dir = tmp({
    'h.html': `<button onclick="if (x) {">bad</button>
<a href="#" onclick="return false">ok</a>
<form onsubmit='event.preventDefault(); send(&quot;a&quot;)'></form>
<div data-onclick="this is not code"></div>
<!-- <button onclick="also not checked ("></button> <script>let = ;</script> -->
<textarea><script>let = ;</script></textarea>`,
  });
  try {
    const r = run('jscheck.mjs', [dir]);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /FAIL h\.html:1 <button onclick>/);
    assert.match(r.stdout, /0 inline scripts and 3 event handlers checked, 1 failures/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- targets ---------------------------------------------------------------------------------------
test('listPages recurses into folders, skipping _*, dot folders, node_modules and backups', async () => {
  const dir = tmp({
    'index.html': '', 'de/index.html': '', 'de/deep/a.html': '', '_drafts/x.html': '', '.git/y.html': '',
    'node_modules/z/z.html': '', '_partial.html': '', 'old.bak.html': '', 'assets/a.css': '',
  });
  try {
    const urls = await cdp.listPages(dir);
    assert.deepEqual(urls.map(cdp.short), ['de/deep/a.html', 'de/index.html', 'index.html']);
    assert.equal(cdp.slug(urls[0]), 'de_deep_a.html');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('listPages resolves a relative folder and rejects a missing one as usage', async () => {
  const cwd = process.cwd();
  process.chdir(ROOT);
  try {
    const urls = await cdp.listPages('examples/sample-site');
    assert.deepEqual(urls, ['index.html', 'privacy.html'].map(f => pathToFileURL(join(SAMPLE, f)).href));
    await assert.rejects(cdp.listPages('examples/no-such-folder'), e => e instanceof cdp.UsageError);
  } finally { process.chdir(cwd); }
});

test('sitemap URLs are rebased onto the given base, sitemap indexes are followed, opt-out keeps them', async () => {
  const srv = await serve({
    '/sitemap.xml': { type: 'application/xml', body: `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sitemap><loc>https://www.example.com/sitemap-pages.xml</loc></sitemap><sitemap><loc>https://www.example.com/sitemap-de.xml</loc></sitemap></sitemapindex>` },
    '/sitemap-pages.xml': { type: 'application/xml', body: '<urlset><url><loc>https://www.example.com/</loc></url><url><loc> https://www.example.com/a?x=1&amp;y=2 </loc></url></urlset>' },
    '/sitemap-de.xml': { type: 'application/xml', body: '<urlset><url><loc>https://www.example.com/de</loc></url><url><loc>https://www.example.com/</loc></url></urlset>' },
  });
  try {
    assert.deepEqual(await cdp.listPages(srv.base), [srv.base + '/', srv.base + '/a?x=1&y=2', srv.base + '/de']);
    assert.equal(cdp.short(srv.base + '/de'), '/de');
  } finally { await srv.close(); }
  const plain = await serve({ '/sitemap.xml': { type: 'application/xml', body: '<urlset><url><loc>https://www.example.com/a</loc></url></urlset>' } });
  const prev = process.env.QA_SITEMAP_ABSOLUTE;
  try {
    process.env.QA_SITEMAP_ABSOLUTE = '1';
    assert.deepEqual(await cdp.listPages(plain.base), ['https://www.example.com/a']);
  } finally {
    if (prev === undefined) delete process.env.QA_SITEMAP_ABSOLUTE; else process.env.QA_SITEMAP_ABSOLUTE = prev;
    await plain.close();
  }
});

test('a base URL without a sitemap is audited as just the base; rebase keeps a path prefix', async () => {
  const srv = await serve({});
  try { assert.deepEqual(await cdp.listPages(srv.base + '/'), [srv.base + '/']); } finally { await srv.close(); }
  assert.equal(cdp.rebase('https://www.example.com/de/x?y=1', 'http://127.0.0.1:8080/preview'), 'http://127.0.0.1:8080/preview/de/x?y=1');
});

test('widths() parses WxH, fills a default height and rejects garbage as usage', () => {
  const prev = process.env.QA_WIDTHS;
  try {
    process.env.QA_WIDTHS = '1440x900, 390x844,360';
    assert.deepEqual(cdp.widths(), [[1440, 900, false], [390, 844, true], [360, 844, true]]);
    process.env.QA_WIDTHS = '1440x900,abc';
    assert.throws(() => cdp.widths(), e => e instanceof cdp.UsageError && /"abc" is not WxH/.test(e.message));
  } finally { if (prev === undefined) delete process.env.QA_WIDTHS; else process.env.QA_WIDTHS = prev; }
});

test('ignoreFilter drops /favicon.ico always and QA_IGNORE matches; a bad regex is a usage error', () => {
  const prev = process.env.QA_IGNORE;
  try {
    delete process.env.QA_IGNORE;
    assert.deepEqual(cdp.ignoreFilter()(['[log] Failed to load resource: 404 http://x/favicon.ico', '[exc] boom']), ['[exc] boom']);
    process.env.QA_IGNORE = 'boom';
    assert.deepEqual(cdp.ignoreFilter()(['[exc] boom', '[exc] other']), ['[exc] other']);
    process.env.QA_IGNORE = '(';
    assert.throws(() => cdp.ignoreFilter(), e => e instanceof cdp.UsageError);
  } finally { if (prev === undefined) delete process.env.QA_IGNORE; else process.env.QA_IGNORE = prev; }
});

// ---- CDP session robustness (fake socket, no browser) ------------------------------------------------
class FakeWS extends EventTarget {
  constructor() { super(); this.sent = []; }
  send(m) { this.sent.push(JSON.parse(m)); }
  emit(obj) { this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(obj) })); }
  close() { this.dispatchEvent(new Event('close')); }
}

test('Session: a command without a reply times out, a reply resolves it', async () => {
  const ws = new FakeWS(); const s = new cdp.Session(ws, { timeout: 50 });
  await assert.rejects(s.send('Page.navigate', { url: 'x' }), /timed out after 50 ms/);
  const p = s.send('Runtime.evaluate');
  ws.emit({ id: ws.sent.at(-1).id, result: { ok: 1 } });
  assert.deepEqual(await p, { ok: 1 });
  assert.equal(s.pending.size, 0);
});

test('Session: a closed socket rejects pending and later commands as could-not-run', async () => {
  const ws = new FakeWS(); const s = new cdp.Session(ws, { timeout: 5000 });
  const p = s.send('Page.navigate');
  const w = s.waitEvent(e => e.method === 'Page.loadEventFired', 5000);
  ws.close();
  await assert.rejects(p, e => e instanceof cdp.CouldNotRun && /socket closed/.test(e.message));
  await assert.rejects(w, /socket closed/);
  await assert.rejects(s.send('Page.enable'), /socket closed/);
});

test('Session: keeps only the events the checks read, trimmed, in a capped buffer', () => {
  const ws = new FakeWS(); const s = new cdp.Session(ws);
  ws.emit({ method: 'Network.dataReceived', params: { requestId: '1', dataLength: 10 } });
  ws.emit({ method: 'Network.requestWillBeSent', params: { requestId: '1', type: 'Image', request: { url: 'http://x/a.png', headers: { a: 'b'.repeat(1000) } } } });
  assert.equal(s.events.length, 1);
  assert.deepEqual(s.events[0].params, { requestId: '1', type: 'Image', request: { url: 'http://x/a.png' } });
  assert.equal(s.inflight.size, 1);
  ws.emit({ method: 'Network.loadingFinished', params: { requestId: '1' } });
  assert.equal(s.inflight.size, 0);
  for (let i = 0; i < cdp.MAX_EVENTS + 25; i++) ws.emit({ method: 'Runtime.consoleAPICalled', params: { type: 'log', args: [{ value: i }] } });
  assert.equal(s.events.length, cdp.MAX_EVENTS);
  assert.equal(s.dropped, 26);
  assert.match(cdp.consoleErrors(s).at(-1), /26 events dropped/);
});

// ---- inapp.mjs pure checks -----------------------------------------------------------------------------
test('inapp contexts come from the dated data file, with UA placeholders expanded', () => {
  const all = checks.contexts();
  assert.ok(all.length >= 10);
  for (const c of all) if (c.ua) assert.doesNotMatch(c.ua, /\{\w+\}/, c.id);
  assert.match(all.find(c => c.id === 'ios-instagram').ua, /^Mozilla\/5\.0 \(iPhone; .* Instagram /);
  assert.deepEqual(checks.contexts(undefined, ['android-tiktok']).map(c => c.id), ['android-tiktok']);
  assert.throws(() => checks.contexts(undefined, ['nope']), /unknown CTX id/);
  assert.equal(checks.ageDays({ updated: '2026-01-01' }, new Date('2026-01-31')), 30);
  assert.ok(Number.isNaN(checks.ageDays({})));
});

test('inapp parseArgs validates the URL and PAGES, and fills selector defaults', () => {
  assert.ok(checks.parseArgs([]).error);
  assert.ok(checks.parseArgs(['ftp://x']).error);
  assert.match(checks.parseArgs(['https://x.test'], { PAGES: '/,de' }).error, /must start with/);
  const o = checks.parseArgs(['https://x.test/', 'shots'], { PAGES: '/, /de', CTX: 'ios-safari', QA_COOKIE_BAR: '#cc' });
  assert.equal(o.base, 'https://x.test'); assert.equal(o.out, 'shots');
  assert.deepEqual(o.pages, ['/', '/de']); assert.deepEqual(o.only, ['ios-safari']);
  assert.equal(o.sel.accept, '#cc button');
});

test('inapp findings(): clean row passes, every failure kind is reported', () => {
  assert.deepEqual(checks.findings({ status: 200, W: 390, sw: 390, over: [], brokenImg: [], errs: [], cons: [], bad: [], menu: 'open:844/844', ccClick: 'ok' }), []);
  const f = checks.findings({ status: 404, W: 390, sw: 509, over: ['p:509'], brokenImg: ['a.png'], errs: ['x'], cons: ['y'], bad: ['500 http://x/api'], menu: 'NOT-OPEN', ccClick: 'STILL-VISIBLE', fatal: 'Timeout' });
  for (const k of ['fatal', 'HTTP 404', 'overflow', 'wider than viewport', 'broken images', 'JS errors', 'console errors', 'HTTP >= 400', 'menu', 'cookie bar'])
    assert.ok(f.some(x => x.includes(k)), k);
});

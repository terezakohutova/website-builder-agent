// Minimal Chrome DevTools Protocol client over Node's global WebSocket (Node >= 22).
// Distilled from a production website QA harness.
// Why raw CDP: in the real build the browser extension and the Playwright MCP both failed to connect, and a
// CDP client needs nothing but a WebSocket. No npm install required.
//
// Exit-code contract shared by every QA script (see README.md):
//   0 clean, 1 findings, 2 bad usage, 3 could not run (Chrome missing, socket closed, internal error).
//
// Env:
//   CHROME_PATH      Chrome/Chromium binary (default: the usual Windows / macOS / Linux locations)
//   CHROME_ARGS      extra Chrome flags, space-separated (e.g. "--no-sandbox" on some Linux CI runners)
//   QA_LOAD_TIMEOUT  ms to wait for the load event before the page fails (default 30000)
//   QA_IDLE_CAP      ms to wait for network idle after load (default 3000; idle = no request for 500 ms)
//   QA_CMD_TIMEOUT   ms before a single CDP command fails (default 30000)
//   QA_PORT          pin the DevTools port (default: a free port Chrome picks; the browser is always verified)
//   QA_MOBILE_MAX    widths up to this many px get mobile + touch emulation (default 820)
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
];
export const CHROME = process.env.CHROME_PATH || CANDIDATES.find(p => existsSync(p)) || 'chrome';
export const wait = ms => new Promise(r => setTimeout(r, ms));
const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(+v) ? +v : d);

export class UsageError extends Error {}
export class CouldNotRun extends Error {}

// ---- process lifecycle ---------------------------------------------------------------------
// Every launched browser is killed and its profile removed on exit, on an uncaught error and on
// Ctrl+C / SIGTERM (an orphaned headless Chrome keeps the port busy for the next run).
const browsers = new Set();
function cleanup() {
  for (const b of browsers) {
    try { b.proc.kill(); } catch {}
    try { rmSync(b.prof, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  }
  browsers.clear();
}
let hooked = false;
function hookSignals() {
  if (hooked) return; hooked = true;
  process.on('exit', cleanup);
  for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.on(sig, () => { cleanup(); process.exit(code); });
}

// main(fn): runs a script body and turns the result into the exit-code contract.
// fn returns the number of findings (or a boolean); UsageError -> 2, anything thrown -> 3.
export function main(fn) {
  hookSignals();
  Promise.resolve().then(fn).then(found => {
    cleanup(); process.exit(found ? 1 : 0);
  }, e => {
    cleanup();
    if (e instanceof UsageError) { console.error('usage: ' + e.message); process.exit(2); }
    console.error('could not run: ' + (e && e.message || e)); process.exit(3);
  });
}

// launch(port, { args }) - headless Chrome with a throwaway profile.
// port 0 (the default, unless QA_PORT is set): Chrome picks a free port itself, so parallel runs never
// collide and a stray browser on a fixed port is never reached. Chrome then writes
// <profile>/DevToolsActivePort (port + browser socket path) into the profile THIS run created, and the
// /json/version answer on that port must name the same socket.
// An explicit QA_PORT: Chrome writes no DevToolsActivePort for a fixed port, so the port is checked BEFORE
// launch instead: if anything already listens on it, the run stops (exit 3) rather than attach to it.
export async function launch(port = qaPort(), { args = [], gpu = false } = {}) {
  hookSignals();
  if (port && !(await portFree(port)))
    throw new CouldNotRun(`port ${port} is already in use (a stray browser?), and whatever listens there is not the Chrome this run launched; unset QA_PORT or pick a free port`);
  const prof = mkdtempSync(join(tmpdir(), 'webqa-'));
  const extra = (process.env.CHROME_ARGS || '').split(/\s+/).filter(Boolean);
  const p = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`,
    '--no-first-run', '--no-default-browser-check', ...(gpu ? [] : ['--disable-gpu']),
    '--allow-file-access-from-files', '--hide-scrollbars',
    '--force-device-scale-factor=1', ...extra, ...args, 'about:blank'
  ], { stdio: 'ignore' });
  const b = { proc: p, prof }; browsers.add(b);
  let spawnError = null, exited = false;
  p.on('error', e => { spawnError = e; });
  p.on('exit', () => { exited = true; });
  const fail = msg => { cleanup(); return new CouldNotRun(msg); };
  let info = null, stranger = null;
  for (let i = 0; i < 80 && !spawnError && !exited; i++) {
    if (port) {
      // the port was free before launch, so what answers on it now is the browser this run started
      try { info = { ...(await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()), port }; break; }
      catch { /* not listening yet */ }
    } else {
      const own = readActivePort(prof);
      if (own) {
        try {
          const v = await (await fetch(`http://127.0.0.1:${own.port}/json/version`)).json();
          if (new URL(v.webSocketDebuggerUrl).pathname === own.path) { info = { ...v, port: own.port }; break; }
          stranger = `port ${own.port} answered with ${v.Browser || 'something'}`;
        } catch { /* not listening yet */ }
      }
    }
    await wait(250);
  }
  if (!info && stranger)
    throw fail(`${stranger}, which is not the Chrome this run launched (a stray browser?); unset QA_PORT or pick a free port`);
  if (!info) throw fail(`chrome did not start on port ${port || 'auto'} (CHROME_PATH=${CHROME}${spawnError ? ', ' + spawnError.message : ''})`);
  return { proc: p, port: info.port, wsUrl: info.webSocketDebuggerUrl };
}

// QA_PORT pins the DevTools port (e.g. to watch a run from outside); default 0 = a free port picked by Chrome.
function qaPort() {
  const v = process.env.QA_PORT;
  if (v === undefined || v === '') return 0;
  if (!/^\d{1,5}$/.test(v) || +v > 65535) throw new UsageError(`QA_PORT: "${v}" is not a port number`);
  return +v;
}

// true when nothing listens on 127.0.0.1:port (we can bind it ourselves for a moment)
function portFree(port) {
  return new Promise(res => {
    const srv = createServer();
    srv.once('error', () => res(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => res(true)));
  });
}

function readActivePort(prof) {
  try {
    const [port, path] = readFileSync(join(prof, 'DevToolsActivePort'), 'utf8').split(/\r?\n/);
    return /^\d+$/.test(port) && path ? { port: +port, path } : null;
  } catch { return null; }
}

// ---- session ---------------------------------------------------------------------------------
// Only the events the checks read are kept, trimmed to the fields they use, in a capped buffer.
const KEEP = new Set(['Page.loadEventFired', 'Runtime.exceptionThrown', 'Runtime.consoleAPICalled', 'Log.entryAdded',
  'Network.requestWillBeSent', 'Network.responseReceived', 'Network.loadingFailed']);
export const MAX_EVENTS = 5000;
function trim(m) {
  const p = m.params || {};
  if (m.method === 'Network.requestWillBeSent') return { method: m.method, params: { requestId: p.requestId, type: p.type, request: { url: p.request?.url } } };
  if (m.method === 'Network.responseReceived') return { method: m.method, params: { requestId: p.requestId, type: p.type, loaderId: p.loaderId, frameId: p.frameId, response: { url: p.response?.url, status: p.response?.status } } };
  if (m.method === 'Runtime.consoleAPICalled') return { method: m.method, params: { type: p.type, args: (p.args || []).slice(0, 8).map(a => ({ value: a.value, description: a.description })) } };
  return { method: m.method, params: p };
}

export class Session {
  constructor(ws, { timeout = num(process.env.QA_CMD_TIMEOUT, 30000) } = {}) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; this.dropped = 0;
    this.sessionId = null; this.timeout = timeout; this.closed = false; this.inflight = new Set();
    this.lastNet = Date.now(); this.waiters = new Set();
    ws.addEventListener('message', (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.id && this.pending.has(m.id)) {
        const { res, rej, t } = this.pending.get(m.id); this.pending.delete(m.id); clearTimeout(t);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
        return;
      }
      if (!m.method) return;
      this.track(m);
      if (KEEP.has(m.method)) {
        const ev = trim(m);
        this.events.push(ev);
        if (this.events.length > MAX_EVENTS) { this.events.shift(); this.dropped++; }
        for (const w of this.waiters) if (w.test(ev)) { this.waiters.delete(w); w.done(ev); }
      }
    });
    const onClose = () => {
      if (this.closed) return; this.closed = true;
      for (const { rej, t } of this.pending.values()) { clearTimeout(t); rej(new CouldNotRun('CDP socket closed (did Chrome crash or run out of memory?)')); }
      this.pending.clear();
      for (const w of this.waiters) w.fail(new CouldNotRun('CDP socket closed'));
      this.waiters.clear();
    };
    ws.addEventListener('close', onClose); ws.addEventListener('error', onClose);
  }
  // network-idle bookkeeping (requests of the current page)
  track(m) {
    const p = m.params || {};
    if (m.method === 'Network.requestWillBeSent') { this.inflight.add(p.requestId); this.lastNet = Date.now(); }
    else if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') { this.inflight.delete(p.requestId); this.lastNet = Date.now(); }
  }
  send(method, params = {}, sessionId = this.sessionId) {
    if (this.closed) return Promise.reject(new CouldNotRun('CDP socket closed'));
    const id = ++this.id;
    const msg = { id, method, params }; if (sessionId) msg.sessionId = sessionId;
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.pending.delete(id); rej(new Error(`CDP ${method} timed out after ${this.timeout} ms`)); }, this.timeout);
      this.pending.set(id, { res, rej, t });
      this.ws.send(JSON.stringify(msg));
    });
  }
  // resolves with the first kept event matching test (already buffered or future), or null after ms
  waitEvent(test, ms) {
    const hit = this.events.find(test);
    if (hit) return Promise.resolve(hit);
    return new Promise((res, rej) => {
      const w = { test, done: e => { clearTimeout(t); res(e); }, fail: e => { clearTimeout(t); rej(e); } };
      const t = setTimeout(() => { this.waiters.delete(w); res(null); }, ms);
      this.waiters.add(w);
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', () => j(new CouldNotRun('cannot open CDP socket ' + wsUrl))); });
  const s = new Session(ws);
  const { targetId } = await s.send('Target.createTarget', { url: 'about:blank' }, null);
  const { sessionId } = await s.send('Target.attachToTarget', { targetId, flatten: true }, null);
  s.sessionId = sessionId;
  await s.send('Page.enable'); await s.send('Runtime.enable'); await s.send('Log.enable');
  await s.send('Network.enable');
  return s;
}

// launch + connect in one call (the common case). Port: QA_PORT, else a free one (see launch).
export async function open(opts) {
  const b = await launch(qaPort(), opts);
  return { ...b, s: await connect(b.wsUrl) };
}

// Waits until no request has been in flight for `quiet` ms, at most `cap` ms. Returns true when idle.
export async function networkIdle(s, { quiet = 500, cap = num(process.env.QA_IDLE_CAP, 3000) } = {}) {
  const end = Date.now() + cap;
  while (Date.now() < end) {
    if (s.inflight.size === 0 && Date.now() - s.lastNet >= quiet) return true;
    await wait(50);
  }
  return false;
}

// Polls scrollY until it stops changing (3 equal reads 80 ms apart), at most `cap` ms. Returns the final y.
export async function scrollSettle(s, { cap = 4000 } = {}) {
  const end = Date.now() + cap; let last = null, same = 0, y = 0;
  while (Date.now() < end) {
    y = await ev(s, 'Math.round(scrollY)');
    same = y === last ? same + 1 : 0; last = y;
    if (same >= 2) break;
    await wait(80);
  }
  return y;
}

// Two animation frames: lets layout, IntersectionObserver callbacks and reveal classes run.
export const frames = s => ev(s, 'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(1))))');

export class NavigationError extends Error {}

// goto: sets the viewport, clears the event buffer, navigates and waits for the load event, fonts and network
// idle (capped). Throws NavigationError when navigation fails (DNS, refused, file missing), when the main
// document answers HTTP >= 400, or when the load event does not fire within QA_LOAD_TIMEOUT.
// mobile:true also turns on touch emulation; pass ua to override the user agent. Returns { status }.
export async function goto(s, url, { width = 1440, height = 900, mobile = false, dsf = 1, ua = null, idle = undefined } = {}) {
  await s.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dsf, mobile });
  await s.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 }).catch(() => {});
  if (ua) await s.send('Network.setUserAgentOverride', { userAgent: ua });
  s.events.length = 0; s.dropped = 0; s.inflight.clear();
  const nav = await s.send('Page.navigate', { url });
  if (nav.errorText) throw new NavigationError(`navigation failed: ${nav.errorText}`);
  const loadTimeout = num(process.env.QA_LOAD_TIMEOUT, 30000);
  const loaded = await s.waitEvent(e => e.method === 'Page.loadEventFired', loadTimeout);
  const doc = s.events.find(e => e.method === 'Network.responseReceived' && e.params.type === 'Document' &&
    (!nav.loaderId || e.params.loaderId === nav.loaderId));
  const status = doc ? doc.params.response.status : null;
  if (status >= 400) throw new NavigationError(`HTTP ${status} for the page itself`);
  if (!loaded) throw new NavigationError(`load event did not fire within ${loadTimeout} ms`);
  await ev(s, 'document.fonts ? document.fonts.ready.then(()=>1) : 1').catch(() => {});
  await networkIdle(s, idle === undefined ? {} : { cap: idle });
  await frames(s).catch(() => {});
  return { status };
}

// goto that reports a failed page instead of throwing: { ok: true, status } or { ok: false, error }.
// Anything that is not a NavigationError (socket closed, command timeout) still throws -> exit 3.
export async function visit(s, url, opts) {
  try { return { ok: true, ...(await goto(s, url, opts)) }; }
  catch (e) { if (e instanceof NavigationError) return { ok: false, error: e.message }; throw e; }
}

export async function ev(s, expr) {
  const r = await s.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
// ev + JSON round trip, for objects/arrays
export const J = async (s, expr) => JSON.parse(await ev(s, `JSON.stringify(${expr})`));

export async function shot(s, path, { fullPage = false, clip = null } = {}) {
  const params = { format: 'png' };
  if (clip) params.clip = { ...clip, scale: 1 };
  else if (fullPage) params.captureBeyondViewport = true;
  const { data } = await s.send('Page.captureScreenshot', params);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(data, 'base64'));
  return path;
}

// Scroll that works through smooth-scroll libraries: Lenis (window.__lenis or window.lenis) swallows
// window.scrollTo, so jump it with immediate:true when present, then also set the native position.
// behavior:'instant' matters: with `html{scroll-behavior:smooth}` a plain scrollTo animates, and the next
// probe (or anchor click) runs while the page is still moving.
export async function scrollToY(s, y) {
  return ev(s, `(()=>{const L=window.__lenis||window.lenis;try{L&&L.scrollTo&&L.scrollTo(${y},{immediate:true,force:true})}catch(e){};window.scrollTo({top:${y},left:0,behavior:'instant'});return Math.round(scrollY)})()`);
}

// scrollToY, then wait for the position to settle, for lazy content requested by the scroll, and two frames.
export async function scrollAndSettle(s, y, { idle = 1500 } = {}) {
  await scrollToY(s, y);
  const at = await scrollSettle(s);
  await networkIdle(s, { quiet: 200, cap: idle });
  await frames(s).catch(() => {});
  return at;
}

// Real wheel input (goes through Lenis momentum exactly like a user's mouse); waits until scrolling stops.
export async function wheel(s, { x = 700, y = 450, dy = 200, times = 1, gap = 40 } = {}) {
  for (let i = 0; i < times; i++) {
    await s.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy, pointerType: 'mouse' });
    if (gap) await wait(gap);
  }
  return scrollSettle(s);
}

// Real mouse click at viewport coordinates (synthetic el.click() skips hit-testing and overlays).
export async function clickAt(s, x, y, n = 1) {
  for (let i = 1; i <= n; i++) {
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: i });
    await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: i });
  }
}

export async function key(s, keyName, code = keyName, vk = 0) {
  await s.send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: vk });
  await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: vk });
}

// Media emulation: dark scheme, reduced motion, print...
export async function emulateMedia(s, features = [], media = '') {
  return s.send('Emulation.setEmulatedMedia', { media, features });
}

// Requests nobody needs to hear about: the browser's own /favicon.ico probe (a site without one is not broken).
export const BUILTIN_IGNORE = /\/favicon\.ico(\?|\s|$)/;
// QA_IGNORE=<regex> drops matching findings (e.g. "Duplicate Pixel|hotjar"). Throws on an invalid regex.
export function ignoreFilter() {
  let user = null;
  if (process.env.QA_IGNORE) {
    try { user = new RegExp(process.env.QA_IGNORE); } catch (e) { throw new UsageError(`QA_IGNORE is not a valid regex: ${e.message}`); }
  }
  return list => list.filter(x => !BUILTIN_IGNORE.test(x) && !(user && user.test(x)));
}

// JS exceptions + console.error + Log errors since the last goto.
export function consoleErrors(s) {
  const out = [];
  for (const e of s.events) {
    if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
      out.push(`[log] ${e.params.entry.text} ${e.params.entry.url || ''}`);
    if (e.method === 'Runtime.exceptionThrown')
      out.push(`[exc] ${e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text}`);
    if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
      out.push(`[con] ${e.params.args.map(a => a.value ?? a.description).join(' ')}`);
  }
  if (s.dropped) out.push(`[harness] ${s.dropped} events dropped (more than ${MAX_EVENTS}); findings may be incomplete`);
  return out;
}

// Broader sweep: also warnings (CSP report-only shows up here), failed requests, HTTP >= 400.
export function collectIssues(s, { warnings = true } = {}) {
  const out = []; const reqs = new Map();
  for (const e of s.events) {
    const p = e.params;
    if (e.method === 'Network.requestWillBeSent') reqs.set(p.requestId, p.request.url);
    if (e.method === 'Runtime.exceptionThrown') out.push('[exc] ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text).slice(0, 200));
    if (e.method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'assert' || (warnings && p.type === 'warning')))
      out.push(`[console.${p.type}] ` + p.args.map(a => a.value ?? a.description).join(' ').slice(0, 200));
    if (e.method === 'Log.entryAdded' && (p.entry.level === 'error' || (warnings && p.entry.level === 'warning')))
      out.push(`[log.${p.entry.level}/${p.entry.source}] ` + p.entry.text.slice(0, 200) + ' ' + (p.entry.url || '').slice(0, 120));
    if (e.method === 'Network.loadingFailed' && !p.canceled && p.blockedReason !== 'inspector')
      out.push(`[netfail] ${p.errorText} ${p.blockedReason || ''} ${(reqs.get(p.requestId) || '').slice(0, 140)}`);
    if (e.method === 'Network.responseReceived' && p.response.status >= 400)
      out.push(`[http ${p.response.status}] ${p.response.url.slice(0, 140)}`);
  }
  if (s.dropped) out.push(`[harness] ${s.dropped} events dropped (more than ${MAX_EVENTS}); findings may be incomplete`);
  return [...new Set(out)];
}

// ---- targets -------------------------------------------------------------------------------
// target = a local folder (pages = every *.html below it, recursively, loaded as file://) or a base URL
// (pages = <loc> in /sitemap.xml, following sitemap index files, or just the base if there is none).
// QA_PAGES=a,b keeps only URLs containing a or b.
//
// Sitemap URLs are rebased onto the base you passed: a sitemap that lists https://www.example.com/de
// is audited as http://127.0.0.1:8080/de when you pass http://127.0.0.1:8080 (a preview or local server
// carries the production sitemap). QA_SITEMAP_ABSOLUTE=1 keeps the URLs exactly as written.
const SKIP_DIR = name => name.startsWith('_') || name.startsWith('.') || name === 'node_modules';
let rootPrefix = null;   // for short(): the folder or base URL the pages were listed from

function* htmlBelow(dir, rel = '') {
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) { if (!SKIP_DIR(e.name)) yield* htmlBelow(dir, r); }
    else if (e.name.endsWith('.html') && !e.name.startsWith('_') && !/\.bak/.test(e.name)) yield r;
  }
}

export function rebase(loc, base) {
  const u = new URL(loc, base + '/');
  const b = new URL(base + '/');
  return b.origin + b.pathname.replace(/\/$/, '') + u.pathname + u.search;
}

export async function sitemapUrls(base, { absolute = !!process.env.QA_SITEMAP_ABSOLUTE, maxFiles = 50 } = {}) {
  const seen = new Set(), out = [];
  const queue = [base + '/sitemap.xml'];
  while (queue.length && seen.size < maxFiles) {
    const sm = queue.shift();
    if (seen.has(sm)) continue; seen.add(sm);
    let t = '';
    try { const r = await fetch(sm); t = r.ok ? await r.text() : ''; } catch { t = ''; }
    const locs = [...t.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map(m => m[1].replace(/&amp;/g, '&'));
    const fix = u => absolute ? u : rebase(u, base);
    if (/<sitemapindex[\s>]/.test(t)) queue.push(...locs.map(fix));
    else out.push(...locs.map(fix));
  }
  return [...new Set(out)];
}

export async function listPages(target) {
  if (!target) throw new UsageError('no target');
  const filt = process.env.QA_PAGES ? process.env.QA_PAGES.split(',') : null;
  let urls;
  if (/^https?:\/\//.test(target)) {
    const base = target.replace(/\/$/, '');
    rootPrefix = base;
    urls = await sitemapUrls(base);
    if (!urls.length) urls = [base + '/'];
  } else {
    // resolve() makes relative targets work ("site/_dist"); pathToFileURL handles drive letters and spaces
    const dir = resolve(target);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new UsageError(`target is neither an http(s) URL nor a folder: ${target}`);
    rootPrefix = pathToFileURL(dir).href.replace(/\/$/, '') + '/';
    urls = [...htmlBelow(dir)].map(r => pathToFileURL(join(dir, r)).href);
  }
  return filt ? urls.filter(u => filt.some(x => u.includes(x))) : urls;
}

// Mobile emulation (mobile viewport + touch) for widths up to QA_MOBILE_MAX px (default 820), so a 768 or
// 820 px tablet is tested as the touch device it is, not as a small desktop.
export function mobileMax() {
  const v = process.env.QA_MOBILE_MAX;
  if (v === undefined || v === '') return 820;
  if (!/^\d{1,5}$/.test(v)) throw new UsageError(`QA_MOBILE_MAX: "${v}" is not a width in px`);
  return +v;
}
export const isMobile = w => w <= mobileMax();
// Default height for a bare width: phone 844, tablet 1024, desktop 900.
export const defaultHeight = w => (w < 600 ? 844 : isMobile(w) ? 1024 : 900);

// QA_WIDTHS="1440x900,390x844" -> [[1440,900,false],[390,844,true]] (mobile when width <= QA_MOBILE_MAX)
// A bare width ("390") gets a default height. Anything else that is not WxH throws, so a typo fails loudly
// instead of reaching Chrome as a NaN viewport.
export function widths(def = '1440x900,390x844') {
  return (process.env.QA_WIDTHS || def).split(',').map(x => x.trim()).filter(Boolean).map(x => {
    const m = /^(\d{2,5})(?:x(\d{2,5}))?$/i.exec(x);
    if (!m) throw new UsageError(`QA_WIDTHS: "${x}" is not WxH (e.g. 390x844)`);
    const w = +m[1];
    return [w, m[2] ? +m[2] : defaultHeight(w), isMobile(w)];
  });
}

// Page label for output: path relative to the folder or base URL that listPages was given.
export const short = u => {
  if (rootPrefix && u.startsWith(rootPrefix)) return u.slice(rootPrefix.length) || '/';
  return u.replace(/^file:\/\/\/.*\//, '').replace(/^https?:\/\/[^/]+/, '') || '/';
};
// File-name-safe page label (for screenshots and text dumps)
export const slug = u => short(u).replace(/[\\/:?#&=]+/g, '_').replace(/^_/, '') || 'index';

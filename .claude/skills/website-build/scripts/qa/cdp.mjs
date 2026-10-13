// Minimal Chrome DevTools Protocol client over Node's global WebSocket (Node >= 22; built on 24).
// Distilled from a production website QA harness.
// Why raw CDP: in the real build the browser extension and the Playwright MCP both failed to connect, and a
// CDP client needs nothing but a WebSocket. No npm install required.
//
// Env:
//   CHROME_PATH  Chrome/Chromium binary (default: the usual Windows / macOS / Linux locations)
//   CHROME_ARGS  extra Chrome flags, space-separated (e.g. "--no-sandbox" on some Linux CI runners)
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
];
export const CHROME = process.env.CHROME_PATH || CANDIDATES.find(p => existsSync(p)) || 'chrome';
export const wait = ms => new Promise(r => setTimeout(r, ms));

// launch(port, { args }) - headless Chrome with a throwaway profile. Use a different port per
// parallel process (two launches on one port = the second attaches to the first browser).
// The browser is killed and its profile removed when the Node process exits, also when a script throws
// halfway (an orphaned headless Chrome keeps the port busy for the next run).
export async function launch(port = 9333, { args = [], gpu = false } = {}) {
  const prof = mkdtempSync(join(tmpdir(), 'webqa-'));
  const extra = (process.env.CHROME_ARGS || '').split(/\s+/).filter(Boolean);
  const p = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`,
    '--no-first-run', '--no-default-browser-check', ...(gpu ? [] : ['--disable-gpu']),
    '--allow-file-access-from-files', '--hide-scrollbars',
    '--force-device-scale-factor=1', ...extra, ...args, 'about:blank'
  ], { stdio: 'ignore' });
  let spawnError = null;
  p.on('error', e => { spawnError = e; });
  process.on('exit', () => {
    try { p.kill(); } catch {}
    try { rmSync(prof, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  });
  let info = null;
  for (let i = 0; i < 80 && !spawnError; i++) {
    try { info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; }
    catch { await wait(250); }
  }
  if (!info) throw new Error(`chrome did not start on port ${port} (CHROME_PATH=${CHROME}${spawnError ? ', ' + spawnError.message : ''})`);
  return { proc: p, port, wsUrl: info.webSocketDebuggerUrl };
}

export class Session {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; this.sessionId = null;
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method) this.events.push(m);
    });
  }
  send(method, params = {}, sessionId = this.sessionId) {
    const id = ++this.id;
    const msg = { id, method, params }; if (sessionId) msg.sessionId = sessionId;
    return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify(msg)); });
  }
}

export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  const s = new Session(ws);
  const { targetId } = await s.send('Target.createTarget', { url: 'about:blank' }, null);
  const { sessionId } = await s.send('Target.attachToTarget', { targetId, flatten: true }, null);
  s.sessionId = sessionId;
  await s.send('Page.enable'); await s.send('Runtime.enable'); await s.send('Log.enable');
  await s.send('Network.enable');
  return s;
}

// goto: sets the viewport, clears the event buffer, navigates, waits for load + `settle` ms.
// mobile:true also turns on touch emulation; pass ua to override the user agent.
export async function goto(s, url, { width = 1440, height = 900, mobile = false, dsf = 1, ua = null, settle = 900 } = {}) {
  await s.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dsf, mobile });
  await s.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 }).catch(() => {});
  if (ua) await s.send('Network.setUserAgentOverride', { userAgent: ua });
  s.events.length = 0;
  await s.send('Page.navigate', { url });
  for (let i = 0; i < 150; i++) {
    if (s.events.some(e => e.method === 'Page.loadEventFired')) break;
    await wait(100);
  }
  await wait(settle);
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

// Real wheel input (goes through Lenis momentum exactly like a user's mouse).
export async function wheel(s, { x = 700, y = 450, dy = 200, times = 1, gap = 60, settle = 900 } = {}) {
  for (let i = 0; i < times; i++) {
    await s.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy, pointerType: 'mouse' });
    await wait(gap);
  }
  await wait(settle);
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
  return [...new Set(out)];
}

// ---- targets -------------------------------------------------------------------------------
// target = a local folder (pages = its *.html, loaded as file://) or a base URL (pages = <loc> in
// /sitemap.xml, or just the base if there is none). QA_PAGES=a,b keeps only URLs containing a or b.
export async function listPages(target) {
  const filt = process.env.QA_PAGES ? process.env.QA_PAGES.split(',') : null;
  let urls;
  if (/^https?:\/\//.test(target)) {
    const base = target.replace(/\/$/, '');
    try {
      const r = await fetch(base + '/sitemap.xml');
      const t = r.ok ? await r.text() : '';
      urls = [...t.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
    } catch { urls = []; }
    if (!urls.length) urls = [base + '/'];
  } else {
    // resolve() makes relative targets work ("site/_dist"); pathToFileURL handles drive letters and spaces
    const dir = resolve(target);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`target is neither an http(s) URL nor a folder: ${target}`);
    urls = readdirSync(dir).filter(f => f.endsWith('.html') && !f.startsWith('_') && !/\.bak/.test(f)).sort()
      .map(f => pathToFileURL(join(dir, f)).href);
  }
  return filt ? urls.filter(u => filt.some(x => u.includes(x))) : urls;
}

// QA_WIDTHS="1440x900,390x844" -> [[1440,900,false],[390,844,true]] (mobile when width < 600)
// A bare width ("390") gets a default height. Anything else that is not WxH throws, so a typo fails loudly
// instead of reaching Chrome as a NaN viewport.
export function widths(def = '1440x900,390x844') {
  return (process.env.QA_WIDTHS || def).split(',').map(x => x.trim()).filter(Boolean).map(x => {
    const m = /^(\d{2,5})(?:x(\d{2,5}))?$/i.exec(x);
    if (!m) throw new Error(`QA_WIDTHS: "${x}" is not WxH (e.g. 390x844)`);
    const w = +m[1];
    return [w, m[2] ? +m[2] : (w < 600 ? 844 : 900), w < 600];
  });
}

export const short = u => u.replace(/^file:\/\/\/.*\//, '').replace(/^https?:\/\/[^/]+/, '') || '/';

// In-app browser (Instagram / Facebook / TikTok) + WebKit (Safari engine) matrix against a base URL.
// Read-only and paced (one page at a time, QA_PACE ms apart, default 1500). Needs the `playwright` npm
// package + `npx playwright install webkit chromium`.
//   PW=<path to playwright/index.mjs> node inapp.mjs https://www.example.com [out-dir]
// Env: PAGES=/,/de,...  CTX=ios-safari,android-instagram,...  QA_LOCALE=en-US
//      QA_COOKIE_BAR=<cookie bar selector>  QA_ACCEPT=<accept button selector, default: first button in the bar>
//      QA_BURGER=<menu toggle selector>  QA_BADGE=<app-store badge selector>  QA_HERO=<hero selector>
// Exit: 0 clean, 1 findings (any row flagged CHECK), 2 bad usage, 3 could not run (Playwright or its browsers missing).
// The contexts (device + UA + viewport height + dark mode) live in inapp-contexts.json, dated; refresh the UA
// strings when that date is old. The verdict per row is findings() in inapp-checks.mjs.
// Note: a UA string + viewport is an approximation of an in-app browser (same engine, same UA sniffing, smaller
// viewport, dark mode for TikTok). It does not reproduce the apps' own chrome or their link handling.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { contexts, parseArgs, findings, ageDays, STALE_DAYS, DATA_URL } from './inapp-checks.mjs';

const opt = parseArgs(process.argv.slice(2), process.env);
if (opt.error) { console.error('usage: ' + opt.error); process.exit(2); }
const data = JSON.parse(fs.readFileSync(DATA_URL, 'utf8'));
let CTX;
try { CTX = contexts(data, opt.only); } catch (e) { console.error('usage: ' + e.message); process.exit(2); }
const age = ageDays(data);
if (!(age <= STALE_DAYS)) console.error(`warning: inapp-contexts.json was last updated ${data.updated} (${age} days ago); refresh the UA strings`);

let pw;
try { pw = await import(process.env.PW ? pathToFileURL(process.env.PW).href : 'playwright'); }
catch (e) { console.error('could not run: playwright not found: `npm i playwright && npx playwright install webkit chromium`, or set PW=<path to playwright/index.mjs>\n' + e.message); process.exit(3); }
const { webkit, chromium, devices } = pw;
const PACE = +(process.env.QA_PACE || 1500);
const SEL = opt.sel;
fs.mkdirSync(opt.out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
// wait until scrollY has not changed for 3 reads, then two animation frames (capped)
const settle = page => page.evaluate(() => new Promise(res => {
  let last = -1, same = 0; const end = Date.now() + 4000;
  const tick = () => { const y = Math.round(scrollY); same = y === last ? same + 1 : 0; last = y;
    if (same >= 2 || Date.now() > end) requestAnimationFrame(() => requestAnimationFrame(() => res(y))); else setTimeout(tick, 80); };
  tick();
})).catch(() => {});

const results = []; let flagged = 0;
try {
  for (const c of CTX) {
    let browser;
    try { browser = await (c.eng === 'webkit' ? webkit : chromium).launch(); }
    catch (e) { console.error(`could not run: ${c.eng} did not start (npx playwright install ${c.eng})\n` + e.message.split('\n')[0]); process.exit(3); }
    const d = { ...devices[c.dev] };
    delete d.defaultBrowserType;
    if (c.ua) d.userAgent = c.ua;
    if (c.vh) d.viewport = { ...d.viewport, height: c.vh };
    const ctx = await browser.newContext({ ...d, colorScheme: c.dark ? 'dark' : 'light', locale: opt.locale });
    for (const path of opt.pages) {
      const page = await ctx.newPage();
      const errs = [], cons = [], bad = [];
      page.on('pageerror', e => errs.push(String(e.message).slice(0, 200)));
      page.on('console', m => { if (m.type() === 'error') cons.push(m.text().slice(0, 200)); });
      page.on('response', r => { if (r.status() >= 400 && !/\/favicon\.ico(\?|$)/.test(r.url())) bad.push(r.status() + ' ' + r.url().slice(0, 120)); });
      const r = { ctx: c.id, path };
      const shot = `${opt.out}/${c.id}${path.replace(/\//g, '_')}`;
      try {
        const resp = await page.goto(opt.base + path, { waitUntil: 'load', timeout: 45000 });
        r.status = resp && resp.status();
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        Object.assign(r, await page.evaluate((SEL) => {
          const de = document.documentElement, W = innerWidth;
          const vis = e => { const s = getComputedStyle(e), b = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && b.width > 0 && b.height > 0; };
          const name = el => el.id ? '#' + el.id : (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : el.tagName);
          const over = [];
          if (de.scrollWidth > W + 1) for (const el of document.querySelectorAll('body *')) {
            const b = el.getBoundingClientRect();
            if (b.width && b.right > W + 2) { over.push(name(el) + ':' + Math.round(b.right)); if (over.length > 4) break; }
          }
          const cc = [...document.querySelectorAll(SEL.cc)].filter(vis);
          const badges = [...document.querySelectorAll(SEL.badge)].filter(vis).map(a => /apple|app.?store|ios/i.test(a.href + ' ' + a.className + ' ' + (a.getAttribute('aria-label') || '')) ? 'ios' : 'and');
          const hero = document.querySelector(SEL.hero);
          const brokenImg = [...document.images].filter(i => i.complete && i.naturalWidth === 0 && vis(i)).map(i => (i.currentSrc || i.src).slice(-60)).slice(0, 3);
          const fixedBottom = [...document.querySelectorAll('body *')].filter(e => { const s = getComputedStyle(e); if (s.position !== 'fixed' || !vis(e)) return false; const b = e.getBoundingClientRect(); return b.bottom > innerHeight - 4 && b.height < innerHeight * 0.6; }).map(e => name(e) + ':' + Math.round(e.getBoundingClientRect().height));
          return { W, H: innerHeight, sw: de.scrollWidth, over, cc: cc.length, badges: [...new Set(badges)].join('+'), heroH: hero ? Math.round(hero.getBoundingClientRect().height) : null, brokenImg, fixedBottom, lenis: !!window.__lenis, lang: de.lang, bg: getComputedStyle(document.body).backgroundColor };
        }, SEL));
        await page.screenshot({ path: shot + '.png' });
        // only when the bar is showing: after consent on an earlier page the hidden button is still in the DOM
        const acc = page.locator(SEL.accept).first();
        if (r.cc && await acc.count()) {
          try {
            await acc.click({ timeout: 3000 });
            r.ccClick = await page.waitForFunction(cc => ![...document.querySelectorAll(cc)].some(e => e.getBoundingClientRect().height > 0 && getComputedStyle(e).display !== 'none'), SEL.cc, { timeout: 3000 })
              .then(() => 'ok', () => 'STILL-VISIBLE');
          } catch (e) { r.ccClick = 'FAIL ' + e.message.split('\n')[0].slice(0, 80); }
        }
        const burger = page.locator(SEL.burger);
        if (await burger.count() && await burger.isVisible()) {
          try {
            await burger.click({ timeout: 3000 });
            const isOpen = () => { const o = [...document.querySelectorAll('body *')].find(e => getComputedStyle(e).position === 'fixed' && e.getBoundingClientRect().height > innerHeight * 0.6 && e.getBoundingClientRect().width > innerWidth * 0.6 && getComputedStyle(e).visibility !== 'hidden' && +getComputedStyle(e).opacity > 0.5); return o ? 'open:' + Math.round(o.getBoundingClientRect().height) + '/' + innerHeight : false; };
            r.menu = await page.waitForFunction(isOpen, null, { timeout: 3000 }).then(h => h.jsonValue(), () => 'NOT-OPEN');
            await page.screenshot({ path: shot + '-menu.png' });
            await burger.click({ timeout: 3000 }).catch(() => page.keyboard.press('Escape'));
            await settle(page);
          } catch (e) { r.menu = 'ERR ' + e.message.split('\n')[0].slice(0, 80); }
        }
        const y0 = await page.evaluate(() => scrollY);
        if (/Desktop|iPad/.test(c.dev)) await page.mouse.wheel(0, 1200);
        else await page.evaluate(() => window.__lenis ? window.__lenis.scrollTo(1200, { immediate: true, force: true }) : scrollTo(0, 1200));
        r.scrolled = (await settle(page)) - y0;
        await page.screenshot({ path: shot + '-scrolled.png' });
      } catch (e) { r.fatal = e.message.split('\n')[0].slice(0, 160); }
      r.errs = errs; r.cons = cons; r.bad = bad;
      r.findings = findings(r);
      results.push(r);
      if (r.findings.length) flagged++;
      console.log(r.findings.length ? 'CHECK' : 'ok   ', c.id, path, JSON.stringify({ st: r.status, W: r.W, H: r.H, sw: r.sw, cc: r.cc, cck: r.ccClick, badges: r.badges, heroH: r.heroH, menu: r.menu, scr: r.scrolled, fb: r.fixedBottom }));
      for (const f of r.findings) console.log('      ' + f);
      await page.close();
      await sleep(PACE);
    }
    await browser.close();
  }
} catch (e) { console.error('could not run: ' + e.message); process.exit(3); }
fs.writeFileSync(`${opt.out}/results.json`, JSON.stringify(results, null, 1));
console.log(`\n${results.length} rows, ${flagged} flagged -> ${opt.out}/results.json`);
process.exit(flagged ? 1 : 0);

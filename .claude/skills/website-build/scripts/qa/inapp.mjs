// In-app browser (Instagram / Facebook / TikTok) + WebKit (Safari engine) matrix against a base URL.
// Read-only, throttled (one page at a time, 1.5 s apart). Needs the `playwright` npm package + `npx playwright install webkit`.
// PW=<path to playwright/index.mjs> node inapp.mjs https://www.example.com out-dir
// Env: PAGES=/,/de,...  CTX=ios-safari,android-instagram,...  QA_LOCALE=en-US
//      QA_COOKIE_BAR=<cookie bar selector>  QA_ACCEPT=<accept button selector, default: first button in the bar>
//      QA_BURGER=<menu toggle selector>  QA_BADGE=<app-store badge selector>  QA_HERO=<hero selector>
// Note: a UA string + viewport is an approximation of an in-app browser (same engine, same UA sniffing, smaller
// viewport, dark mode for TikTok). It does not reproduce the apps' own chrome or their link handling.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const BASE = (process.argv[2] || '').replace(/\/$/, '');
if (!/^https?:\/\//.test(BASE)) { console.error('usage: node inapp.mjs <http(s)-base-url> [out-dir]'); process.exit(2); }
let pw;
try { pw = await import(process.env.PW ? pathToFileURL(process.env.PW).href : 'playwright'); }
catch (e) { console.error('playwright not found: `npm i playwright && npx playwright install webkit chromium`, or set PW=<path to playwright/index.mjs>\n' + e.message); process.exit(2); }
const { webkit, chromium, devices } = pw;
const OUT = process.argv[3] || 'out';
fs.mkdirSync(OUT, { recursive: true });
const PAGES = (process.env.PAGES || '/').split(',');
const SEL = {
  cc: process.env.QA_COOKIE_BAR || '.cookie-bar',
  accept: process.env.QA_ACCEPT || '',
  burger: process.env.QA_BURGER || '.menu-toggle',
  badge: process.env.QA_BADGE || '.store-badge',
  hero: process.env.QA_HERO || '.hero',
};
if (!SEL.accept) SEL.accept = SEL.cc + ' button';
const LOCALE = process.env.QA_LOCALE || 'en-US';
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const AND = 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36';
const CTX = [
  { id: 'ios-safari', eng: 'webkit', dev: 'iPhone 13', ua: IOS + ' Version/18.5 Mobile/15E148 Safari/604.1' },
  { id: 'ios-instagram', eng: 'webkit', dev: 'iPhone 13', ua: IOS + ' Mobile/15E148 Instagram 350.0.0.30.98 (iPhone14,5; iOS 18_5; en_US; en; scale=3.00; 1170x2532; 650000000)', vh: 664 },
  { id: 'ios-facebook', eng: 'webkit', dev: 'iPhone 13', ua: IOS + ' Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.40.108;FBBV/650000000;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/18.5;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/80]', vh: 640 },
  { id: 'ios-tiktok', eng: 'webkit', dev: 'iPhone 13', ua: IOS + ' Mobile/15E148 musical_ly_36.5.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/US isDarkMode/1 WKWebView/1 BytedanceWebview/d8a21c6', vh: 650, dark: true },
  { id: 'ios-safari-landscape', eng: 'webkit', dev: 'iPhone 13 landscape', ua: IOS + ' Version/18.5 Mobile/15E148 Safari/604.1' },
  { id: 'ipad-safari', eng: 'webkit', dev: 'iPad (gen 7)' },
  { id: 'mac-safari', eng: 'webkit', dev: 'Desktop Safari' },
  { id: 'android-instagram', eng: 'chromium', dev: 'Pixel 7', ua: AND + ' Instagram 350.0.0.42.86 Android (34/14; 420dpi; 1080x2400; Google; Pixel 7; panther; gs201; en_US; 650000000)', vh: 700 },
  { id: 'android-facebook', eng: 'chromium', dev: 'Pixel 7', ua: AND + ' [FB_IAB/FB4A;FBAV/480.0.0.45.108;]', vh: 690 },
  { id: 'android-tiktok', eng: 'chromium', dev: 'Pixel 7', ua: AND + ' musical_ly_2023605030 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/36.5.3 ByteLocale/en Region/US', vh: 700, dark: true },
];
const only = process.env.CTX ? process.env.CTX.split(',') : null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
for (const c of CTX) {
  if (only && !only.includes(c.id)) continue;
  const browser = await (c.eng === 'webkit' ? webkit : chromium).launch();
  const d = { ...devices[c.dev] };
  delete d.defaultBrowserType;
  if (c.ua) d.userAgent = c.ua;
  if (c.vh) d.viewport = { ...d.viewport, height: c.vh };
  const ctx = await browser.newContext({ ...d, colorScheme: c.dark ? 'dark' : 'light', locale: LOCALE });
  for (const path of PAGES) {
    const page = await ctx.newPage();
    const errs = [], cons = [], bad = [];
    page.on('pageerror', e => errs.push(String(e.message).slice(0, 200)));
    page.on('console', m => { if (m.type() === 'error') cons.push(m.text().slice(0, 200)); });
    page.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().slice(0, 120)); });
    const r = { ctx: c.id, path };
    const shot = `${OUT}/${c.id}${path.replace(/\//g, '_')}`;
    try {
      const resp = await page.goto(BASE + path, { waitUntil: 'load', timeout: 45000 });
      r.status = resp && resp.status();
      await sleep(2500);
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
      const acc = page.locator(SEL.accept).first();
      if (await acc.count()) { try { await acc.click({ timeout: 3000 }); await sleep(400); r.ccClick = (await page.evaluate((cc) => [...document.querySelectorAll(cc)].filter(e => e.getBoundingClientRect().height > 0 && getComputedStyle(e).display !== 'none').length, SEL.cc)) ? 'STILL-VISIBLE' : 'ok'; } catch (e) { r.ccClick = 'FAIL ' + e.message.split('\n')[0].slice(0, 80); } }
      const burger = page.locator(SEL.burger);
      if (await burger.count() && await burger.isVisible()) {
        try {
          await burger.click({ timeout: 3000 }); await sleep(700);
          r.menu = await page.evaluate(() => { const o = [...document.querySelectorAll('body *')].find(e => getComputedStyle(e).position === 'fixed' && e.getBoundingClientRect().height > innerHeight * 0.6 && e.getBoundingClientRect().width > innerWidth * 0.6 && getComputedStyle(e).visibility !== 'hidden' && +getComputedStyle(e).opacity > 0.5); return o ? 'open:' + Math.round(o.getBoundingClientRect().height) + '/' + innerHeight : 'NOT-OPEN'; });
          await page.screenshot({ path: shot + '-menu.png' });
          await burger.click({ timeout: 3000 }).catch(() => page.keyboard.press('Escape')); await sleep(500);
        } catch (e) { r.menu = 'ERR ' + e.message.split('\n')[0].slice(0, 80); }
      }
      const y0 = await page.evaluate(() => scrollY);
      if (/Desktop|iPad/.test(c.dev)) await page.mouse.wheel(0, 1200);
      else await page.evaluate(() => window.__lenis ? window.__lenis.scrollTo(1200, { immediate: true, force: true }) : scrollTo(0, 1200));
      await sleep(900);
      r.scrolled = (await page.evaluate(() => scrollY)) - y0;
      await page.screenshot({ path: shot + '-scrolled.png' });
    } catch (e) { r.fatal = e.message.split('\n')[0].slice(0, 160); }
    r.errs = errs; r.cons = cons; r.bad = bad;
    results.push(r);
    const flag = (r.fatal || errs.length || r.over?.length || r.brokenImg?.length || bad.length || /NOT-OPEN|ERR/.test(r.menu || '') || /FAIL|STILL/.test(r.ccClick || '')) ? 'CHECK' : 'ok';
    console.log(flag, c.id, path, JSON.stringify({ st: r.status, W: r.W, H: r.H, sw: r.sw, over: r.over, cc: r.cc, cck: r.ccClick, badges: r.badges, heroH: r.heroH, menu: r.menu, scr: r.scrolled, img: r.brokenImg, fb: r.fixedBottom, errs, cons: cons.slice(0, 2), bad: bad.slice(0, 3), fatal: r.fatal }));
    await page.close();
    await sleep(1500);
  }
  await browser.close();
}
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));

// Same-page anchor test: for every distinct a[href^="#"] on the page, start mid-page, click it
// (from the page, and from the open menu if QA_BURGER/QA_MENU are set), wait for the smooth scroll,
// and check the target's top lands inside [-5, QA_ANCHOR_MAX] px. Catches: menus that lock scrolling
// so the click does nothing, Lenis ignoring hash links, a fixed nav covering the target.
//   node anchors.mjs <dir|url> [width=390]
//   QA_BURGER=".menu-toggle" QA_MENU=".site-menu" QA_ANCHOR_MAX=200
// Distilled from a production site QA harness.
import { launch, connect, goto, ev, listPages, short, scrollToY, wait } from './cdp.mjs';

const [target, W = '390'] = process.argv.slice(2);
if (!target) { console.error('usage: node anchors.mjs <dir|url> [width]'); process.exit(2); }
const w = +W, h = w < 600 ? 844 : 900, mobile = w < 600;
const BURGER = process.env.QA_BURGER || '', MENU = process.env.QA_MENU || '';
const MAXTOP = +(process.env.QA_ANCHOR_MAX || 200);
const pages = await listPages(target);
const { proc, wsUrl } = await launch(+(process.env.QA_PORT || 9460)); const s = await connect(wsUrl);
let fails = 0;
for (const u of pages) {
  await goto(s, u, { width: w, height: h, mobile, settle: 1500 });
  const hrefs = JSON.parse(await ev(s, `JSON.stringify([...new Set([...document.querySelectorAll('a[href^="#"]')].map(a=>a.getAttribute('href')).filter(x=>x.length>1))])`));
  for (const href of hrefs) for (const via of (BURGER && MENU ? ['page', 'menu'] : ['page'])) {
    await scrollToY(s, Math.round(await ev(s, 'document.documentElement.scrollHeight') / 2)); await wait(500);
    const sel = JSON.stringify(`a[href="${href}"]`);
    const clicked = via === 'menu'
      ? await ev(s, `(()=>{const b=document.querySelector(${JSON.stringify(BURGER)});if(!b)return 'noburger';b.click();const a=document.querySelector(${JSON.stringify(MENU)}+' '+${sel});if(!a){b.click();return 'none'}a.click();return 'ok'})()`)
      : await ev(s, `(()=>{const a=[...document.querySelectorAll(${sel})].find(x=>!${JSON.stringify(MENU)}||!x.closest(${JSON.stringify(MENU || 'x-none')}));if(!a)return 'none';a.click();return 'ok'})()`);
    if (clicked !== 'ok') continue;
    await wait(2500);
    const r = await ev(s, `JSON.stringify((()=>{const el=document.getElementById(${JSON.stringify(decodeURIComponent(href.slice(1)))});const d=document.documentElement;return {top:el?Math.round(el.getBoundingClientRect().top):'MISSING',atEnd:scrollY>=d.scrollHeight-innerHeight-2,vh:innerHeight}})())`);
    const { top, atEnd, vh } = JSON.parse(r);
    // a target near the page end cannot reach the top: OK if the page is scrolled to its end and the target is on screen
    const ok = typeof top === 'number' && top >= -5 && (top <= MAXTOP || (atEnd && top < vh));
    if (!ok) fails++;
    console.log((ok ? 'ok   ' : 'FAIL ') + short(u), via, href, '-> top', top);
  }
}
console.log(`\n${fails} failing anchors`);
proc.kill(); process.exit(fails ? 1 : 0);

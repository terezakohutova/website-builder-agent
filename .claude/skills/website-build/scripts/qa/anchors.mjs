// Same-page anchor test: for every distinct a[href^="#"] on the page, start mid-page, click it
// (from the page, and from the open menu if QA_BURGER/QA_MENU are set), wait until the scroll stops
// (position polled, not a fixed sleep), and check the target's top lands inside [-5, QA_ANCHOR_MAX] px.
// Catches: menus that lock scrolling so the click does nothing, Lenis ignoring hash links, a fixed nav
// covering the target.
//   node anchors.mjs <dir|url> [width=390]
//   QA_BURGER=".menu-toggle" QA_MENU=".site-menu" QA_ANCHOR_MAX=200
// Exit: 0 clean, 1 findings (a miss, a covered target, a page that fails to load), 2 bad usage, 3 could not run.
// Distilled from a production site QA harness.
import { main, open, visit, ev, listPages, short, scrollAndSettle, scrollSettle, wait, UsageError, isMobile, defaultHeight } from './cdp.mjs';

main(async () => {
  const [target, W = '390'] = process.argv.slice(2);
  if (!target || !/^\d+$/.test(W)) throw new UsageError('node anchors.mjs <dir|url> [width]');
  const w = +W, h = defaultHeight(w), mobile = isMobile(w);
  const BURGER = process.env.QA_BURGER || '', MENU = process.env.QA_MENU || '';
  const MAXTOP = +(process.env.QA_ANCHOR_MAX || 200);
  const pages = await listPages(target);
  const { s } = await open();
  let fails = 0;
  for (const u of pages) {
    const nav = await visit(s, u, { width: w, height: h, mobile });
    if (!nav.ok) { fails++; console.log(`FAIL ${short(u)} ${nav.error}`); continue; }
    const hrefs = JSON.parse(await ev(s, `JSON.stringify([...new Set([...document.querySelectorAll('a[href^="#"]')].map(a=>a.getAttribute('href')).filter(x=>x.length>1))])`));
    for (const href of hrefs) for (const via of (BURGER && MENU ? ['page', 'menu'] : ['page'])) {
      await scrollAndSettle(s, Math.round(await ev(s, 'document.documentElement.scrollHeight') / 2), { idle: 300 });
      const sel = JSON.stringify(`a[href="${href}"]`);
      const clicked = via === 'menu'
        ? await ev(s, `(()=>{const b=document.querySelector(${JSON.stringify(BURGER)});if(!b)return 'noburger';b.click();const a=document.querySelector(${JSON.stringify(MENU)}+' '+${sel});if(!a){b.click();return 'none'}a.click();return 'ok'})()`)
        : await ev(s, `(()=>{const a=[...document.querySelectorAll(${sel})].find(x=>!${JSON.stringify(MENU)}||!x.closest(${JSON.stringify(MENU || 'x-none')}));if(!a)return 'none';a.click();return 'ok'})()`);
      if (clicked !== 'ok') continue;
      await wait(120);            // let a smooth scroll (or a menu close animation) start before polling
      await scrollSettle(s);
      // covered = the point just inside the target's top edge belongs to another element (a fixed nav, a banner)
      const r = await ev(s, `JSON.stringify((()=>{const el=document.getElementById(${JSON.stringify(decodeURIComponent(href.slice(1)))});const d=document.documentElement;
        if(!el)return {top:'MISSING'};const b=el.getBoundingClientRect();
        const x=Math.min(Math.max(b.left+Math.min(b.width/2,40),0),innerWidth-1),y=Math.min(Math.max(b.top+Math.min(b.height/2,6),0),innerHeight-1);
        const hit=document.elementFromPoint(x,y);const by=hit&&hit!==el&&!el.contains(hit)&&!hit.contains(el)?hit:null;
        return {top:Math.round(b.top),atEnd:scrollY>=d.scrollHeight-innerHeight-2,vh:innerHeight,
          covered:by?by.tagName.toLowerCase()+(by.id?'#'+by.id:'')+(typeof by.className==='string'&&by.className?'.'+by.className.trim().split(/\\s+/)[0]:''):null}})())`);
      const { top, atEnd, vh, covered } = JSON.parse(r);
      // a target near the page end cannot reach the top: OK if the page is scrolled to its end and the target is on screen
      const ok = typeof top === 'number' && top >= -5 && (top <= MAXTOP || (atEnd && top < vh)) && !covered;
      if (!ok) fails++;
      console.log((ok ? 'ok   ' : 'FAIL ') + short(u), via, href, '-> top', top, covered ? 'covered by ' + covered : '');
    }
  }
  console.log(`\n${fails} failing anchors`);
  return fails;
});

// Drive REAL wheel events (Input.dispatchMouseEvent) through the page, so smooth-scroll libraries
// (Lenis) and scroll-direction logic (auto-hiding nav) behave as for a user. scrollTo/scrollIntoView
// are swallowed by Lenis and leave scrollY at 0, which makes scroll-dependent features test as broken.
// Prints scrollY plus an optional state expression after each burst.
//   node wheel.mjs <dir|url> [width=1440]
//   QA_WATCH="document.querySelector('.nav').classList.contains('nav--away')"
import { launch, connect, goto, ev, wheel, consoleErrors, listPages, short } from './cdp.mjs';

const [target, W = '1440'] = process.argv.slice(2);
if (!target || !/^\d+$/.test(W)) { console.error('usage: node wheel.mjs <dir|url> [width]'); process.exit(2); }
const w = +W, h = 844;
const WATCH = process.env.QA_WATCH || 'null';
const pages = await listPages(target);
const { proc, wsUrl } = await launch(+(process.env.QA_PORT || 9352)); const s = await connect(wsUrl);
const st = () => ev(s, `JSON.stringify({y:Math.round(scrollY),watch:(()=>{try{return ${WATCH}}catch(e){return 'ERR '+e.message}})()})`);
const W2 = { x: Math.round(w / 2), y: Math.round(h / 2) };
for (const u of pages) {
  await goto(s, u, { width: w, height: h, mobile: w < 600 });
  const rows = [['load', await st()]];
  await wheel(s, { ...W2, dy: 200, times: 3 }); rows.push(['down x3', await st()]);
  await wheel(s, { ...W2, dy: 200, times: 10 }); rows.push(['down x10 more', await st()]);
  await wheel(s, { ...W2, dy: -200, times: 4 }); rows.push(['UP x4', await st()]);
  await wheel(s, { ...W2, dy: 200, times: 6 }); rows.push(['down x6', await st()]);
  await wheel(s, { ...W2, dy: -200, times: 40 }); rows.push(['UP to top', await st()]);
  console.log('\n### ' + short(u) + ' (w=' + w + ')');
  for (const [l, r] of rows) console.log('  ' + l.padEnd(16) + r);
  const errs = consoleErrors(s); if (errs.length) console.log('  ERRORS:', errs.slice(0, 4));
}
proc.kill(); process.exit(0);

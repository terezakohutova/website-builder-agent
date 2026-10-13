// Drive REAL wheel events (Input.dispatchMouseEvent) through the page, so smooth-scroll libraries
// (Lenis) and scroll-direction logic (auto-hiding nav) behave as for a user. scrollTo/scrollIntoView
// are swallowed by Lenis and leave scrollY at 0, which makes scroll-dependent features test as broken.
// Prints scrollY plus an optional state expression after each burst (each read once scrolling has stopped).
//   node wheel.mjs <dir|url> [width=1440]
//   QA_WATCH="document.querySelector('.nav').classList.contains('nav--away')"
// Exit: 0 done, 1 findings (JS errors, a page that fails to load, or a scrollable page the wheel did not move),
// 2 bad usage, 3 could not run.
import { main, open, visit, ev, wheel, consoleErrors, listPages, short, ignoreFilter, UsageError } from './cdp.mjs';

main(async () => {
  const [target, W = '1440'] = process.argv.slice(2);
  if (!target || !/^\d+$/.test(W)) throw new UsageError('node wheel.mjs <dir|url> [width]');
  const w = +W, h = 844;
  const WATCH = process.env.QA_WATCH || 'null';
  const keep = ignoreFilter();
  const pages = await listPages(target);
  const { s } = await open(9352);
  const st = async () => JSON.parse(await ev(s, `JSON.stringify({y:Math.round(scrollY),watch:(()=>{try{return ${WATCH}}catch(e){return 'ERR '+e.message}})()})`));
  const W2 = { x: Math.round(w / 2), y: Math.round(h / 2) };
  let found = 0;
  for (const u of pages) {
    const nav = await visit(s, u, { width: w, height: h, mobile: w < 600 });
    if (!nav.ok) { found++; console.log(`FAIL ${short(u)} ${nav.error}`); continue; }
    const rows = [['load', await st()]];
    await wheel(s, { ...W2, dy: 200, times: 3 }); rows.push(['down x3', await st()]);
    await wheel(s, { ...W2, dy: 200, times: 10 }); rows.push(['down x10 more', await st()]);
    await wheel(s, { ...W2, dy: -200, times: 4 }); rows.push(['UP x4', await st()]);
    await wheel(s, { ...W2, dy: 200, times: 6 }); rows.push(['down x6', await st()]);
    await wheel(s, { ...W2, dy: -200, times: 40 }); rows.push(['UP to top', await st()]);
    console.log('\n### ' + short(u) + ' (w=' + w + ')');
    for (const [l, r] of rows) console.log('  ' + l.padEnd(16) + JSON.stringify(r));
    const scrollable = await ev(s, 'document.documentElement.scrollHeight > innerHeight + 50');
    if (scrollable && rows[1][1].y === 0) { found++; console.log('  FAIL: the page is scrollable but wheel input did not move it'); }
    const errs = keep(consoleErrors(s));
    if (errs.length) { found += errs.length; console.log('  ERRORS:', errs.slice(0, 4)); }
  }
  console.log(`\n${pages.length} pages, ${found} findings`);
  return found;
});

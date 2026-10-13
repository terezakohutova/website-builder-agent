// axe-core accessibility run per page x width, twice: with the cookie bar open, and after closing it
// (QA_DISMISS=".cookie-necessary") and scrolling through so reveal-on-scroll content is visible for
// contrast. Needs axe-core: `npm i axe-core` in any folder, then AXE_PATH=<that>/node_modules/axe-core/axe.min.js
//   node axe.mjs <dir|url> [out.json]
// Tags wcag2a/aa, 21a/aa, 22aa, best-practice.
// Exit: 0 clean, 1 findings (any violation, or a page that fails to load), 2 bad usage,
// 3 could not run (AXE_PATH missing or not a file, Chrome missing).
import { main, open, visit, ev, listPages, widths, short, scrollAndSettle, UsageError, CouldNotRun } from './cdp.mjs';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';

const RUN = `axe.run(document,{resultTypes:['violations','incomplete'],runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice']}})
 .then(r=>JSON.stringify({v:r.violations.map(x=>({id:x.id,impact:x.impact,n:x.nodes.length,help:x.help,nodes:x.nodes.slice(0,4).map(n=>n.target.join(' ')+' :: '+(n.failureSummary||'').replace(/\\s+/g,' ').slice(0,180))})),inc:r.incomplete.map(x=>({id:x.id,n:x.nodes.length}))}))`;

main(async () => {
  const [target, outFile = 'axe.json'] = process.argv.slice(2);
  if (!target) throw new UsageError('AXE_PATH=.../axe.min.js node axe.mjs <dir|url> [out.json]');
  const W = widths();
  const AXE_PATH = process.env.AXE_PATH;
  if (!AXE_PATH || !existsSync(AXE_PATH) || !statSync(AXE_PATH).isFile())
    throw new CouldNotRun(`axe-core not found: set AXE_PATH=<dir>/node_modules/axe-core/axe.min.js (got ${AXE_PATH || 'nothing'})`);
  const AXE = readFileSync(AXE_PATH, 'utf8');
  const pages = await listPages(target);
  const { s } = await open(9614);
  const R = {}; let total = 0;
  for (const u of pages) for (const [w, h, m] of W) {
    const nav = await visit(s, u, { width: w, height: h, mobile: m });
    if (!nav.ok) { total++; R[u + '@' + w] = { error: nav.error }; console.log(`FAIL ${short(u)} ${w} ${nav.error}`); continue; }
    await ev(s, AXE + '\n;1');
    const withBar = JSON.parse(await ev(s, RUN));
    if (process.env.QA_DISMISS) await ev(s, `(document.querySelector(${JSON.stringify(process.env.QA_DISMISS)})||{click(){}}).click();1`);
    const H = await ev(s, 'document.documentElement.scrollHeight');
    for (let y = 0; y < H; y += 700) await scrollAndSettle(s, y, { idle: 500 });
    await scrollAndSettle(s, 0);
    const after = JSON.parse(await ev(s, RUN));
    R[u + '@' + w] = { withBar, after };
    total += withBar.v.length + after.v.length;
    console.log(short(u), w, 'bar:', withBar.v.map(x => `${x.id}(${x.impact},${x.n})`).join(' ') || '-', '| after:', after.v.map(x => `${x.id}(${x.impact},${x.n})`).join(' ') || '-');
  }
  writeFileSync(outFile, JSON.stringify(R, null, 1));
  console.log(`\n${pages.length} pages, ${total} violations -> ${outFile}`);
  return total;
});

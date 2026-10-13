// axe-core accessibility run per page x width, twice: with the cookie bar open, and after closing it
// (QA_DISMISS=".cookie-necessary") and scrolling through so reveal-on-scroll content is visible for
// contrast. Needs axe-core: `npm i axe-core` in any folder, then AXE_PATH=<that>/node_modules/axe-core/axe.min.js
//   node axe.mjs <dir|url> [out.json]
// Tags wcag2a/aa, 21a/aa, 22aa, best-practice).
import { launch, connect, goto, ev, listPages, widths, short, scrollToY, wait } from './cdp.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const [target, outFile = 'axe.json'] = process.argv.slice(2);
const AXE_PATH = process.env.AXE_PATH;
if (!target || !AXE_PATH || !existsSync(AXE_PATH)) { console.error('usage: AXE_PATH=.../axe.min.js node axe.mjs <dir|url> [out.json]'); process.exit(2); }
const AXE = readFileSync(AXE_PATH, 'utf8');
const RUN = `axe.run(document,{resultTypes:['violations','incomplete'],runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice']}})
 .then(r=>JSON.stringify({v:r.violations.map(x=>({id:x.id,impact:x.impact,n:x.nodes.length,help:x.help,nodes:x.nodes.slice(0,4).map(n=>n.target.join(' ')+' :: '+(n.failureSummary||'').replace(/\\s+/g,' ').slice(0,180))})),inc:r.incomplete.map(x=>({id:x.id,n:x.nodes.length}))}))`;
const pages = await listPages(target);
const { proc, wsUrl } = await launch(+(process.env.QA_PORT || 9614)); const s = await connect(wsUrl);
const R = {}; let total = 0;
for (const u of pages) for (const [w, h, m] of widths()) {
  await goto(s, u, { width: w, height: h, mobile: m, settle: 1800 });
  await ev(s, AXE);
  const withBar = JSON.parse(await ev(s, RUN));
  if (process.env.QA_DISMISS) await ev(s, `(document.querySelector(${JSON.stringify(process.env.QA_DISMISS)})||{click(){}}).click();1`);
  const H = await ev(s, 'document.documentElement.scrollHeight');
  for (let y = 0; y < H; y += 700) { await scrollToY(s, y); await wait(120); }
  await scrollToY(s, 0); await wait(800);
  const after = JSON.parse(await ev(s, RUN));
  R[u + '@' + w] = { withBar, after };
  total += withBar.v.length + after.v.length;
  console.log(short(u), w, 'bar:', withBar.v.map(x => `${x.id}(${x.impact},${x.n})`).join(' ') || '-', '| after:', after.v.map(x => `${x.id}(${x.impact},${x.n})`).join(' ') || '-');
}
writeFileSync(outFile, JSON.stringify(R, null, 1));
proc.kill(); process.exit(total ? 1 : 0);

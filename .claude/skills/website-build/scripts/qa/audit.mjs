// Per page x per width: horizontal overflow (leaf elements past the viewport + document wider than
// the window), broken images, JS exceptions / console errors. Exit 1 if anything is found.
//   node audit.mjs <dir | https://base> [out.json]
//   QA_WIDTHS=1440x900,1024x768,768x1024,390x844,360x780,320x700 node audit.mjs ./site
// Lazy images are only flagged once they have actually failed (the original harness flagged unloaded
// lazy images as broken - 9 false positives on one page). QA_SCROLL=1 scrolls each page to the bottom
// first so lazy images and reveal-on-scroll content load.
import { launch, connect, goto, ev, consoleErrors, listPages, widths, short, scrollToY, wait } from './cdp.mjs';
import { writeFileSync } from 'node:fs';

const [target, outFile] = process.argv.slice(2);
if (!target) { console.error('usage: node audit.mjs <dir|url> [out.json]'); process.exit(2); }
const pages = await listPages(target);
const W = widths();

// vw comes from Node: with mobile emulation a too-wide page widens the layout viewport (innerWidth
// becomes e.g. 509 on a 390 device), so comparing against innerWidth would hide the overflow.
const PROBE = vw => `(() => {
  const vw = ${vw};
  const r = { overflow: [], img: [], docW: document.documentElement.scrollWidth, winW: vw };
  const sig = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
    (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.') : '');
  document.querySelectorAll('*').forEach(el => {
    const b = el.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) return;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') return;
    if (b.right > vw + 2 && el.children.length === 0 && b.width > 4) r.overflow.push(sig(el) + ' right=' + Math.round(b.right));
    // a lazy image that has not loaded yet is complete=false; flag it only once it has failed
    if (el.tagName === 'IMG' && (el.loading === 'lazy' ? (el.complete && el.naturalWidth === 0) : (!el.complete || el.naturalWidth === 0)))
      r.img.push(sig(el) + ' src=' + (el.getAttribute('src') || '').slice(0, 80));
  });
  return r;
})()`;

const { proc, wsUrl } = await launch(+(process.env.QA_PORT || 9333));
const s = await connect(wsUrl);
const report = {}; let bad = 0;
for (const u of pages) {
  report[u] = {};
  for (const [w, h, mobile] of W) {
    await goto(s, u, { width: w, height: h, mobile });
    if (process.env.QA_SCROLL) {
      const H = await ev(s, 'document.documentElement.scrollHeight');
      for (let y = 0; y < H; y += h) { await scrollToY(s, y); await wait(120); }
      await scrollToY(s, 0); await wait(500);
    }
    const probe = await ev(s, PROBE(w));
    const errs = consoleErrors(s);
    const issue = probe.overflow.length || probe.img.length || errs.length || probe.docW > probe.winW + 1;
    if (issue) bad++;
    report[u][w] = { ...probe, errs };
    console.log((issue ? 'FAIL ' : 'ok   ') + short(u) + ' @' + w +
      (issue ? ` overflow=${probe.overflow.length} docW=${probe.docW}/${probe.winW} img=${probe.img.length} errs=${errs.length}` : ''));
  }
}
if (outFile) writeFileSync(outFile, JSON.stringify(report, null, 1));
console.log(`\n${pages.length} pages x ${W.length} widths, ${bad} with issues`);
proc.kill(); process.exit(bad ? 1 : 0);

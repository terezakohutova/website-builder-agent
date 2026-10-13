// Per page x per width: horizontal overflow (elements past either viewport edge + document wider than
// the window), broken images, JS exceptions / console errors, and pages that fail to load.
//   node audit.mjs <dir | https://base> [out.json]
//   QA_WIDTHS=1440x900,1024x768,768x1024,390x844,360x780,320x700 node audit.mjs ./site
// Exit: 0 clean, 1 findings, 2 bad usage, 3 could not run.
// Overflow: any element (not only leaves) past the right edge, or partly past the left edge, is reported at
// the outermost element that sticks out. It only counts when no ancestor below <body> clips it
// (overflow hidden/clip/auto/scroll on a box that itself fits within both edges): a carousel track with off-screen slides is
// not a bug, a paragraph sticking out of the page is. The root is never treated as a clip: content cut off by
// `html{overflow-x:clip}` is still content the user cannot see.
// Lazy images are only flagged once they have actually failed (the original harness flagged unloaded
// lazy images as broken - 9 false positives on one page). QA_SCROLL=1 scrolls each page to the bottom
// first so lazy images and reveal-on-scroll content load.
// Console noise: /favicon.ico 404s are ignored; QA_IGNORE=<regex> drops other known messages.
import { main, open, visit, ev, consoleErrors, listPages, widths, short, scrollAndSettle, ignoreFilter, UsageError } from './cdp.mjs';
import { writeFileSync } from 'node:fs';

// vw comes from Node: with mobile emulation a too-wide page widens the layout viewport (innerWidth
// becomes e.g. 509 on a 390 device), so comparing against innerWidth would hide the overflow.
const PROBE = vw => `(() => {
  const vw = ${vw};
  const r = { overflow: [], clipped: 0, img: [], docW: document.documentElement.scrollWidth, winW: vw };
  const sig = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
    (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.') : '');
  const clippedBy = el => {
    for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const c = getComputedStyle(a);
      const ab = a.getBoundingClientRect();
      if (c.overflowX !== 'visible' && ab.right <= vw + 2 && ab.left >= -2) return a;
      if (c.position === 'fixed') return null;
    }
    return null;
  };
  // past the right edge, or partly past the left edge (an element wholly left of the screen is the usual
  // visually-hidden pattern, e.g. a skip link at left:-9999px, and cannot be scrolled to anyway)
  const sticksOut = b => b.width > 4 && (b.right > vw + 2 || (b.left < -2 && b.right > 0));
  const out = new Set();
  document.querySelectorAll('body *').forEach(el => {
    const b = el.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) return;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') return;
    // every element, not only leaves (a paragraph with a link sticks out too); reported once, at the
    // outermost element that sticks out, so a wide wrapper is one finding and not one per descendant
    if (sticksOut(b)) {
      out.add(el);
      if (!out.has(el.parentElement)) {
        const edge = b.right > vw + 2 ? ' right=' + Math.round(b.right) : ' left=' + Math.round(b.left);
        if (clippedBy(el)) r.clipped++; else r.overflow.push(sig(el) + edge);
      }
    }
    // a lazy image that has not loaded yet is complete=false; flag it only once it has failed
    if (el.tagName === 'IMG' && (el.loading === 'lazy' ? (el.complete && el.naturalWidth === 0) : (!el.complete || el.naturalWidth === 0)))
      r.img.push(sig(el) + ' src=' + (el.getAttribute('src') || '').slice(0, 80));
  });
  return r;
})()`;

main(async () => {
  const [target, outFile] = process.argv.slice(2);
  if (!target) throw new UsageError('node audit.mjs <dir|url> [out.json]');
  const W = widths();
  const keep = ignoreFilter();
  const pages = await listPages(target);
  const { s } = await open();
  const report = {}; let bad = 0;
  for (const u of pages) {
    report[u] = {};
    for (const [w, h, mobile] of W) {
      const nav = await visit(s, u, { width: w, height: h, mobile });
      if (!nav.ok) {
        bad++; report[u][w] = { error: nav.error };
        console.log(`FAIL ${short(u)} @${w} ${nav.error}`); continue;
      }
      if (process.env.QA_SCROLL) {
        const H = await ev(s, 'document.documentElement.scrollHeight');
        for (let y = 0; y < H; y += h) await scrollAndSettle(s, y, { idle: 800 });
        await scrollAndSettle(s, 0);
      }
      const probe = await ev(s, PROBE(w));
      const errs = keep(consoleErrors(s));
      const issue = probe.overflow.length || probe.img.length || errs.length || probe.docW > probe.winW + 1;
      if (issue) bad++;
      report[u][w] = { ...probe, errs };
      console.log((issue ? 'FAIL ' : 'ok   ') + short(u) + ' @' + w +
        (issue ? ` overflow=${probe.overflow.length} docW=${probe.docW}/${probe.winW} img=${probe.img.length} errs=${errs.length}` : '') +
        (probe.clipped ? ` (${probe.clipped} clipped by an overflow container, not counted)` : ''));
      for (const e of errs.slice(0, 3)) if (issue) console.log('     ' + e.slice(0, 200));
    }
  }
  if (outFile) writeFileSync(outFile, JSON.stringify(report, null, 1));
  console.log(`\n${pages.length} pages x ${W.length} widths, ${bad} with issues`);
  return bad;
});

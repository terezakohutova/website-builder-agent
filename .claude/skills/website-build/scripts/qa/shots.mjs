// Scroll-tiled screenshots: one PNG per ~92 % of a viewport, top to bottom, per page per width.
// Tiles (not one full-page capture) because fixed bars, sticky rails, reveal-on-scroll and lazy
// images only render correctly at the scroll position a user actually sees.
//   node shots.mjs <dir|url> <outDir> [maxTiles=26]      (widths from QA_WIDTHS)
//   QA_HIDE=".cookie-bar,#consent" hides overlays before shooting.
// Each tile is taken after the scroll position has settled and lazy requests have gone quiet.
// Exit: 0 done, 1 a page failed to load (look at the screenshots yourself), 2 bad usage, 3 could not run.
import { main, open, visit, ev, shot, listPages, widths, short, slug, scrollAndSettle, UsageError } from './cdp.mjs';

main(async () => {
  const [target, out, max = '26'] = process.argv.slice(2);
  if (!target || !out || !/^\d+$/.test(max)) throw new UsageError('node shots.mjs <dir|url> <outDir> [maxTiles]');
  const W = widths();
  const pages = await listPages(target);
  const { s } = await open(9340);
  let failed = 0;
  for (const u of pages) for (const [w, h, mobile] of W) {
    const nav = await visit(s, u, { width: w, height: h, mobile });
    if (!nav.ok) { failed++; console.log(`FAIL ${short(u)} ${w} ${nav.error}`); continue; }
    if (process.env.QA_HIDE) await ev(s, `document.querySelectorAll(${JSON.stringify(process.env.QA_HIDE)}).forEach(e=>e.style.setProperty('display','none','important'));1`);
    const H = await ev(s, 'document.documentElement.scrollHeight');
    const step = Math.round(h * 0.92);
    let i = 0;
    for (let y = 0; y < H && i < +max; y += step, i++) {
      await scrollAndSettle(s, y);
      await shot(s, `${out}/${slug(u)}.${w}.${String(i).padStart(2, '0')}.png`);
    }
    console.log(short(u), w, 'height', H, 'tiles', i);
  }
  return failed;
});

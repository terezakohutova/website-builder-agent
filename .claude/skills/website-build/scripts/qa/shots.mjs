// Scroll-tiled screenshots: one PNG per ~92 % of a viewport, top to bottom, per page per width.
// Tiles (not one full-page capture) because fixed bars, sticky rails, reveal-on-scroll and lazy
// images only render correctly at the scroll position a user actually sees.
//   node shots.mjs <dir|url> <outDir> [maxTiles=26]      (widths from QA_WIDTHS)
//   QA_HIDE=".cookie-bar,#consent" hides overlays before shooting.
// Smooth-scroll aware (uses scrollToY from cdp.mjs).
import { launch, connect, goto, ev, shot, listPages, widths, short, scrollToY, wait } from './cdp.mjs';

const [target, out, max = '26'] = process.argv.slice(2);
if (!target || !out) { console.error('usage: node shots.mjs <dir|url> <outDir> [maxTiles]'); process.exit(2); }
const pages = await listPages(target);
const { proc, wsUrl } = await launch(+(process.env.QA_PORT || 9340)); const s = await connect(wsUrl);
for (const u of pages) for (const [w, h, mobile] of widths()) {
  await goto(s, u, { width: w, height: h, mobile, settle: 1500 });
  if (process.env.QA_HIDE) await ev(s, `document.querySelectorAll(${JSON.stringify(process.env.QA_HIDE)}).forEach(e=>e.style.setProperty('display','none','important'));1`);
  const H = await ev(s, 'document.documentElement.scrollHeight');
  const step = Math.round(h * 0.92);
  const name = short(u).replace(/[\\/:?#&=]+/g, '_').replace(/^_/, '') || 'index';
  let i = 0;
  for (let y = 0; y < H && i < +max; y += step, i++) {
    await scrollToY(s, y); await wait(650);
    await shot(s, `${out}/${name}.${w}.${String(i).padStart(2, '0')}.png`);
  }
  console.log(short(u), w, 'height', H, 'tiles', i);
}
proc.kill(); process.exit(0);

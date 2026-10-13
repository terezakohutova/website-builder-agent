// Mode matrix screenshots + state per page:
//   forcedark  Chrome's automatic dark mode (what Android Chrome / Samsung Internet "dark web pages"
//              do to a light-only site) + prefers-color-scheme: dark
//   dark       prefers-color-scheme: dark only (does the site's own dark theme / color-scheme hold?)
//   reduced    prefers-reduced-motion: reduce (are animations and smooth scroll off?)
//   node modes.mjs <dir|url> <outDir> [forcedark|dark|reduced] [width=390]
// Shoots y = 0, 1 and 2 viewports down. QA_HIDE=selectors hides overlays (cookie bar) first.
import { launch, connect, goto, ev, shot, emulateMedia, listPages, short, scrollToY, wait, J } from './cdp.mjs';

const [target, out, mode = 'forcedark', W = '390'] = process.argv.slice(2);
if (!target || !out) { console.error('usage: node modes.mjs <dir|url> <outDir> [forcedark|dark|reduced] [width]'); process.exit(2); }
const w = +W, h = w < 600 ? 844 : 900, mobile = w < 600;
const args = mode === 'forcedark' ? ['--force-dark-mode', '--enable-features=WebContentsForceDark', '--blink-settings=forceDarkModeEnabled=true'] : [];
const feats = mode === 'reduced' ? [{ name: 'prefers-reduced-motion', value: 'reduce' }] : [{ name: 'prefers-color-scheme', value: 'dark' }];
const pages = await listPages(target);
const { proc, wsUrl } = await launch(+(process.env.QA_PORT || 9391), { args }); const s = await connect(wsUrl);
for (const u of pages) {
  await emulateMedia(s, feats);
  await goto(s, u, { width: w, height: h, mobile, settle: 1500 });
  await emulateMedia(s, feats);   // re-apply after navigation, some Chrome builds reset it
  if (process.env.QA_HIDE) await ev(s, `document.querySelectorAll(${JSON.stringify(process.env.QA_HIDE)}).forEach(e=>e.remove());1`);
  const st = await J(s, `({colorScheme:getComputedStyle(document.documentElement).colorScheme,bodyBg:getComputedStyle(document.body).backgroundColor,
    lenis:!!(window.__lenis||window.lenis),runningAnimations:document.getAnimations().filter(a=>a.playState==='running').length,
    scrollBehavior:getComputedStyle(document.documentElement).scrollBehavior})`);
  console.log(short(u), mode, JSON.stringify(st));
  const name = short(u).replace(/[\\/:?#&=]+/g, '_').replace(/^_/, '') || 'index';
  for (const k of [0, 1, 2]) { await scrollToY(s, k * h); await wait(600); await shot(s, `${out}/${name}.${mode}.${w}.${k}.png`); }
}
proc.kill(); process.exit(0);

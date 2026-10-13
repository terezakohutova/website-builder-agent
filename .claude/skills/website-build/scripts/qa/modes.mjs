// Mode matrix screenshots + state per page:
//   forcedark  Chrome's automatic dark mode (what Android Chrome / Samsung Internet "dark web pages"
//              do to a light-only site) + prefers-color-scheme: dark
//   dark       prefers-color-scheme: dark only (does the site's own dark theme / color-scheme hold?)
//   reduced    prefers-reduced-motion: reduce (are animations and smooth scroll off?)
//   node modes.mjs <dir|url> <outDir> [forcedark|dark|reduced] [width=390]
// Shoots y = 0, 1 and 2 viewports down. QA_HIDE=selectors hides overlays (cookie bar) first.
// Exit: 0 done, 1 a page failed to load (the screenshots are for you to look at, not judged here),
// 2 bad usage, 3 could not run.
import { main, open, visit, ev, shot, emulateMedia, listPages, short, slug, scrollAndSettle, J, UsageError, isMobile, defaultHeight } from './cdp.mjs';

main(async () => {
  const [target, out, mode = 'forcedark', W = '390'] = process.argv.slice(2);
  if (!target || !out || !['forcedark', 'dark', 'reduced'].includes(mode) || !/^\d+$/.test(W)) throw new UsageError('node modes.mjs <dir|url> <outDir> [forcedark|dark|reduced] [width]');
  const w = +W, h = defaultHeight(w), mobile = isMobile(w);
  const args = mode === 'forcedark' ? ['--force-dark-mode', '--enable-features=WebContentsForceDark', '--blink-settings=forceDarkModeEnabled=true'] : [];
  const feats = mode === 'reduced' ? [{ name: 'prefers-reduced-motion', value: 'reduce' }] : [{ name: 'prefers-color-scheme', value: 'dark' }];
  const pages = await listPages(target);
  const { s } = await open({ args });
  let failed = 0;
  for (const u of pages) {
    await emulateMedia(s, feats);
    const nav = await visit(s, u, { width: w, height: h, mobile });
    if (!nav.ok) { failed++; console.log(`FAIL ${short(u)} ${nav.error}`); continue; }
    await emulateMedia(s, feats);   // re-apply after navigation, some Chrome builds reset it
    if (process.env.QA_HIDE) await ev(s, `document.querySelectorAll(${JSON.stringify(process.env.QA_HIDE)}).forEach(e=>e.remove());1`);
    const st = await J(s, `({colorScheme:getComputedStyle(document.documentElement).colorScheme,bodyBg:getComputedStyle(document.body).backgroundColor,
      lenis:!!(window.__lenis||window.lenis),runningAnimations:document.getAnimations().filter(a=>a.playState==='running').length,
      scrollBehavior:getComputedStyle(document.documentElement).scrollBehavior})`);
    console.log(short(u), mode, JSON.stringify(st));
    for (const k of [0, 1, 2]) { await scrollAndSettle(s, k * h); await shot(s, `${out}/${slug(u)}.${mode}.${w}.${k}.png`); }
  }
  return failed;
});

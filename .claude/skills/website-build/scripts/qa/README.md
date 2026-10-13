# Generic browser QA harness (raw CDP, no npm install)

Cleaned, parameterised copy of the QA harness used on a real production marketing site. Headless Chrome
driven over the Chrome DevTools Protocol with Node's global `WebSocket` (Node 22+). It exists because, in the
real build, the browser extension and the Playwright MCP both failed to connect; it needs nothing installed
except Chrome (`axe.mjs` also needs `axe-core`, `inapp.mjs` needs Playwright).
Background and lessons: `../../references/04-qa-devices-modes.md`.

## Targets

Every script takes a **target** (there is no default site - pass one):
- a **local folder**: pages = its `*.html` (not `_*`, not `*.bak*`), loaded as `file:///...`. Fine for a static
  build folder. For clean URLs, rewrites or absolute `/assets/...` paths, serve it instead
  (`python -m http.server 8080 --bind 127.0.0.1` from the parent dir) and pass the URL.
- a **base URL** (`https://www.example.com` or `http://127.0.0.1:8080`): pages = every `<loc>` in `/sitemap.xml`,
  or just the base if there is none.

Common env:
| var | default | meaning |
|---|---|---|
| `QA_WIDTHS` | `1440x900,390x844` | comma list `WxH`; width < 600 = mobile emulation + touch |
| `QA_PAGES` | all | comma list of substrings; keep only matching URLs |
| `QA_PORT` | per script | debugging port; give parallel runs different ports |
| `CHROME_PATH` | auto | Chrome binary |

Site-specific selectors are always env params (your site's class names go here):
| var | used by | example |
|---|---|---|
| `QA_COOKIE_BAR` | `inapp.mjs` | `.cookie-bar` (default) |
| `QA_ACCEPT` | `console-sweep.mjs`, `inapp.mjs` | `.cookie-accept` (inapp default: first button in the bar) |
| `QA_DISMISS` | `axe.mjs` | `.cookie-necessary` |
| `QA_HIDE` | `shots.mjs`, `modes.mjs` | `.cookie-bar,#consent` |
| `QA_BURGER` / `QA_MENU` | `anchors.mjs`, `inapp.mjs` | `.menu-toggle` / `.site-menu` |
| `QA_BADGE`, `QA_HERO` | `inapp.mjs` | `.store-badge`, `.hero` |
| `QA_WATCH` | `wheel.mjs` | JS expression, e.g. `document.querySelector('.nav').classList.contains('is-hidden')` |

Suggested full width set: `1440x900,1280x800,1024x768,768x1024,430x932,390x844,360x780,320x700`.

## Scripts

| script | what | exit 1 when |
|---|---|---|
| `cdp.mjs` | the library: `launch`, `connect`, `goto`, `ev`/`J`, `shot`, `scrollToY` (smooth-scroll aware), `wheel`, `clickAt`, `key`, `emulateMedia`, `consoleErrors`, `collectIssues`, `listPages`, `widths` | - |
| `audit.mjs <target> [out.json]` | per page x width: leaf elements past the viewport, document wider than the device, broken images, JS exceptions / console errors. `QA_SCROLL=1` scrolls through first | any finding |
| `content.mjs <target> text <outDir>` | visible-copy dump per page (`TAG :: text`) - read it, it finds what screenshots hide | - |
| `content.mjs <target> struct` | headings whose box has no body copy | - |
| `content.mjs <target> heads - [width]` | headings wrapping into more lines than needed (`window.__QA_HEAD_SKIP` = selectors to skip) | - |
| `shots.mjs <target> <outDir> [maxTiles]` | scroll-tiled screenshots (92 % viewport steps), `QA_HIDE=` selectors to hide (cookie bar) | - |
| `anchors.mjs <target> [width]` | clicks every `a[href^="#"]` from mid-page (and from the menu with `QA_BURGER`/`QA_MENU`), target top must land in [-5, `QA_ANCHOR_MAX`=200] | a miss |
| `wheel.mjs <target> [width]` | real wheel bursts down/up, prints `scrollY` + `QA_WATCH` expression (e.g. nav hidden class) | - |
| `modes.mjs <target> <outDir> forcedark\|dark\|reduced [width]` | Chrome forced dark (Android auto-dark), `prefers-color-scheme: dark`, `prefers-reduced-motion`; prints color-scheme, running animations, smooth-scroll present; 3 shots | - |
| `console-sweep.mjs <url> [out.json]` | live/preview: every sitemap URL x widths, cookies cleared, scrolled; exceptions, console error/warn, CSP report-only, failed requests, HTTP >= 400; then after `QA_ACCEPT` click on `QA_POST` URLs. `QA_IGNORE=` regex | - |
| `axe.mjs <target> [out.json]` | axe-core (wcag2a/aa, 21, 22aa, best-practice) with the consent bar open and after `QA_DISMISS` + scroll-through. Needs `AXE_PATH=.../axe-core/axe.min.js` | any violation |
| `jscheck.mjs <dir>` | `node --check` on every inline `<script>` + control-character scan (the `\x01` trap) | any failure |
| `inapp.mjs <url> [outDir]` | WebKit + social in-app browser emulation (see below) | - |
| `probe-*.js` | in-page probes injected by `content.mjs` (text, structure, heading wrap) | - |

## Examples

```bash
Q=.claude/skills/website-build/scripts/qa
node $Q/jscheck.mjs site/dist
QA_WIDTHS=1440x900,768x1024,390x844,360x780,320x700 node $Q/audit.mjs site/dist qa-audit.json
node $Q/content.mjs site/dist text qa-text && node $Q/content.mjs site/dist struct
QA_HIDE=".cookie-bar" node $Q/shots.mjs http://127.0.0.1:8080 qa-shots 12
QA_BURGER=".menu-toggle" QA_MENU=".site-menu" node $Q/anchors.mjs http://127.0.0.1:8080 390
node $Q/modes.mjs https://www.example.com qa-modes forcedark 390
QA_ACCEPT=".cookie-accept" QA_POST="/$|/(de|fr|en)$" node $Q/console-sweep.mjs https://www.example.com
```

## Known limits (learned the hard way)

- Headless Chrome is Blink only. It is **not** iOS Safari / WebKit, not an in-app browser (Instagram, Facebook,
  TikTok), not a real GPU or a real touchscreen. A UA override changes what the page's JS sees, not the engine.
- `Input.synthesizeScrollGesture` with touch did not move the page at all in headless (0 px, every page);
  use `Input.dispatchTouchEvent` start/move/end sequences instead.
- `file://` refuses `fetch`, service workers and absolute `/` paths; serve over http for anything beyond static pages.
- Synthetic `el.click()` skips hit-testing; use `clickAt` (real mouse events) to catch overlays covering buttons.
- Chrome blocks `mailto:` without a user gesture; a `[log] Not allowed to launch 'mailto:...'` from a scripted
  click is the harness, not the site.
- Throttle live runs (one load at a time, >= 1.5 s apart) - it is someone's production site and its analytics.

## inapp.mjs (WebKit + social in-app browsers, Playwright)

Not raw CDP: needs `npm i playwright` somewhere and `npx playwright install webkit chromium`. Point `PW` at that
install's `playwright/index.mjs`. Emulates iOS Safari, iOS Instagram/Facebook/TikTok, iPhone landscape, iPad, Mac
Safari and Android Instagram/Facebook/TikTok (UA, viewport, dark mode for TikTok) and reports overflow, JS/console
errors, 4xx/5xx, broken images, cookie bar + accept, store badges per OS, menu, scroll, plus screenshots.

```bash
MSYS_NO_PATHCONV=1 PW=.../playwright/index.mjs PAGES=/,/de CTX=ios-instagram \
  QA_COOKIE_BAR=".cookie-bar" QA_BURGER=".menu-toggle" node inapp.mjs https://www.example.com out
```

In Git Bash on Windows, `MSYS_NO_PATHCONV=1` stops `/` being turned into `C:/Program Files/Git/`. Headless WebKit
on Windows is very slow: treat click timeouts as flakes until reproduced with a long timeout. `QA_LOCALE`
(default `en-US`) sets the browser locale.

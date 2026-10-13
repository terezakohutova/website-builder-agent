# Generic browser QA harness (raw CDP, no npm install)

Cleaned, parameterised copy of the QA harness used on a real production marketing site. Headless Chrome
driven over the Chrome DevTools Protocol with Node's global `WebSocket` (Node 22+). It exists because, in the
real build, the browser extension and the Playwright MCP both failed to connect; it needs nothing installed
except Chrome (`axe.mjs` also needs `axe-core`, `inapp.mjs` needs Playwright).
Background and lessons: `../../references/04-qa-devices-modes.md`.

## Exit codes (every script)

| code | meaning |
|---|---|
| 0 | clean (or, for `shots`/`modes`, every page loaded and its files were written) |
| 1 | findings: the "exit 1 when" column below, always including a page that failed to load |
| 2 | bad usage: missing or malformed arguments or env (`QA_WIDTHS`, `QA_IGNORE`, `CTX`...), checked before any browser starts |
| 3 | could not run: Chrome did not start, the CDP socket closed, a dependency (`axe-core`, Playwright) is missing, an internal error |

`backup/snapshot.py` and `examples/build-chain/build.py` follow the same contract.

## Targets

Every script takes a **target** (there is no default site - pass one). A recorded run against the fictional
sample site is in [`examples/sample-qa-report/`](../../../../../examples/sample-qa-report/README.md).
- a **local folder** (relative or absolute): pages = every `*.html` below it, recursively (folders starting
  with `_` or `.` and `node_modules` are skipped, as are `_*.html` and `*.bak*` files), loaded as
  `file:///...`. Fine for a static build folder. For clean URLs, rewrites or absolute `/assets/...` paths,
  serve it instead (`python -m http.server 8080 --bind 127.0.0.1` from the folder) and pass the URL.
- a **base URL** (`https://www.example.com` or `http://127.0.0.1:8080`): pages = every `<loc>` in
  `/sitemap.xml` (sitemap index files are followed), or just the base if there is none. Sitemap URLs are
  **rebased onto the base you passed**: a preview that serves the production sitemap is still audited on the
  preview. `QA_SITEMAP_ABSOLUTE=1` keeps them as written.

Page loads: `goto` waits for the load event, web fonts and network idle (no request for 500 ms, capped at
`QA_IDLE_CAP`), then two animation frames. A page **fails** (counted as a finding) when navigation errors
(DNS, refused, missing file), when the page itself answers HTTP >= 400, or when the load event does not fire
within `QA_LOAD_TIMEOUT`. Scroll steps wait until `scrollY` stops changing instead of sleeping.

Common env:
| var | default | meaning |
|---|---|---|
| `QA_WIDTHS` | `1440x900,390x844` | comma list `WxH`; width < 600 = mobile emulation + touch |
| `QA_PAGES` | all | comma list of substrings; keep only matching URLs |
| `QA_IGNORE` | - | regex; matching console/network messages are not findings (`/favicon.ico` is always ignored) |
| `QA_LOAD_TIMEOUT` | `30000` | ms until a page without a load event fails |
| `QA_IDLE_CAP` | `3000` | ms cap on the network-idle wait after load |
| `QA_CMD_TIMEOUT` | `30000` | ms until a single CDP command fails (exit 3) |
| `QA_SITEMAP_ABSOLUTE` | - | `1` = do not rebase sitemap URLs |
| `QA_PORT` | per script | debugging port; give parallel runs different ports |
| `CHROME_PATH` | auto | Chrome binary |
| `CHROME_ARGS` | - | extra Chrome flags, space-separated (e.g. `--no-sandbox` on Linux CI runners that need it) |

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
| `cdp.mjs` | the library: `launch`/`connect`/`open`, `goto`/`visit`, `ev`/`J`, `shot`, `scrollToY`/`scrollAndSettle`/`scrollSettle`, `networkIdle`, `wheel`, `clickAt`, `key`, `emulateMedia`, `consoleErrors`, `collectIssues`, `ignoreFilter`, `listPages`, `widths`, `main` (exit-code contract). Commands time out, a closed socket fails every pending call, only the events the checks read are kept (trimmed, capped at 5000), Chrome is killed on exit, Ctrl+C and SIGTERM | - |
| `audit.mjs <target> [out.json]` | per page x width: leaf elements past the viewport (unless a non-root ancestor with `overflow` other than `visible` clips them, e.g. a carousel track), document wider than the device, broken images, JS exceptions / console errors. `QA_SCROLL=1` scrolls through first | any finding |
| `content.mjs <target> text <outDir>` | visible-copy dump per page (`TAG :: text`) - read it, it finds what screenshots hide | a page fails to load |
| `content.mjs <target> struct` | headings whose box has no body copy | any row |
| `content.mjs <target> heads - [width]` | headings wrapping into more lines than needed (`-` fills the unused outDir slot; `window.__QA_HEAD_SKIP` = selectors to skip) | any row |
| `shots.mjs <target> <outDir> [maxTiles]` | scroll-tiled screenshots (92 % viewport steps), `QA_HIDE=` selectors to hide (cookie bar) | a page fails to load |
| `anchors.mjs <target> [width]` | clicks every `a[href^="#"]` from mid-page (and from the menu with `QA_BURGER`/`QA_MENU`), waits for the scroll to stop; the target top must land in [-5, `QA_ANCHOR_MAX`=200] and must not sit under another element (a fixed nav) | a miss or a covered target |
| `wheel.mjs <target> [width]` | real wheel bursts down/up, prints `scrollY` + `QA_WATCH` expression (e.g. nav hidden class) | JS errors, or a scrollable page the wheel did not move |
| `modes.mjs <target> <outDir> forcedark\|dark\|reduced [width]` | Chrome forced dark (Android auto-dark), `prefers-color-scheme: dark`, `prefers-reduced-motion`; prints color-scheme, running animations, smooth-scroll present; 3 shots | a page fails to load |
| `console-sweep.mjs <target> [out.json]` | live/preview: every page x widths, cookies cleared, scrolled; exceptions, console error/warn, CSP report-only, failed requests, HTTP >= 400; then after a `QA_ACCEPT` click on `QA_POST` URLs | any issue |
| `axe.mjs <target> [out.json]` | axe-core (wcag2a/aa, 21, 22aa, best-practice) with the consent bar open and after `QA_DISMISS` + scroll-through. Needs `AXE_PATH=.../axe-core/axe.min.js` (exit 3 without it) | any violation |
| `jscheck.mjs <dir>` | every inline `<script>` and `on*=` handler in every `*.html` below `<dir>` (recursive), parsed the way the browser does: attributes read by name (`data-src` is not `src`), classic scripts compiled as scripts (a top-level `return` fails; `node --check` on a `.js` file would accept it as CommonJS), `type="module"` as modules, handlers as function bodies; JSON-LD, templates and other data types skipped; plus a control-character scan (the `\x01` trap) | any failure |
| `inapp.mjs <url> [outDir]` | WebKit + social in-app browser emulation (see below) | any row flagged `CHECK` |
| `inapp-checks.mjs` | pure helpers for `inapp.mjs` (contexts, argument parsing, the verdict per row), unit-tested without a browser | - |
| `inapp-contexts.json` | devices, UA strings, viewport heights, dark mode per in-app context, with an `updated` date | - |
| `probe-*.js` | in-page probes injected by `content.mjs` (text, structure, heading wrap) | - |

## Examples

```bash
Q=.claude/skills/website-build/scripts/qa
node $Q/jscheck.mjs site/_dist
QA_WIDTHS=1440x900,768x1024,390x844,360x780,320x700 node $Q/audit.mjs site/_dist qa-audit.json
node $Q/content.mjs site/_dist text qa-text && node $Q/content.mjs site/_dist struct
QA_HIDE=".cookie-bar" node $Q/shots.mjs http://127.0.0.1:8080 qa-shots 12
QA_BURGER=".menu-toggle" QA_MENU=".site-menu" node $Q/anchors.mjs http://127.0.0.1:8080 390
node $Q/modes.mjs https://www.example.com qa-modes forcedark 390
QA_ACCEPT=".cookie-accept" QA_POST="/$|/(de|fr|en)$" QA_IGNORE="Duplicate Pixel" node $Q/console-sweep.mjs https://www.example.com
```

## Known limits (learned the hard way)

- Headless Chrome is Blink only. It is **not** iOS Safari / WebKit, not an in-app browser (Instagram, Facebook,
  TikTok), not a real GPU or a real touchscreen. A UA override changes what the page's JS sees, not the engine.
- `Input.synthesizeScrollGesture` with touch did not move the page at all in headless (0 px, every page);
  use `Input.dispatchTouchEvent` start/move/end sequences instead.
- `file://` refuses `fetch`, service workers and absolute `/` paths; serve over http for anything beyond static pages.
- Synthetic `el.click()` skips hit-testing; use `clickAt` (real mouse events) to catch overlays covering buttons.
  `anchors.mjs` still clicks synthetically: it tests where the target lands, not whether the link is reachable.
- With `html{scroll-behavior:smooth}` a plain `window.scrollTo` animates, so `scrollToY` passes
  `behavior:'instant'`. Before that fix every sample-site anchor test that started mid-page failed.
- Network idle is capped, not guaranteed: a page with a long-poll or an analytics beacon every 400 ms never
  goes idle and simply waits `QA_IDLE_CAP`.
- The overflow clip rule trusts `overflow` on ancestors below `<body>`. Content that is clipped there but
  should be reachable (a cut-off button inside an `overflow:hidden` card) is not reported; look at the shots.
- Chrome blocks `mailto:` without a user gesture; a `[log] Not allowed to launch 'mailto:...'` from a scripted
  click is the harness, not the site.
- Throttle live runs (one load at a time, >= 1.5 s apart) - it is someone's production site and its analytics.

## inapp.mjs (WebKit + social in-app browsers, Playwright)

Not raw CDP: needs `npm i playwright` somewhere and `npx playwright install webkit chromium`. Point `PW` at that
install's `playwright/index.mjs`. Emulates iOS Safari, iOS Instagram/Facebook/TikTok, iPhone landscape, iPad, Mac
Safari and Android Instagram/Facebook/TikTok (UA, viewport, dark mode for TikTok) and reports overflow, JS/console
errors, 4xx/5xx, broken images, cookie bar + accept, store badges per OS, menu, scroll, plus screenshots and
`results.json`.

```bash
MSYS_NO_PATHCONV=1 PW=.../playwright/index.mjs PAGES=/,/de CTX=ios-instagram \
  QA_COOKIE_BAR=".cookie-bar" QA_BURGER=".menu-toggle" node inapp.mjs https://www.example.com out
```

The UA strings live in [`inapp-contexts.json`](inapp-contexts.json) with the date they were last checked
(`updated`). App and OS versions in them drift every few weeks; refresh them from a real device at least every
six months. `inapp.mjs` warns when the date is older than 180 days.

In Git Bash on Windows, `MSYS_NO_PATHCONV=1` stops `/` being turned into `C:/Program Files/Git/`. Headless WebKit
on Windows is very slow: treat click timeouts as flakes until reproduced with a long timeout. `QA_LOCALE`
(default `en-US`) sets the browser locale; `QA_PACE` (default 1500 ms) the pause between pages.

The repository's tests cover `inapp.mjs` without Playwright: argument handling, exit 3 when Playwright is
missing, and the pure checks in `inapp-checks.mjs`. The Playwright part is not run in CI. It was run by hand
on 2026-10-13 (Playwright 1.49.1, Windows) with the Chromium contexts `android-instagram` and
`android-facebook` against the built sample site on a local server: clean pages exit 0, a 404 page exits 1.
That run found a false positive, since fixed: on the second page of a context the consent bar was already
hidden, and the script still tried to click its button. The WebKit contexts were not run in this repository.

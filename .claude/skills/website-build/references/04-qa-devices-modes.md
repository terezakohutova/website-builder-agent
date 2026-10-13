# 04 - QA: devices, widths, modes, browsers, webviews, a11y, adversarial and live checks

How to test a new marketing website before and after launch. Distilled from a real production build (a
multi-language static marketing site with smooth scrolling, a consent bar, app-store download links and an
in-app webview area), from first draft through go-live and the hotfix weeks after it.
Format: **rule** - why - how. SEO/GEO depth lives in another reference; here only the testing method.
The generic harness is in `../scripts/qa/` (usage in its README). Paths below: `qa/` = your QA script folder,
`build/passes/` = scripted review passes, `_dist/` = the build output (`site/_dist/` in the layout of reference 01).

---

## 0. The ten rules that matter most

1. **Measure, don't eyeball.** Settle every mobile/visual claim with a script that counts: overflow px, tap
   targets < 40 px, heading line counts, anchor landing top px, frame gaps. Eyeballed passes missed things the
   matrix caught every time.
2. **Run the full matrix, not a sample.** In the real build a nav auto-hide fix "worked" on a spot check and
   failed 18 of 24 page x width combinations; only a 12-page x 2-width OK/FAIL table caught it.
3. **A page that renders proves nothing.** One `\x01` control byte in an inline script killed an interactive
   feature on every page while everything looked fine. `node --check` every inline `<script>` and scan for
   control characters before every publish (`jscheck.mjs`).
4. **Test through the scroll library, not around it.** Smooth-scroll libraries (Lenis and similar) swallow
   `scrollTo`/`scrollIntoView` (scrollY stays 0). Drive real wheel events, or call the library's own
   `scrollTo(y, {immediate:true, force:true})`.
5. **Headless Chrome is not iOS Safari, not an in-app browser, not a real phone.** It covers Blink layout,
   JS errors, consent and links. Real-device review by stakeholders found what CDP could not: blurry
   screenshots on retina, browser auto-dark, carousel feel, legibility on 1x monitors.
6. **Every review round becomes an idempotent scripted pass** that fails the build if its target text is gone,
   and runs in every build. Never hand-fix the build output. See section 7.
7. **After any CSP / consent / redirect change, test the pages that need state** (tokens, cookies, query
   strings). In the real build an enforced CSP broke a token-in-URL webview page for almost a day because a
   token-less check never reached the API it calls.
8. **Live = someone's production + analytics.** Throttle (one load at a time, >= 1.5 s apart, <= 2.5 req/s),
   read-only, clear cookies per scenario, never submit real forms.
9. **axe-clean is not keyboard-clean.** axe reported 0 violations while the open mobile menu leaked Tab focus
   (19 stops outside it) and the page scrolled 596 px behind it. Test focus traps and scroll locks by script.
10. **Distrust the harness first** when something "does nothing": cross-origin preview iframes, `mailto:`
    without a user gesture, sandboxed `confirm()`, `requestAnimationFrame` in a background tab all fake site bugs.

---

## 1. The QA harness (raw CDP)

### Why raw CDP
- In the real build both the browser-extension automation and the Playwright MCP failed to connect. Node 22+
  has a global `WebSocket`, which is all a CDP client needs: zero npm installs, nothing to break.
- `cdp.mjs` (~200 lines): `launch(port)` spawns `chrome --headless=new --remote-debugging-port
  --user-data-dir=<tmp> --disable-gpu --hide-scrollbars --force-device-scale-factor=1
  --allow-file-access-from-files` and polls `/json/version`; `connect()` creates a target, attaches with
  `flatten:true`, enables Page/Runtime/Log/Network; `goto()` sets `Emulation.setDeviceMetricsOverride`, clears
  the event buffer, navigates, waits for `Page.loadEventFired` + a settle delay; `ev()` = `Runtime.evaluate
  {returnByValue, awaitPromise}`; `shot()`; `consoleErrors()` from `Log.entryAdded` (error),
  `Runtime.exceptionThrown` and `console.error`.
- Heavier tools (Puppeteer, Lighthouse, axe-core, Playwright for WebKit) were added only for specific audits;
  the core stayed raw CDP.
- **One debugging port per parallel process.** Two launches on one port attach to the same browser. A
  parallel "monkey" run uses `WORKERS=8` browsers on `PORT0+k`.
- **Fresh profile per run** (`mkdtempSync`) = clean cookies and localStorage. For consent scenarios also call
  `Network.clearBrowserCookies` + `Storage.clearDataForOrigin` between loads.
- Keep a real-Chrome automation tool for logged-in work elsewhere, not for site QA. Its traps: `file://`
  refused, preview pages rendered in a **cross-origin iframe** (synthetic clicks never reach the page),
  drifting screenshot coordinates, wedged tabs.

### Local vs preview vs live
- **Local folder** (`file:///.../_dist/<page>.html`): fast, but no clean URLs, rewrites, headers, CSP or
  absolute `/assets` paths.
- **Local server** for anything interactive: `python -m http.server <port> --bind 127.0.0.1` from the
  **parent** directory. On Windows a server whose cwd is inside `_dist/` locks it and the next clean build
  fails with "Device busy". A tiny HTTP/1.1 keep-alive + gzip server is closer to a real host for perf runs.
- **Preview deployment** (the host's preview URL or a side-branch share link) before production.
- **Live** after merge. QA again after every push to production; preview is not production (headers,
  redirects, caches and env vars differ).

### Script inventory (what to build; generic versions in `../scripts/qa/`)
| check | what it measures | widths |
|---|---|---|
| audit | leaf elements past viewport, broken images, console errors, document width | 1440x900, 390x844 |
| copy dump + text probe | visible copy per page (`TAG :: text`) - **reading it surfaced the content gaps** | 1440 |
| structure probe | h2-h4 whose box has no p/li/blockquote/table/dd (cards with title + icon, no copy) | 1440 |
| heading wrap | headings wrapping into more lines than the parent width needs | arg |
| line probe | orphans, short word at line end, sentence ending mid-line (typography QA) | 1440, 390 |
| tiled shots | scroll-tiled screenshots, step 92 % of viewport, capped tile count | arg |
| full-height sheet | one capture (clip = scrollHeight, `captureBeyondViewport`) for overview only | arg |
| nav wheel / nav matrix | real wheel bursts; nav hides on scroll down, returns on up; page x width OK/FAIL | 1440, 390 |
| anchors / hash landing | every `#` link from the page and from the open menu; direct hash landing at 300/1500/4000 ms | 390 |
| link check / QR check | download links per language and OS, QR images loaded and decodable | 1440 |
| errors / typography | exceptions with line numbers; typography script present, nbsp counts | 1440 |
| feature tests | interactive features: seed state, wait, click, assert end state | 1440 |
| dark shots | forced dark + `prefers-color-scheme: dark`, shots at fixed y offsets | 390 |
| UA rail | iOS vs Android UA + platform: only that OS's store badge shows | 390 |
| retina | DPR 2/3: which `srcset` candidate each image picked | 390x3, 1440x2 |
| go-live sweep | every page and every alias at both widths: final URL, CSS loaded, overflow, images, console, no tracker before consent, trackers after accept-all | 1440, 390 |
| monkey | clueless-user test (section 5) | 390, 1440 |
| tools sweep | axe-core + gremlins.js horde on every page of a deployment | both |
| cookie inventory | accept-all, list every cookie (domain, name, lifetime, SameSite, Secure) + localStorage keys, for the cookie table in the privacy page | 1440 |
| live console sweep | every sitemap URL x 2 widths before consent, scrolled; then accept-all on key pages | 1440, 390 |
| section gaps | visible gap between consecutive sections' content vs page median ("gaps look too big") | 1440, 390 |
| transition shots | small wheel steps, shoot 120 ms and 900 ms after each to catch half-finished cross-fades | 1440 |
| slide fit | scrollHeight vs clientHeight per slide at 1280x720..1920x1080 (for any deck-like pages) | 6 sizes |

### Harness techniques worth reusing
- **Smooth-scroll wheel trick**: `Input.dispatchMouseEvent {type:'mouseWheel', deltaY:200}` x N with 55-60 ms
  gaps, then wait ~850-900 ms for momentum before reading state. When a probe just needs a position:
  `window.__lenis.scrollTo(y,{immediate:true,force:true})` then `scrollTo(0,y)`. Expose your smooth-scroll
  instance on `window` on purpose so tests can reach it (`scrollToY` in `cdp.mjs` handles both).
- **Screenshot tiling**: scroll by 0.92 x viewport, wait ~650 ms (reveal animations), shoot the viewport. One
  full-page capture misrenders fixed bars, sticky rails, reveal-on-scroll and lazy images.
- **Heading-without-body probe**: for each h2-h4, walk up to its card/section box and check it contains body
  copy. Found two cards that had a title and icon but no text.
- **Heading wrap**: Range `getClientRects()` grouped by row top; flag rows > ceil(total width / parent x 0.97).
- **Per-character line probe**: a Range per character rebuilds each rendered line's text, so you can test
  orphans and line-end rules exactly as rendered.
- **Copy dump**: text nodes owned by each element, de-duplicated. Diff dumps between builds; grep them for
  figures and claims that must match the approved list.
- **Real clicks with overlay check**: centre the element, check `document.elementFromPoint(x,y)` is the
  element (or inside it), else record "covered by X"; then `mouseMoved/mousePressed/mouseReleased` at the
  centre. `el.click()` skips hit-testing, so overlays covering buttons go unnoticed.
- **Prove `preventDefault` without navigating**: add a second document `click` listener after the page's own,
  read `e.defaultPrevented`, then `preventDefault()` yourself.
- **Measure many files at once**: load them as same-origin iframes from one page and read all boxes in one
  evaluate (cross-origin -> `contentDocument` is null).
- **Seed state** via localStorage before reload (a counter one step from its reward, a stored consent object)
  instead of playing through.
- **CLS attribution**: `Page.addScriptToEvaluateOnNewDocument` with a `layout-shift` PerformanceObserver that
  stores value + source node names.
- **Scroll smoothness**: rAF sampler pushing `[t, scrollY]` plus a `long-animation-frame` observer with script
  attribution; compute frame-gap median/p95, frames > 33/50 ms, backwards steps, stalls, velocity jerks;
  compare smooth-scroll on vs destroyed (native).
- **Ablation for jank**: inject `*{filter:none!important}` / no `backdrop-filter` / `animation:none` / hide
  fixed elements, one variant at a time, and remeasure; CPU profile at 4x throttle for self-time per
  function. In the real build this found a `drop-shadow` filter on the hero image repainting every frame.
- **Overflow culprits**: resize without reload across 1440/1024/768/390/375/360/320 and list elements whose
  right edge > clientWidth; screenshot the offending band.
- **QR verification**: decode codes straight from the page (render SVG to PNG at ~520 px, then OpenCV
  `QRCodeDetector`). Proved a "placeholder, does not scan" warning was stale.

### The full page x width matrix
Every check runs over **all pages x all widths** and prints one OK/FAIL row per combination, exit 1 on any
FAIL. Store outputs per round (`qa/out/audit-<round>.json`) so a regression is a diff, not a memory.

---

## 2. Device / width / mode / engine matrix

### Widths
- **Default pair on every page, every round: 1440x900 desktop, 390x844 mobile** (`mobile:true`, DPR 1).
- **Mobile pass**: 360 / 390 / 430 on all pages. In the real build: ~190 loads, overflow driven to 0, tap
  targets < 40 px driven from 30-46 per page to 1.
- **Adversarial pass**: overflow by resize at 1440/1024/768/390/375/360/320, plus direct loads at 320.
- **Breakpoints**: test just above and just below every breakpoint, not only the default pair. The tablet band
  around the main breakpoint produced its own bug (a decorative badge blew up to full QR size).
- **1x monitors** (DPR 1 desktop): hero text-shadow and small light text on a saturated background read badly.
  Fix: no hero text-shadow; small copy on colour >= 15 px, white, weight 500.
- **Retina** (DPR 2-3): phone screenshots shown near their intrinsic width are soft. Ship `srcset` (e.g.
  540w/1170w) and verify by script which candidate actually loads.
- **Landscape phone**: easy to forget. In the real build the cookie dialog covered ~90 % of a 750x342 screen.

### Modes
| mode | how to test | what happened in the real build |
|---|---|---|
| Light only | default | site had no dark theme |
| Browser auto-dark (Android Chrome, Samsung Internet) | real phones, then Chrome forced dark (`--force-dark-mode --enable-features=WebContentsForceDark --blink-settings=forceDarkModeEnabled=true`) | auto-dark darkened the page but **not the screenshots inside phone mockups** - looked broken. Opt out with `color-scheme: only light`; re-verify forced dark; assert computed `color-scheme` = `light only` |
| `prefers-color-scheme: dark` | `Emulation.setEmulatedMedia` (re-apply after every navigate) | stays light (intended) |
| `prefers-reduced-motion: reduce` | emulated media | smooth-scroll not started, 0 running animations; reduced-motion blocks for nav, logo, menu, `scroll-behavior` |
| Keyboard only | first Tab stop, focus outline, menu trap | first stop = logo with visible outline; **open menu leaked focus** -> focus trap added |
| Touch vs fine pointer | `Emulation.setTouchEmulationEnabled`, `matchMedia('(pointer:coarse)')` | smooth-scroll only for fine pointers; on touch it only added non-passive listeners |
| CPU 4x throttle | `Emulation.setCPUThrottlingRate {rate:4}` | mobile TBT ~430 ms; tag manager/marketing scripts deferred to first interaction or 4 s |
| Slow 4G | 150 ms RTT, 1.6 Mbps / 750 kbps, CPU 4x, DPR 2 | LCP fine, but **homepage CLS 0.6 in 6 of 20 loads** - intermittent, so repeat runs matter |
| Background tab | found by accident | `requestAnimationFrame` never fires in a hidden tab -> a reveal never happened; add a `setTimeout` fallback for anything gated on rAF |

### Browsers / engines / user agents
- **Chromium** is what the raw-CDP harness automates.
- **UA overrides** exercise UA-dependent JS, not the engine: iOS Safari, Android Chrome, Windows Chrome, macOS
  Safari. Verify download links per OS and language (attribution link parameters, desktop fallback URLs) and
  the store badge shown per OS.
- **WebKit** via Playwright (`inapp.mjs`), see below. Still not a substitute for a real iPhone.
- **Firefox**: easy to skip; at least one Gecko pass before launch is cheap with Playwright.
- **Samsung Internet**: only reachable on real devices (it is where auto-dark showed up).

### WebKit + social in-app browser emulation (`inapp.mjs`)
Ads land in Instagram, Facebook and TikTok in-app browsers, not in Safari or Chrome. Emulate them with
Playwright: WebKit for iOS contexts, Chromium for Android (`; wv` webview UA), the app's UA string, a shorter
viewport (the app's chrome eats height) and dark mode where the app forces it. Contexts: iOS Safari, iOS
Instagram/Facebook/TikTok, iPhone landscape, iPad, Mac Safari, Android Instagram/Facebook/TikTok. Report
overflow, JS errors, 4xx/5xx, broken images, cookie bar + accept, one store badge per OS, menu opens, scroll
works, screenshots. Generic lessons from the real run:
- **Meta pixel in Android Facebook/Instagram in-app browsers fetches `properties://browser/clickID`** (the
  pixel's in-app click-ID handoff). A strict CSP `connect-src` blocks it and logs a console error on every
  page after consent. Fix: allow the `properties:` scheme in `connect-src`. Lesson: **test the CSP in the
  in-app browsers your ads land in**, not only in plain Chrome.
- **Headless WebKit on Windows is not a performance oracle.** It ran a trivial page at ~31 fps and a rich
  homepage at ~2 fps (Chromium 60/60); taps took up to 7.5 s, so 3 s click timeouts flake. Use generous
  timeouts, treat timeouts as flakes until reproduced, and judge iOS smoothness on a real iPhone.
- **Classic scrollbar artifact**: headless WebKit draws a ~12 px classic scrollbar (iOS overlays it). A "gap"
  on the right edge of full-bleed sections in WebKit screenshots is that, not a layout bug.
- Not covered by emulation: each app's own chrome, how it opens store/attribution links, LinkedIn's in-app
  browser. Do one real-device pass from a story/DM link before a big paid push.

### App webviews and token-in-URL pages
If the site also serves pages a mobile app opens in a webview (account pages, legal pages, activity views),
treat them as their own test surface:
- Keep a list of every such path and compare old vs new deployment responses byte-for-byte when you migrate.
- Legal text shown both on the web and in the app should come from one source and be diffed word-for-word.
- **CSP testing of stateful pages**: a page that calls an API only when the URL carries a token looks fine
  without one. Get a real test token, load the page with it, and watch the console and network for CSP
  violations after every CSP change. Roll out CSP as report-only first, sweep, then enforce.
- Store-review and attribution fallback paths served as rewrites must return 200 and fix their own URL
  (`history.replaceState`). Test every alias, not just the canonical pages.

---

## 3. Accessibility

- Run axe-core (wcag2a/aa, wcag21a/aa, wcag22aa, best-practice) twice per page: with the consent bar open, and
  after dismissing it and scrolling through so reveal-on-scroll content is in the tree (`axe.mjs`).
- **axe-clean is not keyboard-clean.** Script these separately:
  - **Focus trap**: open the menu/dialog, press Tab N times, count focus stops outside it (must be 0); Shift+Tab
    wraps; Escape closes and returns focus to the toggle.
  - **Scroll lock**: with the menu open, dispatch wheel/touch and assert `scrollY` did not move.
  - First Tab stop is a skip link or the logo, with a visible focus outline on every focusable element.
  - Tap targets >= 40 px on mobile (count them, don't eyeball).
- Contrast of small text over images/gradients: axe often cannot compute it - check those spots by hand.
- `lang` attribute per language version; language switch links carry `hreflang`.

---

## 4. Consent scenario tests

Run each scenario in a **fresh profile or after clearing cookies and storage**:
1. **No interaction**: no marketing/analytics requests, no tracker cookies, nothing in storage beyond strictly
   necessary. Scroll the page fully - some tags fire on scroll.
2. **Reject / necessary only**: same as above after the click, and on the next page load.
3. **Accept all**: trackers load; list every cookie (domain, name, lifetime, SameSite, Secure) for the cookie
   table; consent mode signals update.
4. **Custom**: each category alone.
5. **Withdraw**: re-open settings, revoke, reload - tracker cookies are deleted, no new requests.
6. **Persistence**: choice survives navigation and language switch; consent version bump re-asks.
Also: the consent bar never covers the primary CTA in landscape and at 320 px; it is reachable by keyboard.

---

## 5. Links, anchors, language switch, redirects

- **Anchors** (`anchors.mjs`): every `#` link from mid-page and from the open menu lands with its target top
  in [-5, ~200] px (fixed nav must not cover it). Also load each `page#hash` directly and check at 300 / 1500 /
  4000 ms - late layout (fonts, images) pushes targets away.
- **Language switch**: from every page in every language the switcher goes to the same page in the target
  language (not the homepage), keeps the hash where sensible, and no switcher link 404s.
- **Redirects and aliases**: every old URL, short link and alias resolves in one hop to the right final URL
  with the right status (301 vs 200 rewrite as intended); trailing slash and case variants behave.
- **Download / store links** per OS and language; QR codes decode to the intended URL.
- **External links**: status check (throttled), `rel="noopener"` on `target=_blank`.
- **Well-known files** (`/robots.txt`, `/sitemap.xml`, `/.well-known/*`, app association files) return the
  right content type, not an HTML fallback from a catch-all route.

## 5b. The clueless-user (monkey) test
Several parallel browsers each act like a distracted visitor: random scrolls, back/forward, double taps,
resizes, menu open/close mid-scroll, clicking whatever is under the finger (real clicks with the overlay
check). Record every exception, every "covered by X", and every state where the page cannot scroll. Add a
gremlins.js horde per page for raw event noise.

---

## 6. Copy and language checks

- Read the **copy dump**, not the screenshots. It shows empty cards, leftover placeholder text, duplicated
  paragraphs and untranslated strings at a glance.
- Grep every language version for figures and claims; they must match one approved list.
- Spell/grammar check per language with proper tools (Hunspell + LanguageTool, or a language-specific checker).
- Typography rules (non-breaking spaces after short words, no single-letter orphans, no sentence ending
  mid-line) are checked by the per-character line probe at both widths, not by eye.
- Headings with no body copy, and headings wrapping into more lines than needed, are found by probes.

---

## 7. The review-pass pattern

Stakeholder feedback arrives as screenshots, voice notes and chat messages. Turn each round into **one
idempotent scripted pass** (`build/passes/review-<round>.py`) that edits the **source**, not the output:
- Each change is a find -> replace with an exact `old` string. If `old` is missing and `new` is already
  present, skip (idempotent). If **neither** is found, **fail the build** - the target vanished, someone
  changed the source, and the feedback would silently stop being applied.
- Passes run in order on every build, so a fresh build always contains every approved review round.
- Never hand-edit generated files (language versions, `_dist/`); the next build would silently revert it.
- Keep a short changelog per pass (what feedback item each replacement answers) so reviewers can verify.

---

## 8. Adversarial QA rubric

Before launch, run one pass whose only goal is to **break** the site, and score each area OK / WARN / FAIL:
- Layout: overflow at every width including 320, landscape, zoom 200 %, very long words in every language.
- Input: keyboard only, touch only, screen reader smoke test, reduced motion, forced dark, 1x and 3x DPR.
- Network: slow 4G + CPU 4x, offline after load, a blocked third-party script (does the page still work?).
- State: cleared storage, stale consent, back/forward cache, background tab, deep links with hashes.
- Security headers: CSP (enforced + report-only sweep), HSTS, frame-ancestors, referrer policy; mixed content.
- Performance: Lighthouse mobile repeated (median of 5+), CLS attribution, scroll smoothness, long frames.
- Content: placeholder text, wrong figures, broken QR codes, untranslated strings, legal pages consistent.
Every FAIL becomes a fix pass plus a regression check in the harness.

---

## 9. Live-site etiquette

- One load at a time, >= 1.5 s apart, <= 2.5 requests/s. Production analytics will record you.
- Read-only: never submit real forms, never trigger sign-ups or emails, never click "accept" in scenarios
  that do not need it.
- Fresh profile / cleared cookies per scenario so results do not leak between runs.
- Prefer preview deployments for anything heavy (gremlins, Lighthouse loops, monkey tests).

---

## 10. Pre-publish checklist

- [ ] Build from clean; all review passes applied with zero "target vanished" failures.
- [ ] `jscheck.mjs`: every inline script passes `node --check`; no control characters.
- [ ] `audit.mjs` over all pages x full width set: 0 overflow, 0 broken images, 0 console errors.
- [ ] Copy dump read; structure and heading-wrap probes clean; spelling checked per language.
- [ ] Anchors, language switch, redirects/aliases, download links and QR codes verified.
- [ ] Modes: forced dark, reduced motion, keyboard (focus trap + scroll lock), touch.
- [ ] axe-core clean with consent bar open and dismissed.
- [ ] Consent scenarios 1-6 pass; cookie table matches the cookie inventory.
- [ ] CSP sweep in report-only, including token-in-URL pages and in-app browser contexts.
- [ ] Lighthouse mobile median recorded; CLS attributed if > 0.1.
- [ ] Tiled screenshots reviewed at 390 and 1440 by a human.

## 11. Post-deploy checklist (production)

- [ ] Every sitemap URL x 2 widths: final URL, status 200, CSS loaded, no console errors (throttled sweep).
- [ ] No tracker before consent; trackers after accept-all; reject leaves none.
- [ ] Response headers (CSP, HSTS, cache) are the production ones, not preview defaults.
- [ ] Aliases and well-known files return what they should.
- [ ] Stateful pages (webviews, token links) load with a real token without CSP errors.
- [ ] One real iPhone + one real Android pass, including a link opened from inside a social app.
- [ ] Re-run after every hotfix; preview passing is not production passing.

---

## 12. Known gaps (what the real build never closed)

- No Firefox run. WebKit and in-app browsers were emulated only; no systematic real-device in-app pass.
- No visual diff (pixel compare between builds); screenshots were eyeballed.
- Touch-scroll smoothness was never actually measured: the synthesized touch gesture moved 0 px in headless.
  Use `Input.dispatchTouchEvent` sequences or a real device.
- Landscape phone layouts were only spot-checked.
- Hero media rendering late on mobile was observed but not fully solved; mobile Lighthouse stayed in the
  high 60s to mid 80s range.

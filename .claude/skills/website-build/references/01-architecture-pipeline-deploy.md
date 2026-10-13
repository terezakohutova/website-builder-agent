# 01 - Architecture, build pipeline, tools, deploy, backups and multi-session safety

How to structure a NEW multi-language marketing website (static HTML + build scripts, deployed to Vercel or
a similar static host) when you build it with Claude Code. Distilled from a real production build of a
5-language site (cs, sk, pl, de, en; ~12 pages x 5 languages + a few market-only pages). Every lesson is
written as a rule plus the reason: "in a real build, X happened, so do Y".

Placeholders: [Company], [Product], [example.com], [Market A]/[Market B]. Language codes cs/sk/pl/de/en are
used as examples of a master language (cs) plus four generated variants.

---

## 1. Architecture at a glance

- **Static HTML, no framework, no bundler.** Each page is one HTML file with inline CSS/JS. The "build" is a
  chain of small Python (or Node) passes that patch, translate, SEO-annotate and optimise those files. The
  host serves committed files; no build step runs on the host (Vercel preset "Other").
  - Why: a marketing site with a handful of pages does not need a framework, and plain files are easy for an
    agent to read, diff and patch deterministically.
- **Three copies of the site, strictly one-directional:**
  1. `site/src/` - **source**. Only the master-language pages are hand-edited. Language variants are
     generated (into `src/` or a sibling folder).
  2. `site/_dist/` - **optimised publish copy**: inline assets extracted to hashed files, images re-encoded,
     live-only passes applied (consent, tracking). Rebuilt from scratch on every run (`rmtree` first).
  3. `site/_deploy/` - **host copy** + host config (`vercel.json`, `404.html`, `.vercelignore`), which is a git
     working tree of the deploy repo. Rebuilt on every run except its `.git`.
- **Source of truth = the build chain, not the deploy repo.** The deploy repo only receives generated
  output. Never edit `_dist` or `_deploy` by hand; fix the source or the builder and re-run.
- **Count the pages from the folder, never from a number written in notes.** In a real build the page count
  changed three times in one day as pages were merged and hidden; every written count went stale.
- **Hidden pages:** pages that exist in source but are not live (drafts, deprioritised sections) get
  `noindex` and are excluded from `_dist` by an explicit `HIDDEN` list in the optimiser - not by deleting.
- **Runtime behaviour is injected, not hand-written per page.** Typical injected assets:
  - `typo.js/css` - line-break rules (no orphaned one-letter words etc.), applied at runtime.
  - `mobile.css/js` - mobile layout fixes.
  - `links.js` - store/attribution links, same-page anchors, smooth-scroll hooks, QR modal.
  - `consent.js` - cookie bar, Consent Mode, tag-manager loader.
  - `events.js` - analytics events.
  - Page-specific scripts (e.g. an invite/referral page).
  - Each injector is **idempotent**: it removes its own previous block (marked with a `data-*` attribute or
    `<!--name:start-->`/`<!--name:end-->` comments) and re-inserts it. Re-running never duplicates.

## 2. Recommended folder layout

```
my-site/                      # its own git repo from the first file (see section 12)
  site/
    src/                      # hand-edited master pages + generated variants
      index.html              # master language (hand-edit)
      02-about.html           # master language (hand-edit)
      index-de.html           # GENERATED - never edit
      02-about-de.html        # GENERATED - never edit
      assets/                 # typo.js, links.js, consent.js, events.js, mobile.css ... (hand-edit)
    i18n/
      strings-sk.json         # master string -> translation dictionaries (hand-edit)
      strings-de.json
    data/
      seo_data.py             # titles, descriptions, JSON-LD copy (review THIS, not the pages)
      markets.py              # per-market tables: ENTITY, MONEY, STORE, SOCIAL, RATING ... (reference 03)
    _dist/                    # GENERATED optimised copy - never edit, not committed
    _deploy/                  # GENERATED host copy, git working tree of the deploy repo
  build/
    build-all.sh              # one command, fixed order, lock, stop on first failure
    build-deploy.py           # _dist -> _deploy, writes host config
    passes/                   # one idempotent script per content/review round
    injectors/                # inject-typo.py, inject-links.py ...
    i18n/                     # build-pages-i18n.py, jslex.py
    seo/                      # seo.py, verify.py, llms-refresh.py, lastmod-final.py
    optimize/                 # optimize.py, strip-comments.mjs
    vendor/                   # self-hosted third-party libs (pinned versions)
  design/                     # originals, never served: mockups/png3x, icons, logos (+ logos.json), awards, fonts
  qa/                         # CDP/Playwright scripts, axe, Lighthouse, preview test (generic part: scripts/qa/)
  backups/                    # dated snapshots of anything NOT in git (CMS exports, DNS zone, prod capture)
  notes/                      # decisions, changelog
```

- Keep backups, temp scripts and reports **out of `site/src/`** (section 12 explains the leak).
- The other references use exactly these names: `site/src/`, `site/i18n/`, `site/data/`, `site/_dist/`,
  `site/_deploy/`, `build/passes/`, `build/injectors/`, `design/`, `qa/`. The short forms `_dist/` and
  `_deploy/` always mean `site/_dist/` and `site/_deploy/`.
- Name per-round scripts by topic, not by date only (`passes/copy-review-round2.py`), and never rename
  them once the build references them.

## 3. Libraries, services and tools that worked

### In the shipped site
- **Lenis** (smooth scroll), pinned version. Load it from a CDN while prototyping, then have the deploy
  builder rewrite it to a **self-hosted** copy (`/assets/lenis-<version>.min.js`) so no third-party request
  happens before consent. The builder **fails** if any page still references the CDN.
  - Gotcha: Lenis swallows `scrollIntoView()`/`scrollTo()` (scrollY stays 0). Same-page anchors must go
    through the exposed instance (`window.__lenis.scrollTo`), and QA must use real wheel events.
- **Fonts self-hosted** as woff2 (extracted to hashed `assets/*.woff2` by the optimiser) + `<link rel=preload>`.
  Trick: render digits in a monospace/alternative face by adding extra `@font-face` entries for the main
  family restricted with `unicode-range: U+0030-0039`.
- **qrcode-generator** (client-side QR for dynamic links, inlined only on the page that needs it). Static
  QR codes: generate with **segno** (Python) and decode them back to verify they scan.
- **Mobile attribution links** (Adjust, AppsFlyer, Branch or similar): one campaign per language, rewritten
  at runtime by `links.js` with page = ad group and spot (nav, hero, cta_band, footer...) = creative; pass
  incoming `utm_*` through. Keep tokens in one private place, never in notes or public repos.
  - Lesson: a deep-link SDK added for one invite page ended up removed entirely a week later (privacy +
    complexity); prefer reading the referral parameter from the URL and keep SDKs optional.
- **Tag manager (GTM) + Consent Mode v2.**
  - Gotcha: Custom HTML tags inside the container (Meta pixel, smaller ad networks) have **no consent check**,
    so Consent Mode does not gate them. Load the whole container from `consent.js` **only after consent**,
    not in `<head>`. Read the container's JS before assuming Consent Mode protects a tag.
  - Use Consent Mode **basic** by default; "advanced" sends cookieless pings before consent - keep it behind
    an env switch, default off. No GTM `<noscript>` iframe (it tracks without consent).
- **Headless CMS** (e.g. Payload) as the single source for FAQ and legal text shared by web and app.
  Fetch **at build time** (the API may send no CORS header for the web origin). Legal fetch **fails the
  build** if the CMS is unreachable; FAQ falls back to a cached copy. Every CMS write: dated backup ->
  write -> read back.
- **Legacy site behind a proxy:** if an old app/site still serves some paths (webviews, wallet pages, old
  SPA chunks), rewrite only those prefixes to it. Never redeploy or delete the legacy project during cutover.

### Build-time tools
- **Python 3** stdlib + **Pillow** (WebP re-encode at ~q82, read image sizes) + **imageio-ffmpeg** (bundled
  ffmpeg: video -> H.264 CRF ~30, max 1280 px wide, no audio, `-movflags +faststart`).
  `pip install pillow imageio-ffmpeg`.
- **Node** (recent LTS, global `fetch`/`WebSocket`) + **terser** with `compress:false, mangle:false` in a
  `strip-comments.mjs` - removes comments and whitespace only, never changes behaviour.
- Syntax-check every inline script and event handler with `scripts/qa/jscheck.mjs` (section 9).
- **A tiny JS string-literal lexer** (`jslex.py`) so i18n builders can translate strings inside inline
  scripts without touching code or comments.

### QA tools (all local, re-runnable)
- **Raw CDP harness** (`qa/cdp.mjs`): launch headless Chrome with `--remote-debugging-port` and talk DevTools
  Protocol over Node's global `WebSocket`. Built because browser MCP tools failed to connect in the real
  build; it also drives real wheel events (tests through Lenis). Scripts: overflow / broken images /
  console errors per width, monkey testing, feature checks, screenshots.
- **Preview test** (`qa/test-preview.py <deployment-url>`): compares a deployment against a captured
  production baseline - aliases return 200, language homes 301, proxied paths byte-identical to the
  baseline, every deploy file 200 with the right content type, every internal link resolves, app-link JSON
  files valid, query strings preserved on invite paths. Writes `report.md`, exits 1 on failure.
- axe, html-validate, linkinator, gremlins.js (monkey), Lighthouse, EDPS website-evidence-collector
  (cookie/tracker sweep for a legal audit), structured-data testing, GEO audit tools.
- Language checks: a script that flags master-language leftovers on variant pages; LanguageTool (local
  server), Hunspell via **spylls** (use `lookup()` only - `suggest()` takes minutes).
- Local preview: `python -m http.server <port> --bind 127.0.0.1` from the **parent** folder (section 10).

### Hosting and accounts
- **GitHub** deploy repo (private), pushed from `_deploy/.git` with a repo-local credential config.
- **Vercel** project connected to that one repo only: push to `main` = production, any other branch =
  preview URL. Turn Spend Management on with **alerts only** - auto-pause would take the live site down.
- DNS at the registrar; apex redirects (308) to `www`.
- Submit the sitemap to Google Search Console, Bing Webmaster and any local search engine; inject
  verification metas from the deploy builder (home page only), not by hand.

## 4. The build chain (in order) and why the order matters

One command builds everything, a second builds the deploy copy. A small working version of steps B, C, D
and G (typography injector, exact-match i18n builder with an untranslated/leftover check, SEO
post-processor between markers, sitemap with hash-based lastmod) and of the build lock in section 11 ships
with this skill's repository as `examples/build-chain/`; read it before writing your own.

```bash
bash build/build-all.sh && python build/build-deploy.py
```

`build-all.sh` runs each step through a `run()` helper (prints the last 2 lines, dumps the full log and
exits on the first failure), with `PYTHONIOENCODING=utf-8` and the build lock (section 11).

- **Phase A - content passes on master sources + dictionaries.** Each review round becomes an idempotent
  script, so a rebuild never loses a fix (copy rounds, reviews block, tone/address fixes...).
- **Phase B - runtime injectors into master pages** (typo, mobile, links, page-specific UX passes).
- **Phase C - generate language variants** (they inherit everything above): home variants, page variants,
  market-only pages (e.g. a legal imprint for [Market B]), local press/partner sections, currency prefixes.
- **Phase D - SEO, the last writer of source pages** (`seo.py`).
- **Phase E - optimise into `_dist`** (`optimize.py`).
- **Phase F - passes on `_dist` only:** consent + tag-manager loader, analytics events, countdowns, launch
  fixes, CMS FAQ, CMS legal text.
- **Phase G - re-derive from finished pages:** `llms-refresh.py` (llms.txt, llms-full.txt, `ai/*.json`),
  then `lastmod-final.py` (sitemap `<lastmod>` + JSON-LD `dateModified` from a hash of each FINISHED page,
  state in a JSON file).
- **Phase H - `build-deploy.py`** (`_dist` -> `_deploy`, section 7).

Why this order:
- **Injectors before i18n builders.** Generated pages only get injected blocks by being rebuilt from the
  master page; injectors deliberately skip generated files. Changing `typo.js`/`links.js`/`mobile.css`
  means re-running injector + all builders - which is why there is one command.
- **i18n is exact text-node matching** against `strings-<lang>.json` (master string -> translation; several
  dictionaries merged, later wins). Any master-copy change without a matching entry leaves master language
  on the foreign page. Therefore:
  - **Line breaks are done at runtime** by `typo.js`, never by hand-inserting `&nbsp;`/`<br>` into the copy -
    in the real build that broke every match.
  - Don't add classes/attributes to markup a builder anchors on; style via a wrapper or CSS instead.
- **A builder may need to run twice** when a later builder creates pages the first run links to. Make that
  explicit in `build-all.sh` with a comment.
- **`seo.py` is the last writer of source pages.** Any builder run after it puts the master `<head>` back.
  seo.py writes only between `<!--seo:start-->`/`<!--seo:end-->` and encodes non-ASCII as character
  references so i18n builders pass it through untranslated and leftover checks don't flag it. Test on a copy
  via an env var (`SEO_WEB=<dir>`); verify with `verify.py`. Copy lives in `site/data/seo_data.py`.
- **`optimize.py` after seo.py; everything tracking/consent-related after optimize.py, on `_dist`.** Sources
  stay readable (no hashed names, no consent code) so builders and text matching keep working.
- **`llms-refresh.py` and `lastmod-final.py` are truly last.** `_dist` passes and the CMS change pages after
  seo.py; dating pages at the seo step left sitemap dates stale in the real build.
- **`build-deploy.py` strictly after the build finishes** - it refuses while the build lock exists.

Environment switches worth having: CMS FAQ on/off, advanced Consent Mode (default off), proxy allow-list vs
catch-all, `DIST=<dir>` (run a `_dist` pass elsewhere), `SEO_WEB=<dir>` (seo.py on a copy).

## 5. Source vs generated - the never-hand-edit list

- **Hand-edit only:** master pages; injector assets; `strings-*.json`; `seo_data.py`; pass/builder scripts;
  market-specific legal source generators.
- **Generated - never edit:** every language variant, market-only generated pages, generated legal
  fragments, robots/sitemap/llms/`ai/`, `_dist/`, `_deploy/` (incl. `vercel.json`, `404.html`,
  `.vercelignore`).
- **CMS-sourced text** (legal, FAQ) is overwritten in `_dist`; master pages may hold stale copies. Change it
  in the CMS (backup, write, read back), then rebuild.
- **Special pages outside the builders** (e.g. an imprint or a double-opt-in thank-you page that exists in
  one language only) must be registered in **every** special-case list: injectors, SEO, audits, language
  checks, `consent.js`/`links.js`/`events.js`. In the real build one such page shipped with the master
  `lang` attribute and master-language chrome because seo.py skipped it. Keep one shared `SPECIAL_PAGES`
  constant that every script imports.

## 6. Publishing previews as Claude Artifacts (optional, pre-launch)

Useful for sharing a whole site or deck before a real host exists.
- **Check the link model first.** Publishing one artifact per page makes every page its own origin; a real
  static site uses relative links (`href="02-about.html"`) that 404 there. In a real build an externally
  supplied site zip broke all navigation this way - relative links pass every local test and fail live.
  Publish the whole site as **one multi-file artifact** (`files` parameter) so relative links work.
- **Wrapper:** the publisher wraps the main page in its own `<!doctype><html><head><body>`. A page saved via
  "Save as" from a published artifact already has it; republishing wraps twice (second `<title>`/meta in
  `<body>`). Strip up to the first `<body>` and the trailing `</body></html>` **in a script**; let the
  optimiser generate the artifact entry page. Supporting files are served raw - keep them full documents.
- **Always pass the artifact `url`** on updates; a new file path creates a stray new artifact.
- **File limit per publish** (255): a full site with assets needs two publishes (assets + main page first,
  then HTML). Content-hashed assets already live need not be resent.
- **Omitted files are kept**: map removed paths to `null` explicitly; after renaming assets, publish the new
  set, then a second call nulling the old paths.
- **Refused publish = someone else published since you read.** Diff their live copy against your build,
  read again, republish. Never force without the owner's explicit word.
- **The preview iframe is cross-origin and sandboxed**: browser tools can't see inside, `mailto:` and
  external navigation are blocked, its CSP blocks tag managers. None of that is a site bug - QA locally.
- **Huge base64 pages can't be read into an agent's context** (file-read caps); extract assets early.
- Log each published version number with what it carried.

## 7. Deploy: `build-deploy.py` and `vercel.json`

Make the builder's docstring the spec. It should:
- Wipe `_deploy` except `.git`; copy `_dist` minus artifact entry pages, anything with `.bak` in the name,
  `_tmp*`, `*.py/.log/.md/.zip`.
- Per page: assert it starts `<!doctype html><html` and has `<head>`; refuse an already patched file (marker
  attribute); strip stray body metas; make relative `src/href/poster/srcset` **root-absolute** (in the real
  build a relative `srcset` broke images on retina phones under nested alias paths); swap CDN libs for local
  copies; rewrite links to clean URLs; patch JS that derived the page from `location.pathname` to read a
  `window.__PAGE` global; insert a first-in-`<head>` alias script and an early brand-colour background (no
  white flash on iOS); optional cross-document view transitions.
- **Fail** on: missing `_dist`, a page without a clean URL, an alias whose target is missing, CDN lib left.
- Write `vercel.json`, `.well-known/security.txt` (RFC 9116), `README.md`, `.vercelignore`, a branded
  `404.html` (noindex); redact any secret in the stored production capture; then run
  `node strip-comments.mjs _deploy` (JS via terser, CSS via a small tokenizer, inline blocks too). In the
  real build shipped comments quoted internal reviewers and named a confidential partner - strip them all.

`vercel.json` (generated, `cleanUrls:false`, `trailingSlash:false`):
- **Real files win over rewrites** on Vercel; rewrites only see paths that don't exist as files.
- **Clean URLs as rewrites** (`/about`, `/de/about`, `/en/support`...); every `/NN-name[-lang].html` 301s to
  its clean URL. Keep the map in one `CLEAN` dict.
- **App-store-listed and deep-link paths stay exact - 200, no redirect** (`ALIASES`): terms, privacy,
  account deletion, invite links (keep the query string). Store review bots load these; a redirect can fail
  review.
- **301s:** language homes (`/cs` -> `/`), old app links (`/faq`, `/terms`, `/invite`), old favicons,
  legacy slugs, a `LEGACY_GONE` list (blog, retired sections -> home).
- **Legacy proxy with an allow-list:** only prefixes the old site really serves are rewritten to it;
  everything else gets the real 404. A catch-all proxy to an old SPA answers 200 to every path = soft 404s,
  flagged in an SEO review. Keep the catch-all only behind an env switch.
- **Headers:** `apple-app-site-association` and `assetlinks.json` as `application/json` (Apple wants JSON;
  production served octet-stream); `security.txt` text/plain; `/assets/*` immutable 1 year; `*.html`
  `max-age=0, must-revalidate`; `X-Robots-Tag: noindex, nofollow` on **every host except the production
  domain** (previews must never be indexed); on all paths `nosniff`, `Referrer-Policy`,
  `X-Frame-Options SAMEORIGIN`, COOP `same-origin-allow-popups`, `Permissions-Policy`, and **CSP**.

### CSP - rules from real incidents
- **Report-Only first**, collect violations across all pages, then enforce.
- **Legacy pages behind the proxy break silently.** In the real build a legacy landing called an API only
  when a token was in the URL; the token-less CSP check never triggered it, `connect-src` blocked it and the
  page showed an error for ~22 hours. Rule: **on any CSP change, test proxied legacy pages with a real
  token/session**, not just the new pages.
- Ad conversion endpoints (e.g. `www.googleadservices.com`) need `connect-src` entries.
- Edit the CSP **only in one constant in `build-deploy.py`**; a hand edit in `vercel.json` is overwritten.
- `form-action 'none'` silently kills form submits; Node tests never see CSP - test forms in a browser.
- Claude Code's auto-mode classifier treats widening a CSP as a security weakening: get the owner's explicit
  OK first.

### Git, branches, who does what
- `main` = production. Any other pushed branch = preview URL to share with reviewers.
- **Small content changes** may go to `main` after a local test. **Host config / redirects / headers / CSP /
  consent / tracking / legal changes: side branch first**, a technical reviewer checks the preview, the site
  owner merges.
- **A human pushes `main` / merges.** Auto mode often blocks the agent's production pushes; prepare a script
  the owner runs.
- Rollback: Vercel **Instant Rollback**.
- Commit flow: in `_deploy`, `git status && git checkout <branch>` **before** building (the working tree is
  a branch checkout - it may be sitting on a side branch), build, confirm `vercel.json` + `404.html` +
  `.vercelignore` exist, commit, push/hand over.
- Merging `main` into a stale side branch: merge `origin/main`, not local `main` (a real merge was a no-op
  against a stale local main).
- After merge: `curl -sI https://www.[example.com]/<path>` for headers/CSP, spot-check pages, live console
  sweep.

### Subdomain inventory before cutover
- Inventory with certificate transparency (certspotter / crt.sh) + DNS + HTTPS probe; note it misses
  subdomains without their own certificate. Classify: old landing pages, other hosts, product
  infrastructure (API, back office, auth - never touch). Removals from the index go through Search Console.

## 8. Incidents and the lessons they produced

| What happened | Rule now |
|---|---|
| Menu links pointed at old absolute paths; page templates had stale home links | Fix links in the shared shell/template, not per page; check every link form |
| Externally supplied site with relative links published per-page -> all nav 404 | Check the link model before publishing anything from outside |
| Python `re.sub` replacement `"\1..."` (non-raw) injected byte 0x01 into an inline script; a JS feature died on all pages | Raw strings for replacements; `assert '\x01' not in s` before writing; syntax-check every inline script (`jscheck.mjs`) |
| Two sessions published the same site six times; broken JS went live again | One session publishes, others edit only; rebase on live before publishing |
| Literal string anchors matched on one page but not others (whitespace drift) | Patch with `re.subn` + `\s*`, assert match count `== 1` |
| Shell heredoc turned `\b` into a backspace byte (0x08); regex silently never matched | Write regex-heavy scripts with the Write tool; grep for `\x08` after scripted edits |
| Second `<title>` from an old wrapper inside `<body>`; ~1,700 HTML comments shipped | seo.py strips body metas; comments stripped from `_dist`/`_deploy` |
| An "already present" check matched a filename inside `links.js`, so a link was never added | Presence checks look at markup, not a raw substring of the file |
| `page.html.bak-<tag>` landed in `_dist`, almost published | Backups never live next to pages (section 12) |
| Another session rewrote the publish manifest mid-publish | Stop, let it finish, compare its live version by hash |
| CMS write "timed out" because the browser tab was frozen in the background | Verify through the public API whether a write landed before retrying |
| Relative `srcset` broke retina images under nested aliases | Deploy builder absolutizes `srcset` |
| A build "killed for low memory" kept running as an orphan; a new build ran in parallel (`FileExistsError`, missing pages) | Check for live build processes before restarting; build lock |
| CSP enforced; token-only API call on a legacy page blocked for ~22 h | Test legacy pages with a real token on any CSP change |
| Two sessions ran the build at once; deploy builder cut off; half-built `_deploy` committed without `vercel.json`/`404.html`/`.vercelignore` | Build lock; check those 3 files before every commit; never roll back to a half-built commit alone |
| A single-language special page got the master `lang` and chrome | Register every special page in one shared list |
| Assigning onto a frozen platform-provided object threw in strict mode; feature dead for days | Wrap platform objects, never assign to them |

## 9. Verification before anything ships

1. Build is complete and alone: no other build process, lock released, `0 SEO warnings` (`verify.py`).
2. Every inline script parses the way the browser parses it: `node scripts/qa/jscheck.mjs <dir>`. The first
   version (a `<script(?![^>]*\bsrc=)` regex plus `node --check` on a temp `.js`) had four holes, found in a
   later review: `data-src=` matched as `src=` and skipped the script, `data-type` was read as `type`,
   `node --check` treats a `.js` file as CommonJS so a top-level `return` passed, and `onclick="..."` handlers
   were never parsed. jscheck reads attributes by name, compiles classic scripts as scripts, modules as
   modules and handlers as function bodies. JSON-LD blocks: `json.loads`. (The real check covered ~530 inline
   scripts + ~60 JSON-LD.)
3. No control characters: `\x01`, `\x08` absent from every written file.
4. Assets resolve: the optimiser prints `missing asset references: 0` (make it fail otherwise).
5. Browser QA on a local server at 360/390/430/1280/1440 px: 0 horizontal overflow, 0 console errors, real
   wheel scroll, clicks, light/dark if supported.
6. Deploy copy complete: `vercel.json`, `404.html`, `.vercelignore` present; `git status` shows only what
   you expect; right branch.
7. Preview test against the production baseline -> `report.md`, 0 real failures.
8. After merge: `curl -sI` headers/CSP on production, spot-check pages, live console sweep.
- A page that merely renders proves nothing: one syntax error silently disables a whole script block.

## 10. Local preview and Windows gotchas

- Serve over HTTP, never `file://` (browser tooling refuses it):
  `python -m http.server 8799 --bind 127.0.0.1` run from the **parent** of the folder you will rebuild.
- `rm -rf _dist` fails with "Device or resource busy" while a server (or the shell's cwd) sits inside it.
  Kill the listener first (PowerShell: `Get-NetTCPConnection -LocalPort N | Stop-Process`).
- Read files with `encoding='utf-8'`, write with `newline=''` (keeps LF; a CRLF/LF flip shows up as a full
  diff in `vercel.json`). Export `PYTHONIOENCODING=utf-8` for non-ASCII console output.
- Images need real `width`/`height` attributes (let seo.py add them; read WebP dimensions from the header) -
  a lazy image without them is 0x0 until decoded and collapses its layout.

## 11. Multi-session safety (the biggest recurring cost)

Several Claude Code sessions in the same folder overwrite each other silently.
- **One session publishes/deploys; any other session only edits files and says so.** If you are not the
  publishing session: no publish, no deploy, no `_deploy` commit, no push.
- **One build at a time - enforced by a lock:**
  - `build-all.sh` takes `build/.build-lock` as a **directory** (`mkdir` is atomic); `info` inside holds
    pid + host + start time; removed by `trap ... EXIT`.
  - A second build prints `ANOTHER BUILD IS RUNNING (pid N since T) - wait for it` and exits.
  - **Owner check on cleanup:** the trap removes the lock only if `info` still holds *this* pid. A dead or
    timed-out build must never delete a live build's lock.
  - **Stale takeover:** on the same host, as soon as the recorded pid is no longer running (a crashed build
    must not block the next one for 45 minutes); for an owner on another host, whose pid cannot be checked,
    only after a threshold (e.g. 45 min). Serialise the takeover with an exclusively created
    `<lock>.takeover` file (`O_EXCL`), re-read `info` under it and rewrite it; never delete and race, and never
    rely on "write, sleep, read back" (two builds can both win that).
  - `build-deploy.py` refuses while a fresh lock exists.
  - If you see the message: wait. Never delete the lock by hand.
- **Tells that another session is active:** new loose `_tmp-*.py` files; a file you just wrote comes back
  different or with a newer mtime; the publish manifest or `_dist` changing under you; new commits or
  uncommitted changes in `_deploy`.
- **When it happens:** don't overwrite back. Build from what is on disk, diff, and ask the owner to divide
  the work by page or by task - never two sessions in the same files.
- **Right before committing `_deploy`:** `git status` - another session may be mid-deploy-build.
- Several sessions logging the same day create duplicate date headings; merge them later.

## 12. Backups

- **Every new site is its own git repo from the first file.** `git init` before writing page one, not after
  the first scare. The deploy repo (`_deploy/.git`) is separate and receives only generated output.
- **Commit at every milestone and before every risky change** (bulk regex edits, builder refactors, i18n
  dictionary rewrites, host-config/CSP changes). A commit is the cheapest rollback there is.
- **Generated outputs are rebuildable and never hand-edited:** `_dist/`, `_deploy/` content, language
  variants. Don't back them up - back up the sources and builders, and fix by rebuilding. Ignore `_dist/`
  in the source repo.
- **Files outside git get dated snapshots** in `backups/`: `<name>.<YYYY-MM-DD>-<tag>.bak` (tag = the change,
  e.g. `-csp`, `-lock`, `-hero`), or a dated folder for larger sets:
  - CMS content: dated JSON export before every write, read back after.
  - **Production capture before cutover:** every live path with body + headers (secrets redacted). It is
    also the baseline the preview test compares against.
  - DNS zone export before any DNS change.
- **Backups must NOT live next to the pages.** In the real build the optimiser copied every root file not
  ending in `.html/.bak/.py/.json` into `_dist`, so `page.html.bak-<date>-<tag>` (ending in the tag, not
  `.bak`) was copied - ~25 such files, including backups of hidden pages. The deploy builder filtered any
  name containing `.bak`, so production stayed clean, but an artifact publish of `_dist` would have shipped
  them. Rules: keep backups in `backups/`, and filter with `'.bak' in name`, never `endswith`.
- **Patch scripts:** delete one-off `_tmp-*.py` after applying unless kept deliberately for revert (note
  it). Any fix that must survive a rebuild becomes an idempotent pass in `build-all.sh`.
- Before publishing anything from the project to a public repo: anonymize (no company data, names, tokens,
  internal URLs) and grep for the stripped terms.

## 13. Generic recipe (checklist for a new site)

1. `git init`; one folder = source of truth; hand-edit only master-language pages; everything else generated.
2. Shared chrome via a shell/injectors with marked, idempotent blocks; never copy-paste per page.
3. Translations by dictionary + exact text match; layout tweaks (line breaks) at runtime so copy stays
   matchable.
4. SEO post-processor as the last writer of sources, idempotent between markers, copy in a data file.
5. Separate optimised copy (`_dist`): extract inline assets to hashed files, WebP, lazy-load with real
   dimensions, strip comments.
6. Tracking/consent only in the optimised copy, loaded after consent; self-host libraries; pin versions.
7. Deploy copy generated with its host config (clean-URL rewrites, exact store-listed paths, legacy proxy
   allow-list, real 404, security headers, CSP Report-Only first), pushed to a repo where `main` =
   production and branches = previews.
8. A build lock with owner check, one publishing session, dated backups for everything outside git, a
   re-runnable QA harness and a preview test against a captured production baseline before any switch.

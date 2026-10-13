---
name: website-build
description: Playbook for building a new multi-language marketing website from scratch to the standard of a real production site - folder layout and build pipeline, design tokens and typography, real-screen phone mockups, i18n, SEO, GEO (AI-search visibility), performance, consent/analytics, legal pages, QA across devices/widths/modes/in-app browsers, backups, and a reviewed deploy (Vercel or similar). Use when building a new site or landing page, or when auditing one against this standard.
---

# /website-build - build a website properly

Distilled from building, translating into five languages, launching and hardening a real marketing site for a
mobile-app company. Every rule in the references comes from something that actually went wrong or cost time.
This file is the route; the references hold the detail.

| Open this | when you are about to |
|---|---|
| [`references/01-architecture-pipeline-deploy.md`](references/01-architecture-pipeline-deploy.md) | set up the folder and build chain, pick libraries, add a build step, deploy, configure hosting/CSP/redirects, set up backups |
| [`references/02-design-typography-mockups.md`](references/02-design-typography-mockups.md) | define tokens and type, handle fonts and line breaks, make phone mockups, place icons/logos, build components and motion |
| [`references/03-i18n-seo-geo.md`](references/03-i18n-seo-geo.md) | translate, add a market, write meta/JSON-LD, sitemap/robots/llms.txt, do GEO, optimise performance, set up analytics |
| [`references/04-qa-devices-modes.md`](references/04-qa-devices-modes.md) | test anything; the harness, device/width/mode matrix, in-app browsers, a11y, consent flows, adversarial and live QA |
| [`references/05-process-content-legal-launch.md`](references/05-process-content-legal-launch.md) | run the project: roles, approvals, feedback loop, IA, facts, legal pages, consent, go-live |
| [`scripts/qa/`](scripts/qa/README.md) | run the QA harness (raw CDP, nothing to install) and the WebKit/in-app browser matrix (Playwright) |
| [`scripts/backup/snapshot.py`](scripts/backup/snapshot.py) | version a file before an edit, list versions, restore; or install it as a PreToolUse hook |

## 1. Phases (in order)

1. **Brief** (`05`): goal and CTA, markets/languages, page list, facts sheet with sources, brand assets, legal entity per market, tracking and consent, hosting, and who merges production.
2. **Skeleton** (`01`): one source folder, master language hand-edited, shared chrome injected by idempotent marked blocks, builders for everything else, `_dist` (optimised) and `_deploy` (hosting) as one-way generated copies, a build lock, git from the first file.
3. **Design system** (`02`): tokens per ground, `clamp()` with rem plus a small vw slope, real `width`/`height` on images, absolute `srcset`, self-hosted subset fonts covering every diacritic, one motion system per element, reduced-motion and JS-off safe.
4. **Imagery** (`02`): real product screens exported per market from the design tool (3x PNG -> WebP). Never text patched onto rasters. Fix logos in the file, not with blend modes.
5. **Copy and facts** (`05`): one facts list, one term per concept, legal entity per market, formal/informal address per audience.
6. **i18n** (`03`): dictionary plus exact-text-match builders, runtime typography, hreflang (+ x-default), per-market data tables, language QA.
7. **SEO** (`03`): an idempotent post-processor between markers, one JSON-LD `@graph` per page, sitemap with real lastmod, robots (AI crawlers allowed on purpose), a real 404.
8. **GEO** (`03`): `llms.txt` (+ full), `facts.json`, consistent entity data on and off site, text that survives no-JS extraction, then the GEO test protocol, including asking the real AI engines.
9. **Performance** (`03`): inline assets -> hashed files, WebP, lazy below the fold, self-hosted libraries, deferred tag manager, Lighthouse on mobile and desktop.
10. **Consent, analytics, legal** (`03`, `05`): consent bar, Consent Mode v2 (decide basic vs advanced deliberately), tags only after consent, every tracker listed in the privacy policy, required legal pages, CSP in Report-Only first.
11. **QA** (`04`): the full page x width matrix, modes, WebKit and social in-app browsers, keyboard/focus, consent scenarios, links/anchors/language switch, adversarial review, then real phones.
12. **Go-live** (`05`, `01`): back up the old site and DNS, redirect every old URL (keep store-listed paths exact), test the preview against the baseline, switch, run the live checklist.

## 2. Hard rules

1. Never hand-edit generated files (language versions, `_dist`, `_deploy`). Edit the source or the builder, then rebuild.
2. Never hand-insert `&nbsp;`/`<br>` into copy that translation builders match by exact text. Line breaks are done at runtime.
3. One session builds and publishes. The build lock checks its owner; wait if it is held, never delete it. Check free memory before a full build.
4. A page that renders proves nothing: syntax-check every inline script, scan for control characters, run the whole matrix.
5. Every round of feedback becomes an idempotent pass in the build that fails if its target text disappears.
6. Production is merged by the owner. Hosting, CSP, consent, tracking and legal changes go to the technical reviewer on a side branch first.
7. Facts live in one list. A number that differs between two pages is a trust bug and a GEO bug.
8. **Backups:** git per site with a commit at every phase; `scripts/backup/snapshot.py` (or its hook) for everything between commits; old site and DNS backed up before go-live.
9. Re-test overlays, sticky bars and the menu on the **built, minified** output. Minifiers can drop selector specificity.
10. Test CSP and consent in the in-app browsers your ads land in, and on pages that carry state (tokens in URLs).

## 3. QA in one breath

Paths are relative to this skill folder. `node scripts/qa/jscheck.mjs site/_dist` first, then
`node scripts/qa/audit.mjs <folder-or-url>` with `QA_WIDTHS=1440x900,1280x800,1024x768,768x1024,430x932,390x844,360x780,320x700`,
then `anchors.mjs`, `modes.mjs`, `console-sweep.mjs`, `shots.mjs` (look at the screenshots yourself),
and `inapp.mjs` for WebKit plus the Instagram/Facebook/TikTok in-app browsers. Every script exits 2 on bad
usage; the checking ones exit 1 on a finding. Checklists: `04`, sections "pre-publish" and "post-deploy".

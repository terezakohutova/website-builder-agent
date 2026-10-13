# 03 - Internationalisation, SEO, GEO, performance, analytics

Scope: how to build the language versions, search visibility, AI-answer visibility (GEO), speed and tagging of a
**new static multi-language marketing site** with Claude Code. Everything here comes from a real production build
(one master language + four generated languages, ~12 pages per language, ~60 in total) and is written as **rule + why**. Where a lesson
came from an incident, the incident is described generically.

Layout (the same as `01-architecture-pipeline-deploy.md` section 2; adapt names, keep the separation):

```
site/src/            master-language pages (the only HTML you edit by hand)
site/i18n/           dictionaries: strings-<lang>.json, per-page-set dictionaries
site/data/           market tables (entity, money, socials, ratings, store links), seo_data.py
site/_dist/          optimized output (generated)
site/_deploy/        final publishable tree with clean URLs (generated)
build/               ordered build scripts: passes/, injectors/, i18n/, seo/, optimize/, build-deploy.py
qa/                  read-only checkers (verify, lang-check, probes, perf)
```

---

## 0. Pipeline position: who writes what, in which order

A typical chain, run by one `build-all.sh` that holds a lock file (two parallel builds corrupt each other's output):

1. Copy/review passes edit **master sources + dictionaries** only.
2. Runtime injectors add shared scripts/styles (typography, link rewriting, mobile tweaks).
3. Language builders generate `<page>-<lang>.html` from master pages + dictionaries; market-specific special pages (e.g. a German legal notice) are built here too.
4. SEO post-processor = **last writer of the source pages**. Any i18n builder run after it puts the master-language head back into the variants.
5. Optimizer writes `_dist/` (sources never touched again).
6. `_dist`-only passes (consent, events, countdowns, late fixes, CMS payload for FAQ/legal).
7. **Re-derive machine files from the finished pages**: llms.txt / llms-full, FAQ JSON, facts, sitemap lastmod.
8. Deploy step: clean URLs, canonical/hreflang/sitemap/llms rewritten to clean paths, 301s, aliases, 404, headers/CSP, search-engine verification meta, strip stray body metas and comments.

- **Rule:** any file derived from page content (sitemap lastmod, llms-full, FAQ JSON, facts) must be generated from the *final* artifact, not from an intermediate stage. Why: in the real build this bit twice - llms-full shipped already-removed wording and an old FAQ, and sitemap dates were stale on pages changed by late passes.
- **Rule:** if a builder produces links to pages that another builder generates later, either order them correctly or run the first one twice. Document why it runs twice, or someone "optimizes" it away.

---

## 1. Internationalisation (i18n)

### 1.1 Architecture: one master source, generated languages by exact text match
- **Rule:** edit only the master-language page or a builder/dictionary, then re-run the chain. Never hand-edit generated language files, `_dist/` or `_deploy/`. Why: every run overwrites them; hand edits vanish silently.
- **How a builder translates:**
  1. Mask `<script>`, `<style>`, comments.
  2. Translate JS string literals via a small JS lexer (not regex on raw JS).
  3. Translate text nodes `>...<` whose `strip()` is an **exact key** in `strings-<lang>.json`.
  4. Translate attributes `alt|aria-label|title|placeholder` + `meta description`.
  5. Apply edits last-to-first, drop overlaps.
  6. **Fail** if any master key is untranslated. Print "master-language-looking leftovers" (regex on characters typical of the master language, e.g. diacritics).
- **Dictionaries merge in a defined order** (later wins): homepage -> page set A -> page set B -> per-page restore files. Merge scripts must be idempotent.
- **Extraction workflow:** an `extract.py` writes `strings-<page>-<master>.json` (kind text|attr|js) + a `todo` list; one translation subagent per language fills the values. Translate key -> value JSON, never whole HTML pages - markup, scripts and IDs stay untouched.
- **Trap: hand-inserted `&nbsp;` / `<br>` breaks translation.** The key is the exact text node; `foo&nbsp;bar` or a `<br>` changes the node, the dictionary misses it, the variant keeps master-language text. Fix: do typography **at runtime** (a `typo.js` + `typo.css`): sentence-per-line for headings and short leads, NBSP after one-letter words / short prepositions per language, NBSP inside "50 CUR", "40 000", the brand name. Never bake locale typography into text that is also a translation key.
- **typo.js:** keep all regexes as literals. A regex built from a string lost a backslash (`\s` became `s`) in the first version. After changing typo.js/css, re-run the injector **and** every i18n builder (variants only get it through their builders).
- **Page CSS must not go into an injector-owned block.** An injector that replaces its own `<style data-typo>` block wiped page CSS someone had appended there. Page CSS goes into its own `<style data-page-pass>`.
- **List the anchors builders depend on** (data attributes, footer entity strings, figure-format anchors, icon hashes) in the builder header with asserts. Changing one silently breaks a language or fails the build.
- **Trap: generator vs data.** If a language's copy lives in a JSON that a helper script *generates*, edit the JSON (or the generator input), never the output. Otherwise the next run reverts it.
- **Link localisation:** home links -> `index-<lang>.html` (except language-switch links carrying `hreflang`); page links -> `<name>-<lang>.html` **only if that file exists on disk** (so builder order matters).
- **Special pages outside the builders** (e.g. a market-only legal notice, a double-opt-in thank-you page): everything that decides "which language is this file" must know them, or they get master-language chrome (cookie bar, footer, link campaigns, event `lang`). Keep **one** `page -> language` function and import it everywhere (QA scripts, injectors, consent, links, events).
- **Presence checks:** never test for a link by a bare substring that also appears inside scripts (`'legal.html' in page` matched a string inside a shared JS file, so the footer link was never added). Match the markup itself (`href="legal.html"`).

### 1.2 URL scheme, clean URLs, language switcher, hreflang
- **Files** `<nn>-<slug>[-<lang>].html`; **live URLs** clean per language, built at deploy from a `SLUG` table: `/`, `/sk`, `/de/...`, `/en/why-us`. Master language has no prefix; slugs are translated per language.
- Clean-URL rewriter must also rewrite `.html` references in sitemap.xml, llms.txt, llms-full.txt, robots, manifest, `ai/*.json`. Old `/<file>.html` and `/<lang>/<file>.html` 301 to the clean path - and old language homes (`/sk/index.html`) to the **language** home, not the master home.
- **Legacy paths held by app stores, deep-link providers or sent e-mails are served 200 at the exact path, never redirected** (alias table). A first-in-head script sets a global "which file am I" so page JS that derives the page from `location.pathname` keeps working. Why: redirects can drop deep-link match parameters and break store-required URLs.
- **hreflang codes are languages, not countries:** Czech is `cs`, not `cz` (Danish `da` not `dk`, Swedish `sv` not `se`, Greek `el`, Ukrainian `uk`), even if your UI chip shows the country. Use `lang-REGION` only when you really have regional variants.
- **x-default** = the language for "everyone else" (usually EN, falling back to master if EN doesn't exist for that page). This is a business decision; write it down.
- hreflang in `<head>` **and** in sitemap `xhtml:link` alternates; both reciprocal. Pages hidden in a language are dropped from the sibling set, so nobody points at a noindex page.
- **Language switcher:** real `<a href hreflang>` links (not JS buttons), current one `aria-current`, visible tick on the active language (a bug had the tick always on the master language). Each page's switcher goes to its own translations, not the homepages.
- 404 page: branded, `noindex,follow`, no canonical/alternates, language links to language homes.

### 1.3 Per-market data that is NOT translation
Separate **translation** (dictionaries) from **localisation data** - each kind in **one table in one builder**:

| Table | Holds | Lesson |
|---|---|---|
| `ENTITY` | footer legal entity per market: name, company IDs, VAT IDs, address in the registry's own format, share capital where law requires it, support mailbox | Copy from the official register, note the source; decide once whether register courts appear |
| `MONEY` | currency, amounts per market (referral bonus etc.), formatting locale (`de-DE`, `en-IE`) | If EN serves a non-euro market, show both: "€8 (CUR 200)" |
| `FIGFMT` | thousands/decimal separators per language for animated figures | see trap below |
| `SOCIAL` | per-market social accounts; fallback to the main ones | |
| `STORE` | per-market App Store / Play URLs | App Store URL must carry a country segment (`/xx/app/...`); the country-less URL 404'd on desktop |
| `RATING` | per-market store rating + count, fetched from the store API on a date | Never show a rating a market's store doesn't have; label borrowed ones ("in <country>") |
| `REVIEWS` | real store reviews, verbatim, no names, with a source list | Invented testimonials are banned by EU consumer law (UCPD blacklist) |
| `PARTNERS` / `PRESS` | per-market logos, clips, press contact | Show none rather than an unverified list |

- **Currency sign rule:** pick one per language (e.g. `8 €` with NBSP everywhere except EN `€8`), enforce it with a pass that also covers the SEO data table, and check `_dist/` with a regex. The real build changed this rule three times; write it down and stop.
- **Animated number trap:** count-up scripts rewrite the figure while counting, so dictionaries aren't enough - patch number formatting per language. And figures animate **to `data-to`**: changing the visible text without changing `data-to` brings the old value back after the animation. Static HTML should hold the final value (crawlers read that).
- Big-number abbreviations per language (`M+`, `Mio.+`, `mln+`) live in the table, not in copy.
- **Localised screenshots/mockups:** translate app screens in the design tool (one page of copies per language), export PNG at 3x -> WebP. Why PNG, not SVG: design-tool SVG export lost background blur and turned emoji into boxes. Hide market-specific elements that don't exist in other markets (local bank logos, the wrong regulator's logo). Use `@example.com` in login mockups, never a real mail provider.
- **Per-language download links:** a shared `links.js` rewrites every store/download link to that language's attribution campaign, with page and placement ("spot": nav, hero, footer...) as parameters; incoming `utm_*` passed through; paid click IDs only after marketing consent. Tokens live in the tracking doc, not in this reference. On desktop, download buttons open a QR modal on your own page.
- **Verify QR codes by decoding them** (OpenCV `QRCodeDetector`) per language. A stale "PLACEHOLDER, DOES NOT SCAN" comment sat on working codes and invited someone to "fix" them.

### 1.4 Market-specific legal page pattern (example: Germany)
- **Address form per audience:** consumer pages informal, B2B/press/investor pages formal; make it a per-page attribute the builder respects, per language.
- **Legal notice (Impressum, § 5 DDG):** generated by its own builder from the `ENTITY` table, linked from every footer of that market, noindex not required (it's legitimate content). Missing data (e.g. VAT ID pending) needs an explicit placeholder policy, not a silent gap.
- **Legal documents** (terms, privacy) come from the lawyer's source (docx or a CMS) via a converter; never hand-edit generated fragments. If they come from a CMS at build time, **fail the build** when the CMS is unreachable rather than shipping stale text.
- **The privacy policy must list every web tracker** (tag manager, analytics, ads pixels, deep-link SDKs, e-mail tool, consent cookie with its lifetime). Add a line every time a vendor is added.
- **Double-opt-in thank-you page:** a market-language page, `noindex`, outside the sitemap and machine files, with that market's cookie bar - and special-cased as that language everywhere (see 1.1).
- **Regulatory wording discipline:** name the actual licensed/registered provider and its register entry; never claim a licence you (or they) don't hold ("via <provider>, registered with <regulator>", not "<regulator>-licensed").
- **Launch dates:** keep a future market's launch date in **one** constant used by countdown, JSON-LD, llms, facts. Never hard-code tense ("live", "now available") about a future market. A launch moved three times and each move touched a dozen files - a single constant would have been one edit. A countdown should remove itself at midnight local time on launch day.
- In jurisdictions where loading the tag manager itself needs consent, use Consent Mode **basic** there (section 5).

### 1.5 Hidden pages per version
- One flag in the SEO data table: `hidden=True` -> `noindex,nofollow`, no hreflang, out of sitemap/llms/llms-full/facts, all internal links removed. Plus `hidden_langs` for per-language noindex (e.g. legal pages that are still placeholders in one language - remove the flag the day they're real).
- Closed-funnel pages (invite landings): noindex, no menu/footer links.
- Store requirements override "hide": e.g. Google Play requires a public account-deletion page.

### 1.6 Translation QA
- **LanguageTool, run locally** (Docker/jar; no text leaves the machine) on visible text blocks of `_deploy/` per locale (`sk-SK`, `pl-PL`, `de-DE`, `en-GB`), brand words ignored -> report. LanguageTool has **no Czech**.
- **Hunspell** (e.g. `spylls`, pure Python, + LibreOffice dictionaries) for spelling in languages LanguageTool lacks.
- **Optional, Czech-specific:** Korektor (ÚFAL) for Czech grammar/diacritics. Similar national tools exist for other languages; check before assuming none.
- **Native-speaker-style agent review:** one subagent per language reads the rendered pages and returns a table (location, issue, fix, confidence). Filter known false positives first (brand words, house style rules, first-person verbs, heading punctuation conventions). This found bugs no checker sees: "four steps" above a three-step list (in every language), an imperative that should have been a description, wrong-language alt texts.
- Builders print leftovers; the SEO verifier warns on master-language-looking alts/head text in other languages (names allowed via a regex allow-list).
- Keep a translator glossary: legal terms per country, product names per market, **one word per object per language**.

---

## 2. SEO

### 2.1 SEO post-processor design (reusable)
- **One post-processor, one data table:** `seo.py` writes; `seo_data.py` holds every title/description/type/alt/entity. Reviewers review the table, not 300 pages.
- **Idempotent between markers:** everything sits between `<!--seo:start-->` and `<!--seo:end-->` in `<head>`; each run replaces its own block.
- **Trick:** encode non-ASCII in the head block as numeric character references, so i18n builders (which treat master pages as source) neither translate it nor report it as leftover; seo.py writes each language afterwards.
- **Dedup the whole document, not just `<head>`:** drop the page's own title/description/robots/og/twitter/canonical/alternate before inserting the block, and remove stray `<title>`/`<meta>` that ended up inside `<body>` (pages exported from a hosted preview kept the old head inside the body - every subpage had two titles and a stale description).
- Sets `<html lang>` from the file name; enforces one `<h1>` (extras demoted, warned); reports heading skips and vague link texts per language ("click here", "more").
- **Length checks as warnings:** title <= 60 incl. the brand suffix, description 140-160, no em/en dashes in title/description (they render oddly in some SERPs and were a house style rule).
- **Figure-consistency report:** regex patterns for every number you claim (users, transactions, markets, ratings, percentages, "top N", "X of 10") list every visible occurrence per file and language. The single best tool for catching contradictions across 60 pages x 5 languages. Build one for any figure you claim.
- **Independent read-only verifier:** one SEO block per page, `lang` set, JSON-LD parses, title equals table, no dashes, every `<img>` has alt, no master language in translated heads/alts, **every inline `<script>` and `on*` handler syntax-checked (`jscheck.mjs`)**.

### 2.2 Head block per page
title, description, robots (`index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1` or `noindex,nofollow`), self canonical, hreflang for all languages + x-default, og:site_name/type/title/description/url/image (1200x630)/image:alt/locale + `og:locale:alternate` per sibling, twitter `summary_large_image`, theme-color, application-name, `apple-itunes-app`, favicon set + manifest, `<link rel="alternate" type="text/plain" href="/llms.txt">`, JSON-LD.

### 2.3 JSON-LD: one `@graph` per page
- `Organization` (`#organization`): name, alternateName, logo `ImageObject`, description (one summary per language), slogan, founders, `award` (only verified ones), `sameAs` (socials, Wikidata, Crunchbase, store pages), areaServed, contactPoint (support hours per language), `subOrganization` = one Organization per market entity with address, `identifier` PropertyValues, vatID, `url` = that market's home, knowsAbout.
- `WebSite`, page node typed from the table (`WebPage` / `AboutPage` / `ContactPage`) with **`FAQPage` first in `@type`** when the page has FAQ markup (several GEO checkers read only `@type[0]`), `publisher` = the market entity, `dateModified`, `speakable`, `mainEntity` = Question/Answer parsed from the **visible** FAQ.
- `BreadcrumbList`, `MobileApplication` on consumer pages (category, free `Offer` in the market currency, per-market store URLs, `aggregateRating` = the same figure the page shows), `HowTo` from a section's h3 + steps when >= 2 steps.
- **Caveats:** Google no longer shows FAQ/HowTo rich results for most sites - keep them for extraction/GEO, not stars. Markup must match visible content. Google's review-snippet rules discourage ratings aggregated from other sites, so treat store-based `aggregateRating` as a GEO signal, not a rich-result promise. Don't put one market's rating on another market's app node.

### 2.4 Images
- Alt table keyed by `sha1(src)[:10]`, `sig@page`, or `#ancestor-id`; `{'decorative': True}` -> `alt=""` + `aria-hidden`. A `--images` mode lists every image signature with context for the alt-writing pass. Alts in the page's language.
- **width/height from intrinsic size** (parse PNG/GIF/WebP/JPEG/SVG headers) **except** a `NO_WH` list where CSS sizes one axis and the attribute would stretch it. Prove it: render every page with and without w/h at 1280 and 390 px and diff every box. Never add width/height blindly.
- Hero image `fetchpriority="high"`, never lazy; everything else `loading="lazy" decoding="async"` except an exclusion list (nav, menu, above-the-fold carousels).
- One generic 1200x630 OG image without words (language-neutral); favicon set, apple-touch 180, icons 192/512/maskable, manifest - generated by one script (headless Chrome works as an SVG rasteriser if nothing else is installed). Per-page OG images are a nice-to-have.

### 2.5 Sitemap, lastmod, robots, 404, hosting, consoles
- **Sitemap:** indexable pages only, each with hreflang alternates + x-default.
- **lastmod must mean "content changed", not "build ran":** hash each **finished** page's visible content (minus `dateModified`), keep the previous date if unchanged (store fingerprints in a JSON), bump sitemap `<lastmod>` and JSON-LD `dateModified` together; fail if a sitemap URL has no page.
- **robots.txt:** `User-agent: *` `Allow: /` plus explicit Allow groups for AI and search crawlers (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User, Google-Extended, Googlebot, Bingbot, Applebot, Applebot-Extended, CCBot, Amazonbot, meta-externalagent, DuckAssistBot, MistralAI-User, YandexBot/SeznamBot or other local engines) + `Sitemap:` line. The wildcard already covers them; explicit groups are belt-and-braces and document intent. Also check your CDN/WAF isn't bot-blocking them.
- **Soft-404 trap:** a catch-all proxy to the old site answered every unknown URL with 200 and an old indexable page. Fix: proxy only an allow-list of old paths that really exist (diff the old site's URL list), 301 retired sections to home, real `404.html`. A fallback must never answer 200 for unknown paths.
- **Preview hosts:** `X-Robots-Tag: noindex, nofollow` on every host except the production one (header rule conditioned on host). Ignore that header when auditing a preview. Apex -> www (or the reverse), one direction only.
- **Headers:** hashed `/assets/*` immutable 1 year; HTML must-revalidate; app-link association files served as JSON; `/.well-known/security.txt` (RFC 9116).
- **Search consoles:** Google Search Console + Bing Webmaster Tools (+ any strong local engine) verified, sitemap submitted on launch day; consider IndexNow in the deploy step. Expect old URLs to dominate the index for weeks after a relaunch; "Alternate page with proper canonical" for old subdomains is usually fine.
- **Internal linking:** every page one click from its language home; support anchors work through clean URLs (`/support#faq`).

---

## 3. GEO (generative engine optimisation)

### 3.1 What to build
- **`/llms.txt`** (spec: llmstxt.org): H1, blockquote summary, free text including **"Key facts:" as plain text, not an H2** (an H2 of bullets crashed the reference parser `llms_txt.parse_llms_file`), then H2 link lists per language (title + description per page), a **legal/privacy/account-deletion section outside `## Optional`** (tools like `llms_txt2ctx` skip Optional, and trust pages answer "is it legit?"), then the FAQ, then Optional (facts, llms-full). Validate with the reference parser.
- **`/llms-full.txt`:** every published page in the main languages as Markdown, re-derived from `_dist/`; fail loudly if a section has no page or known-stale strings remain; exclude decorative fragments. Note it drops image alts - facts that exist only as logo alts (e.g. partner names) never reach it.
- **`/ai/facts.json`:** **plain JSON**, not fake JSON-LD (a JSON-LD processor drops all non-schema keys). Figures "as stated on site", markets with dates, operating entities with IDs, regulated providers per market, support, awards with sources, apps, socials.
- Optional `ai/summary.json`, `ai/faq.json`, `ai/service.json`, `/.well-known/ai.txt`: non-standard; their value is mostly checker score plus one more clean fact source. Cheap, so fine - but don't mistake them for ranking signals.
- **Copy-level GEO:** answer-first summaries; plain "what it is / price / how it earns money / access model / users / markets / founders / operator" facts on consumer pages; **one boilerplate** reused everywhere (press page, about page, llms, facts).

### 3.2 Lessons
- **Contradictions make AI answers hedge.** Method: a **claim inventory / contradiction table** - one row per claim, columns: claim, every page+language where it appears, the values found, the source of truth, the fix. Typical rows found in the real build (with *invented example values*):
  - market status: "now live in Country X" on one page vs a launch countdown on another;
  - user count: "*300,000+ users worldwide*" vs "*300,000+ users in three countries*";
  - volume: "*40M+ transactions*" on the site vs "*35M+*" in the press kit vs "*45M+*" in a social profile;
  - growth metric: "*70 % of new users come via referral*" vs "*70 % of growth*" (two different metrics);
  - rating: one market's page showing another market's store rating;
  - three different names for the same regulated provider; two different account-deletion processes;
  - an operating entity whose legal name sounds unrelated to the product, never explained (looks like a scam pattern to a model).
  Fix contradictions **before** adding more schema.
- **Perception test beats checker scores.** Fetch the key pages without JS as an AI user-agent would, write the answer an assistant would give from that text only, and list every hedge and its cause. Typical causes: business model missing on consumer pages ("free app that pays you" reads as too good to be true), key condition (withdrawal, fees) buried in FAQ, unexplained operator, unsourced superlatives ("bank-level security"), awards without source links, the weakest true rating shown while a stronger true one exists.
- **Off-site entity data feeds the answers too.** Wikidata, Crunchbase, startup databases, EU/fintech maps, PitchBook-style profiles often carry an old name, founding year or user count. Write the corrections with exact property IDs; on Wikidata declare a conflict of interest. Agents are often blocked from editing these - prepare the text for a human. Add the Wikidata Q-ID to `sameAs` once the item is right.
- **Extractability:** compare `trafilatura` output on static vs rendered HTML. Facts that only appear after JS are invisible to many fetchers. Inline number+label markup (`<b>300,000+</b><span>users</span>`) extracts as "300,000+users"; numbered steps as "1Send". Keep facts in static HTML and put whitespace or block boundaries between number and label.
- Crawler access is necessary, not sufficient: allow-all robots + no bot-blocking WAF + fast static HTML.
- **Never invent GEO signals:** no fake reviews, no fake blog/`Article` just to satisfy a checker, no unsourced "Top 10", no rating not shown on the page, no promised savings amounts. Checkers will dock points for a missing blog/RSS; leave them docked rather than fake it.
- Checker scores seen in practice: two GEO checkers moved from low-80s to mid-90s after the work above. Treat that as hygiene, not proof of visibility.

### 3.3 GEO test protocol
**Be honest about evidence:** the real build verified GEO with automated checkers plus a *simulated* no-JS perception test; no prompts were run and scored against live AI engines before launch. Do better: run steps 1-6 on real engines.

1. **Freeze the fact sheet (answer key):** entity, what it is, price, business model, access/security, users, markets + dates, founders, operator, ratings, awards with source URLs. Every row has a source.
2. **Prompt set** (min. 20 per important language):
   - Brand: "What is <brand>?", "Is <brand> safe / legit?", "Who owns <brand> / <legal entity>?", "How does <brand> make money?", "Is it free?", "Does it work in <new market>?", "How do I delete my account?", "How do I withdraw rewards?".
   - Category (no brand): "best app to <job> in <country>", the same in the local language, "<regulation>-based app that <does X>".
   - Comparison: "<brand> vs <competitor>", "alternatives to <competitor>".
3. **Engines:** ChatGPT (search on and off), Perplexity, Google AI Overviews / AI Mode, Gemini, Claude (web search on), Copilot, any strong local engine. Fresh logged-out session; log date, engine, mode, language, location.
4. **Score each answer (0-2 per item):** mentioned (category prompts) / cited with your URL / facts correct vs the answer key (count wrong facts) / hedges ("may", "unclear", "scam") / which off-site sources were cited.
5. **Diagnose:** wrong fact -> which source did the engine use (site contradiction vs stale off-site data); no mention -> missing category wording/FAQ, or crawl/index gap (search consoles, robots, server logs for GPTBot/ClaudeBot/PerplexityBot hits).
6. **Fix, wait, re-run** the identical prompt set (2-4 weeks for index-backed engines, immediately for live-fetch modes). Keep a CSV per run: `date, engine, prompt, mentioned, cited_url, wrong_facts, hedges, sources`. Compare per engine.
7. **Automated checks each run:** GEO checkers (e.g. geo-optimizer, `@glincker/geo-audit`), llms.txt reference parser, trafilatura static-vs-rendered fact list, schema vocabulary check, the figure-consistency report, `curl -A "GPTBot"` (and other AI UAs) expecting 200 and no `X-Robots-Tag` on production.
8. **Perception test** when you have no engine access (or as a quick pre-check): as in 3.2.

---

## 4. Performance

- **Inline -> hashed assets.** Pages exported from a design/preview tool carried fonts, images and video as base64: ~70 pages, ~85 MB, most of it data URIs of ~110 unique files. An optimizer moves each unique data URI to `assets/<hash>.<ext>`, re-encodes images to WebP (q~82, kept only if smaller), video to H.264 (CRF ~30, max 720 px, no audio, faststart), and moves every `<style>/<script>` > ~1.5 KB into a shared hashed file (the same block on 70 pages becomes one cached file). Result: ~95 % smaller HTML, typical page 60-95 KB. Sources untouched; output to `_dist/`.
- **Image sizing:** serve screen-sized WebP (e.g. 720 px phone screens instead of 1170), `srcset` 1x/2x. **Every srcset candidate and every JS-built asset path must be root-absolute** under nested clean URLs (`/assets/...`): relative candidates broke retina images on every `/xx/...` subpage.
- Lazy-load below-the-fold media; videos load/play only when in view.
- **Fonts:** self-host woff2, preload the main face; use `unicode-range` faces to swap e.g. a mono font for digits only, instead of loading a second family everywhere.
- **Self-host libraries** (smooth-scroll etc.) with versioned filenames - no third-party request before consent.
- **Defer the tag manager** to first interaction or ~4 s after load (a consent click still loads it immediately). Lighthouse showed GTM + GA4 + Ads freezing the mobile main thread 0.5-1.2 s; deferring lifted mobile scores by ~15 points.
- **Perceived speed:** an early inline style paints the brand background at once; `@view-transition { navigation: auto; }` stops white flashes between pages on iOS; `color-scheme: only light` if the design is not built for browser auto-dark.
- **Strip all HTML/CSS comments** from published output - they leak internal notes and partner/vendor names.
- **Measure:** Lighthouse CLI + PageSpeed Insights JSON, repeated runs (throttled runs are noisy), mobile profile. Serve locally with keep-alive + gzip, not `python -m http.server`, for realistic numbers. Typical leftovers worth chasing: long inline scripts on the main thread, animating `width`/`box-shadow` instead of transforms, near-duplicate shell CSS shipped as several files, CLS on hero sections.

---

## 5. Analytics and consent

### 5.1 Consent
- Categories: necessary / analytics / marketing. Store choice in localStorage + a first-party cookie with a version and a stated lifetime (e.g. 180 days). Provide `window.<site>Consent.open()` and a footer "cookie settings" **`<button>`** (a `#` link can be swallowed by a link-rewriting script). Revoking deletes analytics cookies (`_ga*`, `_gid`, `_gat`, `_dc_gtm_*`). Copy in every language; for strict markets add a per-vendor table (provider, purpose, data, retention, third-country transfer).
- **Google Consent Mode v2:** defaults all denied; update sets `analytics_storage` from analytics and `ad_storage` / `ad_user_data` / `ad_personalization` from marketing; push a custom `consent_update` event.
- **Basic vs advanced - the trade-off:**
  - *Advanced* = tag manager loads for everyone, Google tags send cookieless pings before consent -> modelled conversions, better data. Risk: in some jurisdictions (a 2025 German court decision) loading the tag manager at all needs consent; and **Custom HTML tags (non-Google pixels) ignore Consent Mode** and fire anyway.
  - *Basic* = tag manager loads only after analytics OR marketing consent. Less data, simpler legal story. The real build went "tag manager only after marketing consent" -> advanced outside DE -> **basic everywhere** within a week; keep advanced behind a build flag and never enable it for strict markets.
- **Tags only after consent:** every Google tag gets "Require additional consent" (GA4 -> `analytics_storage`, Ads -> `ad_storage`), otherwise a marketing-only visitor sends cookieless GA4 pings in basic mode. Every Custom HTML tag gets an explicit consent trigger. Rejections are never sent anywhere.
- **Every tracker is listed in the privacy policy**, in every language, on the day it goes live.
- **CSP:** enforce a Content-Security-Policy; every new vendor domain needs a CSP line; test legacy app pages **with a real token** (a token-less check never called the API, and a broken page went unnoticed for almost a day).
- Remove SDKs you no longer need from the web entirely, instead of leaving them consent-gated.

### 5.2 Event design
- Write a tracking plan first (event, trigger, parameters, why, owner). Every custom event carries `page` and `lang` parameters; use GA4 recommended events where they fit (`select_content`, `generate_lead`).
- Useful set for a marketing site: download click (placement, store, method link/QR), QR modal open, FAQ open (question), language switch, menu open, nav click, calculator use, contact/lead (mailto by type), social click, scroll 25/50/75/90, section view, 404, JS error (capped, own scripts only), plus game/quiz events sampled at milestones (not every interaction). Keep enhanced measurement for page_view / outbound / file_download - don't double count.
- **Bugs found (generic lessons):**
  1. A link script listening on `document` in capture phase called `stopImmediatePropagation()` for the QR modal, so desktop downloads were never tracked. Listen on `window` in capture phase to run first; verify headless at desktop and mobile widths.
  2. Check the real markup: the FAQ was `button` toggles, not `<details>`.
  3. **dataLayer reset bug:** GTM Data Layer Variables (v2) **persist the last value** between pushes, so a parameter from a previous event leaks into the next. Every `push()` must reset all known custom keys (set to `undefined`).
  4. GA4 event names allow only letters, digits, underscore.
  5. Conversions keyed on store URLs never fired once links went through an attribution redirect - key conversions on the dataLayer event, not URLs.
  6. Pushes before consent are dropped unless the tag manager replays the dataLayer on load - know which applies.
- **GA4 admin:** register event-scoped custom dimensions **on deploy day** (they don't backfill); mark key events once GA4 lists them; add attribution/redirect domains to unwanted referrals; enable BigQuery export early.
- **Ads conversions from the web:** a "web download click" is a **secondary** conversion, never a bidding goal, if your real goal is measured in-app via an attribution tool.
- **Deploy together:** the tag-manager version with matching triggers is published at the same time as the site deploy that emits the events; QA in DebugView for analytics-only, marketing-only and necessary-only visitors.

---

## 6. SEO/GEO launch checklist

**Content and facts**
- [ ] Claim inventory done: every figure has one value across pages, languages, JSON-LD, llms, facts.json; consistency report clean; future-market tense driven by one date constant.
- [ ] No unsourced superlatives, ratings or awards; ratings per market match the store on the day; awards have source URLs.
- [ ] Business model, operator identity and key conditions (withdrawal, fees, deletion) stated plainly on consumer pages.
- [ ] Language QA: LanguageTool (local), Hunspell / national checker for languages LT lacks, agent native-speaker review; no master-language leftovers in variants.

**Per page**
- [ ] One `<title>` (<= 60) and one description (140-160) in the **whole document**; one h1; correct `<html lang>`.
- [ ] Self canonical = served clean URL = og:url; hreflang reciprocal + x-default, language codes (`cs`, not `cz`); hidden pages noindex and out of every machine file.
- [ ] JSON-LD parses, types match visible content, FAQPage first when an FAQ is present.
- [ ] Every img has an alt in the page language or is decorative; width/height proven by a render diff; hero eager + `fetchpriority`, rest lazy.
- [ ] Inline scripts and handlers pass `jscheck.mjs`; console clean at 390 and 1440 px, before and after consent.

**Site files and hosting**
- [ ] robots.txt allow-all + AI crawler groups + Sitemap; sitemap only indexable URLs with lastmod from finished pages; llms.txt parser-valid, legal section outside Optional; llms-full and `ai/*.json` re-derived from `_dist/`.
- [ ] Real 404, no soft-404 via proxy fallback; legacy/store paths 200 or 301 as intended; one canonical host; preview hosts `X-Robots-Tag: noindex`; security headers + CSP tested incl. token-bearing legacy pages.
- [ ] Assets content-hashed + immutable cache; srcset and JS asset paths root-absolute; comments stripped.
- [ ] Search consoles verified, sitemap submitted; check indexing of the new URLs a week later.

**Analytics**
- [ ] Consent defaults denied; nothing tracks before consent; basic mode where law requires; every Google tag has additional consent; Custom HTML tags gated; every tracker in the privacy policy.
- [ ] Events on every page; tag-manager version published together with the deploy; custom dimensions registered the same day; DebugView QA for each consent state.
- [ ] Download links carry per-language campaign + page + placement; QR codes decoded per language.

**GEO**
- [ ] Baseline run of the GEO test protocol on **real engines** before launch, re-run 2-4 weeks after; off-site entity profiles (Wikidata, Crunchbase, directories) aligned with the boilerplate.

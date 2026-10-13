# 02 - Design system, typography, mockups, imagery, motion, components

How a multi-language marketing site (typically for a mobile app) should LOOK and MOVE, distilled from a real production build. Each lesson is: rule, why (the incident that taught it), where it lives in the suggested layout.

Folder names follow the layout in `01-architecture-pipeline-deploy.md` section 2:
- `site/src/` - hand-edited source pages in the master language (tokens, components, inline JS); `site/src/assets/` holds the runtime files the injectors insert (typo.js/css, mobile.css/js, links.js).
- `site/i18n/` - translation dictionaries; language versions are GENERATED from the source.
- `build/injectors/` and `build/passes/` - idempotent scripts that transform the source (typography injection, review fixes, font subsetting, image swaps).
- `design/` - originals that are never served: mockups, icons, logos, awards, fonts.
- `qa/` - headless-browser measurement harness (overflow, contrast, line breaks, nav state, dark mode).
- `site/_dist/` - build output, never hand-edited.

Put long comments above non-obvious CSS rules explaining WHY (incident + what was tried). Before changing a rule, read its comment.

Read with: `01-*` (build/publish pipeline) for how passes are chained.

---

## A. Generic principles

1. **Design tokens are redefined per ground, never per element.** A section class (`.on-deep`, `.on-accent`, `.card-light`) redefines `--ink`, `--ink-2`, `--ink-3`, `--rule`, `--accent`; children only ever read tokens. Setting only `color` on a ground leaks the parent's tokens into children (real bug: white secondary text at 1.17:1 on a light accent band, live on four pages).
2. **The MINIMUM of a `clamp()` is the number that matters on phones.** At 390 px every display size sits on its min; trimming the max changes nothing on a phone.
3. **Display sizes = rem base + small vw slope, never pure vw.** Pure vw grows exactly as fast as its box, so a heading wraps identically at every width and looks like an image of text. Example: `.xl{font-size:clamp(2.375rem, 1.5rem + 3.05vw, 4.25rem)}`.
4. **Line breaks are a runtime concern when copy is translated by text matching.** Never hand-insert `&nbsp;`/`<br>` into source copy that an i18n builder matches by exact text; do it in a runtime script on the rendered DOM (see D1).
5. **Fix a bad asset in the ASSET, never with a blend mode.** `mix-blend-mode:multiply` only hides the outer white rectangle; white stays inside letter counters and around badges. Un-matte properly in Python (alpha = inverted luminance, or a circular mask for round medals with specular highlights).
6. **Never patch translated text onto a raster screenshot.** It always reads as pasted-on paper. Localise at the source (design-tool text layers) and re-export. (It was done once more under deadline pressure and replaced within days.)
7. **Real product screens beat drawn mockups.** CSS-drawn phones with invented UI (tab bars, chips, generated screens) get caught every time by the people who know the app.
8. **Every `<img>` gets real `width`/`height`; nothing above the fold is lazy.** A lazy img with no size is 0x0 until decode, its row collapses and the layout looks off-centre.
9. **`srcset` candidates must be root-absolute** when pages live in language subfolders. `assets/x.webp 1170w` on `/sk/some-page` resolved to `/sk/assets/x.webp`, the host answered 200 text/html (SPA-style fallback), and every retina phone showed alt text. Rewrite to `/assets/...` in the deploy step.
10. **Source order beats media queries at equal specificity.** Append overrides after the rule they override (e.g. `mobile.css` injected after `typo.css` on purpose). A later generic `.qr-rail img{width:96px}` blew a small reward icon up to QR size at 900-1100 px.
11. **Measure, don't eyeball.** Overflow, contrast, line breaks, nav state and tap targets should be measured by a headless-browser harness across a page x width matrix. A spot check on one page/width missed a nav bug that failed in 18 of 24 combinations.
12. **One motion system per element.** Two movements at once is the bug (screenshot swapping while the phone itself scrolls; native smooth scroll on top of a smooth-scroll library; a screen lerp lagging behind its copy).
13. **`prefers-reduced-motion` turns every motion system off, and with JS off nothing is hidden.** Parked/hidden states (`is-out`, `is-live`) are added by script, never by the stylesheet.
14. **No `will-change` by default; prefer `transform` over `top`; avoid `filter: drop-shadow` on large animated elements.** A double drop-shadow on the hero phone cost 133 ms/frame without GPU raster; one `box-shadow` replaced it.
15. **A finished site carries no build notes, no placeholder warnings, no internal jargon in visible copy.** A stale "PLACEHOLDER, DOES NOT SCAN" comment next to a working QR invited someone to "fix" it; a footer once told visitors about "copy notes".

---

## B. Design tokens (example palette)

The values below are illustrative (not any real brand's palette); what carries over is the token SHAPE that worked: a single brand hue scale, one high-energy accent for CTAs, status colours, a grey ramp, and separate ink sets per ground. Swap in your own brand.

**Colour (take values from the brand manual / design file, verified, not eyedropped):**
- Brand scale (light to darkest): `--brand-1:#D6E4F7` `--brand-2:#AFC8EE` `--brand-3:#6E97DB` `--brand-4:#3F6FC6` `--brand-5:#2A55A3` `--brand-6:#22447F` `--brand-7:#0F2A5C` `--brand-extra-dark:#0A1B3B`.
- Dark surfaces: `--dark-surface:#3A4E73`, `--dark-surface-2:#4A5F86` (hover step; mark tokens you invent vs. manual tokens).
- Action: `--action-primary:#FFB547` (accent, every primary CTA), `--action-secondary:#FFFFFF`, `--action-tertiary:#EEF3FB`.
- Status: `--positive:#1E9E63` / `--positive-light:#E6F5EE`; `--negative:#E5484D` / `--negative-light:#FDECEC`.
- Greys: `--grey-50:#F6F7FA` `--grey-100:#ECEEF3` `--grey-200:#DDE1EA` `--grey-400:#A3AABA` `--grey-600:#626B7D`.
- Ink on light/accent: `--ink:#0F2A5C`, `--ink-2:rgba(15,42,92,.72)`, `--ink-3:rgba(15,42,92,.78)`, `--rule:rgba(15,42,92,.14)`, `--rule-2:rgba(15,42,92,.28)`. The tertiary tint started at .64 and was raised after "small text is hard to read": one token feeds every tertiary label, so one edit fixed the whole site.
- Ink on deep: `--on-deep:#FFF`, `--on-deep-2/-3:rgba(255,255,255,.72)` (raised from .55). A later legibility pass forced pure white inside `.on-deep` and `footer` for 1x monitors; if you do that, update the `:root` table too, or the tokens stop describing what renders.
- `--accent:var(--brand-4)` on light, `var(--brand-2)` on deep (the mid-dark brand step is unreadable on the darkest ground).
- Never hard-code a near-miss of a token in a pass script (a `#FFB84A` crept in next to the real accent `#FFB547`). Grep for off-token hex values in QA.

**Grounds (classes):** decide the page ground once (here: dark brand colour end to end). `.on-deep` and `.on-tint` alternate so sections separate without a light band; `.on-accent` (accent band), `.on-light`, `.on-white`, `.card-light` (light panel on deep, resets ink to dark). Give `body` an explicit background.

**Type scale (one sans family):** body `15px/1.55`; `.body 1.0625rem/1.6` (raised 15 -> 17 px after "texts too small"), `max-width:64ch`, `text-wrap:pretty`; `.tiny .8125rem/1.5`; `.sm 700 .9375rem/1.467` and `.md 700 clamp(1.25rem,1rem+.6vw,1.5625rem)/1.27` taken verbatim from the brand manual's body-emphasised and headline styles; `.lg 700 clamp(1.9375rem,1.25rem+2.5vw,3.5rem)/1.04, -.032em, balance`; `.xl 700 clamp(2.375rem,1.5rem+3.05vw,4.25rem)/1, -.036em, balance`. `.num` = 700, `tabular-nums`, `-.015em`.
- "Make all type smaller, but not the smallest" means: move only display steps (`.xl/.lg/.md`), protect `.sm/.body/.tiny`. Display steps came down twice (once to about 68 px at 1440).
- Minimums that survived review on 1x monitors: small copy on a dark ground >= 15 px, plain white, weight 500 (bold inside stays 700). No `text-shadow` behind hero copy.

**Layout / spacing:**
- One fluid page measure: `--page:min(1720px, max(1340px, 86vw))`. A stepped version made laptop and big display look like two different designs.
- `--pad:clamp(20px,4vw,52px)`, 64 px at >= 2000 px.
- Section padding `clamp(48px,8.3vw,120px)` everywhere, 48 px on phones. One page with 150-168 px read as holes.
- `.wrap{max-width:var(--page);margin:0 auto;padding-inline:var(--pad)}`.
- Three-column flow with the phone always centred above 900 px: `--flow-cols:minmax(0,1fr) clamp(212px,23vw,330px) minmax(0,1fr)`.

**Breakpoints:** have ONE desktop/mobile switch (here 900 px) that every component keys on (sticky hero sequence, QR rail, download rail, carousel). Expose it as a CSS custom property (`--flow-live`) that JS reads, so JS never re-declares the breakpoint: `innerWidth` counts the scrollbar and media queries don't, and at exactly 901 px they disagreed. Other steps actually needed: 1100/1180 (rails narrow, menu tiles 4-up), 620 (nav language pill hides), 560, 480, 400 (small phones), 374 (hide the header download button so a 360 px Android does not cut the menu button), 2000.

**Radii / shapes:** pill buttons (`height:46px; padding:0 22px; border-radius:100px; font 700 .875rem; white-space:nowrap`, allowed to wrap below 320 px); menu tiles 18 px (16 on phone); cookie card 20 px; phone corner radius = 0.145 x body width (the real iPhone ratio; 0.11 reads as a generic Android slab).

**Focus / selection / scrollbar:** `:focus-visible{outline:2px solid var(--brand-4);outline-offset:3px}`, swapped per ground (dark on accent, accent on deep). `::selection` accent on the darkest brand step. Scrollbar thumb tinted to the ground.

---

## C. Fonts

- **One family for text** (a variable sans with weights 400-700), `font-display:swap`, subset with the font vendor's own `latin` + `latin-ext` `unicode-range` splits (check the licence, e.g. SIL OFL, allows self-hosting). Fallback: `'Brand Sans', -apple-system, 'Segoe UI', Arial, sans-serif` in a `--font-sans` token.
- **Self-host.** A third-party font CDN loading before consent is a privacy finding. Options: embed woff2 as base64 `@font-face` in source, then have an optimiser lift every data URI into a content-hashed file in `site/_dist/assets/` and add `<link rel="preload" as="font" type="font/woff2" crossorigin>` for the files each page actually uses.
- **Diacritics:** `latin-ext` covers Czech/Slovak (ěščřžýůďťň) and Polish (ąćęłńśźż); German umlauts/ß are in `latin`. Open heading line-height slightly for stacked diacritics. Never use a fallback or old brand face inside rendered assets (a raster patch once used the new face for text but the retired one for numbers).
- **Monospace digits, the lesson:**
  - Monospaced figures everywhere read as generic/templated; default all numbers to the sans + `tabular-nums`.
  - A brand manual may want a slashed-zero mono for numbers. Applying it as extra faces of the main family limited to `U+0030-0039` turned EVERY digit site-wide mono with no markup change, which looked bad inside running text within hours.
  - What worked: a separate family (e.g. `'Brand Digits'`, mono 400 for weights 100-450, 500 for 451-900, digits only, subset with fontTools) applied ONLY to standalone numbers via an explicit selector list (`.num, .fig>b, .badge b, .calc-sum b, .steps>li>b ...`); legal pages explicitly reset to the sans. Make the build fail if a page lacks the digits block.
  - Rule: **mono = a number standing on its own (stats, calculator, reward amounts, step numbers). Never in sentences, never in legal text.** Apply the same rule in decks, widgets and e-mails.
- **No handwritten/script fonts** anywhere.

---

## D. Typography rules

**D1. Runtime line breaks (`site/src/assets/typo.js` + `typo.css`, injected by an idempotent `build/injectors/inject-typo.py`).** Goal: more characters per line, headings broken at sentence boundaries where possible, no short word stranded at a line end.
- Every `h1, h2, .xl, .lg, .md, .pull-quote p` (excluding menu, phone screens, rails, footer, legal, FAQ answers) is split into one `<span class="sent">` (`display:block`) per sentence: **one sentence per heading line**. Short lead paragraphs too (hero body, section-head body, CTA body), only if <= 260 chars and <= 3 sentences. Long running text flows normally.
- A period after a digit is not a sentence end ("10. Section", "from 1. October" in languages that write ordinals with a dot).
- Insert U+00A0 (no-break space) after: one-letter words, short prepositions and conjunctions per language (keep cs/sk/pl/de/en regex lists in the script; apply twice to catch chains like "a v"); between digit groups ("40 000"); between a number and its unit (`Kč, €, EUR, zł, PLN, %, M+, min, h, days...`); inside the product name so it never splits.
- Second widening round after a stray word still ended a line: longer prepositions/conjunctions/short pronouns per language (+ English a/an/I), the first word of every sentence (also across element borders), number + word, ordinal + word, "50 + 25", postcodes.
- Only split elements with no element children (text-only), so markup inside headings is safe.
- CSS: widen caps (`.body` 44 -> 64ch, section heads ~34ch, hero ~26ch, CTA ~32ch); `text-wrap:pretty` on `p, li, summary, .sent, figcaption, cite` (no lone last word); headings keep `balance`.
- **Why runtime:** language versions are built by exact text-node matching against the source; editing source copy to add `&nbsp;`/`<br>` breaks every translation silently. So: **never hand-insert `&nbsp;`/`<br>`** into sources.
- After changing typo.js/css re-run the injector AND every i18n builder (generated pages only get the block through their builders).
- Never put page CSS inside the injected block: the injector rewrites it and once wiped page CSS (broke two pages). Page-specific CSS lives in its own `<style data-page-pass>` before the injected block.
- Measure with a line probe in the QA harness (every text block; flags short word at line end, sentence start at line end, number split from unit, orphans): 60 -> 5 findings at 1440 and 102 -> 18 at 390. Remaining false positives: numbered legal headings, long German compounds, narrow hero column in long languages.
- Regex gotchas: write regexes as JS literals (a lost backslash turned `\s` into "s"). When editing JS from Python, write snippets via a quoted heredoc file and use raw strings; `"\b"` in a normal Python string is a backspace.
- Reuse the same rules for decks (no sentence splitting), e-mails and PDFs. Don't re-invent per channel.

**D2. Heading wrap, why the current settings:** headings "falling apart into lines" came from `balance` inside narrow 15-20ch caps forcing 3-4 lines; widening caps fixed that, then `pretty` left one-word last lines, so back to `balance` with wide caps, then sentence splitting (D1).

**D3. Language length.** German runs longest (compounds, longer phrases). Check every component per language, not just the primary one: a German banner body collided with the phone at 26-28 px; a German pill overlapped the trust line; three German pages scrolled sideways at 320 px until buttons were allowed to wrap and `html` clipped horizontal overflow. A manual break chosen at one font size silently re-wraps at a bigger one: check characters-per-line capacity at the final size.

**D4. Currency and numbers.** Decide once, write it down, enforce it in the build; it flipped three times on a real project.
- Example rule that stuck: euro AFTER the number with a no-break space in CZ/SK/PL/DE (`8 €`, `1 400 €`), English before with no space (`€8`). Local currencies always after (`200 Kč`, `30 zł`). A build check scans `site/_dist/`: no `€\d` outside EN, no `\d €` in EN.
- In the English version of a non-euro market, show both: "€8 (CZK 200)".
- Count-up figures are re-formatted by JS while counting, so dictionaries alone are not enough: give the i18n builder a per-language formatter (thousands U+00A0 + decimal `,` for cs/sk/pl; `.` + `,` for de; `,` + `.` for en; en `%` without a space, "80%"). Animated figures read `data-to/data-prefix/data-suffix/data-dec/data-group`; change `data-to` when the number changes or the old value comes back after the animation.
- Store ratings differ per market store; show the local one.
- Fix one spelling for product terms and never decline or split the brand name.

**D5. Dashes and emoji.** Pick a dash policy and enforce it (a write hook can block em/en dashes). No emoji in website copy; replace with a matching 3D icon, a numbered step, or a short accent rule.

**D6. Copy that bites the design:** consistent term per language for the gamified mechanic (avoid words with negative connotations like "challenge" if the brand is light); everything positive, nothing is anyone's fault; one consistent voice (e.g. first person singular product voice) also in mockup alts.

---

## E. Grounds, contrast, light/dark, accessibility

- **Opt out of browser auto-dark if the site has a fixed look.** Android Chrome / Samsung Internet auto-dark darkened the page but not the app screenshots. Fix: `<meta name="color-scheme" content="only light">` + `:root{color-scheme:only light}`. Test with a forced-dark screenshot script (before/after folders).
- **"Brand-colour text on brand-colour ground, everywhere":** programmatic contrast over all pages may find nothing failing WCAG (blind spots: text over images, hover/open states). What answered the complaint was raising the secondary tint tokens. Lesson: **when a stakeholder says "everywhere", raise the token, don't hunt the instance.**
- Contrast bugs worth checking: hero trust line at 55 % white 12 px (-> 72 %/14 px); FAQ pills with an invisible translucent border; white body text on the accent band; copy under a rotating decorative mark; grey surface cards on a coloured ground (use a brand step instead of neutral grey).
- **A11y pass (axe-core + html-validate):** decorative falling game elements `tabIndex=-1` inside an `aria-hidden` container; demoted visual headings get `aria-level`; language menu `role="group"`; `<meta charset=utf-8>`; legal TOC heading levels; carousel keyboard access; focus trapped inside the open menu. Localised `alt` on every image (generated from the dictionaries); decorative marks `alt=""`/`aria-hidden`; award marks carry their name only in `alt`. Figures deliberately not focusable. Tap targets >= 44 px. Target: Lighthouse a11y 100 on every page.
- **Reduced motion** has to be handled per system (expect 20+ blocks): smooth scroll skipped, game off, nav transition off, hero mark static, carousel transitions none, logo train stopped and wrapped, small looping badges still.

---

## F. Phone mockups and app imagery

**F1. Rules:**
- Use the **final app screens from the product design file**, never generated or CSS-drawn screens. Keep translations on a dedicated page in the design file (screens x languages, e.g. 6 x 5 = 30 frames), never edit the product designers' own pages. Who decides which frames are final is a product/marketing call; agree it up front.
- **Export 3x PNG (1170 x 2532), not SVG.** Figma SVG export drops background blur on glass tab bars/bottom sheets and turns emoji into black boxes. Web gets WebP (q82-90) at ~720 + 540 px via `srcset`, real width/height, `fetchpriority="high"` on the hero shot.
- **Every mockup has the real bottom tab bar** (a screen without it looks wrong to anyone who uses the app), using the design system's real tab-bar instance with translated labels and the right tab active. Exception: screens that have none in the app (login). A tab bar drawn by us was rejected immediately (wrong icons, and it hid the screens' real CTAs).
- **Screens are square-cornered; the phone frame does the rounding.** A screen with baked rounded corners showed a seam.
- **Localise every screen per market:** language, currency, local bank/partner lists (hide logos you don't have per market), regulator line only where it is correct for that market. Never English UI on a non-English page.
- **Pick screens whose content does not contradict the page** (e.g. a wallet screen showing a minimum withdrawal threshold next to copy promising a small reward). Sample data uses `@example.com`, never a real provider domain.
- **Different screen per page/slide.** Three pages with the same hero screen read as a stock template.
- **Flat and sharp.** Tilted/3D phones were dropped. Never sharpen a soft screenshot with an unsharp mask; re-export at 3x instead.

**F2. Pipeline:** design-file export -> `design/mockups/png3x/<lang>-<screen>.png` -> `apply_mockups.py` overwrites the source images the i18n builders read (same names, same aspect) and any primary-language screen embedded in source pages (matched by exact bytes/base64). Draw the phone frame as a vector/at export resolution rather than upscaling a raster chassis. Keep `backup-old/`. Re-runnable: re-export -> run -> full build. Verify by matching every page x language combination.
- Compositing into a pre-rendered framed phone: find the screen rect once (`fit.py`, template match >= 0.98), paste with a mask so chassis, corners and camera cut-out stay intact.
- B2B / investor pages get the same real framed screens per language; CSS-drawn phones there had wrong-market content.
- Decks reuse the same screens by perspective-warping them into each deck's phone.

**F3. The CSS phone (hero):** 9:19.5 chassis, edges, hardware buttons, camera island, glass reflection, coloured backlight on the stage wrapper (not inside any transform, or it rotates and clips), a near-black shadow (a same-hue shadow on a dark ground does not read). Width `--phone-w:clamp(232px,min(23vw,36svh),306px)` so it caps on whichever axis binds. Crop trick: `height:102%; object-position:top` to cut a baked banner at the bottom. Each screen panel clips itself (`overflow:hidden`) so subpixel transforms never show a sliver of the next screen.

**F4. Typical evolution (and the wrong turns to skip):** placeholder mockup with real tokens -> raster text patching for translations (rejected on sight) -> blurry hero from a soft export (fixed by 3x re-export) -> drawn placeholders replaced with English master screens -> designer's localised rasters -> patched bank lists on rasters (no source files) -> final design-file screens in every language. Skip straight to the last step if the design file exists.
- Watch: screenshots rendered from too small a source look soft on retina (measure rendered px vs source px); badges overlapping headlines mid-animation; the hero phone appearing seconds late on mobile (preload, no lazy).

---

## G. Icons, logos, awards

- **3D icons come from the design file, never redrawn.** They are usually bitmaps inside the design tool, so the usable source is the large (1024 px) background-removed PNG, not an SVG wrapper. Flat UI icons are true vectors: export SVG.
- Low-res copies (256 px) look soft when scaled; `*-transparent.png` copies may have broken alpha (highlights see-through). Cut from the opaque original. Make translucent icons opaque.
- **Don't swap a whole icon set without a side-by-side.** A swap to the "official" set was fully reverted the next day because the previous icons were preferred. Before any swap, dump every icon-like embedded image to a contact sheet (`sheet3d.py`) and get a yes. Note any build step that anchors on icon hashes; changing those icons breaks it.
- **Icons vs mockups:** an icon is either clearly apart (>= ~30 px at 1x) or deliberately in front (>= 1/3 over the phone, away from key UI), never grazing the edge. Automate this check for generated creatives.
- **No icon where the set has none.** If the set covers 6 of 8 menu sections, use none; a half-iconed list reads broken.
- **Third-party logos are SVG** where one exists (a raster logo looked tiny). Partner strips per market, sources and doubts in `design/logos/logos.json`; take logos from each company's own site. Logos ride on near-opaque white chips (a translucent "fogged" chip made them unreadable), height-normalised by cap height not width, `pointer-events:none` (not links; a hover lift made them look like buttons). When a partner is dropped, remove it everywhere including HTML/CSS comments (strip comments from `site/_dist/`).
- **Award badges:** organisers' own sources, newest first, a verified list in one data file. Each mark on a white chip, sized per aspect ratio for equal optical weight (wide 3.7:1 wordmarks small, near-square seals large), title only in `alt`. Fix mattes in the asset (white-matte removal, circular mask). Upscale small seals from the largest original available (one went 90 -> 270 px because it was blurred on every phone). Generate press thumbnails from the logo when the source page has no og:image.
- Public-funding logos (EU programme marks etc.) only in the markets where they apply, with alts in the right language (a primary-language page once carried another language's alts).
- **Brand marks:** official SVGs only; never hand-type the wordmark as text. Store badges: flex rows with SVG marks (hand-placed SVG text sat off-centre); measure path bounds for the viewBox (a wrong one clipped the Apple mark).

---

## H. Components

**Auto-hiding nav (fixed, no background on top).** Rejected along the way: gradient/blur scrims (twice), logo recolouring over light sections ("it keeps changing"), a static solid bar. What stuck: `.nav--away{transform:translateY(-100%)}` slides it up on scroll down and back on any real scroll up; solid ground once past the hero; held visible across the top 140 px (`TOP_HOLD`); 6 px `DEAD_ZONE` for smooth-scroll momentum tails; held open while the menu or language popover is open via a `MutationObserver` on `data-open` (a capture-phase click listener read stale state and failed 18/24 combos); re-baselined after in-page jumps. `.3s cubic-bezier(.4,0,.2,1)`, none under reduced motion. Test all pages x 2 widths.

**Menu overlay (fintech-app style).** Three tiers: (1) page cards with real 3D product visuals; (2) "Jump to" this page's sections, each row with a down arrow; (3) quiet groups with grey headings the same size as links (no tiny uppercase labels). Consumer pages only; company links live in the footer. Card fill a brand step, hover one step lighter. Compact rows, icon first: 2-up desktop, 4-up tablet, 2-up phone (268 px squares were "giant tiles"). Home = the brand mark top-left opposite the close button, on every page (on the homepage it scrolls to top). Language switch = ONE segmented control in the overlay bar (five loose pills read as five controls). Gotchas: `.menu-top{width:100%}` is load-bearing (auto margin on a flex item overrides stretch); an overflowing column flex must start at the top or the first card is unreachable; pack grid rows to the top; stop smooth scroll while the menu is open.

**Language switcher.** Glass pill + popover in the nav, hidden below ~620 px where the overlay carries it. Links generated per language.

**Footer.** Per-market operating entity and registration numbers (data file, not hand-typed); imprint link where the law requires one. Two columns on phones (cut page height ~1 600 -> 1 200 px). Local social accounts per market. Cookie-settings button aligned with legal links.

**QR rail (desktop > 900 px).** Fixed card on the right edge, only a ~58 px peek visible (44 px at <= 1100); hover/focus pulls it in; accent reward badge near the left edge; narrows rather than disappears below 1100 (a 1280 px laptop at DPR 1.6 is ~957 CSS px). An animated "fly into the section" effect glitched and was turned off; the rail now fades while the referral section is on screen. Every download CTA on desktop opens a QR modal on your own page (never redirect desktop users to an app-store/attribution URL); phones keep the direct attribution link. QR codes are real (`segno`), per language, decoded back in the build to verify.

**Mobile store-badge rail (<= 900 px).** Fixed bottom bar after the hero, showing only the visitor's own OS store + the reward line, steps aside over the footer (`body.at-foot`), explicit height (percent heights in an auto parent made it 222 px tall).

**Hero (desktop).** One pinned scroll sequence, two tracks (copy + phone screen) driven by the same `q ∈ [0,1]`, smoothstep with a hold at each step, screens quantised so the device never rests between two screenshots. Stack screens and cross-fade (`.fs.is-on`) rather than sliding (half screens showed for .82 s). If an i18n builder anchors on exact markup (`<div class="fs" data-screen="N"`), add no class there. Decorative chips dropped below 1100 px.

**Mobile carousel (< 900 px).** A swipeable scroll-snap row of phones cloned from the localised phone, each with its own step copy, dots + arrows; height follows the active slide, neighbour copy hidden, cross-fades (fast sliding read as "jerky"). Optional auto-advance (~3.2 s) only while visible, stopped for good once the user touches a dot.

**Gamified element (e.g. a catch game).** A branded 3D object drifts down, tap to catch; fixed to the viewport below nav and menu z-index, pauses on menu/hidden tab, off under reduced motion; irregular 8-24 s gaps; ~60 px on phones (bigger overlapped headings); upright fall with gentle sway (in-plane spin looked like flipping); first-time hint bubble; a short payoff (a tip) after a low count (20 worked better than 100 or 500); counter above the mobile store rail; plural forms per language. Exclude B2B, legal and invite pages.

**Interactive reward demo.** Picker of a few example rewards, yes/no stage, item drops into a wallet with a sprite burst; a celebratory gradient token allowed only here; `setTimeout` fallback because rAF never fires in a background tab.

**Figures, awards band, partner train.** Figures count up on view (beware odd mid-count values). Logo train: JS clones sets until wider than the strip, constant px/s speed, masked ends.

**FAQ accordion.** First item open; height re-derived on `document.fonts.ready`, load, resize and a ResizeObserver (a one-time measurement left the first answer clipped until hover). Centred ~780 px column, left-aligned text. Content can come from a CMS.

**Launch countdown (new market).** A pill under the hero download button on that market's homepage only, with a date label (no running clock, which reads as pressure), removed by script at local midnight on launch day. Keep the date as ONE constant in one pass script; launch dates move (one moved three times).

**Cookie bar.** White card bottom-left, ~420 px max, radius 20 px, dark text, accent "accept all", dark "save", underlined "more", deep shadow; full width minus 16 px on phones. Equal visual weight rules from your consent law apply.

**Level/XP badge.** A small mono tag + accent progress bar reused across web, e-mail signature and social banner; fixed colour regardless of ground; bar fills on load; still under reduced motion.

**Other:** legal pages get a plain TOC list (a document, not a card grid) with `scroll-margin-top`; legal tables scroll sideways on phones; press clips become a swipe row on phones; awards 2-up on phones.

---

## I. Motion and smooth scroll (Lenis)

- Pin the version (e.g. `lenis@1.3.x` exact) from a CDN or self-host; `new Lenis({autoRaf:true})`, expose as `window.__lenis`. Chosen over heavier background-effect and scroll-reveal libraries because the page already had IntersectionObserver reveals.
- Tuning after "jerky scroll" on trackpads: `lerp 0.16` (the 0.1 default stacked on trackpad inertia feels floaty); `html{scroll-behavior:auto!important}` (native smooth scroll must never run on top of Lenis); enable only on fine pointers (on touch it only adds non-passive listeners); stop while the menu is open; include the library's official CSS.
- Side effects to plan for: `scrollIntoView()`/`scrollTo()` leave `scrollY` at 0 in headless tests (use real wheel events); same-page anchors must go through `lenis.scrollTo`, closing the menu first; pages without a `#hash` must be forced to top after first paint, and pages with a hash re-aligned after fonts/lazy images/typography script settle (people kept landing mid-page).
- Curves: ~.82 s settle for screen changes (.52 s felt abrupt; past ~1.2 s the screen trails the text); slide-ins overshoot slightly (landing, not gliding), play both ways with a 0.28 threshold and -12 % bottom root margin to avoid flicker.

---

## J. Stakeholder taste, turned into generic lessons

**Usually rejected (don't propose without a reason):**
- Nav scrims and colour-shifting logos; anything in the nav that keeps changing.
- Monospace numerals in running text.
- Neutral grey cards on a brand-coloured ground.
- "AI slop" layouts: eyebrow labels, status pills, emoji badges, grids of identical boxes, gradient accent framing.
- Handwritten fonts, emoji, unsharp-masked screenshots, raster text patches.
- Invented UI (fake tab bars, generated screens) and wrong-language UI.
- Tilted 3D phones; pure-vw headings (they look like images).
- Text too small anywhere (expect this complaint repeatedly; set generous minimums from day one).
- Visuals with no text at all where a message is expected; mascots that outlived the brand.
- Build notes, segment labels ("B2C") or placeholder warnings on visible pages.

**Usually liked:** a nav that slides away; real app screens with the real tab bar; accent pill CTAs consistent with the app (pills are fine when they match the product, generic templating is not); polished 3D/game moments.

**Process:**
- After a visual is rejected as generic, ask what exactly to change before a second redesign.
- On "update/fix", never restyle an existing piece. "OK" means leave it as is.
- When the report is "everywhere", fix the token.
- Expect reversals (icon sets, currency position, tab bar presence): keep the previous version restorable and record the decision with its date.

---

## K. Visual bug catalogue (symptom -> cause -> fix)

- Black rectangle under a testimonial -> bare `<footer>` inside the component hit the global `footer{background}` -> use `<cite>`. Never reuse page-level element selectors inside components.
- Headline crushed over copy on phones -> desktop `grid-column:3` on a one-column grid created implicit columns -> put both panes in column 1 under the breakpoint.
- Dark line at the bottom of a screen mid-slide -> baked shadow in the export + subpixel transform -> clip each panel, crop at 102 %.
- Home link parked next to the close button -> auto margin on a flex item overrides stretch -> `width:100%`.
- Language row squashed to 0 height on phones -> flex item shrinking in an overflowing column -> `flex-shrink:0`.
- Game stopped site-wide -> `\1` in a non-raw Python replacement = byte 0x01 in an inline script -> raw strings + `node --check` every inline script.
- Nav never came back after closing the menu -> capture-phase listener read stale state -> MutationObserver.
- Small icon as big as the QR at 900-1100 px -> source order -> more specific / later rule.
- Page CSS wiped by a re-injection -> CSS placed inside the injected block -> own `data-page-pass` block.
- Old figure reappearing after count-up -> `data-to` not updated.
- Hero phone zoomed 3x after a slide -> cross-fade refactor -> track kept `height:300%`.
- Retina images broken on language subpages -> relative `srcset` -> root-absolute paths.
- Browser auto-dark darkened the page but not the screenshots -> `color-scheme: only light`.
- Jerky trackpad scroll -> smooth-scroll lerp + native smooth scroll + per-frame drop-shadow filter.
- Menu button cut at 360 px -> header too full -> hide the header download button < 375 px.
- Payout animation invisible -> rAF does not run in background tabs -> timer fallback.
- First FAQ answer clipped -> height measured before the webfont swapped -> re-measure on `fonts.ready` + ResizeObserver.
- App Store mark clipped -> wrong SVG viewBox -> measure path bounds.
- Store badge bar 222 px tall -> percentage heights in an auto-height parent -> explicit height.
- White boxes around assets built in the design tool via script -> `createFrame()` defaults to a white fill -> `fills=[]`.

---

## L. Keep a contradictions list

Every real build accumulates stale comments and reversed decisions. Keep a short list in the repo and check it before relying on a comment:
- Comments in source describing behaviour that is gone (e.g. tilt-on-hover after phones went flat; "font X dropped" after it came back for digits). `site/_dist/` is the truth.
- Token tables in `:root` vs values a later pass forces.
- Hard-coded near-miss colours in pass scripts.
- Decision reversals with dates (currency position, tab bar on/off, icon set swap and revert).
- Reports that could not be located (record what was checked and the blind spots).
- Image sharpness claims vs measured rendered size; measure the live page before acting.

---

## M. File map (suggested)

- Tokens, components, inline JS: `site/src/index.html` (+ subpages). Generated language pages and `site/_dist/` are never hand-edited.
- Typography: `site/src/assets/typo.js` + `typo.css`, injected by `build/injectors/inject-typo.py`.
- Fonts: `design/fonts/` (originals) + a subsetting/preload pass in `build/passes/`.
- Mobile CSS/JS, menu tiles, rails: `site/src/assets/mobile.css` + `mobile.js`, injected from `build/injectors/`.
- Nav, anchors, smooth scroll: `site/src/assets/` (nav.js, links.js).
- Mockups: `design/mockups/` (png3x, backups) + `build/passes/apply_mockups.py`, `fit.py`.
- Icons/logos/awards: `design/icons/`, `design/logos/` (+ logos.json), `design/awards/` (+ mkawards.py), official brand SVGs in `design/brand/`.
- Review/a11y/consent passes: `build/passes/`.
- QA harness: `qa/` (overflow audit, line probe, nav check, forced-dark shots, hero cross-fade test, wheel-scroll nav test). The generic part ships with this skill in `scripts/qa/`.

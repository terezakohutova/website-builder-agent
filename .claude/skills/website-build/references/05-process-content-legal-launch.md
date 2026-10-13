# 05 - Process, people, content, IA, legal, consent and launch

Everything outside the pure build mechanics that decides whether a new multi-market marketing site
ships cleanly: who decides what, how feedback is worked, how the sitemap and copy are kept honest,
what legal/consent must be in place, and how the launch is run. Distilled from a real production
build and launch of a consumer fintech app site in five languages. Each bullet is a **rule** - why.
Examples are marked as examples; replace them with your project's facts.

---

## 1. Roles and who decides what

Set these roles up in the brief before any build work. One person can hold several roles; what
matters is that each decision has exactly one owner.

| Role | Owns | Notes |
|---|---|---|
| **Decision owner** (e.g. head of marketing) | Everything visible: copy, claims, page list, which mockups are final, launch go. **Merges / pushes the production branch.** | Claude never pushes or merges production. Hand over the exact command or click path. |
| **Technical reviewer** (developer / data person) | Hosting config, redirects, headers, CSP, consent, tracking tags, analytics. Tests every side branch on a preview deploy before the owner merges. | Usually wants hotfixes as standalone commits. Verifies the live site after each merge. |
| **Legal content owner** (CEO, counsel) | Terms, privacy policy, regulatory wording, founder quotes, investor contact. | Has the final word on legal text; Claude flags, never rewrites legal meaning. |
| **Product / CMS owner** | Launch checklist, CMS (if used), tag manager container, app-side links, final app screens. | Rows Claude touches in a shared tracker get a "done/blocked (Claude) - please review" note. |
| **Designers** | Source design files, localized app screens, icons. | Their file is the visual source; "which frame is final" is still the decision owner's call. |
| **PR agency** (per market, optional) | Press contact on the press page, press-kit requests. | Name them only where they actually handle requests. |
| **Mobile developers** | In-app links to the web, store-listed paths, attribution logic. | Ask them for every path the app or store listings use. |

- **Address people the way they want to be addressed** and record nicknames/aliases in one place, or logs become ambiguous ("same person under two names" happens).
- **Only one Claude session publishes/deploys at a time; others edit files and say so.** - Two sessions publishing the same thing overwrote each other repeatedly and put a broken-JS build back live. Tell-tale: temp scripts or files modified minutes ago that you did not write.
- **Only one build at a time: the build script holds a lock file.** - Two concurrent builds produced a half-built deploy folder (missing hosting config and 404 page) that got committed. If the lock says "another build is running", wait; never delete the lock. Before committing a deploy folder, check that the hosting config and 404 page exist.
- **Before publishing anything shared, re-read the live version and diff.** - That read catches regressions another session introduced. Never resend refused content unchanged.
- **Absence from the log is not evidence something was not done.** Search the working folders before assuming.

## 2. Approval rules (non-negotiable)

- **Never push or merge production.** Prepare a side branch; the decision owner merges.
- **Never send a message (chat, e-mail, comment to a colleague) without explicit approval of that exact text on that channel.** E-mail only as a draft. Applies to "it's live" notes and reviewer pings too.
- **Hosting config, redirects, headers, CSP, consent, tracking and legal changes go to a side branch for the technical reviewer first.** Small copy-only changes may go straight to production after a local test, if the reviewer agrees to that rule.
- **Widening a CSP, editing tag-manager containers, writing to the CMS** = explicit per-action yes. If a tool or permission system blocks an action, never look for a workaround: hand the exact click path to the person and log it.
- **Escalate contradictions, don't pick.** Two sources disagree on a number, a licence wording, a date -> list the candidates and let the owner decide. Guessed "facts" had to be reverted.
- **Don't redesign while fixing.** Apply only the requested change; an unrequested "improvement" to an image was rejected on sight.
- **Reproduce bug reports before fixing them.** Reported "QR does not scan" (it did), "blocked content" (preview sandbox, not the site), "dark e-mail" (OS setting).
- **No partial fixes across a set.** If a change is right for only some pages/languages, flag it instead of shipping an inconsistent site.

## 3. The feedback loop

Use the same loop for every review round:

1. Reviewers post comments (team chat threads, DMs, doc comments).
2. Collect **every** point into a checklist file (one line per item, source + quote). Large rounds hit 150+ items.
3. Write verdict files per area (copy / design / tech): fix, reject with reason, or needs a decision.
4. The decision owner decides item by item.
5. Implement as **one idempotent pass script per round**, wired into the build. - Hand edits to generated pages are lost on the next build; a pass re-applies forever and can be re-run safely.
6. Full build -> side branch / preview deploy.
7. Technical reviewer tests the preview.
8. Decision owner merges.
9. Verify on the live site (curl headers, content grep, browser check).
10. Reply to the reviewers (after approval of the reply text).

- **A copy pass must update the source-language page AND every translation dictionary**, or exact-string i18n matching silently breaks. Copy passes run before the i18n builders; passes on the optimized output run after the optimizer.
- **Keep separate audit passes and re-run the set before every big release:** mobile review, "a 10-year-old must understand it" flow review, language, SEO, AI-search readability, security.

### How to present changes

- **A short list of decisions, one line each, in the owner's language, with the options.** The owner answers point by point.
- Record what "ok" means in your project (e.g. "ok" = leave it as is, not "go ahead and change it").
- For a long draft, ask whether it was read before building on it.
- Show before/after for copy, a screenshot for visuals, a URL for anything deployable.

## 4. Brief template to start a new site

Fill this in before writing any code; ask for everything missing in one go.

```
Company / product:            (one line, what it does, for whom)
Markets and languages:        (e.g. CZ, SK, PL, DE + EN as translation)
Source language:              (the only hand-edited language)
Goal of the site:             (e.g. app downloads, B2B leads, investor credibility)
Primary conversion:           (e.g. store click via attribution link, contact form)
Audiences + address form:     (users informal, investors/press formal, ...)
Page list (sitemap SSOT):     (link to the one sitemap document)
Facts list:                   (users, transactions, ratings, awards, launch dates - with sources)
Legal entities per market:    (name, register number, address, VAT/tax IDs, managing director)
Legal docs source:            (CMS / docx files / counsel) + who approves
Regulatory wording:           (exact licence/registration phrasing per market, from contract)
Trackers planned:             (analytics, ads pixels, attribution) -> privacy policy must list them
Consent approach:             (Consent Mode basic/advanced, categories)
Hosting + domains + DNS:      (provider, who owns DNS, what must keep working on old paths)
Store-listed / in-app paths:  (from the mobile team - served exactly, no redirect)
Design source:                (design file, brand tokens, fonts, real app screens)
Roles:                        (decision owner, technical reviewer, legal owner, product, PR)
Launch date per market:       (and who may move it)
Out of scope:                 (pages explicitly not built)
```

## 5. Information architecture

- **One sitemap document is the single source of truth**; one copy master (source language first, then translation). **Count the pages folder, not a number written somewhere** - the page count changed many times.
- **Number source pages** (`01-home`, `02-why-us`, `03-investors` ...) so order and gaps are obvious; publish them under clean per-language slugs via 301s.
- **Deleting vs hiding a page:**
  - Delete when nothing will fill it (e.g. a blog with no articles, a download page that a QR modal/store link replaces).
  - Hide when "we'll come back to it" (e.g. partner pages): keep the file, `noindex`, remove all links via a reversible script (keep backups), exclude it from the deploy output.
- **Closed-funnel invite page** (referral landing): `noindex`, out of the sitemap, no menu, no logo link, no language switch, no footer link grid; keep only terms/privacy/cookie links. Its copy must match how in-app attribution actually works (see lesson 11).
- **App-store-required pages exist even if nobody asks for them in design**: account deletion (Google Play), privacy policy, terms. Their paths must match the store listing exactly. An account-deletion page that was removed in a cleanup had to be restored.
- **Confirmation pages** (e.g. double opt-in thank-you): `noindex`, outside sitemap, no ads.
- **Don't build pages nobody asked for** (e.g. case studies). Once a page is ruled out, never list it as open again.
- **Menu is for users; company/B2B links live in the footer.** A "Home" pill on every page except home.
- **Special pages outside the i18n builders** (e.g. a German Impressum) must be registered everywhere code special-cases languages (link injectors, language checks, consent script, event script), or they get source-language chrome.
- **Store-listed, deep-link and in-app paths are served exact, status 200, no redirect** (query strings kept). Old app links (`/faq`, `/terms`, `/invite` ...) get 301s. Keep the full map in the build changelog.
- **Inventory old campaign subdomains / landing pages** (many may still be live and indexable); decide per row to redirect or retire. Retiring one can involve its own tag container or deep links, not just a redirect.

## 6. Copy rules that bit

Write these into your project's copy rules file before the first draft; each caused rework.

**Voice and register**
- **Pick the address form per audience and write it down** (e.g. informal to users, formal on investors and press pages; first person singular for a mascot/brand voice, "we" on About and investors).
- **No emoji in website copy** (fine in push/ads); strip them when porting content from older landing pages.
- **No em/en dashes** if that is the house style; a write hook can enforce it.
- **Banned-word list per language** (words with a sneaky connotation, e.g. "quietly" for a finance app collecting data). It ended up in footer taglines and meta descriptions.
- **No invented quotes.** Founder bios are facts, not quotes; quotes only with the person's approval.
- **Standard language, no dialect endings**, even in playful copy.
- **Grammatical gender/declension of borrowed product terms decided once** (e.g. German "die Wallet") and applied in web, mockups and CMS.
- **Brand name spelling and inflection rules** (e.g. never decline the brand name; capitalized feature names).

**One term per concept**
- **One word for each in-app object per language** (e.g. "challenge" vs "quest" vs "opportunity" for the same task). Three overlapping terms appeared across pages and mockups. Legal text may use the same word in a different defined sense, so it is never a blind find-and-replace.
- **One wording for reward triggers** (e.g. "after your friend completes registration") everywhere.

**Numbers and claims (one facts list)**
- **Keep one facts list** (users, transactions, ratings, awards, years, dates) with source and date per figure; every page, JSON-LD, `llms.txt` and AI-facts files read from it. Example: the transactions figure existed in four versions across web, press kit, fundraising page and a social draft.
- **Distinguish metrics**: "satisfied users" is not "store downloads"; don't claim "worldwide" when you operate in four countries.
- **Ratings per market, exact**, with a qualifier where a market shows another market's rating. No "Top 10" without a ranking that says so.
- **Animated counters read a data attribute** - change the attribute together with the visible text, or the old claim returns after the animation.
- **Reviews must be real**: verbatim store reviews, without names, per market, sources kept in a file. Invented testimonials are a consumer-protection blacklist item in the EU.
- **Awards need evidence**: keep an evidence list (name, year, placement, link). "Top 10 global" with no source became "global finalist"; a 3rd place is not a win; unpublished results are not claimed.
- **Launch year vs registration year**: decide which is "founded" in copy and which goes into structured data.
- **Future launches in future tense** with the date ("from 1 March"); after launch a pass must flip the tense (a countdown removes itself, copy does not). Decks/pitches may use month only; don't copy web strings into decks.
- **Founder-name spelling comes from the company register and the owner**, never a spellchecker - a proofreading pass "corrected" a founder's surname site-wide.
- **Currency placement per language** (e.g. `5 €` with a no-break space in most EU languages, `€5` in English). Enforce with a pass and a grep on the output; it flipped three times when not written down.
- **Reward amounts per market** and their conditions in one table; a FAQ that must hold in every market can omit the amount. Mockups must not contradict the copy (a screen showing a minimum balance next to "I'll send you X").
- **Licence/regulatory wording copied from the contract or register, per market**, confirmed by the legal owner. Example: "registered with regulator X via provider Y" is not "licensed"; never claim a licence the company itself does not hold.
- **Third-party brand names**: remove any partner whose affiliate terms forbid publicity (also from HTML/CSS comments - strip comments from the output); replace trademarks with generic categories where in doubt.
- **Per-market product scope** (e.g. no insurance in a market where it is not offered).
- **Press contact per language** in one table.
- **Mockups = real app screens only**, localized per market, consistent chrome (e.g. tab bar always visible), no invented features, `@example.com` in login screens.
- **Language QA before each release**: a grammar checker per language plus a spellchecker, then native-speaker judgment; legal-wording findings go to the legal owner as a list, not edited.

## 7. Legal and compliance

**Footer per market**
- **Operator entity per market in every footer**: legal name, register number and court, address, VAT/tax IDs, share capital where the law requires it (e.g. Polish companies), managing director where required. Take data from the official register, not the old site. A wish "not to name the parent company" may conflict with the law; legal requirement wins, decision owner confirms.
- **A contact section per country** that the footer "Contact" links to.
- **English as a translation**: footer and legal pages say the source-language version is binding.
- **EU funding logos/texts** if the company received co-funding; their wording is often prescribed.

**Germany (if you enter DE)**
- **Impressum per § 5 DDG**, linked from every DE page; needs e-mail **and** a phone number (CJEU C-298/07) plus register entry and VAT ID. A missing phone number blocked launch items.
- **Withdrawal wording = the official model withdrawal notice word for word**, or the legal safe harbour is lost. Describe the withdrawal button where it actually is (in-app).
- **Web text describing features the app does not have yet is a liability** (withdrawal button, confirmation e-mail, in-app Impressum). Treat each gap as a launch blocker or change the text.
- **Operator vs contracting party**: check that provider contracts/DPAs are signed by the entity named as operator.

**Terms and privacy as single source**
- **Generate legal pages from one source** (CMS entries or versioned docx files), shared by web and app. The build fails if the source is unreachable; a verify mode diffs without writing.
- **Before any CMS write**: backup, write, read back every locale, verify via the public API.
- **Terms changes carry a version, an effective date and the change notice the terms themselves describe.** Edits that went live without them stayed an open legal issue.
- **Remove dead regulatory links** (e.g. the EU ODR platform closed in July 2025).
- **Privacy policy must list every tracker the site loads** (analytics, ads pixels with joint-controller roles, attribution SDK, CRM/e-mail tool) and the consent cookie lifetime. **Adding a tracker = privacy policy update first.**
- **A cookie section** in the privacy policy (or a separate cookie page) matching the consent dialog.
- **Account deletion page matches the real app flow**; don't promise full erasure if some data stays (e.g. in analytics storage) until a backend fix.
- **Open legal items that touch copy** (minimum age mismatches between config and terms, promotional-lottery risk of daily rewards, opt-in vs opt-out) are listed and owned by the legal owner.

## 8. Consent, tracking and security

- **Categories**: necessary / analytics / marketing. Store the choice in a first-party cookie (e.g. 180 days) and `localStorage`; a footer link reopens the dialog. Withdrawal deletes analytics/ads cookies.
- **Consent bar in every language, in the brand voice.** For DE, per-service details (provider, purpose, data, duration, third country) with **measured** cookie lifetimes, matching the privacy policy.
- **Consent Mode v2 defaults (all denied) are the first script in `<head>`; nothing that tracks loads before consent; no tag-manager `<noscript>` iframe** (it tracks no-JS visitors without consent).
- **Consent Mode basic vs advanced:**
  - *Advanced* loads Google tags before consent and sends cookieless pings. A legal audit found those pings fired before consent and after "necessary only", contradicting the banner.
  - *Basic* loads the tag manager only after analytics or marketing consent. Safer default; switch to advanced only with the decision owner and technical reviewer.
  - **The banner's promise is the spec**: verify network calls after "necessary only".
- **Inspect the tag-manager container before trusting Consent Mode** - custom HTML tags (ads pixels) without consent checks forced the whole container behind consent.
- **Ad click IDs and attribution parameters are stored only after marketing consent.**
- **Defer tags until first interaction or a few seconds after load** - a large mobile Lighthouse gain.
- **Download links through attribution links per language/page/spot**; incoming ad UTMs override the site campaign. If rewards key on these campaigns, a link change can silently cost users their reward. Tokens live in a measurement file, never in the skill.
- **CSP in Report-Only first**, whitelist from real traffic until zero violations, then enforce. Enforcing broke a legacy page whose API call only fires with a token in the URL, for most of a day: **test legacy token pages with a real token on every CSP change.**
- **Known gap to document**: legacy pages behind a proxy may still fire trackers before consent until retired.

## 9. Launch

**Hosting facts to settle early**
- New hosting project from a private repo; production branch = live site.
- **Legacy proxy**: the old site/project becomes the catch-all proxy target for every path the new site does not serve (old app pages, wallet pages, old assets). Never redeploy or delete it if it can no longer build.
- **Back up production** (every live path: status, headers, body hash) and **back up the DNS zone** before any DNS change.

**Launch-date moves**
- **The launch date lives in one constant** used by the countdown, structured data, `llms.txt`, AI-facts files and copy passes. A date that moved three times touched a countdown script, SEO data, ~15 source pages, JSON-LD, AI files in five languages and the status notes.
- **Ship a date move as a date-only branch** (1:1 swap) on top of production. **Grep every old date in all those places before the next move.**
- **Countdown removes itself at local midnight of the launch day**; the tense flip in copy is a separate pass you must schedule.

### Go-live checklist

Before the switch
- [ ] Capture production: every live path with status, headers, body hash; old hosting config.
- [ ] Map every old URL: store-listed paths, review-bot paths, deep-link fallbacks, in-app links, old e-mail links -> exact 200 alias, 301, or proxy. Ask the app team.
- [ ] Generate the hosting config from the build, never by hand: aliases, clean-URL 301s, legacy 301s, real 404, proxy allow-list, `X-Robots-Tag: noindex` on every non-production host, immutable assets, `nosniff`, `Referrer-Policy`, app-link association files with the right content type, `security.txt` (RFC 9116).
- [ ] CSP Report-Only -> zero violations -> enforce; legacy token pages tested.
- [ ] Consent: no tracker before consent (headless check), all expected tags after accept-all, cookies deleted on withdrawal, DE details complete, privacy policy lists every tracker.
- [ ] Legal: per-market footer entity complete, Impressum complete, terms/privacy current version = CMS = web = PDF, account-deletion page live and matching the app, no dead ODR link, "source language is binding" note on translations.
- [ ] Content facts checklist (below) passed; language QA run; banned characters/words/currency format grepped in the output.
- [ ] Preview tests: all old paths + aliases + files + internal links; every page x desktop/mobile width (overflow, console, images, consent); feature tests; monkey test; axe (0 violations); link checker; Lighthouse old vs new.
- [ ] Technical reviewer's review of the final build, plus an hour reserved after the switch.
- [ ] The decision owner's explicit go. Nothing switches on anyone else's word.

Switch
- [ ] Move the domain(s) to the new project (e.g. only `www`; apex 308 -> `www`; no DNS change if avoidable). Rollback = instant rollback or move the domain back.

After the switch
- [ ] Re-run the path suite and browser suite on production; test a desktop invite flow and any bank/OAuth callback.
- [ ] Live console sweep: 0 errors on every page before consent.
- [ ] Submit the sitemap to search consoles (Google, Bing, local engines); request indexing for key URLs (old URLs dominate the index for weeks).
- [ ] Analytics access, reports and conversions rebuilt on the new URLs; key events marked once they appear.
- [ ] Off-site entity data (Wikidata, Crunchbase, startup directories) updated by hand by the owner.
- [ ] Old subdomains and legacy landings: decide per row, redirect or retire.
- [ ] Every later change: side branch -> reviewer preview test -> owner merges -> verify live -> approved note to the reviewer.

### Content facts to verify before any release

- [ ] User figure matches the facts list; downloads only labelled as downloads; no "worldwide" if untrue.
- [ ] Every big number identical on every page, JSON-LD, `llms.txt`, AI-facts files.
- [ ] Ratings per market exact; counter data attributes match; no unsupported rankings.
- [ ] Awards = the evidence list; nothing unpublished claimed.
- [ ] Founding/launch year consistent; each market in the right tense for today's date.
- [ ] Founder names spelled per register; quotes approved.
- [ ] Reward amounts, currency format per language and conditions match the app config and terms.
- [ ] Licence/regulatory wording per market from the contract/register.
- [ ] One term per object per language; product-term gender/capitalization.
- [ ] No banned partner names, trademarks, out-of-scope products, emoji, banned words or dashes; no invented review/quote/feature.
- [ ] Mockups in the page's language, consistent chrome, no other market's banks/regulators, numbers don't contradict copy.
- [ ] Press contacts per language; investor CTAs correct; formal address where decided.
- [ ] Legal footer complete per market; legal page versions = the single source.

## 10. Lessons - generic rule + why

1. **One publisher; re-read live before publish; publish only changed files.** - Parallel sessions overwrote each other and shipped a broken build.
2. **Build lock; check hosting config + 404 exist before committing output.** - Overlapping builds committed a half-built deploy.
3. **When updating a published thing, always target the existing URL/ID.** - Omitting it created a stray copy.
4. **Verify warnings before acting on them; delete stale ones.** - A stale "QR does not scan" note invited someone to break a working QR.
5. **Test the full page x width matrix, not a sample.** - A nav fix verified on one combo was broken on 18 of 24.
6. **Change data attributes together with visible text.** - Animated counters restored removed claims.
7. **Page-specific CSS in its own marked block.** - CSS placed inside an injected block was wiped by the next injection.
8. **Check rendered output, not substrings in source.** - An "already linked" check matched a string in a JS file, so a legally required link never appeared.
9. **Every claim needs a source; if none, ask or leave the slot empty.** - Invented reviews, a founder quote, a ranking and an inflated rating all shipped and were pulled.
10. **Names come from the register and the owner, not a spellchecker.** - A proofread "fixed" the founder's name site-wide.
11. **Check copy against how app attribution really works.** - The invite page told users to do the one thing that lost both people the referral reward.
12. **The consent banner's promise is the spec; verify network calls after "necessary only".** - Advanced Consent Mode contradicted the banner.
13. **Test token-only legacy paths on CSP changes; hotfix as a standalone commit.** - Enforced CSP broke a legacy page for most of a day.
14. **Legal changes carry version, date and change notice, and go to the legal owner.** - Terms edited live without them.
15. **Inspect the tag container before trusting Consent Mode.** - Custom HTML tags had no consent checks.
16. **Launch date in one constant + an audit pass; month-only in decks.** - A market was described as "already live" before launch, and three dates circulated in two weeks.
17. **Regulatory wording from the contract/register, confirmed by the legal owner.** - Wrong regulator and "licence" wording appeared in three markets.
18. **Strip emoji and comments from ported content and output.** - An imported landing carried emoji; a forbidden partner name sat in CSS comments.
19. **Per-market screens; check every number in a screenshot.** - Wrong-language screens, other markets' banks and contradicting minimums appeared in mockups.
20. **Blocked by a permission/classifier? Hand over the click path, don't work around it.**
21. **When a rule changes, delete or mark the superseded rule the same day.** - An old rule file contradicted the new one and caused a flip-flop.
22. **Keep a "contradictions and stale notes" list** at the end of the project reference and resolve each with the owner instead of guessing (consent mode in docs vs live, licence wording vs latest statement, web figures vs fundraising page figures, cutover scope in plan vs log).

# Reference build chain

A small, working version of the build chain that [`references/01`](../../.claude/skills/website-build/references/01-architecture-pipeline-deploy.md)
(section 4) and [`references/03`](../../.claude/skills/website-build/references/03-i18n-seo-geo.md) describe.
Python 3.8+ standard library only, about 650 lines of Python. It builds the fictional
[sample site](../sample-site/index.html) (English master pages) into `examples/sample-site/_dist/` with a
generated German home page:

```bash
python examples/build-chain/build.py                     # -> examples/sample-site/_dist/
node .claude/skills/website-build/scripts/qa/jscheck.mjs examples/sample-site/_dist
node .claude/skills/website-build/scripts/qa/audit.mjs examples/sample-site/_dist
```

| file | what it does |
|---|---|
| [`build.py`](build.py) | runs the steps in order under one lock; computes everything in memory and writes `--out` only when every check passed; never writes into the source pages |
| [`buildlock.py`](buildlock.py) | lock directory (atomic `mkdir`) with `info.json` (pid, host, start); a second build exits 3 and names the holder; release only by the owner; a lock whose pid is dead on this host is taken over at once (another host's lock after `--stale-minutes`), serialised by an `O_EXCL` takeover file |
| [`i18n.py`](i18n.py) | exact match against [`i18n/strings-de.json`](i18n/strings-de.json): block elements with inline markup as one key with `{0}...{/0}` placeholders, so the translation can reorder words (the German Offline card puts the verb last), then text nodes and attributes as the fallback; localises bare, `/root-relative`, `./` and `../` links to pages that exist in that language and warns about the ones it cannot; untranslated copy fails the build; leftover check for master-language words in text and attributes, and in inline-script strings read by a small tokenizer (regex literals, template strings) that also flags single-word dictionary copy; fills the language switcher between `<!--langs:start-->` markers |
| [`assets/typo.js`](assets/typo.js) | runtime typography (a no-break space, U+00A0, after short words, runs of them and sentence starts included, per language; the brand from `data-brand` on one line), injected as one idempotent marked block, so copy stays matchable; tested in Node by [`tests/typo.test.mjs`](../../tests/typo.test.mjs) |
| [`seo.py`](seo.py) | title, description, canonical, hreflang + x-default and one JSON-LD `@graph` between `<!--seo:start-->` markers from [`site.json`](site.json) (brand name included); alternates list only indexable variants (a page's `noindex` languages are left out and get robots noindex); idempotent; strips stray copies; then `sitemap.xml` with `<lastmod>` that moves only when a page's content hash changes (history in `<src>/lastmod.json`: commit it, or CI stamps every page with today) |

Exit codes: 0 built, 1 build checks failed (nothing written), 2 bad usage or a missing/invalid `site.json` or key (named in the message), 3 could not run (lock held, refusing
to wipe a folder that is not a previous build output). Tests: [`tests/test_build_chain.py`](../../tests/test_build_chain.py),
plus a browser test that runs jscheck and audit on the output.

What it leaves out on purpose, because it is project-specific: feedback passes, JS string translation (the
leftover check catches master copy in scripts instead), the optimiser (hashed assets, WebP), consent and tag
passes on `_dist`, `llms.txt`, clean URLs and the deploy step. The references say what each must do.

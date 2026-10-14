# Website Builder Agent

[![CI](https://github.com/terezakohutova/website-builder-agent/actions/workflows/test.yml/badge.svg)](https://github.com/terezakohutova/website-builder-agent/actions/workflows/test.yml)

A Claude Code subagent and skill that build a multi-language marketing website from brief to go-live, plus
three things that kept the original build honest, as working code: a browser QA harness that needs no npm
install, a hook that versions every file Claude edits, and a small reference build chain (i18n, runtime
typography, SEO, sitemap, build lock). All three are tested in CI on Linux and Windows.

**Why this exists.** On the real build, a layout fix passed a spot check and then failed in 18 of 24 page x
width combinations. A page that renders proves nothing. This repository turns that lesson, and every other
one from building, translating into five languages and launching a marketing site for a mobile app, into
rules an agent follows and scripts that measure the result. The original site, its company and its figures
are not in here.

<p align="center">
  <img src="examples/sample-qa-report/shots/index.html.1440.00.png" width="560" alt="The sample site's home page at 1440 px, as captured by shots.mjs">
  <img src="examples/sample-qa-report/shots/index.html.390.00.png" width="156" alt="The same page at 390 px">
</p>

A recorded run on the bundled sample site ([full report](examples/sample-qa-report/README.md)):

| step | exit | result | time |
|---|---|---|---|
| build | 0 | as expected | 0.8 s |
| jscheck | 0 | as expected | 0.2 s |
| audit (3 pages x 8 widths) | 0 | as expected | 16.0 s |
| anchors-390 | 0 | as expected | 7.2 s |
| anchors-1440 | 0 | as expected | 7.5 s |
| content-struct | 0 | as expected | 3.1 s |
| content-heads-390 | 0 | as expected | 3.3 s |
| modes-reduced | 0 | as expected | 2.8 s |
| shots | 0 | as expected | 3.3 s |
| wheel | 0 | as expected | 6.5 s |
| console-sweep | 0 | as expected | 6.5 s |

## Try it in one minute

Needs Node 22+, Python 3.8+ and Chrome (or Chromium). Nothing to install.

```bash
git clone https://github.com/terezakohutova/website-builder-agent.git && cd website-builder-agent
python examples/build-chain/build.py                                       # English master -> EN + DE in _dist
node .claude/skills/website-build/scripts/qa/audit.mjs examples/sample-site/_dist
```

The audit prints one line per page and width, then a total:

```text
ok   index-de.html @1440
ok   index-de.html @390
ok   index.html @1440
ok   index.html @390
ok   privacy.html @1440
ok   privacy.html @390

3 pages x 2 widths, 0 with issues
```

Then the test suites:

```bash
node --test --test-concurrency=1 "tests/*.test.mjs"   # QA harness, about a minute
python -m unittest discover -s tests                  # snapshot.py and the build chain
python tests/check_links.py                           # every relative link in the docs resolves
```

Locally, one CI-only test and one POSIX-only test skip.

The Node tests are behaviour tests: each QA script runs against small fixture pages (served from `file://` or
an in-process HTTP server) that must pass or must fail with a named finding, plus the exit-code contract,
argument handling, the CDP client's timeouts and buffers, and jscheck's parser. Without Chrome the browser
tests are skipped locally and fail under `CI=true`. The axe tests run when axe-core is found (`AXE_PATH`, or
`node_modules/axe-core`; CI installs it) and are skipped otherwise. `--test-concurrency=1` keeps it to one
Chrome at a time.

## What's inside

| Path | What |
|---|---|
| [`.claude/agents/website-builder.md`](.claude/agents/website-builder.md) | The agent. Asks for the brief first, works in phases, keeps backups, never merges production or sends messages without approval. |
| [`.claude/skills/website-build/SKILL.md`](.claude/skills/website-build/SKILL.md) | The route: 12 phases, 10 hard rules, and which reference to open when. |
| [`references/01-architecture-pipeline-deploy.md`](.claude/skills/website-build/references/01-architecture-pipeline-deploy.md) | Folder layout, build chain and why the order matters, libraries, hosting config, CSP, redirects, the build lock, backups, incidents. |
| [`references/02-design-typography-mockups.md`](.claude/skills/website-build/references/02-design-typography-mockups.md) | Tokens, type scale, fonts and diacritics, runtime line breaks, mockups from real screens, components, motion, a11y, a visual bug catalogue. |
| [`references/03-i18n-seo-geo.md`](.claude/skills/website-build/references/03-i18n-seo-geo.md) | Translation builders, hreflang, per-market data, the SEO post-processor, JSON-LD, sitemap/robots, GEO (`llms.txt`, `facts.json`) with a test protocol, performance, consent and analytics. |
| [`references/04-qa-devices-modes.md`](.claude/skills/website-build/references/04-qa-devices-modes.md) | QA rules, the device/width/mode matrix, in-app browser findings, a11y, consent tests, review passes, pre-publish and post-deploy checklists. |
| [`references/05-process-content-legal-launch.md`](.claude/skills/website-build/references/05-process-content-legal-launch.md) | Roles and approvals, the feedback loop, the brief, IA, copy and facts rules, legal and compliance, the go-live checklist. |
| [`scripts/qa/`](.claude/skills/website-build/scripts/qa/README.md) | Browser QA on raw Chrome DevTools Protocol over Node's built-in `WebSocket`: overflow per width, broken images, console errors, failed page loads, inline-script and handler syntax, anchors, modes, screenshots, wheel, console sweep, axe. Plus a Playwright WebKit and social in-app browser matrix with its UA strings in a dated data file. One exit-code contract: 0 clean, 1 findings, 2 bad usage, 3 could not run. |
| [`scripts/backup/snapshot.py`](.claude/skills/website-build/scripts/backup/snapshot.py) | File versions between git commits: `save`, `list`, `restore`, or automatic as a PreToolUse hook. Validated version ids, retention (`SNAPSHOT_KEEP`), a size limit that says when it skips, safe under concurrent hooks. Python stdlib only. |
| [`examples/build-chain/`](examples/build-chain/README.md) | Reference build chain, Python stdlib only: build lock with owner check, runtime-typography injection, exact-match i18n builder with untranslated and leftover checks, idempotent SEO block, sitemap with content-based `lastmod`, `_dist` output. |
| [`examples/settings.hooks.json`](examples/settings.hooks.json) | The hook config that versions every Edit/Write. |
| [`examples/sample-site/`](examples/sample-site/index.html) | A fictional two-page English master site; the build chain adds the German home page. |
| [`tests/`](tests/) | Behaviour tests for every QA script, `snapshot.py` and the build chain, and a check that every relative link in the docs resolves. Run in [CI](.github/workflows/test.yml). |

**Not included:** the project-specific parts of the chain the references describe: feedback passes, JS string
translation, the optimiser (hashed assets, WebP), consent and analytics passes on `_dist`, `llms.txt`, clean
URLs and `build-deploy.py`. The references specify what each must do and why; the agent builds them for your
site, starting from `examples/build-chain/`.

## Use it in your project

1. Copy `.claude/agents/website-builder.md` and `.claude/skills/website-build/` into your project's `.claude/`.
   Also copy `examples/build-chain/` and `examples/settings.hooks.json` to the same paths in your project
   (`examples/...`): the agent looks for the build chain and the hook config there, and they are not part of
   the skill folder.
2. Optional, recommended: merge `examples/settings.hooks.json` into `.claude/settings.json`, so every file edit is
   versioned into `.versions/` (hook errors are printed and logged to `.versions/_errors.log`, never block the edit), and add `.versions/` to `.gitignore`. The hook command uses
   `$CLAUDE_PROJECT_DIR`, so it works from any working directory. On macOS and most Linux systems change
   `python` to `python3` in the hook command.
3. Ask Claude Code: *"Use the website-builder agent to build a site for ..."*. It asks for the brief first.

Requirements: Node 22+ and Chrome for the QA harness; Python 3.8+ for the hook and the build chain; Playwright
only for `inapp.mjs`, axe-core only for `axe.mjs`.

## The rules that saved the most time

- One source of truth. Language versions are generated by exact-text-match builders, and line breaks are done at runtime, so translations still match.
- A page that renders proves nothing. Syntax-check every inline script, then measure the full page x width matrix. A spot check once passed a fix that failed in 18 of 24 combinations.
- Every round of feedback becomes a scripted, idempotent build pass that fails if its target text disappears.
- Facts live in one list. The same number written three ways on three pages is a trust problem and a GEO problem.
- Test CSP and consent where your traffic actually lands. A strict `connect-src` silently blocked the Meta pixel's click-ID handoff inside the Android Facebook and Instagram in-app browsers.
- One build at a time, under a lock that checks its owner. Check free memory before a full build: parallel sessions starving the machine killed builds halfway.

## License

[MIT](LICENSE).

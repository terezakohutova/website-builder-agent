# Website Builder Agent

[![CI](https://github.com/terezakohutova/website-builder-agent/actions/workflows/test.yml/badge.svg)](https://github.com/terezakohutova/website-builder-agent/actions/workflows/test.yml)

A Claude Code subagent and skill that build a multi-language marketing website from brief to go-live, plus the
two tools that kept the original build honest: a browser QA harness that needs no npm install, and a hook that
versions every file Claude edits. The QA harness and the hook are tested in CI on Linux and Windows.

The rules come from building, translating into five languages, launching and hardening a real marketing site
for a mobile app with Claude Code. That site, its company and its figures are not in this repository; what is
left is each rule with the incident that produced it.

## Try it in one minute

Needs Node 22+ and Chrome (or Chromium). Nothing to install.

```bash
git clone <this repo> && cd website-builder-agent
node .claude/skills/website-build/scripts/qa/audit.mjs examples/sample-site
# ...
# 3 pages x 2 widths, 0 with issues

node --test "tests/*.test.mjs"                  # 30 tests: argument handling + broken fixtures in headless Chrome
python -m unittest discover -s tests            # 13 tests for the versioning hook
```

[`examples/sample-qa-report/`](examples/sample-qa-report/README.md) holds a recorded run against the fictional
sample site: 3 pages x 8 widths, anchors, content probes, reduced motion and screenshots, with the Chrome and
Node versions it ran on.

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
| [`scripts/qa/`](.claude/skills/website-build/scripts/qa/README.md) | Browser QA on raw Chrome DevTools Protocol over Node's built-in `WebSocket`: overflow per width, broken images, console errors, inline-script syntax, anchors, modes, screenshots, console sweep, axe. Plus a Playwright WebKit and social in-app browser matrix. |
| [`scripts/backup/snapshot.py`](.claude/skills/website-build/scripts/backup/snapshot.py) | File versions between git commits: `save`, `list`, `restore`, or automatic as a PreToolUse hook. Python stdlib only. |
| [`examples/settings.hooks.json`](examples/settings.hooks.json) | The hook config that versions every Edit/Write. |
| [`examples/sample-site/`](examples/sample-site/index.html) | A fictional three-page, two-language site the QA harness and the tests run against. |
| [`tests/`](tests/) | Self-tests for the QA scripts and `snapshot.py`, and a check that every relative link in the docs resolves. Run in [CI](.github/workflows/test.yml). |

**Not included:** the project-specific build chain the references describe (`build-all.sh`, the build lock,
the i18n builders, `seo.py`, `optimize.py`, `build-deploy.py`, the preview test). The references specify what
each step must do and why; the agent builds them for your site. Only the generic, reusable parts ship as code.

## Use it in your project

1. Copy `.claude/agents/website-builder.md` and `.claude/skills/website-build/` into your project's `.claude/`.
2. Optional, recommended: merge `examples/settings.hooks.json` into `.claude/settings.json`, so every file edit is
   versioned into `.versions/`, and add `.versions/` to `.gitignore`. On macOS and most Linux systems change
   `python` to `python3` in the hook command.
3. Ask Claude Code: *"Use the website-builder agent to build a site for ..."*. It asks for the brief first.

Requirements: Node 22+ and Chrome for the QA harness; Python 3.8+ for the hook; Playwright only for
`inapp.mjs`, axe-core only for `axe.mjs`.

## The rules that saved the most time

- One source of truth. Language versions are generated by exact-text-match builders, and line breaks are done at runtime, so translations still match.
- A page that renders proves nothing. Syntax-check every inline script, then measure the full page x width matrix. A spot check once passed a fix that failed in 18 of 24 combinations.
- Every round of feedback becomes a scripted, idempotent build pass that fails if its target text disappears.
- Facts live in one list. The same number written three ways on three pages is a trust problem and a GEO problem.
- Test CSP and consent where your traffic actually lands. A strict `connect-src` silently blocked the Meta pixel's click-ID handoff inside the Android Facebook and Instagram in-app browsers.
- One build at a time, under a lock that checks its owner. Check free memory before a full build: parallel sessions starving the machine killed builds halfway.

## License

[MIT](LICENSE).

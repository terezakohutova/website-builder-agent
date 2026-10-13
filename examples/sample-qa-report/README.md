# Sample QA report

Raw output of one run of the QA harness against [`../sample-site/`](../sample-site/index.html), a fictional
three-page, two-language site made for this repository. Regenerate it with:

```bash
node examples/run-sample-qa.mjs
```

Everything except this README is written by that script; absolute paths are replaced with `<repo>`.
The run environment (date, Node, Chrome, OS) is in [`environment.txt`](environment.txt) and the exit code of
each step in [`summary.md`](summary.md).

| file | what it shows |
|---|---|
| [`jscheck.txt`](jscheck.txt) | every inline script parsed with `node --check`, control-character scan |
| [`audit.txt`](audit.txt), [`audit.json`](audit.json) | 3 pages x 8 widths (1440 down to 320): overflow, broken images, console errors |
| [`anchors-390.txt`](anchors-390.txt), [`anchors-1440.txt`](anchors-1440.txt) | where every same-page link lands, below the fixed nav |
| [`content-struct.txt`](content-struct.txt), [`content-heads-390.txt`](content-heads-390.txt) | headings without body copy, headings wrapping badly |
| [`modes-reduced.txt`](modes-reduced.txt) + `modes/` | `prefers-reduced-motion`: computed scroll behaviour, running animations, 3 screenshots |
| `shots/` | first scroll tile of the home page at 1440 and 390 px |

## What this proves, and what it does not

It proves the scripts run end to end on a real Chrome, parse their arguments, and report a clean site as
clean. The browser tests in [`../../tests/qa-browser.test.mjs`](../../tests/qa-browser.test.mjs) cover the
other half: small broken fixtures (a 900 px element on a phone, a missing image, a thrown exception, an anchor
target hidden under a fixed nav) must make the same scripts fail.

It says nothing about the production site the rules in the skill were learned on. That site is not public in
this repository, and no figures from it are claimed here.

Two harness bugs were found by building this sample, and are fixed: `scrollToY` animated on pages with
`scroll-behavior: smooth` (every mid-page anchor test failed), and `anchors.mjs` passed a target that sat
under a fixed nav.

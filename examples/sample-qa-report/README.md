# Sample QA report

Raw output of one run of the reference build chain and the QA harness. The fictional sample site's master
pages ([`../sample-site/`](../sample-site/index.html), English) are built by
[`../build-chain/`](../build-chain/README.md) into `sample-site/_dist/` (English + a generated German home
page), and every check below runs on that built output. Regenerate it with:

```bash
node examples/run-sample-qa.mjs
```

Everything except this README is written by that script; absolute paths are replaced with `<repo>`.
The run environment (date, Node, Python, Chrome, OS) is in [`environment.txt`](environment.txt) and the exit
code and time of each step in [`summary.md`](summary.md).

| file | what it shows |
|---|---|
| [`build.txt`](build.txt) | the build: three pages written, sitemap written |
| [`jscheck.txt`](jscheck.txt) | every inline script and event handler parsed as the browser would, control-character scan |
| [`audit.txt`](audit.txt), [`audit.json`](audit.json) | 3 pages x 8 widths (1440 down to 320): overflow, broken images, console errors |
| [`anchors-390.txt`](anchors-390.txt), [`anchors-1440.txt`](anchors-1440.txt) | where every same-page link lands, below the fixed nav |
| [`content-struct.txt`](content-struct.txt), [`content-heads-390.txt`](content-heads-390.txt) | headings without body copy, headings wrapping badly |
| [`modes-reduced.txt`](modes-reduced.txt) + `modes/` | `prefers-reduced-motion`: computed scroll behaviour, running animations, 3 screenshots |
| `shots/` | first scroll tile of the home page at 1440 and 390 px |
| [`wheel.txt`](wheel.txt) | real wheel input on the German page: `scrollY` after each burst |
| [`console-sweep.txt`](console-sweep.txt), [`console-sweep.json`](console-sweep.json) | console, network and CSP messages per page at 1440 and 390 px |

## What this proves, and what it does not

It proves the build chain produces pages the harness passes, and that the scripts run end to end on a real
Chrome and report a clean site as clean. The browser tests in
[`../../tests/qa-browser.test.mjs`](../../tests/qa-browser.test.mjs) cover the other half: small broken
fixtures (a 900 px element on a phone, a missing image, a thrown exception, a 404 page, a page that never
finishes loading, an anchor target under a fixed nav, a heading without copy, a console error) must make
the same scripts fail.

It says nothing about the production site the rules in the skill were learned on. That site is not public in
this repository, and no figures from it are claimed here.

Harness bugs found by building this sample, all fixed: `scrollToY` animated on pages with
`scroll-behavior: smooth` (every mid-page anchor test failed), `anchors.mjs` passed a target that sat under a
fixed nav, and `inapp.mjs` tried to click a consent button that was already hidden on the second page.

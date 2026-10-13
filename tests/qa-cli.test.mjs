// QA harness tests that need no browser: argument handling of every script, jscheck on good and broken
// fixtures, and the target/width helpers in cdp.mjs.
//   node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const QA = join(ROOT, '.claude/skills/website-build/scripts/qa');
const SAMPLE = join(ROOT, 'examples/sample-site');
const run = (script, args = [], env = {}) =>
  spawnSync(process.execPath, [join(QA, script), ...args], { encoding: 'utf8', env: { ...process.env, ...env }, cwd: ROOT, timeout: 60000 });

// Every bad invocation must exit 2 with a usage line BEFORE a browser is launched (so these run without Chrome).
const BAD_USAGE = [
  ['audit.mjs', []],
  ['anchors.mjs', []], ['anchors.mjs', ['x', 'wide']],
  ['axe.mjs', []], ['axe.mjs', ['x'], { AXE_PATH: join(ROOT, 'does-not-exist.js') }],
  ['console-sweep.mjs', []],
  ['content.mjs', []], ['content.mjs', ['x', 'nonsense']], ['content.mjs', ['x', 'text', 'out', 'wide']],
  ['jscheck.mjs', []], ['jscheck.mjs', [join(ROOT, 'no-such-folder')]],
  ['modes.mjs', []], ['modes.mjs', ['x']], ['modes.mjs', ['x', 'out', 'sepia']],
  ['shots.mjs', []], ['shots.mjs', ['x']], ['shots.mjs', ['x', 'out', 'many']],
  ['wheel.mjs', []], ['wheel.mjs', ['x', 'wide']],
  ['inapp.mjs', []], ['inapp.mjs', ['not-a-url']],
];
for (const [script, args, env] of BAD_USAGE) {
  test(`${script} ${args.join(' ') || '(no args)'} -> exit 2 with usage`, () => {
    const r = run(script, args, env);
    assert.equal(r.status, 2, r.stderr + r.stdout);
    assert.match(r.stderr, /usage/);
  });
}

test('jscheck passes the sample site', () => {
  const r = run('jscheck.mjs', [SAMPLE]);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /0 failures/);
});

test('jscheck catches a syntax error, a control byte and nested pages, and skips data scripts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jscheck-fixture-'));
  try {
    mkdirSync(join(dir, 'de'));
    // valid: JSON-LD, a template and a module must not be parsed as classic JS
    writeFileSync(join(dir, 'ok.html'), `<!doctype html><script type="application/ld+json">{"a":1}</script>
<script type="text/x-template"><div>{{ not js }}</div></script><script type="module">import x from './x.js'; export {x};</script>
<script>const ok = 1;</script>`);
    writeFileSync(join(dir, 'de', 'broken.html'), '<!doctype html><script>function () {</script>');
    writeFileSync(join(dir, 'ctrl.html'), '<!doctype html><script>const s = "a\x01b";</script>');
    const r = run('jscheck.mjs', [dir]);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /FAIL de\/broken\.html script #0/);
    assert.match(r.stdout, /FAIL ctrl\.html: control character 0x01/);
    assert.doesNotMatch(r.stdout, /FAIL ok\.html/);
    assert.match(r.stdout, /3 html files, 4 inline scripts checked, 2 failures/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('listPages resolves a relative folder to real file:// URLs', async () => {
  const { listPages } = await import(pathToFileURL(join(QA, 'cdp.mjs')).href);
  const cwd = process.cwd();
  process.chdir(ROOT);
  try {
    const urls = await listPages('examples/sample-site');
    assert.deepEqual(urls, ['index-de.html', 'index.html', 'privacy.html'].map(f => pathToFileURL(join(SAMPLE, f)).href));
    await assert.rejects(listPages('examples/no-such-folder'), /neither an http\(s\) URL nor a folder/);
  } finally { process.chdir(cwd); }
});

test('widths() parses WxH, fills a default height and rejects garbage', async () => {
  const { widths } = await import(pathToFileURL(join(QA, 'cdp.mjs')).href);
  const prev = process.env.QA_WIDTHS;
  try {
    process.env.QA_WIDTHS = '1440x900, 390x844,360';
    assert.deepEqual(widths(), [[1440, 900, false], [390, 844, true], [360, 844, true]]);
    process.env.QA_WIDTHS = '1440x900,abc';
    assert.throws(() => widths(), /"abc" is not WxH/);
  } finally { if (prev === undefined) delete process.env.QA_WIDTHS; else process.env.QA_WIDTHS = prev; }
});

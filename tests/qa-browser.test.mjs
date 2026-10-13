// QA harness tests in a real headless Chrome: the sample site must pass, and small broken fixtures must
// fail with the right finding. Skipped (not failed) when no Chrome is installed.
//   node --test tests/            CHROME_PATH=... to pick a binary, CHROME_ARGS=--no-sandbox on some CI runners
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const QA = join(ROOT, '.claude/skills/website-build/scripts/qa');
const SAMPLE = join(ROOT, 'examples/sample-site');
const { CHROME } = await import(pathToFileURL(join(QA, 'cdp.mjs')).href);
const hasChrome = CHROME !== 'chrome' ? existsSync(CHROME) : spawnSync('chrome', ['--version']).status === 0;
const opts = { skip: hasChrome ? false : 'no Chrome found (set CHROME_PATH)', timeout: 240000 };

let port = 9700;
const run = (script, args, env = {}) => spawnSync(process.execPath, [join(QA, script), ...args],
  { encoding: 'utf8', cwd: ROOT, timeout: 230000, env: { ...process.env, QA_PORT: String(port++), ...env } });

function fixture(html) {
  const dir = mkdtempSync(join(tmpdir(), 'qa-fixture-'));
  writeFileSync(join(dir, 'page.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>fixture</title></head><body>${html}</body></html>`);
  return dir;
}

test('audit: the sample site is clean at desktop and the smallest phone width', opts, () => {
  const r = run('audit.mjs', [SAMPLE], { QA_WIDTHS: '1440x900,320x700' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /3 pages x 2 widths, 0 with issues/);
});

test('audit: horizontal overflow on a phone fails', opts, () => {
  const dir = fixture('<p style="width:900px">too wide for a phone</p>');
  try {
    const r = run('audit.mjs', [dir], { QA_WIDTHS: '390x844' });
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /FAIL page\.html @390 overflow=1/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('audit: a broken image and a JS exception fail', opts, () => {
  const dir = fixture('<img src="missing.png" width="10" height="10" alt=""><script>undefinedFunction()</script>');
  try {
    const r = run('audit.mjs', [dir], { QA_WIDTHS: '1440x900' });
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /img=1 errs=[1-9]/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('anchors: every same-page link on the sample site lands below the fixed nav', opts, () => {
  const r = run('anchors.mjs', [SAMPLE, '390']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\n0 failing anchors/);
});

test('anchors: a target hidden under a fixed nav fails', opts, () => {
  const dir = fixture(`<nav style="position:fixed;top:0;left:0;right:0;height:300px;background:#000"></nav>
<a href="#t" style="display:block;margin-top:320px">jump</a><div style="height:2000px"></div>
<h2 id="t">target</h2><div style="height:2000px"></div>`);
  try {
    const r = run('anchors.mjs', [dir, '1440'], { QA_ANCHOR_MAX: '200' });
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /1 failing anchors/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

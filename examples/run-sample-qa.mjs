// Runs the QA harness against the fictional sample site and writes the raw output to
// examples/sample-qa-report/. Absolute paths are replaced with <repo> so the report is portable.
//   node examples/run-sample-qa.mjs        (needs Chrome; CHROME_PATH / CHROME_ARGS as for the harness)
// Exit code: 1 if any check that is supposed to pass on the sample site did not.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const QA = join(ROOT, '.claude/skills/website-build/scripts/qa');
const SITE = 'examples/sample-site';
const OUT = join(ROOT, 'examples/sample-qa-report');
const FULL = '1440x900,1280x800,1024x768,768x1024,430x932,390x844,360x780,320x700';

const rootUrl = pathToFileURL(ROOT).href;                       // file:///C:/... or file:///home/...
const scrub = s => s.split(rootUrl).join('file:///<repo>').split(ROOT).join('<repo>')
  .split(ROOT.replace(/\\/g, '/')).join('<repo>');

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f !== 'README.md') rmSync(join(OUT, f), { recursive: true, force: true });   // README.md is hand-written
mkdirSync(join(OUT, 'shots'), { recursive: true });

const steps = [
  { name: 'jscheck', args: ['jscheck.mjs', SITE], expect: 0 },
  { name: 'audit', args: ['audit.mjs', SITE, join(OUT, 'audit.json')], env: { QA_WIDTHS: FULL }, expect: 0 },
  { name: 'anchors-390', args: ['anchors.mjs', SITE, '390'], expect: 0 },
  { name: 'anchors-1440', args: ['anchors.mjs', SITE, '1440'], expect: 0 },
  { name: 'content-struct', args: ['content.mjs', SITE, 'struct'], expect: 0 },
  { name: 'content-heads-390', args: ['content.mjs', SITE, 'heads', '-', '390'], expect: 0 },
  { name: 'modes-reduced', args: ['modes.mjs', SITE, join(OUT, 'modes'), 'reduced', '390'], env: { QA_PAGES: 'index.html' }, expect: 0 },
  { name: 'shots', args: ['shots.mjs', SITE, join(OUT, 'shots'), '1'], env: { QA_PAGES: 'index.html', QA_WIDTHS: '1440x900,390x844' }, expect: 0 },
];

let port = 9800, failed = 0;
const rows = [];
for (const st of steps) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(QA, st.args[0]), ...st.args.slice(1)],
    { cwd: ROOT, encoding: 'utf8', timeout: 600000, env: { ...process.env, QA_PORT: String(port++), ...(st.env || {}) } });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const log = scrub(`$ ${Object.entries(st.env || {}).map(([k, v]) => `${k}=${v} `).join('')}node ${st.args[0]} ${st.args.slice(1).map(a => scrub(a)).join(' ')}\n` +
    (r.stdout || '') + (r.stderr ? '\n[stderr]\n' + r.stderr : '') + `\n[exit ${r.status}, ${secs} s]\n`);
  writeFileSync(join(OUT, `${st.name}.txt`), log);
  const ok = r.status === st.expect;
  if (!ok) failed++;
  rows.push(`| ${st.name} | ${r.status} | ${ok ? 'as expected' : 'UNEXPECTED'} | ${secs} s |`);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${st.name} (exit ${r.status}, ${secs} s)`);
}
if (existsSync(join(OUT, 'audit.json'))) writeFileSync(join(OUT, 'audit.json'), scrub(readFileSync(join(OUT, 'audit.json'), 'utf8')));

// environment, read from the browser itself
const { launch } = await import(pathToFileURL(join(QA, 'cdp.mjs')).href);
let browser = 'unknown';
try { const { proc, port: p } = await launch(port++); browser = (await (await fetch(`http://127.0.0.1:${p}/json/version`)).json()).Browser; proc.kill(); } catch (e) { browser = 'not started: ' + e.message; }
const env = `date: ${new Date().toISOString().slice(0, 10)}\nnode: ${process.version}\nbrowser: ${browser}\nos: ${os.type()} ${os.release()} (${process.platform})\n`;
writeFileSync(join(OUT, 'environment.txt'), env);
writeFileSync(join(OUT, 'summary.md'), `| step | exit | result | time |\n|---|---|---|---|\n${rows.join('\n')}\n`);
console.log(`\n${steps.length - failed}/${steps.length} steps as expected -> ${scrub(OUT)}`);
console.log(readdirSync(join(OUT, 'shots')).length, 'screenshots');
process.exit(failed ? 1 : 0);

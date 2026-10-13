// Syntax-check every inline <script> (no src, JS type) in every *.html under a folder (recursive, so
// clean-URL subfolders like de/index.html are included) with `node --check`, and flag C0 control
// characters (a Python "\1" in a non-raw replacement string injects byte 0x01 and silently kills a whole
// IIFE - the page still renders). A page that LOOKS fine proves nothing.
//   node jscheck.mjs <dir>      exit 1 on any failure, 2 on bad usage
// Only classic scripts and modules are checked: no type, or a JavaScript MIME type, or type="module".
// JSON-LD, templates, importmaps and any other type are data, not code, and are skipped.
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = process.argv[2];
if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) { console.error('usage: node jscheck.mjs <dir>'); process.exit(2); }

const SKIP_DIRS = new Set(['node_modules', '.git', '.versions']);
function* htmlFiles(d) {
  for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* htmlFiles(join(d, e.name)); }
    else if (e.name.endsWith('.html')) yield join(d, e.name);
  }
}

const JS_TYPE = /^(|text\/javascript|application\/javascript|application\/ecmascript|text\/ecmascript|module)$/i;
const typeOf = attrs => ((/\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs) || [])[1] || '').trim();
const tmp = mkdtempSync(join(tmpdir(), 'jscheck-'));
const RE = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
let n = 0, bad = 0, files = 0;
for (const file of htmlFiles(dir)) {
  files++;
  const f = relative(dir, file).replace(/\\/g, '/');
  const s = readFileSync(file, 'utf8');
  const cc = /[\x00-\x08\x0b\x0c\x0e-\x1f]/.exec(s);
  if (cc) { bad++; console.log(`FAIL ${f}: control character 0x${cc[0].charCodeAt(0).toString(16).padStart(2, '0')} at offset ${cc.index}`); }
  let m, i = 0;
  RE.lastIndex = 0;
  while ((m = RE.exec(s))) {
    const type = typeOf(m[1]);
    const idx = i++;
    if (!JS_TYPE.test(type)) continue;
    const p = join(tmp, `${f.replace(/[\\/]/g, '__')}.${idx}.${/module/i.test(type) ? 'mjs' : 'js'}`);
    writeFileSync(p, m[2]); n++;
    const r = spawnSync(process.execPath, ['--check', p], { encoding: 'utf8' });
    if (r.status !== 0) { bad++; console.log(`FAIL ${f} script #${idx}: ` + (r.stderr || '').split('\n').filter(Boolean).slice(0, 5).join(' | ')); }
  }
}
rmSync(tmp, { recursive: true, force: true });
console.log(`${files} html files, ${n} inline scripts checked, ${bad} failures`);
process.exit(bad ? 1 : 0);

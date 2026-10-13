// Syntax-check every inline <script> (no src, JS type) in every *.html of a folder with `node --check`,
// and flag C0 control characters (a Python "\1" in a non-raw replacement string injects byte 0x01 and
// silently kills a whole IIFE - the page still renders). A page that LOOKS fine proves nothing.
//   node jscheck.mjs <dir>      exit 1 on any failure
import { readdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = process.argv[2];
if (!dir) { console.error('usage: node jscheck.mjs <dir>'); process.exit(2); }
const tmp = mkdtempSync(join(tmpdir(), 'jscheck-'));
const RE = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
let n = 0, bad = 0;
for (const f of readdirSync(dir).filter(f => f.endsWith('.html')).sort()) {
  const s = readFileSync(join(dir, f), 'utf8');
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s)) { bad++; console.log('FAIL control character in', f); }
  let m, i = 0;
  while ((m = RE.exec(s))) {
    const attrs = m[1];
    if (/type\s*=\s*["']?(application\/(ld\+)?json|text\/template|importmap|speculationrules)/i.test(attrs)) continue;
    const isModule = /type\s*=\s*["']?module/i.test(attrs);
    const p = join(tmp, `${f}.${i++}.${isModule ? 'mjs' : 'js'}`);
    writeFileSync(p, m[2]); n++;
    const r = spawnSync(process.execPath, ['--check', p], { encoding: 'utf8' });
    if (r.status !== 0) { bad++; console.log('FAIL', f, 'script #' + (i - 1), (r.stderr || '').split('\n').slice(0, 5).join(' | ')); }
  }
}
console.log(`${n} inline scripts checked, ${bad} failures`);
process.exit(bad ? 1 : 0);

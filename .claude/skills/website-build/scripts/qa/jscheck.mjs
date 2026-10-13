// Syntax-check every piece of inline JavaScript in every *.html under a folder (recursive, so clean-URL
// subfolders like de/index.html are included), and flag C0 control characters (a Python "\1" in a non-raw
// replacement string injects byte 0x01 and silently kills a whole IIFE - the page still renders).
// A page that LOOKS fine proves nothing.
//   node jscheck.mjs <dir>
// Exit: 0 clean, 1 findings, 2 bad usage, 3 could not run.
//
// What is checked, and as what:
//   <script> with no src and no type / a JavaScript MIME type -> a classic browser script (vm.Script: top-level
//       `return`, `await` or `import` are errors, exactly as in a browser; `node --check` would wrap it as
//       CommonJS and accept a top-level return)
//   <script type="module">                                   -> an ES module (import/export, top-level await)
//   on*="..." event-handler attributes on any element        -> a function body (`return false` is fine)
// Skipped: <script src>, JSON-LD, importmaps, templates and any other type (data, not code), and anything
// inside <!-- comments --> or other raw-text elements (<style>, <textarea>, <title>).
// Attributes are parsed per name, so data-src / data-type / data-onclick are not mistaken for src / type / onclick.
import { readdirSync, readFileSync, existsSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

export const JS_TYPE = /^(|text\/javascript|application\/javascript|application\/ecmascript|text\/ecmascript|application\/x-javascript|text\/jscript|module)$/i;
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'noembed', 'noframes']);

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const decode = v => v.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e.toLowerCase()] ?? m));

// Parses the inside of a start tag from position i (just after the tag name) to its closing '>',
// respecting quotes. Returns { attrs: [[name, value|null], ...], end } with end = index after '>'.
export function parseAttrs(s, i) {
  const attrs = [];
  const n = s.length;
  while (i < n) {
    while (i < n && /[\s/]/.test(s[i])) i++;
    if (s[i] === '>') return { attrs, end: i + 1 };
    if (i >= n) break;
    let name = '';
    while (i < n && !/[\s/>=]/.test(s[i])) name += s[i++];
    while (i < n && /\s/.test(s[i])) i++;
    let value = null;
    if (s[i] === '=') {
      i++;
      while (i < n && /\s/.test(s[i])) i++;
      if (s[i] === '"' || s[i] === "'") {
        const q = s[i++]; const j = s.indexOf(q, i);
        value = s.slice(i, j < 0 ? n : j); i = j < 0 ? n : j + 1;
      } else {
        value = '';
        while (i < n && !/[\s>]/.test(s[i])) value += s[i++];
      }
      value = decode(value);
    }
    if (name) attrs.push([name.toLowerCase(), value]);
  }
  return { attrs, end: n };
}

// Yields { kind: 'script', attrs, code, line } and { kind: 'handler', tag, name, code, line } for one HTML string.
export function* scan(html) {
  // line starts computed once, then a binary search per lookup (slicing from 0 each time was O(n^2))
  const starts = [0];
  for (let i = html.indexOf('\n'); i >= 0; i = html.indexOf('\n', i + 1)) starts.push(i + 1);
  const lineAt = idx => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= idx) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
  const re = /<!--|<([a-zA-Z][a-zA-Z0-9:-]*)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[0] === '<!--') { const e = html.indexOf('-->', m.index + 4); re.lastIndex = e < 0 ? html.length : e + 3; continue; }
    const tag = m[1].toLowerCase();
    const { attrs, end } = parseAttrs(html, m.index + m[0].length);
    for (const [name, value] of attrs)
      if (/^on[a-z]+$/.test(name) && value !== null && value.trim()) yield { kind: 'handler', tag, name, code: value, line: lineAt(m.index) };
    re.lastIndex = end;
    if (RAW_TEXT.has(tag)) {
      const close = new RegExp(`</${tag}[\\s/>]`, 'ig'); close.lastIndex = end;
      const c = close.exec(html);
      const bodyEnd = c ? c.index : html.length;
      if (tag === 'script') yield { kind: 'script', attrs: Object.fromEntries(attrs), code: html.slice(end, bodyEnd), line: lineAt(end) };
      re.lastIndex = c ? c.index + c[0].length : html.length;
    }
  }
}

const firstLine = e => String(e && e.message || e).split('\n')[0];
// Returns null when the code compiles, else the error message. Nothing is executed.
export function checkClassic(code, filename = 'inline.js') {
  try { new vm.Script(code, { filename }); return null; } catch (e) { return firstLine(e); }
}
export function checkHandler(code) {
  try { vm.compileFunction(code, ['event']); return null; } catch (e) { return firstLine(e); }
}
// Modules: vm.SourceTextModule needs a flag, so modules go through `node --check` on a .mjs file (ESM grammar).
export function checkModule(code, tmp) {
  const p = join(tmp, `m${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(p, code);
  const r = spawnSync(process.execPath, ['--check', p], { encoding: 'utf8' });
  return r.status === 0 ? null : (r.stderr || '').split('\n').filter(l => /Error/.test(l))[0] || 'syntax error';
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.versions']);
function* htmlFiles(d) {
  for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* htmlFiles(join(d, e.name)); }
    else if (e.name.endsWith('.html')) yield join(d, e.name);
  }
}

function run() {
  const dir = process.argv[2];
  if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) { console.error('usage: node jscheck.mjs <dir>'); return 2; }
  const tmp = mkdtempSync(join(tmpdir(), 'jscheck-'));
  let scripts = 0, handlers = 0, bad = 0, files = 0;
  try {
    for (const file of htmlFiles(dir)) {
      files++;
      const f = relative(dir, file).replace(/\\/g, '/');
      const s = readFileSync(file, 'utf8');
      const cc = /[\x00-\x08\x0b\x0c\x0e-\x1f]/.exec(s);
      if (cc) { bad++; console.log(`FAIL ${f}: control character 0x${cc[0].charCodeAt(0).toString(16).padStart(2, '0')} at offset ${cc.index}`); }
      let idx = 0;
      for (const item of scan(s)) {
        if (item.kind === 'handler') {
          handlers++;
          const err = checkHandler(item.code);
          if (err) { bad++; console.log(`FAIL ${f}:${item.line} <${item.tag} ${item.name}>: ${err}`); }
          continue;
        }
        const i = idx++;
        if ('src' in item.attrs) continue;
        const type = (item.attrs.type || '').trim();
        if (!JS_TYPE.test(type)) continue;
        scripts++;
        const isModule = /^module$/i.test(type);
        const err = isModule ? checkModule(item.code, tmp) : checkClassic(item.code, `${f}#${i}`);
        if (err) { bad++; console.log(`FAIL ${f} script #${i} (${isModule ? 'module' : 'classic'}, line ${item.line}): ${err}`); }
      }
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  console.log(`${files} html files, ${scripts} inline scripts and ${handlers} event handlers checked, ${bad} failures`);
  return bad ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exit(run()); } catch (e) { console.error('could not run: ' + e.message); process.exit(3); }
}

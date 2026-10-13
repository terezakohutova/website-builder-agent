// Content probes, one load per page at one width:
//   text   -> <out>/<page>.txt  visible copy dump (read it: it finds empty cards, stale numbers, wrong names)
//   struct -> headings whose container has no body copy (title + icon, no text)
//   heads  -> headings that wrap into more lines than their parent needs
//   node content.mjs <dir|url> <text|struct|heads> [outDir] [width=1440]
import { launch, connect, goto, ev, listPages, short } from './cdp.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const [target, mode = 'text', outDir = 'qa-text', W = '1440'] = process.argv.slice(2);
if (!target || !['text', 'struct', 'heads'].includes(mode)) { console.error('usage: node content.mjs <dir|url> <text|struct|heads> [outDir] [width]'); process.exit(2); }
const probe = readFileSync(new URL(`./probe-${mode}.js`, import.meta.url), 'utf-8');
const w = +W, mobile = w < 600;
const pages = await listPages(target);
if (mode === 'text') mkdirSync(outDir, { recursive: true });
const { proc, wsUrl } = await launch(+(process.env.QA_PORT || 9335)); const s = await connect(wsUrl);
let found = 0;
for (const u of pages) {
  await goto(s, u, { width: w, height: mobile ? 844 : 900, mobile });
  const r = await ev(s, probe);
  const name = short(u).replace(/[\\/:?#&=]+/g, '_').replace(/^_/, '') || 'index';
  if (mode === 'text') { writeFileSync(`${outDir}/${name}.txt`, r, 'utf-8'); console.log(short(u), r.split('\n').length, 'lines'); }
  else if (mode === 'struct') {
    const rows = JSON.parse(r); found += rows.length;
    console.log('\n### ' + short(u) + (rows.length ? '' : ' - none'));
    rows.forEach(x => console.log(`  ${x.h} "${x.head}" | box=${x.box} sibs=${x.sibs} | after="${x.after}"`));
  } else if (r) { found++; console.log('== ' + short(u) + '\n' + r); }
}
proc.kill(); process.exit(0);

// Content probes, one load per page at one width:
//   text   -> <out>/<page>.txt  visible copy dump (read it: it finds empty cards, stale numbers, wrong names)
//   struct -> headings whose container has no body copy (title + icon, no text)
//   heads  -> headings that wrap into more lines than their parent needs
//   node content.mjs <dir|url> <text|struct|heads> [outDir] [width=1440]
// Exit: 0 clean, 1 findings (struct/heads rows, or a page that fails to load; a text dump is not a finding),
// 2 bad usage, 3 could not run.
import { main, open, visit, ev, listPages, short, slug, UsageError, isMobile, defaultHeight } from './cdp.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

main(async () => {
  const [target, mode = 'text', outDir = 'qa-text', W = '1440'] = process.argv.slice(2);
  if (!target || !['text', 'struct', 'heads'].includes(mode) || !/^\d+$/.test(W)) throw new UsageError('node content.mjs <dir|url> <text|struct|heads> [outDir] [width]');
  const probe = readFileSync(new URL(`./probe-${mode}.js`, import.meta.url), 'utf-8');
  const w = +W, mobile = isMobile(w);
  const pages = await listPages(target);
  if (mode === 'text') mkdirSync(outDir, { recursive: true });
  const { s } = await open();
  let found = 0;
  for (const u of pages) {
    const nav = await visit(s, u, { width: w, height: defaultHeight(w), mobile });
    if (!nav.ok) { found++; console.log(`FAIL ${short(u)} ${nav.error}`); continue; }
    const r = await ev(s, probe);
    if (mode === 'text') { writeFileSync(`${outDir}/${slug(u)}.txt`, r, 'utf-8'); console.log(short(u), r.split('\n').length, 'lines'); }
    else if (mode === 'struct') {
      const rows = JSON.parse(r); found += rows.length;
      console.log('\n### ' + short(u) + (rows.length ? '' : ' - none'));
      rows.forEach(x => console.log(`  ${x.h} "${x.head}" | box=${x.box} sibs=${x.sibs} | after="${x.after}"`));
    } else if (r) { found += r.split('\n').length; console.log('== ' + short(u) + '\n' + r); }
  }
  if (mode !== 'text') console.log(`\n${pages.length} pages, ${found} findings`);
  return found;
});

// Console sweep of a LIVE (or preview) site: every sitemap URL at desktop + mobile, before consent,
// scrolled to the bottom; collects JS exceptions, console.error/warn, Log errors/warnings (CSP
// report-only violations land here), failed requests and HTTP >= 400. Then, optionally, the same
// after clicking "accept all" (QA_ACCEPT=".cookie-accept"), on the URLs matching QA_POST (regex).
//   node console-sweep.mjs https://www.example.com [out.json]
// Exit: 0 clean, 1 findings (any issue or a page that fails to load), 2 bad usage, 3 could not run.
// QA_IGNORE=<regex> drops known noise (e.g. "Duplicate Pixel"); /favicon.ico is always ignored.
// Paced: one load at a time.
import { main, open, visit, ev, collectIssues, listPages, widths, short, scrollAndSettle, networkIdle, ignoreFilter, UsageError } from './cdp.mjs';
import { writeFileSync } from 'node:fs';

main(async () => {
  const [target, outFile = 'console-sweep.json'] = process.argv.slice(2);
  if (!target) throw new UsageError('node console-sweep.mjs <url|dir> [out.json]');
  const W = widths();
  const clean = ignoreFilter();
  let post = null;
  if (process.env.QA_ACCEPT) {
    try { post = new RegExp(process.env.QA_POST || '.'); } catch (e) { throw new UsageError('QA_POST is not a valid regex: ' + e.message); }
  }
  const urls = await listPages(target);
  const { s } = await open();
  const report = { pre: {}, post: {} };
  for (const u of urls) for (const [w, h, m] of W) {
    await s.send('Network.clearBrowserCookies');
    const nav = await visit(s, u, { width: w, height: h, mobile: m });
    let r;
    if (!nav.ok) r = ['[page] ' + nav.error];
    else { await scrollAndSettle(s, await ev(s, 'document.documentElement.scrollHeight')); r = clean(collectIssues(s)); }
    if (r.length) { report.pre[`${u} @${w}`] = r; console.log('ISSUES', short(u), w, r.length, '|', r[0].slice(0, 160)); }
    else console.log('ok    ', short(u), w);
  }
  if (post) {
    for (const u of urls.filter(x => post.test(x))) {
      const nav = await visit(s, u, { width: 1440, height: 900 });
      let r;
      if (!nav.ok) r = ['[page] ' + nav.error];
      else {
        await ev(s, `(document.querySelector(${JSON.stringify(process.env.QA_ACCEPT)})||{click(){}}).click();1`);
        await networkIdle(s, { cap: 8000 });   // tags load after consent
        r = clean(collectIssues(s));
      }
      if (r.length) { report.post[u] = r; console.log('ISSUES after consent', short(u), r.length); }
      await s.send('Network.clearBrowserCookies'); await ev(s, 'try{localStorage.clear()}catch(e){};1').catch(() => {});
    }
  }
  writeFileSync(outFile, JSON.stringify(report, null, 1));
  const n = Object.keys(report.pre).length + Object.keys(report.post).length;
  console.log('urls', urls.length, '| pre-consent with issues', Object.keys(report.pre).length, '| post-consent with issues', Object.keys(report.post).length, '->', outFile);
  return n;
});

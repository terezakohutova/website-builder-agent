// Console sweep of a LIVE (or preview) site: every sitemap URL at desktop + mobile, before consent,
// scrolled to the bottom; collects JS exceptions, console.error/warn, Log errors/warnings (CSP
// report-only violations land here), failed requests and HTTP >= 400. Then, optionally, the same
// after clicking "accept all" (QA_ACCEPT=".cookie-accept"), on the URLs matching QA_POST (regex).
//   node console-sweep.mjs https://www.example.com [out.json]
// Paced: one load at a time.
import { launch, connect, goto, ev, collectIssues, listPages, widths, short, wait } from './cdp.mjs';
import { writeFileSync } from 'node:fs';

const [target, outFile = 'console-sweep.json'] = process.argv.slice(2);
if (!target) { console.error('usage: node console-sweep.mjs <url> [out.json]'); process.exit(2); }
const urls = await listPages(target);
const IGNORE = process.env.QA_IGNORE ? new RegExp(process.env.QA_IGNORE) : null;   // e.g. "favicon|Duplicate Pixel"
const { proc, wsUrl } = await launch(+(process.env.QA_PORT || 9461)); const s = await connect(wsUrl);
const report = { pre: {}, post: {} };
const clean = r => IGNORE ? r.filter(x => !IGNORE.test(x)) : r;
for (const u of urls) for (const [w, h, m] of widths()) {
  await s.send('Network.clearBrowserCookies');
  await goto(s, u, { width: w, height: h, mobile: m });
  await ev(s, `window.scrollTo(0, document.body.scrollHeight)`); await wait(1200);
  const r = clean(collectIssues(s));
  if (r.length) { report.pre[`${u} @${w}`] = r; console.log('ISSUES', short(u), w, r.length); }
}
if (process.env.QA_ACCEPT) {
  const post = urls.filter(u => new RegExp(process.env.QA_POST || '.').test(u));
  for (const u of post) {
    await goto(s, u, { width: 1440, height: 900 });
    await ev(s, `(document.querySelector(${JSON.stringify(process.env.QA_ACCEPT)})||{click(){}}).click()`); await wait(7000);
    const r = clean(collectIssues(s));
    if (r.length) report.post[u] = r;
    await s.send('Network.clearBrowserCookies'); await ev(s, 'localStorage.clear()');
  }
}
writeFileSync(outFile, JSON.stringify(report, null, 1));
console.log('urls', urls.length, '| pre-consent with issues', Object.keys(report.pre).length, '| post-consent with issues', Object.keys(report.post).length, '->', outFile);
proc.kill(); process.exit(0);

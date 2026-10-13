// Pure helpers for inapp.mjs (no Playwright, no browser): context list, argument parsing and the verdict
// on one result row. Kept separate so they are unit-tested without WebKit installed.
import { readFileSync } from 'node:fs';

export const DATA_URL = new URL('./inapp-contexts.json', import.meta.url);
export const STALE_DAYS = 180;

// Contexts from the data file, {ios}/{android} expanded, filtered by `only` (array of ids).
// Throws on an unknown id so a typo in CTX does not silently test nothing.
export function contexts(data = JSON.parse(readFileSync(DATA_URL, 'utf8')), only = null) {
  const all = data.contexts.map(c => ({ ...c, ua: c.ua ? c.ua.replace(/\{(\w+)\}/g, (_, k) => data.base[k] ?? `{${k}}`) : undefined }));
  if (!only) return all;
  const unknown = only.filter(id => !all.some(c => c.id === id));
  if (unknown.length) throw new Error(`unknown CTX id(s): ${unknown.join(', ')} (known: ${all.map(c => c.id).join(', ')})`);
  return all.filter(c => only.includes(c.id));
}

// Days since the data file's "updated" date; NaN when it is missing or not a date.
export function ageDays(data, now = new Date()) {
  const t = Date.parse(data.updated || '');
  return Number.isNaN(t) ? NaN : Math.floor((now - t) / 86400000);
}

// Parses argv + env into options, or returns { error } for bad usage.
export function parseArgs(argv, env = {}) {
  const base = (argv[0] || '').replace(/\/$/, '');
  if (!/^https?:\/\/[^/\s]+/.test(base)) return { error: 'node inapp.mjs <http(s)-base-url> [out-dir]' };
  const pages = (env.PAGES || '/').split(',').map(p => p.trim()).filter(Boolean);
  const bad = pages.find(p => !p.startsWith('/'));
  if (bad) return { error: `PAGES entries must start with "/" (got "${bad}")` };
  const cc = env.QA_COOKIE_BAR || '.cookie-bar';
  return {
    base, out: argv[1] || 'out', pages,
    only: env.CTX ? env.CTX.split(',').map(x => x.trim()).filter(Boolean) : null,
    locale: env.QA_LOCALE || 'en-US',
    sel: { cc, accept: env.QA_ACCEPT || cc + ' button', burger: env.QA_BURGER || '.menu-toggle', badge: env.QA_BADGE || '.store-badge', hero: env.QA_HERO || '.hero' },
  };
}

// The findings for one result row (empty array = ok). A row is what inapp.mjs collected for one context x page.
export function findings(r) {
  const out = [];
  if (r.fatal) out.push('fatal: ' + r.fatal);
  if (typeof r.status === 'number' && r.status >= 400) out.push(`HTTP ${r.status}`);
  if (r.over && r.over.length) out.push('overflow: ' + r.over.join(' '));
  if (typeof r.sw === 'number' && typeof r.W === 'number' && r.sw > r.W + 1) out.push(`document ${r.sw}px wider than viewport ${r.W}px`);
  if (r.brokenImg && r.brokenImg.length) out.push('broken images: ' + r.brokenImg.join(' '));
  if (r.errs && r.errs.length) out.push('JS errors: ' + r.errs.length);
  if (r.cons && r.cons.length) out.push('console errors: ' + r.cons.length);
  if (r.bad && r.bad.length) out.push('HTTP >= 400: ' + r.bad.slice(0, 3).join(', '));
  if (/NOT-OPEN|ERR/.test(r.menu || '')) out.push('menu: ' + r.menu);
  if (/FAIL|STILL/.test(r.ccClick || '')) out.push('cookie bar: ' + r.ccClick);
  return out;
}

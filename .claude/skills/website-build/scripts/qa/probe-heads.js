(() => {
  // Headings that wrap into more lines than their parent's width needs ("weirdly broken headings").
  // Skip selectors are site-specific: set window.__QA_HEAD_SKIP before evaluating to override.
  const SKIP = window.__QA_HEAD_SKIP || 'nav,header [role=dialog],[aria-hidden=true]';
  const out = [];
  for (const h of document.querySelectorAll('h1,h2,h3')) {
    if (h.closest(SKIP)) continue;
    const b = h.getBoundingClientRect(); if (!b.width) continue;
    const r = document.createRange(); r.selectNodeContents(h);
    const rects = [...r.getClientRects()].filter(x => x.width > 2);
    const rows = [];
    for (const x of rects) {
      let row = rows.find(q => Math.abs(q.top - x.top) < 8);
      if (!row) rows.push(row = { top: x.top, l: x.left, r: x.right });
      row.l = Math.min(row.l, x.left); row.r = Math.max(row.r, x.right);
    }
    const n = rows.length; if (n < 2) continue;
    const par = h.parentElement.getBoundingClientRect().width;
    const total = rows.reduce((a, q) => a + (q.r - q.l), 0);
    const need = Math.ceil(total / (par * 0.97));
    const txt = h.textContent.replace(/\s+/g, ' ').trim();
    if (n > need) out.push(n + ' lines (fits ' + need + ') h=' + Math.round(b.width) + ' parent=' + Math.round(par) + ' | ' + txt.slice(0, 90));
  }
  return out.join('\n');
})()

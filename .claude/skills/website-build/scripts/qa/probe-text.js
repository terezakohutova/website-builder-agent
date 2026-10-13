(() => {
  // Visible copy of <main> (or <body>), one "TAG :: text" line per element with its own text,
  // de-duplicated. Reading this dump is what surfaced empty cards and contradictory figures.
  const m = document.querySelector('main') || document.body;
  const skip = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']);
  const w = document.createTreeWalker(m, NodeFilter.SHOW_ELEMENT);
  const lines = []; const seen = new Set();
  const push = (tag, txt) => {
    txt = (txt || '').replace(/\s+/g, ' ').trim();
    if (!txt) return;
    const k = tag + '|' + txt;
    if (seen.has(k)) return; seen.add(k);
    lines.push(tag + ' :: ' + txt);
  };
  let n;
  while ((n = w.nextNode())) {
    if (skip.has(n.tagName)) continue;
    if (getComputedStyle(n).display === 'none') continue;
    const own = [...n.childNodes].filter(c => c.nodeType === 3).map(c => c.textContent).join(' ').replace(/\s+/g, ' ').trim();
    if (own) push(n.tagName, own);
  }
  return lines.join('\n');
})()

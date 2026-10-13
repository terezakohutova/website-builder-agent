(() => {
  // Headings (h2-h4) whose container has no body copy (p, li, blockquote, table, dd):
  // the "card with a title and an icon but no text" bug.
  const out = [];
  document.querySelectorAll('h2,h3,h4').forEach(h => {
    const box = h.parentElement;
    if (!box) return;
    if (getComputedStyle(h).display === 'none') return;
    if (box.querySelector('p, li, blockquote, table, dd')) return;
    let after = '';
    let n = h.nextElementSibling;
    while (n) { after += ' ' + (n.innerText || ''); n = n.nextElementSibling; }
    after = after.replace(/\s+/g, ' ').trim();
    const cls = (box.className && typeof box.className === 'string') ? box.className : '';
    out.push({
      h: h.tagName,
      head: (h.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 70),
      box: box.tagName.toLowerCase() + (cls ? '.' + cls.trim().split(/\s+/).join('.') : ''),
      after: after.slice(0, 80),
      sibs: box.children.length
    });
  });
  return JSON.stringify(out);
})()

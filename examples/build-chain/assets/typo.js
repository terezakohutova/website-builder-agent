// Runtime typography: glue short words to the next word with a no-break space, per page language, so a
// line never ends on "a" or "zu". Done in the browser, never in the HTML, because the i18n builder matches
// copy by exact text and a hand-inserted &nbsp; would break the match.
// Regexes are literals on purpose: a regex built from a string once lost a backslash ("\s" became "s").
// The lookbehind only reads the space before a word and the match ends before the next word, so a run of
// short words ("in a box to a place") is glued word by word. Case-insensitive, so a sentence-start "A" or
// "In" is glued too. The brand name comes from data-brand on this script tag (written by build.py from
// site.json) and is kept on one line.
(function () {
  const NBSP = '\u00a0';
  const RULES = {
    en: /(?<=^|[\s\u00a0(])(a|an|i|to|of|in|on|at|by)\s+(?=\S)/gi,
    de: /(?<=^|[\s\u00a0(])(zu|im|am|an|in|um|ob|da|so)\s+(?=\S)/gi,
  };
  function glue(text, lang, brand) {
    let t = text;
    if (brand && brand.includes(' ')) t = t.split(brand).join(brand.split(' ').join(NBSP));
    const rule = RULES[(lang || 'en').slice(0, 2).toLowerCase()];
    if (rule) t = t.replace(rule, (m, word) => word + NBSP);
    return t;
  }
  if (typeof module === 'object' && module.exports) { module.exports = { glue, RULES }; return; }
  const brand = (document.currentScript && document.currentScript.dataset.brand) || '';
  const lang = document.documentElement.lang || 'en';
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const skip = el => el.closest('script,style,code,pre,textarea');
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.parentElement || skip(n.parentElement) || !n.nodeValue.trim()) continue;
    const t = glue(n.nodeValue, lang, brand);
    if (t !== n.nodeValue) n.nodeValue = t;
  }
})();

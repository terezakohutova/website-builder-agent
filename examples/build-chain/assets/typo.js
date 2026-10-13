// Runtime typography: glue short words to the next word with a no-break space, per page language, so a
// line never ends on "a" or "zu". Done in the browser, never in the HTML, because the i18n builder matches
// copy by exact text and a hand-inserted &nbsp; would break the match.
// Regexes are literals on purpose: a regex built from a string once lost a backslash ("\s" became "s").
(() => {
  const RULES = {
    en: /(^|\s)(a|an|I|to|of|in|on|at|by)\s+/g,
    de: /(^|\s)(zu|im|am|an|in|um|ob|da|so)\s+/gi,
  };
  const BRAND = /Lumen Notes/g;
  const lang = (document.documentElement.lang || 'en').slice(0, 2).toLowerCase();
  const rule = RULES[lang];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const skip = el => el.closest('script,style,code,pre,textarea');
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.parentElement || skip(n.parentElement) || !n.nodeValue.trim()) continue;
    let t = n.nodeValue.replace(BRAND, 'Lumen Notes');
    if (rule) t = t.replace(rule, (m, pre, word) => pre + word + ' ');
    if (t !== n.nodeValue) n.nodeValue = t;
  }
})();

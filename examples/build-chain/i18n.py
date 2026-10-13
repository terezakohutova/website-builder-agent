"""Language builder: master page + dictionary -> language version, by exact text match.

A text node is translated only when its stripped text is a key in strings-<lang>.json; the surrounding
whitespace is kept. The same goes for the alt, aria-label, title and placeholder attributes. Scripts, styles,
comments, <title> and the marked seo/langs blocks are never touched (seo.py and the langs step own those).
Anything with letters that is neither in the dictionary nor in the `keep` list is reported as untranslated,
and the build fails: a master-copy change without a dictionary entry must not ship master language on a
foreign page. That is also why line breaks are done at runtime (assets/typo.js): `foo&nbsp;bar` is not the
key `foo bar`.

This example does not translate JS string literals (the real builder used a small JS lexer for that); copy
that lives in scripts is caught by the leftover check instead.
"""
import html
import re

PROTECTED = re.compile(r'<script\b.*?</script\s*>|<style\b.*?</style\s*>|<!--.*?-->|<title\b.*?</title\s*>',
                       re.S | re.I)
TEXT = re.compile(r'>([^<>]+)<')
ATTR = re.compile(r'(\s(?:alt|aria-label|title|placeholder)\s*=\s*)(["\'])(.*?)\2', re.I)
HREF = re.compile(r'(\shref\s*=\s*)(["\'])([^"\'#?:]+\.html)(["\'#?])', re.I)
LETTER = re.compile(r'[^\W\d_]')


def protected_spans(doc):
    return [m.span() for m in PROTECTED.finditer(doc)]


def inside(pos, spans):
    return any(a <= pos < b for a, b in spans)


def variant_name(page, lang, master):
    return page if lang == master else re.sub(r'\.html$', f'-{lang}.html', page)


def translate(doc, lang, strings, keep, page_langs, master):
    """Returns (translated_html, untranslated_list). page_langs: {page: [langs]} of the whole build."""
    spans = protected_spans(doc)
    edits, missing = [], []

    def lookup(text):
        key = text.strip()
        if not key or not LETTER.search(key) or key in keep:
            return None
        if key in strings:
            return text.replace(key, strings[key], 1)
        missing.append(key)
        return None

    for m in TEXT.finditer(doc):
        if inside(m.start(), spans):
            continue
        new = lookup(html.unescape(m.group(1)))
        if new is not None:
            edits.append((m.start(1), m.end(1), html.escape(new, quote=False)))
    for m in ATTR.finditer(doc):
        if inside(m.start(), spans):
            continue
        new = lookup(html.unescape(m.group(3)))
        if new is not None:
            edits.append((m.start(3), m.end(3), html.escape(new, quote=True)))
    # links to pages that exist in this language point at that language's file
    for m in HREF.finditer(doc):
        if inside(m.start(), spans):
            continue
        target = m.group(3)
        if lang in page_langs.get(target, []):
            edits.append((m.start(3), m.end(3), variant_name(target, lang, master)))
    out = doc
    for a, b, text in sorted(edits, reverse=True):   # last to first, so offsets stay valid
        out = out[:a] + text + out[b:]
    out = re.sub(r'(<html\b[^>]*\blang=)(["\'])[^"\']*\2', rf'\g<1>"{lang}"', out, count=1, flags=re.I)
    return out, sorted(set(missing))


def leftovers(doc, pattern):
    """Master-language-looking words left in visible text or translatable attributes of a built variant."""
    rx = re.compile(pattern, re.I)
    spans = protected_spans(doc)
    found = []
    for m in TEXT.finditer(doc):
        if not inside(m.start(), spans) and rx.search(html.unescape(m.group(1))):
            found.append(m.group(1).strip())
    for m in ATTR.finditer(doc):
        if not inside(m.start(), spans) and rx.search(html.unescape(m.group(3))):
            found.append(m.group(3).strip())
    # copy in inline scripts is not translated by this builder: catch string literals that look like master copy
    for m in re.finditer(r'<script\b(?![^>]*\bsrc=)(?![^>]*application/ld\+json)[^>]*>(.*?)</script\s*>', doc, re.S | re.I):
        for lit in string_literals(m.group(1)):
            if ' ' in lit and rx.search(lit):
                found.append(lit)
    return found


def string_literals(js):
    """String literals of a script, read left to right (skips // and /* */ comments; not a full JS lexer)."""
    out, i, n = [], 0, len(js)
    while i < n:
        c = js[i]
        if js.startswith('//', i):
            i = js.find('\n', i)
            i = n if i < 0 else i
        elif js.startswith('/*', i):
            i = js.find('*/', i + 2)
            i = n if i < 0 else i + 2
        elif c in '"\'`':
            j, buf = i + 1, []
            while j < n and js[j] != c:
                if js[j] == '\\':
                    j += 1
                buf.append(js[j] if j < n else '')
                j += 1
            out.append(''.join(buf))
            i = j + 1
        else:
            i += 1
    return out


def lang_switch(doc, page, lang, page_langs, labels, master):
    """Fills <!--langs:start--><!--langs:end--> with real links to this page's other languages."""
    links = ''.join(
        f'<a class="lang" href="{variant_name(page, other, master)}" hreflang="{other}" lang="{other}">{labels[other]}</a>'
        for other in page_langs.get(page, []) if other != lang)
    return re.sub(r'<!--langs:start-->.*?<!--langs:end-->', lambda _: f'<!--langs:start-->{links}<!--langs:end-->',
                  doc, flags=re.S)

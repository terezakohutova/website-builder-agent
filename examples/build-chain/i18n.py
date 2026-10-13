"""Language builder: master page + dictionary -> language version, by exact text match.

Two modes, tried in this order:

1. Block mode. A block element (p, h1-h6, li, summary, dt, dd, td, th, figcaption, label, button, blockquote)
   whose content mixes text with inline tags (a, b, strong, em, i, span, code, small, br, ...) is looked up
   as ONE key, with each inline element written as a numbered placeholder:
       master   <p>You can <b>sync</b> your notes <a href="#l">later</a>.</p>
       key      You can {0}sync{/0} your notes {1}later{/1}.
       de       Sie können Ihre Notizen {1}später{/1} {0}synchronisieren{/0}.
   The translation may move the placeholders, so word order follows the target language (German puts the
   verb last). Void tags such as <br> are {n/}. Whitespace runs in the key are one space. The original tags,
   attributes included, are put back around the translated text; their alt/title/aria-label are translated
   too. A translation whose placeholders differ from the key is reported and fails the build.
2. Fragment mode (fallback, and the only mode for plain text): a text node is translated when its stripped
   text is a key in strings-<lang>.json; the surrounding whitespace is kept. When a block has no block key,
   its fragments are looked up one by one, as before.

The alt, aria-label, title and placeholder attributes are translated the same way. Scripts, styles, comments,
<title> and the marked seo/langs blocks are never touched (seo.py and the langs step own those). Anything
with letters that is neither in the dictionary nor in the `keep` list is reported as untranslated, and the
build fails: a master-copy change without a dictionary entry must not ship master language on a foreign
page. That is also why line breaks are done at runtime (assets/typo.js): `foo&nbsp;bar` is not the key
`foo bar`.

Links: `localise_links()` points internal links (bare `privacy.html`, root-relative `/privacy.html`, `./` and
`../` relative) at the language version when the target page exists in that language, and warns about
internal links it cannot localise.

This example does not translate JS string literals (the real builder used a small JS lexer for that); copy
that lives in scripts is caught by the leftover check instead, which tokenizes scripts (regex literals and
template strings included).
"""
import html
import posixpath
import re

PROTECTED = re.compile(r'<script\b.*?</script\s*>|<style\b.*?</style\s*>|<!--.*?-->|<title\b.*?</title\s*>',
                       re.S | re.I)
TEXT = re.compile(r'>([^<>]+)<')
ATTR = re.compile(r'(\s(?:alt|aria-label|title|placeholder)\s*=\s*)(["\'])(.*?)\2', re.I)
HREF = re.compile(r'(\shref\s*=\s*)(["\'])([^"\'#?]+\.html)(["\'#?])', re.I)
LETTER = re.compile(r'[^\W\d_]')
BLOCKS = 'p|h[1-6]|li|summary|dt|dd|td|th|figcaption|label|button|blockquote'
BLOCK_OPEN = re.compile(rf'<({BLOCKS})\b[^>]*>', re.I)
INLINE = {'a', 'abbr', 'b', 'bdi', 'br', 'cite', 'code', 'del', 'dfn', 'em', 'i', 'ins', 'kbd', 'mark', 'q',
          's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr'}
VOID = {'br', 'wbr'}
TAG = re.compile(r'<(/?)([a-zA-Z][\w-]*)\b[^>]*?>')
PLACEHOLDER = re.compile(r'\{(/?)(\d+)(/?)\}')


def protected_spans(doc):
    return [m.span() for m in PROTECTED.finditer(doc)]


def inside(pos, spans):
    return any(a <= pos < b for a, b in spans)


def variant_name(page, lang, master):
    return page if lang == master else re.sub(r'\.html$', f'-{lang}.html', page)


def _block_key(inner):
    """(key, tags) for block content with inline markup, or None when it has none or holds a non-inline tag.
    tags: {n: (open_tag, close_tag or None)}."""
    parts, tags, stack, n = [], {}, [], 0
    pos = 0
    for m in TAG.finditer(inner):
        parts.append(html.unescape(inner[pos:m.start()]))
        pos = m.end()
        closing, name = m.group(1), m.group(2).lower()
        if name not in INLINE:
            return None
        if name in VOID or m.group(0).endswith('/>'):
            tags[n] = (m.group(0), None)
            parts.append(f'{{{n}/}}')
            n += 1
        elif not closing:
            tags[n] = (m.group(0), None)
            stack.append((name, n))
            parts.append(f'{{{n}}}')
            n += 1
        else:
            if not stack or stack[-1][0] != name:
                return None   # unbalanced markup: leave it to fragment mode
            _, k = stack.pop()
            tags[k] = (tags[k][0], m.group(0))
            parts.append(f'{{/{k}}}')
    if not tags or stack:
        return None
    parts.append(html.unescape(inner[pos:]))
    return ' '.join(''.join(parts).split()), tags


def _placeholders(text):
    return sorted(m.group(0) for m in PLACEHOLDER.finditer(text))


def _rebuild(translation, tags, attr):
    """Translated key -> HTML: placeholders become the original tags, text is escaped."""
    out, pos = [], 0
    for m in PLACEHOLDER.finditer(translation):
        out.append(html.escape(translation[pos:m.start()], quote=False))
        pos = m.end()
        k = int(m.group(2))
        open_tag, close_tag = tags[k]
        out.append(close_tag if m.group(1) else attr(open_tag))
    out.append(html.escape(translation[pos:], quote=False))
    return ''.join(out)


def translate(doc, lang, strings, keep, page_langs=None, master=None, page='index.html', warnings=None):
    """Returns (translated_html, untranslated_list). page_langs: {page: [langs]} of the whole build; when
    given, internal links are localised too (see localise_links)."""
    spans = protected_spans(doc)
    edits, missing, done = [], [], []

    def lookup(text):
        key = text.strip()
        if not key or not LETTER.search(key) or key in keep:
            return None
        if key in strings:
            return text.replace(key, strings[key], 1)
        missing.append(key)
        return None

    def attr(tag):
        def one(m):
            new = lookup(html.unescape(m.group(3)))
            return m.group(0) if new is None else m.group(1) + m.group(2) + html.escape(new, quote=True) + m.group(2)
        return ATTR.sub(one, tag)

    # 1. block mode
    for m in BLOCK_OPEN.finditer(doc):
        if inside(m.start(), spans):
            continue
        close = re.compile(rf'</{m.group(1)}\s*>', re.I).search(doc, m.end())
        if not close:
            continue
        a, b = m.end(), close.start()
        found = _block_key(doc[a:b])
        if not found:
            continue
        key, tags = found
        if key in keep or key not in strings:
            continue
        if _placeholders(strings[key]) != _placeholders(key):
            missing.append(f'{key} (placeholders differ in the translation: {" ".join(m.group(0) for m in PLACEHOLDER.finditer(key))})')
            done.append((a, b))
            continue
        lead = re.match(r'\s*', doc[a:b]).group(0)
        trail = re.search(r'\s*$', doc[a:b]).group(0)
        edits.append((a, b, lead + _rebuild(strings[key], tags, attr) + trail))
        done.append((a, b))
    # 2. fragment mode for everything outside translated blocks
    skip = spans + done
    for m in TEXT.finditer(doc):
        if inside(m.start(1), skip):
            continue
        new = lookup(html.unescape(m.group(1)))
        if new is not None:
            edits.append((m.start(1), m.end(1), html.escape(new, quote=False)))
    for m in ATTR.finditer(doc):
        if inside(m.start(), skip):
            continue
        new = lookup(html.unescape(m.group(3)))
        if new is not None:
            edits.append((m.start(3), m.end(3), html.escape(new, quote=True)))
    out = doc
    for a, b, text in sorted(edits, reverse=True):   # last to first, so offsets stay valid
        out = out[:a] + text + out[b:]
    out = re.sub(r'(<html\b[^>]*\blang=)(["\'])[^"\']*\2', rf'\g<1>"{lang}"', out, count=1, flags=re.I)
    if page_langs:
        out = localise_links(out, page, lang, page_langs, master, warnings)
    return out, sorted(set(missing))


def resolve_link(href, page):
    """Site-relative path of an internal .html link on `page`, or None when it leaves the site root."""
    if href.startswith('/'):
        path = posixpath.normpath(href.lstrip('/'))
    else:
        path = posixpath.normpath(posixpath.join(posixpath.dirname(page), href))
    return None if path.startswith('..') else path


def localise_links(doc, page, lang, page_langs, master, warnings=None):
    """Points internal links at this language's version of the target page. Bare, root-relative (/a.html),
    ./ and ../ links are resolved against `page`; the link keeps its own style, only the file name changes.
    Appends a warning for each internal link that cannot be localised."""
    spans = protected_spans(doc)
    warn = warnings if warnings is not None else []
    me = variant_name(page, lang, master)
    edits = []
    for m in HREF.finditer(doc):
        href = m.group(3)
        if inside(m.start(), spans) or re.match(r'^[a-z][a-z0-9+.-]*:', href, re.I) or href.startswith('//'):
            continue   # external, mailto:, protocol-relative
        target = resolve_link(href, page)
        if target is None:
            warn.append(f'{me}: link "{href}" leaves the site root')
        elif target not in page_langs:
            warn.append(f'{me}: link "{href}" points to {target}, which is not a page of this build')
        elif lang not in page_langs[target]:
            if lang != master:
                warn.append(f'{me}: link "{href}" has no {lang} version, it stays on the {master} page')
        elif lang != master:
            edits.append((m.start(3), m.end(3), re.sub(r'\.html$', f'-{lang}.html', href)))
    for a, b, text in sorted(edits, reverse=True):
        doc = doc[:a] + text + doc[b:]
    return doc


def leftovers(doc, pattern, strings=None, keep=()):
    """Master-language-looking words left in visible text or translatable attributes of a built variant.
    In inline scripts, a string literal counts when it has a space and matches `pattern`, or when it is
    copy from the dictionary (single words included, e.g. 'Search')."""
    rx = re.compile(pattern, re.I)
    copy = {k for k in (strings or {}) if k not in keep and LETTER.search(k)}
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
            if (' ' in lit and rx.search(lit)) or lit.strip() in copy:
                found.append(lit)
    return found


# After one of these tokens a `/` starts a regex literal; after anything else it is a division.
_REGEX_AFTER_WORDS = {'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case',
                      'do', 'else', 'yield', 'await'}


def string_literals(js):
    """Text of every string literal and template-string chunk in a script, left to right.

    A small tokenizer, not a parser: it skips // and /* */ comments, tells a regex literal from a division by
    the previous significant token, reads regex literals (character classes included) without mistaking a
    quote inside them for a string, and walks template strings including nested ${ ... } expressions."""
    out = []
    _scan(js, 0, out, stop_at_brace=False)
    return out


def _scan(js, i, out, stop_at_brace):
    n, prev, depth = len(js), '', 0   # prev: last significant token ('' = start, so a / starts a regex)
    while i < n:
        c = js[i]
        if js.startswith('//', i):
            j = js.find('\n', i)
            i = n if j < 0 else j
        elif js.startswith('/*', i):
            j = js.find('*/', i + 2)
            i = n if j < 0 else j + 2
        elif c.isspace():
            i += 1
        elif c in '"\'':
            j, buf = i + 1, []
            while j < n and js[j] != c and js[j] != '\n':
                if js[j] == '\\' and j + 1 < n:
                    j += 1
                buf.append(js[j])
                j += 1
            out.append(''.join(buf))
            i, prev = j + 1, 'str'
        elif c == '`':
            i, prev = _template(js, i + 1, out), 'str'
        elif c == '/':
            if prev == '' or prev in _REGEX_AFTER_WORDS or (len(prev) == 1 and prev in '(,=:[!&|?{};+-*%<>~^'):
                j, in_class = i + 1, False
                while j < n and js[j] != '\n':
                    if js[j] == '\\':
                        j += 2
                        continue
                    if js[j] == '[':
                        in_class = True
                    elif js[j] == ']':
                        in_class = False
                    elif js[j] == '/' and not in_class:
                        break
                    j += 1
                j += 1
                while j < n and (js[j].isalnum() or js[j] == '_'):
                    j += 1   # flags
                i, prev = j, 'regex'
            else:
                i, prev = i + 1, '/'
        elif c.isalnum() or c in '_$':
            j = i
            while j < n and (js[j].isalnum() or js[j] in '_$'):
                j += 1
            prev, i = js[i:j], j
        else:
            if c == '{':
                depth += 1
            elif c == '}':
                if stop_at_brace and depth == 0:
                    return i + 1
                depth -= 1
            prev = 'x' if c in ')]' else c   # after ) or ] a / is a division
            i += 1
    return i


def _template(js, i, out):
    """Reads a template string body starting after the opening backtick; returns the index after the closing one."""
    n, buf = len(js), []
    while i < n and js[i] != '`':
        if js[i] == '\\' and i + 1 < n:
            buf.append(js[i + 1])
            i += 2
        elif js.startswith('${', i):
            out.append(''.join(buf))
            buf = []
            i = _scan(js, i + 2, out, stop_at_brace=True)
        else:
            buf.append(js[i])
            i += 1
    out.append(''.join(buf))
    return i + 1


def lang_switch(doc, page, lang, page_langs, labels, master):
    """Fills <!--langs:start--><!--langs:end--> with real links to this page's other languages."""
    links = ''.join(
        f'<a class="lang" href="{variant_name(page, other, master)}" hreflang="{other}" lang="{other}">{labels[other]}</a>'
        for other in page_langs.get(page, []) if other != lang)
    return re.sub(r'<!--langs:start-->.*?<!--langs:end-->', lambda _: f'<!--langs:start-->{links}<!--langs:end-->',
                  doc, flags=re.S)

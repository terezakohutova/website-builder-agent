"""SEO post-processor and sitemap.

`apply()` writes title, meta description, canonical, hreflang alternates (+ x-default) and one JSON-LD @graph
between <!--seo:start--> and <!--seo:end--> in <head> (plus robots noindex for a variant listed in the page's
`noindex` in site.json), and removes stray copies of those tags elsewhere in <head>. Running it twice gives
the same file (idempotent). It is the last writer of the pages: any builder that ran after it would put the
master <head> back. JSON-LD is ASCII-escaped, so no later text pass can mistake it for copy. The brand name
(the WebSite name) comes from `brand` in site.json.

hreflang alternates list only indexable variants: a noindex variant is never announced as an alternate
(search engines ignore alternates that are not indexable and report them as errors), and a noindex page
announces none.

`sitemap()` writes sitemap.xml from the FINISHED pages. <lastmod> moves only when a page's content hash
changes; the previous hashes and dates live in `<src>/lastmod.json`, which is meant to be committed: in a
gitignored folder a clean CI checkout loses the history and stamps every page with today's date.
"""
import hashlib
import html
import json
import os
import re

START, END = '<!--seo:start-->', '<!--seo:end-->'
STRAY = re.compile(r'\s*(?:<title\b.*?</title\s*>|<meta\s+name=["\']description["\'][^>]*>|'
                   r'<link\s+rel=["\'](?:canonical|alternate)["\'][^>]*>|'
                   r'<script\s+type=["\']application/ld\+json["\'][^>]*>.*?</script\s*>)', re.S | re.I)


def url_for(base, file):
    return base.rstrip('/') + '/' + ('' if file == 'index.html' else file)


def configured_noindex(cfg, page, lang):
    return lang in cfg['pages'][page].get('noindex', [])


def block(cfg, page, lang, files, indexable=None, robots=False):
    """files: {lang: output file name} of this page; indexable: the langs that may be alternates (None = all)."""
    base, seo = cfg['base_url'], cfg['pages'][page]['seo'][lang]
    e = lambda s: html.escape(s, quote=True)
    here = url_for(base, files[lang])
    alts = {l: f for l, f in files.items() if indexable is None or l in indexable}
    if lang not in alts:
        alts = {}   # a noindex page announces no alternates
    lines = [f'<title>{e(seo["title"])}</title>',
             f'<meta name="description" content="{e(seo["description"])}">',
             f'<link rel="canonical" href="{e(here)}">']
    if robots:
        lines.append('<meta name="robots" content="noindex">')
    if len(alts) > 1:
        for l, f in alts.items():
            lines.append(f'<link rel="alternate" hreflang="{l}" href="{e(url_for(base, f))}">')
        xd = next((x for x in (cfg['x_default'], cfg['master']) if x in alts), next(iter(alts)))
        lines.append(f'<link rel="alternate" hreflang="x-default" href="{e(url_for(base, alts[xd]))}">')
    graph = {'@context': 'https://schema.org', '@graph': [
        {'@type': 'WebSite', '@id': base.rstrip('/') + '/#website', 'url': url_for(base, 'index.html'), 'name': cfg['brand']},
        {'@type': 'WebPage', '@id': here + '#webpage', 'url': here, 'name': seo['title'],
         'description': seo['description'], 'inLanguage': lang, 'isPartOf': {'@id': base.rstrip('/') + '/#website'}},
    ]}
    ld = json.dumps(graph, ensure_ascii=True, separators=(',', ':')).replace('</', '<\\/')
    lines.append(f'<script type="application/ld+json">{ld}</script>')
    return START + '\n' + '\n'.join(lines) + '\n' + END


def apply(doc, cfg, page, lang, files, indexable=None):
    head_end = doc.lower().find('</head>')
    if head_end < 0:
        raise ValueError(f'{page}: no </head>')
    head, rest = doc[:head_end], doc[head_end:]
    if START in head and END in head:
        a, b = head.index(START), head.index(END) + len(END)
        before, after = head[:a], head[b:]
    else:   # first run on a page without markers: put the block at the end of <head>
        before, after = head.rstrip() + '\n', '\n'
    before, after = STRAY.sub('', before), STRAY.sub('', after)
    robots = configured_noindex(cfg, page, lang) and not noindex(before + after)
    return before + block(cfg, page, lang, files, indexable, robots) + after + rest


def noindex(doc):
    return re.search(r'<meta\s+name=["\']robots["\'][^>]*noindex', doc, re.I) is not None


def sitemap(out_dir, cfg, built, state_path, today):
    """built: {(page, lang): output file name}. Returns the sitemap path."""
    try:
        with open(state_path, encoding='utf-8') as f:
            state = json.load(f)
    except (OSError, ValueError):
        state = {}
    base, rows, raws = cfg['base_url'], [], {}
    for key, file in built.items():
        with open(os.path.join(out_dir, file), 'rb') as f:
            raws[key] = f.read()
    indexable = {k for k, raw in raws.items() if not noindex(raw.decode('utf-8'))}
    for (page, lang), file in sorted(built.items(), key=lambda kv: kv[1]):
        raw = raws[(page, lang)]
        if (page, lang) not in indexable:
            continue
        sha = hashlib.sha256(raw).hexdigest()
        prev = state.get(file)
        lastmod = prev['lastmod'] if prev and prev['sha'] == sha else today
        state[file] = {'sha': sha, 'lastmod': lastmod}
        page_alts = [(l, f) for (p, l), f in sorted(built.items()) if p == page and (p, l) in indexable]
        alts = ''.join(f'\n    <xhtml:link rel="alternate" hreflang="{l}" href="{url_for(base, f)}"/>'
                       for l, f in page_alts) if len(page_alts) > 1 else ''
        rows.append(f'  <url>\n    <loc>{url_for(base, file)}</loc>\n    <lastmod>{lastmod}</lastmod>{alts}\n  </url>')
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
           + '\n'.join(rows) + '\n</urlset>\n')
    path = os.path.join(out_dir, 'sitemap.xml')
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(xml)
    os.makedirs(os.path.dirname(state_path), exist_ok=True)
    with open(state_path, 'w', encoding='utf-8') as f:
        json.dump(state, f, indent=1, sort_keys=True)
    return path

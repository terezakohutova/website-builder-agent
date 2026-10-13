"""Reference build chain: master pages -> multi-language `_dist`, in the order the references prescribe.

    python examples/build-chain/build.py [--src DIR] [--out DIR] [--date YYYY-MM-DD]

Defaults: --src examples/sample-site, --out <src>/_dist, --date today (UTC). Python stdlib only.

Steps (one lock around all of them; the source folder is only read, everything is written to --out):
  0. config    site.json is checked first: missing file, invalid JSON or a missing key exits 2 and names it
  1. lock      build lock with owner check (buildlock.py); a second build exits 3 and says who holds it
  2. inject    runtime typography: one idempotent <!--typo:start-->...<!--typo:end--> block per page, with
               the brand name from site.json as data-brand (typo.js keeps it on one line)
  3. i18n      language versions by exact text match against i18n/strings-<lang>.json (i18n.py), whole
               blocks with inline markup first, text fragments as the fallback; untranslated master copy
               fails the build; internal links are localised, the ones that cannot be are warned about
  4. langs     language switcher links between <!--langs:start--> and <!--langs:end-->
  5. seo       title / description / canonical / hreflang / JSON-LD between seo markers (seo.py) - last writer
  6. check     leftover check: master-language words in a built variant fail the build
  7. write     pages + assets into --out (wiped first, only if it is a previous build output)
  8. sitemap   sitemap.xml from the finished pages, <lastmod> moves only when a page's content changes;
               the history lives in <src>/lastmod.json (commit it, so CI does not stamp every page today)

Exit codes: 0 built, 1 build checks failed (nothing written), 2 bad usage or bad config, 3 could not run
(lock held, I/O).
The real chain has more steps (feedback passes, optimiser, consent, deploy); see references/01 section 4.
"""
import argparse
import datetime as dt
import html
import json
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import i18n  # noqa: E402
import seo  # noqa: E402
from buildlock import BuildLock, LockHeld  # noqa: E402

MARK = '.build-output'   # marker file: --out is only ever wiped when it holds this


def inject_typo(doc, brand=''):
    attr = f' data-brand="{html.escape(brand, quote=True)}"' if brand else ''
    blk = f'<!--typo:start--><script src="assets/typo.js"{attr} defer></script><!--typo:end-->'
    doc = re.sub(r'<!--typo:start-->.*?<!--typo:end-->\n?', '', doc, flags=re.S)
    return re.sub(r'</head>', blk + '\n</head>', doc, count=1, flags=re.I)


def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


class ConfigError(Exception):
    pass


def load_config(path):
    """site.json, checked up front: a missing key fails here with its name, not later as a KeyError."""
    try:
        cfg = load_json(path)
    except OSError as e:
        raise ConfigError(f'cannot read config {path}: {e.strerror or e}')
    except ValueError as e:
        raise ConfigError(f'config {path} is not valid JSON: {e}')
    if not isinstance(cfg, dict):
        raise ConfigError(f'config {path} must be a JSON object')
    missing = [k for k in ('base_url', 'brand', 'master', 'x_default', 'languages', 'pages', 'leftover_pattern')
               if k not in cfg]
    for page, spec in (cfg.get('pages') or {}).items():
        if not isinstance(spec, dict) or 'languages' not in spec:
            missing.append(f'pages.{page}.languages')
            continue
        for lang in spec['languages']:
            for field in ('title', 'description'):
                if field not in spec.get('seo', {}).get(lang, {}):
                    missing.append(f'pages.{page}.seo.{lang}' if lang not in spec.get('seo', {})
                                   else f'pages.{page}.seo.{lang}.{field}')
            if lang not in cfg.get('languages', {}):
                missing.append(f'languages.{lang}')
    if 'master' in cfg and cfg['master'] not in cfg.get('leftover_pattern', {}):
        missing.append(f'leftover_pattern.{cfg["master"]}')
    if missing:
        raise ConfigError(f'config {path} is missing: ' + ', '.join(dict.fromkeys(missing)))
    return cfg


def render(src, cfg):
    """All pages in memory. Returns (pages {(page, lang): (file, html)}, problems [str], warnings [str])."""
    master, problems, warnings, pages = cfg['master'], [], [], {}
    page_langs = {p: v['languages'] for p, v in cfg['pages'].items()}
    keep = set(cfg.get('keep', []))
    for page, spec in cfg['pages'].items():
        with open(os.path.join(src, page), encoding='utf-8') as f:
            doc = inject_typo(f.read(), cfg['brand'])
        files = {l: i18n.variant_name(page, l, master) for l in spec['languages']}
        variants = {}
        for lang in spec['languages']:
            if lang == master:
                out = i18n.localise_links(doc, page, lang, page_langs, master, warnings)
            else:
                strings = load_json(os.path.join(HERE, 'i18n', f'strings-{lang}.json'))
                out, missing = i18n.translate(doc, lang, strings, keep, page_langs, master, page, warnings)
                problems += [f'{files[lang]}: untranslated: "{m}"' for m in missing]
                problems += [f'{files[lang]}: leftover master-language copy: "{x[:80]}"'
                             for x in i18n.leftovers(out, cfg['leftover_pattern'][master], strings, keep)]
            variants[lang] = i18n.lang_switch(out, page, lang, page_langs, cfg['languages'], master)
        # hreflang alternates: only variants that are indexable (no robots noindex, not listed in `noindex`)
        indexable = {l for l, d in variants.items() if not seo.noindex(d) and not seo.configured_noindex(cfg, page, l)}
        for lang, out in variants.items():
            pages[(page, lang)] = (files[lang], seo.apply(out, cfg, page, lang, files, indexable))
    return pages, problems, warnings


def write(src, out, pages):
    if os.path.exists(out):
        if os.listdir(out) and not os.path.exists(os.path.join(out, MARK)):
            raise OSError(f'{out} exists and is not a previous build output (no {MARK}); refusing to wipe it')
        shutil.rmtree(out)
    os.makedirs(out)
    open(os.path.join(out, MARK), 'w').close()
    if os.path.isdir(os.path.join(src, 'assets')):
        shutil.copytree(os.path.join(src, 'assets'), os.path.join(out, 'assets'))
    os.makedirs(os.path.join(out, 'assets'), exist_ok=True)
    shutil.copy2(os.path.join(HERE, 'assets', 'typo.js'), os.path.join(out, 'assets', 'typo.js'))
    for file, doc in pages.values():
        with open(os.path.join(out, file), 'w', encoding='utf-8', newline='\n') as f:
            f.write(doc)


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):   # copy with umlauts and no-break spaces on a cp1252 console
        try:
            stream.reconfigure(encoding='utf-8')
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(description='Reference build chain (see the module docstring).')
    ap.add_argument('--src', default=os.path.join(HERE, '..', 'sample-site'))
    ap.add_argument('--out')
    ap.add_argument('--config', default=os.path.join(HERE, 'site.json'))
    ap.add_argument('--date', default=os.environ.get('BUILD_DATE') or dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d'))
    ap.add_argument('--stale-minutes', type=float, default=45)
    try:
        a = ap.parse_args(argv)
    except SystemExit as e:
        return 0 if e.code == 0 else 2
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', a.date):
        print('usage: --date must be YYYY-MM-DD', file=sys.stderr)
        return 2
    src = os.path.abspath(a.src)
    out = os.path.abspath(a.out or os.path.join(src, '_dist'))
    if not os.path.isdir(src):
        print(f'usage: --src {src} is not a folder', file=sys.stderr)
        return 2
    try:
        cfg = load_config(a.config)
    except ConfigError as e:
        print(f'usage: {e}', file=sys.stderr)
        return 2
    state_dir = os.path.join(src, '.build')   # the lock only; gitignored
    lastmod = os.path.join(src, 'lastmod.json')   # committed: the dates must survive a clean CI checkout
    if not os.path.exists(lastmod) and os.path.exists(os.path.join(state_dir, 'lastmod.json')):
        shutil.copy2(os.path.join(state_dir, 'lastmod.json'), lastmod)   # history from an older version of this chain
    try:
        with BuildLock(os.path.join(state_dir, 'lock'), stale_minutes=a.stale_minutes):
            pages, problems, warnings = render(src, cfg)
            for w in dict.fromkeys(warnings):
                print('WARN ' + w, file=sys.stderr)
            for p in problems:
                print('FAIL ' + p)
            if problems:
                print(f'\n{len(problems)} problems, nothing written')
                return 1
            write(src, out, pages)
            sm = seo.sitemap(out, cfg, {k: v[0] for k, v in pages.items()}, lastmod, a.date)
            for (page, lang), (file, _) in sorted(pages.items(), key=lambda kv: kv[1][0]):
                print(f'built {file} ({lang})')
            print(f'wrote {os.path.relpath(sm, out)}; {len(pages)} pages -> {out}')
            return 0
    except LockHeld as e:
        print(str(e), file=sys.stderr)
        return 3
    except OSError as e:
        print(f'could not run: {e}', file=sys.stderr)
        return 3


if __name__ == '__main__':
    sys.exit(main())

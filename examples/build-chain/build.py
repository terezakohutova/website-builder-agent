"""Reference build chain: master pages -> multi-language `_dist`, in the order the references prescribe.

    python examples/build-chain/build.py [--src DIR] [--out DIR] [--date YYYY-MM-DD]

Defaults: --src examples/sample-site, --out <src>/_dist, --date today (UTC). Python stdlib only.

Steps (one lock around all of them; the source folder is only read, everything is written to --out):
  1. lock      build lock with owner check (buildlock.py); a second build exits 3 and says who holds it
  2. inject    runtime typography: one idempotent <!--typo:start-->...<!--typo:end--> block per page
  3. i18n      language versions by exact text match against i18n/strings-<lang>.json (i18n.py);
               untranslated master copy fails the build
  4. langs     language switcher links between <!--langs:start--> and <!--langs:end-->
  5. seo       title / description / canonical / hreflang / JSON-LD between seo markers (seo.py) - last writer
  6. check     leftover check: master-language words in a built variant fail the build
  7. write     pages + assets into --out (wiped first, only if it is a previous build output)
  8. sitemap   sitemap.xml from the finished pages, <lastmod> moves only when a page's content changes

Exit codes: 0 built, 1 build checks failed (nothing written), 2 bad usage, 3 could not run (lock held, I/O).
The real chain has more steps (feedback passes, optimiser, consent, deploy); see references/01 section 4.
"""
import argparse
import datetime as dt
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


def inject_typo(doc):
    blk = '<!--typo:start--><script src="assets/typo.js" defer></script><!--typo:end-->'
    doc = re.sub(r'<!--typo:start-->.*?<!--typo:end-->\n?', '', doc, flags=re.S)
    return re.sub(r'</head>', blk + '\n</head>', doc, count=1, flags=re.I)


def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def render(src, cfg):
    """All pages in memory. Returns (pages {(page, lang): (file, html)}, problems [str])."""
    master, problems, pages = cfg['master'], [], {}
    page_langs = {p: v['languages'] for p, v in cfg['pages'].items()}
    keep = set(cfg.get('keep', []))
    for page, spec in cfg['pages'].items():
        with open(os.path.join(src, page), encoding='utf-8') as f:
            doc = inject_typo(f.read())
        files = {l: i18n.variant_name(page, l, master) for l in spec['languages']}
        for lang in spec['languages']:
            out = doc
            if lang != master:
                strings = load_json(os.path.join(HERE, 'i18n', f'strings-{lang}.json'))
                out, missing = i18n.translate(doc, lang, strings, keep, page_langs, master)
                problems += [f'{files[lang]}: untranslated: "{m}"' for m in missing]
                problems += [f'{files[lang]}: leftover master-language copy: "{x[:80]}"'
                             for x in i18n.leftovers(out, cfg['leftover_pattern'][master])]
            out = i18n.lang_switch(out, page, lang, page_langs, cfg['languages'], master)
            out = seo.apply(out, cfg, page, lang, files)
            pages[(page, lang)] = (files[lang], out)
    return pages, problems


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
    ap =argparse.ArgumentParser(description='Reference build chain (see the module docstring).')
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
    cfg = load_json(a.config)
    state_dir = os.path.join(src, '.build')
    try:
        with BuildLock(os.path.join(state_dir, 'lock'), stale_minutes=a.stale_minutes):
            pages, problems = render(src, cfg)
            for p in problems:
                print('FAIL ' + p)
            if problems:
                print(f'\n{len(problems)} problems, nothing written')
                return 1
            write(src, out, pages)
            sm = seo.sitemap(out, cfg, {k: v[0] for k, v in pages.items()}, os.path.join(state_dir, 'lastmod.json'), a.date)
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

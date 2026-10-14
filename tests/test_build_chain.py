"""Tests for the reference build chain in examples/build-chain/ (i18n, typography, SEO, sitemap, lock).

    python -m unittest discover -s tests -v
Builds run as subprocesses on a copy of examples/sample-site, so the repository is never written to.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
CHAIN = os.path.join(ROOT, 'examples', 'build-chain')
SAMPLE = os.path.join(ROOT, 'examples', 'sample-site')
sys.path.insert(0, CHAIN)
import buildlock  # noqa: E402
import i18n  # noqa: E402
import seo  # noqa: E402


def rmtree_retry(path):
    """shutil.rmtree that waits out Windows: an antivirus or indexer briefly holding a just-written file makes
    rmtree fail with PermissionError or 'directory not empty', which showed up as rare test errors."""
    for attempt in range(6):
        try:
            shutil.rmtree(path)
            return
        except FileNotFoundError:
            return
        except OSError:
            if attempt == 5:
                raise
            time.sleep(0.1 * 2 ** attempt)


def tree_hash(d):
    h = hashlib.sha256()
    for base, dirs, files in sorted(os.walk(d)):
        dirs.sort()
        for f in sorted(files):
            p = os.path.join(base, f)
            h.update(os.path.relpath(p, d).encode())
            with open(p, 'rb') as fh:
                h.update(fh.read())
    return h.hexdigest()


class BuildChainTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.src = os.path.join(self.tmp.name, 'site')
        shutil.copytree(SAMPLE, self.src, ignore=shutil.ignore_patterns('_dist', '.build', 'lastmod.json'))
        self.out = os.path.join(self.src, '_dist')

    def tearDown(self):
        rmtree_retry(self.tmp.name)
        self.tmp.cleanup()

    def build(self, *extra, date='2026-10-01'):
        return subprocess.run([sys.executable, '-I', os.path.join(CHAIN, 'build.py'), '--src', self.src, '--date', date, *extra],
                              capture_output=True, text=True, encoding='utf-8')

    def read(self, name):
        with open(os.path.join(self.out, name), encoding='utf-8') as f:
            return f.read()

    def edit_src(self, name, old, new):
        p = os.path.join(self.src, name)
        with open(p, encoding='utf-8') as f:
            text = f.read()
        self.assertIn(old, text)
        with open(p, 'w', encoding='utf-8', newline='\n') as f:
            f.write(text.replace(old, new, 1))

    # --- the happy path ---------------------------------------------------------------------------
    def test_builds_the_language_versions(self):
        before = tree_hash(self.src)
        r = self.build()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(sorted(f for f in os.listdir(self.out) if f.endswith(('.html', '.xml'))),
                         ['index-de.html', 'index.html', 'privacy.html', 'sitemap.xml'])
        de = self.read('index-de.html')
        self.assertIn('<html lang="de">', de)
        self.assertIn('<h1 class="xl">Notizen, die Sie wiederfinden.</h1>', de)
        self.assertIn('aria-label="Abschnitte"', de)
        self.assertIn('<a class="brand" href="index-de.html">', de, 'links to pages that exist in DE are localised')
        self.assertIn('<a href="privacy.html">Datenschutz</a>', de, 'privacy has no DE version, so the link stays')
        self.assertIn('<!--langs:start--><a class="lang" href="index.html" hreflang="en" lang="en">EN</a><!--langs:end-->', de)
        self.assertIn('<!--langs:start--><a class="lang" href="index-de.html" hreflang="de" lang="de">DE</a><!--langs:end-->', self.read('index.html'))
        self.assertTrue(os.path.isfile(os.path.join(self.out, 'assets', 'typo.js')))
        self.assertTrue(os.path.isfile(os.path.join(self.out, 'assets', 'site.css')))
        # the source pages are only read (the build writes lastmod.json, the .build/ lock folder and _dist/, nothing else)
        rmtree_retry(self.out)
        rmtree_retry(os.path.join(self.src, '.build'))
        os.remove(os.path.join(self.src, 'lastmod.json'))
        self.assertEqual(tree_hash(self.src), before)

    def test_seo_block_hreflang_and_json_ld(self):
        self.build()
        de = self.read('index-de.html')
        self.assertEqual(de.count('<!--seo:start-->'), 1)
        self.assertEqual(len(re.findall(r'<title>', de)), 1)
        self.assertIn('<link rel="canonical" href="https://lumen-notes.example/index-de.html">', de)
        self.assertIn('<link rel="alternate" hreflang="x-default" href="https://lumen-notes.example/">', de)
        ld = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', de).group(1))
        page = [n for n in ld['@graph'] if n['@type'] == 'WebPage'][0]
        self.assertEqual(page['inLanguage'], 'de')
        privacy = self.read('privacy.html')
        self.assertNotIn('hreflang', privacy.split('</head>')[0], 'a one-language page gets no alternates')

    def test_seo_is_idempotent_and_removes_strays(self):
        with open(os.path.join(CHAIN, 'site.json'), encoding='utf-8') as f:
            cfg = json.load(f)
        doc = ('<html><head><title>old</title><meta name="description" content="old">'
               '<link rel="canonical" href="x"><!--seo:start--><!--seo:end--></head><body></body></html>')
        files = {'en': 'index.html', 'de': 'index-de.html'}
        once = seo.apply(doc, cfg, 'index.html', 'en', files)
        self.assertEqual(seo.apply(once, cfg, 'index.html', 'en', files), once)
        self.assertNotIn('old', once)
        no_markers = seo.apply('<html><head><title>x</title></head><body></body></html>', cfg, 'index.html', 'en', files)
        self.assertEqual(no_markers.count('<title>'), 1)
        self.assertEqual(seo.apply(no_markers, cfg, 'index.html', 'en', files), no_markers)

    def test_two_builds_give_identical_output(self):
        self.build()
        first = tree_hash(self.out)
        r = self.build()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(tree_hash(self.out), first)

    def test_typography_block_is_injected_once(self):
        self.build()
        for name in ('index.html', 'index-de.html', 'privacy.html'):
            self.assertEqual(self.read(name).count('<!--typo:start-->'), 1, name)
        import build  # noqa: E402  (in CHAIN, on sys.path)
        once = build.inject_typo('<html><head></head></html>')
        self.assertEqual(build.inject_typo(once), once)

    def test_sitemap_lastmod_moves_only_when_a_page_changes(self):
        self.build(date='2026-10-01')
        self.build(date='2026-10-05')
        sm = self.read('sitemap.xml')
        self.assertEqual(sm.count('<lastmod>2026-10-01</lastmod>'), 2, sm)
        self.assertNotIn('privacy.html', sm, 'noindex pages stay out of the sitemap')
        self.edit_src('index.html', 'Notes that find you again.', 'Notes that find you again.<!-- edited -->')
        self.build(date='2026-10-09')
        sm = self.read('sitemap.xml')
        self.assertIn('<loc>https://lumen-notes.example/</loc>\n    <lastmod>2026-10-09</lastmod>', sm)
        self.assertIn('<loc>https://lumen-notes.example/index-de.html</loc>\n    <lastmod>2026-10-09</lastmod>', sm)

    # --- failures ------------------------------------------------------------------------------------
    def test_untranslated_copy_fails_and_writes_nothing(self):
        self.edit_src('index.html', '<h2 class="lg">FAQ</h2>', '<h2 class="lg">FAQ</h2><p>A brand new paragraph.</p>')
        r = self.build()
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn('index-de.html: untranslated: "A brand new paragraph."', r.stdout)
        self.assertFalse(os.path.exists(self.out))

    def test_hand_inserted_nbsp_breaks_the_match_and_fails(self):
        self.edit_src('index.html', 'Install the app.', 'Install the&nbsp;app.')
        r = self.build()
        self.assertEqual(r.returncode, 1)
        self.assertIn('untranslated: "Install the app."', r.stdout)

    def test_master_copy_in_an_inline_script_is_a_leftover(self):
        self.edit_src('index.html', "  let n = 0;", "  const msg = 'Your note is saved';\n  let n = 0;")
        r = self.build()
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn('index-de.html: leftover master-language copy: "Your note is saved"', r.stdout)

    def test_bad_usage_exits_2(self):
        r = self.build(date='yesterday')
        self.assertEqual(r.returncode, 2)
        r = subprocess.run([sys.executable, '-I', os.path.join(CHAIN, 'build.py'), '--src', os.path.join(self.tmp.name, 'nope')],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 2)

    def test_refuses_to_wipe_a_folder_it_did_not_build(self):
        os.makedirs(self.out)
        with open(os.path.join(self.out, 'precious.txt'), 'w') as f:
            f.write('keep me')
        r = self.build()
        self.assertEqual(r.returncode, 3)
        self.assertIn('refusing to wipe', r.stderr)
        self.assertTrue(os.path.isfile(os.path.join(self.out, 'precious.txt')))

    # --- lock --------------------------------------------------------------------------------------------
    def lock_path(self):
        return os.path.join(self.src, '.build', 'lock')

    def plant_lock(self, pid, started):
        os.makedirs(self.lock_path())
        with open(os.path.join(self.lock_path(), 'info.json'), 'w') as f:
            json.dump({'pid': pid, 'host': __import__('socket').gethostname(), 'started': started}, f)

    def test_a_held_lock_stops_the_second_build(self):
        self.plant_lock(os.getpid(), time.time())
        r = self.build()
        self.assertEqual(r.returncode, 3)
        self.assertIn(f'ANOTHER BUILD IS RUNNING (pid {os.getpid()}', r.stderr)
        self.assertTrue(os.path.isdir(self.lock_path()), 'the other build keeps its lock')

    def test_an_old_lock_of_a_live_process_is_not_taken_over(self):
        self.plant_lock(os.getpid(), time.time() - 7200)
        self.assertEqual(self.build().returncode, 3)

    def test_a_stale_lock_of_a_dead_process_is_taken_over(self):
        p = subprocess.Popen([sys.executable, '-c', 'pass'])
        p.wait()
        self.plant_lock(p.pid, time.time() - 7200)
        r = self.build()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('taking over a stale lock', r.stderr)
        self.assertFalse(os.path.exists(self.lock_path()), 'released after the build')

    def test_a_fresh_lock_of_a_dead_process_is_taken_over_at_once(self):
        p = subprocess.Popen([sys.executable, '-c', 'pass'])
        p.wait()
        self.plant_lock(p.pid, time.time())   # the owner crashed a second ago: no 45-minute wait
        r = self.build()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('taking over', r.stderr)

    def test_a_takeover_in_progress_blocks_a_second_takeover(self):
        p = subprocess.Popen([sys.executable, '-c', 'pass'])
        p.wait()
        self.plant_lock(p.pid, time.time() - 7200)
        open(self.lock_path() + '.takeover', 'x').close()   # another build is taking over right now
        r = self.build()
        self.assertEqual(r.returncode, 3, r.stderr)
        self.assertIn('taking over', r.stderr)

    def test_concurrent_takeovers_let_exactly_one_build_through(self):
        p = subprocess.Popen([sys.executable, '-c', 'pass'])
        p.wait()
        self.plant_lock(p.pid, time.time() - 7200)
        code = ('import sys, time; sys.path.insert(0, sys.argv[1]); import buildlock\n'
                'try:\n'
                '    l = buildlock.BuildLock(sys.argv[2]).acquire()\n'
                'except buildlock.LockHeld:\n'
                '    print("HELD"); sys.exit(0)\n'
                'print("GOT"); sys.stdout.flush(); time.sleep(1.5); l.release()\n')
        procs = [subprocess.Popen([sys.executable, '-c', code, CHAIN, self.lock_path()], stdout=subprocess.PIPE,
                                  stderr=subprocess.DEVNULL, text=True) for _ in range(6)]
        outs = [pr.communicate(timeout=60)[0].strip() for pr in procs]
        self.assertEqual(outs.count('GOT'), 1, outs)

    def test_release_leaves_a_lock_that_is_no_longer_ours(self):
        lock = buildlock.BuildLock(os.path.join(self.tmp.name, 'lk')).acquire()
        with open(lock.info, 'w') as f:
            json.dump({'pid': 1, 'host': 'other-host', 'started': time.time()}, f)
        self.assertFalse(lock.release())
        self.assertTrue(os.path.isdir(lock.path))

    # --- i18n unit ----------------------------------------------------------------------------------------
    def test_translate_keeps_whitespace_scripts_and_title(self):
        doc = ('<html lang="en"><head><title>Hello</title></head><body>\n  <p> Hello </p>'
               '<img alt="Hello"><script>var s = "Hello";</script><!-- Hello --></body></html>')
        out, missing = i18n.translate(doc, 'de', {'Hello': 'Hallo'}, set(), {}, 'en')
        self.assertEqual(missing, [])
        self.assertIn('<p> Hallo </p>', out)
        self.assertIn('alt="Hallo"', out)
        self.assertIn('<title>Hello</title>', out)
        self.assertIn('var s = "Hello";', out)
        self.assertIn('<!-- Hello -->', out)
        self.assertIn('<html lang="de">', out)

    # --- links (item: root-relative, ./ and ../ links) ------------------------------------------------------
    def test_root_relative_dot_and_parent_links_are_localised(self):
        page_langs = {'index.html': ['en', 'de'], 'privacy.html': ['en', 'de'], 'blog/post.html': ['en', 'de']}
        doc = ('<html lang="en"><body><a href="/privacy.html">a</a><a href="./privacy.html#x">b</a>'
               '<a href="../index.html?q=1">c</a><a href="privacy.html">d</a><a href="https://x.example/privacy.html">e</a>'
               '</body></html>')
        warnings = []
        out = i18n.localise_links(doc, 'blog/post.html', 'de', page_langs, 'en', warnings)
        self.assertIn('href="/privacy-de.html"', out)
        self.assertIn('href="./privacy.html#x"', out, './ resolves to blog/privacy.html, which is not a page')
        self.assertIn('href="../index-de.html?q=1"', out)
        self.assertIn('href="https://x.example/privacy.html"', out, 'external links are never touched')
        self.assertTrue(any('blog/privacy.html' in w for w in warnings), warnings)
        out = i18n.localise_links(doc, 'index.html', 'de', page_langs, 'en', [])
        self.assertIn('href="./privacy-de.html#x"', out)

    def test_unlocalised_internal_links_are_warned_about(self):
        r = self.build()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn('WARN index-de.html: link "privacy.html" has no de version', r.stderr)
        self.edit_src('index.html', '<a href="privacy.html">Privacy</a>', '<a href="/missing.html">Privacy</a>')
        r = self.build()
        self.assertIn('WARN index.html: link "/missing.html" points to missing.html, which is not a page of this build', r.stderr)

    # --- block mode: whole elements with inline markup (German verb order) ------------------------------------
    def test_block_with_inline_markup_is_translated_as_one_unit(self):
        doc = '<html lang="en"><body><p class="x">You can <b>sync</b> your notes <a href="#later" title="Later">later</a>.</p></body></html>'
        strings = {'You can {0}sync{/0} your notes {1}later{/1}.': 'Sie können Ihre Notizen {1}später{/1} {0}synchronisieren{/0}.',
                   'Later': 'Später'}
        out, missing = i18n.translate(doc, 'de', strings, set(), {}, 'en')
        self.assertEqual(missing, [])
        self.assertIn('<p class="x">Sie können Ihre Notizen <a href="#later" title="Später">später</a> <b>synchronisieren</b>.</p>', out)

    def test_block_mode_falls_back_to_fragments_and_checks_placeholders(self):
        doc = '<html lang="en"><body><p>Tap <b>here</b> now.</p><p>Go <i>on</i>.</p></body></html>'
        strings = {'Tap': 'Tippen', 'here': 'hier', 'now.': 'jetzt.', 'Go {0}on{/0}.': 'Weiter.'}
        out, missing = i18n.translate(doc, 'de', strings, set(), {}, 'en')
        self.assertIn('<p>Tippen <b>hier</b> jetzt.</p>', out, 'fragment mode still works')
        self.assertEqual(missing, ['Go {0}on{/0}. (placeholders differ in the translation: {0} {/0})'])

    def test_sample_site_shows_the_german_verb_order_example(self):
        self.build()
        self.assertIn('Alles funktioniert ohne Verbindung und wird später <b>synchronisiert</b>.', self.read('index-de.html'))

    # --- config (exit 2) ------------------------------------------------------------------------------------------
    def test_missing_or_invalid_config_exits_2_with_a_clear_message(self):
        bad = os.path.join(self.tmp.name, 'bad.json')
        with open(bad, 'w') as f:
            f.write('{ not json')
        r = self.build('--config', bad)
        self.assertEqual(r.returncode, 2, r.stderr)
        self.assertIn('config', r.stderr)
        r = self.build('--config', os.path.join(self.tmp.name, 'nope.json'))
        self.assertEqual(r.returncode, 2, r.stderr)
        self.assertIn('nope.json', r.stderr)
        with open(os.path.join(CHAIN, 'site.json'), encoding='utf-8') as f:
            cfg = json.load(f)
        del cfg['base_url']
        del cfg['pages']['index.html']['seo']['de']
        with open(bad, 'w', encoding='utf-8') as f:
            json.dump(cfg, f)
        r = self.build('--config', bad)
        self.assertEqual(r.returncode, 2, r.stderr)
        self.assertIn('base_url', r.stderr)
        self.assertIn('pages.index.html.seo.de', r.stderr)
        self.assertFalse(os.path.exists(self.out))

    # --- SEO: noindex variants, brand, committed lastmod -----------------------------------------------------------
    def config(self, **changes):
        with open(os.path.join(CHAIN, 'site.json'), encoding='utf-8') as f:
            cfg = json.load(f)
        for k, v in changes.items():
            cfg[k] = v
        path = os.path.join(self.tmp.name, 'site.json')
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(cfg, f)
        return cfg, path

    def test_noindex_variants_are_left_out_of_hreflang(self):
        cfg, _ = self.config()
        cfg['pages']['index.html']['noindex'] = ['de']
        path = os.path.join(self.tmp.name, 'site.json')
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(cfg, f)
        r = self.build('--config', path)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        en, de = self.read('index.html'), self.read('index-de.html')
        self.assertNotIn('hreflang="de" href=', en.split('</head>')[0])
        self.assertNotIn('<link rel="alternate"', de.split('</head>')[0], 'a noindex page announces no alternates')
        self.assertIn('<meta name="robots" content="noindex">', de)
        sm = self.read('sitemap.xml')
        self.assertNotIn('index-de.html', sm)

    def test_brand_comes_from_the_config(self):
        _, path = self.config(brand='Acme Pad')
        self.assertEqual(self.build('--config', path).returncode, 0)
        de = self.read('index-de.html')
        ld = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', de).group(1))
        self.assertEqual([n for n in ld['@graph'] if n['@type'] == 'WebSite'][0]['name'], 'Acme Pad')
        self.assertIn('data-brand="Acme Pad"', de)
        with open(os.path.join(CHAIN, 'seo.py'), encoding='utf-8') as f:
            self.assertNotIn('Lumen Notes', f.read())
        with open(os.path.join(CHAIN, 'assets', 'typo.js'), encoding='utf-8') as f:
            self.assertNotIn('Lumen Notes', f.read())

    def test_lastmod_history_lives_in_a_committed_file_and_survives_a_clean_checkout(self):
        self.build(date='2026-10-01')
        self.assertTrue(os.path.isfile(os.path.join(self.src, 'lastmod.json')), 'lastmod.json next to the pages')
        rmtree_retry(os.path.join(self.src, '.build'))   # what a CI checkout looks like
        rmtree_retry(self.out)
        self.build(date='2026-10-20')
        self.assertEqual(self.read('sitemap.xml').count('<lastmod>2026-10-01</lastmod>'), 2)

    # --- leftover check: a real tokenizer -------------------------------------------------------------------------
    def test_string_literals_handles_regex_literals_and_templates(self):
        js = ("const re = /it's/g, half = a / b / c;\n"
              "const msg = 'Your note is saved';\n"
              "const t = `${n} notes ${'are saved for you'} here`;\n"
              "const u = x.replace(/[\"`]/, '') // don't\n")
        lits = i18n.string_literals(js)
        self.assertIn('Your note is saved', lits)
        self.assertIn('are saved for you', lits)
        self.assertIn(' notes ', lits)
        self.assertNotIn('s/g, half = a / b / c;\nconst msg = ', lits)

    def test_single_word_dictionary_copy_in_a_script_is_a_leftover(self):
        self.edit_src('index.html', "  let n = 0;", "  document.title = 'Search';\n  let n = 0;")
        r = self.build()
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn('index-de.html: leftover master-language copy: "Search"', r.stdout)


if __name__ == '__main__':
    unittest.main()

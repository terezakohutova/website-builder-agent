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
        shutil.copytree(SAMPLE, self.src, ignore=shutil.ignore_patterns('_dist', '.build'))
        self.out = os.path.join(self.src, '_dist')

    def tearDown(self):
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
        # the source pages are only read (the build writes .build/ state and _dist/, nothing else)
        shutil.rmtree(self.out)
        shutil.rmtree(os.path.join(self.src, '.build'))
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


if __name__ == '__main__':
    unittest.main()

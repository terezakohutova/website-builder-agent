"""Self-test for scripts/backup/snapshot.py. Runs the real script as a subprocess in a temp project.

    python -m unittest discover -s tests -v
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(__file__), '..', '.claude', 'skills', 'website-build',
                      'scripts', 'backup', 'snapshot.py')
SCRIPT = os.path.abspath(SCRIPT)
HOOKS = os.path.join(os.path.dirname(__file__), '..', 'examples', 'settings.hooks.json')


class SnapshotTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        self.env = dict(os.environ, SNAPSHOT_ROOT=self.root, PYTHONIOENCODING='utf-8')
        for k in ('SNAPSHOT_KEEP', 'SNAPSHOT_MAX_MB'):
            self.env.pop(k, None)

    def tearDown(self):
        self.tmp.cleanup()

    def run_cli(self, *args, stdin=None, env=None):
        return subprocess.run([sys.executable, '-I', SCRIPT, *args], cwd=self.root, env=dict(self.env, **(env or {})),
                              input=stdin, capture_output=True, text=True, encoding='utf-8')

    def popen(self, *args):
        return subprocess.Popen([sys.executable, '-I', SCRIPT, *args], cwd=self.root, env=self.env,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8')

    def write(self, rel, text):
        p = os.path.join(self.root, *rel.split('/'))
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'w', encoding='utf-8', newline='') as f:
            f.write(text)
        return p

    def store(self, rel):
        return os.path.join(self.root, '.versions', *rel.split('/'))

    def versions(self, rel):
        r = self.run_cli('list', rel)
        return [json.loads(line) for line in r.stdout.splitlines() if line.startswith('{')]

    # --- argument handling: exit 2 -----------------------------------------------------------
    def test_no_args_prints_usage_and_exits_2(self):
        r = self.run_cli()
        self.assertEqual(r.returncode, 2)
        self.assertIn('snapshot.py save', r.stdout)

    def test_unknown_command_exits_2(self):
        self.assertEqual(self.run_cli('frobnicate').returncode, 2)

    def test_save_without_files_exits_2(self):
        self.assertEqual(self.run_cli('save').returncode, 2)

    def test_restore_needs_two_args(self):
        self.assertEqual(self.run_cli('restore', 'x.html').returncode, 2)

    def test_restore_rejects_path_traversal_and_malformed_ids(self):
        self.write('site/a.html', 'x')
        for bad in ('../../outside', '..\\..\\x', '20261013T091500Z/../../a', 'latest', '', '2026-10-13'):
            r = self.run_cli('restore', 'site/a.html', bad)
            self.assertEqual(r.returncode, 2, bad)
            self.assertIn('not a version id', r.stderr, bad)

    # --- exit 3: could not do it -------------------------------------------------------------
    def test_restore_unknown_version_exits_3(self):
        self.write('site/src/index.html', 'a')
        r = self.run_cli('restore', 'site/src/index.html', '19990101T000000Z')
        self.assertEqual(r.returncode, 3)
        self.assertIn('no version', r.stderr)

    def test_list_without_versions(self):
        self.write('a.html', 'x')
        r = self.run_cli('list', 'a.html')
        self.assertEqual(r.returncode, 0)
        self.assertIn('no versions', r.stdout)

    # --- behaviour ---------------------------------------------------------------------------
    def test_version_ids_are_utc_and_valid(self):
        self.write('a.html', 'x')
        self.run_cli('save', 'a.html')
        v = self.versions('a.html')[0]['version']
        self.assertRegex(v, r'^\d{8}T\d{6}Z$')

    def test_save_dedupes_identical_content(self):
        self.write('site/src/index.html', 'one')
        self.assertIn('saved', self.run_cli('save', 'site/src/index.html').stdout)
        self.assertIn('unchanged', self.run_cli('save', 'site/src/index.html').stdout)
        self.assertEqual(len(self.versions('site/src/index.html')), 1)

    def test_two_saves_in_one_second_keep_both(self):
        p = 'site/src/index.html'
        for text in ('one', 'two', 'three'):
            self.write(p, text)
            self.run_cli('save', p)
        vers = [v['version'] for v in self.versions(p)]
        self.assertEqual(len(vers), 3)
        self.assertEqual(len(set(vers)), 3, 'version ids must be unique even within one second')
        contents = []
        for v in vers:
            with open(os.path.join(self.store(p), v + '.html'), encoding='utf-8') as f:
                contents.append(f.read())
        self.assertEqual(contents, ['one', 'two', 'three'])

    def test_retention_keeps_the_newest_n(self):
        p = 'a.html'
        for i in range(5):
            self.write(p, f'v{i}')
            self.run_cli('save', p, env={'SNAPSHOT_KEEP': '2'})
        vers = self.versions(p)
        self.assertEqual(len(vers), 2)
        files = sorted(f for f in os.listdir(self.store(p)) if f.endswith('.html'))
        self.assertEqual(len(files), 2, files)
        with open(os.path.join(self.store(p), vers[-1]['version'] + '.html'), encoding='utf-8') as f:
            self.assertEqual(f.read(), 'v4')

    def test_large_file_is_skipped_with_a_message(self):
        self.write('big.html', 'x' * 4096)
        r = self.run_cli('save', 'big.html', env={'SNAPSHOT_MAX_MB': '0.001'})
        self.assertEqual(r.returncode, 1)
        self.assertIn('skipped: larger than 0.001 MB', r.stdout)
        self.assertEqual(self.versions('big.html'), [])

    def test_large_file_in_hook_warns_on_stderr_and_exits_0(self):
        p = self.write('big.html', 'x' * 4096)
        r = self.run_cli('hook', stdin=json.dumps({'tool_name': 'Edit', 'tool_input': {'file_path': p}}),
                         env={'SNAPSHOT_MAX_MB': '0.001'})
        self.assertEqual(r.returncode, 0)
        self.assertIn('larger than', r.stderr)

    def test_concurrent_saves_do_not_corrupt_metadata(self):
        files = [self.write(f'site/p{i}.html', f'page {i}') for i in range(3)]
        procs = []
        for round_ in range(4):
            for i, f in enumerate(files):
                self.write(f'site/p{i}.html', f'page {i} round {round_}')
            procs += [self.popen('save', f) for f in files for _ in range(2)]
        for p in procs:
            p.communicate(timeout=60)
        for i in range(3):
            rel = f'site/p{i}.html'
            vers = self.versions(rel)
            self.assertGreaterEqual(len(vers), 1)
            ids = [v['version'] for v in vers]
            self.assertEqual(len(ids), len(set(ids)))
            for v in ids:   # every metadata file has its data file
                self.assertTrue(os.path.isfile(os.path.join(self.store(rel), v + '.html')), v)

    def test_restore_versions_current_file_first(self):
        p = 'site/src/index.html'
        self.write(p, 'good')
        self.run_cli('save', p)
        good = self.versions(p)[0]['version']
        self.write(p, 'broken')
        r = self.run_cli('restore', p, good)
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(os.path.join(self.root, 'site', 'src', 'index.html'), encoding='utf-8') as f:
            self.assertEqual(f.read(), 'good')
        reasons = [v['reason'] for v in self.versions(p)]
        self.assertEqual(reasons[-1], f'before restore of {good}', 'the broken file must be kept')

    def test_generated_and_outside_paths_are_not_versioned(self):
        for rel in ('site/_dist/index.html', 'site/_deploy/index.html', 'node_modules/x/a.js'):
            self.write(rel, 'generated')
            r = self.run_cli('save', rel)
            self.assertIn('not versioned', r.stdout, rel)
        with tempfile.NamedTemporaryFile('w', suffix='.html', delete=False) as f:
            outside = f.name
        try:
            self.assertIn('not versioned', self.run_cli('save', outside).stdout)
        finally:
            os.unlink(outside)
        self.assertFalse(os.path.exists(os.path.join(self.root, '.versions', 'site', '_dist')))

    @unittest.skipUnless(os.name == 'nt', 'case-insensitive paths are a Windows behaviour')
    def test_windows_path_case_does_not_matter(self):
        p = self.write('site/src/index.html', 'x')
        r = self.run_cli('save', p.upper())
        self.assertIn('saved', r.stdout)

    # --- hook ----------------------------------------------------------------------------------
    def test_hook_versions_edit_and_notebook(self):
        p = self.write('site/src/index.html', 'before edit')
        r = self.run_cli('hook', stdin=json.dumps({'tool_name': 'Edit', 'tool_input': {'file_path': p}}))
        self.assertEqual(r.returncode, 0)
        self.assertEqual(self.versions('site/src/index.html')[0]['reason'], 'before Edit')
        nb = self.write('notes/a.ipynb', '{}')
        self.run_cli('hook', stdin=json.dumps({'tool_name': 'NotebookEdit', 'tool_input': {'notebook_path': nb}}))
        self.assertEqual(self.versions('notes/a.ipynb')[0]['reason'], 'before NotebookEdit')

    def test_hook_root_defaults_to_claude_project_dir(self):
        p = self.write('site/a.html', 'x')
        env = dict(self.env, CLAUDE_PROJECT_DIR=self.root)
        env.pop('SNAPSHOT_ROOT')
        other = tempfile.mkdtemp()
        try:
            r = subprocess.run([sys.executable, '-I', SCRIPT, 'hook'], cwd=other, env=env, capture_output=True, text=True,
                               input=json.dumps({'tool_name': 'Write', 'tool_input': {'file_path': p}}))
            self.assertEqual(r.returncode, 0)
            self.assertEqual(len(self.versions('site/a.html')), 1)
        finally:
            os.rmdir(other)

    def test_hook_never_blocks(self):
        for payload in ('', 'not json', '{"tool_input": {"file_path": "/does/not/exist"}}', '[]'):
            r = self.run_cli('hook', stdin=payload)
            self.assertEqual(r.returncode, 0, payload)

    def test_hook_example_uses_the_project_dir(self):
        with open(HOOKS, encoding='utf-8') as f:
            cmd = json.load(f)['hooks']['PreToolUse'][0]['hooks'][0]['command']
        self.assertIn('$CLAUDE_PROJECT_DIR/.claude/skills/website-build/scripts/backup/snapshot.py', cmd)


if __name__ == '__main__':
    unittest.main()

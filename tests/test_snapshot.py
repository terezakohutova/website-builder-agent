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


class SnapshotTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        self.env = dict(os.environ, SNAPSHOT_ROOT=self.root, PYTHONIOENCODING='utf-8')

    def tearDown(self):
        self.tmp.cleanup()

    def run_cli(self, *args, stdin=None):
        return subprocess.run([sys.executable, '-I', SCRIPT, *args], cwd=self.root, env=self.env,
                              input=stdin, capture_output=True, text=True, encoding='utf-8')

    def write(self, rel, text):
        p = os.path.join(self.root, *rel.split('/'))
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'w', encoding='utf-8', newline='') as f:
            f.write(text)
        return p

    def versions(self, rel):
        idx = os.path.join(self.root, '.versions', *rel.split('/'), 'index.jsonl')
        if not os.path.isfile(idx):
            return []
        with open(idx, encoding='utf-8') as f:
            return [json.loads(line) for line in f if line.strip()]

    # --- argument handling -------------------------------------------------------------------
    def test_no_args_prints_usage_and_fails(self):
        r = self.run_cli()
        self.assertEqual(r.returncode, 1)
        self.assertIn('snapshot.py save', r.stdout)

    def test_unknown_command_fails(self):
        self.assertEqual(self.run_cli('frobnicate').returncode, 1)

    def test_save_without_files_fails(self):
        self.assertEqual(self.run_cli('save').returncode, 1)

    def test_restore_needs_two_args(self):
        self.assertEqual(self.run_cli('restore', 'x.html').returncode, 1)

    def test_restore_unknown_version_exits_2(self):
        self.write('site/src/index.html', 'a')
        r = self.run_cli('restore', 'site/src/index.html', '19990101-000000')
        self.assertEqual(r.returncode, 2)
        self.assertIn('no version', r.stderr)

    def test_list_without_versions(self):
        self.write('a.html', 'x')
        r = self.run_cli('list', 'a.html')
        self.assertEqual(r.returncode, 0)
        self.assertIn('no versions', r.stdout)

    # --- behaviour ---------------------------------------------------------------------------
    def test_save_dedupes_identical_content(self):
        self.write('site/src/index.html', 'one')
        self.assertIn('saved', self.run_cli('save', 'site/src/index.html').stdout)
        self.assertIn('unchanged', self.run_cli('save', 'site/src/index.html').stdout)
        self.assertEqual(len(self.versions('site/src/index.html')), 1)

    def test_two_saves_in_one_second_keep_both(self):
        p = 'site/src/index.html'
        self.write(p, 'one')
        self.run_cli('save', p)
        self.write(p, 'two')
        self.run_cli('save', p)
        self.write(p, 'three')
        self.run_cli('save', p)
        vers = [v['version'] for v in self.versions(p)]
        self.assertEqual(len(vers), 3)
        self.assertEqual(len(set(vers)), 3, 'version ids must be unique even within one second')
        d = os.path.join(self.root, '.versions', 'site', 'src', 'index.html')
        contents = []
        for v in vers:
            with open(os.path.join(d, v + '.html'), encoding='utf-8') as f:
                contents.append(f.read())
        self.assertEqual(contents, ['one', 'two', 'three'])

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

    def test_hook_never_blocks(self):
        for payload in ('', 'not json', '{"tool_input": {"file_path": "/does/not/exist"}}', '[]'):
            r = self.run_cli('hook', stdin=payload)
            self.assertEqual(r.returncode, 0, payload)


if __name__ == '__main__':
    unittest.main()

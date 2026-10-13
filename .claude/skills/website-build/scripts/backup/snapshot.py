# -*- coding: utf-8 -*-
"""File versions for a website project, so no edit is ever unrecoverable.

Git is the main backup (one repo per site, commit at every milestone). This covers the gap between
commits and files outside git: before an edit, the current file is copied to
`.versions/<path>/<YYYYmmdd-HHMMSS>[_N]<ext>` (skipped when identical to the latest version).

    python snapshot.py save <file> [<file> ...]      # take a version now (do this before a scripted edit)
    python snapshot.py list <file>                   # versions of one file, oldest first
    python snapshot.py restore <file> <version>      # versions the current file first, then restores
    python snapshot.py hook                          # PreToolUse hook: reads the tool call JSON on stdin

Generated folders (`_dist`, `_deploy`, `node_modules`, `.git`, `.versions`) are never versioned: they are
rebuilt from source. Set SNAPSHOT_ROOT to the project root (default: current directory).
Exit codes: 0 ok, 1 usage error, 2 unknown version. The hook always exits 0: a backup must never block an edit.
"""
import datetime as dt
import hashlib
import json
import os
import shutil
import sys

ROOT = os.path.abspath(os.environ.get('SNAPSHOT_ROOT', os.getcwd()))
STORE = os.path.join(ROOT, '.versions')
SKIP = ('_dist', '_deploy', 'node_modules', '.git', '.versions')
MAX_BYTES = 20 * 1024 * 1024


def rel(path):
    """Project-relative path with '/' separators, or None if outside ROOT or inside a skipped folder."""
    p = os.path.abspath(path)
    # normcase: on Windows "C:\\Site" and "c:\\site" are the same folder
    if not os.path.normcase(p).startswith(os.path.normcase(ROOT) + os.sep):
        return None
    r = os.path.relpath(p, ROOT).replace(os.sep, '/')
    return None if any(part in SKIP for part in r.split('/')) else r


def store_dir(r):
    return os.path.join(STORE, *r.split('/'))


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def versions(d):
    """Version ids in save order, read from the index (file names alone do not sort reliably)."""
    idx = os.path.join(d, 'index.jsonl')
    if not os.path.isfile(idx):
        return []
    out = []
    with open(idx, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line)['version'])
    return out


def save(path, reason='manual'):
    """Copy `path` into the store. Returns the new version path, or None when skipped or unchanged."""
    r = rel(path)
    if r is None or not os.path.isfile(path) or os.path.getsize(path) > MAX_BYTES:
        return None
    d = store_dir(r)
    os.makedirs(d, exist_ok=True)
    ext = os.path.splitext(path)[1]
    known = versions(d)
    if known and digest(os.path.join(d, known[-1] + ext)) == digest(path):
        return None
    stamp = dt.datetime.now().strftime('%Y%m%d-%H%M%S')
    ver, n = stamp, 1
    while os.path.exists(os.path.join(d, ver + ext)):   # two saves in one second must not overwrite
        ver, n = f'{stamp}_{n}', n + 1
    dst = os.path.join(d, ver + ext)
    shutil.copy2(path, dst)
    with open(os.path.join(d, 'index.jsonl'), 'a', encoding='utf-8') as f:
        f.write(json.dumps({'version': ver, 'reason': reason}) + '\n')
    return dst


def main(argv):
    if not argv or argv[0] in ('-h', '--help'):
        print(__doc__)
        return 1 if not argv else 0
    cmd, args = argv[0], argv[1:]
    if cmd == 'save':
        if not args:
            print('usage: snapshot.py save <file> [<file> ...]', file=sys.stderr)
            return 1
        for p in args:
            if rel(p) is None:
                print(f'{p}: not versioned (outside {ROOT} or in a generated folder)')
                continue
            dst = save(p)
            print(f'{p}: ' + (f'saved {os.path.relpath(dst, ROOT)}' if dst else 'unchanged or missing'))
    elif cmd == 'list':
        if len(args) != 1:
            print('usage: snapshot.py list <file>', file=sys.stderr)
            return 1
        r = rel(args[0])
        d = store_dir(r) if r else None
        idx = os.path.join(d, 'index.jsonl') if d else ''
        if not os.path.isfile(idx):
            print('no versions')
            return 0
        with open(idx, encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    print(line.strip())
    elif cmd == 'restore':
        if len(args) != 2:
            print('usage: snapshot.py restore <file> <version>', file=sys.stderr)
            return 1
        path, ver = args
        r = rel(path)
        src = os.path.join(store_dir(r), ver + os.path.splitext(path)[1]) if r else ''
        if not src or not os.path.isfile(src):
            print(f'no version {ver} for {path} (see: snapshot.py list {path})', file=sys.stderr)
            return 2
        save(path, reason=f'before restore of {ver}')
        shutil.copy2(src, path)
        print(f'restored {path} from {ver}')
    elif cmd == 'hook':
        try:
            data = json.load(sys.stdin)
            ti = data.get('tool_input') or {}
            p = ti.get('file_path') or ti.get('notebook_path')
            if p:
                save(p, reason=f"before {data.get('tool_name', 'edit')}")
        except Exception:
            pass  # a backup hook must never block the edit
    else:
        print(__doc__)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))

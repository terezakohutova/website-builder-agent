# -*- coding: utf-8 -*-
"""File versions for a website project, so no edit is ever unrecoverable.

Git is the main backup (one repo per site, commit at every milestone). This covers the gap between
commits and files outside git: before an edit, the current file is copied to
`.versions/<path>/<YYYYmmdd-HHMMSS><ext>` (skipped when identical to the latest version).

    python snapshot.py save <file> [<file> ...]      # take a version now (do this before a scripted edit)
    python snapshot.py list <file>                   # versions of one file
    python snapshot.py restore <file> <version>      # versions the current file first, then restores
    python snapshot.py hook                          # PreToolUse hook: reads the tool call JSON on stdin

Generated folders (`_dist`, `_deploy`, `node_modules`, `.git`, `.versions`) are never versioned: they are
rebuilt from source. Set SNAPSHOT_ROOT to the project root (default: current directory).
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
    p = os.path.abspath(path)
    if not p.startswith(ROOT + os.sep):
        return None
    r = os.path.relpath(p, ROOT).replace(os.sep, '/')
    return None if any(part in SKIP for part in r.split('/')) else r


def digest(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


def save(path, reason='manual'):
    r = rel(path)
    if r is None or not os.path.isfile(path) or os.path.getsize(path) > MAX_BYTES:
        return None
    d = os.path.join(STORE, *r.split('/'))
    os.makedirs(d, exist_ok=True)
    existing = sorted(x for x in os.listdir(d) if x != 'index.jsonl')
    if existing and digest(os.path.join(d, existing[-1])) == digest(path):
        return None
    stamp = dt.datetime.now().strftime('%Y%m%d-%H%M%S')
    dst = os.path.join(d, stamp + os.path.splitext(path)[1])
    shutil.copy2(path, dst)
    with open(os.path.join(d, 'index.jsonl'), 'a', encoding='utf-8') as f:
        f.write(json.dumps({'version': stamp, 'reason': reason}) + '\n')
    return dst


def main(argv):
    if not argv:
        print(__doc__)
        return 1
    cmd, args = argv[0], argv[1:]
    if cmd == 'save':
        for p in args:
            dst = save(p)
            print(f'{p}: ' + (f'saved {os.path.relpath(dst, ROOT)}' if dst else 'unchanged / not versioned'))
    elif cmd == 'list':
        r = rel(args[0]) if args else None
        d = os.path.join(STORE, *r.split('/')) if r else None
        if not d or not os.path.isdir(d):
            print('no versions')
            return 0
        for line in open(os.path.join(d, 'index.jsonl'), encoding='utf-8'):
            print(line.strip())
    elif cmd == 'restore':
        if len(args) != 2:
            raise SystemExit('usage: restore <file> <version>')
        path, ver = args
        r = rel(path)
        src = os.path.join(STORE, *r.split('/'), ver + os.path.splitext(path)[1]) if r else ''
        if not os.path.isfile(src):
            raise SystemExit(f'no version {ver} for {path}')
        save(path, reason=f'before restore of {ver}')
        shutil.copy2(src, path)
        print(f'restored {path} from {ver}')
    elif cmd == 'hook':
        try:
            data = json.load(sys.stdin)
            p = (data.get('tool_input') or {}).get('file_path')
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

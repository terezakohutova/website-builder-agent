# -*- coding: utf-8 -*-
"""File versions for a website project, so no edit is ever unrecoverable.

Git is the main backup (one repo per site, commit at every milestone). This covers the gap between
commits and files outside git: before an edit, the current file is copied to
`.versions/<path>/<version><ext>` with its metadata in `.versions/<path>/<version>.meta.json`
(skipped when identical to the latest version). A version id is a UTC timestamp, `20261013T091500Z`,
with `-N` appended when several saves land in the same second.

    python snapshot.py save <file> [<file> ...]      # take a version now (do this before a scripted edit)
    python snapshot.py list <file>                   # versions of one file, oldest first
    python snapshot.py restore <file> <version>      # versions the current file first, then restores
    python snapshot.py hook                          # PreToolUse hook: reads the tool call JSON on stdin

Environment:
    SNAPSHOT_ROOT     project root (default: $CLAUDE_PROJECT_DIR, else the current directory)
    SNAPSHOT_KEEP     versions kept per file, oldest deleted first (default 50; 0 = keep all)
    SNAPSHOT_MAX_MB   larger files are skipped, and the skip is reported (default 20)

Generated folders (`_dist`, `_deploy`, `node_modules`, `.git`, `.versions`) are never versioned: they are
rebuilt from source. Concurrent saves (two hooks at once) are safe: each version claims its id by creating
its file exclusively, and each version has its own metadata file, so there is no shared index to corrupt.

Exit codes: 0 ok, 1 nothing was saved because a file was skipped (too large, missing), 2 bad usage
(including a malformed version id), 3 could not run (unknown version, I/O error).
The hook always exits 0: a backup must never block an edit.
"""
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import sys

ROOT = os.path.abspath(os.environ.get('SNAPSHOT_ROOT') or os.environ.get('CLAUDE_PROJECT_DIR') or os.getcwd())
STORE = os.path.join(ROOT, '.versions')
SKIP = ('_dist', '_deploy', 'node_modules', '.git', '.versions')
VERSION_RE = re.compile(r'^\d{8}T\d{6}Z(?:-\d{1,4})?$')


def env_number(name, default):
    try:
        v = float(os.environ.get(name, default))
        return v if v >= 0 else default
    except ValueError:
        return default


KEEP = int(env_number('SNAPSHOT_KEEP', 50))
MAX_MB = env_number('SNAPSHOT_MAX_MB', 20)


class Skipped(Exception):
    """The file was not versioned for a reason the user should see."""


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


def sort_key(ver):
    stamp, _, n = ver.partition('-')
    return stamp, int(n or 0)


def versions(d):
    """Metadata dicts of complete versions in save order (a version counts once its .meta.json exists)."""
    if not os.path.isdir(d):
        return []
    out = []
    for name in os.listdir(d):
        if not name.endswith('.meta.json'):
            continue
        try:
            with open(os.path.join(d, name), encoding='utf-8') as f:
                meta = json.load(f)
        except (OSError, ValueError):
            continue
        if VERSION_RE.match(meta.get('version', '')):
            out.append(meta)
    return sorted(out, key=lambda m: sort_key(m['version']))


def claim(d, ext):
    """Create the data file for a new, unique version id atomically. Returns (version, path)."""
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    # start after the highest suffix already used in this second, so ids keep sorting in save order even
    # after retention has deleted an older version with the same stamp
    used = [sort_key(m.group(1))[1] for m in (re.match(r'^(\d{8}T\d{6}Z(?:-\d+)?)', f) for f in os.listdir(d))
            if m and m.group(1).startswith(stamp)]
    for n in range(max(used) + 1 if used else 0, 10000):
        ver = stamp if n == 0 else f'{stamp}-{n}'
        dst = os.path.join(d, ver + ext)
        try:
            fd = os.open(dst, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            continue
        os.close(fd)
        return ver, dst
    raise OSError('no free version id')


def prune(d, ext):
    """Keep the newest KEEP versions (0 = all)."""
    if KEEP <= 0:
        return []
    old = versions(d)[:-KEEP]
    for meta in old:
        for name in (meta['version'] + meta.get('ext', ext), meta['version'] + '.meta.json'):
            try:
                os.remove(os.path.join(d, name))
            except OSError:
                pass
    return [m['version'] for m in old]


def save(path, reason='manual'):
    """Copy `path` into the store. Returns the new version path, or None when unchanged.
    Raises Skipped when the file is missing or too large."""
    r = rel(path)
    if r is None:
        raise Skipped(f'not versioned (outside {ROOT} or in a generated folder)')
    if not os.path.isfile(path):
        raise Skipped('skipped: no such file')
    size = os.path.getsize(path)
    if size > MAX_MB * 1024 * 1024:
        raise Skipped(f'skipped: larger than {MAX_MB:g} MB ({size / 1048576:.1f} MB); raise SNAPSHOT_MAX_MB to version it')
    d = store_dir(r)
    os.makedirs(d, exist_ok=True)
    ext = os.path.splitext(path)[1]
    known = versions(d)
    if known:
        last = os.path.join(d, known[-1]['version'] + known[-1].get('ext', ext))
        if os.path.isfile(last) and digest(last) == digest(path):
            return None
    ver, dst = claim(d, ext)
    shutil.copy2(path, dst)
    meta = {'version': ver, 'reason': reason, 'ext': ext, 'size': size,
            'saved': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')}
    tmp = os.path.join(d, ver + '.meta.json.tmp')
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(meta, f)
    os.replace(tmp, os.path.join(d, ver + '.meta.json'))
    prune(d, ext)
    return dst


def usage(msg):
    print('usage: ' + msg, file=sys.stderr)
    return 2


def main(argv):
    if not argv or argv[0] in ('-h', '--help'):
        print(__doc__)
        return 2 if not argv else 0
    cmd, args = argv[0], argv[1:]
    if cmd == 'save':
        if not args:
            return usage('snapshot.py save <file> [<file> ...]')
        skipped = 0
        for p in args:
            try:
                dst = save(p)
                print(f'{p}: ' + (f'saved {os.path.relpath(dst, ROOT)}' if dst else 'unchanged'))
            except Skipped as e:
                skipped += 1
                print(f'{p}: {e}')
        return 1 if skipped else 0
    if cmd == 'list':
        if len(args) != 1:
            return usage('snapshot.py list <file>')
        r = rel(args[0])
        found = versions(store_dir(r)) if r else []
        if not found:
            print('no versions')
        for m in found:
            print(json.dumps(m))
        return 0
    if cmd == 'restore':
        if len(args) != 2:
            return usage('snapshot.py restore <file> <version>')
        path, ver = args
        if not VERSION_RE.match(ver):
            return usage(f'"{ver}" is not a version id (expected e.g. 20261013T091500Z or 20261013T091500Z-2)')
        r = rel(path)
        if r is None:
            print(f'{path}: not versioned (outside {ROOT} or in a generated folder)', file=sys.stderr)
            return 3
        d = store_dir(r)
        meta = next((m for m in versions(d) if m['version'] == ver), None)
        src = os.path.join(d, ver + meta.get('ext', os.path.splitext(path)[1])) if meta else ''
        if not src or not os.path.isfile(src):
            print(f'no version {ver} for {path} (see: snapshot.py list {path})', file=sys.stderr)
            return 3
        try:
            save(path, reason=f'before restore of {ver}')
        except Skipped:
            pass  # nothing to keep (missing file) - restore anyway
        shutil.copy2(src, path)
        print(f'restored {path} from {ver}')
        return 0
    if cmd == 'hook':
        try:
            data = json.load(sys.stdin)
            ti = data.get('tool_input') or {}
            p = ti.get('file_path') or ti.get('notebook_path')
            if p:
                try:
                    save(p, reason=f"before {data.get('tool_name', 'edit')}")
                except Skipped as e:
                    if 'larger than' in str(e):
                        print(f'snapshot: {p}: {e}', file=sys.stderr)
        except Exception:
            pass  # a backup hook must never block the edit
        return 0
    print(__doc__)
    return 2


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except OSError as e:
        print(f'could not run: {e}', file=sys.stderr)
        sys.exit(3)

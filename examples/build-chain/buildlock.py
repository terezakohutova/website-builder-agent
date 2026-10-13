"""One build at a time: a lock directory with an owner check.

mkdir is atomic, so two builds cannot both take the lock. `info.json` inside records pid, host and start
time. Release removes the lock only while it still records *this* process, so a build that timed out and
lost its lock never deletes the live build's lock.

Takeover of a lock whose owner is gone:
- same host and the owner pid is no longer running: taken over at once (a crashed build must not block the
  next one for 45 minutes);
- another host (pid cannot be checked): only when older than `stale_minutes`;
- no readable info.json: only after a short grace period (the owner may be between mkdir and writing it).
The takeover itself is serialised by an exclusively created `<lock>.takeover` file (O_EXCL, atomic): only the
build that creates it may take over, and it re-reads info.json under that file, so a lock another build has
just taken over is never stolen back. A takeover file left by a crash is removed after TAKEOVER_STALE seconds.
"""
import json
import os
import socket
import sys
import time


NO_INFO_GRACE = 10      # s: a lock folder without info.json younger than this is being created
TAKEOVER_STALE = 30     # s: a .takeover file older than this was left by a crashed takeover


class LockHeld(Exception):
    pass


def pid_alive(pid):
    if pid <= 0:
        return False
    if os.name == 'nt':
        # os.kill(pid, 0) is not a probe on Windows (signal 0 is CTRL_C_EVENT), so ask the kernel instead
        import ctypes
        k32 = ctypes.windll.kernel32
        h = k32.OpenProcess(0x1000, False, pid)   # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return k32.GetLastError() == 5         # access denied: it exists
        code = ctypes.c_ulong()
        ok = k32.GetExitCodeProcess(h, ctypes.byref(code))
        k32.CloseHandle(h)
        return bool(ok) and code.value == 259      # STILL_ACTIVE
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


class BuildLock:
    def __init__(self, path, stale_minutes=45):
        self.path = path
        self.info = os.path.join(path, 'info.json')
        self.stale = stale_minutes * 60
        self.me = {'pid': os.getpid(), 'host': socket.gethostname()}

    def read(self):
        try:
            with open(self.info, encoding='utf-8') as f:
                return json.load(f)
        except (OSError, ValueError):
            return None

    def write(self):
        tmp = self.info + f'.{os.getpid()}.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(dict(self.me, started=time.time()), f)
        os.replace(tmp, self.info)

    def stale_reason(self, held):
        """None while the lock is live; otherwise why it may be taken over."""
        if held is None:
            try:
                age = time.time() - os.path.getmtime(self.path)
            except OSError:
                return 'lock folder vanished'
            return f'no owner recorded for {int(age)} s' if age >= NO_INFO_GRACE else None
        age = time.time() - held.get('started', 0)
        if held.get('host') == self.me['host']:
            return None if pid_alive(int(held.get('pid', 0))) else f"owner pid {held.get('pid')} is not running"
        return f'{int(age // 60)} min old, owner on another host' if age >= self.stale else None

    def held_message(self, held):
        if held is None:
            return f'ANOTHER BUILD IS RUNNING (lock {self.path} has no owner yet) - wait for it'
        since = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(held.get('started', 0)))
        return f"ANOTHER BUILD IS RUNNING (pid {held.get('pid')} on {held.get('host')} since {since}) - wait for it"

    def acquire(self):
        os.makedirs(os.path.dirname(self.path) or '.', exist_ok=True)
        try:
            os.mkdir(self.path)
        except FileExistsError:
            held = self.read()
            if self.stale_reason(held) is None:
                raise LockHeld(self.held_message(held))
            self.take_over(held)
            return self
        self.write()
        return self

    def take_over(self, seen):
        """Atomic takeover: create <lock>.takeover exclusively, re-check under it, rewrite info.json."""
        guard = self.path + '.takeover'
        try:
            if time.time() - os.path.getmtime(guard) > TAKEOVER_STALE:
                os.remove(guard)   # left by a build that crashed mid-takeover
        except OSError:
            pass
        try:
            fd = os.open(guard, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            raise LockHeld('ANOTHER BUILD is taking over the stale lock right now - wait for it')
        try:
            os.close(fd)
            held = self.read()
            if held != seen or not os.path.isdir(self.path):
                # changed since we looked: another build took it over (or released it) first
                raise LockHeld(self.held_message(held) if held else 'ANOTHER BUILD took over the stale lock first - wait for it')
            reason = self.stale_reason(held)
            if reason is None:
                raise LockHeld(self.held_message(held))
            print(f'build lock: taking over a stale lock ({reason})', file=sys.stderr)
            self.write()
        finally:
            try:
                os.remove(guard)
            except OSError:
                pass

    def release(self):
        held = self.read()
        if held and held.get('pid') == self.me['pid'] and held.get('host') == self.me['host']:
            try:
                os.remove(self.info)
                os.rmdir(self.path)
            except OSError:
                pass
            return True
        return False   # not ours any more: leave it alone

    def __enter__(self):
        return self.acquire()

    def __exit__(self, *exc):
        self.release()

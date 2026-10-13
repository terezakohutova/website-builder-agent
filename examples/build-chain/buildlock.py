"""One build at a time: a lock directory with an owner check.

mkdir is atomic, so two builds cannot both take the lock. `info.json` inside records pid, host and start
time. Release removes the lock only while it still records *this* process, so a build that timed out and
lost its lock never deletes the live build's lock. A lock is taken over only when it is older than
`stale_minutes` AND its pid is no longer running on this host; the takeover rewrites info.json in place
instead of deleting and racing.
"""
import json
import os
import socket
import sys
import time


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

    def acquire(self):
        os.makedirs(os.path.dirname(self.path) or '.', exist_ok=True)
        try:
            os.mkdir(self.path)
        except FileExistsError:
            held = self.read()
            if held is None:
                # a lock directory without readable info: either just being created, or left by a crash
                age = time.time() - os.path.getmtime(self.path)
                if age < self.stale:
                    raise LockHeld(f'ANOTHER BUILD IS RUNNING (lock {self.path} has no owner yet) - wait for it')
            else:
                age = time.time() - held.get('started', 0)
                same_host = held.get('host') == self.me['host']
                if age < self.stale or not same_host or pid_alive(int(held.get('pid', 0))):
                    since = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(held.get('started', 0)))
                    raise LockHeld(f"ANOTHER BUILD IS RUNNING (pid {held.get('pid')} on {held.get('host')} since {since}) - wait for it")
            print(f'build lock: taking over a stale lock ({int(age // 60)} min old, owner gone)', file=sys.stderr)
            self.write()
            time.sleep(0.05)
            held = self.read()   # two builds taking over at once: the last writer wins, the other stops
            if not held or held.get('pid') != self.me['pid'] or held.get('host') != self.me['host']:
                raise LockHeld('ANOTHER BUILD took over the stale lock first - wait for it')
            return self
        self.write()
        return self

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

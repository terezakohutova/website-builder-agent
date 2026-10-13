"""Fail if any relative link in the repository's Markdown or HTML files points at a missing file.

    python tests/check_links.py            exit 1 and list every broken link
External links (http, https, mailto) and pure #anchors are not checked; a `path#anchor` link is checked
for the path only.
"""
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKIP_DIRS = {'.git', 'node_modules', '.versions'}
MD_LINK = re.compile(r'(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)|!\[[^\]]*\]\(([^)\s]+)\)')
HTML_LINK = re.compile(r'\b(?:href|src)\s*=\s*"([^"]+)"', re.I)


def targets(path, text):
    if path.endswith('.md'):
        # ignore links inside fenced code blocks
        text = re.sub(r'```.*?```', '', text, flags=re.S)
        for m in MD_LINK.finditer(text):
            yield m.group(1) or m.group(2)
    else:
        for m in HTML_LINK.finditer(text):
            yield m.group(1)


def main():
    broken, checked = [], 0
    for d, dirs, files in os.walk(ROOT):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
        for name in files:
            if not name.endswith(('.md', '.html')):
                continue
            path = os.path.join(d, name)
            with open(path, encoding='utf-8') as f:
                text = f.read()
            for link in targets(path, text):
                if re.match(r'^(https?:|mailto:|#|data:)', link):
                    continue
                checked += 1
                rel = link.split('#', 1)[0].split('?', 1)[0]
                dest = os.path.normpath(os.path.join(d, rel))
                if not os.path.exists(dest):
                    broken.append(f'{os.path.relpath(path, ROOT)}: {link}')
    for b in broken:
        print('BROKEN', b)
    print(f'{checked} relative links checked, {len(broken)} broken')
    return 1 if broken else 0


if __name__ == '__main__':
    sys.exit(main())

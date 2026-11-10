#!/usr/bin/env python3
"""Package all tracked public files; share identical, URL-free inline CSS.

Source HTML stays unchanged. Each replacement can be expanded byte-for-byte to
the source, and the complete published file set is retained. No HTML minifier.
"""
import collections
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys


class Styles(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=False)
        self.text = text
        self.lines = [0]
        for match in re.finditer('\n', text):
            self.lines.append(match.end())
        self.current = None
        self.blocks = []
        self.feed(text)

    def absolute_offset(self):
        line, column = self.getpos()
        return self.lines[line - 1] + column

    def handle_starttag(self, tag, attrs):
        # Only plain styles: attributes such as id, nonce and media retain their semantics.
        if tag == 'style' and not attrs:
            start = self.absolute_offset()
            self.current = (start, start + len(self.get_starttag_text()))

    def handle_endtag(self, tag):
        if tag == 'style' and self.current:
            start, content_start = self.current
            end = self.absolute_offset()
            close = self.text.index('>', end) + 1
            css = self.text[content_start:end]
            if len(css) >= 1024 and not re.search(r'url\s*\(|@import', css, re.I):
                self.blocks.append((start, close, css))
            self.current = None


def package(root, output):
    root, output = root.resolve(), output.resolve()
    if output == root or root in output.parents:
        raise ValueError('Output must be outside the source tree')
    if output.exists():
        raise ValueError('Use a fresh output directory')
    names = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
    names = [n for n in names if n and not n.startswith('.github/')
             and n not in ('.gitignore', 'AGENTS.md', 'CLAUDE.md')]
    blocks, counts, pages = {}, collections.Counter(), {}
    for name in names:
        path = root / name
        if path.is_symlink():
            raise ValueError('Symlink in publication: ' + name)
        if name.endswith('.html'):
            text = path.read_text()
            pages[name] = text
            blocks[name] = Styles(text).blocks
            counts.update(css for _, _, css in blocks[name])
    shared = {css: 'assets/shared-css/' + hashlib.sha256(css.encode()).hexdigest() + '.css'
              for css, count in counts.items() if count >= 5}
    output.mkdir(parents=True)
    for css, name in shared.items():
        path = output / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(css)
    changed = 0
    for name in names:
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if name not in pages:
            shutil.copyfile(root / name, target)
            continue
        original = text = pages[name]
        replacements = []
        for start, end, css in reversed(blocks[name]):
            if css in shared:
                link = '<link rel="stylesheet" href="/' + shared[css] + '">'
                replacements.append((link, original[start:end]))
                text = text[:start] + link + text[end:]
        restored = text
        for link, original_style in reversed(replacements):
            restored = restored.replace(link, original_style, 1)
        if restored != original:
            raise AssertionError('Non-style content changed: ' + name)
        changed += text != original
        target.write_text(text)
    total = sum(p.stat().st_size for p in output.rglob('*') if p.is_file())
    if total > 950_000_000:
        raise AssertionError(f'Published site {total:,} bytes exceeds 950 MB safety budget')
    print(json.dumps({'files': len(names), 'pagesWithSharedCSS': changed,
                      'sharedStyles': len(shared), 'publishedBytes': total}))


if __name__ == '__main__':
    package(Path(sys.argv[1]), Path(sys.argv[2]))

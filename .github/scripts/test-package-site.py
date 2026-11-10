#!/usr/bin/env python3
"""Exercise CSS sharing, exact expansion, false positives and size failure."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile

spec = importlib.util.spec_from_file_location('package_site', Path(__file__).with_name('package-site.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

css = '.example { color: gold; }\n' * 80
source = ('<!doctype html><style>' + css + '</style>'
          '<script>const literal = "<style>not CSS</style>";</script>'
          '<style id="dynamic">' + css + '</style>'
          '<style>' + css + '.image{background:url(../photo.jpg)}</style>'
          '<p>A <b>spaced</b> sentence.</p>')
with tempfile.TemporaryDirectory() as tmp:
    root, out = Path(tmp) / 'source', Path(tmp) / 'output'
    root.mkdir()
    subprocess.run(['git', 'init', '-q', str(root)], check=True)
    for i in range(5):
        (root / f'{i}.html').write_text(source)
    subprocess.run(['git', 'add', '.'], cwd=root, check=True)
    module.package(root, out)
    shared = list((out / 'assets/shared-css').glob('*.css'))
    assert len(shared) == 1 and shared[0].read_text() == css
    rendered = (out / '0.html').read_text()
    link = '<link rel="stylesheet" href="/assets/shared-css/' + shared[0].name + '">'
    assert rendered.replace(link, '<style>' + css + '</style>', 1) == source
    assert len(module.Styles(source).blocks) == 1
    try:
        module.package(root, out)
    except ValueError:
        pass
    else:
        raise AssertionError('Existing output was not rejected')
    # Sparse file proves the budget check without allocating a gigabyte.
    with (root / 'oversize.bin').open('wb') as file:
        file.truncate(951_000_000)
    subprocess.run(['git', 'add', 'oversize.bin'], cwd=root, check=True)
    # Test just the actual final budget by a small injected stat total would
    # bypass copying; instead exercise the real oversized artifact end to end.
    try:
        module.package(root, Path(tmp) / 'too-big')
    except AssertionError as error:
        assert 'safety budget' in str(error)
    else:
        raise AssertionError('Oversized publication was not rejected')
print('Package tests passed: exact round trip, script/attribute/URL exclusions, output guard, oversize rejection')

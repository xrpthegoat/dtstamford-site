#!/usr/bin/env python3
from datetime import datetime, timezone, timedelta
import json
from pathlib import Path
import re
import subprocess
import tempfile
from reviews import PAGES, SOURCE, render, validate, write_snapshot

root = Path(__file__).resolve().parents[2]
snapshot = json.loads((root / 'data/google-reviews.json').read_text())
for count, rating in [(99, 4.9), (97, 5.0)]:
    data = dict(snapshot, reviewCount=count, rating=rating)
    for name in PAGES:
        original = (root / name).read_text()
        result = render(name, original, data)
        assert f'{count} Google' in result, name
        assert not re.search(r'98(?: Google| Reviews|</strong> reviews| reviews\))', result), name
        assert f'{rating:.1f}' in result, name
        if rating == 4.9:
            assert not re.search(r'5\.0(?=★|[- ]star| stars| rating| across | ★ \(|</strong> average|</strong> ·|</span><span class="u">★)', result), name
        assert re.findall(r'(?:href|src)="[^"]+"', original) == re.findall(r'(?:href|src)="[^"]+"', result)
assert render('unrelated.html', '98 Google reviews', snapshot) == '98 Google reviews'
for change in [{'reviewCount': 0}, {'reviewCount': True}, {'rating': 6}, {'rating': 4.95}, {'source': 'https://example.com'}, {'checkedAt': 'bad'}]:
    try:
        validate(dict(snapshot, **change))
    except (ValueError, KeyError):
        pass
    else:
        raise AssertionError('Invalid input accepted: ' + str(change))
with tempfile.TemporaryDirectory() as tmp:
    target = Path(tmp)
    subprocess.run(['git', 'init', '-q', tmp], check=True)
    (target / 'data').mkdir()
    for name in PAGES:
        (target / name).write_text((root / name).read_text())
    now = datetime.now(timezone.utc)
    write_snapshot(target, 99, 4.9, now.isoformat())
    before = (target / 'data/google-reviews.json').read_bytes()
    try:
        write_snapshot(target, 97, 5.0, (now - timedelta(days=2)).isoformat())
    except ValueError:
        pass
    else:
        raise AssertionError('Stale input accepted')
    assert (target / 'data/google-reviews.json').read_bytes() == before
    write_snapshot(target, 97, 5.0, (now + timedelta(seconds=1)).isoformat())
    assert json.loads((target / 'data/google-reviews.json').read_text())['reviewCount'] == 97
    assert (target / '.git/review-snapshot.bak').read_bytes() == before
print('Reviews passed: real-page increases/decreases, rating changes, preserved links, invalid/stale inputs and atomic backup')

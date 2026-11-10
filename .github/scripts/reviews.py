#!/usr/bin/env python3
"""One verified Google aggregate, rendered into the site's existing review copy."""
import argparse
from datetime import datetime, timezone, timedelta
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

SOURCE = 'https://www.google.com/maps?cid=2560278430302490413'
PAGES = {'index.html', 'about.html', 'compare.html', 'top-realtors-stamford-ct.html', 'llms-full.txt'}


def validate(data):
    if data.get('source') != SOURCE:
        raise ValueError('Wrong Google business profile')
    count, rating = data.get('reviewCount'), data.get('rating')
    if type(count) is not int or not 1 <= count <= 1_000_000:
        raise ValueError('Review count must be a positive integer')
    if type(rating) not in (int, float) or not 1 <= rating <= 5 or round(rating, 1) != rating:
        raise ValueError('Rating must be between 1 and 5')
    checked = datetime.fromisoformat(data['checkedAt'].replace('Z', '+00:00'))
    if checked.tzinfo is None or checked > datetime.now(timezone.utc) + timedelta(minutes=5):
        raise ValueError('Invalid verification timestamp')
    return data


def render(name, text, data):
    validate(data)
    if name not in PAGES:
        return text
    count, rating = str(data['reviewCount']), f"{data['rating']:.1f}"
    text, hits = re.subn(r'\b\d+(?= Google(?:\s|$))', count, text)
    if not hits:
        raise ValueError('Expected Google review copy missing: ' + name)
    text = re.sub(r'\b\d+(?= Reviews \| John Restrepo)', count, text)
    text = re.sub(r'(?<=average across <strong>)\d+(?=</strong> reviews)', count, text)
    text = re.sub(r'(?<=★ \()\d+\+?(?= reviews\))', count, text)
    # Only rating-specific contexts; do not rewrite CSS numbers or property facts.
    text = re.sub(r'\b[1-5]\.\d(?=★|[- ]star| stars| rating| across | ★ \(|</strong> average|</strong> ·|</span><span class="u">★)', rating, text)
    text = re.sub(r'(?<=aria-label=")[1-5]\.\d(?= stars from)', rating, text)
    text = re.sub(r'(<span class="stars">)[★☆]+(</span>)',
                  lambda m: m[1] + '★' * round(data['rating']) + '☆' * (5 - round(data['rating'])) + m[2], text)
    if name == 'top-realtors-stamford-ct.html':
        date = datetime.fromisoformat(data['checkedAt'].replace('Z', '+00:00'))
        text = re.sub(r'(Google reviews \(verified )[^)]+',
                      lambda m: m[1] + date.strftime('%B ') + str(date.day) + date.strftime(', %Y'), text)
    if name == 'llms-full.txt':
        date = datetime.fromisoformat(data['checkedAt'].replace('Z', '+00:00'))
        text = re.sub(r'reviews \((?:as of|verified) [^)]+\)',
                      'reviews (verified ' + date.strftime('%Y-%m-%d') + ')', text)
    return text


def write_snapshot(root, count, rating, checked_at):
    data = validate({'reviewCount': count, 'rating': rating, 'checkedAt': checked_at, 'source': SOURCE})
    checked = datetime.fromisoformat(checked_at.replace('Z', '+00:00'))
    if datetime.now(timezone.utc) - checked > timedelta(hours=24):
        raise ValueError('A new snapshot requires a Google observation from the last 24 hours')
    path = root / 'data/google-reviews.json'
    git_dir = Path(subprocess.check_output(['git', 'rev-parse', '--absolute-git-dir'], cwd=root, text=True).strip())
    with (git_dir / 'review-snapshot.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        old = path.read_bytes() if path.exists() else None
        if old:
            previous = validate(json.loads(old))
            if checked < datetime.fromisoformat(previous['checkedAt'].replace('Z', '+00:00')):
                raise ValueError('Refusing an older verification')
        # Prove every consuming page can render before changing the data.
        for name in PAGES:
            render(name, (root / name).read_text(), data)
        if old:
            (git_dir / 'review-snapshot.bak').write_bytes(old)
        encoded = (json.dumps(data, indent=2) + '\n').encode()
        fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.reviews-')
        try:
            with os.fdopen(fd, 'wb') as file:
                file.write(encoded)
                file.flush()
                os.fsync(file.fileno())
            validate(json.loads(Path(temporary).read_bytes()))
            os.replace(temporary, path)
            directory = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            if Path(temporary).exists():
                Path(temporary).unlink()
    print(f"Verified snapshot saved: {rating:.1f}, {count} reviews, {checked_at}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--count', type=int, required=True)
    parser.add_argument('--rating', type=float, required=True)
    parser.add_argument('--checked-at', required=True)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    write_snapshot(args.root, args.count, args.rating, args.checked_at)

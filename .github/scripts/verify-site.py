#!/usr/bin/env python3
"""
verify-site.py — pre-deploy integrity guard for dtstamford.com (GitHub Pages).

Runs in CI BEFORE the Pages artifact is uploaded. If any internal link/asset points at a
file that doesn't exist, or a critical page is missing, or a sitemap URL is dead, it exits
NON-ZERO — which fails the workflow and SKIPS the deploy, so the last good live site stays
up instead of going 404. On a clean site it exits 0 and prints a one-line summary.

Deliberately conservative (must never false-positive and block the daily Journal push):
only genuinely-missing LOCAL targets fail. External URLs, mailto/tel/sms/data/js, and pure
#anchors are ignored. Case-sensitive on purpose — GitHub Pages is, macOS isn't.

Run locally the same way CI does, from the site root:  python3 .github/scripts/verify-site.py
"""
import os, re, sys, collections

ROOT = os.getcwd()
CRITICAL = ["index.html", "404.html", "sitemap.xml", "contact.html", "blog.html", "robots.txt"]

def disk_files():
    out = set()
    for dp, _, fs in os.walk(ROOT):
        if os.sep + ".git" in dp:
            continue
        for f in fs:
            out.add(os.path.relpath(os.path.join(dp, f), ROOT))
    return out

DISK = disk_files()
HTMLS = sorted(p for p in DISK if p.endswith(".html"))
REF = re.compile(r'(?:href|src)\s*=\s*"([^"]+)"')
SKIP_SCHEME = re.compile(r'^(https?:|mailto:|tel:|sms:|data:|javascript:|//|#)', re.I)

def is_external_or_nonfile(u):
    if SKIP_SCHEME.match(u):
        # dtstamford.com absolute links ARE local — don't skip those
        return not re.match(r'^https?://(www\.)?dtstamford\.com', u, re.I)
    return False

def resolve(u, page):
    u = re.sub(r'^https?://(www\.)?dtstamford\.com', '', u, flags=re.I)
    u = u.split('#')[0].split('?')[0]
    if u in ('', '/'):            # site root → home page
        return ['index.html']
    is_dir = u.endswith('/')
    if u.startswith('/'):
        base = u.lstrip('/')
    else:
        d = os.path.dirname(page)
        base = os.path.normpath(os.path.join(d, u)) if d else os.path.normpath(u)
    if base in ('', '.', '/'):    # resolved back to root (e.g. "../" from a subdir)
        return ['index.html']
    # candidate real files this URL could legitimately be served by (GH Pages clean URLs)
    if is_dir:
        return [base.rstrip('/') + '/index.html', base.rstrip('/') + '.html']
    if '.' not in os.path.basename(base):
        return [base + '.html', base + '/index.html', base]
    return [base]

def main():
    broken = collections.defaultdict(list)   # target -> [pages linking it]
    checked = 0
    for page in HTMLS:
        txt = open(os.path.join(ROOT, page), encoding='utf-8', errors='replace').read()
        for u in REF.findall(txt):
            if is_external_or_nonfile(u):
                continue
            cands = resolve(u, page)
            if not cands:
                continue
            checked += 1
            if not any(c in DISK for c in cands):
                broken[cands[0]].append(page)

    # sitemap targets
    sm_missing = []
    if 'sitemap.xml' in DISK:
        for loc in re.findall(r'<loc>\s*([^<]+?)\s*</loc>', open(os.path.join(ROOT, 'sitemap.xml')).read()):
            cands = resolve(loc, 'sitemap.xml')
            if cands and not any(c in DISK for c in cands):
                sm_missing.append(loc)

    crit_missing = [c for c in CRITICAL if c not in DISK]

    problems = bool(broken or sm_missing or crit_missing)
    if not problems:
        print(f"✓ site integrity OK — {len(HTMLS)} pages, {checked} internal links/assets all resolve, "
              f"{'sitemap clean' if 'sitemap.xml' in DISK else 'no sitemap'}, all critical pages present.")
        return 0

    print("✗ SITE INTEGRITY FAILED — deploy blocked (live site left untouched):\n")
    if crit_missing:
        print("  Missing CRITICAL files:")
        for c in crit_missing:
            print(f"    - {c}")
    if broken:
        print(f"  Broken internal links/assets ({len(broken)} targets):")
        for tgt, pages in sorted(broken.items(), key=lambda x: -len(x[1]))[:50]:
            print(f"    - {tgt}  ({len(pages)}x, e.g. {pages[0]})")
    if sm_missing:
        print(f"  Sitemap URLs with no file ({len(sm_missing)}):")
        for m in sm_missing[:50]:
            print(f"    - {m}")
    print("\nFix the missing file(s) or the link(s), then push again.")
    return 1

if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Split the site into a light code bundle and remotely hosted media (Cloudflare R2; see README.md, "Deploying").

The page refers to its heavy files by the relative paths data/... and assets/... (about 1.1 GB). This script leaves the
sources as they are and writes a deployable copy of the code only (HTML, CSS, JS, vendor: about 4 MB) in which every
such reference points at a remote base URL (an S3 bucket or a CDN in front of it). Local development is unchanged:
serve website/home as before and everything is read from disk.

  build the bundle:   python3 tools/deploy.py --base https://media.example.com/v1
  and upload media:   ... --upload r2:ropedia-xperience-2/v1   (an rclone remote:path; data/ and assets/ go under it)
  check only:         ... --dry-run                                (print what would be rewritten, write nothing)
  Cloudflare Pages:   build command `python3 home/tools/deploy.py`, output directory `dist`, ASSET_BASE set in the
                      project's variables (the repository holds the code only; data/ and assets/ are not in it)

The media are uploaded with a one-year immutable cache header, so publish changed media under a new prefix (v2, ...)
and rebuild the bundle with the new --base. The bucket must allow cross-origin GET from the site (fetch, fonts and
WebGL textures need it).
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

HOME = Path(__file__).resolve().parent.parent
MEDIA = ('data', 'assets')                       # the folders that move to the bucket
CODE = ('*.html', '*.css', '*.js')               # top-level files that make the page
SKIP = {'engine_v0.js', 'full.html'}             # earlier versions, not part of the page
COPY = ('vendor',)                               # copied as is (three.js, Spark, the Draco decoder)

# a path that starts with data/ or assets/ right after a quote, a backtick or `url(`
REF = re.compile(r"""(?:(?<![\w/.\-])(['"`])|(\burl\())(?:\./)?(data|assets)/""")


def rewrite(text, base):
    return REF.subn(lambda m: f"{m.group(1) or m.group(2)}{base}/{m.group(3)}/", text)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--base', default=os.environ.get('ASSET_BASE'),
                    help='URL under which data/ and assets/ are served: https://... or a path on the site itself '
                         '(/media/v1); default: the ASSET_BASE environment variable (set it in the Cloudflare Pages project)')
    ap.add_argument('--out', default=str(HOME.parent / 'dist'), help='where to write the bundle (default: website/dist)')
    ap.add_argument('--upload', metavar='REMOTE:PATH', help='also sync data/ and assets/ there with rclone')
    ap.add_argument('--dry-run', action='store_true', help='report only; write and upload nothing')
    a = ap.parse_args()
    if not a.base:
        sys.exit('no media URL: pass --base or set ASSET_BASE')
    base = a.base.rstrip('/')
    if not re.match(r'(https?://|/[^/])', base):
        sys.exit('--base must be an http(s) URL or a path that starts with /')
    out = Path(a.out).resolve()
    if out == HOME or HOME in out.parents:
        sys.exit('--out must be outside website/home')

    files = sorted(f for pat in CODE for f in HOME.glob(pat) if f.name not in SKIP)
    if not a.dry_run:
        if out.exists():
            if any(out.iterdir()) and not (out / 'index.html').exists():
                sys.exit(f'{out} is not empty and does not look like an earlier bundle; not replacing it')
            shutil.rmtree(out)
        out.mkdir(parents=True)
        for d in COPY:
            shutil.copytree(HOME / d, out / d)
    total = 0
    for f in files:
        text, n = rewrite(f.read_text(encoding='utf-8'), base)
        total += n
        print(f'{f.name:14s} {n:3d} references')
        if not a.dry_run:
            (out / f.name).write_text(text, encoding='utf-8')
    if not a.dry_run:
        # the origin of the media, so the browser opens its connections while it parses the page (one for the plain
        # <img> requests, one for the cross-origin fetches and the font, which use a separate connection)
        origin = re.match(r'https?://[^/]+', base)
        if origin:                                   # (a path on the site itself needs no new connection)
            html = (out / 'index.html').read_text(encoding='utf-8')
            pre = f'<link rel="preconnect" href="{origin[0]}">\n<link rel="preconnect" href="{origin[0]}" crossorigin>\n'
            html = html.replace('<link rel="preload"', pre + '<link rel="preload"', 1)
            (out / 'index.html').write_text(html, encoding='utf-8')
        size = sum(p.stat().st_size for p in out.rglob('*') if p.is_file())
        print(f'{total} references -> {base}\nbundle: {out} ({size / 1e6:.1f} MB)')

    if a.upload:
        for d in MEDIA:
            cmd = ['rclone', 'sync', str(HOME / d), f"{a.upload.rstrip('/')}/{d}", '--transfers', '32', '--checkers', '32',
                   '--fast-list', '--header-upload', 'Cache-Control: public, max-age=31536000, immutable', '--stats-one-line',
                   '--stats', '15s', '-v' if a.dry_run else '--progress'] + (['--dry-run'] if a.dry_run else [])
            print(' '.join(cmd))
            subprocess.run(cmd, check=True)


if __name__ == '__main__':
    main()

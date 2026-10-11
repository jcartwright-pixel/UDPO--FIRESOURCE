#!/usr/bin/env python3
"""Makes every app icon size from one square picture.

To use a different icon: replace public/img/app-icon/icon-source.png with a square PNG
(at least 512x512) and icon-source-maskable.png with the same picture shrunk to the middle 80%
on a filled background (Android trims the corners into a circle or rounded square), then run:

    python3 tools/make-icons.py

and commit the files it writes. Needs Pillow (pip install pillow).
The current icon is option A (Joe, 2026-10-10): the Q check from the approved United Dairy logo
in a white circle on United Dairy blue, over a white band with the plant and the truck.
"""
from pathlib import Path
from PIL import Image

ICONS = Path(__file__).resolve().parent.parent / 'public' / 'img' / 'app-icon'
src = Image.open(ICONS / 'icon-source.png').convert('RGBA')
mask = Image.open(ICONS / 'icon-source-maskable.png').convert('RGBA')
if src.width != src.height or mask.width != mask.height:
    raise SystemExit('the icon pictures must be square')

def size(n, pic=src):
    return pic.resize((n, n), Image.LANCZOS)

for n in (512, 192):
    size(n).save(ICONS / f'icon-{n}.png', optimize=True)
    size(n, mask).save(ICONS / f'icon-maskable-{n}.png', optimize=True)
size(180).convert('RGB').save(ICONS / 'apple-touch-icon.png', optimize=True)
size(32).save(ICONS / 'favicon-32.png', optimize=True)
size(48).save(ICONS.parent.parent / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
print('Wrote icon-512, icon-192, icon-maskable-512, icon-maskable-192, apple-touch-icon, favicon-32 and favicon.ico')

#!/usr/bin/env python3
"""Makes a home-screen icon for each station app (Joe, 2026-10-13: every station is its own app with its own icon).

Each icon is the United Dairy app icon (option A: the Q check in a white circle on United Dairy blue) with the white
band showing that station's picture from Joe's approved icon library (public/img/library) instead of the plant and
truck. Writes public/img/app-icon/<station>/icon-192.png, icon-512.png, icon-maskable-192.png, icon-maskable-512.png
and apple-touch-icon.png. Run from the repository folder after changing a picture, and commit what it writes:

    python3 tools/make-station-icons.py                  (every station)
    python3 tools/make-station-icons.py plant-managers   (only the ones named)

Needs Pillow (pip install pillow). UD Routes (drivers' phones) keeps the United Dairy app icon itself.
"""
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parent.parent / 'public' / 'img'
STATIONS = {
    'plant-station': ['plant-building-v1-560.webp'],
    'garage-station': ['maintenance-tractor-v1-560.webp', 'maintenance-trailer-v1-560.webp'],
    'driver-station': ['distribution-truck-v1-560.webp'],
    # Joe 10/18: the Plant Managers app (the managers' walkthrough): the yard, the cooler temperatures and production.
    'plant-managers': ['yard-checks.webp', 'temperatures.webp', 'production.webp'],
}
BAND = (46, 310, 466, 449)       # the white band of icon-source.png (512 x 512), above its yellow line
PIC = (68, 322, 444, 443)        # where the pictures go

def trim(im):
    """Cuts the white edges off a library picture."""
    rgb = im.convert('RGB')
    bg = Image.new('RGB', rgb.size, (255, 255, 255))
    box = ImageChops.difference(rgb, bg).point(lambda v: 255 if v > 12 else 0).getbbox()
    return im.crop(box) if box else im

def band_picture(files):
    pics = [trim(Image.open(ROOT / 'library' / f).convert('RGBA')) for f in files]
    w, h = PIC[2] - PIC[0], PIC[3] - PIC[1]
    gap = 10
    # Same height for every picture, side by side, shrunk to fit the band.
    scaled = [p.resize((max(1, round(p.width * h / p.height)), h), Image.LANCZOS) for p in pics]
    total = sum(p.width for p in scaled) + gap * (len(scaled) - 1)
    k = min(1, w / total)
    scaled = [p.resize((max(1, round(p.width * k)), max(1, round(p.height * k))), Image.LANCZOS) for p in scaled]
    total = sum(p.width for p in scaled) + round(gap * k) * (len(scaled) - 1)
    out = Image.new('RGBA', (w, h), (255, 255, 255, 0))
    x = (w - total) // 2
    for p in scaled:
        out.paste(p, (x, h - p.height - (h - p.height) // 2), p)
        x += p.width + round(gap * k)
    return out

# The source pictures live in tools/icon-source, not in public/, so they are not uploaded to the site (review item 79, Joe 10/13).
SOURCE = Path(__file__).resolve().parent / 'icon-source'
base = Image.open(SOURCE / 'icon-source.png').convert('RGBA')
base_mask = Image.open(SOURCE / 'icon-source-maskable.png').convert('RGBA')
for name, files in STATIONS.items():
    if sys.argv[1:] and name not in sys.argv[1:]:
        continue
    icon = base.copy()
    ImageDraw.Draw(icon).rounded_rectangle(BAND, radius=26, fill=(255, 255, 255, 255))
    icon.alpha_composite(band_picture(files), (PIC[0], PIC[1]))
    # Maskable: icon-source-maskable.png is the same icon in the middle 80%; only its band is swapped.
    mask = base_mask.copy()
    cut = (40, 300, 472, 462)
    piece = icon.crop(cut)
    piece = piece.resize((round(piece.width * 0.8), round(piece.height * 0.8)), Image.LANCZOS)
    mask.alpha_composite(piece, (round(51.2 + cut[0] * 0.8), round(51.2 + cut[1] * 0.8)))
    out = ROOT / 'app-icon' / name
    out.mkdir(exist_ok=True)
    for n in (512, 192):
        icon.resize((n, n), Image.LANCZOS).save(out / f'icon-{n}.png', optimize=True)
        mask.resize((n, n), Image.LANCZOS).save(out / f'icon-maskable-{n}.png', optimize=True)
    icon.resize((180, 180), Image.LANCZOS).convert('RGB').save(out / 'apple-touch-icon.png', optimize=True)
    print('Wrote', out)

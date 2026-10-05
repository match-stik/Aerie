#!/usr/bin/env python3
# Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
"""Cut the house deck out of its generated images.

The generator paints a card and leaves backing around it, and it leaves a
different amount every time -- three pixels on one card, thirty on another --
so there is no single crop that works twice. It also rounds each card's
corners by eye: measured across the court, the radii ran 50 to 63 pixels.

So each card is found on its own (the cream page is the card, the black
outside it is bleed), cut to its own edge, and then every card is given the
SAME corner. Output is RGBA PNG, so the corners are actually cut rather than
painted over.

  ./cut-cards.py --all                 re-cut every card in the manifest
  ./cut-cards.py --all --width 860     ...at a different canvas
  ./cut-cards.py src.jpg out.png       one card

THE CANVAS IS A JUDGMENT CALL, not a constant. The numbered cards sit at
about 0.70 and the court at about 0.66, roughly six percent apart, and a deck
has to be one size -- so somebody's cards move. The default puts the squeeze
on the numbered cards: five percent across a field of pips is invisible, and
the same squeeze on a face is not.
"""
import argparse
import json
import os
import sys

from PIL import Image, ImageDraw

CARDS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "cards")
MANIFEST = "cards.json"

WIDTH, HEIGHT, RADIUS = 840, 1260, 56
SUPERSAMPLE = 4  # the mask is drawn big and shrunk, which is what antialiases it
INSET = 2        # JPEG leaves a dark fringe on the cut line; step inside it
BRIGHT = 140     # anything above this is the cream page rather than bleed


def card_rect(im):
    """Find the card inside its bleed. Scans bands rather than single lines so
    one blown-out pixel in the artwork cannot move an edge."""
    g = im.convert("L")
    w, h = g.size

    def first(indices, get):
        for i in indices:
            if get(i) > BRIGHT:
                return i
        return None

    rows = range(h // 2 - 40, h // 2 + 40, 5)
    cols = range(w // 2 - 40, w // 2 + 40, 5)
    left = min(v for v in (first(range(w), lambda x: g.getpixel((x, y))) for y in rows) if v is not None)
    right = max(v for v in (first(range(w - 1, -1, -1), lambda x: g.getpixel((x, y))) for y in rows) if v is not None)
    top = min(v for v in (first(range(h), lambda y: g.getpixel((x, y))) for x in cols) if v is not None)
    bottom = max(v for v in (first(range(h - 1, -1, -1), lambda y: g.getpixel((x, y))) for x in cols) if v is not None)
    return left, top, right, bottom


def corner_mask(width, height, radius):
    big = Image.new("L", (width * SUPERSAMPLE, height * SUPERSAMPLE), 0)
    ImageDraw.Draw(big).rounded_rectangle(
        [0, 0, width * SUPERSAMPLE - 1, height * SUPERSAMPLE - 1],
        radius=radius * SUPERSAMPLE, fill=255)
    return big.resize((width, height), Image.LANCZOS)


def cut(src, dest, mask, width, height):
    im = Image.open(src).convert("RGB")
    left, top, right, bottom = card_rect(im)
    card = im.crop((left + INSET, top + INSET, right + 1 - INSET, bottom + 1 - INSET))
    out = card.resize((width, height), Image.LANCZOS).convert("RGBA")
    out.putalpha(mask)
    out.save(dest)
    # How far the card had to move to reach the shared canvas. Worth printing:
    # it is the only thing the cut costs, and it is invisible until you measure.
    skew = ((width / height) / (card.width / card.height) - 1) * 100
    return card.size, skew


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src", nargs="?")
    ap.add_argument("dest", nargs="?")
    ap.add_argument("--all", action="store_true", help="re-cut every card in the manifest")
    ap.add_argument("--width", type=int, default=WIDTH)
    ap.add_argument("--height", type=int, default=HEIGHT)
    ap.add_argument("--radius", type=int, default=RADIUS)
    ap.add_argument("--sources", default=None, help="directory holding the source images")
    args = ap.parse_args()

    mask = corner_mask(args.width, args.height, args.radius)

    if args.all:
        path = os.path.join(CARDS_DIR, MANIFEST)
        manifest = json.load(open(path))
        srcdir = args.sources or manifest.get("sourceDir")
        if not srcdir or not os.path.isdir(srcdir):
            sys.exit(f"source directory not found: {srcdir!r} (pass --sources)")
        worst = 0.0
        for card in manifest["cards"]:
            src = os.path.join(srcdir, card["source"])
            size, skew = cut(src, os.path.join(CARDS_DIR, card["file"]), mask, args.width, args.height)
            card["cropSize"] = list(size)
            card["widthChangePct"] = round(skew, 2)
            worst = max(worst, abs(skew))
        manifest["size"] = [args.width, args.height]
        manifest["cornerRadius"] = args.radius
        json.dump(manifest, open(path, "w"), indent=1)
        print(f"re-cut {len(manifest['cards'])} cards at {args.width}x{args.height} r{args.radius}"
              f" (largest width change {worst:.1f}%)")
        return

    if not (args.src and args.dest):
        ap.error("give a source and a destination, or --all")
    size, skew = cut(args.src, args.dest, mask, args.width, args.height)
    print(f"{args.dest}  crop {size[0]}x{size[1]} -> {args.width}x{args.height}  width change {skew:+.1f}%")


if __name__ == "__main__":
    main()

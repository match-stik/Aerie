#!/usr/bin/env python3
# Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
"""Bring every card in the deck onto one paper.

The cards were generated in batches over an evening and the page colour drifted
between them -- some diamonds came out bluer, the whole court came out dimmer
than the numbered cards. Side by side in a grid that reads as some cards being
whiter than others, which is what a deck must never look like.

Each card's page is measured (the modal bright colour, so the pips and the art
cannot drag it), and each is shifted onto the deck's own median stock. The
correction is applied at full strength AT the page level and ramps to nothing
in the shadows, so ink, pips, gems and every dark inch of the artwork stay
exactly where they are -- a flat tint would drag the reds.

Cards already on the median do not move at all.

  ./normalize-stock.py            measure and report, change nothing
  ./normalize-stock.py --apply    write the corrected cards back

Run it AFTER cut-cards.py: a re-cut restores the originals, so a re-cut wants
a re-normalize behind it.
"""
import argparse
import json
import os
from collections import Counter

from PIL import Image

CARDS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "cards")
FLOOR = 120  # below this the artwork is left completely alone


def page_colour(im):
    """The card's paper: the most common bright colour anywhere on it."""
    small = im.convert("RGB").resize((210, 315))
    px = [p for p in small.get_flattened_data() if min(p) > 140]
    if len(px) < 300:
        return None
    return Counter((p[0] // 2 * 2, p[1] // 2 * 2, p[2] // 2 * 2) for p in px).most_common(1)[0][0]


def shift_to(im, target):
    current = page_colour(im)
    if current is None:
        return None, None, None
    delta = [target[i] - current[i] for i in range(3)]
    if max(abs(x) for x in delta) < 2:
        return im, current, delta
    src = im.convert("RGBA")
    alpha = src.getchannel("A")
    channels = list(src.convert("RGB").split())
    for i, channel in enumerate(channels):
        span = max(20, current[i] - FLOOR)
        table = [max(0, min(255, round(v + delta[i] * max(0.0, min(1.0, (v - FLOOR) / span)))))
                 for v in range(256)]
        channels[i] = channel.point(table)
    out = Image.merge("RGB", channels).convert("RGBA")
    out.putalpha(alpha)
    return out, current, delta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write the corrected cards back")
    ap.add_argument("--target", default=None, help="R,G,B to use instead of the deck median")
    args = ap.parse_args()

    manifest = json.load(open(os.path.join(CARDS_DIR, MANIFEST := "cards.json")))
    faces = [c for c in manifest["cards"] if c["rank"] != "back"]

    measured = {}
    for card in faces:
        im = Image.open(os.path.join(CARDS_DIR, card["file"]))
        measured[card["file"]] = page_colour(im)

    if args.target:
        target = tuple(int(v) for v in args.target.split(","))
    else:
        values = [v for v in measured.values() if v]
        target = tuple(sorted(v[i] for v in values)[len(values) // 2] for i in range(3))
    print(f"target stock {target}  ({'given' if args.target else 'deck median'})")

    moved = 0
    for card in faces:
        path = os.path.join(CARDS_DIR, card["file"])
        out, current, delta = shift_to(Image.open(path), target)
        if out is None:
            print(f"  {card['file']:20s} no readable page, skipped")
            continue
        if max(abs(x) for x in delta) >= 2:
            moved += 1
            if args.apply:
                out.save(path)
        print(f"  {card['file']:20s} {current} {'->' if max(abs(x) for x in delta) >= 2 else '=='} "
              f"{tuple(delta)}")
    manifest["stock"] = list(target)
    if args.apply:
        json.dump(manifest, open(os.path.join(CARDS_DIR, MANIFEST), "w"), indent=1)
    print(f"\n{moved} of {len(faces)} cards {'moved' if args.apply else 'would move'}"
          f"{'' if args.apply else '  (nothing written — pass --apply)'}")


if __name__ == "__main__":
    main()

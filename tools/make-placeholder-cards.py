#!/usr/bin/env python3
# Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
"""
Draw a plain placeholder deck so the Card Room works in a tree that does not
have her cards in it.

Her deck is fifty-two cards she drew plus a back. It lives in
data/cards, which is gitignored, and it is HELD from the public kit on purpose
— the games we made for us do not travel. Which left the Card Room shipping as
code that cannot draw a single card in a fresh clone.

So this draws a deck instead of borrowing one. Nothing here is cropped from a
reference image: the pips and the corner marks are drawn from coordinates, and
the only outside asset is a system font. A public repo should not carry art
whose provenance nobody can name.

Same geometry as hers so nothing downstream has to care which deck it got:
840x1260 RGBA, 56px corner radius, named <suit>-<rank>.png with back.png beside
them and a cards.json manifest in the same shape.

    python3 tools/make-placeholder-cards.py [--out packages/backend/assets/cards]
"""
import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 840, 1260
RADIUS = 56
MARGIN = 46

SUITS = ["spades", "clubs", "diamonds", "hearts"]
RANKS = ["ace", "2", "3", "4", "5", "6", "7", "8", "9", "10", "jack", "queen", "king"]
RED = (196, 30, 42, 255)
BLACK = (24, 24, 28, 255)
PAPER = (252, 251, 248, 255)
EDGE = (222, 219, 212, 255)

FONT_BOLD = "/usr/share/fonts/truetype/lato/Lato-Bold.ttf"
FONT_BLACK = "/usr/share/fonts/truetype/lato/Lato-Heavy.ttf"

RANK_LABEL = {"ace": "A", "jack": "J", "queen": "Q", "king": "K"}

# Pip positions as fractions of the inner face, in the standard arrangement.
# A pip below the halfway line is drawn upside down, the way a real card does it.
PIP_LAYOUT = {
    "2": [(0.5, 0.06), (0.5, 0.94)],
    "3": [(0.5, 0.06), (0.5, 0.5), (0.5, 0.94)],
    "4": [(0.24, 0.06), (0.76, 0.06), (0.24, 0.94), (0.76, 0.94)],
    "5": [(0.24, 0.06), (0.76, 0.06), (0.5, 0.5), (0.24, 0.94), (0.76, 0.94)],
    "6": [(0.24, 0.06), (0.76, 0.06), (0.24, 0.5), (0.76, 0.5), (0.24, 0.94), (0.76, 0.94)],
    "7": [(0.24, 0.06), (0.76, 0.06), (0.5, 0.28), (0.24, 0.5), (0.76, 0.5),
          (0.24, 0.94), (0.76, 0.94)],
    "8": [(0.24, 0.06), (0.76, 0.06), (0.5, 0.28), (0.24, 0.5), (0.76, 0.5),
          (0.5, 0.72), (0.24, 0.94), (0.76, 0.94)],
    "9": [(0.24, 0.06), (0.76, 0.06), (0.24, 0.35), (0.76, 0.35), (0.5, 0.5),
          (0.24, 0.65), (0.76, 0.65), (0.24, 0.94), (0.76, 0.94)],
    "10": [(0.24, 0.06), (0.76, 0.06), (0.5, 0.205), (0.24, 0.35), (0.76, 0.35),
           (0.24, 0.65), (0.76, 0.65), (0.5, 0.795), (0.24, 0.94), (0.76, 0.94)],
}


def pip(size: int, suit: str, color) -> Image.Image:
    """One suit mark, drawn large and downsampled so the curves stay clean."""
    ss = 4
    s = size * ss
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if suit == "hearts":
        d.polygon([(s * 0.5, s * 0.95), (s * 0.03, s * 0.42), (s * 0.97, s * 0.42)], fill=color)
        d.ellipse([0, s * 0.06, s * 0.54, s * 0.60], fill=color)
        d.ellipse([s * 0.46, s * 0.06, s, s * 0.60], fill=color)
    elif suit == "diamonds":
        d.polygon([(s * 0.5, 0), (s * 0.95, s * 0.5), (s * 0.5, s), (s * 0.05, s * 0.5)], fill=color)
    elif suit == "spades":
        d.polygon([(s * 0.5, s * 0.04), (s * 0.03, s * 0.58), (s * 0.97, s * 0.58)], fill=color)
        d.ellipse([0, s * 0.40, s * 0.54, s * 0.94], fill=color)
        d.ellipse([s * 0.46, s * 0.40, s, s * 0.94], fill=color)
        d.polygon([(s * 0.5, s * 0.55), (s * 0.30, s), (s * 0.70, s)], fill=color)
    else:  # clubs
        r = s * 0.28
        d.ellipse([s * 0.5 - r, s * 0.02, s * 0.5 + r, s * 0.02 + 2 * r], fill=color)
        d.ellipse([s * 0.02, s * 0.36, s * 0.02 + 2 * r, s * 0.36 + 2 * r], fill=color)
        d.ellipse([s * 0.98 - 2 * r, s * 0.36, s * 0.98, s * 0.36 + 2 * r], fill=color)
        d.polygon([(s * 0.5, s * 0.52), (s * 0.30, s), (s * 0.70, s)], fill=color)
    return img.resize((size, size), Image.LANCZOS)


def blank_face() -> Image.Image:
    card = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)
    d.rounded_rectangle([0, 0, WIDTH - 1, HEIGHT - 1], RADIUS, fill=PAPER, outline=EDGE, width=3)
    return card


def draw_corner(card: Image.Image, suit: str, rank: str, color) -> None:
    """Rank over a small pip, top-left, and the same rotated 180 at bottom-right."""
    label = RANK_LABEL.get(rank, rank)
    corner = Image.new("RGBA", (150, 250), (0, 0, 0, 0))
    d = ImageDraw.Draw(corner)
    font = ImageFont.truetype(FONT_BLACK, 130 if len(label) == 1 else 100)
    box = d.textbbox((0, 0), label, font=font)
    d.text(((150 - (box[2] - box[0])) / 2 - box[0], 0), label, font=font, fill=color)
    mark = pip(84, suit, color)
    corner.alpha_composite(mark, (33, 150))
    card.alpha_composite(corner, (MARGIN, MARGIN))
    card.alpha_composite(corner.rotate(180, expand=True), (WIDTH - MARGIN - 150, HEIGHT - MARGIN - 250))


def draw_face(suit: str, rank: str) -> Image.Image:
    color = RED if suit in ("hearts", "diamonds") else BLACK
    card = blank_face()
    draw_corner(card, suit, rank, color)

    inner = (236, 300, WIDTH - 236, HEIGHT - 300)
    iw, ih = inner[2] - inner[0], inner[3] - inner[1]

    if rank == "ace":
        mark = pip(300, suit, color)
        card.alpha_composite(mark, (WIDTH // 2 - 150, HEIGHT // 2 - 150))
    elif rank in PIP_LAYOUT:
        size = 118
        for fx, fy in PIP_LAYOUT[rank]:
            mark = pip(size, suit, color)
            if fy > 0.5:
                mark = mark.rotate(180)
            card.alpha_composite(mark, (int(inner[0] + fx * iw - size / 2), int(inner[1] + fy * ih - size / 2)))
    else:
        # Court cards get their letter and one pip. A placeholder should look
        # like a placeholder rather than pretend to be a portrait.
        d = ImageDraw.Draw(card)
        font = ImageFont.truetype(FONT_BLACK, 380)
        label = RANK_LABEL[rank]
        box = d.textbbox((0, 0), label, font=font)
        d.text((WIDTH / 2 - (box[2] - box[0]) / 2 - box[0], HEIGHT / 2 - (box[3] - box[1]) / 2 - box[1] - 60),
               label, font=font, fill=color)
        mark = pip(150, suit, color)
        card.alpha_composite(mark, (WIDTH // 2 - 75, HEIGHT // 2 + 190))
    return card


def draw_back() -> Image.Image:
    card = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)
    d.rounded_rectangle([0, 0, WIDTH - 1, HEIGHT - 1], RADIUS, fill=(31, 58, 95, 255), outline=EDGE, width=3)
    d.rounded_rectangle([34, 34, WIDTH - 35, HEIGHT - 35], RADIUS - 20, outline=(242, 240, 235, 255), width=6)
    step = 70
    for x in range(-HEIGHT, WIDTH + HEIGHT, step):
        d.line([(x, 34), (x + HEIGHT, HEIGHT - 34)], fill=(58, 92, 138, 255), width=5)
        d.line([(x, HEIGHT - 34), (x + HEIGHT, 34)], fill=(58, 92, 138, 255), width=5)
    inside = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    ImageDraw.Draw(inside).rounded_rectangle([40, 40, WIDTH - 41, HEIGHT - 41], RADIUS - 24, fill=(255, 255, 255, 255))
    card = Image.composite(card, Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0)), card.split()[3])
    trimmed = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    trimmed.paste(card, (0, 0), inside.split()[3])
    frame = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    fd = ImageDraw.Draw(frame)
    fd.rounded_rectangle([0, 0, WIDTH - 1, HEIGHT - 1], RADIUS, fill=(31, 58, 95, 255), outline=EDGE, width=3)
    frame.alpha_composite(trimmed)
    fd = ImageDraw.Draw(frame)
    fd.rounded_rectangle([34, 34, WIDTH - 35, HEIGHT - 35], RADIUS - 20, outline=(242, 240, 235, 255), width=6)
    return frame


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="packages/backend/assets/cards")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    cards = []
    for suit in SUITS:
        for rank in RANKS:
            name = f"{suit}-{rank}.png"
            draw_face(suit, rank).save(out / name, optimize=True)
            cards.append({"suit": suit, "rank": rank, "file": name})
    draw_back().save(out / "back.png", optimize=True)

    manifest = {
        "size": [WIDTH, HEIGHT],
        "cornerRadius": RADIUS,
        "format": "png-rgba",
        "count": len(cards) + 1,
        "placeholder": True,
        "note": "Drawn by tools/make-placeholder-cards.py. Not her deck — a plain "
                "one so the Card Room can draw in a tree that does not have hers.",
        "cards": cards,
        "back": "back.png",
    }
    (out / "cards.json").write_text(json.dumps(manifest, indent=1))
    total = sum(p.stat().st_size for p in out.iterdir())
    print(f"{len(cards)} cards + back -> {out}  ({total/1024:.0f} KB total)")


if __name__ == "__main__":
    main()

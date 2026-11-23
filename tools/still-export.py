#!/usr/bin/env python3
# Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
"""Export one still image to a size budget without wrecking it.

Transparency-preserving, and deliberately pessimism-last: fit the pixel
dimensions, save at full colour, and only start reducing colours if the file is
still over budget. Most images never reach the reduction ladder at all.

Needs nothing but Pillow.

A GIF can only keep a pixel or drop it, never half-show it, so its edge is cut
at half alpha, and it holds 256 colours at most (one of them is the clear one).

Usage:
    still-export.py <input> <output> [--format png|webp|gif] [--max-side N]
                    [--max-bytes N] [--quality N] [--no-reduce]

Prints one line of JSON describing what it actually did.
"""

import argparse
import io
import json
import sys

from PIL import Image

# Palette sizes to try, worst case last. Below 32 the edges of a cut-out start
# to band visibly, so that is the floor.
COLOR_LADDER = [256, 128, 64, 32]


def contain(image: Image.Image, max_side: int) -> Image.Image:
    if max_side <= 0:
        return image
    width, height = image.size
    if max(width, height) <= max_side:
        return image
    scale = max_side / max(width, height)
    return image.resize((max(1, round(width * scale)), max(1, round(height * scale))), Image.LANCZOS)


def pad_to_square(image: Image.Image, side: int) -> Image.Image:
    # Discord stickers want exactly side x side. Padding with transparency keeps
    # the subject's proportions instead of stretching it to fit.
    if side <= 0 or image.size == (side, side):
        return image
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(image.convert("RGBA"), ((side - image.width) // 2, (side - image.height) // 2))
    return canvas


def to_gif_palette(image: Image.Image, colors: int) -> Image.Image:
    # A GIF has one fully clear palette slot and no partial alpha. Everything at
    # least half visible keeps its own colour, everything below that becomes the
    # clear slot. The clear pixels are painted one flat colour before quantizing
    # so the hidden background does not spend palette entries.
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    clear = alpha.point(lambda a: 255 if a < 128 else 0)
    flat = Image.new("RGB", rgba.size, (0, 0, 0))
    flat.paste(rgba.convert("RGB"), mask=alpha.point(lambda a: 255 if a >= 128 else 0))
    slots = max(2, min(256, colors)) - 1
    try:
        # libimagequant picks a far better 255 than median cut does, which is
        # most of the difference between a GIF that looks grainy and one that
        # does not. Pillow is built without it in some installs.
        paletted = flat.quantize(colors=slots, method=Image.LIBIMAGEQUANT)
    except (ValueError, OSError):
        paletted = flat.quantize(colors=slots, method=Image.MEDIANCUT)
    palette = (paletted.getpalette() or [])[: slots * 3]
    palette += [0] * (768 - len(palette))
    paletted.putpalette(palette)
    paletted.paste(slots, mask=clear)
    paletted.info["transparency"] = slots
    return paletted


def encode(image: Image.Image, fmt: str, quality: int, colors: int = 256) -> bytes:
    buffer = io.BytesIO()
    if fmt == "gif":
        paletted = to_gif_palette(image, colors)
        paletted.save(buffer, "GIF", transparency=paletted.info["transparency"], optimize=True)
    elif fmt == "webp":
        # Lossless keeps a cut-out's hard alpha edge clean; quality here is the
        # compression effort, not a lossy dial.
        image.save(buffer, "WEBP", lossless=True, quality=quality, method=6)
    else:
        image.save(buffer, "PNG", optimize=True, compress_level=9)
    return buffer.getvalue()


def quantize_keeping_alpha(image: Image.Image, colors: int) -> Image.Image:
    # FASTOCTREE is the one PIL method that quantizes RGBA directly, so the
    # alpha channel survives as palette transparency instead of being dropped.
    return image.quantize(colors=colors, method=Image.FASTOCTREE)


def main() -> int:
    parser = argparse.ArgumentParser(description="Export a still to a size budget.")
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--format", choices=["png", "webp", "gif"], default="png")
    parser.add_argument("--max-side", type=int, default=0, help="Longest edge in px; 0 keeps the original.")
    parser.add_argument("--max-bytes", type=int, default=0, help="File-size budget; 0 means no budget.")
    parser.add_argument("--quality", type=int, default=90, help="WebP effort (ignored for PNG).")
    parser.add_argument("--no-reduce", action="store_true", help="Never reduce colours, even if over budget.")
    parser.add_argument("--pad-square", action="store_true",
                        help="Pad with transparency to exactly max-side x max-side (Discord stickers).")
    args = parser.parse_args()

    image = Image.open(args.input)
    image = image.convert("RGBA") if image.mode in ("RGBA", "LA", "P") else image.convert("RGB")
    image = contain(image, args.max_side)
    if args.pad_square:
        image = pad_to_square(image, args.max_side)

    data = encode(image, args.format, args.quality)
    colors = None

    if args.max_bytes and len(data) > args.max_bytes and not args.no_reduce:
        for candidate in COLOR_LADDER:
            if args.format == "gif":
                attempt = encode(image, "gif", args.quality, candidate)
            else:
                attempt = encode(quantize_keeping_alpha(image, candidate), args.format, args.quality)
            colors = candidate
            if len(attempt) <= args.max_bytes:
                data = attempt
                break
            data = attempt

    with open(args.output, "wb") as handle:
        handle.write(data)

    print(json.dumps({
        "bytes": len(data),
        "width": image.width,
        "height": image.height,
        "format": args.format,
        "colors": colors,
        "hasAlpha": image.mode in ("RGBA", "LA", "P"),
        "withinBudget": (not args.max_bytes) or len(data) <= args.max_bytes,
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())

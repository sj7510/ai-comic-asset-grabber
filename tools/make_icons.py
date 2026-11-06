# -*- coding: utf-8 -*-
"""Generate the extension icons (16/32/48/128) with Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "src" / "icons"


def gradient(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size))
    px = img.load()
    top = (139, 92, 246)      # #8B5CF6
    bottom = (67, 56, 202)    # #4338CA
    for y in range(size):
        for x in range(size):
            t = (x * 0.35 + y * 0.65) / max(size - 1, 1)
            px[x, y] = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return img


def make(size: int) -> Image.Image:
    s = size / 128.0
    base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    grad = gradient(size).convert("RGBA")

    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=round(30 * s), fill=255)
    base.paste(grad, (0, 0), mask)

    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    # back card
    d.rounded_rectangle([round(22 * s), round(20 * s), round(86 * s), round(84 * s)],
                        radius=round(12 * s), fill=(199, 191, 255, 255))
    # front card
    d.rounded_rectangle([round(38 * s), round(36 * s), round(104 * s), round(104 * s)],
                        radius=round(14 * s), fill=(255, 255, 255, 255))
    if size >= 32:
        # photo glyph inside the front card
        d.ellipse([round(50 * s), round(48 * s), round(66 * s), round(64 * s)], fill=(109, 74, 255, 255))
        d.polygon([(round(44 * s), round(94 * s)), (round(62 * s), round(70 * s)),
                   (round(74 * s), round(84 * s)), (round(84 * s), round(74 * s)),
                   (round(98 * s), round(94 * s))], fill=(109, 74, 255, 255))
    else:
        d.rounded_rectangle([round(48 * s), round(50 * s), round(94 * s), round(92 * s)],
                            radius=round(8 * s), fill=(109, 74, 255, 255))

    base.alpha_composite(layer)
    return base


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        make(size).save(OUT / f"icon{size}.png", optimize=True)
        print("icon%d.png" % size)


if __name__ == "__main__":
    main()

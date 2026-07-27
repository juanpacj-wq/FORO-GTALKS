#!/usr/bin/env python
"""Hoja de contactos de todo lo extraido en design-extract/assets/, para poder
identificar de un vistazo que es cada foto y cada cluster vectorial.

Uso: .venv-design/Scripts/python scripts/contact-sheet.py
Salida: design-extract/contact-sheet.png
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "design-extract"
ASSETS = OUT / "assets"

CELL = 300
LABEL = 46
PAD = 12
COLS = 6


def load_font(size: int):
    for c in (r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\arial.ttf"):
        if Path(c).exists():
            return ImageFont.truetype(c, size)
    return ImageFont.load_default()


RASTER = {".png", ".jpg", ".jpeg", ".webp"}
files = sorted(
    (p for p in ASSETS.iterdir() if p.suffix.lower() in RASTER),
    key=lambda p: (not p.name.startswith("img-"), p.name),
)
rows = (len(files) + COLS - 1) // COLS
W = COLS * (CELL + PAD) + PAD
H = rows * (CELL + LABEL + PAD) + PAD

sheet = Image.new("RGB", (W, H), "#D4D4D8")
draw = ImageDraw.Draw(sheet)
f_name = load_font(15)
f_dim = load_font(14)

for i, path in enumerate(files):
    r, c = divmod(i, COLS)
    x = PAD + c * (CELL + PAD)
    y = PAD + r * (CELL + LABEL + PAD)

    # tablero de ajedrez para ver la transparencia y los bordes blancos
    for bx in range(0, CELL, 20):
        for by in range(0, CELL, 20):
            if (bx // 20 + by // 20) % 2 == 0:
                draw.rectangle([x + bx, y + by, x + bx + 19, y + by + 19], fill="#FFFFFF")
            else:
                draw.rectangle([x + bx, y + by, x + bx + 19, y + by + 19], fill="#E7E7EA")

    im = Image.open(path).convert("RGBA")
    w0, h0 = im.size
    im.thumbnail((CELL - 8, CELL - 8), Image.LANCZOS)
    sheet.paste(im, (x + (CELL - im.width) // 2, y + (CELL - im.height) // 2), im)
    draw.rectangle([x, y, x + CELL, y + CELL], outline="#71717A")

    short = path.name.replace("img-", "").replace("vec-", "").rsplit(".", 1)[0]
    short = short.replace("2-arte-foro-gtalk-2026", "ARTE").replace(
        "invitacion-gtalk-2026", "GTALK"
    ).replace("invitacion-expertos", "EXPERTOS")
    kind = "FOTO" if path.name.startswith("img-") else "VEC"
    draw.text((x + 2, y + CELL + 4), f"[{kind}] {short}", font=f_name, fill="#18181B")
    draw.text((x + 2, y + CELL + 24), f"{w0}x{h0} px", font=f_dim, fill="#52525B")

sheet.save(OUT / "contact-sheet.png")
print(f"OK -> {OUT / 'contact-sheet.png'}  ({len(files)} piezas, {W}x{H})")

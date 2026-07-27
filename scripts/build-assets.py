#!/usr/bin/env python
"""Construye los assets definitivos de public/img/ a partir de lo extraido en
design-extract/. Fase 0.3 de docs/PLAN-REDISENO.md.

Depende de que scripts/extract-pdf-design.py se haya corrido antes.

Uso: .venv-design/Scripts/python scripts/build-assets.py
"""

from __future__ import annotations

import shutil
from pathlib import Path

import fitz
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
EXTRACT = ROOT / "design-extract"
IMG = ROOT / "public" / "img"

WEBP_QUALITY = 82

# Piezas de origen, por si hay que volver a mirarlas
PDF_GTALK = ROOT / "invitacion gtalk 2026.pdf"
PDF_EXPERTOS = ROOT / "invitación expertos.pdf"


# --------------------------------------------------------------- fotos -> webp

FOTOS = [
    # (archivo en design-extract/assets, nombre final, que es)
    ("img-invitacion-gtalk-2026-p1-00-8a23ce7e.jpeg", "hero-aerogeneradores.webp",
     "aerogeneradores + paneles solares con operario"),
    ("img-invitacion-expertos-p1-01-4bff0b6b.jpeg", "torre-transmision.webp",
     "torre de transmision al atardecer"),
    ("img-invitacion-expertos-p1-00-300cc8c2.jpeg", "fichas-conversacion.webp",
     "manos y fichas de madera de colores"),
]


def convertir_fotos() -> list[dict]:
    out = []
    for origen, destino, desc in FOTOS:
        src = EXTRACT / "assets" / origen
        im = Image.open(src).convert("RGB")
        im.save(IMG / destino, "WEBP", quality=WEBP_QUALITY, method=6)
        out.append(
            {
                "archivo": destino,
                "px": im.size,
                "kb_origen": src.stat().st_size / 1024,
                "kb_webp": (IMG / destino).stat().st_size / 1024,
                "desc": desc,
            }
        )
    return out


# ------------------------------------------------- paths del PDF -> SVG limpio


def items_to_d(items) -> str:
    """Convierte los items de un path de PyMuPDF en un atributo `d` de SVG."""
    d: list[str] = []
    cur = None

    def moveto_si_hace_falta(p):
        nonlocal cur
        if cur is None or abs(p.x - cur.x) > 1e-6 or abs(p.y - cur.y) > 1e-6:
            d.append(f"M{p.x:.2f} {p.y:.2f}")

    for it in items:
        op = it[0]
        if op == "l":
            p1, p2 = it[1], it[2]
            moveto_si_hace_falta(p1)
            d.append(f"L{p2.x:.2f} {p2.y:.2f}")
            cur = p2
        elif op == "c":
            p1, p2, p3, p4 = it[1], it[2], it[3], it[4]
            moveto_si_hace_falta(p1)
            d.append(f"C{p2.x:.2f} {p2.y:.2f} {p3.x:.2f} {p3.y:.2f} {p4.x:.2f} {p4.y:.2f}")
            cur = p4
        elif op == "re":
            r = it[1]
            d.append(f"M{r.x0:.2f} {r.y0:.2f}H{r.x1:.2f}V{r.y1:.2f}H{r.x0:.2f}Z")
            cur = None
        elif op == "qu":
            q = it[1]
            d.append(
                f"M{q.ul.x:.2f} {q.ul.y:.2f}L{q.ur.x:.2f} {q.ur.y:.2f}"
                f"L{q.lr.x:.2f} {q.lr.y:.2f}L{q.ll.x:.2f} {q.ll.y:.2f}Z"
            )
            cur = None
    return " ".join(d)


def hexf(color) -> str:
    return "#{:02X}{:02X}{:02X}".format(*(max(0, min(255, round(v * 255))) for v in color))


def paths_to_svg(page, rect: fitz.Rect, titulo: str, monocromo: str | None = None) -> str:
    """SVG minimo con solo los paths totalmente contenidos en `rect`.

    Contenidos, no intersecados: asi las bandas de fondo de la pieza (que son
    mucho mas grandes que el recorte) quedan fuera solas.
    """
    piezas = []
    for p in page.get_drawings():
        pr = p.get("rect")
        if not pr or not rect.contains(pr):
            continue
        d = items_to_d(p.get("items", []))
        if not d:
            continue
        if p.get("closePath"):
            d += " Z"
        attrs = [f'd="{d}"']
        if p.get("even_odd"):
            attrs.append('fill-rule="evenodd"')
        fill = p.get("fill")
        stroke = p.get("color")
        tipo = p.get("type", "")
        if monocromo:
            attrs.append('fill="currentColor"' if tipo in ("f", "fs") else 'fill="none"')
            if tipo in ("s", "fs"):
                attrs.append(f'stroke="currentColor" stroke-width="{p.get("width") or 1:.2f}"')
        else:
            attrs.append(f'fill="{hexf(fill)}"' if fill and tipo in ("f", "fs") else 'fill="none"')
            if stroke and tipo in ("s", "fs"):
                attrs.append(f'stroke="{hexf(stroke)}" stroke-width="{p.get("width") or 1:.2f}"')
        piezas.append("  <path " + " ".join(attrs) + " />")

    vb = f"{rect.x0:.2f} {rect.y0:.2f} {rect.width:.2f} {rect.height:.2f}"
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" role="img" '
        f'aria-label="{titulo}">\n' + "\n".join(piezas) + "\n</svg>\n"
    )


# ------------------------------------------- glifos de fuentes licenciadas -> SVG


class FuentePDF:
    """Una fuente incrustada, lista para dar contornos.

    Unifica los dos formatos que aparecen en estas piezas:

    - Urbanist va como TrueType dentro de un contenedor sfnt normal.
    - Bely Display y Museo Slab van como **CFF desnudo** (Type1C), que no es
      un sfnt: `TTFont` lo rechaza con «bad sfntVersion» y hay que leerlo con
      `cffLib`. Además son subconjuntos de 400–800 bytes, con solo los glifos
      que la pieza usa.
    """

    def __init__(self, glifos, unidad: float, cmap: dict | None):
        self.glifos = glifos
        # cuánto vale una unidad de la fuente en múltiplos del tamaño de texto
        self.unidad = unidad
        self.cmap = cmap

    def nombre_glifo(self, char: str) -> str | None:
        if self.cmap is not None:
            return self.cmap.get(ord(char))
        # En el CFF desnudo no hay cmap: se busca por nombre AGL.
        from fontTools.agl import AGL2UV

        for nombre, uv in AGL2UV.items():
            if uv == ord(char) and nombre in self.glifos:
                return nombre
        return char if char in self.glifos else None


def fuentes_incrustadas(doc, page) -> dict[str, FuentePDF]:
    import io
    import re

    from fontTools.cffLib import CFFFontSet
    from fontTools.ttLib import TTFont

    out: dict[str, FuentePDF] = {}
    for info in page.get_fonts(full=True):
        xref = info[0]
        try:
            nombre, ext, _tipo, buf = doc.extract_font(xref)
        except Exception:
            continue
        if not buf:
            continue
        limpio = re.sub(r"^[A-Z]{6}\+", "", nombre)
        try:
            if ext == "cff":
                cff = CFFFontSet()
                cff.decompile(io.BytesIO(buf), None)
                td = cff[cff.fontNames[0]]
                out[limpio] = FuentePDF(td.CharStrings, td.FontMatrix[0], None)
            else:
                ft = TTFont(io.BytesIO(buf))
                out[limpio] = FuentePDF(
                    ft.getGlyphSet(), 1 / ft["head"].unitsPerEm, ft.getBestCmap()
                )
        except Exception as e:
            print(f"  !! no se pudo leer la fuente {limpio}: {e}")
    return out


def spans_de_fuente(page, familia: str) -> list[dict]:
    """Spans de texto de una familia concreta, con sus caracteres y posiciones."""
    res = []
    for b in page.get_text("rawdict")["blocks"]:
        if b.get("type") != 0:
            continue
        for line in b["lines"]:
            for s in line["spans"]:
                if familia in s["font"]:
                    res.append(s)
    return res


def texto_a_svg(spans: list[dict], fuentes: dict, titulo: str, color: str) -> str | None:
    """Convierte texto en contornos SVG usando la fuente incrustada.

    Es la salida para el numeral «1» (Bely Display) y el wordmark «G-TALKS»
    (Museo Slab 900): las dos son licenciadas y no las tenemos, pero sí están
    incrustadas en el PDF, así que se sacan sus contornos y se usan como
    dibujo. Ni hace falta la fuente ni una sustituta aproximada.
    """
    import re

    from fontTools.pens.svgPathPen import SVGPathPen

    paths: list[str] = []
    x0 = y0 = float("inf")
    x1 = y1 = float("-inf")

    for s in spans:
        fuente = fuentes.get(re.sub(r"^[A-Z]{6}\+", "", s["font"]))
        if fuente is None:
            continue
        escala = s["size"] * fuente.unidad

        for ch in s["chars"]:
            nombre = fuente.nombre_glifo(ch["c"])
            if nombre is None or nombre not in fuente.glifos:
                continue
            pen = SVGPathPen(fuente.glifos)
            fuente.glifos[nombre].draw(pen)
            d = pen.getCommands()
            if not d:
                continue
            ox, oy = ch["origin"]
            paths.append(
                f'  <path transform="translate({ox:.2f} {oy:.2f}) '
                f'scale({escala:.6f} {-escala:.6f})" d="{d}" fill="{color}" />'
            )
            bx0, by0, bx1, by1 = ch["bbox"]
            x0, y0, x1, y1 = min(x0, bx0), min(y0, by0), max(x1, bx1), max(y1, by1)

    if not paths:
        return None

    pad = (x1 - x0) * 0.02
    vb = f"{x0 - pad:.2f} {y0 - pad:.2f} {x1 - x0 + 2 * pad:.2f} {y1 - y0 + 2 * pad:.2f}"
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" role="img" '
        f'aria-label="{titulo}">\n' + "\n".join(paths) + "\n</svg>\n"
    )


def construir_glifos() -> list[dict]:
    out = []
    doc = fitz.open(PDF_GTALK)
    page = doc[0]
    fuentes = fuentes_incrustadas(doc, page)

    objetivos = [
        # (familia, archivo, titulo accesible, color, filtro extra)
        ("BelyDisplay", "numeral-uno.svg", "1", "currentColor", None),
        ("MuseoSlab", "wordmark-g-talks.svg", "G-TALKS", "currentColor", lambda s: s["size"] > 20),
    ]
    for familia, archivo, titulo, color, filtro in objetivos:
        spans = spans_de_fuente(page, familia)
        if filtro:
            spans = [s for s in spans if filtro(s)]
        spans = spans[:1]  # una sola instancia: las demás son repeticiones
        svg = texto_a_svg(spans, fuentes, titulo, color)
        if not svg:
            print(f"  !! no se pudo extraer {archivo} ({familia})")
            continue
        (IMG / archivo).write_text(svg, encoding="utf-8")
        out.append(
            {
                "archivo": archivo,
                "familia": familia,
                "kb": (IMG / archivo).stat().st_size / 1024,
                "paths": svg.count("<path"),
            }
        )
    doc.close()
    return out


def cluster_por_tamano(page, w: float, h: float, tol: float = 1.5) -> fitz.Rect | None:
    """Localiza un cluster por su tamano en pt, que es estable entre piezas."""
    for c in page.cluster_drawings():
        if abs(c.width - w) < tol and abs(c.height - h) < tol:
            return c
    return None


def span_bbox(page, texto: str) -> fitz.Rect | None:
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 0:
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                if span["text"].strip() == texto:
                    return fitz.Rect(span["bbox"])
    return None


def construir_vectores() -> list[dict]:
    out = []
    doc = fitz.open(PDF_GTALK)
    page = doc[0]

    # Solo el logo Gecelca conserva sus colores de marca. Los demás salen en
    # `currentColor`: en las piezas el mismo símbolo aparece en navy, en blanco
    # y en azul Gecelca según el fondo, así que tiene que adaptarse al contexto.
    objetivos = [
        # (ancho, alto, archivo, titulo accesible, monocromo)
        (112.5, 46.2, "logo-gecelca.svg", "Gecelca", None),
        (61.9, 42.2, "icono-burbujas.svg", "G-TALKS", "currentColor"),
        (28.2, 28.2, "icono-calendario.svg", "Fecha", "currentColor"),
        (23.9, 28.7, "icono-lugar.svg", "Lugar", "currentColor"),
    ]
    for w, h, archivo, titulo, mono in objetivos:
        rect = cluster_por_tamano(page, w, h)
        if rect is None:
            print(f"  !! no se encontro el cluster {w}x{h} para {archivo}")
            continue
        svg = paths_to_svg(page, rect, titulo, monocromo=mono)
        (IMG / archivo).write_text(svg, encoding="utf-8")
        out.append(
            {
                "archivo": archivo,
                "rect_pt": f"{rect.width:.1f}x{rect.height:.1f}",
                "kb": (IMG / archivo).stat().st_size / 1024,
                "paths": svg.count("<path"),
            }
        )

    doc.close()
    return out


def recortar_fondo(src: Path, dest: Path, t0: int = 30, t1: int = 90) -> None:
    """Quita el plano de fondo por clave de color, con rampa de alfa."""
    from collections import Counter

    from PIL import ImageChops

    im = Image.open(src).convert("RGB")
    w, h = im.size
    px = im.load()
    borde: Counter = Counter()
    for x in range(0, w, max(1, w // 400)):
        borde[px[x, 0]] += 1
        borde[px[x, h - 1]] += 1
    for y in range(0, h, max(1, h // 400)):
        borde[px[0, y]] += 1
        borde[px[w - 1, y]] += 1
    bgcol = borde.most_common(1)[0][0]
    dif = ImageChops.difference(im, Image.new("RGB", (w, h), bgcol)).convert("L")
    alfa = dif.point(lambda v: 0 if v <= t0 else (255 if v >= t1 else int(255 * (v - t0) / (t1 - t0))))
    out = im.convert("RGBA")
    out.putalpha(alfa)
    out.save(dest)


def construir_favicon() -> None:
    """Favicon: el simbolo de burbujas de G-TALKS, en blanco sobre un cuadrado
    navy de esquinas redondeadas.

    Se reencuadra el icono en un lienzo cuadrado con margen porque el simbolo
    es apaisado (61.9x42.2 pt) y un favicon tiene que ser cuadrado. No se
    redibuja nada: se reusan los mismos paths, solo cambia el viewBox.
    """
    src = (IMG / "icono-burbujas.svg").read_text(encoding="utf-8")
    vb = src.split('viewBox="')[1].split('"')[0].split()
    x0, y0, w, h = (float(v) for v in vb)

    lado = max(w, h) * 1.42                      # margen alrededor del simbolo
    cx, cy = x0 + w / 2, y0 + h / 2
    nx, ny = cx - lado / 2, cy - lado / 2
    r = lado * 0.22                              # esquinas del cuadrado

    # los paths del icono, forzados a blanco (el origen va en currentColor)
    cuerpo = "\n".join(
        linea.replace('fill="currentColor"', 'fill="#FFFFFF"')
        for linea in src.splitlines()
        if linea.strip().startswith("<path")
    )

    favicon = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{nx:.2f} {ny:.2f} {lado:.2f} {lado:.2f}" '
        f'role="img" aria-label="G-TALKS">\n'
        f'  <rect x="{nx:.2f}" y="{ny:.2f}" width="{lado:.2f}" height="{lado:.2f}" '
        f'rx="{r:.2f}" fill="#1F335E" />\n'
        f"{cuerpo}\n</svg>\n"
    )
    (ROOT / "public" / "favicon.svg").write_text(favicon, encoding="utf-8")

    # PNG para apple-touch-icon, que no acepta SVG
    doc = fitz.open(stream=favicon.encode(), filetype="svg")
    pagina = doc[0]
    zoom = 180 / max(pagina.rect.width, pagina.rect.height)
    pagina.get_pixmap(matrix=fitz.Matrix(zoom, zoom)).save(ROOT / "public" / "apple-touch-icon.png")
    doc.close()
    print("\nFavicon:")
    for f in ("favicon.svg", "apple-touch-icon.png"):
        print(f"  {f:28} {(ROOT / 'public' / f).stat().st_size/1024:6.1f} KB")


def escribir_catalogo() -> None:
    """Emite `src/design/iconos.ts` con la proporción de cada símbolo.

    Hace falta porque los símbolos se pintan como máscara CSS para que hereden
    `currentColor`, y una máscara no aporta tamaño intrínseco: el componente
    fija el alto y necesita la proporción para deducir el ancho. Se genera
    aquí, desde el `viewBox` real, en vez de copiarla a mano.
    """
    nombres = [
        "numeral-uno",
        "wordmark-g-talks",
        "icono-burbujas",
        "icono-calendario",
        "icono-lugar",
    ]
    filas = []
    for n in nombres:
        ruta = IMG / f"{n}.svg"
        if not ruta.exists():
            continue
        vb = ruta.read_text(encoding="utf-8").split('viewBox="')[1].split('"')[0].split()
        w, h = float(vb[2]), float(vb[3])
        filas.append(f"  '{n}': {{ src: '/img/{n}.svg', ratio: {w / h:.4f} }},")

    destino = ROOT / "src" / "design" / "iconos.ts"
    destino.write_text(
        "// GENERADO por scripts/build-assets.py — no editar a mano.\n"
        "//\n"
        "// Proporción (ancho/alto) de cada símbolo monocromo, sacada de su viewBox.\n"
        "// `Icono.tsx` la necesita para deducir el ancho a partir del alto: los\n"
        "// símbolos se pintan como máscara CSS y una máscara no tiene tamaño propio.\n"
        "export const ICONOS = {\n" + "\n".join(filas) + "\n} as const\n\n"
        "export type IconoNombre = keyof typeof ICONOS\n",
        encoding="utf-8",
    )
    print(f"\nCatálogo: src/design/iconos.ts ({len(filas)} símbolos)")


def main() -> None:
    if not (EXTRACT / "tokens.json").exists():
        raise SystemExit("Falta design-extract/. Corre antes scripts/extract-pdf-design.py")
    IMG.mkdir(parents=True, exist_ok=True)

    print("Fotos -> WebP:")
    for f in convertir_fotos():
        print(f"  {f['archivo']:28} {f['px'][0]}x{f['px'][1]:<5} "
              f"{f['kb_origen']:6.1f} KB -> {f['kb_webp']:6.1f} KB   {f['desc']}")

    print("\nLogos e iconos:")
    for v in construir_vectores():
        print(f"  {v['archivo']:28} {v['rect_pt']:>12} pt  {v['kb']:6.1f} KB  paths={v['paths']}")

    print("\nGlifos de fuentes licenciadas -> contornos:")
    for g in construir_glifos():
        print(f"  {g['archivo']:28} {g['familia']:14} {g['kb']:6.1f} KB  paths={g['paths']}")

    construir_favicon()
    escribir_catalogo()

    total = sum(f.stat().st_size for f in IMG.rglob("*") if f.is_file())
    print(f"\npublic/img/: {total/1024:.1f} KB")


if __name__ == "__main__":
    main()

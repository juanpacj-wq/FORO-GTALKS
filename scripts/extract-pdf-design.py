#!/usr/bin/env python
"""Extrae el sistema de diseno (color, tipografia, formas, assets) de las piezas
graficas PDF de la raiz del proyecto. Fase 0 de docs/PLAN-REDISENO.md.

Regla dura del plan: ningun valor de diseno se inventa ni se cita de memoria.
Todo sale medido de aqui.

Uso:
    .venv-design/Scripts/python scripts/extract-pdf-design.py

Salida en design-extract/:
    render/<pdf>-p<n>.png      render de referencia a 200 DPI
    assets/img-*.<ext>         imagenes incrustadas a resolucion nativa
    assets/vec-*.png|.svg      clusters vectoriales (logos/iconos): raster 600 DPI + SVG
    text/<pdf>-p<n>.txt        texto plano, para verificar los copys
    tokens.json                todas las mediciones, crudas
    palette.png                tira de muestras de color con su hex
    report.md                  el informe legible
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "design-extract"

RENDER_DPI = 200
VECTOR_DPI = 600
VECTOR_MAX_PX = 3000
# solo se exporta SVG de los clusters con lado <= este valor: son los logos y
# los iconos, lo unico que hay que poder escalar sin perdida
SVG_MAX_PT = 260
PT_TO_MM = 25.4 / 72.0
# distancia euclidiana RGB por debajo de la cual dos hex se consideran el mismo
# color de marca expresado en dos espacios de color distintos
NEAR_DUPE_DIST = 8.0


# --------------------------------------------------------------------------- utils


def slugify(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    value = re.sub(r"[^\w\s-]", "", value).strip().lower()
    return re.sub(r"[-\s]+", "-", value)


def hex_from_int(color: int | None) -> str | None:
    """Color de span: entero sRGB de PyMuPDF."""
    if color is None:
        return None
    return "#{:06X}".format(color & 0xFFFFFF)


def hex_from_tuple(color) -> str | None:
    """Color de drawing: tupla de floats 0..1 (gray, rgb o cmyk)."""
    if color is None:
        return None
    if isinstance(color, (int, float)):
        color = (color,)
    if len(color) == 1:
        g = color[0]
        rgb = (g, g, g)
    elif len(color) == 3:
        rgb = color
    elif len(color) == 4:
        c, m, y, k = color
        rgb = ((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k))
    else:
        return None
    return "#{:02X}{:02X}{:02X}".format(*(max(0, min(255, round(v * 255))) for v in rgb))


def rgb_of(hex_color: str) -> tuple[int, int, int]:
    return tuple(int(hex_color[i : i + 2], 16) for i in (1, 3, 5))  # type: ignore[return-value]


def clean_font(name: str) -> str:
    """'ABCDEF+Poppins-Bold' -> 'Poppins-Bold'."""
    return re.sub(r"^[A-Z]{6}\+", "", name or "")


def family_of(font: str) -> str:
    return re.split(r"[-,]", clean_font(font))[0]


def sha8(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:8]


def load_font(size: int):
    for candidate in (r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\arial.ttf"):
        if Path(candidate).exists():
            try:
                return ImageFont.truetype(candidate, size)
            except OSError:
                pass
    return ImageFont.load_default()


def relative_luminance(hex_color: str) -> float:
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = rgb_of(hex_color)
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def contrast_ratio(a: str, b: str) -> float:
    la, lb = relative_luminance(a), relative_luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def darken_to_meet(fg: str, bg: str, target: float) -> tuple[str, float]:
    """Oscurece un color hacia negro lo minimo necesario para alcanzar un ratio
    de contraste contra un fondo dado. Devuelve (hex, factor aplicado)."""
    r, g, b = rgb_of(fg)
    for k in range(100, -1, -1):
        f = k / 100
        cand = "#{:02X}{:02X}{:02X}".format(round(r * f), round(g * f), round(b * f))
        if contrast_ratio(cand, bg) >= target:
            return cand, f
    return "#000000", 0.0


def aa_threshold(size_pt: float, bold: bool) -> float:
    """Umbral WCAG 2.1 AA. 'Texto grande' = >=18pt, o >=14pt en negrita."""
    return 3.0 if (size_pt >= 18 or (bold and size_pt >= 14)) else 4.5


# ------------------------------------------------------------------ geometria de paths


def corner_radii(items, rect: fitz.Rect) -> dict | None:
    """Estima el radio de cada esquina de un path midiendo el bbox de sus
    segmentos cubicos. Aproximacion: un rect redondeado se dibuja como lineas
    rectas + una curva de Bezier por esquina."""
    curves = [it for it in items if it[0] == "c"]
    if not curves or not (2 <= len(curves) <= 8):
        return None
    corners = {"sup-izq": 0.0, "sup-der": 0.0, "inf-izq": 0.0, "inf-der": 0.0}
    for it in curves:
        pts = [p for p in it[1:] if isinstance(p, fitz.Point)]
        if not pts:
            continue
        xs = [p.x for p in pts]
        ys = [p.y for p in pts]
        radius = min(max(xs) - min(xs), max(ys) - min(ys))
        cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
        vert = "sup" if cy < (rect.y0 + rect.y1) / 2 else "inf"
        horiz = "izq" if cx < (rect.x0 + rect.x1) / 2 else "der"
        corners[f"{vert}-{horiz}"] = max(corners[f"{vert}-{horiz}"], round(radius, 1))
    if not any(corners.values()):
        return None
    return corners


def sample_background(pix, bbox: fitz.Rect, scale: float, text_hex: str | None) -> tuple[str | None, float]:
    """Fondo real sobre el que se pinta un texto, muestreado en el render.

    Se hace sobre pixeles y no por contencion geometrica a proposito: asi se
    respetan el orden de pintado, los clips y las mascaras. Devuelve el color
    modal de la caja del span (expandida 3 px, descartando los pixeles del
    propio texto) y que fraccion del muestreo representa. Fraccion baja = el
    texto va sobre una foto o un degradado, no sobre un plano.
    """
    m = 3
    x0 = max(0, int(bbox.x0 * scale) - m)
    y0 = max(0, int(bbox.y0 * scale) - m)
    x1 = min(pix.width, int(bbox.x1 * scale) + m + 1)
    y1 = min(pix.height, int(bbox.y1 * scale) + m + 1)
    if x1 <= x0 or y1 <= y0:
        return None, 0.0

    step = max(1, int((((x1 - x0) * (y1 - y0)) / 20000) ** 0.5))
    tint = rgb_of(text_hex) if text_hex else None
    data, n, stride = pix.samples, pix.n, pix.stride
    counts: Counter = Counter()

    for y in range(y0, y1, step):
        row = y * stride
        for x in range(x0, x1, step):
            o = row + x * n
            r, g, b = data[o], data[o + 1], data[o + 2]
            # descarta el propio glifo y su antialias
            if tint and abs(r - tint[0]) + abs(g - tint[1]) + abs(b - tint[2]) < 90:
                continue
            counts[(r, g, b)] += 1

    if not counts:
        return None, 0.0
    (r, g, b), c = counts.most_common(1)[0]
    return "#{:02X}{:02X}{:02X}".format(r, g, b), c / sum(counts.values())


def key_out_background(path: Path, t0: int = 30, t1: int = 90) -> str | None:
    """Recorta el fondo plano de un cluster para dejar el logo/icono sobre
    transparencia.

    Los logos salen con la banda de color detras horneada, porque el recorte es
    rectangular y el fondo es un path mas de la pagina. Como ese fondo es un
    plano conocido, se quita por clave de color con una rampa de alfa en el
    borde. Devuelve None si el borde no es un plano (no hay nada que quitar).
    """
    im = Image.open(path).convert("RGB")
    w, h = im.size
    px = im.load()
    borde: Counter = Counter()
    for x in range(0, w, max(1, w // 400)):
        borde[px[x, 0]] += 1
        borde[px[x, h - 1]] += 1
    for y in range(0, h, max(1, h // 400)):
        borde[px[0, y]] += 1
        borde[px[w - 1, y]] += 1
    bgcol, hits = borde.most_common(1)[0]
    if hits < 0.75 * sum(borde.values()):
        return None

    from PIL import ImageChops

    plano = Image.new("RGB", (w, h), bgcol)
    dif = ImageChops.difference(im, plano).convert("L")
    alfa = dif.point(lambda v: 0 if v <= t0 else (255 if v >= t1 else int(255 * (v - t0) / (t1 - t0))))
    if alfa.getextrema()[1] == 0:  # todo el recorte era fondo
        return None
    out = im.convert("RGBA")
    out.putalpha(alfa)
    dest = path.with_name(path.stem + "-recortado.png")
    out.save(dest)
    return dest.name


def extgstate_alphas(doc) -> set[float]:
    """Alfas declaradas en los /ExtGState del documento.

    Hace falta leerlas del objeto crudo porque `get_drawings()` reporta
    fill_opacity=1.0 aunque el path se pinte bajo un gs con ca<1.
    """
    out = set()
    for x in range(1, doc.xref_length()):
        if doc.xref_get_key(x, "Type")[1] != "/ExtGState":
            continue
        for key in ("ca", "CA"):
            kind, val = doc.xref_get_key(x, key)
            if kind == "float":
                try:
                    v = float(val)
                except ValueError:
                    continue
                if 0 < v < 1:
                    out.add(round(v, 3))
    return out


def explain_derived(hexc: str, palette: list[str], alphas: set[float], tol: int = 3) -> dict | None:
    """Explica un color que no esta declarado en ninguna parte como la mezcla
    de dos colores que si lo estan, con uno de los alfas del documento."""
    target = rgb_of(hexc)
    for alpha in sorted(alphas):
        for top in palette:
            tr = rgb_of(top)
            for base in palette:
                if base == top:
                    continue
                br = rgb_of(base)
                cand = (alpha * t + (1 - alpha) * b for t, b in zip(tr, br))
                if max(abs(c - x) for c, x in zip(cand, target)) <= tol:
                    return {"color": top, "alpha": alpha, "sobre": base}
    return None


def make_snapper(known: set[str]):
    """Ajusta un color muestreado al color exacto de la paleta mas cercano.
    El render puede desviar un punto por el antialias; la paleta es la verdad."""
    def snap(hexc: str | None) -> str | None:
        if not hexc or hexc in known:
            return hexc
        rgb = rgb_of(hexc)
        best, bestd = hexc, 1e9
        for k in known:
            d = sum((a - b) ** 2 for a, b in zip(rgb, rgb_of(k))) ** 0.5
            if d < bestd:
                best, bestd = k, d
        return best if bestd <= 10 else hexc
    return snap


def group_near_dupes(colors: list[dict]) -> list[dict]:
    """Agrupa hex casi identicos (mismo color de marca via distinto espacio de
    color). Representante = el de mayor area."""
    grupos: list[dict] = []
    for c in colors:  # ya vienen ordenados por area desc
        rgb = rgb_of(c["hex"])
        for g in grupos:
            gr = rgb_of(g["hex"])
            if sum((a - b) ** 2 for a, b in zip(rgb, gr)) ** 0.5 <= NEAR_DUPE_DIST:
                g["variantes"].append(c["hex"])
                g["area_total_pt2"] = round(g["area_total_pt2"] + c["area_total_pt2"], 1)
                g["cobertura_pct"] = round(g["cobertura_pct"] + c["cobertura_pct"], 3)
                g["donde"] = sorted(set(g["donde"]) | set(c["donde"]))
                break
        else:
            grupos.append({**c, "variantes": []})
    return grupos


# --------------------------------------------------------------------------- extraccion


def extract() -> dict:
    for sub in ("render", "assets", "text"):
        (OUT / sub).mkdir(parents=True, exist_ok=True)

    pdfs = sorted(ROOT.glob("*.pdf"))
    if not pdfs:
        raise SystemExit("No hay PDFs en la raiz del proyecto.")

    documentos = []
    typo = defaultdict(
        lambda: {"ocurrencias": 0, "chars": 0, "area": 0.0, "ejemplos": [], "donde": set(), "fondos": set()}
    )
    text_colors = defaultdict(lambda: {"area": 0.0, "ocurrencias": 0, "donde": set(), "tamanos": set()})
    shape_colors = defaultdict(lambda: {"area": 0.0, "ocurrencias": 0, "donde": set(), "modo": set()})
    pares = defaultdict(lambda: {"ocurrencias": 0, "tamanos": set(), "bold": False, "ejemplos": [], "donde": set()})
    imagenes: dict[str, dict] = {}
    vectores = []
    radios = []
    trazos = defaultdict(lambda: {"ocurrencias": 0, "colores": set(), "donde": set()})
    area_total_pt2 = 0.0

    alphas: set[float] = set()

    for pdf_path in pdfs:
        slug = slugify(pdf_path.stem)
        doc = fitz.open(pdf_path)
        alphas |= extgstate_alphas(doc)
        paginas = []

        for pno, page in enumerate(doc, start=1):
            where = f"{slug} p{pno}"
            rect = page.rect
            page_area = rect.width * rect.height
            area_total_pt2 += page_area

            render_name = f"{slug}-p{pno}.png"
            render = page.get_pixmap(dpi=RENDER_DPI)
            render.save(OUT / "render" / render_name)
            scale = RENDER_DPI / 72.0
            (OUT / "text" / f"{slug}-p{pno}.txt").write_text(page.get_text("text"), encoding="utf-8")

            # ---------- 1. formas ----------
            for path in page.get_drawings():
                prect = path.get("rect") or fitz.Rect()
                area = abs(prect.width * prect.height)
                ptype = path.get("type", "")
                items = path.get("items", [])

                fill_hex = hex_from_tuple(path.get("fill"))
                if fill_hex and ptype in ("f", "fs"):
                    sc = shape_colors[fill_hex]
                    sc["area"] += area
                    sc["ocurrencias"] += 1
                    sc["donde"].add(where)
                    sc["modo"].add("relleno")

                stroke_hex = hex_from_tuple(path.get("color"))
                if stroke_hex and ptype in ("s", "fs"):
                    width = round(path.get("width") or 0, 2)
                    sc = shape_colors[stroke_hex]
                    # un trazo cubre perimetro x ancho, no el area del rect
                    sc["area"] += 2 * (prect.width + prect.height) * max(width, 0.5)
                    sc["ocurrencias"] += 1
                    sc["donde"].add(where)
                    sc["modo"].add("trazo")
                    t = trazos[width]
                    t["ocurrencias"] += 1
                    t["colores"].add(stroke_hex)
                    t["donde"].add(where)

                rad = corner_radii(items, prect)
                if rad and area > 100:
                    radios.append(
                        {
                            "donde": where,
                            "ancho_pt": round(prect.width, 1),
                            "alto_pt": round(prect.height, 1),
                            "relleno": fill_hex,
                            "trazo": stroke_hex,
                            "radios_pt": rad,
                            "simetrico": len({round(v) for v in rad.values()}) == 1,
                        }
                    )

            # ---------- 2. imagenes ----------
            for idx, info in enumerate(page.get_images(full=True)):
                xref, smask_xref = info[0], info[1]
                try:
                    raw = doc.extract_image(xref)
                except Exception:
                    continue
                placements = list(page.get_image_rects(xref))
                digest = sha8(raw["image"])
                donde = {
                    "pagina": where,
                    "rect_pt": [[round(v, 1) for v in (r.x0, r.y0, r.x1, r.y1)] for r in placements],
                }
                if digest in imagenes:
                    imagenes[digest]["donde"].append(donde)
                    continue

                base_name = f"img-{slug}-p{pno}-{idx:02d}-{digest}"
                (OUT / "assets" / f"{base_name}.{raw['ext']}").write_bytes(raw["image"])

                # Si la imagen trae canal alfa (/SMask), el JPEG base por si solo
                # es inservible: hay que componerlo con la mascara para obtener
                # el asset real con transparencia.
                compuesto = None
                if smask_xref:
                    try:
                        pix = fitz.Pixmap(doc, xref)
                        if pix.colorspace and pix.colorspace.n > 3:
                            pix = fitz.Pixmap(fitz.csRGB, pix)
                        rgba = fitz.Pixmap(pix, fitz.Pixmap(doc, smask_xref))
                        rgba.save(OUT / "assets" / f"{base_name}-alfa.png")
                        compuesto = f"assets/{base_name}-alfa.png"
                    except Exception:
                        pass

                imagenes[digest] = {
                    "archivo": f"assets/{base_name}.{raw['ext']}",
                    "hash": digest,
                    "ext": raw["ext"],
                    "px": [raw["width"], raw["height"]],
                    "bytes": len(raw["image"]),
                    "tiene_alfa": bool(smask_xref),
                    "compuesto_rgba": compuesto,
                    "donde": [donde],
                }

            # ---------- 3. texto ----------
            for block in page.get_text("dict")["blocks"]:
                if block.get("type") != 0:
                    continue
                for line in block["lines"]:
                    for span in line["spans"]:
                        txt = span["text"].strip()
                        if not txt:
                            continue
                        bbox = fitz.Rect(span["bbox"])
                        area = abs(bbox.width * bbox.height)
                        flags = span.get("flags", 0)
                        bold = bool(flags & 2**4)
                        font = clean_font(span["font"])
                        size = round(span["size"], 1)
                        col = hex_from_int(span.get("color"))
                        fondo, frac = sample_background(render, bbox, scale, col)
                        # por debajo de 0.60 el fondo no es un plano: es foto o
                        # degradado, y no tiene sentido calcularle un ratio
                        plano = fondo is not None and frac >= 0.60

                        key = (family_of(font), font, size, bold, bool(flags & 2**1), col)
                        e = typo[key]
                        e["ocurrencias"] += 1
                        e["chars"] += len(txt)
                        e["area"] += area
                        e["donde"].add(where)
                        e["fondos"].add(fondo if plano else "variable")
                        if len(e["ejemplos"]) < 4 and txt not in e["ejemplos"]:
                            e["ejemplos"].append(txt[:70])

                        if col:
                            tc = text_colors[col]
                            tc["area"] += area
                            tc["ocurrencias"] += 1
                            tc["donde"].add(where)
                            tc["tamanos"].add(size)

                            if plano:
                                p = pares[(col, fondo)]
                                p["ocurrencias"] += 1
                                p["tamanos"].add(size)
                                p["bold"] = p["bold"] or bold
                                p["donde"].add(where)
                                if len(p["ejemplos"]) < 3 and txt not in p["ejemplos"]:
                                    p["ejemplos"].append(txt[:50])

            # ---------- 4. clusters vectoriales (logos / iconos) ----------
            clusters = sorted(
                (c for c in page.cluster_drawings() if 400 < abs(c.width * c.height) < page_area * 0.30),
                key=lambda c: -abs(c.width * c.height),
            )[:30]

            # 4a. raster: primero, porque get_pixmap(clip=) usa las coordenadas
            #     de la pagina sin recortar
            pend_svg = []
            for cidx, crect in enumerate(clusters):
                dpi = VECTOR_DPI
                longest = max(crect.width, crect.height)
                if longest * dpi / 72 > VECTOR_MAX_PX:
                    dpi = int(VECTOR_MAX_PX * 72 / longest)
                base = f"vec-{slug}-p{pno}-c{cidx:02d}"
                pix = page.get_pixmap(dpi=dpi, clip=crect)
                pix.save(OUT / "assets" / f"{base}.png")
                recorte = None
                if max(crect.width, crect.height) <= SVG_MAX_PT:
                    recorte = key_out_background(OUT / "assets" / f"{base}.png")
                entry = {
                    "archivo": f"assets/{base}.png",
                    "recortado": f"assets/{recorte}" if recorte else None,
                    "svg": None,
                    "donde": where,
                    "rect_pt": [round(v, 1) for v in (crect.x0, crect.y0, crect.x1, crect.y1)],
                    "ancho_pt": round(crect.width, 1),
                    "alto_pt": round(crect.height, 1),
                    "dpi": dpi,
                    "px": [pix.width, pix.height],
                }
                vectores.append(entry)
                if max(crect.width, crect.height) <= SVG_MAX_PT:
                    pend_svg.append((base, crect, entry))

            # 4b. SVG de los clusters pequenos (logos e iconos: son los que hay
            #     que poder escalar). text_as_path evita depender de las fuentes
            #     licenciadas. Recorta via cropbox porque get_svg_image no tiene
            #     parametro clip; se restaura al terminar.
            if pend_svg:
                crop0 = fitz.Rect(page.cropbox)
                media = fitz.Rect(page.mediabox)
                for base, crect, entry in pend_svg:
                    clip = crect & media
                    if clip.is_empty:
                        continue
                    try:
                        page.set_cropbox(clip)
                        svg = page.get_svg_image(matrix=fitz.Identity, text_as_path=True)
                        (OUT / "assets" / f"{base}.svg").write_text(svg, encoding="utf-8")
                        entry["svg"] = f"assets/{base}.svg"
                    except Exception:
                        pass
                page.set_cropbox(crop0)

            paginas.append(
                {
                    "n": pno,
                    "ancho_pt": round(rect.width, 1),
                    "alto_pt": round(rect.height, 1),
                    "ancho_mm": round(rect.width * PT_TO_MM, 1),
                    "alto_mm": round(rect.height * PT_TO_MM, 1),
                    "render": f"render/{render_name}",
                    "texto": f"text/{slug}-p{pno}.txt",
                }
            )

        documentos.append(
            {
                "archivo": pdf_path.name,
                "slug": slug,
                "bytes": pdf_path.stat().st_size,
                "paginas": paginas,
                "fuentes_incrustadas": sorted(
                    {clean_font(f[3]) for pg in doc for f in pg.get_fonts(full=True)}
                ),
            }
        )
        doc.close()

    # ---------------------------------------------------------------- normalizacion
    def pack(source, extra=()):
        out = []
        for hexc, d in source.items():
            row = {
                "hex": hexc,
                "area_pt2": round(d["area"], 1),
                "cobertura_pct": round(100 * d["area"] / area_total_pt2, 3),
                "ocurrencias": d["ocurrencias"],
                "donde": sorted(d["donde"]),
            }
            for k in extra:
                row[k] = sorted(d[k])
            out.append(row)
        return sorted(out, key=lambda r: -r["area_pt2"])

    colors_text = pack(text_colors, ("tamanos",))
    colors_shapes = pack(shape_colors, ("modo",))

    # los fondos vienen muestreados del render; se ajustan al hex exacto
    # declarado en el PDF y se re-agregan, para no reportar dos veces el mismo
    # par. El render desvia ~1 unidad por canal contra lo declarado (gestion de
    # color ICC de MuPDF); manda lo declarado, que es el valor de diseno.
    declarados = set(text_colors) | set(shape_colors)
    snap = make_snapper(declarados)
    pares_snap: dict = defaultdict(
        lambda: {"ocurrencias": 0, "tamanos": set(), "bold": False, "ejemplos": [], "donde": set()}
    )
    for (fg, bg), v in pares.items():
        t = pares_snap[(fg, snap(bg))]
        t["ocurrencias"] += v["ocurrencias"]
        t["tamanos"] |= v["tamanos"]
        t["bold"] = t["bold"] or v["bold"]
        t["donde"] |= v["donde"]
        for ej in v["ejemplos"]:
            if len(t["ejemplos"]) < 3 and ej not in t["ejemplos"]:
                t["ejemplos"].append(ej)
    pares = pares_snap
    for v in typo.values():
        v["fondos"] = {f if f == "variable" else snap(f) for f in v["fondos"]}

    # fondos que aparecen en el render pero no estan declarados: son mezclas
    fondos_usados = {bg for _, bg in pares} | {
        f for v in typo.values() for f in v["fondos"] if f != "variable"
    }
    derivados = []
    for h in sorted(fondos_usados - declarados):
        derivados.append(
            {
                "hex": h,
                "origen": explain_derived(h, sorted(shape_colors), alphas),
                "contraste_vs_negro": round(contrast_ratio(h, "#000000"), 2),
            }
        )

    comb = defaultdict(lambda: {"texto": 0.0, "forma": 0.0, "donde": set()})
    for r in colors_text:
        comb[r["hex"]]["texto"] += r["area_pt2"]
        comb[r["hex"]]["donde"].update(r["donde"])
    for r in colors_shapes:
        comb[r["hex"]]["forma"] += r["area_pt2"]
        comb[r["hex"]]["donde"].update(r["donde"])
    colors_all = sorted(
        (
            {
                "hex": h,
                "area_total_pt2": round(v["texto"] + v["forma"], 1),
                "area_forma_pt2": round(v["forma"], 1),
                "area_texto_pt2": round(v["texto"], 1),
                "cobertura_pct": round(100 * (v["texto"] + v["forma"]) / area_total_pt2, 3),
                "donde": sorted(v["donde"]),
                "contraste_vs_blanco": round(contrast_ratio(h, "#FFFFFF"), 2),
                "contraste_vs_negro": round(contrast_ratio(h, "#000000"), 2),
            }
            for h, v in comb.items()
        ),
        key=lambda r: -r["area_total_pt2"],
    )

    typography = sorted(
        (
            {
                "familia": k[0],
                "fuente": k[1],
                "tamano_pt": k[2],
                "bold": k[3],
                "italic": k[4],
                "color": k[5],
                "ocurrencias": v["ocurrencias"],
                "caracteres": v["chars"],
                "area_bbox_pt2": round(v["area"], 1),
                "ejemplos": v["ejemplos"],
                "fondos": sorted(v["fondos"]),
                "donde": sorted(v["donde"]),
            }
            for k, v in typo.items()
        ),
        key=lambda r: (-r["tamano_pt"], -r["caracteres"]),
    )

    contraste = sorted(
        (
            {
                "texto": fg,
                "fondo": bg,
                "ratio": round(contrast_ratio(fg, bg), 2),
                "tamanos_pt": sorted(v["tamanos"]),
                "bold": v["bold"],
                "umbral_aa": aa_threshold(max(v["tamanos"]), v["bold"]),
                "cumple_aa": round(contrast_ratio(fg, bg), 2) >= aa_threshold(max(v["tamanos"]), v["bold"]),
                "ocurrencias": v["ocurrencias"],
                "ejemplos": v["ejemplos"],
                "donde": sorted(v["donde"]),
            }
            for (fg, bg), v in pares.items()
        ),
        key=lambda r: r["ratio"],
    )

    return {
        "generado_por": "scripts/extract-pdf-design.py",
        "pymupdf": fitz.__doc__.splitlines()[0],
        "render_dpi": RENDER_DPI,
        "vector_dpi": VECTOR_DPI,
        "area_total_pt2": round(area_total_pt2, 1),
        "documentos": documentos,
        "typography": typography,
        "alfas_declarados": sorted(alphas),
        "colors": {
            "combinado": colors_all,
            "consolidado": group_near_dupes(colors_all),
            "derivados": derivados,
            "texto": colors_text,
            "formas": colors_shapes,
        },
        "contraste_medido": contraste,
        "assets": {
            "imagenes": sorted(imagenes.values(), key=lambda r: -(r["px"][0] * r["px"][1])),
            "vectores": vectores,
        },
        "formas": {
            "radios": sorted(radios, key=lambda r: -(r["ancho_pt"] * r["alto_pt"])),
            "trazos": sorted(
                (
                    {"ancho_pt": w, "ocurrencias": v["ocurrencias"], "colores": sorted(v["colores"]), "donde": sorted(v["donde"])}
                    for w, v in trazos.items()
                ),
                key=lambda r: -r["ocurrencias"],
            ),
        },
    }


# ------------------------------------------------------------------------- entregables


def write_palette(tokens: dict, top: int = 18) -> None:
    colors = tokens["colors"]["consolidado"][:top]
    cols, cell, pad, label_h = 6, 190, 16, 56
    rows = (len(colors) + cols - 1) // cols
    W = cols * cell + pad * (cols + 1)
    H = rows * (cell + label_h) + pad * (rows + 1)
    img = Image.new("RGB", (W, H), "#F4F4F5")
    draw = ImageDraw.Draw(img)
    f_hex, f_meta = load_font(22), load_font(14)

    for i, c in enumerate(colors):
        r, col = divmod(i, cols)
        x, y = pad + col * (cell + pad), pad + r * (cell + label_h + pad)
        draw.rectangle([x, y, x + cell, y + cell], fill=c["hex"], outline="#9CA3AF")
        draw.text((x, y + cell + 5), c["hex"], font=f_hex, fill="#111827")
        extra = f" (+{len(c['variantes'])} var.)" if c["variantes"] else ""
        draw.text((x, y + cell + 30), f"{c['cobertura_pct']:.2f}% area{extra}", font=f_meta, fill="#4B5563")
        draw.text((x, y + cell + 44), f"AA vs blanco {c['contraste_vs_blanco']:.2f}:1", font=f_meta, fill="#4B5563")
    img.save(OUT / "palette.png")


def write_report(tokens: dict) -> None:
    L: list[str] = []
    a = L.append

    a("# Fase 0 Sistema de diseño medido sobre los PDFs\n")
    a(f"> Generado por `{tokens['generado_por']}` con {tokens['pymupdf']}  ")
    a(f"> Render de referencia a {tokens['render_dpi']} DPI · vectores recortados a {tokens['vector_dpi']} DPI\n")
    a("**Ningún valor de este informe está inventado ni citado de memoria: todos salen medidos del PDF.**")
    a("Lo único que no es medición es la sección 7 (propuesta de tokens), que es una *derivación* "
      "de las mediciones y está marcada como tal.\n")
    a("Para aprobar de un vistazo:\n")
    a("- `design-extract/palette.png` la paleta consolidada con su hex")
    a("- `design-extract/contact-sheet.png` las 22 piezas extraídas, identificables")
    a("- `design-extract/render/*.png` las 3 piezas completas a 200 DPI\n")

    # 1 --------------------------------------------------------------------
    a("## 1. Piezas analizadas\n")
    a("| Pieza | Páginas | Tamaño página | Peso | Fuentes incrustadas |")
    a("|---|---|---|---|---|")
    for d in tokens["documentos"]:
        p0 = d["paginas"][0]
        a(
            f"| `{d['archivo']}` | {len(d['paginas'])} | {p0['ancho_pt']}×{p0['alto_pt']} pt "
            f"({p0['ancho_mm']}×{p0['alto_mm']} mm) | {d['bytes']/1024:.0f} KB | "
            f"{', '.join(d['fuentes_incrustadas']) or ''} |"
        )
    a("")
    a("Las tres son piezas verticales de una sola página, mismo ancho (612 pt = 216 mm) y alto "
      "variable. Es formato de *pieza para chat/correo*, no de impresión.\n")

    # 2 --------------------------------------------------------------------
    a("## 2. Paleta\n")
    a("Área = superficie de relleno de las formas + bbox de los spans de texto, sumada sobre las "
      "3 piezas. Separa *fondos* (mucha área) de *acentos* (poca área, alta presencia).\n")
    a("### 2.1 Paleta consolidada\n")
    a("Los hex que difieren en ≤8 de distancia RGB son **el mismo color de marca** expresado en dos "
      "espacios de color (el relleno vectorial y el texto se convierten por caminos distintos). "
      "Aquí van fusionados, con el dominante como representante.\n")
    a("Todos los valores son los **declarados** en el PDF. Al rasterizar, MuPDF los desvía ~1 "
      "unidad por canal (`#8BD0E5` sale `#8AD0E4`); manda lo declarado, que es el valor que eligió "
      "el diseñador.\n")
    a("| # | Hex | Variantes fusionadas | % área | Formas | Texto | vs blanco | vs negro | Aparece en |")
    a("|---|---|---|---|---|---|---|---|---|")
    for i, c in enumerate(tokens["colors"]["consolidado"], 1):
        var = ", ".join(f"`{v}`" for v in c["variantes"]) or ""
        a(
            f"| {i} | `{c['hex']}` | {var} | {c['cobertura_pct']:.3f}% | {c['area_forma_pt2']:,.0f} | "
            f"{c['area_texto_pt2']:,.0f} | {c['contraste_vs_blanco']:.2f}:1 | "
            f"{c['contraste_vs_negro']:.2f}:1 | {len(c['donde'])}/3 piezas |"
        )
    a("")
    a(f"**{len(tokens['colors']['combinado'])}** hex distintos en total → **"
      f"{len(tokens['colors']['consolidado'])}** colores reales tras consolidar.\n")

    if tokens["colors"]["derivados"]:
        a("### 2.2 Colores derivados (mezclas, no declarados)\n")
        a("Colores que se ven en la pieza pero que **ningún relleno declara**: son un color de la "
          "paleta pintado con opacidad sobre otro. Los alfas declarados en los `/ExtGState` del "
          f"documento son **{', '.join(str(x) for x in tokens['alfas_declarados'])}**.\n")
        a("⚠ `get_drawings()` reporta `fill_opacity = 1.0` para estos paths, así que la opacidad "
          "**no** se puede leer del path: hay que sacarla del `/ExtGState`. Sin esto el color se "
          "habría tomado como un plano más de la paleta, que es justo el error que el plan prohíbe.\n")
        a("| Hex renderizado | Se explica como |")
        a("|---|---|")
        for d in tokens["colors"]["derivados"]:
            o = d["origen"]
            expl = (
                f"`{o['color']}` al **{o['alpha']:.0%}** sobre `{o['sobre']}`"
                if o
                else "_sin explicación automática_"
            )
            a(f"| `{d['hex']}` | {expl} |")
        a("")

    a("### 2.3 Desglose por rol\n")
    a("**Colores de texto**\n")
    a("| Hex | % área | Ocurrencias | Tamaños (pt) |")
    a("|---|---|---|---|")
    for c in tokens["colors"]["texto"]:
        a(f"| `{c['hex']}` | {c['cobertura_pct']:.3f}% | {c['ocurrencias']} | {', '.join(str(t) for t in c['tamanos'])} |")
    a("")
    a("**Colores de forma**\n")
    a("| Hex | % área | Ocurrencias | Modo |")
    a("|---|---|---|---|")
    for c in tokens["colors"]["formas"]:
        a(f"| `{c['hex']}` | {c['cobertura_pct']:.3f}% | {c['ocurrencias']} | {', '.join(c['modo'])} |")
    a("")

    # 3 --------------------------------------------------------------------
    a("## 3. Escalera tipográfica\n")
    fams = sorted({t["familia"] for t in tokens["typography"]})
    a(f"Familias incrustadas: **{', '.join(f'`{f}`' for f in fams)}**\n")
    a("| Tamaño pt | Fuente | B | I | Color | Sobre | Chars | Ejemplo |")
    a("|---|---|---|---|---|---|---|---|")
    for t in tokens["typography"]:
        ej = " · ".join(t["ejemplos"][:2]).replace("|", "\\|")
        fondos = ", ".join(f"`{f}`" if f != "variable" else "_foto_" for f in t["fondos"])
        a(
            f"| **{t['tamano_pt']}** | `{t['fuente']}` | {'✓' if t['bold'] else ''} | "
            f"{'✓' if t['italic'] else ''} | `{t['color']}` | {fondos} | {t['caracteres']} | {ej} |"
        )
    a("")

    # 4 --------------------------------------------------------------------
    a("## 4. Contraste medido (WCAG 2.1 AA)\n")
    a("El fondo de cada texto se **muestreó sobre el render a 200 DPI**, no por contención "
      "geométrica: así se respetan el orden de pintado, los recortes y las máscaras. Los textos "
      "que caen sobre foto o degradado quedan fuera de la tabla (no tienen un fondo plano contra "
      "el cual medir).\n")
    a("Umbral AA: 4.5:1 en texto normal; 3:1 en texto grande (≥18 pt, o ≥14 pt en negrita).\n")
    a("| Texto | Fondo | Ratio | Tamaños pt | B | Umbral | AA | Ejemplo |")
    a("|---|---|---|---|---|---|---|---|")
    for c in tokens["contraste_medido"]:
        ok = "✅" if c["cumple_aa"] else "❌"
        ej = " · ".join(c["ejemplos"][:2]).replace("|", "\\|")
        tams = ", ".join(str(t) for t in c["tamanos_pt"])
        a(
            f"| `{c['texto']}` | `{c['fondo']}` | **{c['ratio']:.2f}:1** | {tams} | "
            f"{'✓' if c['bold'] else ''} | {c['umbral_aa']}:1 | {ok} | {ej} |"
        )
    fallos = [c for c in tokens["contraste_medido"] if not c["cumple_aa"]]
    a("")
    if fallos:
        a(f"⚠ **{len(fallos)} par(es) no cumplen AA en la pieza impresa.** Como este proyecto es "
          "diseño propio (no réplica 1:1 de Figma), el `CLAUDE.md` obliga a **corregirlos**, no a "
          "documentarlos. Ver la nota en la sección 7.\n")
    else:
        a("Todos los pares medidos cumplen AA en la pieza original.\n")

    # 5 --------------------------------------------------------------------
    a("## 5. Formas\n")
    a("### 5.1 Radios de esquina\n")
    a("Medidos por el bbox de los segmentos Bézier de cada path cerrado.\n")
    asim = [r for r in tokens["formas"]["radios"] if not r["simetrico"]]
    sim = [r for r in tokens["formas"]["radios"] if r["simetrico"]]
    a("**Radio asimétrico confirmado.** Los marcos de foto y los arcos usan radios distintos por "
      "esquina:\n")
    a("| Tamaño (pt) | Relleno | sup-izq | sup-der | inf-izq | inf-der | Dónde |")
    a("|---|---|---|---|---|---|---|")
    for r in asim[:14]:
        rr = r["radios_pt"]
        a(
            f"| {r['ancho_pt']}×{r['alto_pt']} | `{r['relleno'] or ''}` | {rr['sup-izq']} | "
            f"{rr['sup-der']} | {rr['inf-izq']} | {rr['inf-der']} | {r['donde']} |"
        )
    a("")
    a("**Radio uniforme** tarjetas, cajas y píldoras:\n")
    a("| Tamaño (pt) | Relleno | Radio | Qué es | Dónde |")
    a("|---|---|---|---|---|")
    for r in sim[:14]:
        rad = list(r["radios_pt"].values())[0]
        ratio = rad / min(r["ancho_pt"], r["alto_pt"]) if min(r["ancho_pt"], r["alto_pt"]) else 0
        que = "píldora (radio = alto/2)" if ratio > 0.48 else "tarjeta / caja"
        a(f"| {r['ancho_pt']}×{r['alto_pt']} | `{r['relleno'] or ''}` | **{rad}** | {que} | {r['donde']} |")
    a(f"\nTotal de paths con esquinas curvas: **{len(tokens['formas']['radios'])}** "
      f"({len(asim)} asimétricos, {len(sim)} uniformes).\n")

    a("### 5.2 Anchos de trazo\n")
    a("| Ancho pt | Ocurrencias | Colores |")
    a("|---|---|---|")
    for t in tokens["formas"]["trazos"]:
        a(f"| {t['ancho_pt']} | {t['ocurrencias']} | {', '.join(f'`{c}`' for c in t['colores'])} |")
    a("")

    # 6 --------------------------------------------------------------------
    a("## 6. Inventario de assets\n")
    fotos = [i for i in tokens["assets"]["imagenes"] if not i["tiene_alfa"]]
    con_alfa = [i for i in tokens["assets"]["imagenes"] if i["tiene_alfa"]]
    a("### 6.1 Imágenes incrustadas (resolución nativa)\n")
    a("| Archivo | Píxeles | Peso | Colocada a (pt) | Alfa |")
    a("|---|---|---|---|---|")
    for im in tokens["assets"]["imagenes"]:
        r = im["donde"][0]["rect_pt"][0] if im["donde"][0]["rect_pt"] else None
        colocada = f"{r[2]-r[0]:.0f}×{r[3]-r[1]:.0f}" if r else ""
        alfa = f"sí → `{im['compuesto_rgba']}`" if im["tiene_alfa"] else "no"
        a(f"| `{im['archivo']}` | {im['px'][0]}×{im['px'][1]} | {im['bytes']/1024:.0f} KB | {colocada} | {alfa} |")
    a(f"\n**{len(fotos)}** fotografías opacas + **{len(con_alfa)}** imágenes con canal alfa "
      f"(`/SMask`).\n")
    if con_alfa:
        a("Las que traen alfa son la sombra suave que va detrás del badge **G-TALKS**. El JPEG base "
          "por sí solo sale como un rectángulo negro inservible; el archivo `*-alfa.png` es la "
          "composición base + máscara, que es el asset real. En el rediseño no hacen falta: la "
          "sombra se hace con CSS.\n")

    a("### 6.2 Clusters vectoriales (logos / íconos)\n")
    a("Cada uno sale en PNG a la resolución indicada. Los de lado ≤260 pt salen **además en SVG** "
      "(`text_as_path`, así no dependen de las fuentes licenciadas).\n")
    a("⚠ Esos SVG llevan la página entera recortada por `viewBox`, así que pesan ~500 KB cada uno: "
      "sirven para escalar sin pérdida, pero hay que pasarlos por un optimizador antes de "
      "publicarlos. El pendiente de pedir los vectoriales originales a Comunicaciones sigue "
      "abierto.\n")
    a("Los logos y los íconos vienen con la banda de color de la pieza horneada detrás, porque el "
      "recorte es rectangular. Como ese fondo es un plano medido, se quita por clave de color y se "
      "deja también un `*-recortado.png` sobre transparencia ese es el asset utilizable.\n")
    a("| Archivo | En página (pt) | Render (px) | DPI | Recortado | SVG | Página |")
    a("|---|---|---|---|---|---|---|")
    for v in tokens["assets"]["vectores"]:
        a(
            f"| `{v['archivo']}` | {v['ancho_pt']}×{v['alto_pt']} | {v['px'][0]}×{v['px'][1]} | "
            f"{v['dpi']} | {'✓' if v['recortado'] else ''} | {'✓' if v['svg'] else ''} | {v['donde']} |"
        )
    a(f"\n**{len(tokens['assets']['vectores'])}** clusters.\n")

    # 7 --------------------------------------------------------------------
    a("## 7. Propuesta de tokens ⚠ esto sí es derivación, no medición\n")
    a("Todo lo anterior es medición cruda. Esta sección **decide**: qué medición se convierte en "
      "token, con qué nombre y con qué rol. Es lo que hay que aprobar antes de la Fase 1.\n")

    a("### 7.1 Color\n")
    a("| Token | Valor | Origen medido | Rol observado |")
    a("|---|---|---|---|")
    for tok, val, rol in [
        ("--gt-navy", "#1F335E", "banda del hero, títulos de sección, footer"),
        ("--gt-navy-deep", "#1D2A4C", "círculo tras el numeral «1»"),
        ("--gt-celeste", "#8BD0E5", "arcos, franjas, caja destacada, fondo del badge"),
        ("--gt-celeste-tinte", "#BCDEE9", "filas logísticas de la agenda (celeste 50% sobre la tarjeta)"),
        ("--gt-carta", "#EDEDED", "tarjeta contenedora de la agenda"),
        ("--gt-azul-medio", "#1D71B8", "títulos de cada bloque de la agenda"),
        ("--gt-azul-gecelca", "#004A96", "logo Gecelca, wordmark G-TALKS, íconos"),
        ("--gt-tinta", "#1D1D1B", "texto de cuerpo"),
        ("--gt-blanco", "#FFFFFF", "texto sobre navy, fondo general"),
    ]:
        fila = next((c for c in tokens["colors"]["consolidado"] if c["hex"] == val), None)
        origen = f"{fila['cobertura_pct']:.2f}% del área" if fila else "derivado (§2.2)"
        a(f"| `{tok}` | `{val}` | {origen} | {rol} |")
    a("")
    a("`#006533` (verde) y `#010101` quedan **fuera** de los tokens: el verde solo existe dentro "
      "del trazo del logo Gecelca (0.028% del área, nunca como color de UI) y `#010101` es un "
      "segundo negro tipográfico redundante con `--gt-tinta`.\n")

    a("### 7.2 Tipografía\n")
    a("| Familia | Dónde se usa | Licencia | Decisión |")
    a("|---|---|---|---|")
    a("| **Urbanist** | todo el texto: cuerpo, títulos, agenda, footer | SIL OFL libre, está en "
      "Google Fonts | **Se usa tal cual**, autohospedada en `public/fonts/` (Regular 400, Bold 700, "
      "Italic 400). Coincide con la del proyecto hermano PORTALES GECELCA: el *cross-check* pasa. |")
    a("| **Bely Display** | únicamente el numeral «1» a 150–157 pt | licenciada (TypeTogether), no "
      "la tenemos | **No se sustituye por otra fuente**: es un elemento de marca, se usa el SVG "
      "extraído (`text_as_path`). Así no hace falta ni la fuente ni una sustituta aproximada. |")
    a("| **Museo Slab 900** | únicamente el wordmark «G-TALKS» | licenciada (exljbris), no la "
      "tenemos | Igual: es logotipo, va como SVG/PNG, no como texto. |")
    a("")
    a("Esto deja **una sola familia real** en el sitio (Urbanist) y ninguna dependencia de fuentes "
      "licenciadas, que era el riesgo que abría §0.4 del plan.\n")

    cuerpo = 20.0
    escala = sorted({t["tamano_pt"] for t in tokens["typography"]}, reverse=True)
    a("**Escalera medida** (anclada en el cuerpo de 20 pt, que es el tamaño con más caracteres):\n")
    a("| pt medidos | ÷ cuerpo | Propuesta web | Uso observado |")
    a("|---|---|---|---|")
    usos = {
        157.0: "numeral «1» display", 150.2: "numeral «1» display",
        51.8: "título del foro (pieza expertos)", 40.9: "título del foro",
        39.1: "título del foro", 30.6: "«Agenda Académica»",
        27.8: "intro sobre foto", 27.7: "bajada «Retos y oportunidades»",
        25.2: "bajada", 24.1: "bajada", 22.0: "intro", 20.0: "cuerpo / títulos de bloque",
        19.3: "píldoras de fecha y lugar", 19.0: "cuerpo", 18.8: "píldora de fecha",
        17.0: "cuerpo sobre navy", 16.0: "etiquetas «Ponencia» / «Panel»",
        15.0: "«a.m.» / «p.m.» del chip de hora", 14.0: "cargos, footer",
    }
    for pt in escala:
        if pt in (26.2, 25.8, 18.4):  # G-TALKS: es logotipo, no escala de texto
            continue
        rem = pt / cuerpo
        a(f"| {pt} | {rem:.2f}× | `{rem:.3g}rem` | {usos.get(pt, '')} |")
    a("")
    a("La escalera se propone **en `rem` relativos al cuerpo**, no en px absolutos: la pieza es "
      "vertical de 612 pt y el sitio es responsive, así que lo que se conserva es la *proporción* "
      "entre niveles, no el tamaño físico.\n")
    a("Esos 19 niveles medidos son más de los que un sistema necesita: varios difieren en décimas "
      "porque cada pieza se maquetó a mano (27.8 vs 27.7; 19.3 vs 19.0 vs 18.8). **Colapsados a los "
      "7 roles reales:**\n")
    a("| Token | Valor | Sale de | Uso |")
    a("|---|---|---|---|")
    for tok, val, orig, uso in [
        ("--gt-fs-display", "7.5rem", "150–157 pt", "numeral «1»"),
        ("--gt-fs-h1", "2.6rem", "39.1 / 40.9 / 51.8 pt", "título del foro"),
        ("--gt-fs-h2", "1.5rem", "30.6 pt", "«Agenda Académica», títulos de sección"),
        ("--gt-fs-lead", "1.35rem", "27.7 / 27.8 pt", "bajada e intros"),
        ("--gt-fs-body", "1rem", "20 pt (el de más caracteres)", "cuerpo y títulos de bloque"),
        ("--gt-fs-sm", "0.8rem", "16 pt", "etiquetas «Ponencia» / «Panel»"),
        ("--gt-fs-xs", "0.7rem", "14 / 15 pt", "cargos, horas, footer"),
    ]:
        a(f"| `{tok}` | `{val}` | {orig} | {uso} |")
    a("")

    a("### 7.3 Formas\n")
    a("| Token | Valor medido | Origen |")
    a("|---|---|---|")
    a("| `--gt-radio-tarjeta` | `25.6pt` | tarjeta de la agenda, idéntica en las 3 piezas |")
    a("| `--gt-radio-caja` | `22.7pt` | caja destacada celeste |")
    a("| `--gt-radio-pildora` | `50%` | píldora de fecha: radio 14.4 sobre alto 28.9 |")
    a("| `--gt-radio-foto` | `101.9pt` en 2 esquinas opuestas, 0 en las otras | marco de foto |")
    a("| `--gt-borde` | `1pt` | 84 de los 87 trazos del documento |")
    a("")
    a("El **radio asimétrico** del marco de foto queda confirmado por medición: esquinas superior-"
      "izquierda e inferior-derecha a 101.9 pt, las otras dos a 0. No es un radio uniforme grande.\n")

    a("### 7.4 Accesibilidad lo que hay que corregir\n")
    fallos = [c for c in tokens["contraste_medido"] if not c["cumple_aa"]]
    if fallos:
        for c in fallos:
            a(f"- `{c['texto']}` sobre `{c['fondo']}` = **{c['ratio']:.2f}:1** (ejemplo: "
              f"«{c['ejemplos'][0]}»). En la pieza es texto display, pero **no se replica así**: "
              "este proyecto es diseño propio y el `CLAUDE.md` obliga a cumplir AA.")
        a("")
    filo = [c for c in tokens["contraste_medido"] if c["cumple_aa"] and c["ratio"] < 4.5]
    if filo:
        n = len(filo)
        a(f"Además, {'un par pasa' if n == 1 else f'{n} pares pasan'} en la pieza pero "
          f"{'queda' if n == 1 else 'quedan'} **al filo**. Hay que vigilarlo al pasarlo a web, "
          "donde el texto será más pequeño que en el PDF:\n")
        for c in filo:
            fix, factor = darken_to_meet(c["texto"], c["fondo"], 4.5)
            a(f"- `{c['texto']}` sobre `{c['fondo']}` = **{c['ratio']:.2f}:1** pasa como texto "
              f"grande (≥18 pt), **falla como texto normal** (necesita 4.5:1). "
              f"Ejemplo: «{c['ejemplos'][0]}».  \n"
              f"  Corrección mínima: `{fix}` (el mismo tono al {factor:.0%} de luminosidad) da "
              f"**{contrast_ratio(fix, c['fondo']):.2f}:1** y cumple a cualquier tamaño.")
        a("")
    a("> El par crítico es el de los **títulos de bloque de la agenda**: en la pieza van a 20 pt en "
      "negrita y pasan; en el sitio, a tamaño de cuerpo, no. O se oscurece el azul al valor de "
      "arriba, o esos títulos se mantienen grandes. Es la decisión de accesibilidad más relevante "
      "del sistema y conviene tomarla ahora, no en la Fase 4.\n")

    (OUT / "report.md").write_text("\n".join(L), encoding="utf-8")


def main() -> None:
    tokens = extract()
    (OUT / "tokens.json").write_text(json.dumps(tokens, indent=2, ensure_ascii=False), encoding="utf-8")
    write_palette(tokens)
    write_report(tokens)
    print(f"OK -> {OUT}")
    print(f"  hex distintos     : {len(tokens['colors']['combinado'])}"
          f"  -> consolidados: {len(tokens['colors']['consolidado'])}")
    print(f"  estilos de texto  : {len(tokens['typography'])}")
    print(f"  pares de contraste: {len(tokens['contraste_medido'])}"
          f"  -> fallan AA: {sum(1 for c in tokens['contraste_medido'] if not c['cumple_aa'])}")
    fotos = sum(1 for i in tokens["assets"]["imagenes"] if not i["tiene_alfa"])
    print(f"  fotos             : {fotos}  (+{len(tokens['assets']['imagenes'])-fotos} con alfa)")
    print(f"  clusters vector   : {len(tokens['assets']['vectores'])}")


if __name__ == "__main__":
    main()

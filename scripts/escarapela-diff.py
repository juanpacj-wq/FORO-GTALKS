"""Compara el carné renderizado contra la pieza oficial, cota a cota y píxel a píxel.

    npm run build && npm run preview               # en una terminal
    node scripts/escarapela-compare.mjs            # en otra → render.png
    .venv-design/Scripts/python scripts/escarapela-diff.py

Lee `design-extract/escarapela/carne.png` (la referencia que recorta `escarapela-medir.py`) y
`render.png` (la captura), y escribe en la misma carpeta:

  lado-a-lado.png   pieza | render | mapa de diferencias, a la misma escala
  metricas.md       las tres tablas que dirigen el bucle de corrección

Las tablas van en este orden porque así se corrige:

1. **Cotas.** Cada caja medida en la pieza y en el render, con su diferencia. Es la tabla
   accionable: dice cuántos px hay que mover cada cosa, y de ahí salen los cqw del CSS. Las
   cotas de los dos lados se miden con el MISMO código de `escarapela-medir.py`, así que
   cualquier sesgo del método se cancela al restar.
2. **Curvas.** Desviación de los tres bordes de los telones, columna a columna. Es el criterio
   numérico de cierre del plan (≤2 px).
3. **Píxeles.** Porcentaje de píxeles distintos por región. Cierra el bucle, pero es el más
   grosero de los tres: una diferencia de tinta lo dispara entero sin que nada se haya movido,
   así que se acompaña de la tinta muestreada en los dos lados para poder separar una cosa
   de la otra.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = Path(__file__).resolve().parent.parent
DIR = RAIZ / "design-extract" / "escarapela"

_spec = importlib.util.spec_from_file_location(
    "escarapela_medir", Path(__file__).with_name("escarapela-medir.py"))
medir = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(medir)

# Un píxel cuenta como distinto si algún canal se separa más que esto. 28/255 absorbe el
# antialias de los cantos y del textola pieza es un export raster, no hay igualdad bit a
# bit sin absorber un desplazamiento real.
TOLERANCIA = 28


def cargar() -> tuple[Image.Image, Image.Image]:
    ref = Image.open(DIR / "carne.png").convert("RGB")
    ren = Image.open(DIR / "render.png").convert("RGB")
    if ren.size != ref.size:
        dif = max(abs(a - b) for a, b in zip(ren.size, ref.size))
        if dif <= 3:
            # Un píxel de más o de menos es el redondeo del `aspect-ratio` en el navegador:
            # se recorta o se rellena. Reescalar por eso estiraría el carné entero un 0.06 %
            # y ese sesgo se colaba en TODAS las cotas verticales.
            lienzo = Image.new("RGB", ref.size, (253, 253, 253))
            lienzo.paste(ren, (0, 0))
            ren = lienzo
        else:
            print(f"aviso: el render mide {ren.size} y la referencia {ref.size} se reescala")
            ren = ren.resize(ref.size, Image.LANCZOS)
    return ref, ren


def interpolar(puntos: list[tuple[float, float]], x: float) -> float | None:
    """y en x sobre la polilínea muestreada (las dos curvas no caen en las mismas columnas)."""
    if not puntos or x < puntos[0][0] or x > puntos[-1][0]:
        return None
    for i in range(1, len(puntos)):
        if puntos[i][0] >= x:
            x0, y0 = puntos[i - 1]
            x1, y1 = puntos[i]
            return y0 if x1 == x0 else y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return puntos[-1][1]


def comparar_curvas(a: dict, b: dict) -> dict:
    res = {}
    for nombre, pa in a.items():
        pb = b.get(nombre, [])
        difs = []
        for x, y in pa:
            yb = interpolar(pb, x)
            if yb is not None:
                difs.append((x, yb - y))
        if not difs:
            res[nombre] = None
            continue
        peor = max(difs, key=lambda d: abs(d[1]))
        ordenadas = sorted(abs(d[1]) for d in difs)
        res[nombre] = {
            "n": len(difs),
            "max": round(abs(peor[1]), 2), "x_peor": round(peor[0]),
            "medio": round(sum(ordenadas) / len(ordenadas), 2),
            # El p95 y el recuento de columnas fuera de 2px dicen si el máximo es un pico
            # aisladoel canto izquierdo, donde la curva va casi vertical y medio píxel
            # horizontal son dos verticales o una desviación de verdad.
            "p95": round(ordenadas[int(len(ordenadas) * 0.95)], 2),
            "fuera_2px": sum(1 for v in ordenadas if v > 2),
            "cobertura": f"{round(pb[0][0]) if pb else ''}–{round(pb[-1][0]) if pb else ''}",
        }
    return res


def regiones(cajas: dict, retrato: dict, alto: int) -> list[tuple[str, tuple[int, int, int, int]]]:
    """Las zonas del carné sobre las que se cuenta el diff, sacadas de las propias cotas."""
    def c(k, campo, alt):
        v = cajas.get(k)
        return int(v[campo]) if v else alt

    return [
        # El corte de la cabecera va en 300 porque el punto más alto del telón, en el canto
        # derecho, está en 301: así la banda curva no entra en la región del lockup.
        ("cabecera (navy + lockup + G-TALKS)", (0, 0, 1024, 300)),
        ("telón: navy, banda y papel", (0, 300, 1024, int(retrato.get("y_superior", 470)) - 6)),
        ("retrato", (int(retrato.get("cx", 512) - retrato.get("ancho", 509) / 2) - 8,
                     int(retrato.get("y_superior", 470)) - 8,
                     int(retrato.get("cx", 512) + retrato.get("ancho", 509) / 2) + 8,
                     int(retrato.get("y_inferior", 978)) + 8)),
        ("nombre y regla", (0, c("nombre", "y", 997) - 12, 1024, c("regla_celeste", "y2", 1123) + 12)),
        ("cargo", (0, c("cargo", "y", 1149) - 10, 1024, c("cargo", "y2", 1187) + 10)),
        ("píldora", (0, c("pildora", "y", 1236) - 10, 1024, c("pildora", "y2", 1369) + 10)),
        ("pie (los dos renglones)",
         (0, c("pie_dia", "y", 1408) - 12, 1024, c("pie_lugar", "y2", 1495) + 8)),
        ("banda inferior", (0, c("pie_lugar", "y2", 1495) + 8, 1024, alto)),
    ]


def main() -> None:
    ref_img, ren_img = cargar()
    ancho, alto = ref_img.size
    ref, ren = medir.Lienzo(ref_img), medir.Lienzo(ren_img)

    cajas_ref = medir.medir_elementos(ref)
    cajas_ren = medir.medir_elementos(ren)
    ret_ref = medir.medir_retrato(ref)
    ret_ren = medir.medir_retrato(ren)
    cur_ref = medir.curvas_carne(ref)
    cur_ren = medir.curvas_carne(ren)
    dif_cur = comparar_curvas(cur_ref, cur_ren)

    # ── Mapa de diferencias ─────────────────────────────────────────────────────
    delta = ImageChops.difference(ref_img, ren_img).convert("L")
    mascara = delta.point(lambda v: 255 if v > TOLERANCIA else 0, mode="1")
    mapa = Image.new("RGB", (ancho, alto), (255, 255, 255))
    mapa.paste(Image.new("RGB", (ancho, alto), (214, 24, 108)), mask=mascara)

    lado = Image.new("RGB", (ancho * 3 + 24, alto), (24, 24, 28))
    lado.paste(ref_img, (0, 0))
    lado.paste(ren_img, (ancho + 12, 0))
    lado.paste(mapa, (ancho * 2 + 24, 0))
    d = ImageDraw.Draw(lado)
    for i, t in enumerate(("pieza", "render", "diferencias")):
        d.text((i * (ancho + 12) + 10, 8), t, fill=(255, 255, 255))
    lado.save(DIR / "lado-a-lado.png")

    # ── Diff por región ─────────────────────────────────────────────────────────
    filas_px = []
    for nombre, (x0, y0, x1, y1) in regiones(cajas_ref, ret_ref, alto):
        y0, y1 = max(0, y0), min(alto, y1)
        if y1 <= y0:
            continue
        recorte = mascara.crop((x0, y0, x1, y1))
        n = recorte.histogram()[-1]
        total = (x1 - x0) * (y1 - y0)
        med = ImageChops.difference(ref_img, ren_img).crop((x0, y0, x1, y1)).convert("L")
        h = med.histogram()
        medio = sum(i * c for i, c in enumerate(h)) / max(1, sum(h))
        filas_px.append((nombre, f"{y0}–{y1}", 100 * n / total, medio))

    # ── Informe ─────────────────────────────────────────────────────────────────
    L = ["# Escarapela: render contra pieza\n",
         "Generado por `scripts/escarapela-diff.py`. No editar a mano.\n",
         f"Referencia y render: {ancho}×{alto}. Tolerancia de antialias: {TOLERANCIA}/255.\n",
         "## 1. Cotas (px de un carné de 1024 de ancho)\n",
         "Δ positivo = el render está más a la derecha / más abajo / es más grande.\n",
         "| elemento | x | Δx | y | Δy | ancho | Δancho | alto | Δalto | cx | Δcx |",
         "|---|---|---|---|---|---|---|---|---|---|---|"]
    peores = []
    for k in cajas_ref:
        a, b = cajas_ref.get(k), cajas_ren.get(k)
        if not a:
            continue
        if not b:
            L.append(f"| {k} | {a.get('x', '')} | **sin medir** | {a['y']} | | "
                     f"{a.get('ancho', '')} | | {a['alto']} | | | |")
            peores.append((999, k, "no se encontró en el render"))
            continue
        def par(campo):
            if campo not in a or campo not in b:
                return "", "", 0
            return a[campo], f"{b[campo] - a[campo]:+.0f}", abs(b[campo] - a[campo])
        vx, dx, ax = par("x"); vy, dy, ay = par("y")
        vw, dw, aw = par("ancho"); vh, dh, ah = par("alto")
        vc, dc, ac = par("cx")
        L.append(f"| {k} | {vx} | {dx} | {vy} | {dy} | {vw} | {dw} | {vh} | {dh} | {vc} | {dc} |")
        peor = max(ax, ay, aw, ah, ac)
        if peor >= 3:
            peores.append((peor, k, f"x{dx} y{dy} an{dw} al{dh}"))

    L += ["\n### Retrato\n", "| medida | pieza | render | Δ |", "|---|---|---|---|"]
    for k in ret_ref:
        va, vb = ret_ref.get(k), ret_ren.get(k)
        if va is None or vb is None:
            L.append(f"| {k} | {va} | {vb} | |")
            continue
        L.append(f"| {k} | {va} | {vb} | {vb - va:+.1f} |")
        if abs(vb - va) >= 3:
            peores.append((abs(vb - va), f"retrato.{k}", f"{vb - va:+.1f}"))

    L += ["\n## 2. Curvas de los telones\n",
          "Desviación del render respecto de la pieza, columna a columna.\n",
          "| curva | columnas | desv. máx | en x | p95 | media | fuera de 2px | tramo medido |",
          "|---|---|---|---|---|---|---|---|"]
    for k, v in dif_cur.items():
        if not v:
            L.append(f"| {k} | | **sin medir en el render** | | | |")
            peores.append((999, f"curva {k}", "no se encontró en el render"))
            continue
        L.append(f"| {k} | {v['n']} | {v['max']} px | {v['x_peor']} | {v['p95']} px | {v['medio']} px | "
                 f"{v['fuera_2px']} | {v['cobertura']} |")
        if v["p95"] >= 2:
            peores.append((v["p95"], f"curva {k}",
                           f"p95 {v['p95']}px · máx {v['max']}px en x={v['x_peor']}"))

    L += ["\n## 3. Píxeles distintos por región\n",
          "| región | filas | % distinto | delta medio |", "|---|---|---|---|"]
    for nombre, rango, pct, medio in filas_px:
        L.append(f"| {nombre} | {rango} | {pct:.1f}% | {medio:.1f} |")

    L += ["\n### Tinta muestreada a los dos lados\n",
          "Un porcentaje alto con las cotas cuadradas casi siempre es esto y no un "
          "desplazamiento.\n",
          "| zona | pieza | render |", "|---|---|---|"]
    for nombre, (x, y) in {"navy de la cabecera": (60, 200), "banda celeste": (950, 318),
                           "papel": (950, 1050), "píldora": (600, 1250),
                           "banda inferior": (950, 1545)}.items():
        L.append(f"| {nombre} | {ref.muestra(x, y)} | {ren.muestra(x, y)} |")

    L += ["\n## Lo peor, en orden\n"]
    if peores:
        for p, k, det in sorted(peores, reverse=True)[:18]:
            L.append(f"- **{k}** {det}")
    else:
        L.append("- nada por encima del umbral: 3 px en las cotas, 2 px en las curvas.")
    (DIR / "metricas.md").write_text("\n".join(L) + "\n", "utf-8")

    print(f"lado-a-lado.png y metricas.md → {DIR}")
    for k, v in dif_cur.items():
        print(f"  curva {k}: p95 {v['p95']} px · máx {v['max']} px en x={v['x_peor']} · "
              f"{v['fuera_2px']}/{v['n']} columnas fuera de 2px" if v else f"  curva {k}: sin medir")
    print("  cotas fuera de 3 px: " + (", ".join(k for _, k, _ in sorted(peores, reverse=True))
                                       if peores else "ninguna"))


if __name__ == "__main__":
    main()

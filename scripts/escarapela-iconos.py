"""Vectoriza los tres iconos SÓLIDOS del carné desde la pieza oficial.

    .venv-design/Scripts/python scripts/escarapela-iconos.py

Escribe `public/img/carne-personas.svg`, `carne-calendario.svg` y `carne-lugar.svg`, e imprime
los `ratio` que hay que pegar en `src/design/iconos-extra.ts`.

Por qué existe este script en vez de redibujar los iconos a mano:

La pieza nueva cambió los tres iconos del carné de **contorno a sólido**, y además añadió cosas
que no estaban (la peana elíptica bajo el alfiler, los cinco cuadrados dentro del calendario).
Redibujarlos «parecido» es exactamente la aproximación a ojo que el resto del arnés existe para
evitar: aquí el contorno sale de los píxeles.

Cómo, y por qué así:

1. **El campo alfa se proyecta sobre la recta fondo→tinta**, no se umbraliza. Un píxel del canto
   es una mezcla de las dos tintas, y su posición en esa recta ES su cobertura. Umbralizar tira
   esa información y deja el contorno dentado a escalones de un píxel entero.
2. **Se amplía ×4 con LANCZOS antes de trazar.** La pieza es un JPEG: sin ese suavizado, el
   contorno hereda el rizado del bloque 8×8 de la compresión.
3. **Marching squares a 0.5**, que da el contorno con subpíxel y cierra solo los agujeros (el
   hueco blanco del alfiler, el panel del calendario). Con `fill-rule="evenodd"` los cuadrados
   de dentro del calendarioislas dentro del agujero— vuelven a pintarse sin tratarlos aparte.
4. **Douglas-Peucker a 0.3 px** de la pieza: por debajo del cuarto de píxel no hay información
   real que conservar, y por encima se empiezan a achatar las curvas del alfiler.

El `viewBox` es la CAJA DE TINTA del icono, no una caja de dibujo con aire alrededor. Es lo que
permite que `Icono.tsx` lo coloque por su alto medido sin descontar márgenes: el alto del SVG es
el alto de la tinta.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = Path(__file__).resolve().parent.parent
PIEZA = RAIZ / "Carnet-foro-1.jpg (1).jpeg"
SALIDA = RAIZ / "public" / "img"

ESCALA = 4       # ampliación antes de trazar
TOLERANCIA = 0.3  # px de la pieza; el simplificado no baja de aquí
NIVEL = 0.5

# Ventanas en px de la pieza, con la tinta y el fondo de cada icono. Las ventanas encierran un
# icono y nada más: entre el calendario y el alfiler solo hay 8 px de aire.
ICONOS = {
    "carne-personas": {
        "ventana": (140, 1327, 265, 1420), "tinta": (111, 191, 224), "fondo": (31, 46, 85),
        "etiqueta": "Asistentes",
    },
    "carne-calendario": {
        "ventana": (125, 1475, 182, 1527), "tinta": (31, 46, 85), "fondo": (255, 255, 255),
        "etiqueta": "Fecha",
    },
    "carne-lugar": {
        "ventana": (127, 1524, 178, 1585), "tinta": (31, 46, 85), "fondo": (255, 255, 255),
        "etiqueta": "Lugar",
    },
}


def campo_alfa(img: Image.Image, ventana, tinta, fondo) -> list[list[float]]:
    """Cobertura de tinta de cada píxel: su proyección sobre la recta fondo→tinta.

    Devuelve valores fuera de [0,1] recortados. Es un modelo de DOS tintas: vale porque cada
    icono vive sobre una masa plana (la píldora o el papel) y no hay una tercera de por medio.
    """
    x0, y0, x1, y1 = ventana
    px = img.load()
    d = [t - f for t, f in zip(tinta, fondo)]
    den = sum(v * v for v in d) or 1.0
    campo = []
    for y in range(y0, y1):
        fila = []
        for x in range(x0, x1):
            p = px[x, y]
            t = sum((p[i] - fondo[i]) * d[i] for i in range(3)) / den
            fila.append(min(1.0, max(0.0, t)))
        campo.append(fila)
    return campo


def caja_tinta(campo) -> tuple[int, int, int, int]:
    ys = [y for y, fila in enumerate(campo) if any(v > NIVEL for v in fila)]
    xs = [x for x in range(len(campo[0])) if any(fila[x] > NIVEL for fila in campo)]
    return min(xs), min(ys), max(xs) + 1, max(ys) + 1


def ampliar(campo, escala: int):
    alto, ancho = len(campo), len(campo[0])
    im = Image.new("F", (ancho, alto))
    im.putdata([v for fila in campo for v in fila])
    im = im.resize((ancho * escala, alto * escala), Image.LANCZOS)
    px = im.load()
    return [[px[i, j] for i in range(ancho * escala)] for j in range(alto * escala)]


def marching_squares(g, nivel: float) -> list[list[tuple[float, float]]]:
    """Contornos cerrados del nivel `nivel`, con subpíxel en cada cruce.

    Los dos casos ambiguos (esquinas opuestas dentro) se resuelven por el promedio de las
    cuatro esquinas, que es lo que decide si el istmo del centro está dentro o fuera. Sin eso,
    dos masas que se tocan en diagonalel hombro del grupo de personas— se unen o se parten
    según el orden de recorrido, y el contorno deja de cerrar.
    """
    alto, ancho = len(g), len(g[0])
    segmentos: list[tuple[tuple[float, float], tuple[float, float]]] = []

    def interp(v0, v1, p0, p1):
        t = 0.5 if v1 == v0 else (nivel - v0) / (v1 - v0)
        t = min(1.0, max(0.0, t))
        return (p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t)

    for j in range(alto - 1):
        for i in range(ancho - 1):
            a, b = g[j][i], g[j][i + 1]
            c, d = g[j + 1][i + 1], g[j + 1][i]
            idx = (a > nivel) | ((b > nivel) << 1) | ((c > nivel) << 2) | ((d > nivel) << 3)
            if idx in (0, 15):
                continue
            T = interp(a, b, (i, j), (i + 1, j))
            R = interp(b, c, (i + 1, j), (i + 1, j + 1))
            B = interp(d, c, (i, j + 1), (i + 1, j + 1))
            L = interp(a, d, (i, j), (i, j + 1))
            if idx in (1, 14):
                segmentos.append((L, T))
            elif idx in (2, 13):
                segmentos.append((T, R))
            elif idx in (3, 12):
                segmentos.append((L, R))
            elif idx in (4, 11):
                segmentos.append((R, B))
            elif idx in (6, 9):
                segmentos.append((T, B))
            elif idx in (7, 8):
                segmentos.append((L, B))
            elif idx == 5:
                if (a + b + c + d) / 4 > nivel:
                    segmentos += [(T, R), (B, L)]
                else:
                    segmentos += [(L, T), (R, B)]
            elif idx == 10:
                if (a + b + c + d) / 4 > nivel:
                    segmentos += [(L, T), (R, B)]
                else:
                    segmentos += [(T, R), (B, L)]

    # ── Encadenar los segmentos en bucles cerrados ──────────────────────────────
    # Los extremos que comparten dos celdas se calculan con la MISMA interpolación sobre los
    # mismos dos valores, así que coinciden bit a bit y sirven de clave directamente.
    vecinos: dict[tuple[float, float], list[tuple[float, float]]] = {}
    for p, q in segmentos:
        vecinos.setdefault(p, []).append(q)
        vecinos.setdefault(q, []).append(p)

    bucles, vistos = [], set()
    for inicio in list(vecinos):
        if inicio in vistos:
            continue
        bucle, actual, previo = [inicio], inicio, None
        vistos.add(inicio)
        while True:
            siguientes = [v for v in vecinos.get(actual, []) if v != previo and v not in vistos]
            if not siguientes:
                break
            previo, actual = actual, siguientes[0]
            vistos.add(actual)
            bucle.append(actual)
        if len(bucle) >= 4:
            bucles.append(bucle)
    return bucles


def simplificar(pts, tol: float):
    """Douglas-Peucker sobre un bucle cerrado."""
    def dp(p, ini, fin):
        if fin <= ini + 1:
            return [ini]
        x0, y0 = p[ini]
        x1, y1 = p[fin]
        dx, dy = x1 - x0, y1 - y0
        n = (dx * dx + dy * dy) ** 0.5
        peor, idx = -1.0, ini
        for k in range(ini + 1, fin):
            x, y = p[k]
            dist = (abs(dy * x - dx * y + x1 * y0 - y1 * x0) / n if n
                    else ((x - x0) ** 2 + (y - y0) ** 2) ** 0.5)
            if dist > peor:
                peor, idx = dist, k
        if peor <= tol:
            return [ini]
        return dp(p, ini, idx) + dp(p, idx, fin)

    if len(pts) < 4:
        return pts
    # Un bucle no tiene extremos: se parte por el punto más lejano del primero para que el
    # simplificado no ancle dos vértices arbitrarios.
    p0 = pts[0]
    corte = max(range(len(pts)), key=lambda k: (pts[k][0] - p0[0]) ** 2 + (pts[k][1] - p0[1]) ** 2)
    a = pts[:corte + 1]
    b = pts[corte:] + [pts[0]]
    return [a[i] for i in dp(a, 0, len(a) - 1)] + [b[i] for i in dp(b, 0, len(b) - 1)]


def main() -> None:
    img = Image.open(PIEZA).convert("RGB")
    SALIDA.mkdir(parents=True, exist_ok=True)
    print(f"{PIEZA.name}\n")
    for nombre, cfg in ICONOS.items():
        campo = campo_alfa(img, cfg["ventana"], cfg["tinta"], cfg["fondo"])
        bx0, by0, bx1, by1 = caja_tinta(campo)
        pad = 2
        sub = [fila[max(0, bx0 - pad):bx1 + pad]
               for fila in campo[max(0, by0 - pad):by1 + pad]]
        ancho_t, alto_t = bx1 - bx0, by1 - by0
        g = ampliar(sub, ESCALA)

        despl_x = bx0 - max(0, bx0 - pad)
        despl_y = by0 - max(0, by0 - pad)
        trozos = []
        for bucle in marching_squares(g, NIVEL):
            # de índice ampliado → px de la sub-ventana → px de la caja de tinta
            orig = [((u + 0.5) / ESCALA - 0.5 - despl_x, (v + 0.5) / ESCALA - 0.5 - despl_y)
                    for u, v in bucle]
            s = simplificar(orig, TOLERANCIA)
            if len(s) < 3:
                continue
            d = f"M{s[0][0]:.2f} {s[0][1]:.2f}" + "".join(f"L{x:.2f} {y:.2f}" for x, y in s[1:])
            trozos.append(d + "Z")

        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {ancho_t} {alto_t}" '
               f'role="img" aria-label="{cfg["etiqueta"]}">\n'
               f'  <path fill="currentColor" fill-rule="evenodd" d="{"".join(trozos)}" />\n'
               f'</svg>\n')
        (SALIDA / f"{nombre}.svg").write_text(svg, "utf-8")
        print(f"  {nombre}.svg  viewBox 0 0 {ancho_t} {alto_t}  "
              f"ratio: {ancho_t} / {alto_t}  ({len(trozos)} contornos, "
              f"{sum(t.count('L') for t in trozos)} vértices, {len(svg)} B)")


if __name__ == "__main__":
    main()

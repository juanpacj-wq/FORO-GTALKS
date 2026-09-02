"""Vectoriza la marca GECELCA (2026) desde los raster de Comunicaciones.

    .venv-design/Scripts/python scripts/build-marca-gecelca.py

Lee `marca-origen/G-color.jpg` (1000×1000) y `marca-origen/Logo-gecelca-color.jpg` (2000×495),
carpeta ignorada por git, y escribe `public/img/marca-g.svg` y `public/img/logo-gecelca.svg`.
Imprime las tintas medidas, la caja de tinta de cada pieza y su proporción, que es lo que hay que
pegar en `ASPECTO_MARCA` (src/data/qr-arte.ts).

Por qué existe: la marca de GECELCA cambió en agosto de 2026 y Comunicaciones la entregó SOLO en
raster (JPG y PNG). Los SVG anteriores salían de los PDF del foro, con la marca vieja (#004A96 y
#006533). Redibujar la nueva «parecida» es la aproximación a ojo que todo el arnés de este repo
existe para evitar: aquí el contorno y los colores salen de los píxeles.

Cómo, y por qué así (el mismo método de scripts/escarapela-iconos.py, con una diferencia):

1. **Las tintas se MIDEN**, no se citan: el color exacto más frecuente de cada masa. El script
   aborta si se apartan más de 2/255 por canal de lo que el plan esperaba, para que una entrega
   distinta no pase en silencio.
2. **Dos tintas que se tocan.** La hoja verde va montada sobre la G azul, así que el modelo de
   una tinta sobre fondo del vectorizador de iconos no sirve: un píxel del canto entre ambas es
   mezcla de azul y verde, no de tinta y blanco. Cada píxel se descompone por mínimos cuadrados
   en `blanco + b·(azul−blanco) + g·(verde−blanco)`, y `b` y `g` son las coberturas de cada
   tinta. Así el canto azul/verde queda con subpíxel igual que el canto tinta/papel.
3. **Se amplía ×4 con LANCZOS antes de trazar.** Son JPEG: sin ese suavizado, el contorno hereda
   el rizado del bloque 8×8 de la compresión.
4. **Marching squares a 0.5** (vectorizado con numpy: la G mide 900 px y el logo 2000, y el bucle
   en Python puro de los iconos del carné tardaría minutos) y **Douglas-Peucker a 0.3 px** de la
   pieza, los mismos umbrales que en los iconos.

El `viewBox` de cada SVG es la CAJA DE TINTA de la pieza, sin aire: `ASPECTO_MARCA` es
literalmente alto/ancho de esa caja, y `cajaMarca()` en qr-arte.ts coloca la G por su ancho.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = Path(__file__).resolve().parent.parent
ORIGEN = RAIZ / "marca-origen"
SALIDA = RAIZ / "public" / "img"

ESCALA = 4        # ampliación antes de trazar
TOLERANCIA = 0.3  # px de la pieza; el simplificado no baja de aquí
NIVEL = 0.5
FONDO = (255, 255, 255)

# Lo que el plan esperaba (medido antes con PowerShell); el script lo re-mide y compara.
ESPERADO = {"azul": (0x00, 0x53, 0xA3), "verde": (0x00, 0x99, 0x50)}
TOLERANCIA_TINTA = 2

PIEZAS = {
    "marca-g": {
        "archivo": "G-color.jpg",
        "etiqueta": "Gecelca",
        "nota": (
            "La «G» de Gecelca sola, vectorizada de marca-origen/G-color.jpg por\n"
            "       scripts/build-marca-gecelca.py (marca 2026; tintas y contorno medidos, no dibujados).\n"
            "       Marca bicolor de colores fijos: va como imagen, nunca por Icono/mask. La usa el\n"
            "       centro del QR de la escarapela y de la carta de presentación."
        ),
    },
    "logo-gecelca": {
        "archivo": "Logo-gecelca-color.jpg",
        "etiqueta": "Gecelca",
        "nota": (
            "El logo completo de Gecelca (G + wordmark), vectorizado de\n"
            "       marca-origen/Logo-gecelca-color.jpg por scripts/build-marca-gecelca.py (marca 2026).\n"
            "       Marca bicolor de colores fijos: va como imagen, nunca por Icono/mask."
        ),
    },
}


def medir_tintas(img: np.ndarray) -> dict[str, tuple[int, int, int]]:
    """Los dos colores exactos más frecuentes que no son blanco: azul (más área) y verde."""
    plano = img.reshape(-1, 3)
    no_blanco = plano[~np.all(plano > 235, axis=1)]
    claves = (no_blanco[:, 0].astype(np.int64) << 16) | (no_blanco[:, 1].astype(np.int64) << 8) | no_blanco[:, 2]
    valores, cuentas = np.unique(claves, return_counts=True)
    orden = np.argsort(-cuentas)
    colores = []
    for k in valores[orden]:
        c = (int(k >> 16) & 255, int(k >> 8) & 255, int(k) & 255)
        # Dos tintas bien distintas: la segunda tiene que estar lejos de la primera.
        if all(sum(abs(a - b) for a, b in zip(c, o)) > 60 for o in colores):
            colores.append(c)
        if len(colores) == 2:
            break
    azul, verde = sorted(colores, key=lambda c: -c[2])  # el de más azul es el azul
    return {"azul": azul, "verde": verde}


def comprobar_tintas(tintas):
    for nombre, esperado in ESPERADO.items():
        medido = tintas[nombre]
        desvio = max(abs(a - b) for a, b in zip(medido, esperado))
        print(f"  tinta {nombre}: medida #{medido[0]:02x}{medido[1]:02x}{medido[2]:02x} "
              f"(esperada #{esperado[0]:02x}{esperado[1]:02x}{esperado[2]:02x}, desvío máx {desvio}/255)")
        if desvio > TOLERANCIA_TINTA:
            raise SystemExit(f"  ABORTA: la tinta {nombre} se aparta más de {TOLERANCIA_TINTA}/255 de lo esperado. "
                             "¿Entrega distinta? Revisa marca-origen/ antes de regenerar.")


def campos_dos_tintas(img: np.ndarray, azul, verde) -> tuple[np.ndarray, np.ndarray]:
    """Cobertura de cada tinta por píxel: `p − blanco = b·(azul − blanco) + g·(verde − blanco)`.

    Mínimos cuadrados en RGB (3 ecuaciones, 2 incógnitas), recortado a [0, 1]. Un píxel del
    canto azul/verde sale con b + g ≈ 1 repartido, que es exactamente su cobertura.
    """
    W = np.array(FONDO, dtype=np.float64)
    A = np.stack([np.array(azul, float) - W, np.array(verde, float) - W], axis=1)  # 3×2
    pinv = np.linalg.pinv(A)  # 2×3
    P = img.astype(np.float64).reshape(-1, 3) - W
    coef = P @ pinv.T
    coef = np.clip(coef, 0.0, 1.0)
    b = coef[:, 0].reshape(img.shape[:2])
    g = coef[:, 1].reshape(img.shape[:2])
    return b, g


def caja_tinta(campo: np.ndarray) -> tuple[int, int, int, int]:
    ys = np.where((campo > NIVEL).any(axis=1))[0]
    xs = np.where((campo > NIVEL).any(axis=0))[0]
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def ampliar(campo: np.ndarray, escala: int) -> np.ndarray:
    alto, ancho = campo.shape
    im = Image.fromarray(campo.astype(np.float32), mode="F")
    im = im.resize((ancho * escala, alto * escala), Image.LANCZOS)
    return np.asarray(im, dtype=np.float64)


def marching_squares(g: np.ndarray, nivel: float) -> list[list[tuple[float, float]]]:
    """Contornos cerrados del nivel `nivel`, con subpíxel en cada cruce. Vectorizado.

    Misma tabla de casos que scripts/escarapela-iconos.py, incluidos los dos ambiguos (5 y 10),
    resueltos por el promedio de las cuatro esquinas. Los extremos compartidos por dos celdas se
    calculan con la MISMA interpolación sobre los mismos dos valores, así que coinciden bit a bit
    y sirven de clave para encadenar.
    """
    a = g[:-1, :-1]
    b = g[:-1, 1:]
    c = g[1:, 1:]
    d = g[1:, :-1]
    idx = (a > nivel).astype(np.uint8) | ((b > nivel).astype(np.uint8) << 1) | \
          ((c > nivel).astype(np.uint8) << 2) | ((d > nivel).astype(np.uint8) << 3)

    alto, ancho = a.shape
    J, I = np.mgrid[0:alto, 0:ancho].astype(np.float64)

    def interp(v0, v1, p0x, p0y, p1x, p1y):
        den = v1 - v0
        with np.errstate(divide="ignore", invalid="ignore"):
            t = np.where(den == 0, 0.5, (nivel - v0) / den)
        t = np.clip(t, 0.0, 1.0)
        return p0x + (p1x - p0x) * t, p0y + (p1y - p0y) * t

    T = interp(a, b, I, J, I + 1, J)
    R = interp(b, c, I + 1, J, I + 1, J + 1)
    B = interp(d, c, I, J + 1, I + 1, J + 1)
    L = interp(a, d, I, J, I, J + 1)
    puntos = {"T": T, "R": R, "B": B, "L": L}
    promedio = (a + b + c + d) / 4

    casos = {
        (1, 14): [("L", "T")], (2, 13): [("T", "R")], (3, 12): [("L", "R")],
        (4, 11): [("R", "B")], (6, 9): [("T", "B")], (7, 8): [("L", "B")],
    }
    segmentos: list[tuple[tuple[float, float], tuple[float, float]]] = []

    def volcar(mascara, pares):
        js, is_ = np.nonzero(mascara)
        for p, q in pares:
            px, py = puntos[p]
            qx, qy = puntos[q]
            for x0, y0, x1, y1 in zip(px[js, is_], py[js, is_], qx[js, is_], qy[js, is_]):
                segmentos.append(((float(x0), float(y0)), (float(x1), float(y1))))

    for claves, pares in casos.items():
        volcar(np.isin(idx, claves), pares)
    dentro = promedio > nivel
    volcar((idx == 5) & dentro, [("T", "R"), ("B", "L")])
    volcar((idx == 5) & ~dentro, [("L", "T"), ("R", "B")])
    volcar((idx == 10) & dentro, [("L", "T"), ("R", "B")])
    volcar((idx == 10) & ~dentro, [("T", "R"), ("B", "L")])

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


def _dp(p: list[tuple[float, float]], tol: float) -> list[int]:
    """Douglas-Peucker iterativo (los bucles de aquí tienen miles de puntos)."""
    n = len(p)
    if n < 3:
        return list(range(n))
    conservar = [False] * n
    conservar[0] = conservar[n - 1] = True
    pila = [(0, n - 1)]
    while pila:
        ini, fin = pila.pop()
        if fin <= ini + 1:
            continue
        x0, y0 = p[ini]
        x1, y1 = p[fin]
        dx, dy = x1 - x0, y1 - y0
        norma = (dx * dx + dy * dy) ** 0.5
        peor, idx = -1.0, ini
        for k in range(ini + 1, fin):
            x, y = p[k]
            if norma:
                dist = abs(dy * x - dx * y + x1 * y0 - y1 * x0) / norma
            else:
                dist = ((x - x0) ** 2 + (y - y0) ** 2) ** 0.5
            if dist > peor:
                peor, idx = dist, k
        if peor > tol:
            conservar[idx] = True
            pila.append((ini, idx))
            pila.append((idx, fin))
    return [k for k in range(n) if conservar[k]]


def simplificar(pts, tol: float):
    """Douglas-Peucker sobre un bucle cerrado, partido por el punto más lejano del primero."""
    if len(pts) < 4:
        return pts
    p0 = pts[0]
    corte = max(range(len(pts)), key=lambda k: (pts[k][0] - p0[0]) ** 2 + (pts[k][1] - p0[1]) ** 2)
    a = pts[:corte + 1]
    b = pts[corte:] + [pts[0]]
    ia = _dp(a, tol)
    ib = _dp(b, tol)
    return [a[i] for i in ia[:-1]] + [b[i] for i in ib[:-1]]


def trazar(campo: np.ndarray, caja) -> tuple[str, int]:
    """El `d` de una tinta dentro de la caja de la pieza, en px de la pieza (origen = caja)."""
    bx0, by0, bx1, by1 = caja
    pad = 2
    x0, y0 = max(0, bx0 - pad), max(0, by0 - pad)
    sub = campo[y0:by1 + pad, x0:bx1 + pad]
    g = ampliar(sub, ESCALA)
    despl_x, despl_y = bx0 - x0, by0 - y0
    trozos, vertices = [], 0
    for bucle in marching_squares(g, NIVEL):
        orig = [((u + 0.5) / ESCALA - 0.5 - despl_x, (v + 0.5) / ESCALA - 0.5 - despl_y) for u, v in bucle]
        s = simplificar(orig, TOLERANCIA)
        if len(s) < 3:
            continue
        vertices += len(s)
        trozos.append(f"M{s[0][0]:.2f} {s[0][1]:.2f}" + "".join(f"L{x:.2f} {y:.2f}" for x, y in s[1:]) + "Z")
    return "".join(trozos), vertices


def main() -> None:
    SALIDA.mkdir(parents=True, exist_ok=True)
    for nombre, cfg in PIEZAS.items():
        ruta = ORIGEN / cfg["archivo"]
        img = np.asarray(Image.open(ruta).convert("RGB"))
        print(f"{ruta.name} ({img.shape[1]}×{img.shape[0]})")
        tintas = medir_tintas(img)
        comprobar_tintas(tintas)
        azul, verde = tintas["azul"], tintas["verde"]
        campo_b, campo_g = campos_dos_tintas(img, azul, verde)
        total = np.maximum(campo_b, campo_g)
        caja = caja_tinta(total)
        ancho_t, alto_t = caja[2] - caja[0], caja[3] - caja[1]

        d_azul, v_azul = trazar(campo_b, caja)
        d_verde, v_verde = trazar(campo_g, caja)
        hexa = lambda c: f"#{c[0]:02x}{c[1]:02x}{c[2]:02x}"

        svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {ancho_t} {alto_t}" '
            f'role="img" aria-label="{cfg["etiqueta"]}">\n'
            f'  <!-- {cfg["nota"]} -->\n'
            f'  <path fill="{hexa(azul)}" fill-rule="evenodd" d="{d_azul}" />\n'
            f'  <path fill="{hexa(verde)}" fill-rule="evenodd" d="{d_verde}" />\n'
            "</svg>\n"
        )
        (SALIDA / f"{nombre}.svg").write_text(svg, "utf-8", newline="\n")
        print(f"  {nombre}.svg  caja de tinta x={caja[0]} y={caja[1]} ancho={ancho_t} alto={alto_t}  "
              f"viewBox 0 0 {ancho_t} {alto_t}  alto/ancho = {alto_t / ancho_t:.5f}  "
              f"({v_azul} vértices azul, {v_verde} verde, {len(svg)} B)\n")


if __name__ == "__main__":
    main()

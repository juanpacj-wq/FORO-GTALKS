"""Compara la tinta del lockup del hero contra la de la pieza que lo compone.

    npm run build && npm run preview            # en una terminal
    node scripts/lockup-compare.mjs             # en otra
    .venv-design/Scripts/python scripts/lockup-diff.py

El lockup del foronumeral «1», «Foro: / Energía / en Acción», la regla y «Retos y
oportunidades» está compuesto en `invitacion gtalk 2026.pdf` y el CSS lo replica con cada cota
en múltiplos del cuerpo del titular (ver docs/SISTEMA-DE-DISENO.md §El lockup del foro). Este
script comprueba que la réplica lo sea, y en cuánto se desvía.

Cómo, y por qué así:

1. **La pieza se rasteriza a la MISMA densidad de píxel por em que la captura del navegador.**
   Comparar un render a 3x contra la pieza a 200 dpi mide la resolución, no el diseño: el sesgo
   del antialias sobre un canto es de medio píxel, y medio píxel de la pieza a 200 dpi son nueve
   milésimas del cuerpo del orden de lo que se quiere medir. A la misma densidad, ese sesgo es
   el mismo a los dos lados y se cancela al restar.

2. **Las ventanas de medición son las mismas a los dos lados**, en múltiplos del cuerpo y con
   origen en el canto de la regla. Ni el recorte ni la posición del bloque en la página pueden
   introducir diferencias.

3. **No se mide con umbral binario sino estimando la COBERTURA de cada píxel.** Un umbral se
   mueve un par de píxeles según la densidad y el nivel de fondo, y los dos fondos son
   distintos: la pieza compone sobre `--gt-navy` y el sitio sobre `--gt-noche` con grano. De la
   cobertura salen tres cosas comparables: el **centroide**subpíxel, la **masa** de tinta
  delata un cambio de peso o de tracking y los **cantos al 50 %**, que sí son estables.

4. **El nivel de fondo es el MÁS ALTO de los tramos de campo limpio**, no el de uno cualquiera ni
   la mediana de cada ventana. En la pieza el campo del bloque **no es uniforme**: el círculo
   `--gt-navy-deep` (`#1D2A4C`) cubre casi todo el lockup y el `--gt-navy` (`#1F335E`) asoma por el
   canto izquierdo. Si se toma el nivel del navy-deep, el navy queda por encima y registra como
   tintaen el canal celeste, 0.11 de cobertura falsa sobre un área grande, que arrastra el
   centroide de «en Acción» quince centésimas del cuerpo. Tomando el más alto, cualquier variante
   del campo queda en cobertura 0. Se prueban varios tramos y se usan los que quepan en el
   recorte: a 390 px no hay margen a la izquierda del bloque donde poner uno.

5. **El blanco se separa del fondo por el canal rojo y el celeste por (verde − rojo)**, que en la
   tinta blanca vale ~0 y por tanto no contamina la ventana de «en Acción» con el descendente de
   la «g» de «Energía», que se le mete dentro.

Sin dependencias nuevas: PyMuPDF, Pillow y numpy, la misma venv de `extract-pdf-design.py`.
"""

import json
import sys
from pathlib import Path

import fitz
import numpy as np
from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
PIEZA = RAIZ / 'invitacion gtalk 2026.pdf'
ENTRADA = RAIZ / 'design-extract' / 'lockup'

# El cuerpo del titular en la pieza y el canto izquierdo / borde superior de la regla, en
# coordenadas de página (pt) y leídos del vector, no del ráster.
CUERPO_PIEZA = 39.1
REGLA_PIEZA = (43.1152, 156.48)
# Arranca en x = 8 pt y no en el margen de la pieza (42 pt) porque el tramo de campo de la
# izquierda necesita 0.55 del cuerpo a la izquierda de la regla, y desde el margen solo hay 0.02.
RECORTE_PIEZA = fitz.Rect(8, 20, 320, 200)

BLANCO, CELESTE = 'blanco', 'celeste'
# Nivel de tinta plena de cada canal: blanco puro, y (verde − rojo) del celeste #8BD0E5.
TINTA = {BLANCO: 255.0, CELESTE: 208.0 - 139.0}

# nombre -> (x0, y0, x1, y1, color), en múltiplos del cuerpo con origen en la regla.
VENTANAS = {
    'numeral':      (-0.25, -3.00, 1.45, -0.01, BLANCO),
    'L1 «Foro:»':   (1.50, -3.00, 6.50, -2.02, BLANCO),
    'L2 «Energía»': (1.50, -2.00, 6.50, -1.04, BLANCO),
    'L3 «en Acción»': (1.50, -1.35, 6.50, -0.15, CELESTE),
    'regla':        (-0.25, -0.005, 6.50, 0.066, BLANCO),
    'bajada':       (-0.25, 0.10, 6.50, 0.95, BLANCO),
}

# Tramos de campo limpio de donde sale el nivel de fondo. Se usan los que quepan en el recorte y
# se toma el MÁS ALTO de sus niveles: en la pieza el de la izquierda es `--gt-navy` y el de la
# derecha, el círculo `--gt-navy-deep`, y hay que quedarse con el navy.
CAMPOS = (
    (-0.55, -2.90, -0.18, -0.20),   # a la izquierda del conjunto: no cabe en móvil
    (6.15, -2.90, 6.45, -0.20),     # a la derecha, más allá del canto de la regla
    (0.50, 1.05, 5.50, 1.20),       # bajo la bajada, antes de la intro
)

# Umbral de aceptación, en PÍXELES del ráster de comparación y no en milésimas del cuerpo,
# porque es en píxeles donde vive el ruido que se quiere tolerar: la cota de la regla y la línea
# de base del texto las redondea el navegador por separado, así que discrepan hasta un píxel cada
# una aunque la maqueta sea exacta. Cuatro píxeles del ráster (que va a x3) son 1.3 px CSS con el
# titular en su techo de 6rem, y con el titular pequeño valen más milésimas del cuerpo que es
# justo como se comporta el ruido. Por eso conviene correr el diff al ancho de referencia: a
# 390 px un desplazamiento de sub-píxel ya vale 6 milésimas y no hay CSS que lo corrija.
TOLERANCIA_PX = 4.0
# La ventana de la regla queda fuera del veredicto: es una franja fina en la que el campo pesa
# más que la tinta y en la que entra el asta del «1», así que su centroide y su masa dependen
# del recorte. Lo que importa de la reglasu ancho y su cota se lee en los cantos.
SOLO_CANTOS = {'regla'}


def canal(sub, color):
    r, g = sub[:, :, 0].astype(float), sub[:, :, 1].astype(float)
    return r if color == BLANCO else g - r


def recortar(a, origen, cuerpo, x0, y0, x1, y1, estricto=True):
    ox, oy = origen
    caja = [int(round(v)) for v in (ox + x0 * cuerpo, oy + y0 * cuerpo,
                                    ox + x1 * cuerpo, oy + y1 * cuerpo)]
    # Un índice negativo en numpy no falla: cuenta desde el final y devolvería otra zona.
    dentro = min(caja) >= 0 and caja[2] <= a.shape[1] and caja[3] <= a.shape[0]
    sub = a[caja[1]:caja[3], caja[0]:caja[2]] if dentro else a[:0, :0]
    if sub.size == 0:
        if not estricto:
            return None, 0, 0
        raise SystemExit('Ventana %s fuera del recorte de la captura.' % caja)
    return sub, caja[0], caja[1]


def nivel_de_campo(a, origen, cuerpo):
    """El más alto de los tramos de campo que quepan, por canal (ver cabecera, punto 4)."""
    niveles = {c: [] for c in (BLANCO, CELESTE)}
    for x0, y0, x1, y1 in CAMPOS:
        sub, _, _ = recortar(a, origen, cuerpo, x0, y0, x1, y1, estricto=False)
        if sub is None:
            continue
        for c in niveles:
            niveles[c].append(float(np.median(canal(sub, c))))
    if not niveles[BLANCO]:
        raise SystemExit('El recorte no deja ningún tramo de campo limpio alrededor del bloque.')
    return {c: max(v) for c, v in niveles.items()}


def cobertura(sub, color, fondo):
    return np.clip((canal(sub, color) - fondo[color]) / (TINTA[color] - fondo[color]), 0.0, 1.0)


def medir(a, origen, cuerpo):
    """Por ventana: centroide, masa y cantos al 50 % de cobertura, normalizados."""
    ox, oy = origen
    fondo = nivel_de_campo(a, origen, cuerpo)
    out = {}
    for nombre, (x0, y0, x1, y1, color) in VENTANAS.items():
        sub, px0, py0 = recortar(a, origen, cuerpo, x0, y0, x1, y1)
        cov = cobertura(sub, color, fondo)
        masa = cov.sum()
        if masa < 1:
            out[nombre] = None
            continue
        ys, xs = np.nonzero(cov > 0)
        w = cov[ys, xs]
        medio = np.nonzero(cov >= 0.5)
        out[nombre] = {
            'cx': (px0 + (xs * w).sum() / masa - ox) / cuerpo,
            'cy': (py0 + (ys * w).sum() / masa - oy) / cuerpo,
            'ancho': (medio[1].max() + 1 - medio[1].min()) / cuerpo,
            'alto': (medio[0].max() + 1 - medio[0].min()) / cuerpo,
            'masa': masa / (cuerpo * cuerpo),
        }
    return out


def junta(a, origen, cuerpo, x0, x1):
    """Cota inferior de la tinta blanca en una banda vertical, al 50 % de cobertura.

    Sirve para lo único que no se puede fallar del bloque: que el serif del «1» y la regla sean
    un solo trazo. Se compara la cota bajo el asta contra la cota bajo la regla; si no son la
    misma, hay un escalón en la junta.
    """
    sub, _, py0 = recortar(a, origen, cuerpo, x0, -0.20, x1, 0.20)
    cov = cobertura(sub, BLANCO, nivel_de_campo(a, origen, cuerpo))
    # Por columna, la última fila con cobertura ≥ 0.5; se toma la mediana de las columnas.
    ultimas = [f.max() for f in (np.nonzero(cov[:, c] >= 0.5)[0] for c in range(cov.shape[1]))
               if len(f)]
    if not ultimas:
        return None
    return (py0 + float(np.median(ultimas)) + 1 - origen[1]) / cuerpo


def main():
    if not (ENTRADA / 'render.json').exists():
        raise SystemExit('Falta design-extract/lockup/render.json corre antes '
                         'node scripts/lockup-compare.mjs')
    d = json.loads((ENTRADA / 'render.json').read_text(encoding='utf-8'))
    a_nav = np.asarray(Image.open(ENTRADA / 'render.png').convert('RGB'))
    escala = d['escala']
    cuerpo = d['cuerpo'] * escala          # cuerpo del titular en px de imagen
    org_nav = ((d['regla']['x'] - d['clip']['x']) * escala,
               (d['regla']['y'] - d['clip']['y']) * escala)
    nav = medir(a_nav, org_nav, cuerpo)

    zoom = cuerpo / CUERPO_PIEZA
    pix = fitz.open(PIEZA)[0].get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=RECORTE_PIEZA)
    a_pza = np.asarray(Image.frombytes('RGB', (pix.width, pix.height), pix.samples))
    org_pza = ((REGLA_PIEZA[0] - RECORTE_PIEZA.x0) * zoom,
               (REGLA_PIEZA[1] - RECORTE_PIEZA.y0) * zoom)
    pza = medir(a_pza, org_pza, cuerpo)

    print('Lockup del foro render (%d px de ancho de ventana) contra invitacion gtalk 2026.pdf'
          % d['ancho'])
    print('  cuerpo del titular: %.2f px CSS · x%d = %.0f px por em (la pieza se rasteriza igual)'
          % (d['cuerpo'], escala, cuerpo))
    print('  peso %s (pieza 700) · interlínea %.4f (0.9089) · tracking %s (natural)'
          % (d['peso'], d['interlinea'] / d['cuerpo'], d['tracking']))
    print('  bajada %.4f del cuerpo (0.6177) · regla %.4f (0.0614)'
          % (d['cuerpoBajada'] / d['cuerpo'], d['grosorRegla'] / d['cuerpo']))
    print()
    print('%-16s %-27s %-27s %s' % ('', 'render   cx     cy   ancho  alto',
                                    'pieza    cx     cy   ancho  alto',
                                    'Δ en milésimas del cuerpo'))
    print('-' * 108)

    peor = ('', 0.0)
    for nombre in VENTANAS:
        n, p = nav[nombre], pza[nombre]
        if n is None or p is None:
            print('%-16s sin tinta en %s' % (nombre, 'el render' if n is None else 'la pieza'))
            peor = (nombre, 999.0)
            continue
        dif = [(n[k] - p[k]) * 1000 for k in ('cx', 'cy', 'ancho', 'alto')]
        juzgadas = dif[2:] if nombre in SOLO_CANTOS else dif
        for v in juzgadas:
            if abs(v) > peor[1]:
                peor = (nombre, abs(v))
        # En la regla el centroide no dice nada: la ventana es una franja fina donde el campo
        # pesa más que la tinta y donde entra el asta del «1». Se informan solo los cantos.
        muestra = ['%6.3f' % n[k] for k in ('cx', 'cy', 'ancho', 'alto')]
        muestrap = ['%6.3f' % p[k] for k in ('cx', 'cy', 'ancho', 'alto')]
        difs = ['%+6.1f' % v for v in dif]
        if nombre in SOLO_CANTOS:
            muestra[:2] = muestrap[:2] = ['    ', '    ']
            difs[:2] = ['    ', '    ']
        print('%-16s %s   %s   %s' % (nombre, ' '.join(muestra), ' '.join(muestrap),
                                      ' '.join(difs)))

    # La junta: el serif del «1» y la regla tienen que cerrar sin escalón, a los dos lados.
    print()
    for etq, a, origen in (('render', a_nav, org_nav), ('pieza', a_pza, org_pza)):
        bajo_asta = junta(a, origen, cuerpo, 0.20, 1.10)
        bajo_regla = junta(a, origen, cuerpo, 2.00, 6.00)
        paso = abs(bajo_asta - bajo_regla) * 1000
        if paso > peor[1]:
            peor = ('junta del serif con la regla (%s)' % etq, paso)
        print('junta serif/regla en %-7s cota bajo el asta %.4f · bajo la regla %.4f · escalón %+.1f'
              % (etq, bajo_asta, bajo_regla, paso))

    tolerancia = TOLERANCIA_PX * 1000 / cuerpo
    print()
    print('Desvío máximo: %s, %.1f milésimas del cuerpo = %.2f px del ráster'
          % (peor[0], peor[1], peor[1] / 1000 * cuerpo))
    print('Tolerancia: %.1f milésimas = %.0f px del ráster de comparación (%.2f px CSS).'
          % (tolerancia, TOLERANCIA_PX, tolerancia / 1000 * d['cuerpo']))
    if peor[1] > tolerancia:
        print('\nEl lockup NO reproduce la pieza. Las cotas están en '
              'src/pages/InicioPage.css §Titular.')
        return 1
    print('\nEl lockup reproduce la pieza: todo dentro de %.2f px.'
          % (tolerancia / 1000 * d['cuerpo']))
    return 0


if __name__ == '__main__':
    sys.exit(main())

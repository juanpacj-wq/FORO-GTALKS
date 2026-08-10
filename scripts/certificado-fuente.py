# La fuente del certificado se IDENTIFICA y se CALIBRA; no se adivina.
#
#   .venv-design/Scripts/python scripts/certificado-fuente.py
#
# ── Qué decide este script ───────────────────────────────────────────────────
#
# El nombre y la cédula que el generador pinta sobre la pieza tienen que salir de la MISMA fuente
# con la que Comunicaciones compuso la pieza; si no, el certificado se delata a simple vista. La
# pieza es un PNG (sin fuentes incrustadas), así que la fuente se identifica comparando el
# rasterizado de una frase real de la pieza contra el de cada candidata, con el método del bucle
# de `pieza-correo-hoy.py`: calibrar el cuerpo hasta clavar el ALTO del bloque, y juzgar por el
# ANCHO de la frase (el tracking natural no se toca) y por el solape de tinta (IoU).
#
# Urbanist quedó descartada a ojo y con razón tipográfica (a/g de dos pisos; la pieza los tiene
# de un piso) y Century Gothic quedó descartada con datos (+16.7 % de ancho a alto igual,
# IoU 0.159). Las candidatas vivas se descargaron de google/fonts (OFL) a `fuentes-origen/`, que
# se versiona con su licencia: sin la fuente no se puede regenerar ningún certificado.
#
# ── El fallo es cerrado ──────────────────────────────────────────────────────
#
# Si ninguna candidata explica la pieza, el script NO elige «la menos mala»: termina con error.
# Un diploma con la fuente parecida es exactamente la clase de «a ojo» que este repo no hace.
#
# ── El veredicto del 2026-08-10, y la decisión que lo siguió ────────────────
#
# Se midieron TRECE candidatas con tres arneses sucesivos (ancho de frase; ajuste por palabra con
# tracking; ajuste subpíxel de escala+tracking + IoU por palabra alineada + grosor de asta).
# Ninguna ES la fuente de la pieza: el mejor IoU alineado fue 0.608 (Poppins Regular), donde la
# fuente verdadera daría >0.8. Lo que sí quedó identificado con datos: el PESO — el asta de la
# pieza mide 3.00 px, exactamente la de Poppins Regular y Glacial Regular; toda Medium/Bold quedó
# descartada.
#
# El usuario decidió ese día: **Poppins Regular como fuente DEFINITIVA del nombre y la cédula**,
# aceptando la diferencia de formas como equivalente visual al cuerpo en que se pinta. La
# decisión queda como riesgo aceptado en docs/SEGURIDAD.md; este script se conserva tal cual
# —negándose— como testigo del método: si llega otra entrega de la pieza o aparece la fuente
# original, se corre otra vez y manda lo que mida.

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

RAIZ = Path(__file__).resolve().parent.parent
PIEZA = RAIZ / 'Certificado de participación.png'
FUENTES = RAIZ / 'fuentes-origen'

# Las frases testigo: TODO el cuerpo en regular de la pieza (la línea en negrilla del «1° Foro…»
# queda fuera). Una sola frase no discrimina — con ~10 palabras el ruido de ±1-2 px por borde
# tapa la señal—; con las cuatro son 27 palabras y el ajuste decide con autoridad.
FRASES = [
    ('Por su participación y asistencia al', 690, 740),
    ('espacio de diálogo sobre los desafíos y tendencias que están definiendo la', 780, 824),
    ('transformación energética del país.', 824, 868),
    ('Realizado el miércoles 5 de agosto de 2026  ·  Barranquilla, Colombia', 905, 955),
]
BANDA_X = (200, 1600)
UMBRAL_TINTA = 140                               # gris < umbral = tinta (la tinta es rgb(40,57,96))

CANDIDATAS = [
    ('Poppins Regular', FUENTES / 'Poppins-Regular.ttf', None),
    ('Poppins Medium', FUENTES / 'Poppins-Medium.ttf', None),
    ('Jost Regular', FUENTES / 'Jost-variable.ttf', 400),      # variable: eje wght
    ('Jost Medium', FUENTES / 'Jost-variable.ttf', 500),
    # Segunda tanda: geométricas con a/g de un piso que la primera no cubría.
    ('Glacial Indifference', FUENTES / 'GlacialIndifference-Regular.otf', None),  # la de cabecera de Canva
    ('Glacial Indiff. Bold', FUENTES / 'GlacialIndifference-Bold.otf', None),
    ('Didact Gothic', FUENTES / 'DidactGothic-Regular.ttf', None),
    ('Josefin Sans 400', FUENTES / 'JosefinSans-variable.ttf', 400),
    ('League Spartan 400', FUENTES / 'LeagueSpartan-variable.ttf', 400),
    ('ABeeZee', FUENTES / 'ABeeZee-Regular.ttf', None),
    # Tercera tanda: el ajuste por tracking les da otra oportunidad a las anchas, y entra la
    # geométrica de un piso de la familia Montserrat (otra habitual de Canva).
    ('Century Gothic', Path(r'C:\Windows\Fonts\GOTHIC.TTF'), None),
    ('Montserrat Altern.', FUENTES / 'MontserratAlternates-Regular.ttf', None),
    ('Montserrat Alt. Med', FUENTES / 'MontserratAlternates-Medium.ttf', None),
]

SUP = 4  # supermuestreo del rasterizado, como pieza-correo-hoy.py


def abortar(mensaje: str) -> None:
    print(f'\n✗ {mensaje}\n', file=sys.stderr)
    raise SystemExit(1)


def caja_de_tinta(gris: np.ndarray, y0: int, y1: int, x0: int, x1: int) -> tuple[int, int, int, int]:
    reg = gris[y0:y1, x0:x1] < UMBRAL_TINTA
    ys, xs = np.where(reg)
    if not len(ys):
        abortar('No hay tinta en la banda esperada: ¿llegó otra entrega de la pieza?')
    return x0 + xs.min(), x0 + xs.max(), y0 + ys.min(), y0 + ys.max()


def alfa(ruta_ttf: Path, cuerpo_sup: int, peso: int | None, texto: str) -> np.ndarray:
    """Cobertura 0..1 del texto rasterizado con antialias, recortada a su caja de tinta."""
    fuente = ImageFont.truetype(str(ruta_ttf), cuerpo_sup)
    if peso is not None:
        fuente.set_variation_by_axes([peso])
    lienzo = Image.new('L', (SUP * 2400, SUP * 300), 0)
    ImageDraw.Draw(lienzo).text((SUP * 40, SUP * 40), texto, font=fuente, fill=255)
    a = np.asarray(lienzo)
    ys, xs = np.where(a > 40)
    rec = lienzo.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    peq = rec.resize((max(1, rec.width // SUP), max(1, rec.height // SUP)), Image.LANCZOS)
    return np.asarray(peq).astype(np.float64) / 255.0


def ancho_subpixel(cobertura: np.ndarray, x0: int, x1: int) -> float:
    """Ancho de un tramo con precisión subpíxel: el perfil por columna (máximo de cobertura)
    cruza 0.5 en un punto interpolado a cada lado. Medir con umbral binario mete ±1 px por borde,
    y con palabras de ~100 px ese ruido es del orden de la señal que separa a las candidatas."""
    perfil = cobertura[:, max(0, x0 - 2):x1 + 3].max(axis=0)
    idx = np.where(perfil > 0.5)[0]
    if not len(idx):
        return float(x1 - x0 + 1)
    i, j = int(idx[0]), int(idx[-1])
    izq = i - (perfil[i] - 0.5) / max(perfil[i] - (perfil[i - 1] if i else 0.0), 1e-6)
    der = j + (perfil[j] - 0.5) / max(perfil[j] - (perfil[j + 1] if j + 1 < len(perfil) else 0.0), 1e-6)
    return float(der - izq)


def palabras_de_la_pieza(tinta: np.ndarray) -> list[tuple[int, int]]:
    """Corta el bloque de la frase en palabras por los huecos de columnas vacías.

    El umbral del hueco se saca del propio bloque: el hueco entre palabras es varias veces el
    hueco entre letras, así que se corta por los huecos mayores que 2× la mediana."""
    col = tinta.any(axis=0)
    huecos, ini = [], None
    for i, v in enumerate(col):
        if not v and ini is None:
            ini = i
        if v and ini is not None:
            huecos.append((ini, i - 1))
            ini = None
    anchos = sorted(b - a + 1 for a, b in huecos)
    mediana = anchos[len(anchos) // 2] if anchos else 4
    cortes = [h for h in huecos if (h[1] - h[0] + 1) > 2 * mediana]
    limites = [0] + [h[1] + 1 for h in cortes] + [tinta.shape[1]]
    tramos = []
    for a, b in zip(limites, limites[1:]):
        sub = tinta[:, a:b]
        xs = np.where(sub.any(axis=0))[0]
        if len(xs):
            tramos.append((a + int(xs.min()), a + int(xs.max())))
    return tramos


def medir_candidata(nombre: str, ruta: Path, peso: int | None,
                    alto_pieza: int, palabras_pieza: list[dict]):
    """Calibra el cuerpo por ALTO de bloque y ajusta el TRACKING por mínimos cuadrados.

    La composición pudo llevar tracking (Canva lo permite y es indetectable a simple vista), así
    que el ancho de la frase entera no identifica nada. Lo que sí identifica es esto: para la
    fuente verdadera existe UN tracking t tal que cada palabra mide su ancho natural + t·(n−1);
    para las demás no hay t que cuadre todas a la vez. Se ajusta t y se juzga por el residuo."""
    mejor = None
    for cuerpo in range(24, 72):
        a = alfa(ruta, cuerpo * SUP, peso, FRASES[0][0])
        d = abs(a.shape[0] - alto_pieza)
        if mejor is None or d < mejor[0]:
            mejor = (d, cuerpo)
    _, cuerpo = mejor

    # Ancho natural de cada palabra al cuerpo calibrado, también subpíxel.
    def natural(texto: str) -> float:
        a = alfa(ruta, cuerpo * SUP, peso, texto)
        return ancho_subpixel(a, 0, a.shape[1] - 1)

    naturales = [natural(p['texto']) for p in palabras_pieza]
    reales = [p['ancho'] for p in palabras_pieza]
    letras = [max(1, len(p['texto']) - 1) for p in palabras_pieza]

    # Mínimos cuadrados de DOS incógnitas: real_i = s·natural_i + t·letras_i. La escala `s`
    # absorbe el grano entero del cuerpo calibrado (±3 % a cuerpo 35) y cualquier sesgo del alto
    # del bloque; lo que separa a la fuente verdadera de las demás son las PROPORCIONES entre
    # palabras, que ninguna escala global puede arreglar.
    A = np.array([naturales, letras], dtype=float).T
    b = np.array(reales, dtype=float)
    (s, t), *_ = np.linalg.lstsq(A, b, rcond=None)
    residuos = b - A @ np.array([s, t])
    rms = float(np.sqrt((residuos ** 2).mean()))
    rms_rel = rms / float(b.mean())
    return dict(nombre=nombre, ruta=ruta, peso=peso, cuerpo=cuerpo, escala=float(s),
                tracking=float(t), rms=rms, rms_rel=rms_rel,
                peor=float(np.abs(residuos).max()))


def main() -> None:
    if not PIEZA.exists():
        abortar(f'No existe {PIEZA}')
    im = Image.open(PIEZA).convert('L')
    if im.size != (1755, 1241):
        abortar(f'La pieza mide {im.size}, no 1755×1241: llegó otra entrega. Re-medir antes de seguir.')
    gris = np.asarray(im)

    # Palabras de cada frase, casadas con su texto. El «·» se descarta: no discrimina.
    # La cobertura de la pieza (0..1) sale de invertir el gris sobre el fondo claro: la tinta es
    # rgb(40,57,96) sobre ~blanco, así que gris 255→0 de cobertura y gris ~44→1.
    palabras_pieza = []
    alto_ref = None
    for texto, y0, y1 in FRASES:
        bx0, bx1, by0, by1 = caja_de_tinta(gris, y0, y1, *BANDA_X)
        tinta_frase = gris[by0:by1 + 1, bx0:bx1 + 1] < UMBRAL_TINTA
        franja = gris[by0:by1 + 1, :].astype(np.float64)
        cobertura = np.clip((235.0 - franja) / (235.0 - 60.0), 0.0, 1.0)
        if alto_ref is None:
            alto_ref = by1 - by0 + 1   # la primera frase fija el alto de calibración
        tramos = [t for t in palabras_de_la_pieza(tinta_frase) if (t[1] - t[0] + 1) > 12]
        textos = [w for w in texto.split() if w != '·']
        if len(tramos) != len(textos):
            abortar(f'«{texto[:30]}…» se corta en {len(tramos)} palabras y el texto trae '
                    f'{len(textos)}: el corte por huecos no casa; revisar la banda.')
        palabras_pieza += [
            {'texto': t, 'ancho': ancho_subpixel(cobertura, bx0 + a, bx0 + b)}
            for t, (a, b) in zip(textos, tramos)
        ]
    alto_pieza = alto_ref
    print(f'\nTestigo: {len(FRASES)} frases del cuerpo, {len(palabras_pieza)} palabras '
          f'(anchos subpíxel), bloque de referencia {alto_pieza}px')

    print(f'\n{"candidata":22} {"cuerpo":>6} {"escala":>7} {"tracking":>9} {"RMS":>7} {"peor":>6}')
    print('─' * 66)
    fichas = []
    for nombre, ruta, peso in CANDIDATAS:
        if not ruta.exists():
            print(f'{nombre:22} (no descargada: se salta)')
            continue
        f = medir_candidata(nombre, ruta, peso, alto_pieza, palabras_pieza)
        fichas.append(f)
        print(f'{f["nombre"]:22} {f["cuerpo"]:>6} {f["escala"]:>7.3f} {f["tracking"]:>+8.2f}px '
              f'{f["rms_rel"]:>6.1%} {f["peor"]:>5.1f}px')

    # Identificada = residuo chico, escala verosímil, y SEPARADA de la primera candidata que no
    # sea de su misma familia (dos pesos de la misma fuente compartiendo podio no es ambigüedad).
    fichas.sort(key=lambda f: f['rms_rel'])
    ganadora = fichas[0]
    familia = ganadora['nombre'].split()[0]
    rival = next((f for f in fichas[1:] if not f['nombre'].startswith(familia)), None)
    ok_rms = ganadora['rms_rel'] <= 0.012
    ok_escala = 0.93 <= ganadora['escala'] <= 1.07
    ok_separada = rival is None or rival['rms_rel'] >= ganadora['rms_rel'] * 1.4
    if not (ok_rms and ok_escala and ok_separada):
        abortar(
            'Sin identificación concluyente '
            f"(mejor: {ganadora['nombre']} RMS {ganadora['rms_rel']:.1%} escala {ganadora['escala']:.3f}"
            + (f"; rival: {rival['nombre']} RMS {rival['rms_rel']:.1%}" if rival else '')
            + f'; criterios rms≤1.2%:{ok_rms} escala:{ok_escala} separación≥1.4×:{ok_separada}).\n'
            '  NO se elige «la menos mala»: hay que pedir a Comunicaciones la fuente original '
            'y añadirla a CANDIDATAS.'
        )

    # Glifos imprescindibles para los 134 nombres: Ñ y las vocales con tilde en mayúscula.
    from fontTools.ttLib import TTFont
    tt = TTFont(str(ganadora['ruta']))
    cmap = tt.getBestCmap()
    faltan = [c for c in 'ÑÁÉÍÓÚÜ.: ' if ord(c) not in cmap]
    if faltan:
        abortar(f'A {ganadora["nombre"]} le faltan glifos imprescindibles: {faltan}')

    print(f'\n✔ Identificada: {ganadora["nombre"]}  (cuerpo {ganadora["cuerpo"]}px para un bloque '
          f'de {alto_pieza}px, tracking {ganadora["tracking"]:+.2f}px, RMS {ganadora["rms_rel"]:.1%})')
    print('  Glifos Ñ/tildes/·: completos.')
    print('\nConstantes para certificados-generar.py:')
    print(f"  FUENTE     = fuentes-origen/{ganadora['ruta'].name}")
    print(f"  PESO_EJE   = {ganadora['peso']}")
    print(f"  TRACKING   = {ganadora['tracking']:+.2f}px por hueco, al cuerpo {ganadora['cuerpo']}px de esta frase")
    print('  # el cuerpo del nombre y la cédula se calibran aparte en el generador,')
    print('  # contra sus propias bandas; el tracking escala con el cuerpo.')


if __name__ == '__main__':
    main()

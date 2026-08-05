"""De «¡Mañana tenemos una importante cita!» a «¡Hoy tenemos una importante cita!».

    .venv-design/Scripts/python scripts/pieza-correo-hoy.py

`imagen correo qr.png` se compuso para salir el 4 de agosto, la víspera del foro. El envío del 5
—los rezagados que entraron al grupo esa misma mañana— los citaba para mañana cuando el foro era
ese día. El asunto se corrige en `server/correo/plantilla-envio-qr.js`; el titular de la pieza,
aquí.

## Por qué un script y no un retoque a mano

Misma regla que el resto de los assets del repo: nada se dibuja a ojo, todo se genera. Un PNG
editado a mano no se puede volver a producir cuando llegue otra entrega del arte, y nadie sabría
qué se tocó. Esto sí: entra la pieza original, sale la variante, y el diff es el archivo nuevo.

## Y por qué NO sobreescribe la original

`imagen correo qr.png` son los bytes que recibieron las 169 personas del 4 de agosto. Reemplazarla
haría que el repositorio afirmara que recibieron algo que no recibieron, y ningún arnés lo
gritaría: `envio-qr-test.mjs` compara el adjunto contra el ARCHIVO, no contra los bytes
históricos. Es exactamente la razón por la que este correo tiene su pieza aparte de la de
inscripción. Así que la variante va a un archivo nuevo y las dos se versionan.

## Las tres cosas que hacen que no se note

1. **Solo se sintetiza «Hoy».** El «¡» y el «tenemos» son los PÍXELES ORIGINALES, recortados y
   movidos: tres glifos nuevos entre glifos reales, con los de la segunda línea al lado para
   comparar. Rehacer la línea entera habría dejado dos renglones compuestos con dos fuentes.
2. **La fuente no se adivina: se ajusta.** Urbanist 36 px / peso 700 salió de minimizar la
   diferencia de píxeles contra la palabra «Mañana» del original (IoU 0.83, 135×26 px contra
   136×27). Urbanist es además la tipografía del sistema de diseño, autohospedada en
   `public/fonts/` — el .woff2 se convierte aquí mismo, no hay dependencia nueva.
3. **El espacio sale de la fuente, no de una resta.** El hueco entre «Hoy» y «tenemos» se mide
   componiendo «Hoy tenemos» con la misma Urbanist. Copiar los 12 px que había tras la «a» de
   «Mañana» habría dejado el renglón apretado: la «y» termina en diagonal y pide más aire.

El script comprueba la geometría del original antes de tocar nada y ABORTA si no es la que midió
(cotas de la línea 1, color de la tinta, tamaño del lienzo). Si llega una entrega nueva del arte,
se entera aquí en vez de escupir una pieza rota.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont

RAIZ = Path(__file__).resolve().parent.parent
ORIGEN = RAIZ / 'imagen correo qr.png'
DESTINO = RAIZ / 'imagen correo qr hoy.png'
FUENTE_WOFF2 = RAIZ / 'public' / 'fonts' / 'urbanist-latin.woff2'

# ── Lo medido sobre la pieza del 4 de agosto ────────────────────────────────
# Todo esto se comprueba antes de escribir: si el arte cambia, el script se planta.
LIENZO = (873, 1600)
L1 = dict(x0=319, x1=616, y0=66, y1=99)     # tinta de «¡Mañana tenemos»
BASE = 91                                   # línea de base
MANANA = dict(x0=328, x1=463)               # la palabra a sustituir
EXCL = dict(x0=319, x1=322)                 # el «¡»
TENEMOS = dict(x0=476, x1=616)              # la palabra que se conserva y se mueve
TINTA = (32, 51, 93)
CUERPO, PESO = 36, 700
SUP = 4                                     # supermuestreo del rasterizado

# Banda que se reconstruye. Generosa por arriba y por abajo, pero sin llegar a la línea 2 (y=111).
BANDA = dict(y0=58, y1=107, x0=314, x1=664)
LIMPIAS_ARRIBA = (56, 63)
LIMPIAS_ABAJO = (101, 108)


def abortar(mensaje: str) -> None:
    print(f'\nABORTADO: {mensaje}\n', file=sys.stderr)
    raise SystemExit(1)


def caja_de_tinta(gris: np.ndarray, y0: int, y1: int, x0: int, x1: int, umbral: int = 150):
    m = gris[y0:y1, x0:x1] < umbral
    if not m.any():
        return None
    ys, xs = np.where(m)
    return xs.min() + x0, xs.max() + x0, ys.min() + y0, ys.max() + y0


def main() -> None:
    if not ORIGEN.exists():
        abortar(f'no existe {ORIGEN.name}')

    im = Image.open(ORIGEN).convert('RGB')
    if im.size != LIENZO:
        abortar(f'el lienzo es {im.size} y se midió sobre {LIENZO}: llegó otra entrega del arte.')

    rgb = np.asarray(im).astype(np.float64)
    gris = np.asarray(im.convert('L')).astype(np.int32)

    # ── Comprobar que la pieza es la que se midió ───────────────────────────
    caja = caja_de_tinta(gris, 60, 105, 310, 700)
    esperada = (L1['x0'], L1['x1'], L1['y0'], L1['y1'])
    if caja != esperada:
        abortar(f'la línea 1 mide {caja} y se esperaba {esperada}: el arte cambió.')

    osc = np.asarray(im)[60:105, 310:700].reshape(-1, 3)
    osc = osc[osc.sum(axis=1) < 260]
    vals, cnt = np.unique(osc, axis=0, return_counts=True)
    tinta = tuple(int(v) for v in vals[cnt.argmax()])
    if tinta != TINTA:
        abortar(f'la tinta del titular es {tinta} y se midió {TINTA}.')

    print(f'Pieza  {ORIGEN.name}  {im.size[0]}×{im.size[1]}')
    print(f'  línea 1  x {L1["x0"]}-{L1["x1"]}  y {L1["y0"]}-{L1["y1"]}  base {BASE}')
    print(f'  tinta    #{tinta[0]:02X}{tinta[1]:02X}{tinta[2]:02X}')

    # ── La fuente ───────────────────────────────────────────────────────────
    ttf = RAIZ / '.venv-design' / 'urbanist-generada.ttf'
    ttf.parent.mkdir(parents=True, exist_ok=True)
    f = TTFont(str(FUENTE_WOFF2))
    f.flavor = None
    f.save(str(ttf))

    def alfa(texto: str) -> np.ndarray:
        """Cobertura 0..1 del texto, rasterizado a 4× y reducido: el mismo antialias suave que
        traen los glifos originales."""
        fuente = ImageFont.truetype(str(ttf), CUERPO * SUP)
        fuente.set_variation_by_axes([PESO])
        lienzo = Image.new('L', (2400, 500), 0)
        ImageDraw.Draw(lienzo).text((80, 80), texto, font=fuente, fill=255)
        a = np.asarray(lienzo)
        ys, xs = np.where(a > 40)
        rec = lienzo.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
        peq = rec.resize((max(1, rec.width // SUP), max(1, rec.height // SUP)), Image.LANCZOS)
        return np.asarray(peq).astype(np.float64) / 255.0

    a_hoy = alfa('Hoy')
    alto_hoy, ancho_hoy = a_hoy.shape

    # El hueco entre palabras, medido en la propia fuente: se compone «Hoy tenemos» y se mira
    # dónde acaba la «y» y dónde empieza la «t».
    a_par = alfa('Hoy tenemos')
    col = (a_par > 0.35).any(axis=0)
    huecos, ini = [], None
    for i, v in enumerate(col):
        if not v and ini is None:
            ini = i
        if v and ini is not None:
            huecos.append((ini, i - 1))
            ini = None
    hueco = max((b - a + 1 for a, b in huecos), default=12)
    print(f'  «Hoy»    {ancho_hoy}×{alto_hoy} px · hueco de la fuente {hueco} px '
          f'(tras «Mañana» había {TENEMOS["x0"] - MANANA["x1"] - 1})')

    # ── Los recortes que se conservan ───────────────────────────────────────
    y0, y1 = BANDA['y0'], BANDA['y1']
    sprite_excl = rgb[y0:y1 + 1, EXCL['x0'] - 3:EXCL['x1'] + 4].copy()
    sprite_tene = rgb[y0:y1 + 1, TENEMOS['x0'] - 5:TENEMOS['x1'] + 6].copy()

    # ── Reconstruir el fondo de la banda ────────────────────────────────────
    # Interpolación vertical por columna entre dos franjas limpias. El fondo ahí es plano
    # (σ < 1), pero interpolar cuesta lo mismo y aguanta un degradado suave.
    arr = np.asarray(im).astype(np.float64)
    sup = np.median(arr[LIMPIAS_ARRIBA[0]:LIMPIAS_ARRIBA[1], :, :], axis=0)
    inf = np.median(arr[LIMPIAS_ABAJO[0]:LIMPIAS_ABAJO[1], :, :], axis=0)
    salida = arr.copy()
    alto = y1 - y0 + 1
    for i in range(alto):
        t = i / (alto - 1)
        fila = sup * (1 - t) + inf * t
        salida[y0 + i, BANDA['x0']:BANDA['x1'] + 1] = fila[BANDA['x0']:BANDA['x1'] + 1]

    # ── Recolocar ───────────────────────────────────────────────────────────
    # «¡» vuelve a su sitio exacto.
    salida[y0:y1 + 1, EXCL['x0'] - 3:EXCL['x1'] + 4] = sprite_excl

    # «Hoy» arranca donde arrancaba la «M», con la versal a la misma altura.
    x_hoy = MANANA['x0']
    y_hoy = L1['y0']
    reg = salida[y_hoy:y_hoy + alto_hoy, x_hoy:x_hoy + ancho_hoy]
    al = a_hoy[..., None]
    salida[y_hoy:y_hoy + alto_hoy, x_hoy:x_hoy + ancho_hoy] = reg * (1 - al) + np.array(TINTA) * al

    # «tenemos» se mueve en bloque, con el hueco que pide la fuente.
    x_t_nuevo = x_hoy + ancho_hoy + hueco
    desplazamiento = x_t_nuevo - TENEMOS['x0']
    destino_x = TENEMOS['x0'] - 5 + desplazamiento
    salida[y0:y1 + 1, destino_x:destino_x + sprite_tene.shape[1]] = sprite_tene
    print(f'  «tenemos» se desplaza {desplazamiento} px (de x={TENEMOS["x0"]} a x={x_t_nuevo})')

    fuera = Image.fromarray(np.clip(salida, 0, 255).astype(np.uint8), 'RGB')
    fuera.save(DESTINO, optimize=True)

    # ── Comprobar el resultado ──────────────────────────────────────────────
    g2 = np.asarray(fuera.convert('L')).astype(np.int32)
    caja2 = caja_de_tinta(g2, 60, 108, 310, 700)
    print(f'\nEscrita  {DESTINO.name}  ({DESTINO.stat().st_size / 1024:.0f} KB)')
    print(f'  línea 1 nueva  x {caja2[0]}-{caja2[1]}  y {caja2[2]}-{caja2[3]}')
    if caja2[0] != L1['x0']:
        abortar(f'la línea nueva no empieza en x={L1["x0"]} sino en {caja2[0]}.')
    if caja2[1] >= L1['x1']:
        abortar('la línea nueva no es más corta que «¡Mañana tenemos»: algo no se sustituyó.')
    # La línea 2 y todo lo que hay por debajo tienen que estar intactos, byte a byte.
    original = np.asarray(im)
    nueva = np.asarray(fuera)
    intacto = np.array_equal(original[BANDA['y1'] + 1:], nueva[BANDA['y1'] + 1:])
    print(f'  el resto de la pieza (y > {BANDA["y1"]}) intacto: {"sí" if intacto else "NO"}')
    if not intacto:
        abortar('se tocó algo fuera de la banda del titular.')
    print('')


if __name__ == '__main__':
    main()

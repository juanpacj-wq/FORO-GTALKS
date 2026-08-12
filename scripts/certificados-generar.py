# Genera el certificado de participación de cada persona: un PDF por asistente.
#
#   .venv-design/Scripts/python scripts/certificados-generar.py --audiencia .datos/certificados-audiencia-<fecha>.json
#   ... --solo jcespedes,llondono,lrojas,mgiraldo     # subconjunto (el ensayo de los 4)
#   ... --regenerar                                    # permite pisar .datos/certificados/
#
# ── Qué produce ──────────────────────────────────────────────────────────────
#
#   .datos/certificados/<alias>.pdf      un A4 apaisado por persona: la pieza oficial de fondo
#                                        (JPEG q85 dentro del PDF) y el nombre y la cédula como
#                                        TEXTO VECTORIAL en Poppins Regular incrustada (subset)
#   .datos/certificados/manifiesto.json  lo que viaja al servidor: oid → archivo (+sha256).
#                                        NI nombre NI cédula: el servidor no los necesita
#   .datos/certificados/hoja-contactos.png   los certificados en rejilla con su alias al pie,
#                                        para revisarlos A OJO antes de subir nada
#
# ── De dónde sale cada cota (medido, no estimado) ────────────────────────────
#
# La pieza es 1755×1241 px. El único texto-sobre-raya que la pieza SÍ trae es «C.C:»: su versal
# mide 31 px, su línea base cae en y=649 y su raya empieza 4 px más abajo (y=653). Esa relación
# base→raya (4 px) es la que heredan los dos textos nuevos:
#
#   cédula   versal 31 px (la de «C.C:», misma línea), base y=649, centrada en su raya x 750-1093
#   nombre   base y=570 (4 px sobre su raya y=574), centrado en la raya x 255-1499. Su versal es
#            36 px: la del cuerpo de la pieza es ~25 px y la del «C.C:» 31, y el nombre es el
#            protagonista del documento — 36 px lo hace un escalón mayor que todo lo que lo
#            rodea sin comerse el vano de 194 px. Si un nombre no cabe, el cuerpo BAJA por pasos
#            hasta 28 px; por debajo, se aborta nombrando a la persona.
#
# La tinta es rgb(40,57,96): la de la pieza, medida; no es un token del sistema.
#
# La fuente es Poppins Regular por decisión del usuario (2026-08-10) tras el veredicto de
# certificado-fuente.py: ninguna candidata ES la de la pieza; Poppins Regular es la más cercana
# y clava el peso (asta 3.00 px). Riesgo aceptado en docs/SEGURIDAD.md.
#
# ── El auto-chequeo, por PDF ─────────────────────────────────────────────────
#
# Cada PDF recién escrito se REABRE y se rasteriza a la resolución de la pieza:
#   1. fuera de las dos bandas de texto tiene que ser IDÉNTICO píxel a píxel al render de un PDF
#      de referencia sin textos (mismo fondo JPEG: así la recompresión no ensucia la resta);
#   2. dentro de cada banda, la caja de tinta tiene que estar centrada en su raya (±2 px), sin
#      tocarla, y medir el ancho que el texto de ESA persona debía medir (±3 px).
# Cualquier fallo ABORTA el proceso entero: un certificado mal compuesto no es «uno menos», es
# el mecanismo roto. La segunda opinión (certificados-auditar.py) llega después y por otra vía.

from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import fitz  # PyMuPDF
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont

RAIZ = Path(__file__).resolve().parent.parent
PIEZA = RAIZ / 'Certificado de participación.png'
FUENTE = RAIZ / 'fuentes-origen' / 'Poppins-Regular.ttf'

PIEZA_PX = (1755, 1241)
TINTA = (40 / 255, 57 / 255, 96 / 255)

# Las dos rayas y el ancla vertical (ver cabecera).
RAYA_NOMBRE = dict(x0=255, x1=1499, y=574)
RAYA_CEDULA = dict(x0=750, x1=1093, y=653)
BASE_NOMBRE_PX = 570
BASE_CEDULA_PX = 649
VERSAL_NOMBRE_PX = 36.0
VERSAL_NOMBRE_MIN_PX = 28.0
VERSAL_CEDULA_PX = 31.0
MARGEN_RAYA_PX = 24            # aire mínimo entre el texto y cada extremo de su raya

# Bandas del auto-chequeo: todo lo que el texto puede tocar. La Ñ sube por encima de la versal,
# así que la banda del nombre empieza holgada por arriba; y la COLA DE LA Q baja por debajo de la
# línea base y CRUZA la raya —como en cualquier diploma donde el nombre se escribe sobre una
# línea—, así que la banda del nombre termina por debajo de la raya. El chequeo «no toca su raya»
# es solo de la cédula: dígitos y puntos no descienden nunca.
BANDA_NOMBRE = dict(y0=500, y1=590, x0=RAYA_NOMBRE['x0'], x1=RAYA_NOMBRE['x1'])
BANDA_CEDULA = dict(y0=610, y1=652, x0=RAYA_CEDULA['x0'], x1=RAYA_CEDULA['x1'])

# La página conserva la proporción EXACTA de la pieza (1755:1241 = 1.41418, a un 0.007 % del √2
# del A4): ancho A4 y alto derivado, para que ningún borde se estire ni recorte.
PAGINA_W_PT = 841.89
PAGINA_H_PT = PAGINA_W_PT * PIEZA_PX[1] / PIEZA_PX[0]
PT_POR_PX = PAGINA_W_PT / PIEZA_PX[0]

JPEG_CALIDAD = 85


def abortar(mensaje: str) -> None:
    print(f'\n✗ {mensaje}\n', file=sys.stderr)
    raise SystemExit(1)


def sha256(datos: bytes) -> str:
    return hashlib.sha256(datos).hexdigest()


def cargar_audiencia(ruta: Path) -> dict:
    audiencia = json.loads(ruta.read_text(encoding='utf-8'))
    personas = audiencia.get('personas') or []
    if not personas:
        abortar(f'{ruta} no trae personas.')
    for p in personas:
        for campo in ('oid', 'alias', 'nombrePintado', 'cedulaPintada'):
            if not p.get(campo):
                abortar(f'A {p.get("alias") or p.get("correo")} le falta «{campo}» en la audiencia.')
    return audiencia


def preparar_fuente() -> tuple[bytes, float]:
    """Bytes del TTF y la versal en em (sCapHeight/unitsPerEm), para convertir px→cuerpo."""
    if not FUENTE.exists():
        abortar(f'No existe {FUENTE}.')
    tt = TTFont(str(FUENTE))
    versal_em = tt['OS/2'].sCapHeight / tt['head'].unitsPerEm
    cmap = tt.getBestCmap()
    faltan = sorted({c for c in 'ÑÁÉÍÓÚÜ.' if ord(c) not in cmap})
    if faltan:
        abortar(f'A la fuente le faltan glifos: {faltan}')
    return FUENTE.read_bytes(), versal_em


def preparar_fondo() -> bytes:
    """La pieza como JPEG q85: fotográfica, ~6× más liviana que el PNG y visualmente idéntica."""
    im = Image.open(PIEZA).convert('RGB')
    if im.size != PIEZA_PX:
        abortar(f'La pieza mide {im.size}, no {PIEZA_PX}: llegó otra entrega. Re-medir todo antes de seguir.')
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=JPEG_CALIDAD, optimize=True)
    return buf.getvalue()


def texto_a_cuerpo(versal_px: float, versal_em: float) -> float:
    """Cuerpo en pt para que la versal mida `versal_px` píxeles de pieza."""
    return versal_px * PT_POR_PX / versal_em


def construir_pdf(fondo_jpeg: bytes, fuente_bytes: bytes, textos: list[dict]) -> bytes:
    doc = fitz.open()
    pagina = doc.new_page(width=PAGINA_W_PT, height=PAGINA_H_PT)
    pagina.insert_image(pagina.rect, stream=fondo_jpeg)
    if textos:
        pagina.insert_font(fontname='poppins', fontbuffer=fuente_bytes)
        for t in textos:
            pagina.insert_text(
                fitz.Point(t['x_pt'], t['y_pt']), t['texto'],
                fontname='poppins', fontsize=t['cuerpo'], color=TINTA,
            )
        doc.subset_fonts()
    datos = doc.tobytes(garbage=4, deflate=True)
    doc.close()
    return datos


def rasterizar(pdf: bytes) -> np.ndarray:
    doc = fitz.open('pdf', pdf)
    zoom = PIEZA_PX[0] / PAGINA_W_PT
    pix = doc[0].get_pixmap(matrix=fitz.Matrix(zoom, zoom), colorspace=fitz.csGRAY, alpha=False)
    a = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
    doc.close()
    if a.shape[1] != PIEZA_PX[0]:
        abortar(f'El render mide {a.shape[1]}px de ancho, no {PIEZA_PX[0]}.')
    return a


def caja_de_tinta(gris: np.ndarray, referencia: np.ndarray, banda: dict, delta: int = 40):
    """La caja de lo que el TEXTO añadió: píxeles claramente más oscuros que el mismo píxel del
    render de referencia sin textos. Un umbral absoluto no sirve: dentro de la banda del nombre
    el fondo fotográfico de la pieza (la torre, los molinos) ya baja de cualquier umbral fijo."""
    y0, y1, x0, x1 = banda['y0'], banda['y1'], banda['x0'], banda['x1']
    reg = referencia[y0:y1 + 1, x0:x1 + 1].astype(np.int16) - gris[y0:y1 + 1, x0:x1 + 1].astype(np.int16) > delta
    ys, xs = np.where(reg)
    if not len(ys):
        return None
    return (x0 + int(xs.min()), x0 + int(xs.max()), y0 + int(ys.min()), y0 + int(ys.max()))


def fuera_de_bandas(gris: np.ndarray) -> np.ndarray:
    """Todo el lienzo menos las dos bandas de texto (donde la resta debe dar cero exacto)."""
    m = np.ones_like(gris, dtype=bool)
    for b in (BANDA_NOMBRE, BANDA_CEDULA):
        m[b['y0']:b['y1'] + 1, b['x0']:b['x1'] + 1] = False
    return gris * m


def main() -> None:
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument('--audiencia', required=True)
    ap.add_argument('--solo', default='', help='aliases separados por coma: genera solo esos')
    ap.add_argument('--regenerar', action='store_true')
    args = ap.parse_args()

    ruta_audiencia = (RAIZ / args.audiencia).resolve()
    if not ruta_audiencia.exists():
        abortar(f'No existe {ruta_audiencia}')
    audiencia = cargar_audiencia(ruta_audiencia)
    personas = audiencia['personas']
    if args.solo:
        pedidos = {a.strip() for a in args.solo.split(',') if a.strip()}
        sobran = pedidos - {p['alias'] for p in personas}
        if sobran:
            abortar(f'--solo pide aliases que no están en la audiencia: {sorted(sobran)}')
        personas = [p for p in personas if p['alias'] in pedidos]

    destino = RAIZ / '.datos' / 'certificados'
    if destino.exists() and any(destino.glob('*.pdf')) and not args.regenerar:
        abortar(f'{destino} ya tiene PDFs. Regenerar es un acto explícito: repite con --regenerar.')
    destino.mkdir(parents=True, exist_ok=True)

    fuente_bytes, versal_em = preparar_fuente()
    fondo = preparar_fondo()
    medidor = fitz.Font(fontbuffer=fuente_bytes)

    print(f'\nGenerar certificados')
    print(f'  audiencia  {ruta_audiencia.name} · {len(personas)} persona(s)')
    print(f'  fuente     {FUENTE.name} (versal {versal_em:.3f} em)')
    print(f'  página     {PAGINA_W_PT:.2f}×{PAGINA_H_PT:.2f} pt · fondo JPEG q{JPEG_CALIDAD} ({len(fondo) // 1024} KB)\n')

    # El render de referencia SIN textos: contra él se resta todo lo de fuera de las bandas.
    referencia = rasterizar(construir_pdf(fondo, fuente_bytes, []))
    ref_fuera = fuera_de_bandas(referencia)

    ancho_raya_nombre = RAYA_NOMBRE['x1'] - RAYA_NOMBRE['x0'] + 1
    ancho_max_nombre = ancho_raya_nombre - 2 * MARGEN_RAYA_PX

    manifiesto = []
    for p in personas:
        nombre, cedula, alias = p['nombrePintado'], p['cedulaPintada'], p['alias']

        # ── El nombre: cuerpo base 36 px de versal, bajando por pasos si no cabe ──
        versal = VERSAL_NOMBRE_PX
        while True:
            cuerpo_nombre = texto_a_cuerpo(versal, versal_em)
            ancho_pt = medidor.text_length(nombre, fontsize=cuerpo_nombre)
            if ancho_pt / PT_POR_PX <= ancho_max_nombre:
                break
            versal -= 0.5
            if versal < VERSAL_NOMBRE_MIN_PX:
                abortar(f'El nombre de {alias} («{nombre}») no cabe ni a {VERSAL_NOMBRE_MIN_PX}px de versal.')
        centro_nombre = (RAYA_NOMBRE['x0'] + RAYA_NOMBRE['x1'] + 1) / 2
        x_nombre_px = centro_nombre - (ancho_pt / PT_POR_PX) / 2

        # ── La cédula: la versal de «C.C:», centrada en su raya ──
        cuerpo_cedula = texto_a_cuerpo(VERSAL_CEDULA_PX, versal_em)
        ancho_ced_pt = medidor.text_length(cedula, fontsize=cuerpo_cedula)
        centro_cedula = (RAYA_CEDULA['x0'] + RAYA_CEDULA['x1'] + 1) / 2
        x_cedula_px = centro_cedula - (ancho_ced_pt / PT_POR_PX) / 2
        if ancho_ced_pt / PT_POR_PX > (RAYA_CEDULA['x1'] - RAYA_CEDULA['x0'] + 1) - 8:
            abortar(f'La cédula de {alias} («{cedula}») desborda su raya.')

        pdf = construir_pdf(fondo, fuente_bytes, [
            dict(texto=nombre, cuerpo=cuerpo_nombre,
                 x_pt=x_nombre_px * PT_POR_PX, y_pt=BASE_NOMBRE_PX * PT_POR_PX),
            dict(texto=cedula, cuerpo=cuerpo_cedula,
                 x_pt=x_cedula_px * PT_POR_PX, y_pt=BASE_CEDULA_PX * PT_POR_PX),
        ])

        # ── Auto-chequeo ──
        render = rasterizar(pdf)
        if not np.array_equal(fuera_de_bandas(render), ref_fuera):
            abortar(f'{alias}: el render difiere del de referencia FUERA de las bandas de texto. '
                    'El texto se salió de su sitio o algo más cambió. No se generó nada más.')
        esperado = [
            ('nombre', BANDA_NOMBRE, centro_nombre, ancho_pt / PT_POR_PX, None),
            ('cédula', BANDA_CEDULA, centro_cedula, ancho_ced_pt / PT_POR_PX, RAYA_CEDULA),
        ]
        for etiqueta, banda, centro, ancho_px, raya in esperado:
            caja = caja_de_tinta(render, referencia, banda)
            if caja is None:
                abortar(f'{alias}: no hay tinta de {etiqueta} en su banda.')
            cx0, cx1, cy0, cy1 = caja
            centro_real = (cx0 + cx1 + 1) / 2
            if abs(centro_real - centro) > 2:
                abortar(f'{alias}: el {etiqueta} quedó descentrado ({centro_real:.1f} vs {centro:.1f}).')
            if abs((cx1 - cx0 + 1) - ancho_px) > 3 + ancho_px * 0.02:
                abortar(f'{alias}: el {etiqueta} mide {cx1 - cx0 + 1}px y debía medir {ancho_px:.0f}px.')
            if raya is not None and cy1 >= raya['y']:
                abortar(f'{alias}: el {etiqueta} toca su raya (baja hasta y={cy1}).')

        ruta_pdf = destino / f'{alias}.pdf'
        ruta_pdf.write_bytes(pdf)
        manifiesto.append(dict(oid=p['oid'], archivo=ruta_pdf.name, sha256=sha256(pdf)))
        extra = f' (versal {versal:.1f}px)' if versal != VERSAL_NOMBRE_PX else ''
        print(f'  ok  {alias:16} {nombre[:44]:44} {cedula:>15} · {len(pdf) // 1024} KB{extra}')

    # ── El manifiesto: lo único que el servidor lee. Sin nombres, sin cédulas. ──
    (destino / 'manifiesto.json').write_text(json.dumps({
        'generado': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'piezaSha256': sha256(PIEZA.read_bytes()),
        'audiencia': ruta_audiencia.name,
        'personas': manifiesto,
    }, indent=2, ensure_ascii=False), encoding='utf-8')

    # ── La hoja de contactos: revisar 134 diplomas a ojo, con su alias al pie ──
    COLS, CELDA, PIE = 6, 300, 26
    filas_n = -(-len(manifiesto) // COLS)
    alto_celda = int(CELDA * PIEZA_PX[1] / PIEZA_PX[0]) + PIE
    hoja = Image.new('RGB', (COLS * CELDA, filas_n * alto_celda), (24, 24, 24))
    dib = ImageDraw.Draw(hoja)
    try:
        etiqueta = ImageFont.truetype(r'C:\Windows\Fonts\consola.ttf', 15)
    except OSError:
        etiqueta = ImageFont.load_default()
    for i, m in enumerate(manifiesto):
        doc = fitz.open(destino / m['archivo'])
        zoom = (CELDA - 8) / PAGINA_W_PT
        pix = doc[0].get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        mini = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
        doc.close()
        x = (i % COLS) * CELDA
        y = (i // COLS) * alto_celda
        hoja.paste(mini, (x + 4, y + 4))
        dib.text((x + 6, y + alto_celda - PIE + 4), m['archivo'][:-4], font=etiqueta, fill=(200, 220, 240))
    hoja.save(destino / 'hoja-contactos.png')

    # (Hasta el 2026-08-12 aquí se emitía public/img/certificado-muestra.webp, la vista previa
    #  de /certificado. El usuario retiró la imagen de la página y el derivado se fue con ella.)

    print(f'\n✔ {len(manifiesto)} certificado(s) en {destino.relative_to(RAIZ)}')
    print(f'  manifiesto.json (oid → archivo; sin datos personales) · hoja-contactos.png para revisar a ojo')
    print('\nSegunda opinión, por la otra vía:')
    print(f'  .venv-design/Scripts/python scripts/certificados-auditar.py {ruta_audiencia.relative_to(RAIZ)}\n'.replace('\\', '/'))


if __name__ == '__main__':
    main()

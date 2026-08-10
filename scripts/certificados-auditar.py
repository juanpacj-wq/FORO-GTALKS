# La segunda opinión sobre los certificados: cruza ARCHIVO ↔ CONTENIDO ↔ AUDIENCIA.
#
#   .venv-design/Scripts/python scripts/certificados-auditar.py .datos/certificados-audiencia-<fecha>.json
#
# ── Por qué existe, si el generador ya verifica ──────────────────────────────
#
# El mismo argumento que `envio-qr-auditar.mjs`: el auto-chequeo del generador compara el PDF
# contra los datos que ACABA de usar, en memoria, dentro de la misma vuelta del bucle. Si el
# bucle estuviera cruzado —la persona A con los datos de B—, la comparación seguiría cuadrando,
# porque compararía B contra B. Esto cruza el NOMBRE DEL ARCHIVO (que sale del alias) contra el
# CONTENIDO (la capa de texto del PDF, que es vectorial y se extrae sin OCR), y ambos contra la
# AUDIENCIA CONGELADA, que es la fuente. No genera nada y no comparte ni una línea de código de
# composición con el generador.
#
# El único fallo sin arreglo posible del proyecto cambió de forma pero no de fondo: antes era
# «que a Ana le llegue el QR de Beto»; aquí es «que Ana descargue el certificado de Beto». Un
# PDF cuyo archivo diga un alias y cuyo texto diga otra persona es exactamente ese fallo, y por
# eso no se anota: se sale con error y no se sube nada.

from __future__ import annotations

import json
import sys
from pathlib import Path

import fitz  # PyMuPDF

RAIZ = Path(__file__).resolve().parent.parent
DIR = RAIZ / '.datos' / 'certificados'

fallos = 0


def check(nombre: str, ok: bool, detalle: str = '') -> None:
    global fallos
    print(f'{" ok " if ok else "FALLA":>6} {nombre}{f" {detalle}" if detalle else ""}')
    if not ok:
        fallos += 1


def main() -> None:
    if len(sys.argv) < 2:
        print('Uso: certificados-auditar.py <archivo de audiencia congelada>', file=sys.stderr)
        raise SystemExit(1)
    ruta_audiencia = (RAIZ / sys.argv[1]).resolve()
    audiencia = json.loads(ruta_audiencia.read_text(encoding='utf-8'))
    personas = {p['alias']: p for p in audiencia['personas']}

    manifiesto_ruta = DIR / 'manifiesto.json'
    manifiesto = json.loads(manifiesto_ruta.read_text(encoding='utf-8')) if manifiesto_ruta.exists() else None
    pdfs = sorted(DIR.glob('*.pdf'))

    print(f'\nAuditar {len(pdfs)} PDF de {DIR.relative_to(RAIZ)} contra {ruta_audiencia.name} '
          f'({len(personas)} personas)\n')

    # Si el manifiesto pide un subconjunto (un ensayo con --solo), la audiencia efectiva es esa.
    if manifiesto is not None:
        del_manifiesto = {m['archivo'][:-4] for m in manifiesto['personas']}
        esperadas = {a: p for a, p in personas.items() if a in del_manifiesto}
        check('el manifiesto solo trae personas de la audiencia', del_manifiesto <= set(personas),
              f'(sobran: {sorted(del_manifiesto - set(personas))[:4]})' if del_manifiesto - set(personas) else '')
    else:
        esperadas = personas

    ilegibles, cruzados, huerfanos, contenidos = [], [], [], {}
    for ruta in pdfs:
        alias = ruta.stem
        doc = fitz.open(ruta)
        lineas = [l.strip() for l in doc[0].get_text().splitlines() if l.strip()]
        doc.close()
        if len(lineas) != 2:
            ilegibles.append(f'{alias}: la capa de texto trae {len(lineas)} línea(s), no 2')
            continue
        nombre_pdf, cedula_pdf = lineas
        contenidos[alias] = (nombre_pdf, cedula_pdf)
        p = esperadas.get(alias)
        if p is None:
            huerfanos.append(alias)
            continue
        # La expectativa se reconstruye desde la AUDIENCIA, no desde el manifiesto: así el cruce
        # es contra la fuente y no contra un artefacto del mismo lote.
        if nombre_pdf != p['nombrePintado'] or cedula_pdf != p['cedulaPintada']:
            cruzados.append(f'{alias}: el PDF dice «{nombre_pdf}» / {cedula_pdf} y la audiencia '
                            f'«{p["nombrePintado"]}» / {p["cedulaPintada"]}')

    faltan = sorted(set(esperadas) - set(contenidos))
    duplicados = len(contenidos) - len(set(contenidos.values()))

    check('hay un PDF por persona, ni uno más ni uno menos',
          len(pdfs) == len(esperadas) and not faltan and not huerfanos,
          f'({len(pdfs)} PDF, {len(esperadas)} esperadas)')
    check('todos los PDF traen su capa de texto legible', not ilegibles)
    for i in ilegibles[:5]:
        print(f'         · {i}')
    check('ningún PDF lleva el nombre o la cédula de otra persona', not cruzados)
    for c in cruzados[:5]:
        print(f'         · {c}')
    check('ningún PDF sobra', not huerfanos, f'({huerfanos[:4]})' if huerfanos else '')
    check('no falta el PDF de nadie', not faltan, f'({faltan[:4]})' if faltan else '')
    check('no hay dos PDF con el mismo contenido', duplicados == 0, f'({duplicados} repetidos)' if duplicados else '')

    if manifiesto is not None:
        import hashlib
        por_archivo = {m['archivo']: m for m in manifiesto['personas']}
        sha_mal = [r.name for r in pdfs
                   if r.name in por_archivo
                   and hashlib.sha256(r.read_bytes()).hexdigest() != por_archivo[r.name]['sha256']]
        oid_mal = [a for a in contenidos
                   if f'{a}.pdf' in por_archivo and a in esperadas
                   and por_archivo[f'{a}.pdf']['oid'] != esperadas[a]['oid']]
        check('los sha256 del manifiesto son los de los archivos', not sha_mal, f'({sha_mal[:3]})' if sha_mal else '')
        check('los oid del manifiesto son los de la audiencia', not oid_mal, f'({oid_mal[:3]})' if oid_mal else '')
        check('el manifiesto lista cada PDF del directorio',
              {r.name for r in pdfs} == set(por_archivo),
              '')

    print(f'\n{"✔ Auditoría en verde: lo que dice cada archivo es lo que dice su contenido, y ambos lo que dice la fuente." if not fallos else f"✗ {fallos} comprobación(es) fallida(s): NO SE SUBE NADA."}\n')
    raise SystemExit(1 if fallos else 0)


if __name__ == '__main__':
    main()

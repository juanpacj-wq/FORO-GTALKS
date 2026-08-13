"""Deriva la pieza de respuestas de los panelistas para /encuestas.

«RTAS PREGUNTAS PENDIENTES PANELISTAS.pdf» (raíz, pieza oficial versionada) es
la fuente de verdad. La tarjeta destacada de /encuestas la entrega de dos
formas, y las dos salen de aquí:

  · La VISTA PREVIA son las páginas rasterizadas a webp. No es un capricho:
    incrustar el PDF en un <iframe>/<object> lo bloquea la CSP del sitio
    (default-src 'none', sin frame-src), y aflojarla por una pieza sería
    cambiar la política de todo el HTML. Las imágenes viajan por img-src
    'self', que ya está.
  · La DESCARGA es el PDF byte a byte, copiado con nombre sin espacios a
    public/docs/.

El manifiesto tipado (src/design/respuestas.ts) lo escribe este script, como
retratos.ts y galeria.ts: la página no puede prometer una página que no exista.

Entrada:  RTAS PREGUNTAS PENDIENTES PANELISTAS.pdf   (raíz, versionado)

Salida:   public/docs/respuestas-panelistas.pdf
          public/img/respuestas/pagina-<n>.webp      880 px de ancho
          public/img/respuestas/pagina-<n>@2x.webp   1760 px
          src/design/respuestas.ts

    .venv-design/Scripts/python scripts/build-respuestas.py
"""

import io
import shutil
import sys
from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = Path(__file__).resolve().parent.parent
PIEZA = RAIZ / "RTAS PREGUNTAS PENDIENTES PANELISTAS.pdf"
PDF_PUBLICO = RAIZ / "public" / "docs" / "respuestas-panelistas.pdf"
IMAGENES = RAIZ / "public" / "img" / "respuestas"
MANIFIESTO = RAIZ / "src" / "design" / "respuestas.ts"

# Ancho del derivado 1x. La página del visor llega a ~52rem (832 px): 880 la
# cubre a densidad 1 y el @2x a densidad 2. Es texto: la calidad va alta para
# que las astas no se embarren.
ANCHO_1X = 880
CALIDAD = 88

CABECERA = """// GENERADO por scripts/build-respuestas.py — no editar a mano.
//
// La pieza «RTAS PREGUNTAS PENDIENTES PANELISTAS.pdf» (raíz), derivada para la
// tarjeta destacada de /encuestas: las páginas rasterizadas para la vista
// previa (un <iframe> del PDF lo bloquearía la CSP) y el PDF byte a byte para
// la descarga. Mismo patrón que retratos.ts: quien sabe qué páginas existen es
// el script que las produjo.
//
// Se regenera con:  .venv-design/Scripts/python scripts/build-respuestas.py

export interface PaginaRespuestas {
  src: string
  srcSet: string
  ancho: number
  alto: number
}

/** El PDF completo, para el botón de descarga del visor. */
export const RESPUESTAS_PDF = '/docs/respuestas-panelistas.pdf'

export const RESPUESTAS_PAGINAS: readonly PaginaRespuestas[] = ["""

PIE = """]
"""


def main() -> None:
    if not PIEZA.is_file():
        raise SystemExit(f"Falta la pieza «{PIEZA.name}» en la raíz del repo.")

    PDF_PUBLICO.parent.mkdir(parents=True, exist_ok=True)
    IMAGENES.mkdir(parents=True, exist_ok=True)
    for sobrante in IMAGENES.glob("*.webp"):
        sobrante.unlink()  # una entrega nueva reemplaza a la anterior entera

    shutil.copyfile(PIEZA, PDF_PUBLICO)
    print(f"{PDF_PUBLICO.relative_to(RAIZ)}: {PDF_PUBLICO.stat().st_size / 1024:.0f} KB")

    doc = fitz.open(PIEZA)
    entradas: list[str] = []
    total_kb = 0.0
    for i, pagina in enumerate(doc, start=1):
        for sufijo, ancho in (("", ANCHO_1X), ("@2x", ANCHO_1X * 2)):
            zoom = ancho / pagina.rect.width
            pix = pagina.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
            im = Image.open(io.BytesIO(pix.tobytes("png")))
            destino = IMAGENES / f"pagina-{i}{sufijo}.webp"
            im.save(destino, "WEBP", quality=CALIDAD, method=6)
            total_kb += destino.stat().st_size / 1024
            if not sufijo:
                base = f"/img/respuestas/pagina-{i}"
                entradas.append(
                    f"  {{\n"
                    f"    src: '{base}.webp',\n"
                    f"    srcSet: '{base}.webp 1x, {base}@2x.webp 2x',\n"
                    f"    ancho: {im.width},\n"
                    f"    alto: {im.height},\n"
                    f"  }},"
                )
        print(f"  página {i}/{len(doc)}")

    MANIFIESTO.write_text(CABECERA + "\n" + "\n".join(entradas) + "\n" + PIE, encoding="utf-8")
    print(f"\nsrc/design/respuestas.ts: {len(entradas)} páginas · "
          f"public/img/respuestas/: {total_kb / 1024:.1f} MB")


if __name__ == "__main__":
    main()

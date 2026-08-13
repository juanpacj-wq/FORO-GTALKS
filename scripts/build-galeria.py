"""Procesa las fotos de la Memorias del evento y escribe el manifiesto tipado.

Las fotos llegan tal como salen de la estación: exportes de OneDrive con nombre
UTC (`20260805_132350404_iOS.jpg`), descargas directas de la cámara (`DSC*.JPG`),
HEIC del teléfono, duplicados exactos con dos nombres y copias «(1)». Este
script las deja en las dos piezas que la página necesita y, sobre todo, escribe
en `src/design/galeria.ts` exactamente lo que produjo, en el orden real de la
jornada.

Es el mismo patrón que `build-retratos.py`: el manifiesto lo escribe quien
procesó el lote, así que la página no puede pedir una foto que no exista ni
perderse una que sí. Tres decisiones que no son obvias:

  · Se deduplica por CONTENIDO (SHA-256), no por nombre: el lote real trae la
    misma toma como `DSC04053.JPG` y como `20260805_165109782_iOS.jpg`, y otra
    vez como `DSC04083 (1).JPG`. Confiar en el nombre habría publicado la misma
    foto tres veces. El censo (y la lista de fotos retiradas, y el nombre de la
    carpeta del lote) viven en `galeria_fuente.py`, que comparte con
    `descargas-empaquetar.py`: son las dos puntas de lo mismo y no pueden
    discrepar.
  · El orden y la hora salen del EXIF `DateTimeOriginal`, que en este lote viene
    en hora local con su desfase `-05:00` explícito. El nombre del archivo NO
    sirve: los exportes de OneDrive van en UTC y las DSC ni siquiera llevan hora.
  · Los derivados se guardan SIN metadatos: el EXIF original trae número de
    serie de la cámara y fecha exacta, y no tiene por qué viajar a un repo
    público. La orientación se hornea antes con `exif_transpose`.

Entrada:  la carpeta del lote (ver NOMBRES_ORIGEN en galeria_fuente.py; está
          ignorada por git: son originales a plena resolución de personas
          identificables, y pesan ~1.5 GB)

Salida:   public/img/galeria/<id>.webp     lado mayor 1600 · visor y carrusel
          public/img/galeria/<id>-m.webp   lado mayor 800  · rejilla y abanico
          src/design/galeria.ts

    .venv-design/Scripts/python scripts/build-galeria.py
"""

import sys
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageFilter, ImageOps
from pillow_heif import register_heif_opener

from galeria_fuente import EXTENSIONES_FOTO, carpeta_origen, censo

# La consola de Windows abre en cp1252 y este script imprime «→» por cada foto.
# Sin esto revienta con UnicodeEncodeError EN MEDIO del lote (ver
# build-retratos.py, que lo aprendió primero).
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

register_heif_opener()

RAIZ = Path(__file__).resolve().parent.parent
DESTINO = RAIZ / "public" / "img" / "galeria"
MANIFIESTO = RAIZ / "src" / "design" / "galeria.ts"

# Los mismos parámetros que build-assets.py, upscale-photos.py y
# build-retratos.py. Si un día hay que cambiar la calidad, se cambia en todos.
CALIDAD = 82
ENFOQUE = ImageFilter.UnsharpMask(radius=1.6, percent=95, threshold=3)

# Lado mayor de cada derivado. 1600 cubre el visor a pantalla completa y sirve
# de 2x a la tarjeta central del abanico (~800 px en escritorio); 800 es la
# rejilla y las tarjetas laterales. Los originales llegan a 7008×4672: servir
# eso sería regalar 20 MB por foto.
LADO_GRANDE = 1600
LADO_MEDIO = 800

EXIF_DATETIME_ORIGINAL = 36867
EXIF_OFFSET_ORIGINAL = 36881


def tomada(im: Image.Image, archivo: Path) -> datetime:
    """La hora local de la toma, del EXIF. Sin EXIF no se adivina: se aborta,
    porque el orden del carrusel ES la jornada y una foto mal ordenada cuenta
    otra historia."""
    try:
        ifd = im.getexif().get_ifd(0x8769)
        crudo = ifd.get(EXIF_DATETIME_ORIGINAL)
    except Exception:
        crudo = None
    if not crudo:
        raise SystemExit(
            f"{archivo.name} no trae DateTimeOriginal en el EXIF; sin hora no se "
            "puede ordenar la jornada. Si la foto vale, añádele la fecha con la "
            "herramienta de la cámara y vuelve a correr."
        )
    return datetime.strptime(str(crudo), "%Y:%m:%d %H:%M:%S")


def hora_legible(dt: datetime) -> str:
    """«8:23 a.m.», el mismo formato de la agenda (foro.ts)."""
    hora12 = dt.hour % 12 or 12
    sufijo = "a.m." if dt.hour < 12 else "p.m."
    return f"{hora12}:{dt.minute:02d} {sufijo}"


def escribir(im: Image.Image, lado: int, destino: Path) -> tuple[int, int]:
    """Reduce al lado mayor pedido y guarda en WebP sin metadatos."""
    salida = im.copy()
    salida.thumbnail((lado, lado), Image.LANCZOS)
    # El enfoque solo tras reducir: devuelve el filo que se pierde al
    # remuestrear; sobre el original solo marcaría el ruido del sensor.
    salida = salida.filter(ENFOQUE)
    salida.save(destino, "WEBP", quality=CALIDAD, method=6)
    return salida.size


CABECERA = """// GENERADO por scripts/build-galeria.py  no editar a mano.
//
// Manifiesto de las fotos que EXISTEN en public/img/galeria/, en el orden real
// de la jornada (EXIF DateTimeOriginal, hora local de Colombia). Es el mismo
// patrón que retratos.ts: quien sabe qué fotos hay es el script que las
// procesó, así que la página no puede servir un 404 ni perder una foto.
//
// Se regenera con:  .venv-design/Scripts/python scripts/build-galeria.py

export interface FotoGaleria {
  /** Nombre de archivo sin extensión, `foro-<hhmmss>` de la hora local. */
  id: string
  /** Lado mayor 1600. El visor, y 2x de la tarjeta central del abanico. */
  src: string
  /** Lado mayor 800. La rejilla y las tarjetas laterales. */
  srcMedia: string
  /** Los dos anteriores con descriptor de ancho, para `sizes`. */
  srcSet: string
  /** Del derivado grande, para reservar el hueco sin salto de layout. */
  ancho: number
  alto: number
  /** Hora local de la toma, con su desfase explícito. */
  tomadaIso: string
  /** «8:23 a.m.», el mismo formato de la agenda. */
  hora: string
}

export const GALERIA: readonly FotoGaleria[] = ["""

PIE = """]
"""


def main() -> None:
    ORIGEN = carpeta_origen()

    # El censo (dedupe por contenido + fotos retiradas) es el compartido: se
    # descarta ANTES de decodificar nada y el informe dice quién sobró y por qué.
    unicos, duplicados, excluidos = censo(ORIGEN, EXTENSIONES_FOTO, retirar=True)
    if not unicos:
        raise SystemExit(f"«{ORIGEN.name}/» no deja ninguna foto publicable.")

    print(f"«{ORIGEN.name}/» → {len(unicos)} fotos únicas "
          f"({len(duplicados)} duplicados exactos, {len(excluidos)} retiradas)\n")

    # Ahora sí: decodificar, ordenar por hora de toma y derivar.
    lote: list[tuple[datetime, Path, Image.Image]] = []
    for archivo in unicos:
        im = Image.open(archivo)
        dt = tomada(im, archivo)
        lote.append((dt, archivo, im))
    lote.sort(key=lambda t: (t[0], t[1].name))

    DESTINO.mkdir(parents=True, exist_ok=True)
    for sobrante in DESTINO.glob("*.webp"):
        sobrante.unlink()  # un lote nuevo reemplaza al anterior entero

    entradas: list[str] = []
    ids_usados: set[str] = set()
    total_kb = 0.0
    for dt, archivo, im in lote:
        id_foto = f"foro-{dt:%H%M%S}"
        # Dos tomas en el mismo segundo: la segunda lleva sufijo, no pisa.
        sufijo = ord("b")
        while id_foto in ids_usados:
            id_foto = f"foro-{dt:%H%M%S}{chr(sufijo)}"
            sufijo += 1
        ids_usados.add(id_foto)

        plana = ImageOps.exif_transpose(im).convert("RGB")
        ancho, alto = escribir(plana, LADO_GRANDE, DESTINO / f"{id_foto}.webp")
        escribir(plana, LADO_MEDIO, DESTINO / f"{id_foto}-m.webp")

        kb = sum(p.stat().st_size for p in DESTINO.glob(f"{id_foto}*.webp")) / 1024
        total_kb += kb
        print(f"{archivo.name} → {id_foto} · {plana.width}x{plana.height} → {ancho}x{alto} · {kb:.0f} KB")

        base = f"/img/galeria/{id_foto}"
        entradas.append(
            f"  {{\n"
            f"    id: '{id_foto}',\n"
            f"    src: '{base}.webp',\n"
            f"    srcMedia: '{base}-m.webp',\n"
            f"    srcSet: '{base}-m.webp 800w, {base}.webp 1600w',\n"
            f"    ancho: {ancho},\n"
            f"    alto: {alto},\n"
            f"    tomadaIso: '{dt:%Y-%m-%dT%H:%M:%S}-05:00',\n"
            f"    hora: '{hora_legible(dt)}',\n"
            f"  }},"
        )

    MANIFIESTO.write_text(CABECERA + "\n" + "\n".join(entradas) + "\n" + PIE, encoding="utf-8")

    if duplicados:
        print(f"\nDuplicados descartados ({len(duplicados)}):")
        for sobra, queda in duplicados:
            print(f"  {sobra.name} = {queda.name}")

    if excluidos:
        print(f"\nRetiradas a mano ({len(excluidos)}, ver EXCLUIDAS en galeria_fuente.py):")
        for archivo, motivo in excluidos:
            print(f"  {archivo.name}  {motivo}")

    print(f"\nsrc/design/galeria.ts: {len(entradas)} fotos · "
          f"public/img/galeria/: {total_kb / 1024:.1f} MB")


if __name__ == "__main__":
    main()

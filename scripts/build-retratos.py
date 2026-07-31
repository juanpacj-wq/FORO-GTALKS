"""Procesa los retratos de los ponentes y escribe el manifiesto tipado.

Las fotos llegan de fuentes distintasfondo de estudio, fondo de oficina,
recortes de una foto de grupo— y en tamaños y formatos cualesquiera. Este
script las normaliza a las cuatro piezas que el sitio necesita y, sobre todo,
deja escrito en `src/design/retratos.ts` exactamente lo que produjo.

Ese manifiesto es el punto: en vez de una bandera `foto: true` en los datos que
haya que acordarse de activar, o de un `onerror` que deje un hueco, quien sabe
qué fotos existen es quien las procesó. Un ponente sin foto no aparece en el
mapa, cae al monograma de iniciales y es imposible servir un 404. Un slug que
no exista en PONENTES es un error de tipos en `npm run build`.

Entrada:  retratos-origen/<slug>.<jpg|jpeg|png|webp|tif|tiff|bmp>
          (carpeta ignorada por git: son fotos de personas y este repo tiene
           remoto público. Los .webp procesados sí se versionan.)

Salida:   public/img/ponentes/<slug>.webp        440x550   4:5, cabecera
          public/img/ponentes/<slug>@2x.webp     880x1100
          public/img/ponentes/<slug>-sq.webp      96x96    1:1, filas
          public/img/ponentes/<slug>-sq@2x.webp  192x192
          src/design/retratos.ts

    .venv-design/Scripts/python scripts/build-retratos.py
"""

import re
import sys
from pathlib import Path

from PIL import Image, ImageFilter

# La consola de Windows abre en cp1252 y este script imprime «→» y «·» por cada
# foto. Sin esto revienta con UnicodeEncodeError EN MEDIO del lote: deja unos
# derivados escritos, otros no, y el manifiesto sin reescribir —el peor estado
# posible, porque `retratos.ts` deja de describir lo que hay en disco—.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = Path(__file__).resolve().parent.parent
ORIGEN = RAIZ / "retratos-origen"
DESTINO = RAIZ / "public" / "img" / "ponentes"
MANIFIESTO = RAIZ / "src" / "design" / "retratos.ts"
DATOS = RAIZ / "src" / "data" / "foro.ts"

EXTENSIONES = (".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp")

# Los mismos parámetros que ya usan build-assets.py y upscale-photos.py. No se
# inventan otros: si un día hay que cambiar la calidad, se cambia en los tres.
CALIDAD = 82
ENFOQUE = ImageFilter.UnsharpMask(radius=1.6, percent=95, threshold=3)

VERTICAL = (440, 550)   # 4:5
CUADRADO = (96, 96)     # 1:1

# Un retrato de estudio tiene la cara en el tercio superior, así que un recorte
# centrado le corta la frente. Estos son los centros por defecto, en fracción
# del alto útil.
CENTRO_VERTICAL = 0.42
CENTRO_CUADRADO = 0.34

# El cuadrado no puede ser la foto entera reducida: un retrato corporativo es
# de medio cuerpo, y a 96 px la cara acaba midiendo veinte píxeles y no se
# reconoce. El zoom recorta la caja al 70% del lado menor, que en un plano
# medio deja cabeza y hombros. El vertical, en cambio, va a 1.0: ahí la foto se
# ve grande y conviene respetar el encuadre del fotógrafo.
ZOOM_VERTICAL = 1.0
ZOOM_CUADRADO = 0.70

# Corrección manual por persona, para lo que el defecto no acierte: una foto
# descentrada, o un primer plano ya cerrado al que el 70% le cortaría la
# barbilla. La clave es el slug; el valor, (centro x, centro y, zoom) del
# recorte, en fracción. Se anota aquí y no en la cabeza de quien procesó el
# lote.
#
# Hay un diccionario por recorte porque no son el mismo encuadre: el cuadrado
# se acerca a la cara y el vertical respeta el plano del fotógrafo, así que un
# solo valor de (centro y, zoom) no puede servir a los dos. Se puede corregir
# uno sin tocar el otro.
#
#   ENCUADRE_CUADRADO = {"jose-fernando-prada": (0.55, 0.30, 0.9)}
#
# Vacíos hoy, y no por casualidad: el lote definitivo son diez retratos de
# estudio del mismo encargo mismo fondo, misma distancia, sujeto centrado—,
# así que el defecto acierta en los diez. Los overrides que hubo aquí eran para
# una foto suelta y apaisada que ese lote sustituyó, y se quitaron con ella:
# un encuadre a mano que sobrevive a la foto que lo justificaba descuadra la
# siguiente.
ENCUADRE_CUADRADO: dict[str, tuple[float, float, float]] = {}
ENCUADRE_VERTICAL: dict[str, tuple[float, float, float]] = {}


def recortar(
    im: Image.Image,
    proporcion: float,
    centro_y: float,
    zoom: float,
    slug: str,
    ajustes: dict[str, tuple[float, float, float]],
) -> Image.Image:
    """Recorta a la proporción pedida, opcionalmente acercándose."""
    cx, cy, z = ajustes.get(slug, (0.5, centro_y, zoom))

    if im.width / im.height > proporcion:
        # Sobra ancho: la caja mayor con esa proporción la limita el alto.
        ancho, alto = round(im.height * proporcion), im.height
    else:
        # Sobra alto: la limita el ancho.
        ancho, alto = im.width, round(im.width / proporcion)

    ancho, alto = round(ancho * z), round(alto * z)

    # El centro se acota para que la caja no se salga de la imagen.
    izq = round(min(max(im.width * cx - ancho / 2, 0), im.width - ancho))
    arr = round(min(max(im.height * cy - alto / 2, 0), im.height - alto))
    return im.crop((izq, arr, izq + ancho, arr + alto))


def escribir(im: Image.Image, medida: tuple[int, int], destino: Path) -> None:
    """Redimensiona a la medida exacta y guarda en WebP."""
    salida = im.resize(medida, Image.LANCZOS)
    # El enfoque solo tras reducir: es lo que devuelve el filo que se pierde al
    # remuestrear. Sobre la imagen original solo marcaría el ruido del sensor.
    salida = salida.filter(ENFOQUE)
    salida.save(destino, "WEBP", quality=CALIDAD, method=6)


def procesar(foto: Path) -> str:
    slug = foto.stem
    im = Image.open(foto).convert("RGB")

    vertical = recortar(
        im, VERTICAL[0] / VERTICAL[1], CENTRO_VERTICAL, ZOOM_VERTICAL, slug, ENCUADRE_VERTICAL
    )
    escribir(vertical, VERTICAL, DESTINO / f"{slug}.webp")
    escribir(vertical, (VERTICAL[0] * 2, VERTICAL[1] * 2), DESTINO / f"{slug}@2x.webp")

    cuadrado = recortar(im, 1.0, CENTRO_CUADRADO, ZOOM_CUADRADO, slug, ENCUADRE_CUADRADO)
    escribir(cuadrado, CUADRADO, DESTINO / f"{slug}-sq.webp")
    escribir(cuadrado, (CUADRADO[0] * 2, CUADRADO[1] * 2), DESTINO / f"{slug}-sq@2x.webp")

    kb = sum(p.stat().st_size for p in DESTINO.glob(f"{slug}*.webp")) / 1024
    print(f"{slug}: {im.width}x{im.height} → 4 derivados · {kb:.0f} KB")
    return slug


CABECERA = """// GENERADO por scripts/build-retratos.py no editar a mano.
//
// Manifiesto de los retratos que EXISTEN en public/img/ponentes/. Es la misma
// idea que iconos.ts: en vez de una bandera `foto: true` en los datos que haya
// que acordarse de activar, o de un `onerror` que deje un hueco, el script que
// procesa las fotos escribe aquí exactamente lo que produjo.
//
// Consecuencias, que son el motivo de que exista este archivo:
//   · un ponente sin foto no aparece en el mapa, cae al monograma de iniciales
//     y es imposible servir un 404;
//   · un slug que no exista en PONENTES es un error de tipos en `npm run build`.
//
// Se regenera con:  .venv-design/Scripts/python scripts/build-retratos.py

import type { PonenteSlug } from '../data/foro'

export interface Retrato {
  /** 4:5 vertical, 440×550 y 880×1100. Para la cabecera del perfil. */
  vertical: { src: string; srcSet: string }
  /** 1:1, 96×96 y 192×192. Para las filas del índice y de la agenda. */
  cuadrado: { src: string; srcSet: string }
}

export const RETRATOS: Partial<Record<PonenteSlug, Retrato>> = {"""

PIE = """}

/**
 * El slug llega de la URL, así que es un `string` cualquiera: esta función es
 * justo el punto donde se estrecha. Devuelve `undefined` mientras la foto no
 * haya llegado.
 */
export function retratoDe(slug: string): Retrato | undefined {
  return RETRATOS[slug as PonenteSlug]
}
"""


def escribir_manifiesto(slugs: list[str]) -> None:
    entradas = []
    for slug in slugs:
        base = f"/img/ponentes/{slug}"
        entradas.append(
            f"  '{slug}': {{\n"
            f"    vertical: {{\n"
            f"      src: '{base}.webp',\n"
            f"      srcSet: '{base}.webp 1x, {base}@2x.webp 2x',\n"
            f"    }},\n"
            f"    cuadrado: {{\n"
            f"      src: '{base}-sq.webp',\n"
            f"      srcSet: '{base}-sq.webp 1x, {base}-sq@2x.webp 2x',\n"
            f"    }},\n"
            f"  }},"
        )

    cuerpo = "\n" + "\n".join(entradas) + "\n" if entradas else ""
    MANIFIESTO.write_text(CABECERA + cuerpo + PIE, encoding="utf-8")
    print(f"\nsrc/design/retratos.ts: {len(slugs)} retrato(s)")


def slugs_del_foro() -> list[str]:
    """Los slugs reales, leídos de la fuente de verdad."""
    texto = DATOS.read_text(encoding="utf-8")
    # Solo el literal PONENTES: la agenda cita los mismos slugs, pero por otra
    # clave (`ponente:`, `moderador:`), así que no se cuelan aquí.
    return re.findall(r"^\s*slug: '([a-z0-9-]+)',$", texto, re.MULTILINE)


def main() -> None:
    DESTINO.mkdir(parents=True, exist_ok=True)

    if not ORIGEN.is_dir():
        raise SystemExit(
            f"Falta {ORIGEN.name}/. Crea la carpeta y deja dentro las fotos con el "
            "slug del ponente por nombre, p. ej. jose-fernando-prada.jpg"
        )

    fotos = sorted(p for p in ORIGEN.iterdir() if p.suffix.lower() in EXTENSIONES)
    if not fotos:
        raise SystemExit(f"{ORIGEN.name}/ está vacía: no hay nada que procesar.")

    # Un nombre de archivo que no sea un slug real se cazaría de todas formas
    # en `npm run build`, como error de tipos del manifiesto. Se comprueba aquí
    # para que el mensaje diga qué archivo hay que renombrar y no en qué línea
    # de un .ts generado falló TypeScript.
    conocidos = slugs_del_foro()
    intrusos = [f.name for f in fotos if f.stem not in conocidos]
    if intrusos:
        raise SystemExit(
            "Estos archivos no corresponden a ningún ponente de src/data/foro.ts:\n  "
            + "\n  ".join(intrusos)
            + "\n\nEl nombre del archivo tiene que ser el slug exacto. Los válidos son:\n  "
            + "\n  ".join(conocidos)
        )

    escribir_manifiesto([procesar(foto) for foto in fotos])

    faltan = [s for s in conocidos if s not in {f.stem for f in fotos}]
    if faltan:
        print(f"\nSin retrato todavía ({len(faltan)}), salen con monograma:")
        for slug in faltan:
            print(f"  {slug}")

    print(
        "\nRevisa las once juntas antes de dar por bueno el lote: los retratos van\n"
        "a color original (--gt-retrato-* en 0), así que lo que hay que igualar\n"
        "aquí es el ENCUADRE y la luz de origen, no el tinte. Si algún recorte\n"
        "corta mal, se ajustan ENCUADRE_VERTICAL / ENCUADRE_CUADRADO aquí arriba."
    )


if __name__ == "__main__":
    main()

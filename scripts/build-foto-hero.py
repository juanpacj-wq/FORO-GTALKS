"""Deriva la foto del hero desde su original.

Es la única foto del sitio que no sale de los PDF ni es un retrato: la que
traen las piezas (`hero-aerogeneradores`, 456x652 incrustada) se queda corta
para lo que hoy ocupa el hero, que en pantalla ancha pasa de 850 px de lado.

Entrada:  fotos-origen/hero-matriz-energetica.jpg   1246x1152
Salida:   public/img/hero-matriz-energetica.webp     896x828  (1x)
          public/img/hero-matriz-energetica@2x.webp 1246x1152 (2x)

El original se versiona: no es material sensible como los retratos, y sin él
esto no se puede volver a generar.

El 1x mide justo el lado mayor que el marco alcanza en CSS (56rem, el tope de
`.gt-hero__foto`), así que a densidad 1 nunca se amplía. El «2x» es el original
tal cual, sin remuestrear: son 1.39 veces el 1x y no 2, porque eso es todo lo
que trae la foto. El descriptor solo decide qué archivo baja el navegador, y
bajo el duotono la diferencia entre 1.39x y 2x no se ve; ampliar con Lanczos
hasta 1792 px, como se hace con las fotos de los PDF, aquí solo pesaría más sin
añadir un detalle que no existe.

    .venv-design/Scripts/python scripts/build-foto-hero.py
"""

from pathlib import Path

from PIL import Image, ImageFilter

RAIZ = Path(__file__).resolve().parent.parent
ORIGEN = RAIZ / "fotos-origen" / "hero-matriz-energetica.jpg"
IMG = RAIZ / "public" / "img"

# Los mismos parámetros que build-assets.py, upscale-photos.py y
# build-retratos.py. No se inventan otros.
CALIDAD = 82
ENFOQUE = ImageFilter.UnsharpMask(radius=1.6, percent=95, threshold=3)

ANCHO_1X = 896  # 56rem: el tope de `.gt-hero__foto` en InicioPage.css


def informar(destino: Path, im: Image.Image) -> None:
    kb = destino.stat().st_size / 1024
    print(f"{destino.name}: {im.width}x{im.height} · {kb:.0f} KB")


original = Image.open(ORIGEN).convert("RGB")
nombre = ORIGEN.stem

# 2x: el original, sin tocar la geometría. Solo se recomprime a WebP.
doble = IMG / f"{nombre}@2x.webp"
original.save(doble, "WEBP", quality=CALIDAD, method=6)
informar(doble, original)

# 1x: reducción y enfoque, que es lo que devuelve el filo perdido al
# remuestrear. La proporción se conserva a partir del ancho.
alto_1x = round(ANCHO_1X * original.height / original.width)
sencilla = original.resize((ANCHO_1X, alto_1x), Image.LANCZOS).filter(ENFOQUE)
simple = IMG / f"{nombre}.webp"
sencilla.save(simple, "WEBP", quality=CALIDAD, method=6)
informar(simple, sencilla)

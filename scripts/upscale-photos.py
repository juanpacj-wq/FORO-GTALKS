"""Genera las variantes @2x de las fotos para pantallas HiDPI.

Las tres fotos vienen incrustadas en los PDF a baja resolución: la mayor es de
456x652. En una pantalla de densidad 2cualquier portátil corporativo
reciente— el navegador las amplía con interpolación bilineal y el resultado se
ve blando, que es lo primero que abarata un sitio.

Una ampliación Lanczos con máscara de enfoque hecha aquí, una sola vez, se ve
bastante mejor que la que hace el navegador en cada pintado. No inventa
detalleeso no existe— pero conserva los bordes en vez de difuminarlos.

El HTML sirve la original a 1x y esta a 2x con `srcset`, así que en pantallas
normales no se descarga ni un byte de más.

    .venv-design/Scripts/python scripts/upscale-photos.py
"""

from pathlib import Path

from PIL import Image, ImageFilter

RAIZ = Path(__file__).resolve().parent.parent
IMG = RAIZ / "public" / "img"

# Solo las que se muestran a un tamaño donde la densidad 2 se nota. La foto de
# la banda de cita va de fondo, atenuada y desenfocada por el degradado: no
# gana nada con el doble de píxeles.
FOTOS = ["hero-aerogeneradores", "torre-transmision"]


def escalar(nombre: str) -> None:
    origen = IMG / f"{nombre}.webp"
    destino = IMG / f"{nombre}@2x.webp"

    im = Image.open(origen).convert("RGB")
    doble = im.resize((im.width * 2, im.height * 2), Image.LANCZOS)

    # Radio y umbral bajos: se trata de recuperar el filo de las aspas y las
    # torres, no de dibujar un halo alrededor de todo.
    doble = doble.filter(ImageFilter.UnsharpMask(radius=1.6, percent=95, threshold=3))

    doble.save(destino, "WEBP", quality=80, method=6)

    kb = destino.stat().st_size / 1024
    print(f"{destino.name}: {doble.width}x{doble.height} · {kb:.0f} KB")


for foto in FOTOS:
    escalar(foto)

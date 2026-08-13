"""La fuente de la galería: DÓNDE está el lote y QUÉ fotos no se publican.

Dos scripts leen la misma carpeta de originales y tienen que coincidir foto a
foto: `build-galeria.py` (lo que la página enseña) y `descargas-empaquetar.py`
(lo que el ZIP entrega). Mientras cada uno llevaba su propio censo, retirar una
foto obligaba a acordarse de los dos, y el fallo era mudo: la foto desaparecía
del carrusel y seguía viajando dentro de 1.3 GB que nadie vuelve a abrir. Por
eso el censo vive aquí y lo importan los dos.

Tres decisiones que no son obvias:

  · **La identidad de una foto es su SHA-256, no su nombre.** El lote trae la
    misma toma con hasta tres nombres (DSC de la cámara, exporte de OneDrive en
    UTC, copia «(1)»), así que retirar «DSC04164.JPG» habría dejado entrar a su
    gemela por la otra puerta. El hash es además lo que los dos scripts YA
    calculaban para deduplicar: no se añade trabajo, se le da nombre.
  · **Una exclusión que no encuentra su foto ABORTA.** Si el lote se vuelve a
    entregar sin ella, lo correcto es enterarse y borrar la línea, no que el
    script siga en silencio con una lista que ya no dice nada. Es la misma
    doctrina del manifiesto de descargas: a medias, no se arranca.
  · **La carpeta del lote se busca entre varios nombres.** Ha cambiado de
    nombre al menos una vez (`Contenido Memorias del evento` →
    `Contenido galería audiovisual`) y los dos scripts se quedaron apuntando al
    viejo: dejaron de correr y nadie lo supo hasta que hubo que regenerar. La
    carpeta está ignorada por git, así que el repo no puede recordarlo por
    nosotros; esta lista sí.

Los originales NO se tocan: quedan en la carpeta del lote, en la estación. Lo
que hace esta lista es que no se publiquen ni en la página ni en el ZIP.
"""

import hashlib
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent

# La carpeta del lote, por orden de preferencia. Se usa la primera que exista y
# traiga fotos; las anteriores se conservan porque un lote viejo puede seguir en
# una estación con el nombre de entonces.
NOMBRES_ORIGEN = (
    "Contenido galería audiovisual",
    "Contenido Memorias del evento",
    "Galería audiovisual",
)

EXTENSIONES_FOTO = (".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif")

# ── Fotos retiradas ───────────────────────────────────────────────────────────
# sha256 del ORIGINAL → por qué no se publica. La posición («#64») es la que
# tenía en la galería el día en que se decidió, y se anota para poder rastrear
# la petición; la que manda es el hash, porque la posición cambia en cuanto se
# retira la foto anterior.
EXCLUIDAS = {
    # Pedido del usuario, 2026-08-13.
    "1c791c57f383d9a5b158591824c3a4f729ab07d9b5ee4a3764e98edda9e0836b":
        "#64 (DSC04164.JPG, 2:16 p.m.): retirada a petición del usuario",
    "68ce97d2b0ec7b4f871633d72053c0fb2675a292a45a3f40a362512535cf5f9b":
        "#65 (DSC04167.JPG, 2:16 p.m.): retirada a petición del usuario",
    # De la pareja #38/#39 (misma toma con dos segundos de diferencia) se queda
    # la #38: el ponente está mejor encuadrado y la lámina se lee.
    "ffed418ff3f3f83b1971be44c2ba279caf2523374355ccd369dca86d06bf1a47":
        "#39 (20260805_160441617_iOS.heic, 11:04 a.m.): casi idéntica a la #38",
}


def carpeta_origen() -> Path:
    """La carpeta del lote de fotos, buscada entre los nombres conocidos."""
    for nombre in NOMBRES_ORIGEN:
        candidata = RAIZ / nombre
        if candidata.is_dir() and any(
            p.suffix.lower() in EXTENSIONES_FOTO for p in candidata.iterdir()
        ):
            return candidata
    listado = "\n".join(f"    · {n}/" for n in NOMBRES_ORIGEN)
    raise SystemExit(
        "No encuentro el lote de fotos del evento. Busqué, en la raíz del repo:\n"
        f"{listado}\n"
        "  Déjalo con uno de esos nombres (o añade el nuevo a NOMBRES_ORIGEN en "
        "scripts/galeria_fuente.py). La carpeta está ignorada por git a propósito: "
        "son originales a plena resolución de personas identificables."
    )


def censo(
    carpeta: Path,
    extensiones: tuple[str, ...],
    *,
    retirar: bool = False,
) -> tuple[list[Path], list[tuple[Path, Path]], list[tuple[Path, str]]]:
    """Los archivos que sí se publican, y quién quedó fuera y por qué.

    Devuelve `(unicos, duplicados, excluidos)`:
      · `unicos`     archivos con contenido distinto, en orden de nombre.
      · `duplicados` [(el que sobra, el que se queda)] por hash repetido.
      · `excluidos`  [(archivo, motivo)] de los retirados a mano.

    `retirar=False` (el defecto) salta la lista de retiradas: la usan los roles
    que no son el lote de fotos, como las presentaciones.
    """
    vistos: dict[str, Path] = {}
    duplicados: list[tuple[Path, Path]] = []
    excluidos: list[tuple[Path, str]] = []
    encontradas: set[str] = set()

    for archivo in sorted(p for p in carpeta.iterdir() if p.suffix.lower() in extensiones):
        h = hashlib.sha256(archivo.read_bytes()).hexdigest()
        if retirar and h in EXCLUIDAS:
            # Se anota ANTES del censo de duplicados: retirar una foto retira
            # también a sus gemelas de otro nombre, que es justo el punto.
            encontradas.add(h)
            excluidos.append((archivo, EXCLUIDAS[h]))
            continue
        if h in vistos:
            duplicados.append((archivo, vistos[h]))
        else:
            vistos[h] = archivo

    if retirar and (faltan := set(EXCLUIDAS) - encontradas):
        detalle = "\n".join(f"    · {EXCLUIDAS[h]}\n      sha256 {h}" for h in sorted(faltan))
        raise SystemExit(
            f"«{carpeta.name}/» no trae {len(faltan)} de las fotos retiradas:\n"
            f"{detalle}\n"
            "  O el lote cambió, o la lista quedó vieja. Si esas fotos ya no llegan, "
            "borra sus líneas de EXCLUIDAS en scripts/galeria_fuente.py; no se sigue "
            "con una lista que dice cosas que no son."
        )

    return list(vistos.values()), duplicados, excluidos

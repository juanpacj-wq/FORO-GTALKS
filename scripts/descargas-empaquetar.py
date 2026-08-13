"""Empaqueta las descargas de /galeria: los dos ZIP y su manifiesto.

Los botones de «Descargar contenido» entregan los ORIGINALES las fotografías a
plena resolución y las presentaciones de los ponentes, y nada de eso puede
viajar por git: el repo es público y el lote de fotos pesa ~1.6 GB. El camino es
el de los certificados: se empaqueta y verifica AQUÍ, en la estación, se sube
con deploy/descargas-subir.sh a `DESCARGAS_DIR` (fuera del repo) y el servidor
solo aprende el manifiesto al arrancar.

Tres decisiones que no son obvias:

  · Las fotos se DEDUPLICAN por SHA-256 antes de empaquetar, con el mismo censo
    de build-galeria.py literalmente el mismo, importado de galeria_fuente.py:
    el lote trae la misma toma hasta con tres nombres (DSC vs exporte de
    OneDrive vs copia «(1)») y un ZIP con 91 archivos de los que 11 son
    repetidos regala 200 MB y desordena a quien lo abra. Compartir el censo es
    lo que garantiza que el ZIP y la página lleven las MISMAS fotos: una
    retirada del carrusel que siguiera viajando dentro de 1.3 GB no la vería
    nadie.
  · Todo va en ZIP_STORED (sin comprimir): JPG, HEIC y PPTX ya están
    comprimidos por dentro; deflate solo quemaría minutos de CPU para ganar
    kilobytes.
  · El manifiesto dice bytes y número de elementos por rol. El servidor lo
    valida al arrancar (archivo presente y del tamaño prometido) y la página
    anuncia el peso REAL junto a cada botón: el «1,6 GB» que ve la persona sale
    de aquí, no de un copy.

Entrada:  la carpeta del lote de fotos (ver galeria_fuente.py, ignorada por git)
          presentaciones/                                  (ignorada por git)

Salida:   .datos/descargas/fotografias-foro-gtalks-2026.zip
          .datos/descargas/presentaciones-foro-gtalks-2026.zip
          .datos/descargas/manifiesto.json

    .venv-design/Scripts/python scripts/descargas-empaquetar.py
"""

import json
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from galeria_fuente import EXTENSIONES_FOTO, carpeta_origen, censo

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = Path(__file__).resolve().parent.parent
DESTINO = RAIZ / ".datos" / "descargas"

# rol → (de dónde salen, nombre del zip, carpeta interna, extensiones, ¿aplica la
# lista de retiradas?). El origen es una FUNCIÓN porque el del lote de fotos se
# resuelve entre varios nombres posibles (ha cambiado ya una vez), y solo ese rol
# pasa por EXCLUIDAS: las presentaciones no se retiran una a una.
ROLES = {
    "imagenes": (
        carpeta_origen,
        "fotografias-foro-gtalks-2026.zip",
        "Fotografías Foro G-TALKS 2026",
        EXTENSIONES_FOTO,
        True,
    ),
    "presentaciones": (
        lambda: RAIZ / "presentaciones",
        "presentaciones-foro-gtalks-2026.zip",
        "Presentaciones Foro G-TALKS 2026",
        (".pptx", ".ppt", ".pdf"),
        False,
    ),
}


def empaquetar(rol: str) -> dict:
    origen, nombre_zip, interna, extensiones, retirar = ROLES[rol]
    carpeta = origen()
    if not carpeta.is_dir():
        raise SystemExit(f"Falta la carpeta de origen «{carpeta.name}/» para el rol «{rol}».")

    unicos, duplicados, excluidos = censo(carpeta, extensiones, retirar=retirar)
    if not unicos:
        raise SystemExit(f"«{carpeta.name}/» no trae nada empaquetable para «{rol}».")

    ruta_zip = DESTINO / nombre_zip
    with zipfile.ZipFile(ruta_zip, "w", compression=zipfile.ZIP_STORED) as z:
        for archivo in unicos:
            z.write(archivo, arcname=f"{interna}/{archivo.name}")

    bytes_zip = ruta_zip.stat().st_size
    print(f"{rol}: {len(unicos)} archivo(s) → {nombre_zip} · {bytes_zip / 1024 / 1024:.0f} MB"
          + (f" · {len(duplicados)} duplicado(s) exactos fuera" if duplicados else "")
          + (f" · {len(excluidos)} retirada(s)" if excluidos else ""))
    for sobra, queda in duplicados:
        print(f"    {sobra.name} = {queda.name}")
    for archivo, motivo in excluidos:
        print(f"    RETIRADA {archivo.name}  {motivo}")

    return {"archivo": nombre_zip, "bytes": bytes_zip, "elementos": len(unicos)}


def main() -> None:
    DESTINO.mkdir(parents=True, exist_ok=True)
    manifiesto = {
        "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "roles": {rol: empaquetar(rol) for rol in ROLES},
    }
    (DESTINO / "manifiesto.json").write_text(
        json.dumps(manifiesto, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"\n{DESTINO / 'manifiesto.json'} escrito. Subir con: bash deploy/descargas-subir.sh")


if __name__ == "__main__":
    main()

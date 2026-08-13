"""Empaqueta las descargas de /galeria: los dos ZIP y su manifiesto.

Los botones de «Descargar contenido» entregan los ORIGINALES las fotografías a
plena resolución y las presentaciones de los ponentes, y nada de eso puede
viajar por git: el repo es público y el lote de fotos pesa ~1.6 GB. El camino es
el de los certificados: se empaqueta y verifica AQUÍ, en la estación, se sube
con deploy/descargas-subir.sh a `DESCARGAS_DIR` (fuera del repo) y el servidor
solo aprende el manifiesto al arrancar.

Tres decisiones que no son obvias:

  · Las fotos se DEDUPLICAN por SHA-256 antes de empaquetar, con el mismo censo
    de build-galeria.py: el lote trae la misma toma hasta con tres nombres
    (DSC vs exporte de OneDrive vs copia «(1)») y un ZIP con 91 archivos de los
    que 11 son repetidos regala 200 MB y desordena a quien lo abra.
  · Todo va en ZIP_STORED (sin comprimir): JPG, HEIC y PPTX ya están
    comprimidos por dentro; deflate solo quemaría minutos de CPU para ganar
    kilobytes.
  · El manifiesto dice bytes y número de elementos por rol. El servidor lo
    valida al arrancar (archivo presente y del tamaño prometido) y la página
    anuncia el peso REAL junto a cada botón: el «1,6 GB» que ve la persona sale
    de aquí, no de un copy.

Entrada:  Contenido Memorias del evento/   (ignorada por git)
          presentaciones/                  (ignorada por git)

Salida:   .datos/descargas/fotografias-foro-gtalks-2026.zip
          .datos/descargas/presentaciones-foro-gtalks-2026.zip
          .datos/descargas/manifiesto.json

    .venv-design/Scripts/python scripts/descargas-empaquetar.py
"""

import hashlib
import json
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = Path(__file__).resolve().parent.parent
DESTINO = RAIZ / ".datos" / "descargas"

# rol → (carpeta de origen, nombre del zip, carpeta interna, extensiones admitidas)
ROLES = {
    "imagenes": (
        RAIZ / "Contenido Memorias del evento",
        "fotografias-foro-gtalks-2026.zip",
        "Fotografías Foro G-TALKS 2026",
        (".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp"),
    ),
    "presentaciones": (
        RAIZ / "presentaciones",
        "presentaciones-foro-gtalks-2026.zip",
        "Presentaciones Foro G-TALKS 2026",
        (".pptx", ".ppt", ".pdf"),
    ),
}


def censo(carpeta: Path, extensiones: tuple[str, ...]) -> tuple[list[Path], list[tuple[Path, Path]]]:
    """Archivos únicos por contenido, y quién sobró. El mismo censo que
    build-galeria.py: el hash decide, no el nombre."""
    vistos: dict[str, Path] = {}
    duplicados: list[tuple[Path, Path]] = []
    for archivo in sorted(p for p in carpeta.iterdir() if p.suffix.lower() in extensiones):
        h = hashlib.sha256(archivo.read_bytes()).hexdigest()
        if h in vistos:
            duplicados.append((archivo, vistos[h]))
        else:
            vistos[h] = archivo
    return list(vistos.values()), duplicados


def empaquetar(rol: str) -> dict:
    carpeta, nombre_zip, interna, extensiones = ROLES[rol]
    if not carpeta.is_dir():
        raise SystemExit(f"Falta la carpeta de origen «{carpeta.name}/» para el rol «{rol}».")

    unicos, duplicados = censo(carpeta, extensiones)
    if not unicos:
        raise SystemExit(f"«{carpeta.name}/» no trae nada empaquetable para «{rol}».")

    ruta_zip = DESTINO / nombre_zip
    with zipfile.ZipFile(ruta_zip, "w", compression=zipfile.ZIP_STORED) as z:
        for archivo in unicos:
            z.write(archivo, arcname=f"{interna}/{archivo.name}")

    bytes_zip = ruta_zip.stat().st_size
    print(f"{rol}: {len(unicos)} archivo(s) → {nombre_zip} · {bytes_zip / 1024 / 1024:.0f} MB"
          + (f" · {len(duplicados)} duplicado(s) exactos fuera" if duplicados else ""))
    for sobra, queda in duplicados:
        print(f"    {sobra.name} = {queda.name}")

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

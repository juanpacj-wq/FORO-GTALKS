"""Comprueba que las biografías de `src/data/foro.ts` siguen siendo el texto
del documento de Comunicaciones, carácter a carácter.

Por qué existe
--------------
Las bios NO se transcriben ya «un elemento por párrafo de la fuente»: el
documento entrega unas en varios párrafos y otras en un bloque único de mil y
pico pulsaciones, y esa diferencia se veía en la página, porque el primer
párrafo se compone como entradilla y un bloque único se quedaba sin ella. Así
que los bloques únicos se **parten** en la maqueta.

Partir es una decisión de composición, no de copy: el corte cae en un punto y
seguido de la fuente y lo único que cambia es que un espacio pasa a ser un
salto de párrafo. Esa es exactamente la invariante que se verifica aquí:

    bio.join(' ')  ==  los párrafos del .docx de esa persona, join(' ')

Mientras eso se cumpla, da igual dónde estén los cortes: no se perdió, ni se
añadió, ni se «arregló» una sola letra. Sin esta comprobación, partir a mano
diez biografías es la forma más fácil de colar una errata que nadie va a
releer contra el original.

Comprueba además que **toda** bio tenga al menos dos párrafos (si no, se queda
sin entradilla y vuelve la discrepancia) y avisa si alguna entradilla se sale
del rango que marcan las que ya venían partidas de fábrica.

    .venv-design/Scripts/python scripts/bios-verificar.py
"""

import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

# La salida lleva «·», «→» y comillas angulares, y la consola de Windows sigue
# abriendo en cp1252. Sin esto el script muere con UnicodeEncodeError DESPUÉS de
# haberlo comprobado todo, que es la peor forma de fallar: parece que falló la
# comprobación cuando lo que falló fue imprimirla.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = Path(__file__).resolve().parent.parent
DATOS = RAIZ / "src" / "data" / "foro.ts"

# Copia versionada del texto de la fuente. Es la referencia cuando no hay .docx
# en la máquina, que es lo normal: el documento llega por correo, se procesa y
# la carpeta del envío está ignorada por git.
#
# Existe por un fallo real: cuando el envío desapareció de la carpeta, la
# comprobación cayó a una entrega ANTERIOR y cantó cuatro biografías como «ya
# no coinciden con el documento». Un arnés que se equivoca así es peor que no
# tenerlo, porque enseña a desconfiar de sus fallos.
REFERENCIA = RAIZ / "scripts" / "perfiles-fuente.txt"

# El documento llega por entregas y cada una trae el nombre que le puso quien
# la reenvió: «PERFIL DE LOS PONENTES.docx», «… (1).docx», «… (2).docx». No se
# fija ninguno: se busca por patrón en los dos sitios donde aparecen y manda el
# más reciente. Fijar un nombre es garantizar que la próxima entrega se ignore.
PATRON_FUENTE = "PERFIL DE LOS PONENTES*.docx"
DONDE_BUSCAR = [RAIZ, RAIZ / "IMagenes ponentes"]


def docx_mas_reciente() -> Path | None:
    encontrados = [f for d in DONDE_BUSCAR if d.is_dir() for f in d.glob(PATRON_FUENTE)]
    return max(encontrados, key=lambda f: f.stat().st_mtime, default=None)

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

# Un encabezado del documento es «NOMBRE EN MAYÚSCULAS - Cargo». El guion es
# unas veces corto y otras largo, según quien escribiera cada ficha.
ENCABEZADO = re.compile(r"^([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ .]+?)\s+[-–]\s+(.+)$")

# …salvo cuando no. La ficha que cerró la lista llegó como «11. Erick Wehdeking
# Arcieri»: numerada, en caja mixta y sin cargo, porque se añadió después al
# final del documento. Sin esta segunda forma su biografía no abre bloque y se
# pega a la de la persona anterior que es exactamente lo que pasó, y solo se
# vio al comparar la entrega con la referencia. Se exige la numeración de
# lista, de dos a cinco palabras capitalizadas y nada más en la línea: un
# párrafo de cuerpo no puede colarse por aquí.
ENCABEZADO_NUMERADO = re.compile(r"^\d{1,2}\.\s+((?:[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+\s*){2,5})$")

# Las correcciones sobre el documento, y por qué. Se aplican al texto de la
# fuente antes de comparar, así que siguen siendo visibles aquí en vez de
# convertirse en un «falla siempre» que se acaba ignorando. Cualquier otra
# diferencia es una errata de transcripción y hace fallar la comprobación.
#
# Se comprueba además que cada una siga haciendo falta: una corrección que ya
# no encuentra nada que corregir es ruido, y la entrega de Comunicaciones puede
# arreglar la errata por su cuenta el día menos pensado. Pasó: «Universidad de
# los andes» estuvo aquí hasta que una entrega lo escribió bien.
CORRECCIONES = {
    "carlos-naranjo-merino": [
        ("huella hídrica", "huella hídrica.", "el párrafo se queda sin punto final en la fuente"),
    ],
}

# Rango observado de las entradillas: de las 100 pulsaciones de Miguel Prieto a
# las 325 de José Fernando Prada. Es una guía, no un fallo, y los extremos NO
# se eligieron: son la frase de presentación más corta y la más larga que da el
# documento. Una entradilla no se rellena ni se recorta para caber en un número
# sería reescribir el copy, así que salirse solo significa «mírala». Puestos
# en la página van de 2 a 5 líneas, el mismo abanico que ya producían las
# cuatro fichas que el documento entregó partidas de fábrica.
LEAD_MIN, LEAD_MAX = 100, 340


def normalizar(texto: str) -> str:
    """Sin tildes y en mayúsculas, para casar «JOSE» con «José»."""
    sin_tildes = "".join(
        c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn"
    )
    return re.sub(r"\s+", " ", sin_tildes).strip().upper()


def bloques_docx(path: Path) -> dict[str, list[str]]:
    """{nombre normalizado: [párrafos de su biografía]}."""
    root = ET.fromstring(zipfile.ZipFile(path).read("word/document.xml"))
    bloques: dict[str, list[str]] = {}
    actual: list[str] | None = None
    for p in root.iter(W + "p"):
        texto = "".join(n.text or "" for n in p.iter(W + "t")).strip()
        if not texto:
            continue
        encabezado = ENCABEZADO.match(texto) or ENCABEZADO_NUMERADO.match(texto)
        if encabezado:
            actual = bloques.setdefault(normalizar(encabezado.group(1)), [])
        elif actual is not None:
            actual.append(unicodedata.normalize("NFC", texto))
    return bloques


LITERAL = re.compile(r"'((?:[^'\\]|\\.)*)'")


def ponentes_ts(path: Path) -> list[tuple[str, str, list[str] | None]]:
    """[(slug, nombre, párrafos de bio o None)] en el orden del archivo."""
    ts = path.read_text(encoding="utf-8")
    fuera = []
    for m in re.finditer(r"slug: '([a-z0-9-]+)',\n\s*nombre: '(.+?)',([\s\S]*?)\n {2}\},", ts):
        slug, nombre, cuerpo = m.group(1), m.group(2), m.group(3)
        bm = re.search(r"bio: \[\n([\s\S]*?)\n    \],", cuerpo)
        if not bm:
            fuera.append((slug, nombre, None))
            continue
        parrafos = [
            unicodedata.normalize("NFC", "".join(LITERAL.findall(trozo)).replace("\\'", "'"))
            for trozo in re.split(r",\n      (?=')", bm.group(1))
        ]
        fuera.append((slug, nombre, parrafos))
    return fuera


def leer_referencia() -> tuple[str, dict[str, list[str]]]:
    """La copia versionada: («de dónde salió», {nombre normalizado: párrafos})."""
    bloques: dict[str, list[str]] = {}
    entrega = "desconocida"
    actual: list[str] | None = None
    for linea in REFERENCIA.read_text(encoding="utf-8").splitlines():
        if linea.startswith("#") or not linea.strip():
            continue
        if linea.startswith("=== "):
            nombre, entrega = (t.strip() for t in linea[4:].split("|"))
            actual = bloques.setdefault(normalizar(nombre), [])
        elif actual is not None:
            actual.append(unicodedata.normalize("NFC", linea.strip()))
    return entrega, bloques


def escribir_referencia(entrega: str, bloques: dict[str, list[str]]) -> None:
    lineas = [
        "# Texto de las biografías tal como lo entregó Comunicaciones.",
        "#",
        "# GENERADO por scripts/bios-verificar.py --regenerar. Es la REFERENCIA contra la que se",
        "# comprueba que src/data/foro.ts sigue siendo el documento, y existe porque el .docx no",
        "# siempre está en la máquina: llega por correo, se procesa, y la carpeta del envío está",
        "# ignorada por git. Sin esto la comprobación se quedaba sin patrón o, peor, caía a una",
        "# entrega anterior y cantaba fallos falsos que fue justo lo que pasó.",
        "#",
        "# Un párrafo por línea, sin plegar. Son los párrafos DEL DOCUMENTO: en foro.ts alguno va",
        "# partido para que el primero haga de entradilla, y lo que se compara es el texto unido",
        "# con espacios, no el reparto.",
        "#",
        "# Las correcciones declaradas en el script YA ESTÁN aplicadas aquí, que es donde se ven.",
        "",
    ]
    for nombre, parrafos in bloques.items():
        lineas.append(f"=== {nombre} | {entrega}")
        lineas.extend(parrafos)
        lineas.append("")
    REFERENCIA.write_text("\n".join(lineas), encoding="utf-8")


def corregir(bloques: dict[str, list[str]]) -> dict[str, list[str]]:
    """Aplica las correcciones declaradas, y solo donde todavía hacen falta."""
    for correcciones in CORRECCIONES.values():
        for viejo, nuevo, _motivo in correcciones:
            for parrafos in bloques.values():
                for i, p in enumerate(parrafos):
                    if nuevo not in p:
                        parrafos[i] = p.replace(viejo, nuevo)
    return bloques


def main() -> None:
    docx = docx_mas_reciente()

    # Adoptar una entrega nueva es un acto explícito: --regenerar. La
    # comprobación de a diario compara SIEMPRE contra la referencia versionada.
    #
    # Se hizo así después de tropezar: antes mandaba «el .docx más reciente que
    # haya en disco», y el día que la carpeta del envío se vació quedó suelta
    # una entrega ANTERIOR en la raíz. El script la adoptó sin decir nada y
    # declaró cuatro biografías corruptas. Con este reparto eso no puede pasar:
    # una entrega vieja que reaparece es, como mucho, un aviso.
    if "--regenerar" in sys.argv:
        if docx is None:
            raise SystemExit(
                f"--regenerar necesita el documento, y no hay ningún «{PATRON_FUENTE}» en:\n  "
                + "\n  ".join(str(d.relative_to(RAIZ)) or "." for d in DONDE_BUSCAR)
            )
        escribir_referencia(docx.name, corregir(bloques_docx(docx)))
        print(f"Referencia reescrita desde {docx.name} → {REFERENCIA.relative_to(RAIZ)}\n")

    if not REFERENCIA.is_file():
        raise SystemExit(
            f"Falta {REFERENCIA.relative_to(RAIZ)}. Con el .docx delante, créala con:\n"
            "  .venv-design/Scripts/python scripts/bios-verificar.py --regenerar"
        )

    entrega, bloques = leer_referencia()
    print(f"Fuente: {REFERENCIA.name} · copia de {entrega}\n")
    fallos = 0
    avisos = 0

    for slug, nombre, parrafos in ponentes_ts(DATOS):
        clave = normalizar(nombre)
        if parrafos is None:
            estado = "en el documento" if bloques.get(clave) else "tampoco en el documento"
            print(f"  ·  {slug}: sin biografía en foro.ts ({estado})")
            continue

        original = bloques.get(clave)
        if not original:
            print(f"FALLA {slug}: tiene bio en foro.ts pero no aparece en el documento")
            fallos += 1
            continue

        esperado = " ".join(original)
        obtenido = " ".join(parrafos)
        medidas = "+".join(str(len(p)) for p in parrafos)

        if obtenido != esperado:
            fallos += 1
            print(f"FALLA {slug}: el texto ya no es el del documento")
            for i, (a, b) in enumerate(zip(esperado.split(), obtenido.split())):
                if a != b:
                    print(f"      palabra {i}: documento «{a}» · foro.ts «{b}»")
                    break
            else:
                print(f"      longitudes: documento {len(esperado)} · foro.ts {len(obtenido)}")
            continue

        if len(parrafos) < 2:
            fallos += 1
            print(f"FALLA {slug}: un solo párrafo, se queda sin entradilla ({medidas})")
            continue

        lead = len(parrafos[0])
        if not LEAD_MIN <= lead <= LEAD_MAX:
            avisos += 1
            print(f"  ~   {slug}: entradilla de {lead} car., fuera de {LEAD_MIN}–{LEAD_MAX}")
        print(f"  ok  {slug}: {len(parrafos)} párrafos {medidas} = {len(obtenido)} car.")

    for slug, correcciones in CORRECCIONES.items():
        for viejo, nuevo, motivo in correcciones:
            print(f"\nCorrección aplicada · {slug}: «{viejo}» → «{nuevo}» ({motivo})")

    # Si hay una entrega en disco, se mira pero NO se adopta: solo se avisa de
    # si dice lo mismo que la referencia. Es como se entera uno de que llegó
    # texto nuevo sin que el arnés cambie de patrón a tus espaldas. Y también
    # es donde se ve que una corrección dejó de hacer falta, porque
    # Comunicaciones puede arreglar la errata por su cuenta: pasó con
    # «Universidad de los andes».
    if docx is not None:
        del_disco = corregir(bloques_docx(docx))
        if del_disco != bloques:
            avisos += 1
            print(f"\n  ~   «{docx.name}» NO dice lo mismo que la referencia.")
            print(f"      Si es una entrega nueva, adóptala con --regenerar y revisa el diff.")
            print(f"      Si es una entrega vieja que quedó suelta, bórrala o ignórala.")
        crudo = " ".join(p for ps in bloques_docx(docx).values() for p in ps)
        for slug, correcciones in CORRECCIONES.items():
            for viejo, nuevo, _motivo in correcciones:
                if nuevo in crudo:
                    avisos += 1
                    print(f"\n  ~   {slug}: «{viejo}» → «{nuevo}» ya no hace falta en {docx.name}.")

    print()
    if fallos:
        raise SystemExit(f"{fallos} biografía(s) ya no coinciden con la fuente.")
    print(f"Biografías: todo en orden{f' ({avisos} aviso(s))' if avisos else ''}.")


if __name__ == "__main__":
    main()

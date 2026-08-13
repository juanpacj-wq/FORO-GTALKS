"""Mide `Carnet-foro-1.jpg (1).jpeg` la pieza oficial del carné y deja las cotas para el CSS.

    .venv-design/Scripts/python scripts/escarapela-medir.py

Escribe en `design-extract/escarapela/` (carpeta ignorada por git, como el resto de
`design-extract/`):

  carne.png        el carné llevado a 1024 de ancho LA REFERENCIA
  medidas.json     todas las cotas, en px de un carné de 1024 de ancho
  report.md        el mismo contenido en tabla, con los valores en cqw ya divididos
  ondas.txt        los `d` de los telones, listos para pegar en Escarapela.tsx
  cajas.png        la referencia con cada caja medida encima, para revisar de un vistazo
  foto-fixture.jpg el recorte cuadrado de la foto de la pieza, para que la captura del
                   render lleve la misma imagen y el diff no la marque entera

Tres cosas que no son obvias y mandan sobre todo lo demás:

1. **Esta pieza va A SANGRE: el carné ES el lienzo.** La anterior (`Escarapela.png`) era un
   export con margen y sombra, y el carné ocupaba 931×1429 dentro de sus 1024×1536 de eso
   salía la proporción 1024/1571. Aquí no hay margen: 1080×1648 de borde a borde, y las cuatro
   esquinas son cuadradas. `rect_carne()` lo **comprueba** en vez de darlo por hecho, para que
   un export futuro con margen no pase inadvertido.
2. **Las cotas se miden sobre el carné YA normalizado** a 1024 de ancho, no sobre la pieza. Así
   `escarapela-diff.py` mide la captura del render con exactamente el mismo código y a la misma
   resolución: cualquier sesgo del método se cancela al restar, y la comparación es de cotas
   contra cotas, no de impresiones. Las curvas de los telones se miden también sobre el carné
   normalizado, que aquí es la pieza reescalada un 5 % un remuestreo LANCZOS de bajada no
   mueve un canto de sitio, y a cambio las curvas salen en el mismo sistema que las cotas.
3. **El pie va en DOS RENGLONES apilados** («Día:» y «Lugar:», cada uno con su icono), no en una
   fila con separador como en la pieza anterior. No es un detalle de estilo: cambia el DOM.

La pieza es un **JPEG**, no un PNG: el bloque 8×8 de la compresión ensucia los cantos algo más
que un export sin pérdida. Los predicados de color van con el mismo margen que antes y aguantan;
lo que sube es la tolerancia de antialias del diff, no la de aquí.

Sin dependencias nuevas: Pillow, la misma venv de `scripts/extract-pdf-design.py`.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

# La consola de Windows llega en cp1252 y el resumen lleva acentos y flechas.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = Path(__file__).resolve().parent.parent
# El nombre es el del archivo tal y como llegó: se referencia en un sitio y solo en uno.
PIEZA = RAIZ / "Carnet-foro-1.jpg (1).jpeg"
SALIDA = RAIZ / "design-extract" / "escarapela"

ANCHO_N = 1024  # ancho del carné normalizado


# ════════════════════════════════════════════════════════════════════════════════
# Lienzo: un carné (referencia o render) ya normalizado, con los predicados de color
# ════════════════════════════════════════════════════════════════════════════════

class Lienzo:
    """Un carné de 1024 de ancho. Todo lo que se mide aquí se mide igual en el render."""

    def __init__(self, img: Image.Image):
        self.img = img.convert("RGB")
        self.px = self.img.load()
        self.ancho, self.alto = self.img.size

    def lum(self, x: int, y: int) -> float:
        r, g, b = self.px[x, y]
        return 0.2126 * r + 0.7152 * g + 0.0722 * b

    def es_navy(self, x: int, y: int) -> bool:
        r, g, b = self.px[x, y]
        return b - r > 25 and r < 110 and b < 175

    def es_celeste(self, x: int, y: int) -> bool:
        r, g, b = self.px[x, y]
        return b > 150 and b - r > 55 and r > 80

    # Tinta sobre papel: oscuro y NO celeste si no, la banda de abajo se cuela en el pie.
    def tinta(self, x: int, y: int) -> bool:
        return self.lum(x, y) < 200 and not self.es_celeste(x, y)

    # Blanco sobre navy: claro y NO celeste si no, «en Acción» se cuela en «Energía».
    def blanco(self, x: int, y: int) -> bool:
        return self.lum(x, y) > 150 and not self.es_celeste(x, y)

    def perfil(self, x0, x1, y0, y1, pred) -> tuple[dict[int, int], dict[int, int]]:
        """Cuántos píxeles cumplen `pred` en cada fila y en cada columna de la ventana."""
        x0, x1 = max(0, int(x0)), min(self.ancho, int(x1))
        y0, y1 = max(0, int(y0)), min(self.alto, int(y1))
        cols: dict[int, int] = {}
        filas: dict[int, int] = {}
        for y in range(y0, y1):
            for x in range(x0, x1):
                if pred(x, y):
                    cols[x] = cols.get(x, 0) + 1
                    filas[y] = filas.get(y, 0) + 1
        return filas, cols

    def caja(self, x0, x1, y0, y1, pred, min_fila=1, min_col=1) -> dict | None:
        """bbox de los píxeles que cumplen `pred`.

        `min_fila` es el mínimo de aciertos que ha de tener una FILA para contar, y `min_col`
        el mínimo de una COLUMNA. Van por separado a propósito: una regla de 4 px de alto tiene
        cientos de aciertos por fila y solo 4 por columnay un separador vertical, al revés,
        así que un único umbral borraba una de las dos.
        """
        filas, cols = self.perfil(x0, x1, y0, y1, pred)
        cx = [x for x, n in cols.items() if n >= min_col]
        fy = [y for y, n in filas.items() if n >= min_fila]
        if not cx or not fy:
            return None
        return {"x": min(cx), "y": min(fy), "x2": max(cx) + 1, "y2": max(fy) + 1,
                "ancho": max(cx) + 1 - min(cx), "alto": max(fy) + 1 - min(fy),
                "cx": (min(cx) + max(cx) + 1) / 2, "cy": (min(fy) + max(fy) + 1) / 2}

    def bloques(self, x0, x1, y0, y1, pred, hueco=12) -> list[dict]:
        """Los grupos de columnas con tinta, separados por huecos de al menos `hueco` px.

        Es lo que permite aislar un icono del texto que tiene al lado sin cablear ninguna
        coordenada: entre las letras de una palabra no cabe un hueco de 12 px, entre un icono
        y su rótulo sí.
        """
        _, cols = self.perfil(x0, x1, y0, y1, pred)
        if not cols:
            return []
        res, ini, prev = [], None, None
        for x in sorted(cols):
            if ini is None:
                ini = x
            elif x - prev > hueco:
                res.append({"x": ini, "x2": prev + 1, "ancho": prev + 1 - ini,
                            "alto_max": max(cols[i] for i in range(ini, prev + 1) if i in cols)})
                ini = x
            prev = x
        res.append({"x": ini, "x2": prev + 1, "ancho": prev + 1 - ini,
                    "alto_max": max(cols[i] for i in range(ini, prev + 1) if i in cols)})
        return res

    def separador_vertical(self, x0, x1, y0, y1, pred, min_alto=40, max_ancho=8) -> dict | None:
        """La barrita vertical: un bloque estrecho y alto, aislado de todo lo demás.

        Buscarla por posición era frágil (el icono de al lado también tiene columnas altas);
        buscarla por formaestrecha Y más alta que cualquier letra la encuentra sola.
        """
        for b in self.bloques(x0, x1, y0, y1, pred, hueco=6):
            if b["ancho"] <= max_ancho and b["alto_max"] >= min_alto:
                return self.caja(b["x"], b["x2"], y0, y1, pred)
        return None

    def altura_versal(self, x0, x1, y0, y1, pred, corte=0.22) -> dict | None:
        """Alto de las mayúsculas: de la tapa de las versales a la línea de base.

        Las tildes y los descendentes ensanchan la caja de un texto pero no dicen nada de su
        cuerpo. Aquí solo cuentan las filas con al menos `corte` del máximo de tinta: las de las
        tildes tienen una fracción mínima y caen solas.
        """
        filas, _ = self.perfil(x0, x1, y0, y1, pred)
        if not filas:
            return None
        umbral = max(filas.values()) * corte
        fy = [y for y, n in filas.items() if n >= umbral]
        return {"y": min(fy), "y2": max(fy) + 1, "alto": max(fy) + 1 - min(fy)}

    def cruce(self, muestra, i0: int, i1: int, umbral: float, subiendo: bool) -> float | None:
        paso = 1 if i1 > i0 else -1
        prev = muestra(i0)
        for i in range(i0 + paso, i1, paso):
            v = muestra(i)
            if (subiendo and prev < umbral <= v) or (not subiendo and prev > umbral >= v):
                return (i - paso) + (umbral - prev) / (v - prev) * paso
            prev = v
        return None

    def muestra(self, x: int, y: int, lado: int = 9) -> str:
        r = g = b = n = 0
        for j in range(y - lado // 2, y + lado // 2 + 1):
            for i in range(x - lado // 2, x + lado // 2 + 1):
                p = self.px[i, j]
                r, g, b, n = r + p[0], g + p[1], b + p[2], n + 1
        return "#%02X%02X%02X" % (round(r / n), round(g / n), round(b / n))

    def dominante(self, x0, x1, y0, y1, pred) -> tuple[str, float]:
        """El color EXACTO más repetido entre los píxeles que cumplen `pred`, y su cuota.

        Promediar una ventana era suficiente para una masa plana y grandeel telón, pero
        miente en todo lo demás: sobre un trazo de 4 px o sobre una letra, la mitad de la
        ventana es antialias y el promedio sale a medio camino entre la tinta y el papel. Así
        el anillo del retrato «medía» #0D1E42 cuando su núcleo es exactamente el navy de la
        cabecera, y el cargo «medía» #303030 siendo negro puro.

        La cuota es la que dice si el valor vale: por encima del 30 % es una tinta plana; por
        debajo, la masa es demasiado fina para afirmar nada y hay que mirar el perfil.
        """
        from collections import Counter
        x0, x1 = max(0, int(x0)), min(self.ancho, int(x1))
        y0, y1 = max(0, int(y0)), min(self.alto, int(y1))
        c = Counter(self.px[x, y] for x in range(x0, x1) for y in range(y0, y1)
                    if pred(x, y))
        if not c:
            return "", 0.0
        (r, g, b), n = c.most_common(1)[0]
        return "#%02X%02X%02X" % (r, g, b), round(100 * n / sum(c.values()), 1)


# ── Ventanas de búsqueda, en px del carné normalizado (1024 × 1563) ─────────────
#
# Son generosas a propósito: cada una encierra un solo elemento y nada más, y el predicado
# (tinta / blanco / celeste / navy) hace el resto. Si un día el carné cambia de proporción,
# esto es lo único que hay que revisar.
#
# Ojo con dos que no se pueden ensanchar sin romperlas:
#  · `numeral` acaba en x=200 porque «Foro:» arranca en 216, y entre el asta del «1» y la F
#    solo hay 36 px de aire.
#  · las tres de `foro_*` empiezan en x=205 por lo mismo, y la de la ranura acaba en y=130
#    porque a partir de ahí ya es cabecera.
VENTANAS = {
    "ranura":          (330, 700, 20, 130),
    # El «1» acaba en la regla del lockup, no antes: su serif de base queda TAPADO por ella
    # (las dos son blancas y se funden). La ventana corta en y=302, el canto superior de la
    # regla, para medir el numeral y no la regla; y en x=210 porque «Foro:» arranca en 217.
    "numeral":         (70, 210, 108, 302),
    "foro_linea1":     (205, 620, 112, 182),
    "foro_linea2":     (205, 620, 182, 240),
    "foro_linea3":     (205, 620, 236, 296),
    "lockup_regla":    (60, 620, 296, 313),
    "bajada":          (60, 620, 313, 362),
    "burbujas":        (650, 1010, 100, 238),
    "wordmark":        (650, 1010, 238, 296),
    "nombre":          (60, 990, 985, 1098),
    "regla_celeste":   (60, 990, 1100, 1140),
    "cargo":           (60, 990, 1140, 1205),
    "pildora":         (40, 1010, 1215, 1390),
    "pie_dia":         (60, 950, 1390, 1449),
    "pie_lugar":       (60, 950, 1449, 1512),
}


def _renglon_pie(li: Lienzo, c: dict, clave: str, ventana: tuple) -> None:
    """Icono, rótulo y valor de un renglón del pie.

    Los dos renglones se miden con el mismo código: primero la caja entera, luego los bloques
    de columnas separados por huecos el primero es el icono, y el resto, el texto. La banda
    de versales se toma SOLO sobre el texto: con el icono dentro de la ventana, el corte por
    fracción de tinta lo decidía él y no las letras.
    """
    caja = li.caja(*ventana, li.tinta, 2, 2)
    c[clave] = caja
    if not caja:
        return
    # El margen de 6 px que da aire al icono se ACOTA a la ventana del renglón. Sin acotarlo,
    # los dos renglones se pisaban: el icono de «Día» se llevaba las tres primeras filas del
    # icono de «Lugar» (y salía de 36×46 en vez de 36×36), y el de «Lugar», la cola de la «g»
    # de «agosto». Entre un renglón y el otro solo hay 3 px de aire.
    y0 = max(ventana[2], caja["y"] - 6)
    y1 = min(ventana[3], caja["y2"] + 6)
    bl = li.bloques(caja["x"] - 2, caja["x2"] + 2, y0, y1, li.tinta)
    if not bl:
        return
    c[f"{clave}_icono"] = li.caja(bl[0]["x"], bl[0]["x2"], y0, y1, li.tinta)
    if len(bl) > 1:
        c[f"{clave}_texto"] = li.caja(bl[1]["x"], caja["x2"], y0, y1, li.tinta, 2, 2)
        c[f"{clave}_versal"] = li.altura_versal(bl[1]["x"], caja["x2"], y0, y1, li.tinta)
        # El rótulo («Día:» / «Lugar:») va en negrita y el valor en regular: el hueco entre
        # ambos es el que separa el primer bloque de texto del segundo.
        c[f"{clave}_rotulo"] = li.caja(bl[1]["x"], bl[1]["x2"], y0, y1, li.tinta)


def medir_elementos(li: Lienzo) -> dict:
    """Las cotas de todo lo que no es telón. Mismo código para la pieza y para el render."""
    c: dict[str, dict | None] = {}
    V = VENTANAS

    c["ranura"] = li.caja(*V["ranura"], lambda x, y: li.lum(x, y) > 150, 3, 3)
    c["numeral"] = li.caja(*V["numeral"], li.blanco, 2, 2)
    c["foro_linea1"] = li.caja(*V["foro_linea1"], li.blanco, 2, 2)
    c["foro_linea2"] = li.caja(*V["foro_linea2"], li.blanco, 2, 2)
    c["foro_linea3"] = li.caja(*V["foro_linea3"], li.es_celeste, 2, 2)
    # Las tres líneas del lockup NO llevan banda de versales, y es a propósito: `altura_versal`
    # corta por fracción del máximo de tinta de la ventana, y eso solo tiene sentido cuando las
    # mayúsculas son bastantes. En «Energía» hay UNA (la E) más la tilde de la í, así que la
    # banda la decide una coincidencia: en la pieza la fila 183 tiene 37 px de tinta contra un
    # corte de 36.3 y entra; en el render tiene 38 contra un corte de 38.5 y no. El mismo dibujo,
    # y la métrica cantaba 11px de desvío. La caja de cada línea sí es sólida (y es de donde
    # salen su cota y su cuerpo), así que la banda sobra. Las bandas de los textos largos
    # nombre, cargo, píldora, pie sí se miden: ahí el corte por fracción es estable.
    # La regla del lockup: ancha y de pocos px de alto → el mínimo manda en la fila.
    c["lockup_regla"] = li.caja(*V["lockup_regla"], li.blanco, 120, 2)
    c["bajada"] = li.caja(*V["bajada"], li.blanco, 2, 2)
    c["bajada_versal"] = li.altura_versal(*V["bajada"], li.blanco)
    c["burbujas"] = li.caja(*V["burbujas"], li.blanco, 2, 2)
    c["wordmark"] = li.caja(*V["wordmark"], li.blanco, 2, 2)

    c["nombre"] = li.caja(*V["nombre"], li.tinta, 2, 2)
    c["nombre_versal"] = li.altura_versal(*V["nombre"], li.tinta)
    c["regla_celeste"] = li.caja(*V["regla_celeste"], li.es_celeste, 120, 2)
    c["cargo"] = li.caja(*V["cargo"], li.tinta, 2, 2)
    c["cargo_versal"] = li.altura_versal(*V["cargo"], li.tinta)

    c["pildora"] = li.caja(*V["pildora"], li.es_navy, 40, 6)
    if c["pildora"]:
        p = c["pildora"]
        # El separador primero: una vez localizado, el icono es lo celeste de su izquierda y
        # el rótulo lo blanco de su derecha, sin ventanas cableadas. En esta pieza el filete
        # es de 1-2 px, así que el mínimo de alto es lo único que lo distingue del icono.
        c["pildora_sep"] = li.separador_vertical(p["x"], p["x2"], p["y"], p["y2"],
                                                 li.es_celeste, min_alto=40, max_ancho=8)
        xs = c["pildora_sep"]["x"] if c["pildora_sep"] else p["x"] + p["ancho"] // 3
        c["pildora_icono"] = li.caja(p["x"], xs - 4, p["y"], p["y2"], li.es_celeste, 2, 2)
        # El rótulo se busca en el TRAMO RECTO de la píldora: desde el separador hasta un radio
        # antes del canto derecho. El canto es antialias contra el papelo sea claro y la
        # caja del texto blanco se estiraba hasta él; y en el casquete redondeado ese canto se
        # mete hacia dentro, así que un recorte fijo de unos pocos px no bastaba.
        xt = c["pildora_sep"]["x2"] if c["pildora_sep"] else xs
        dentro = (xt, p["x2"] - p["alto"] / 2, p["y"] + 4, p["y2"] - 4)
        c["pildora_texto"] = li.caja(*dentro, li.blanco, 2, 2)
        c["pildora_texto_versal"] = li.altura_versal(*dentro, li.blanco)

    _renglon_pie(li, c, "pie_dia", V["pie_dia"])
    _renglon_pie(li, c, "pie_lugar", V["pie_lugar"])
    return c


def medir_retrato(li: Lienzo) -> dict:
    """Centro, ejes, grosor del anillo, filete blanco y tamaño de la foto.

    A diferencia de la pieza anterior aquí el retrato **sí es un círculo**: barriendo el trazo
    los dos ejes salen iguales dentro de un píxel (509 × 508), mientras que en `Escarapela.png`
    diferían en 17. Se sigue midiendo y reportando el alto y el ancho por separado, que es lo
    que permite afirmarlo en vez de suponerlo.

    El anillo es un trazo FINO (≈4 px sobre 1024): se mide como una carrera de navy a lo largo
    del eje vertical, no como un borde grueso. El filete blanco entre el trazo y la foto, en
    cambio, es casi el doble de ancho que en la pieza anterior.
    """
    cx, cy = 512.0, 724.0
    a = b = arr = aba = None
    for _ in range(3):  # dos barridos cruzados convergen en dos pasos
        xi, yi = int(round(cx)), int(round(cy))
        a = li.cruce(lambda x: li.lum(x, yi), 190, 520, 150, False)
        b = li.cruce(lambda x: li.lum(x, yi), 840, 500, 150, False)
        arr = li.cruce(lambda y: li.lum(xi, y), 420, 700, 150, False)
        aba = li.cruce(lambda y: li.lum(xi, y), 1060, 760, 150, False)
        if None in (a, b, arr, aba):
            return {}
        cx, cy = (a + b) / 2, (arr + aba) / 2

    xi = int(round(cx))
    # Del canto exterior hacia dentro: fin del trazo navy (vuelve el blanco del filete)...
    fin_trazo = li.cruce(lambda y: li.lum(xi, y), int(arr) + 1, int(arr) + 30, 150, True)
    # ...y del filete al comienzo de la foto (cualquier cosa que ya no sea papel).
    ini_foto = (li.cruce(lambda y: li.lum(xi, y), int(fin_trazo) + 1, int(fin_trazo) + 45, 244, False)
                if fin_trazo else None)
    trazo = round(fin_trazo - arr, 1) if fin_trazo else None
    filete = round(ini_foto - fin_trazo, 1) if ini_foto else None
    return {
        "cx": round(cx, 1), "cy": round(cy, 1),
        "ancho": round(b - a, 1), "alto": round(aba - arr, 1),
        "trazo_anillo": trazo, "filete": filete,
        "ancho_foto": round(b - a - 2 * (trazo + filete), 1) if filete else None,
        "x_izquierda": round(a, 1), "y_superior": round(arr, 1), "y_inferior": round(aba, 1),
    }


# ════════════════════════════════════════════════════════════════════════════════
# La pieza: comprobación del sangrado y curvas de los telones
# ════════════════════════════════════════════════════════════════════════════════

def rect_carne(li: Lienzo) -> dict:
    """Los cuatro bordes del carné dentro de la pieza.

    Esta pieza va **a sangre**: no hay margen ni sombra, el carné es el lienzo entero y las
    cuatro esquinas son cuadradas. Pero eso se COMPRUEBA, no se da por hecho: se avanza desde
    cada canto mientras la línea entera sea papel uniforme (casi blanca de lado a lado). Si un
    día llega un export como `Escarapela.png` con su margen, aquí se vería sin tocar nada.
    """
    def es_papel(muestras) -> bool:
        return all(min(p) > 235 for p in muestras)

    izq = der = arr = aba = 0
    while izq < li.ancho // 4 and es_papel([li.px[izq, y] for y in range(0, li.alto, 7)]):
        izq += 1
    while der < li.ancho // 4 and es_papel([li.px[li.ancho - 1 - der, y] for y in range(0, li.alto, 7)]):
        der += 1
    while arr < li.alto // 4 and es_papel([li.px[x, arr] for x in range(0, li.ancho, 7)]):
        arr += 1
    while aba < li.alto // 4 and es_papel([li.px[x, li.alto - 1 - aba] for x in range(0, li.ancho, 7)]):
        aba += 1

    x0, y0 = float(izq), float(arr)
    x1, y1 = float(li.ancho - der), float(li.alto - aba)
    return {"x0": x0, "x1": x1, "y0": y0, "y1": y1, "ancho": x1 - x0, "alto": y1 - y0,
            "a_sangre": izq == der == arr == aba == 0,
            "margen_px": {"izq": izq, "der": der, "arr": arr, "aba": aba}}


def radio_esquina(li: Lienzo, rc: dict) -> float:
    """Ajusta un círculo a la esquina superior izquierda del navy.

    En esta pieza da **0**: la esquina es cuadrada, porque el export va a sangre y el troquel
    redondeado del carné físico queda fuera del encuadre. No es un fallo de la medición
    devuelve 0 cuando no hay ni un punto de la curva que ajustar, que es exactamente el caso.
    """
    radios = []
    for y in range(int(rc["y0"]) + 2, int(rc["y0"]) + 60):
        x = li.cruce(lambda xx: li.lum(xx, y), max(0, int(rc["x0"]) - 12), int(rc["x0"]) + 70,
                     130, False)
        if x is None:
            continue
        dx, dy = x - rc["x0"], y - rc["y0"]
        if dx <= 0.5 or dy <= 0.5:
            continue
        disc = 4 * (dx + dy) ** 2 - 4 * (dx * dx + dy * dy)
        if disc < 0:
            continue
        r = ((2 * (dx + dy)) - disc ** 0.5) / 2
        if 5 < r < 120:
            radios.append(r)
    radios.sort()
    return radios[len(radios) // 2] if radios else 0.0


# El único celeste que hay POR ENCIMA del telón es «en Acción», el tercer renglón del lockup:
# x ∈ [216, 490], y ∈ [240, 285]. Y el telón, en el canto derecho, sube hasta y≈302. Entre esas
# dos cosas no cabe un suelo único, así que el suelo depende de x: por debajo del renglón donde
# el renglón existe, y bien arriba donde no lo hay. Con un suelo único de 292 también salía,
# pero con 7 px de margen a cada lado; así son 55 y 70.
def suelo_telon(x: float) -> int:
    return 300 if 190 <= x <= 520 else 232


def curvas_carne(li: Lienzo, paso: int = 3) -> dict:
    """Los tres bordes curvos de un carné normalizado, muestreados columna a columna.

    El borde del navy se busca por el COLOR DE LO QUE VIENE DEBAJOel primer píxel celeste de
    la columna, no por «donde se acaba el navy». Buscar el final del navy obligaba a distinguir
    el borde de verdad de los huecos que abre el texto blanco del lockup, y por abajo el anillo
    del retrato entra en juego. Celeste, por debajo de `suelo_telon(x)`, solo hay en la banda.
    """
    navy, cel_sup, cel_inf = [], [], []
    yb = li.alto - 4
    y_min = int(li.alto * 0.80)
    y_tope = int(li.alto * 0.58)  # el borde más bajo del telón, en el canto izquierdo, va por 765
    for x in range(1, li.ancho, paso):
        # Un celeste suelto no vale: se exige una carrera de 6 px. La pieza tiene franjas de
        # color de un píxel en los cantos del texto blanco, y una sola de ellas desvía la curva
        # cientos de píxeles.
        y, racha = suelo_telon(x), 0
        while y < y_tope and racha < 6:
            racha = racha + 1 if li.es_celeste(x, y) else 0
            y += 1
        if racha >= 6:
            y -= racha  # volver al primer píxel de la carrera
            b = li.cruce(lambda yy: li.lum(x, yy), y + 3, y - 14, 100, False)
            if b is not None:
                navy.append((float(x), b))
                # +4 px para saltarse la línea oscura de 1-2 px que el export deja en el
                # encuentro navy/celeste; sin ese salto el cruce se dispara dentro de la línea.
                c = li.cruce(lambda yy: li.lum(x, yy), int(b) + 4, int(b) + 110, 215, True)
                if c is not None:
                    cel_sup.append((float(x), c))
        # La banda de abajo se busca DESDE EL CANTO INFERIOR HACIA ARRIBA: muere contra ese
        # canto, y de arriba abajo el texto oscuro del pie se llevaba el cruce.
        if li.es_celeste(x, yb):
            d = li.cruce(lambda yy: li.lum(x, yy), yb, y_min, 215, True)
            if d is not None:
                cel_inf.append((float(x), d))
    return {"navy": navy, "celeste_sup": cel_sup, "celeste_inf": cel_inf}


# ── Ajuste de splines cúbicas (→ Béziers exactas) ───────────────────────────────

def _resolver(A: list[list[float]], b: list[float]) -> list[float]:
    """Gauss con pivoteo parcial. Sistemas de ~25 incógnitas: sobra."""
    n = len(b)
    M = [fila[:] + [b[i]] for i, fila in enumerate(A)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(M[r][col]))
        M[col], M[piv] = M[piv], M[col]
        p = M[col][col]
        if abs(p) < 1e-12:
            continue
        for r in range(n):
            if r == col:
                continue
            f = M[r][col] / p
            if f:
                for cc in range(col, n + 1):
                    M[r][cc] -= f * M[col][cc]
    return [M[i][n] / M[i][i] if abs(M[i][i]) > 1e-12 else 0.0 for i in range(n)]


def ajustar(puntos, n_seg: int):
    """Spline cúbica de Hermite C¹ por mínimos cuadrados, con nudos por longitud de arco.

    La curva es una función de x, así que cada tramo se convierte en una Bézier EXACTA
    repartiendo los puntos de control en tercios: con los x equiespaciados, x(t) es lineal.
    """
    puntos = sorted(puntos)
    acum = [0.0]
    for i in range(1, len(puntos)):
        dx = puntos[i][0] - puntos[i - 1][0]
        dy = puntos[i][1] - puntos[i - 1][1]
        acum.append(acum[-1] + (dx * dx + dy * dy) ** 0.5)
    total = acum[-1]
    nudos = [puntos[0][0]]
    for s in range(1, n_seg):
        objetivo = total * s / n_seg
        i = next(j for j in range(len(acum)) if acum[j] >= objetivo)
        nudos.append(puntos[i][0])
    nudos.append(puntos[-1][0])
    nudos = sorted(set(nudos))
    n = len(nudos) - 1
    m = 2 * (n + 1)

    A = [[0.0] * m for _ in range(m)]
    rhs = [0.0] * m
    for pxx, pyy in puntos:
        i = min(max(next((j for j in range(n) if pxx <= nudos[j + 1]), n - 1), 0), n - 1)
        h = nudos[i + 1] - nudos[i]
        t = (pxx - nudos[i]) / h
        t2, t3 = t * t, t * t * t
        base = [(2 * t3 - 3 * t2 + 1, 2 * i), (h * (t3 - 2 * t2 + t), 2 * i + 1),
                (-2 * t3 + 3 * t2, 2 * i + 2), (h * (t3 - t2), 2 * i + 3)]
        for c1, k1 in base:
            rhs[k1] += c1 * pyy
            for c2, k2 in base:
                A[k1][k2] += c1 * c2
    for k in range(m):
        A[k][k] += 1e-7  # cresta mínima: los nudos extremos apenas tienen puntos a un lado
    sol = _resolver(A, rhs)
    return nudos, [sol[2 * i] for i in range(n + 1)], [sol[2 * i + 1] for i in range(n + 1)]


def evaluar(nudos, ys, ms, x: float) -> float:
    n = len(nudos) - 1
    i = min(max(next((j for j in range(n) if x <= nudos[j + 1]), n - 1), 0), n - 1)
    h = nudos[i + 1] - nudos[i]
    t = (x - nudos[i]) / h
    t2, t3 = t * t, t * t * t
    return ((2 * t3 - 3 * t2 + 1) * ys[i] + h * (t3 - 2 * t2 + t) * ms[i]
            + (-2 * t3 + 3 * t2) * ys[i + 1] + h * (t3 - t2) * ms[i + 1])


def ajustar_hasta(puntos, tolerancia=1.0, max_seg=12):
    for n_seg in range(2, max_seg + 1):
        nudos, ys, ms = ajustar(puntos, n_seg)
        err = max(abs(evaluar(nudos, ys, ms, x) - y) for x, y in puntos)
        if err <= tolerancia:
            return nudos, ys, ms, err, n_seg
    return nudos, ys, ms, err, n_seg


def extender(nudos, ys, ms, x_ini, x_fin):
    """Prolonga la spline hasta los cantos con la pendiente de sus extremos.

    Los barridos empiezan y acaban 1-3 px dentro del carné (el canto mismo es antialias); sin
    esta prolongación el `d` dejaría un escalón contra el borde.
    """
    nudos, ys, ms = list(nudos), list(ys), list(ms)
    if x_ini < nudos[0]:
        ys.insert(0, ys[0] - ms[0] * (nudos[0] - x_ini)); ms.insert(0, ms[0]); nudos.insert(0, x_ini)
    if x_fin > nudos[-1]:
        ys.append(ys[-1] + ms[-1] * (x_fin - nudos[-1])); ms.append(ms[-1]); nudos.append(x_fin)
    return nudos, ys, ms


def bezier(nudos, ys, ms):
    segs = []
    for i in range(len(nudos) - 1):
        h = nudos[i + 1] - nudos[i]
        segs.append([(nudos[i], ys[i]),
                     (nudos[i] + h / 3, ys[i] + h * ms[i] / 3),
                     (nudos[i + 1] - h / 3, ys[i + 1] - h * ms[i + 1] / 3),
                     (nudos[i + 1], ys[i + 1])])
    return segs


def _c(s):
    return f" C{s[1][0]:.1f} {s[1][1]:.1f} {s[2][0]:.1f} {s[2][1]:.1f} {s[3][0]:.1f} {s[3][1]:.1f}"


def d_adelante(segs) -> str:
    return f"M{segs[0][0][0]:.1f} {segs[0][0][1]:.1f}" + "".join(_c(s) for s in segs)


def d_atras(segs) -> str:
    """Solo los tramos C, recorridos de derecha a izquierda (para cerrar figuras)."""
    return "".join(f" C{s[2][0]:.1f} {s[2][1]:.1f} {s[1][0]:.1f} {s[1][1]:.1f} "
                   f"{s[0][0]:.1f} {s[0][1]:.1f}" for s in reversed(segs))


# ════════════════════════════════════════════════════════════════════════════════

def paleta(li: Lienzo, rc: dict, k: float, cajas: dict, retrato: dict) -> dict[str, str]:
    """Las tintas del carné, cada una medida sobre el NÚCLEO de su propia masa.

    Se mide sobre los píxeles **originales de la pieza**, no sobre la referencia normalizada.
    Las cotas sí van normalizadas (es el sistema en el que se piensa el CSS), y aquí se
    devuelven a coordenadas de la pieza; pero el color no: llevar la pieza de 1080 a 1024
    difumina un trazo de 4 px lo justo para que su núcleo deje de existir, y con él la
    medición «el anillo mide #0D1E42» era el promedio del trazo con el papel, no su tinta.

    Lo que este muestreo descubrió y no se veía a ojo: la pieza usa **dos navies y tres
    celestes**, y no son ruido de compresión sino cuotas del 99 % sobre masas planas.

      · `#1C2C4E` el telón de la cabecera y el anillo del retrato.
      · `#1F2E55` la píldora, y también los iconos y el texto del pie (que NO es negro).
      · `#73BFE1` las dos bandas celestes y la regla bajo el nombre.
      · `#89D0E5` «en Acción» un celeste más claro que la banda, casi el token del sistema.
      · `#6FBFE0` el icono de la píldora justo el celeste de la pieza anterior.
      · `#000000` el nombre y el cargo, negro puro (no el navy de la pieza anterior).

    Cada entrada lleva su cuota entre paréntesis: es la que permite distinguir una tinta plana
    de una masa demasiado fina para afirmar nada.
    """
    osc = lambda x, y: li.lum(x, y) < 70  # noqa: E731 núcleo de tinta, sin antialias
    papel = lambda x, y: min(li.px[x, y]) > 235  # noqa: E731

    def con_cuota(par: tuple[str, float]) -> str:
        return f"{par[0]} ({par[1]:.0f} %)"

    def en_pieza(x: float, y: float) -> tuple[float, float]:
        return rc["x0"] + x / k, rc["y0"] + y / k

    def dom(x0, y0, x1, y1, pred) -> str:
        """`dominante` sobre una ventana dada en px NORMALIZados, medida en la pieza."""
        a = en_pieza(x0, y0)
        b = en_pieza(x1, y1)
        return con_cuota(li.dominante(a[0], b[0], a[1], b[1], pred))

    def de_caja(clave, pred, mx=0, my=0) -> str | None:
        b = cajas.get(clave)
        if not b or "x" not in b:
            return None
        return dom(b["x"] + mx, b["y"] + my, b["x2"] - mx, b["y2"] - my, pred)

    p = {
        "navy_telon": dom(20, 60, 400, 110, osc),
        "navy_pildora": dom(600, 1240, 900, 1280, osc),
        "celeste_banda_sup": dom(700, 306, 1010, 328, li.es_celeste),
        "celeste_banda_inf": dom(200, 1540, 900, 1558, li.es_celeste),
        "papel": dom(700, 1000, 1000, 1100, papel),
    }
    for clave, destino, pred, mx, my in (
        ("foro_linea3", "celeste_en_accion", li.es_celeste, 0, 0),
        # La regla, solo su núcleo: 4 px con antialias arriba y abajo.
        ("regla_celeste", "celeste_regla", li.es_celeste, 20, 1),
        ("pildora_icono", "celeste_icono_pildora", li.es_celeste, 0, 0),
        ("nombre", "nombre", osc, 0, 0),
        ("cargo", "cargo", osc, 0, 0),
        ("pie_dia_rotulo", "pie_texto", osc, 0, 0),
        ("pie_lugar_icono", "pie_icono", osc, 0, 0),
    ):
        v = de_caja(clave, pred, mx, my)
        if v:
            p[destino] = v
    if retrato:
        # La corona del anillo por su punto más alto: 1 px por dentro del canto exterior, que
        # es donde el trazo de 4 px llega a tinta plena.
        y0 = retrato["y_superior"] + 1
        p["navy_anillo"] = dom(retrato["cx"] - 40, y0, retrato["cx"] + 40, y0 + 3, osc)
    return p


def cqw(v: float | None) -> str:
    return "" if v is None else f"{v / 10.24:.2f}"


def main() -> None:
    SALIDA.mkdir(parents=True, exist_ok=True)
    pieza = Lienzo(Image.open(PIEZA))

    rc = rect_carne(pieza)
    k = ANCHO_N / rc["ancho"]
    alto_n = rc["alto"] * k
    alto = round(alto_n)
    radio = radio_esquina(pieza, rc)

    # ── La referencia: el carné llevado a 1024 de ancho ──────────────────────────
    # `box` con decimales: el recorte es SUBPÍXEL, así que el canto del carné cae exactamente
    # en 0 y en 1024. En esta pieza el recorte es el lienzo entero, pero el reescalado sigue
    # siendo el que iguala la resolución de la referencia y la de la captura del render.
    ref_img = pieza.img.resize((ANCHO_N, alto), Image.LANCZOS,
                               box=(rc["x0"], rc["y0"], rc["x1"], rc["y1"]))
    ref_img.save(SALIDA / "carne.png")
    ref = Lienzo(ref_img)

    # ── Telones ─────────────────────────────────────────────────────────────────
    cur = curvas_carne(ref)
    ajustes = {}
    for nombre, pts in cur.items():
        nudos, ys, ms, err, n_seg = ajustar_hasta(pts, tolerancia=1.0)
        # Los telones de arriba cruzan el carné de canto a canto. El de abajo muere en una cuña
        # tangente al canto inferior que los barridos pierden por debajo de ~3 px de grosor: se
        # prolonga por la tangente hasta tocarlo, que es donde de verdad acaba.
        if nombre == "celeste_inf":
            x_ini = max(0.0, nudos[0] + (alto_n - ys[0]) / ms[0]) if ms[0] < -1e-6 else nudos[0]
        else:
            x_ini = 0.0
        ajustes[nombre] = {"segmentos": bezier(*extender(nudos, ys, ms, x_ini, float(ANCHO_N))),
                           "error_max_px": round(err, 2), "n_seg": n_seg,
                           "y_izq": round(evaluar(nudos, ys, ms, pts[0][0]), 1),
                           "y_der": round(evaluar(nudos, ys, ms, pts[-1][0]), 1),
                           "x_izq": round(pts[0][0], 1), "x_der": round(pts[-1][0], 1)}

    sn, ss, si = (ajustes[n]["segmentos"] for n in ("navy", "celeste_sup", "celeste_inf"))
    d_navy = f"M0 0 H{ANCHO_N} V{sn[-1][3][1]:.1f}" + d_atras(sn) + " Z"
    d_cel_sup = d_adelante(sn) + f" L{ss[-1][3][0]:.1f} {ss[-1][3][1]:.1f}" + d_atras(ss) + " Z"
    d_cel_inf = d_adelante(si) + f" L{ANCHO_N} {alto} H{si[0][0][0]:.1f} Z"
    (SALIDA / "ondas.txt").write_text(
        f"// Generado por scripts/escarapela-medir.py viewBox 0 0 {ANCHO_N} {alto}\n\n"
        f"navy:\n{d_navy}\n\ncelesteSuperior:\n{d_cel_sup}\n\ncelesteInferior:\n{d_cel_inf}\n",
        "utf-8")

    # ── Cotas ───────────────────────────────────────────────────────────────────
    cajas = medir_elementos(ref)
    retrato = medir_retrato(ref)

    medidas = {
        "pieza": {"archivo": PIEZA.name, "ancho": pieza.ancho, "alto": pieza.alto},
        "carne_en_pieza": {kk: (round(v, 2) if isinstance(v, float) else v) for kk, v in rc.items()},
        "normalizacion": {"factor": round(k, 5), "ancho": ANCHO_N, "alto": alto,
                          "proporcion": f"1024 / {alto}"},
        "radio_esquina": round(radio * k, 1),
        "paleta": paleta(pieza, rc, k, cajas, retrato),
        "retrato": retrato,
        "cajas": cajas,
        "curvas": {kk: {x: v[x] for x in ("error_max_px", "n_seg", "x_izq", "y_izq", "x_der", "y_der")}
                   for kk, v in ajustes.items()},
        "curvas_muestras": {kk: [[round(a, 1), round(b, 1)] for a, b in v] for kk, v in cur.items()},
    }
    (SALIDA / "medidas.json").write_text(json.dumps(medidas, indent=2, ensure_ascii=False), "utf-8")

    # ── Fixture: la foto del carné, cuadrada ────────────────────────────────────
    # Cuadrado circunscrito al círculo de la foto: es exactamente lo que el carné recorta con
    # `border-radius: 50%` + `object-fit: cover`, así que el fixture entra sin reencuadre.
    lado = (retrato["ancho_foto"] or retrato["ancho"]) / k
    cxp = rc["x0"] + retrato["cx"] / k
    cyp = rc["y0"] + retrato["cy"] / k
    pieza.img.crop((round(cxp - lado / 2), round(cyp - lado / 2),
                    round(cxp + lado / 2), round(cyp + lado / 2))).resize(
        (512, 512), Image.LANCZOS).save(SALIDA / "foto-fixture.jpg", quality=92)

    # ── Overlay de revisión ─────────────────────────────────────────────────────
    ov = ref_img.copy()
    dib = ImageDraw.Draw(ov)
    for nombre, b in cajas.items():
        if b and "x" in b:
            dib.rectangle([b["x"], b["y"], b["x2"] - 1, b["y2"] - 1], outline=(255, 0, 120), width=2)
            dib.text((b["x"] + 3, max(0, b["y"] - 12)), nombre, fill=(255, 0, 120))
        elif b:  # las alturas de versal solo tienen banda vertical
            dib.line([0, b["y"], 1023, b["y"]], fill=(255, 200, 0), width=1)
            dib.line([0, b["y2"] - 1, 1023, b["y2"] - 1], fill=(255, 200, 0), width=1)
    dib.ellipse([retrato["cx"] - retrato["ancho"] / 2, retrato["cy"] - retrato["alto"] / 2,
                 retrato["cx"] + retrato["ancho"] / 2, retrato["cy"] + retrato["alto"] / 2],
                outline=(0, 255, 90), width=2)
    ov.save(SALIDA / "cajas.png")

    # ── Informe ─────────────────────────────────────────────────────────────────
    L = [f"# {PIEZA.name} medidas\n",
         "Generado por `scripts/escarapela-medir.py`. No editar a mano.\n",
         "## El carné dentro de la pieza\n",
         f"- **A sangre: {'sí' if rc['a_sangre'] else 'NO'}** (margen detectado: "
         + ", ".join(f"{kk} {v}px" for kk, v in rc["margen_px"].items()) + ")",
         f"- Rect en px de la pieza: x ∈ [{rc['x0']:.2f}, {rc['x1']:.2f}], "
         f"y ∈ [{rc['y0']:.2f}, {rc['y1']:.2f}]",
         f"- Tamaño real: **{rc['ancho']:.2f} × {rc['alto']:.2f}** px",
         f"- Normalizado a 1024 de ancho (×{k:.5f}): **1024 × {alto}** → `aspect-ratio: 1024 / {alto}`",
         f"- Radio de esquina: **{radio * k:.1f}** = {cqw(radio * k)}cqw"
         + ("  ← esquina cuadrada: el export va a sangre" if radio == 0 else "") + "\n",
         "## Paleta muestreada\n"]
    L += [f"- `{kk}`: {v}" for kk, v in medidas["paleta"].items()]
    L += ["\n## Telones\n",
          "| curva | x izq | y izq | x der | y der | segmentos | error máx |",
          "|---|---|---|---|---|---|---|"]
    L += [f"| {kk} | {v['x_izq']} | {v['y_izq']} | {v['x_der']} | {v['y_der']} | {v['n_seg']} | "
          f"{v['error_max_px']} px |" for kk, v in medidas["curvas"].items()]
    L += ["\nLos `d` listos para pegar están en `ondas.txt`.\n",
          "## Cotas de los elementos\n",
          "En px de un carné de 1024 de ancho. `cqw` = valor / 10.24.\n",
          "| elemento | x | y | ancho | alto | cx | x cqw | y cqw | ancho cqw | alto cqw |",
          "|---|---|---|---|---|---|---|---|---|---|"]
    for kk, v in cajas.items():
        if not v:
            L.append(f"| {kk} | | | | | | | | | |")
        elif "x" not in v:  # altura de versal: solo banda vertical
            L.append(f"| {kk} | | {v['y']} | | {v['alto']} | | | {cqw(v['y'])} | | "
                     f"{cqw(v['alto'])} |")
        else:
            L.append(f"| {kk} | {v['x']} | {v['y']} | {v['ancho']} | {v['alto']} | {v['cx']} | "
                     f"{cqw(v['x'])} | {cqw(v['y'])} | {cqw(v['ancho'])} | {cqw(v['alto'])} |")
    L += ["\n## Retrato\n"]
    L += [f"- `{kk}`: {v} ({cqw(v)}cqw)" for kk, v in retrato.items()]
    (SALIDA / "report.md").write_text("\n".join(L) + "\n", "utf-8")

    print(f"pieza {pieza.ancho}×{pieza.alto} → carné {rc['ancho']:.2f}×{rc['alto']:.2f} → 1024×{alto}"
          f"  ({'a sangre' if rc['a_sangre'] else 'CON MARGEN'})")
    for kk, v in medidas["curvas"].items():
        print(f"  {kk}: {v['n_seg']} segmentos, error máx {v['error_max_px']} px, "
              f"{len(cur[kk])} columnas")
    faltan = [kk for kk, v in cajas.items() if not v]
    if faltan:
        print("  SIN MEDIR: " + ", ".join(faltan))
    print(f"→ {SALIDA}")


if __name__ == "__main__":
    main()

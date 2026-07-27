# Sistema de diseño — 1° Foro GECELCA «G-TALKS»

Este documento explica **de dónde sale cada token** de `src/design/tokens.css`.

La regla del proyecto es que ningún color, tamaño o radio se inventa ni se cita de memoria.
Todo valor está medido sobre las tres piezas gráficas de la raíz con
`scripts/extract-pdf-design.py`. La medición cruda que respalda este documento está en
`design-extract/report.md` (carpeta de trabajo, no versionada; se regenera con el script).

| Pieza | Rol |
|---|---|
| `invitacion gtalk 2026.pdf` | invitación general, copy neutro |
| `invitación expertos.pdf` | invitación a ponentes externos |
| `2 Arte foro gtalk 2026.pdf` | invitación interna (Presidencia) |

Las tres miden 612 pt de ancho y son verticales de una sola página.

---

## Color

Los porcentajes son el área que cada color cubre sumando las tres piezas: relleno de las
formas más la caja de los textos. Sirven para distinguir un fondo de un acento.

| Token | Valor | Área | Dónde se observó |
|---|---|---|---|
| `--gt-carta` | `#EDEDED` | 55.95% | tarjeta que contiene toda la agenda, idéntica en las 3 piezas |
| `--gt-celeste` | `#8BD0E5` | 47.89% | arcos que separan bandas, franjas, caja destacada, fondo del badge |
| `--gt-tinta` | `#1D1D1B` | 16.07% | texto de cuerpo |
| `--gt-navy` | `#1F335E` | 15.98% | banda del hero, títulos de sección, footer |
| `--gt-blanco` | `#FFFFFF` | 5.59% | texto sobre navy, fondo general |
| `--gt-azul-medio` | `#1D71B8` → **`#1C6FB4`** | 3.98% | títulos de cada bloque de la agenda — *ver Accesibilidad* |
| `--gt-navy-deep` | `#1D2A4C` | 2.21% | círculo tras el numeral «1» (solo en `invitacion gtalk`) |
| `--gt-azul-gecelca` | `#004A96` | 0.73% | logo Gecelca, wordmark G-TALKS, íconos |
| `--gt-celeste-tinte` | `#BCDEE9` | derivado | filas logísticas de la agenda |

### De la hoja impresa a la pantalla: los derivados

Las tres piezas son verticales de 612 pt sobre papel blanco, con el navy y el celeste como
bandas. Trasladado tal cual, eso da una página blanca con una franja azul arriba: correcta y
olvidable. La traducción a pantalla invierte la relación —**el campo es oscuro y el papel es la
excepción**— y para eso hicieron falta cuatro valores más.

Ninguno es un color nuevo: **todos son mezclas declaradas de los medidos**, escritas con
`color-mix()` en `tokens.css`, así que la regla del proyecto se mantiene —cada valor o está
medido, o es una mezcla trazable de dos que sí lo están—.

| Token | Definición | Para qué |
|---|---|---|
| `--gt-noche` | `--gt-navy` 56% + negro | el campo de toda la página |
| `--gt-abisal` | `--gt-navy` 34% + negro | header desplazado y footer |
| `--gt-humo` | `--gt-blanco` 76% + `--gt-navy` | texto secundario sobre el campo (10:1) |
| `--gt-celeste-alto` | `--gt-celeste` 68% + blanco | hover y foco sobre el campo |

Sobre ese campo hay **dos superficies y nada más**: la lámina clara (`.gt-lamina`, el papel de la
pieza, donde vive el programa) y el plano navy (la caja destacada, los estados vacíos). La
separación entre elementos se hace con **hairlines de 1 px**, que es lo que hacen las piezas —84
de sus 87 trazos son de 1 pt—, no con sombras. Hay **una sola sombra en todo el sitio**: la que
levanta la lámina del programa sobre el campo.

El grano (`--gt-grano`, ruido SVG en línea) va sobre los campos oscuros al 5%. Un plano digital
perfectamente liso delata la pantalla; el grano le devuelve la textura del impreso del que sale
todo esto, sin pedir un solo byte a la red.

### El elemento firma: la línea del día

`LineaDelDia.tsx` dibuja la jornada como una línea de tiempo **de una sola pista**: el ancho de
cada tramo es su duración real —el almuerzo de 2 h 30 ocupa cinco veces lo que una ponencia de
30 min— y el alto es constante para todos.

Hubo antes una versión en barras donde el alto codificaba «intensidad» (cuánta gente hay en
escena). **Se descartó porque ese dato no existe**: en la agenda de un día lo único real es
cuándo empieza cada cosa y cuánto dura. Una segunda magnitud inventada obliga a leer el gráfico
dos veces y compite con la que sí importa. El tipo de bloque se distingue ahora por tratamiento
—plano celeste el panel, plano atenuado la ponencia, plano oscuro el hito, trama diagonal la
pausa—, así que la comparación de duraciones queda limpia.

Tres cosas que lo hacen algo que se recorre y no solo se mira:

- **Etiqueta según quepa.** Cada tramo es su propio *container*: la hora aparece a partir de
  46 px de ancho y el nombre a partir de 104 px. Depende del ancho del tramo, no del de la
  ventana, que es la única forma de que ningún texto salga cortado.
- **Resaltado cruzado.** La línea y el programa son dos vistas del mismo dato: señalar un bloque
  en cualquiera de las dos lo marca en la otra. El estado vive en `InicioPage`, que es lo único
  que ambas comparten.
- **Marcador de «ahora».** Solo se dibuja el 5 de agosto y dentro del horario del foro; cualquier
  otro día sería ruido.

No sustituye al programa: es su índice. Cada tramo enlaza al bloque de abajo, que se marca al
llegar. Los datos salen de `AGENDA`, así que la línea se redibuja sola si cambia un horario.

### Fotografía: por qué van en duotono

Las tres fotos vienen incrustadas en los PDF a baja resolución (456×652 la mayor) y con una
dominante naranja de atardecer que pelea con el celeste de la marca. El duotono navy→celeste de
`PhotoFrame` —gris en `screen` sobre el navy, celeste en `multiply` encima— resuelve las dos cosas
a la vez: unifica la paleta y disimula la falta de detalle. La foto pasa a leerse como decisión
gráfica y no como un JPG pequeño estirado. Eso **no cierra el pendiente #4**: el original en alta
sigue haciendo falta.

### Movimiento

Convención, no medición. Salidas exponenciales sin rebote (`--gt-ease`), porque el sistema es
institucional y no juguetón. Y una regla dura: **no hay revelados por scroll en el contenido**.
Una animación que esconde texto hasta que el navegador la dispara es una sección en blanco
esperando a fallar —en una pestaña de fondo, en una captura de pantalla, en un renderizador sin
soporte—. Lo único que depende del scroll es el plano del header, que no oculta nada. La entrada
del hero es una sola secuencia al cargar, de 700 ms, y `prefers-reduced-motion` la apaga entera.

### Tres cosas que solo se supieron midiendo

**1. Los valores declarados no son los que se renderizan.** Al rasterizar, MuPDF desvía cada
canal ~1 unidad por gestión de color ICC: `#8BD0E5` sale `#8AD0E4`, `#EDEDED` sale `#ECECEC`.
Los tokens usan el valor **declarado en el PDF**, que es el que eligió quien diseñó.

**2. `#BCDEE9` no existe como color.** Es `--gt-celeste` pintado **al 50%** sobre
`--gt-carta`. La opacidad está en un `/ExtGState` con `ca = .5`; `get_drawings()` de PyMuPDF
reporta `fill_opacity = 1.0` para ese path, así que leerla del path habría dado un valor
falso. Sin detectarlo, este color habría entrado a la paleta como un plano más.

En CSS conviene expresarlo como la mezcla que es, no como un plano:

```css
background: color-mix(in srgb, var(--gt-celeste) 50%, var(--gt-carta));
```

**3. Dos colores quedaron fuera de los tokens a propósito:**

- `#006533` (verde) — 0.028% del área. Solo existe dentro del trazo del logo Gecelca; nunca
  se usa como color de interfaz. Vive dentro de `logo-gecelca.svg` y no se expone como token.
- `#010101` — un segundo negro tipográfico, presente solo en `invitación expertos`. Es
  redundante con `--gt-tinta` y unificarlo no cambia nada perceptible (20.87:1 vs 16.88:1
  sobre blanco).

---

## Tipografía

| Familia | Dónde | Licencia | Decisión |
|---|---|---|---|
| **Urbanist** | todo el texto | SIL OFL 1.1 | se usa, autohospedada |
| **Bely Display** | solo el numeral «1» (150–157 pt) | licenciada (TypeTogether) | no se usa: es un grafismo |
| **Museo Slab 900** | solo el wordmark «G-TALKS» | licenciada (exljbris) | no se usa: es un logotipo |

Las dos licenciadas aparecen **únicamente en elementos de marca**, nunca en texto corriente.
En vez de buscarles una sustituta geométrica aproximada —que es lo que contemplaba el plan—
se resuelven como asset gráfico: el numeral y el wordmark son dibujo, no texto. Así el sitio
no depende de ninguna fuente licenciada ni de una imitación.

Ambos salen del PDF como **contornos vectoriales exactos**, no como imagen rasterizada. Las dos
fuentes van incrustadas en las piezas, así que `build-assets.py` las lee y extrae el trazado de los
glifos que se usan (`numeral-uno.svg`, 0.3 KB; `wordmark-g-talks.svg`, 1.8 KB).

Detalle que costó encontrar: las dos van como **CFF desnudo** (Type1C), que no es un contenedor
sfnt. `fontTools.ttLib.TTFont` las rechaza con «bad sfntVersion» y hay que leerlas con `cffLib`;
además, al no tener tabla `cmap`, el glifo se localiza por su nombre AGL (`one`, `G`, `hyphen`…).
Urbanist, en cambio, va como TrueType normal. `FuentePDF` en `build-assets.py` unifica los dos
casos.

Urbanist coincide con la del proyecto hermano PORTALES GECELCA, así que el *cross-check*
tipográfico pasa. **El de color no**: allí los azules son `#0046A0` / `#002F6D` y aquí son
`#004A96` / `#1F335E`. El azul del logo es casi el mismo; el navy es otro. Estas piezas son
de la línea G-TALKS y mandan sobre la memoria del proyecto hermano.

### Archivos y por qué están declarados así

Verificado con `fontTools`, no supuesto (ver `src/design/fonts.css`):

- El **romano es variable**, eje `wght 100..900`. Un solo archivo cubre Regular y Bold, y se
  declara `font-weight: 100 900`.
- La **itálica no es variable**: es estática a 400. Se declara `font-weight: 400` justamente
  para que el navegador no la estire a otros pesos con una negrita sintética. En las piezas la
  itálica solo aparece en Regular, así que alcanza.
- Los acentos del español están en el subconjunto `latin`. `latin-ext` se conserva por los
  nombres propios que la escarapela puede recibir desde Entra.

64 KB en disco, y `unicode-range` hace que el navegador baje solo lo que use.

### Escala

Se midieron 19 tamaños distintos, más de los que un sistema necesita: varios difieren en
décimas porque cada pieza se maquetó a mano (27.8 vs 27.7 pt; 19.3 vs 19.0 vs 18.8 pt).
Colapsados a los 7 roles reales, anclando el cuerpo de 20 pt en `1rem`:

| Token | Valor | Sale de | Uso |
|---|---|---|---|
| `--gt-fs-display` | `clamp(3.4rem, 10.5vw, 6rem)` | 150–157 pt | titular del hero |
| `--gt-fs-h1` | `clamp(2.25rem, 5.4vw, 3.5rem)` | 39.1 / 40.9 / 51.8 pt | títulos de página |
| `--gt-fs-h2` | `clamp(1.7rem, 3.4vw, 2.35rem)` | 30.6 pt | «Agenda Académica» |
| `--gt-fs-h3` | `clamp(1.2rem, 2vw, 1.45rem)` | — | títulos de bloque |
| `--gt-fs-lead` | `clamp(1.15rem, 1.9vw, 1.4rem)` | 27.7 / 27.8 pt | bajadas e intros |
| `--gt-fs-body` | `1.0625rem` | 20 pt | cuerpo |
| `--gt-fs-sm` | `0.9375rem` | 16 pt | nombres, cargos largos |
| `--gt-fs-xs` | `0.8125rem` | 14 / 15 pt | cargos, pies |
| `--gt-fs-micro` | `0.6875rem` | — | etiquetas de dato: horas, roles, ejes |

La escala va en `rem` relativos al cuerpo, no en px absolutos: lo que se conserva de la pieza
es la **proporción entre niveles**, no el tamaño físico. Los niveles grandes usan `clamp()`
porque la pieza es una vertical de 612 pt y el sitio es responsive. La razón entre pasos es
~1.3: por debajo de 1.25 la escala se lee indecisa. El techo del display está en 6 rem; por
encima el sitio grita en vez de hablar.

Como familia hay una sola, el contraste lo hacen el peso y el tracking: el romano es variable
(100–900) y el sistema usa 300 para bajadas, 400 cuerpo, 500/600 datos y 700/800 titulares.

**`--gt-fs-micro` en mayúsculas con tracking es tipografía de dato, no un «eyebrow»**: se usa en
horas, roles y ejes del gráfico. Ninguna sección lleva una etiqueta encima del título; esa
muletilla es lo que hace que una página se lea como plantilla.

---

## Formas

Radios medidos por el bbox de los segmentos Bézier de cada path cerrado, y convertidos a px
con `1 pt = 1.3333 px` (el tamaño que tendría la pieza rasterizada a 96 dpi).

| Token | Valor | Medido | Origen |
|---|---|---|---|
| `--gt-radio-tarjeta` | `34px` | 25.6 pt | tarjeta de la agenda, igual en las 3 piezas |
| `--gt-radio-caja` | `30px` | 22.7 pt | caja destacada celeste |
| `--gt-radio-pildora` | `999px` | radio = alto/2 | píldora de fecha (14.4 sobre 28.9) |
| `--gt-radio-foto` | `136px` | 101.9 pt | marco de foto |
| `--gt-borde` | `1px` | 1 pt | 84 de los 87 trazos del documento |

**El radio asimétrico del marco de foto está confirmado por medición**, no deducido a ojo:
101.9 pt en la esquina superior-izquierda y en la inferior-derecha, **0 en las otras dos**. Es la
forma en «hoja» característica del sistema. No va como un token de radio completo porque cada uso
tiene que acotarlo al tamaño real de su caja —136 px se comerían un monograma de 44 px—: cada
componente la construye a partir de `--gt-radio-foto`.

Los arcos que separan bandas son paths de 633×700 pt con radios de 144.7 y 163.8 pt arriba y
recto abajo: no son medias circunferencias. Medida la forma, un `border-radius` en porcentaje la
reproduce exacta y sin el problema del SVG estirado —con `preserveAspectRatio="none"` las curvas
se deforman al cambiar el ancho—, así que `ArcDivider` es un `div` y no un SVG. Se conserva el
nombre del componente.

La forma en «hoja» del marco de foto se reutiliza en todo lo que es una superficie del sistema:
el monograma de los ponentes, las iniciales de la agenda, la caja destacada y los paneles de los
estados vacíos. Es lo que hace que piezas distintas se lean como la misma familia.

---

## Accesibilidad

Este proyecto es **diseño propio**, no una réplica 1:1 de un Figma. Aplica la regla de
`CLAUDE.md`: los incumplimientos de WCAG **se corrigen**, no se documentan y replican.

El contraste se midió muestreando el fondo real de cada texto sobre el render a 200 DPI —no
por contención geométrica, que ignora el orden de pintado y los recortes. De 14 pares reales,
13 cumplen AA en la pieza original.

### Corregido

**`--gt-azul-medio`: `#1D71B8` → `#1C6FB4`.** Es el color de los títulos de cada bloque de la
agenda, sobre la tarjeta `#EDEDED`. El original da **4.37:1**: pasa como texto grande (en la
pieza va a 20 pt en negrita) pero **falla como texto normal**, que es como se usará en web.
Oscurecido al 98% de su luminosidad llega a **4.50:1** y cumple a cualquier tamaño. El cambio
es imperceptible al lado del original.

### Evitado por composición

`#8AD0E5` sobre blanco da **1.72:1** — es el «en Acción» del título en `invitación expertos`.
No se replica: en las otras dos piezas ese mismo texto va sobre navy y da **7.22:1**. El
sistema usa siempre la variante sobre navy, así que el problema desaparece sin tocar el color.

### Reglas permanentes

- Todo texto sobre `--gt-celeste` debe ir en `--gt-navy` o `--gt-tinta` (7.22:1 y 9.84:1).
  Blanco sobre celeste da **1.71:1** y no es utilizable.
- Ningún texto va encima de una foto sin una capa de oscurecimiento: sobre imagen no hay ratio
  garantizable. En la banda de cita el velo es un degradado sobre un plano opaco.
- El anillo de foco es uno solo (`--gt-foco`) y cada contexto lo redefine: celeste sobre el campo
  oscuro, `--gt-azul-medio` dentro de `.gt-lamina`.

### Lo que verifica `scripts/a11y-test.mjs`

Sobre el render real de `dist/`, no sobre el código: contraste de **todo** texto visible,
jerarquía de encabezados, `alt`, nombres accesibles, anillo de foco, `prefers-reduced-motion` y
**reflow a 320 y 390 px** (WCAG 1.4.10: ninguna pieza puede obligar a desplazar la página en
horizontal).

Dos cosas del auditor que costaron y conviene no revertir:

1. **El color se resuelve pintándolo en un lienzo de 1×1**, no parseando la cadena. Desde que los
   tokens derivan con `color-mix()`, `getComputedStyle` devuelve `oklab(...)`, que el parser
   antiguo daba por transparente: asumía fondo blanco y reportaba contrastes falsos de 1:1.
2. **Los fondos semitransparentes se componen** con los de sus ancestros hasta el primero opaco,
   en vez de ignorarse. Es el color que de verdad hay detrás del texto.

---

## Assets

Generados con `scripts/build-assets.py` a partir de `design-extract/`.

| Archivo | Origen | Color |
|---|---|---|
| `public/img/hero-aerogeneradores.webp` | foto incrustada, 456×652 | ⚠ resolución baja para un hero |
| `public/img/hero-aerogeneradores@2x.webp` | Lanczos + enfoque, 912×1304 | solo para densidad 2, vía `srcset` |
| `public/img/torre-transmision.webp` | foto incrustada, 392×603 | |
| `public/img/torre-transmision@2x.webp` | Lanczos + enfoque, 784×1206 | solo para densidad 2, vía `srcset` |
| `public/img/fichas-conversacion.webp` | foto incrustada, 1190×610 | |
| `public/img/logo-gecelca.svg` | 16 paths vectoriales | marca fija (azul + verde) |
| `public/img/icono-burbujas.svg` | 14 paths | `currentColor` |
| `public/img/icono-calendario.svg` | 8 paths | `currentColor` |
| `public/img/icono-lugar.svg` | 2 paths | `currentColor` |
| `public/img/numeral-uno.svg` | contorno del glifo | `currentColor` |
| `public/img/wordmark-g-talks.svg` | contornos de 7 glifos | `currentColor` |

Todo el material gráfico se extrajo como **SVG real**, reconstruyendo los paths del PDF, y no
rasterizado a 600 DPI como preveía el plan. Con eso **queda cerrado el pendiente de pedir los
vectoriales a Comunicaciones**: los 160 KB de `public/img/` son casi todo fotografía.

Solo el logo Gecelca conserva sus colores: en las piezas aparece siempre igual. Los demás símbolos
van en `currentColor` porque el mismo símbolo aparece en navy, en blanco y en azul Gecelca según el
fondo.

### Los símbolos se pintan como máscara, no como `<img>`

Un SVG cargado con `<img src="icono.svg">` es un documento aparte: su `currentColor` **no** hereda
el `color` de la página, se resuelve a negro. Eso hacía que el numeral «1» saliera negro sobre la
banda navy —invisible— y que los íconos de las píldoras salieran negros en vez de navy.

La solución es `Icono.tsx`: el símbolo va como `mask-image` de un `<span>` cuyo `background-color`
es `currentColor`. Así hereda el color de verdad. Como una máscara no aporta tamaño intrínseco, el
ancho se deduce del alto con la proporción real del `viewBox`, que `build-assets.py` deja generada
en `src/design/iconos.ts`.

Al recortar un cluster del PDF, la banda de color que hay detrás se hornea en el recorte. Para los
logos se quita por clave de color, midiendo el plano del borde del propio recorte.

Pendientes de contenido en [`PENDIENTES-DE-CONTENIDO.md`](./PENDIENTES-DE-CONTENIDO.md).

---

## Cómo regenerar todo

```bash
python -m venv .venv-design
.venv-design/Scripts/pip install pymupdf pillow fonttools

.venv-design/Scripts/python scripts/extract-pdf-design.py   # mide → design-extract/
.venv-design/Scripts/python scripts/contact-sheet.py        # hoja de contactos
.venv-design/Scripts/python scripts/build-assets.py         # → public/img/
```

`design-extract/` y `.venv-design/` están en `.gitignore`: son trabajo intermedio y se
reconstruyen desde los PDF, que sí son la fuente de verdad versionada.

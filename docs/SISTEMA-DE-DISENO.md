# Sistema de diseño 1° Foro GECELCA «G-TALKS»

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
| `--gt-azul-medio` | `#1D71B8` → **`#1C6FB4`** | 3.98% | títulos de cada bloque de la agenda *ver Accesibilidad* |
| `--gt-navy-deep` | `#1D2A4C` | 2.21% | círculo tras el numeral «1» (solo en `invitacion gtalk`) |
| `--gt-azul-gecelca` | `#004A96` | 0.73% | logo Gecelca, wordmark G-TALKS, íconos |
| `--gt-celeste-tinte` | `#BCDEE9` | derivado | filas logísticas de la agenda |

### De la hoja impresa a la pantalla: los derivados

Las tres piezas son verticales de 612 pt sobre papel blanco, con el navy y el celeste como
bandas. Trasladado tal cual, eso da una página blanca con una franja azul arriba: correcta y
olvidable. La traducción a pantalla invierte la relación**el campo es oscuro y el papel es la
excepción**— y para eso hicieron falta cuatro valores más.

Ninguno es un color nuevo: **todos son mezclas declaradas de los medidos**, escritas con
`color-mix()` en `tokens.css`, así que la regla del proyecto se mantienecada valor o está
medido, o es una mezcla trazable de dos que sí lo están—.

| Token | Definición | Para qué |
|---|---|---|
| `--gt-noche` | `--gt-navy` 56% + negro | el campo de toda la página |
| `--gt-abisal` | `--gt-navy` 34% + negro | header desplazado y footer |
| `--gt-humo` | `--gt-blanco` 76% + `--gt-navy` | texto secundario sobre el campo (10:1) |
| `--gt-celeste-alto` | `--gt-celeste` 68% + blanco | hover y foco sobre el campo |

Sobre ese campo hay **dos superficies y nada más**: la lámina clara (`.gt-lamina`, el papel de la
pieza, donde vive el programa) y el plano navy (la caja destacada, los estados vacíos). La
separación entre elementos se hace con **hairlines de 1 px**, que es lo que hacen las piezas84
de sus 87 trazos son de 1 pt—, no con sombras. Hay **una sola sombra en todo el sitio**: la que
levanta la lámina del programa sobre el campo.

El grano (`--gt-grano`, ruido SVG en línea) va sobre los campos oscuros al 5%. Un plano digital
perfectamente liso delata la pantalla; el grano le devuelve la textura del impreso del que sale
todo esto, sin pedir un solo byte a la red.

### El elemento firma: la línea del día

`LineaDelDia.tsx` dibuja la jornada como una línea de tiempo **de una sola pista**: el ancho de
cada tramo es su duración realel almuerzo de 2 h 30 ocupa cinco veces lo que una ponencia de
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
`PhotoFrame`gris en `screen` sobre el navy, celeste en `multiply` encima— resuelve las dos cosas
a la vez: unifica la paleta y disimula la falta de detalle. La foto pasa a leerse como decisión
gráfica y no como un JPG pequeño estirado. Eso **no cierra el pendiente #4**: el original en alta
sigue haciendo falta.

### Retratos: el mismo razonamiento, bajado de intensidad… y luego apagado

Los retratos de los ponentes plantean el mismo problema que las fotos del PDFllegan de fuentes
distintas: fondo de estudio, fondo de oficina, recortes de una foto de grupo— y ese desorden es lo
que hace que una página de ponentes se vea improvisada. Pero teñir de celeste la cara de una
persona identificable es otra cosa, así que el duotono no se reutiliza tal cual: hay una tercera
variante, `tratamiento="retrato"`.

La diferencia técnica es el modo de fusión. El duotono compone la imagen en `screen` sobre el
navy, lo que sobre un rostro lo vacía. El retrato la pinta normal y superpone el navy en
**`mix-blend-mode: color`**, que toma tono y saturación del plano y **deja intacta la luminancia
de la foto**: la cara conserva su volumen y su modelado, y solo cambia de color. Encima, un realce
celeste en `screen` levanta las luces para que el retrato pertenezca a la misma paleta que todo lo
demás.

| Token | Valor hoy | Valor del tinte | Qué controla |
|---|---|---|---|
| `--gt-retrato-desat` | `0` | `0.82` | cuánto se desatura antes de teñir |
| `--gt-retrato-tinte` | `0` | `0.44` | opacidad del navy en `color` |
| `--gt-retrato-realce` | `0` | `0.07` | opacidad del celeste en `screen` |

Son **convención**, como las opacidades del grano y del duotono, y están declarados como tokens y
no repartidos por los componentes por un motivo concreto: eran un punto de partida razonado, no
medido, que había que **calibrar con las once fotos reales delante**. Así calibrar es tocar tres
líneas y no perseguir literales por tres archivos.

Esa calibración se hizo, y el resultado fue **quitar el tinte**: los retratos van hoy a **color
original**, con los tres tokens en `0`. Con las fotos reales delante, lo que sobre las fotos del
PDF es una decisión gráfica sobre un rostro identificable se lee como algo impuesto: la cara de un
ponente es un dato de la persona, no una superficie de la marca. El desorden de fondos que el
tinte venía a tapar se resolvió antes, en el encuadre y el recorte de `build-retratos.py`.

**La maquinaria se conserva entera** —el `filter`, el navy en `color` y el realce celeste siguen
declarados en `PhotoFrame.css` y `Monogram.css`, y el hover del monograma sigue expresado como una
fracción del token—, así que volver a unificar la paleta es devolverles valor a esas tres líneas y
nada más. Con los tres en `0`, las dos capas de fusión no pintan nada y el filtro se reduce a su
`contrast(1.04)`.

Los consumen dos componentes con markup distinto porque las cajas lo son: `PhotoFrame --retrato`
para el retrato grande del perfil (con su lienzo, su contorno desplazado y su `srcset`), y
`Monogram --foto` para la caja pequeña del índice, del programa y de la navegación, donde las dos
capas de fusión son los pseudoelementos del propio `<span>`.

Con `prefers-contrast: more` los tres bajan a 0: si alguien pide más contraste, una cara teñida es
exactamente lo contrario de lo que pidió. Hoy eso es redundante, porque el defecto ya es 0, y el
bloque de `base.css` se conserva a propósito: si el tinte vuelve, no puede volver también en alto
contraste sin que nadie lo note.

### La ficha de ponente: dos columnas que empiezan y terminan a la vez

El perfil es una rejilla de dos columnasel retrato y todo lo demás— y **el retrato se estira al
alto exacto de la columna de texto**, no al revés. Es la decisión que ordena la página: las dos
columnas comparten la línea de arriba y la de abajo, así que no queda ni media página vacía a la
derecha de la prosa ni una franja muerta bajo la foto.

Técnicamente son tres líneas: `align-self: stretch` en la figura, `height: 100%` y
`aspect-ratio: auto` en el lienzo. La proporción `4 / 5` que llega por props deja de mandar en
escritorio y vuelve a mandar por debajo de 52 rem, donde la rejilla se deshace y no hay una segunda
columna con la que igualarse. El recorte lo resuelve `object-fit: cover`, y como la cara va
centrada en el derivado vertical, aguanta bien las proporciones que salen de biografías de largos
muy distintos.

De ahí salen dos consecuencias que conviene no revertir:

**La placa.** Mientras no llegue la foto, el hueco no lo ocupa un monograma pequeño sino una placa
que mide lo mismo que el futuro retrato: misma columna, mismo alto, misma forma en «hoja» y el
mismo contorno desplazado, con las iniciales a tamaño de titular. Así el día que llegue la foto la
maqueta no se muevelo que hay es lo que habrá—, y mientras tanto la ficha no se lee como una
plantilla a la que le falta un trozo. Es el mismo criterio que convirtió el numeral «1» y el
wordmark en grafismo: a esa escala unas iniciales dejan de ser un avatar por defecto.

**El programa cambia de sitio según haya biografía o no.** Si la hay, la columna de texto ya está
llena y la tarjeta del programa va debajo, a ancho completo, que es donde mejor se lee una tabla de
horas. Si no la hay, la columna serían dos líneas: la tarjeta sube a ocuparla y la ficha entra casi
de una sola pantalla. Es la asimetría 6/5 de los datos resuelta en la maqueta en vez de disimulada
con un hueco. En el código el bloque se declara **una vez** y solo cambia de sitio.

Como esa tarjeta vive en dos anchos distintos, se mide a sí misma con una **container query** y no
con un media query: lo que decide si las horas caben en su propia columna es el ancho de la
tarjeta, no el del navegador. Es el mismo razonamiento que ya usaban los tramos de la línea del
día.

### Un solo retrato que atraviesa el cambio de página

El retrato es lo único del sitio que lleva `view-transition-name`: la caja pequeña del listado
crece hasta convertirse en el retrato del perfil en vez de disolverse con la página. El nombre lo
compone `transicionRetrato()` en `src/data/foro.ts`, junto a `anclaDe()`, porque lo declaran dos
componentes distintos y tienen que coincidir carácter a carácter.

Hay una condición que conviene no olvidar: **un `view-transition-name` debe ser único en el
documento**; si dos elementos visibles lo comparten, el navegador descarta la transición entera.
En la home la misma persona sale en el listado **y** dentro de la agenday en la agenda puede
salir dos veces, como ponente y como panelista—, así que el nombre lo declara solo `SpeakerCard`,
que aparece una vez por persona. `AgendaTimeline` no lo declara a propósito.

Se apaga entero con `prefers-reduced-motion: reduce`. No basta con no animar la raíz: un elemento
nombrado se lleva la animación por defecto del navegador aunque `::view-transition-*(root)` esté
dentro de un `no-preference`.

### Movimiento

Convención, no medición. Salidas exponenciales sin rebote (`--gt-ease`), porque el sistema es
institucional y no juguetón. Y una regla dura: **no hay revelados por scroll en el contenido**.
Una animación que esconde texto hasta que el navegador la dispara es una sección en blanco
esperando a fallaren una pestaña de fondo, en una captura de pantalla, en un renderizador sin
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

- `#006533` (verde) 0.028% del área. Solo existe dentro del trazo del logo Gecelca; nunca
  se usa como color de interfaz. Vive dentro de `logo-gecelca.svg` y no se expone como token.
- `#010101` un segundo negro tipográfico, presente solo en `invitación expertos`. Es
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
En vez de buscarles una sustituta geométrica aproximadaque es lo que contemplaba el plan—
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
| `--gt-fs-display` | `clamp(3.4rem, 10.5vw, 6rem)` | 150–157 pt | titular del hero acotado además por el ancho, ver «El lockup del foro» |
| `--gt-fs-h1` | `clamp(2.25rem, 5.4vw, 3.5rem)` | 39.1 / 40.9 / 51.8 pt | títulos de página |
| `--gt-fs-h2` | `clamp(1.7rem, 3.4vw, 2.35rem)` | 30.6 pt | «Agenda Académica» |
| `--gt-fs-h3` | `clamp(1.2rem, 2vw, 1.45rem)` | | títulos de bloque |
| `--gt-fs-lead` | `clamp(1.15rem, 1.9vw, 1.4rem)` | 27.7 / 27.8 pt | bajadas e intros |
| `--gt-fs-body` | `1.0625rem` | 20 pt | cuerpo |
| `--gt-fs-sm` | `0.9375rem` | 16 pt | nombres, cargos largos |
| `--gt-fs-xs` | `0.8125rem` | 14 / 15 pt | cargos, pies |
| `--gt-fs-micro` | `0.6875rem` | | etiquetas de dato: horas, roles, ejes |

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

### El lockup del foro: una pieza, no cuatro elementos

El bloque del heroel numeral «1», «Foro: / Energía / **en Acción**», la regla blanca y «Retos y
oportunidades»— es el lockup de la marca del evento, y en las piezas es **un solo dibujo**. Lo que
lo delata es la regla: no es un separador decorativo, es la **prolongación del serif inferior del
«1»** (Bely Display trae ese serif dentro del propio glifo), y las dos tienen exactamente el mismo
grosor y la misma cota. Compuesto como cuatro elementos apilados con márgenes del sistema, no se
parece: el serif queda suelto en el aire y la regla desaparece.

Por eso vive en su propio contenedor (`.gt-hero__lockup`) y **cada cota va en múltiplos del cuerpo
del titular**, no en tokens de espaciado. Medido con PyMuPDF sobre `invitacion gtalk 2026.pdf`,
tomando el cuerpo del titular (39.1 pt) como unidad:

| Qué | Medido | En múltiplos del cuerpo |
|---|---|---|
| Paso entre líneas | 35.53 pt | **0.909** |
| Tinta del «1» | 111.86 × 65.17 pt | **2.861 × 1.667** |
| Caja em del «1» | 150.15 pt | **3.840** (el `viewBox` del asset son 219.82 pt → `alto: 5.622em`) |
| Vértice del «1» | 3.60 pt a la izquierda del canto de la regla | **−0.092** (vuela sobre el margen) |
| Origen del texto | 67.98 pt a la derecha de ese canto | **1.738** |
| Regla | grosor 2.40 pt · 80.76 pt bajo la 1ª línea de base | **0.061** · **2.078** |
| Cuerpo de la bajada | 24.15 pt | **0.618** |
| Ancho del conjunto | 241.55 pt | **6.178** |

**Tres cosas se apartan del resto del sitio porque en la pieza se apartan:**

1. **El peso es 700, no `--gt-fw-black`.** El PDF compone `Urbanist-Bold`.
2. **El tracking es el natural de la fuente**, no `--gt-tracking-display`. Los avances del PDF solo
   llevan **kerning**: comparando el origen de cada glifo con su avance, las parejas sin par de
   kerning dan exactamente 0. El navegador aplica el mismo kerning por defecto, y los anchos
   renderizados salen a 0.004 del cuerpo de los medidos.
3. **El numeral va blanco pleno**, no tono sobre tono. Fue una decisión propia mientras el bloque
   no tenía regla; con la regla puesta deja de ser una opción, porque su base *es* la regla.

**Dos trampas de implementación que cuestan un rato:**

- **El `viewBox` de `numeral-uno.svg` es la caja em del glifo, no su tinta**: la tinta ocupa el
  50.9 % central y arranca al 29.5 % del alto. De ahí el `alto: 5.622em` del marcado y los dos
  desplazamientos negativos del CSS, que llevan ese 50.9 % a su sitio. El asset lo genera
  `build-assets.py` y no se toca a mano.
- **La regla va como caja (`::before` con `height`), no como `border-top`.** El grosor es 0.061 del
  cuerpo5.26 px con el titular a 86 px— y un borde fraccionario lo redondea el navegador a un
  entero, que deja un escalón visible justo donde la regla se junta con el serif del «1». Un `height`
  sí conserva el subpíxel.

**El conjunto no puede partirse**, así que su cuerpo es `min(--gt-fs-display, ancho / 6.2)`: en
pantalla estrecha manda el ancho disponible antes que la escala tipográfica. Con dos columnas el
ancho de referencia es el de la columna (`--gt-hero-columna`), no el de la ventana. Verificado de 320
a 2560 px: el conjunto mide 6.085 del cuerpo en todos, sin línea partida ni desborde.

**Y se comprueba, no se supone:** `scripts/lockup-compare.mjs` + `scripts/lockup-diff.py` rasterizan
la pieza a la misma densidad de píxel por em que la captura del navegador y comparan centroide, masa
y cantos de tinta de cada elemento. Hoy el desvío es de **≤ 8 milésimas del cuerpo** (medio píxel con
el titular a 86 px).

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
tiene que acotarlo al tamaño real de su caja136 px se comerían un monograma de 44 px—: cada
componente la construye a partir de `--gt-radio-foto`.

Los arcos que separan bandas son paths de 633×700 pt con radios de 144.7 y 163.8 pt arriba y
recto abajo: no son medias circunferencias. Medida la forma, un `border-radius` en porcentaje la
reproduce exacta y sin el problema del SVG estiradocon `preserveAspectRatio="none"` las curvas
se deforman al cambiar el ancho—, así que `ArcDivider` es un `div` y no un SVG. Se conserva el
nombre del componente.

La forma en «hoja» del marco de foto se reutiliza en todo lo que es una superficie del sistema:
el monograma de los ponentes, las iniciales de la agenda, la caja destacada, los paneles de los
estados vacíos y las dos tarjetas de `/encuestas`. Es lo que hace que piezas distintas se lean
como la misma familia.

Las tarjetas de encuestas son el único sitio donde la hoja va **espejada**: la segunda lleva los
radios en las esquinas contrarias, igual que el par de fotos de la home (una `izq`, otra `der`).
Con las dos iguales, un par de tarjetas gemelas se lee como una rejilla de relleno; espejadas se
miran, y en móvilapiladas— la alternancia sigue leyéndose como un par y no como una lista
larga.

---

## Accesibilidad

Este proyecto es **diseño propio**, no una réplica 1:1 de un Figma. Aplica la regla de
`CLAUDE.md`: los incumplimientos de WCAG **se corrigen**, no se documentan y replican.

El contraste se midió muestreando el fondo real de cada texto sobre el render a 200 DPIno
por contención geométrica, que ignora el orden de pintado y los recortes. De 14 pares reales,
13 cumplen AA en la pieza original.

### Corregido

**`--gt-azul-medio`: `#1D71B8` → `#1C6FB4`.** Es el color de los títulos de cada bloque de la
agenda, sobre la tarjeta `#EDEDED`. El original da **4.37:1**: pasa como texto grande (en la
pieza va a 20 pt en negrita) pero **falla como texto normal**, que es como se usará en web.
Oscurecido al 98% de su luminosidad llega a **4.50:1** y cumple a cualquier tamaño. El cambio
es imperceptible al lado del original.

### Evitado por composición

`#8AD0E5` sobre blanco da **1.72:1** es el «en Acción» del título en `invitación expertos`.
No se replica: en las otras dos piezas ese mismo texto va sobre navy y da **7.22:1**. El
sistema usa siempre la variante sobre navy, así que el problema desaparece sin tocar el color.

### Reglas permanentes

- Todo texto sobre `--gt-celeste` debe ir en `--gt-navy` o `--gt-tinta` (7.22:1 y 9.84:1).
  Blanco sobre celeste da **1.71:1** y no es utilizable.
- **Lo que es enlace, dato u hora va en `--gt-acento`, nunca en `--gt-celeste` a mano.** El celeste
  sobre blanco da 1.72:1, así que sobre lámina `--gt-acento` cambia a `--gt-azul-medio` (5.30:1
  sobre blanco) por cascada, igual que hace `--gt-foco`. Escribir el celeste literal en un chip o
  en un enlace es la forma de que el día que ese elemento acabe sobre papel el texto se vuelva
  ilegible sin que nadie lo note que es exactamente lo que iba a pasar al mudar las
  intervenciones del perfil a una lámina.
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
| `public/img/hero-matriz-energetica.webp` | `scripts/build-foto-hero.py` sobre `fotos-origen/`, 896×828 | duotono, como las de los PDF |
| `public/img/hero-matriz-energetica@2x.webp` | el original sin remuestrear, 1246×1152 | 1.39× el 1x, no 2× |
| `public/img/hero-aerogeneradores.webp` | foto incrustada, 456×652 | ya no se usa en la página, ver abajo |
| `public/img/hero-aerogeneradores@2x.webp` | Lanczos + enfoque, 912×1304 | ídem |
| `public/img/torre-transmision.webp` | foto incrustada, 392×603 | |
| `public/img/torre-transmision@2x.webp` | Lanczos + enfoque, 784×1206 | solo para densidad 2, vía `srcset` |
| `public/img/fichas-conversacion.webp` | foto incrustada, 1190×610 | |
| `public/img/logo-gecelca.svg` | 16 paths vectoriales | marca fija (azul + verde) |
| `public/img/icono-burbujas.svg` | 14 paths | `currentColor` |
| `public/img/icono-calendario.svg` | 8 paths | `currentColor` |
| `public/img/icono-lugar.svg` | 2 paths | `currentColor` |
| `public/img/numeral-uno.svg` | contorno del glifo · el `viewBox` es la **caja em**, no la tinta | `currentColor` |
| `public/img/wordmark-g-talks.svg` | contornos de 7 glifos | `currentColor` |
| `public/img/ponentes/<slug>*.webp` | `scripts/build-retratos.py` sobre `retratos-origen/` | retrato atenuado por CSS |

Los retratos son la única familia de assets que **no** sale de los PDF. Van en cuatro derivados por
persona4:5 a 440×550 y 880×1100 para la cabecera del perfil, 1:1 a 96 y 192 px para las filas—

**El cuadrado no es el vertical reducido, y esto se supo con la primera foto real.** Un retrato
corporativo es un plano medio: recortado solo a proporción, a 96 px la cara acaba midiendo veinte
píxeles y no se reconoce ni en el índice ni en el programa. Por eso el derivado cuadrado se acerca
—`ZOOM_CUADRADO = 0.70` del lado menor, centrado en el 34% del alto—, que en un plano medio deja
cabeza y hombros. El vertical va a zoom 1.0: ahí la foto se ve grande y conviene respetar el
encuadre del fotógrafo. Lo que el defecto no acierteuna foto descentrada, o un primer plano ya
cerrado al que el 70% le cortaría la barbilla— se corrige por persona en el diccionario `ENCUADRE`
del script, para que quede escrito en el repo y no en la memoria de quien procesó el lote.

y el script escribe además `src/design/retratos.ts`, un manifiesto tipado con lo que de verdad
produjo. Es el mismo patrón que `iconos.ts`, y tiene dos consecuencias buscadas: quien no tenga
foto no está en el mapa y cae al monograma, así que **es imposible servir un 404**; y un slug que
no exista en `PONENTES` es un error de tipos en `npm run build`.

`retratos-origen/` está en `.gitignore`: son originales a plena resolución de personas
identificables y este repo tiene remoto en GitHub. El derivado recortado sí se versiona.

### La foto del hero tampoco sale de los PDF

La segunda excepción, y por una razón medible. La foto que traen las piezas viene incrustada a
456×652, y el marco del hero llega hoy a **864×734** en una pantalla de 1920: servirla ahí es
ampliarla 1.9× a densidad 1, que es justo lo que el duotono disimulaba a duras penas. En su sitio va
`fotos-origen/hero-matriz-energetica.jpg` (1246×1152, paneles y aerogeneradores frente a una planta
térmica), que `scripts/build-foto-hero.py` deriva a los dos webp de la tabla. El original **sí se
versiona**: no es material sensible como los retratos y sin él esto no se vuelve a generar.

El «2x» es el original tal cual, 1.39× el 1x y no 2×, porque eso es todo lo que trae la foto. El
descriptor solo decide qué archivo baja el navegador, y bajo el duotono la diferencia no se ve.
Ampliar con Lanczos hasta 1792 pxlo que se hace con las fotos de los PDF, que no tienen otra
salida— aquí solo pesaría más sin añadir un detalle que no existe.

**El marco del hero no se mide por proporción.** Es el mismo criterio de la ficha de ponente: manda
el layout, no un `aspect-ratio` que llega por props.

- **El ancho es una resta.** La rejilla es `var(--gt-hero-columna) minmax(0, 1fr)`: la columna de
  texto mide exactamente lo que va a usarel mismo ancho al que ya está atado el cuerpo del
  lockup— y la foto se lleva todo lo demás. Antes eran dos anchos independientes (`1fr` para el
  texto y un `clamp` para la foto) y la primera columna crecía más allá de su `max-width`: ese
  sobrante quedaba como una franja vacía entre el titular y la foto que a 1920 pasaba de 340 px.
  Ahora desaparece por construcción y no por tanteo.
- **El alto es un mínimo, no una medida**: `min-height: clamp(28rem, 68vh, 46rem)` sobre el item,
  que va estirado (`align-self: stretch`). Así el alto real es **el mayor de dos cosas**: lo que
  mide la columna de texto o lo que cabe en la primera pantalla. Las dos columnas empiezan y
  terminan a la vez, igual que en la ficha de ponente: el titular arranca en la misma línea que el
  canto de la foto y la ficha cierra en la de su base, en **todos** los anchos. Con un alto propio
  la foto se descolgaba en cuanto el texto era más largo que ellaa 1280 arrancaba 52 px por
  debajo—, que es la banda muerta de antes en pequeño.
- **Los dos topes del `clamp` salen de una resta por cada extremo.** Por arriba, lo que queda de la
  ventana tras el header, el aire de encima y el arcopor eso entre 900 y 1080 px de alto el arco
  cierra justo en el pliegue—. Por abajo, el alto de la columna de texto: cuanto más se pasa la foto
  de ese alto, más sobrante hay que repartir dentro del texto. Con `72vh` y `46rem` ese sobrante
  llegaba a 109 px a 1080, un hueco perfectamente visible entre la entradilla y la ficha; con `68vh`
  no pasa de 50 px en ninguna ventana, y por debajo de 1000 px de alto manda el texto y no sobra
  nada. El sobrante, cuando lo hay, cae **entre la entradilla y la ficha** (`margin-bottom: auto` en
  la entradilla) y no como una banda en un canto.
- **La imagen va absoluta dentro del marco del hero**, y esto no es cosmético: un `height: 100%`
  contra un padre de alto indefinido se resuelve como `auto` al medir, así que la `<img>` en flujo
  imponía a la fila **el alto natural del archivo** (a 1920, 864 × 1152/1246 = 798 px) y ni el
  `min-height` ni el texto contaban para nada. Las otras tres capas del marco ya iban absolutas.
- **Por debajo de 64rem sí manda una proporción**, `1 / 1`, porque ahí la foto ya ocupa todo el
  ancho disponible y no hay nada que restar. Es cuadrada y no 4:5 por el original: 1.08 apaisado,
  así que cualquier recorte más alto se come por los lados el parque eólico o la chimenea, que son
  los dos extremos del plano.

**Y el hero ya no reserva sitio para el header.** Su `padding-top` era `clamp(7rem, 15vh, 10.5rem)`,
heredado de cuando el header era fijo y el contenido tenía que arrancar por debajo de él. Hoy es
`sticky`: ocupa sus 115 px en el flujo y el hero empieza justo debajo, así que esa reserva era aire
sobre aire162 px de banda muerta a 1080, entre el riel de anclas y el titular—. Queda
`clamp(1.75rem, 3.5vh, 3rem)`, que es solo la separación. Si el header vuelve a salirse del flujo,
se compensa allí y no aquí.

Todo el material gráfico se extrajo como **SVG real**, reconstruyendo los paths del PDF, y no
rasterizado a 600 DPI como preveía el plan. Con eso **queda cerrado el pendiente de pedir los
vectoriales a Comunicaciones**: los 160 KB de `public/img/` son casi todo fotografía.

Solo el logo Gecelca conserva sus colores: en las piezas aparece siempre igual. Los demás símbolos
van en `currentColor` porque el mismo símbolo aparece en navy, en blanco y en azul Gecelca según el
fondo.

### Los símbolos se pintan como máscara, no como `<img>`

Un SVG cargado con `<img src="icono.svg">` es un documento aparte: su `currentColor` **no** hereda
el `color` de la página, se resuelve a negro. Eso hacía que el numeral «1» saliera negro sobre la
banda navyinvisible— y que los íconos de las píldoras salieran negros en vez de navy.

La solución es `Icono.tsx`: el símbolo va como `mask-image` de un `<span>` cuyo `background-color`
es `currentColor`. Así hereda el color de verdad. Como una máscara no aporta tamaño intrínseco, el
ancho se deduce del alto con la proporción real del `viewBox`, que `build-assets.py` deja generada
en `src/design/iconos.ts`.

Al recortar un cluster del PDF, la banda de color que hay detrás se hornea en el recorte. Para los
logos se quita por clave de color, midiendo el plano del borde del propio recorte.

Pendientes de contenido en [`PENDIENTES-DE-CONTENIDO.md`](./PENDIENTES-DE-CONTENIDO.md).

---

## La escarapela

El carné de `/escarapela` (`src/components/Escarapela.tsx` + `.css`) es **réplica de
`Carnet-foro-1.jpg (1).jpeg`**, la pieza oficial que entregó Comunicaciones (raíz del repo).
Tiene el mismo estatus de fuente de verdad que los tres PDF: dentro del carné manda la pieza,
no el sistema.

> **Las entregas del carné no son acumulativas: manda la última.** Esta versión sustituye a
> `Escarapela.png`, que fue la fuente hasta el 30 de julio de 2026. No es un retoque: cambia la
> proporción, el troquel, el pie entero, la mitad de las tintas y los tres iconos. Lo que no
> cambia es el método, que se volvió a correr de cero sobre la pieza nueva.

### El arnés: medir, capturar, restar

Ninguna cota del carné se estima. Cuatro scripts lo cierran, y son el procedimiento a seguir
**siempre** que se toque `Escarapela.tsx` o `Escarapela.css`:

```bash
.venv-design/Scripts/python scripts/escarapela-medir.py   # mide la pieza
.venv-design/Scripts/python scripts/escarapela-iconos.py  # vectoriza sus 3 iconos sólidos
npm run build && npm run preview                          # en otra terminal
node scripts/escarapela-compare.mjs                       # captura el carné a 1024px
.venv-design/Scripts/python scripts/escarapela-diff.py    # pieza vs render, cota a cota
```

Todo cae en `design-extract/escarapela/` (ignorada por git): `carne.png` (la referencia),
`render.png` (la captura), `report.md` (las cotas de la pieza), `metricas.md` (los Δ),
`lado-a-lado.png` y `cajas.png`.

Lo que hace que funcione: **la pieza y el render se miden con el mismo código y a la misma
resolución** (`medir_elementos()` de `escarapela-medir.py`, que `escarapela-diff.py` importa).
Cualquier sesgo del método se cancela al restar, así que la tabla de `metricas.md` dice cuántos
px hay que mover cada cosa, y de ahí salen los `cqw` del CSS. Corregir → capturar → restar, hasta
que no queden Δ.

### Cuatro hallazgos que cambian todo lo demás

1. **La pieza va A SANGRE: el carné ES el lienzo.** 1080×1648 de borde a borde, sin margen ni
   sombra, y con las cuatro esquinas cuadradas. La proporción normalizada es **1024/1563** y el
   **radio de esquina es 0** el troquel redondeado del carné físico queda fuera del encuadre.
   La pieza anterior era justo lo contrario (un export de 1024×1536 donde el carné ocupaba
   931×1429, de ahí su 1024/1571 y sus 11.4px de radio), así que `rect_carne()` **comprueba** el
   sangrado en vez de darlo por hecho: si mañana llega un export con margen, se ve en el informe.
2. **Aquí el retrato SÍ es un círculo**: 509.1 × 508.8, iguales dentro de un píxel. Se dice
   porque en la pieza anterior no lo era (479×496, una elipse de verdad, con el radio siguiendo
   la elipse con menos de 1px de desviación). La diferencia estaba en el dibujo, no en la
   medición, y por eso se sigue midiendo el alto y el ancho por separado.
3. **La pieza usa SEIS tintas, no dos.** Es lo que destapó medir el color por **moda sobre el
   núcleo** de cada masa en vez de promediar una ventana: con cuotas del 99 % sobre superficies
   planas, son decisiones y no ruido de compresión. Promediar mentía justo donde importa el
   anillo del retrato «medía» `#0D1E42` siendo `#1C2C4E`, y el cargo «medía» `#303030` siendo
   negro puro—, porque sobre un trazo de 4px media ventana es antialias.
4. **El pie pasa a DOS RENGLONES apilados**, con su icono cada uno, en vez de una fila con
   separador. No es un cambio de estilo: cambia el DOM.

**De dónde sale cada valor:**

- **Colores: los de la pieza, y solo dentro del carné.** Ninguno coincide con los tokens del
  sistema, que salen de los PDF. `.gt-carne` los redefine **acotados a sí mismo**; repintar los
  globales cambiaría el sitio entero. Ojo: los derivados (`--gt-noche`, `--gt-humo`,
  `--gt-celeste-tinte`) se resuelven en `:root` y siguen calculados sobre los azules del sistema
  son colores de la página, no del carné. La única tinta ajena es el logo de Microsoft del botón
  de entrar (colores de marca fijos), como el logo Gecelca.

  | Tinta | Dónde | Token del carné |
  |---|---|---|
  | `#1C2C4E` | telón de la cabecera **y** anillo del retrato | `--gt-navy` |
  | `#1F2E55` | píldora, iconos del pie **y** texto del pie | `--gt-carne-navy-datos` |
  | `#73BFE1` | las dos bandas celestes **y** la regla bajo el nombre | `--gt-celeste` |
  | `#89D0E5` | «en Acción» (más claro que la banda) | `--gt-carne-celeste-claro` |
  | `#6FBFE0` | el grupo de personas de la píldora | `--gt-carne-celeste-icono` |
  | `#000000` | nombre y cargo negro puro, no navy | `--gt-carne-tinta` |

- **Geometría: todo en `cqw` sobre el carné normalizado.** 1cqw = 10.24px de un carné de 1024 de
  ancho; cada medida del CSS lleva al lado el px medido. El carné escala entero como una imagen
  sin breakpoints propios. El contenedor de la query es el marco, no el carné: la contención de
  `container-type` aplanaría el `preserve-3d` del volteo.
- **Casi nada va en flujo.** Cada elemento está anclado a su cota, como en la pieza. Encadenarlos
  por márgenes sumaba el error de uno al siguiente, y un nombre de dos líneas empujaba la píldora
  y el pie fuera del carné; ahora un texto que se desborde comprime su propia zona y no mueve
  nada más.
- **Los telones son SVG inline** (`preserveAspectRatio="none"`) porque un `border-radius` no puede
  dibujar una banda que se ensancha hacia un lado y porque las curvas de la pieza no son arcos
  de nada. Son **tres `d` medidos columna a columna** y ajustados por mínimos cuadrados a splines
  cúbicas de Hermite (que se convierten en Béziers exactas repartiendo los controles en tercios),
  con **menos de 1 px de error** sobre 1024. Los regenera `escarapela-medir.py` en `ondas.txt`:
  no se retocan a mano, se vuelven a medir. Los textos de la cabecera llevan además
  `background: --gt-navy` propio navy plano sobre navy plano, invisible para que el fondo real
  sea legible desde el DOM (el auditor de contraste compone los `background-color` de los
  ancestros, y el SVG no es ancestro de nadie). El numeral **no** lo lleva: un `Icono` se pinta con
  `background-color: currentColor` sobre una máscara, y un fondo propio lo borraría.
- **El peso de cada texto sale del GROSOR DE ASTA, no del ancho.** El ancho lo ajusta el tracking,
  así que no distingue un peso de otro; el asta sí. Medidas en la pieza y contrastadas con las de
  Urbanist por instancia (‰ de em: 300→54, 400→70, 500→84, 600→104, 700→122, 800→138):

  | Texto | Asta medida | Peso |
  |---|---|---|
  | «Foro: / Energía / en Acción» | 129 | bold (700) |
  | «Retos y oportunidades» | 89 | medium (500) |
  | Nombre | ~122 | bold (700), no black |
  | Cargo | 72 | regular (400) |
  | «ASISTENTE» | 133 | black (800) |
  | Rótulos del pie («Día:», «Lugar:») | 116 | bold (700) |
  | Valores del pie | 69 | regular (400) |

- **Cada cota vertical de texto se calcula, no se tantea.** Con Urbanist (asc 0.95em, desc 0.25em,
  versal 0.70em), la versal de la primera línea cae a `(altura_de_línea − 1.2·cuerpo)/2 +
  0.25·cuerpo` del canto superior de la caja; el `top` es la cota medida menos ese
  desplazamiento. **El cuerpo, en cambio, no se deduce de la versal**: dividir la banda medida
  por 0.70 da entre un 3 % y un 8 % de más, porque la caja de tinta de un texto con redondas
  incluye sus rebases. Se calibra con el Δ del propio bucle, que es lo único que compara
  rasterizado contra rasterizado.
- **Tipografía: Urbanist, y esta vez casi sin traquear.** La pieza anterior pedía entre −0.019em
  y −0.066em; esta, una vez el cuerpo está bien calibrado, se compone entre −0.016em y +0.004em.
  Buena parte de aquel «la pieza traquea negativo» era, en realidad, cuerpo de más.
- **Los tres iconos del pie y de la píldora se VECTORIZAN de la pieza.** Son sólidos, y no son los
  del catálogo: el de personas pasó de contorno a macizo, el alfiler ganó una peana elíptica y el
  calendario es otro dibujo. `scripts/escarapela-iconos.py` los traza sobre los píxeles (campo de
  cobertura por proyección sobre la recta fondo→tinta, ampliado ×4, marching squares a 0.5 y
  Douglas-Peucker a 0.3px) y escribe `public/img/carne-*.svg`. Viven en `iconos-extra.ts`, no en
  `iconos.ts`, porque **no salen de ningún PDF**; y su `viewBox` es su caja de tinta, sin aire, así
  que el `alto` del CSS es directamente el alto medido en la pieza.

**Cotas medidas** (px de un carné de 1024 de ancho; `report.md` las trae todas):

| Elemento | Caja | Elemento | Caja |
|---|---|---|---|
| Proporción / radio | 1024 × 1563 · radio 0 | Ranura | 392, 54 · 241 × 55 |
| Numeral «1» | 97, 123 · 83 × 179 | Regla del lockup | 102, 302 · 388 × 4 |
| «Foro: / Energía / en Acción» | 217, 123 · cuerpo 66, paso 58.5 | Bajada | 104, 316 · cuerpo 39.2 |
| Burbujas | 726, 123 · 160 × 108 | Wordmark | 702, 244 · 214 × 36 |
| Retrato (círculo) | centro 512, 724.1 · Ø 509 | Anillo / filete | trazo 4 · filete 18.5 |
| Nombre | versal 67 en y 1015 | Regla celeste | 139, 1118 · 747 × 4 |
| Cargo | versal 38 en y 1149 | Píldora | 81, 1236 · 863 × 133 |
| Icono / separador / rótulo | 142 · 279 · versal 40 en y 1287 | Pie, renglón 1 | 127, 1408 · 643 × 40 |
| Iconos del pie (ejes) | los dos en x 145 | Pie, renglón 2 | 130, 1451 · 350 × 44 |

**El pie es una REJILLA de dos columnas, no dos renglones sueltos.** Y hay dos cosas medidas
detrás de esa decisión:

- Los dos iconos tienen anchos distintos (calendario 36px, alfiler 30px) pero **comparten eje**
  (145px), y los dos rótulos **arrancan en la misma x** (196px). Con dos filas independientes y un
  `gap`, el rótulo del alfiler entraría 6px antes. La primera columna mide lo que el icono más
  ancho y centra su contenido, y con eso el eje sale solo.
- Los iconos **no están en el mismo ritmo que sus renglones**: las versales van a 1409 y 1457
  (48px de paso) pero los ejes de los iconos van a 1425.5 y 1468 (42.5). La pieza está compuesta a
  mano y el alfiler quedó 5px más arriba de donde lo dejaría la rejilla; se replica con un
  modificador, en vez de «arreglarse».

**La excepción documentada: el retrato es un círculo pelado, no la «hoja» de `Monogram`.** La regla
del sistema («la caja pequeña de una persona es `Monogram`») aplica fuera del carné. Dentro manda
la pieza y así se replica igual que el copy institucional se transcribe literal. Sin foto, el
círculo cae a las iniciales (`iniciales()` de `foro.ts`) sobre `--gt-celeste-tinte`. El anillo es
un **trazo fino de 4px** con un **filete blanco de 18.5px** hasta la foto.

**Criterio de cierre alcanzado** (30 de julio de 2026, sobre la pieza nueva):

| | Criterio | Resultado |
|---|---|---|
| Cotas | ≤3px sobre 1024 | **ninguna fuera**; casi todas en ±1 |
| Curva navy | p95 ≤2px | **1.64px** · 3 de 341 columnas fuera |
| Curva celeste superior | p95 ≤2px | **1.09px** · 1 de 341 |
| Curva celeste inferior | p95 ≤2px | **0.96px** · 0 de 264 |
| Tintas | idénticas | las 5 zonas muestreadas, exactas |

**Residuales aceptados** (lo que el diff sigue marcando y por qué no se persigue):

- **Rasterizado de la fuente.** La pieza es un JPEG: no hay igualdad bit a bit, y sus cantos
  llevan además el bloque 8×8 de la compresión. El diff muestra los textos **en contorno**, no
  rellenos, que es la señal de que están en su sitio. El porcentaje sube donde el trazo es fino
  (el cargo, en regular, marca un 8 % siendo puro contorno): con astas de 3px, medio píxel de
  desajuste enciende los dos cantos de cada asta.
- **«GWorking» reparte distinto por dentro.** Su caja cuadra al píxel, pero el corte entre letras
  cae 9px más allá que en la pieza. No es tracking (probado) ni kerning (probado: lo empeora), es
  que los avances de los glifos de la pieza no son exactamente los de Urbanist.
- **El interior de la foto**, recomprimida al recortarla de la pieza para el fixture.
- **El alfiler sale 2px más estrecho** a igual altura: su peana tiene el canto suave y el trazador
  la corta al 50 % de cobertura, mientras la medición de cotas la toma entera.
- **El texto real**: el pie dice «Miércoles 5 de agosto de 2026» y «G Working» (`evento.json`,
  transcripción literal de los PDF) y la pieza «… / 2026» y «GWorking».
  `escarapela-compare.mjs` los iguala en el DOM **solo para la captura del diff**, para que la
  comparación mida diseño y no datos. El rótulo de la píldora ya no hace falta igualarlo: esta
  pieza dice «ASISTENTE», que es justo lo que pinta la app.
- **La ranura** es un troquel: se pinta con `--gt-fondo` y enseña lo que hay detrás del carné. En
  la pieza eso es el blanco del export, así que el script de captura iguala ese fondo se compara
  la forma del agujero, no lo que se ve por él.

**El volteo** es un `rotateY(180deg)` con `transform-style: preserve-3d`, `--gt-dur-lenta` y
`--gt-ease`. Bajo `prefers-reduced-motion` los tokens de duración ya son 0ms: intercambio
instantáneo sin código extra. La cara no activa queda `visibility: hidden` con retardo de media
vuelta: fuera del árbol de accesibilidad, del foco y del auditor de contraste.

**El QR** del dorso lo genera `uqr` (devDependency, cero dependencias transitivas) y se pinta
como SVG en el DOM los módulos no son imagen, así que no tocan `img-src` de la CSP. El estilo
es réplica **medida** de **`Diseño de Código QR.png`** (raíz, pieza de referencia entregada con
la escarapela; 234 px, se midió sobre sus píxeles):

| Qué | Medido en la pieza | Implementado |
|---|---|---|
| Tinta | `#023F86` (con antialias de un PNG pequeño) | `--gt-azul-gecelca` `#004A96` el azul de marca ya medido; la diferencia es ruido de borde |
| Punto | ⌀ 0.62 del módulo (sesgado a la baja ~1 px por borde por el antialias) | ⌀ **0.72** del módulo mismo gesto de puntos separados |
| Marcadores | anillo y cuadrado interior redondeados | rects apilados rx 2.1 / 1.5 / 1.0 (respetando el 1:1:3:1:1 canónico: un anillo desigual ciega al decodificador) |
| Logo | «G» de Gecelca al 14.5 % del ancho (solo la ráfaga verde) ≈ 16 % el lockup completo | `public/img/marca-g.svg` al **16 %** del lado (extraída de `logo-gecelca.svg` con viewBox acotado bicolor de marca, va como `<image>`) |
| Claro del logo | ceñido, ~1 módulo más allá de la «G» | círculo de radio 10 % del lado (~3 % de oclusión) |

`ecc: 'Q'` (25 %) absorbe la oclusión del logo. El borde del encode es de **2 módulos**: la zona
de silencio normativa (4) la completa el padding blanco del panel, y con una URL de ~330
caracteres (QR versión 15) cada módulo de borde ahorrado agranda todos los puntos.

**La lectura se verifica, no se supone**: `scripts/qr-test.mjs` captura los píxeles reales del
panel y los decodifica con **ZXing** (`zxing-wasm`, devDependency la familia de lectores de los
teléfonos) a dos densidades de captura. jsQR no sirve de árbitro para este estilo: solo acepta
puntos tangentes, que no son el diseño de la pieza. La única diferencia con la muestra es la
densidad de módulos, que la impone la longitud de la URL de Power Apps, no el diseño.

**`icono-personas`** (la píldora) es el único icono que no sale de los PDF: solo existe en el
PNG raster, así que se dibujó a mano a juego con el trazo de `icono-burbujas` y vive en
`src/design/iconos-extra.ts` módulo hermano del generado `iconos.ts`, que sigue sin tocarse a
mano. `Icono.tsx` acepta la unión de ambos catálogos.

**La foto** se recorta y re-codifica en canvas (512px, JPEG 0.85 sin EXIF) y queda en
`localStorage` con clave por `oid`. Los tokens de duotono `--gt-retrato-*` **no** se le aplican:
la pieza trae la foto a color natural.

### La página que lo enmarca

El carné manda dentro de sus cuatro cantos, pero la página que lo rodea es del sistema, y su
maquetación **no** es la del resto de páginas interiores. `EscarapelaPage` es un díptico de tres
áreas —`discurso`, `pieza` y `acciones`— porque el carné mide 27.5 rem de ancho por ~670 px de
alto, y eso rompe el chasis de una columna de `.gt-pagina`:

- **Apilado, no cabía.** Con el título, la entradilla y el carné en columna, a 1920×1028 la pieza
  arrancaba en y=437 y se cortaba por abajo, mientras la mitad derecha de la pantalla quedaba
  vacía. En el díptico arranca en y=240 y cierra en 912, con su botón de volteo dentro de la
  primera pantalla.
- **La reserva de arriba era aire sobre aire.** `.gt-pagina` abre con `clamp(7rem, 14vh, 9.5rem)`,
  heredado de cuando el header era `position: fixed`. Hoy es `sticky` y ya ocupa su sitio en el
  flujo, así que esos 144 px eran banda muerta —el mismo defecto, y el mismo recorte, que ya se
  hizo en `.gt-hero` (ver §La foto del hero)—. Va acotado a `.gt-pagina--escarapela`: /ponentes y
  /encuestas abren con una lista, no con una pieza que quiera caber entera.
- **Las columnas arrancan a la vez (`align-items: start`), no centradas.** Centrarlas contra el
  alto del carné devolvía 340 px de hueco entre el título y el texto: la misma banda muerta,
  movida a la izquierda. Con `start`, el sobrante de la columna corta cae al final de la página.
- **La fila de acciones es `1fr`, no `auto`.** La pieza cruza las dos filas; con las dos
  automáticas, el reparto de su sobrante despegaba el botón del texto al que pertenece.
- **Los controles de foto van con el texto, no bajo el carné.** Debajo de la pieza caían justo en
  el canto de la ventana —el botón que hay que pulsar, medio cortado—. En la columna izquierda,
  «Iniciar sesión con Microsoft» y «Subir foto» ocupan el mismo sitio en los dos estados.
- **Por debajo de 64 rem** la misma plantilla da una columna y cambia el orden a discurso → pieza
  → acciones, para que el carné no quede detrás de sus propios controles.

El copy del cuerpo cambia con la sesión; el aviso del QR, no. «Inicia sesión con tu correo
corporativo» es una instrucción caducada para quien ya entró, pero el QR del dorso registra el
ingreso igual en los dos estados.

---

## Cómo regenerar todo

```bash
python -m venv .venv-design
.venv-design/Scripts/pip install pymupdf pillow fonttools

.venv-design/Scripts/python scripts/extract-pdf-design.py   # mide → design-extract/
.venv-design/Scripts/python scripts/contact-sheet.py        # hoja de contactos
.venv-design/Scripts/python scripts/build-assets.py         # → public/img/
.venv-design/Scripts/python scripts/escarapela-medir.py     # mide la pieza del carné → cotas y ondas
.venv-design/Scripts/python scripts/escarapela-iconos.py    # vectoriza sus 3 iconos sólidos
```

Y con `npm run preview` levantado, los dos bucles de medir-y-restar el de la escarapela y el del
lockup del hero:

```bash
node scripts/escarapela-compare.mjs                       # captura el carné a 1024px
.venv-design/Scripts/python scripts/escarapela-diff.py    # pieza vs render, cota a cota

node scripts/lockup-compare.mjs                           # el lockup de 320 a 1920 px
.venv-design/Scripts/python scripts/lockup-diff.py        # pieza vs render, tinta a tinta
```

`design-extract/` y `.venv-design/` están en `.gitignore`: son trabajo intermedio y se
reconstruyen desde los PDF y el PNG, que sí son la fuente de verdad versionada.

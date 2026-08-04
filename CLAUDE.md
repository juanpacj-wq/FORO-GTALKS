# EVENTO PUERTA DE ORO Foro GECELCA «G-TALKS»

> **Ojo con el contexto heredado**: esta carpeta está dentro del repo `COMUNICACIONES`, cuyo
> `CLAUDE.md` describe una app de perfiles digitales con QR (Express + SQLite + npm workspaces).
> **Nada de eso aplica aquí.** Este es un proyecto aparte, con **su propio repositorio git**
> (`origin` → `github.com/juanpacj-wq/FORO-GTALKS`) y su propio `package.json`. No hay base de
> datos, ni workspaces, ni migraciones. El CI del repo padre no cubre esta carpeta.

## Qué es

Carta de presentación digital del **1° Foro GECELCA «Energía en Acción Retos y oportunidades»**
(marca G-TALKS), miércoles 5 de agosto de 2026.

SPA de **React 19 + Vite + TypeScript**, **pública**: el contenido se navega sin autenticarse.
La sesión de **Microsoft Entra ID** (OIDC Authorization Code + PKCE, server-side en `server/`)
existe solo para la **escarapela**: `/escarapela` invita a entrar con un botón y, con sesión,
pinta el carné del asistente réplica de `Carnet-foro-1.jpg (1).jpeg` (pieza oficial, raíz) con nombre y
cargo de `/api/me`, foto local elegida por la persona (localStorage, nunca viaja al servidor) y
un dorso con volteo 3D y el QR de registro de asistencia hacia la Power App de capacitaciones.

**Estado actual: rediseño completo y escarapela entregada.** El plan de
[`docs/PLAN-REDISENO.md`](./docs/PLAN-REDISENO.md) se ejecutó entero: la réplica de
`foro2026.andeg.org` de la que partió el proyecto ya no existe. El sistema visual está medido sobre
las piezas y documentado en [`docs/SISTEMA-DE-DISENO.md`](./docs/SISTEMA-DE-DISENO.md) léelo
antes de tocar `src/design/` o de añadir cualquier valor de estilo; la escarapela tiene su propia
sección ahí. `/encuestas` (tres encuestas de Microsoft Forms: oportunidades y las preguntas
pendientes para panelistas enlazan directo, y la de satisfacción abre por reloj al cierre del
evento ver Convenciones) y `/escarapela`
cerraron los pendientes #6 y #5; quedan los pendientes de contenido de siempre (sede, fotos,
biografías).

## Fuente de verdad del diseño y del contenido

Los tres PDFs de la raíz son las piezas gráficas oficiales del evento:

| Archivo | Pieza |
|---|---|
| `invitacion gtalk 2026.pdf` | Invitación general (copy neutro) |
| `invitación expertos.pdf` | Invitación a ponentes externos |
| `2 Arte foro gtalk 2026.pdf` | Invitación interna (Presidencia) |

`PERFIL DE LOS PONENTES.docx` es la fuente de verdad del **contenido** de los ponentes: nombre,
cargo y trayectoria. Se transcribe **literal** a `src/data/foro.ts`, igual que el copy de los PDF.

**Va por entregas y las entregas NO son acumulativas: manda la última, y se re-transcribe entera.**
La tercera (`IMagenes ponentes/PERFIL DE LOS PONENTES (2).docx`) trae las diez biografías y
**reescribió siete** respecto de la anterior texto nuevo, no solo repartido distinto—, así que
parchear la diferencia habría dejado media página en la versión vieja. Como la carpeta del envío
está ignorada por git, el texto adoptado vive versionado en `scripts/perfiles-fuente.txt`, y es
contra esa copia contra la que se comprueba a diario; adoptar una entrega nueva es un acto
explícito (`bios-verificar.py --regenerar`) para que una entrega vieja que quede suelta no se
cuele sola. **Ya están las once biografías y los once retratos**: la última entrega llegó con el
mismo nombre de archivo y añadió la ficha que faltaba, la de Erick Wehdeking Arcieri.

Dos cosas que enseñó esa última entrega y que valen para la siguiente: el nombre del archivo **no**
avisa de que hay texto nuevo (lo avisa el arnés, comparando el `.docx` con la referencia), y el
encabezado de una ficha nueva puede no seguir el formato de las demás llegó como «11. Erick
Wehdeking Arcieri», numerado y sin cargo—, con lo que su biografía se pegaba a la de la persona
anterior sin que nada fallara. Por eso adoptar se hace **leyendo el diff ficha a ficha**, no a
ciegas. Cerrados los pendientes #2 y #9 de
[`docs/PENDIENTES-DE-CONTENIDO.md`](./docs/PENDIENTES-DE-CONTENIDO.md).

**Regla dura: ningún color, tamaño, radio ni tipografía se inventa ni se cita de memoria.** Todo
valor sale medido de los PDFs con `scripts/extract-pdf-design.py`.

El *cross-check* con PORTALES GECELCA ya se hizo, y **no coincide**: allí los azules son `#0046A0` /
`#002F6D` y aquí, medidos, son `#004A96` / `#1F335E`. La tipografía sí coincide (Urbanist). Manda
lo medido en estas piezas.

## Estructura

```
docs/SISTEMA-DE-DISENO.md    De dónde sale cada token. Empieza por aquí.
docs/PENDIENTES-DE-CONTENIDO.md
docs/PLAN-REDISENO.md        El plan, ya ejecutado. Histórico.
docs/DESPLIEGUE.md           Cómo llega un commit al servidor, y de dónde sale ese diseño.
src/data/foro.ts             Todo el contenido. La agenda alimenta también los perfiles.
src/data/qr-arte.ts          El dibujo del QR. UN archivo, DOS lectores: la
                             escarapela y el correo del envío masivo
src/design/                  tokens.css (medidos), fonts.css, base.css
                             iconos.ts y retratos.ts son GENERADOS: no editar a mano
                             iconos-extra.ts es MANUAL: lo que no tiene vector en los PDF
src/components/              Chasis y primitivas, cada una con su CSS al lado
                             LineaDelDia.tsx es el elemento firma: la jornada
                             como línea de tiempo de una sola pista, índice
                             de la agenda y resaltado cruzado con ella
src/pages/                   Las 5 páginas
src/data/evento.json         Los hechos del evento. UN archivo, DOS lectores:
                             foro.ts lo importa y server/correo/ lo lee
server/                      Identidad Entra ID + servido de dist/: app.js, auth/
server/correo/               El correo de inscripción del primer login.
                             Cuatro módulos, una responsabilidad cada uno:
                             libro (idempotencia), mailer (Graph), plantilla
                             (pura) e inscripcion.js (la política).
                             html-correo.js son las primitivas compartidas y
                             plantilla-envio-qr.js es la del envío masivo, que
                             el servidor NO carga
deploy/                      systemd, nginx, logrotate y deploy.sh (ver docs/DESPLIEGUE.md)
scripts/                     Extracción de diseño (Python) y verificación (Playwright)
public/img/                  Assets extraídos de los PDF, todo SVG salvo las fotos
public/fonts/                Urbanist autohospedada
fotos-origen/                Los originales que NO salen de los PDF ni son
                             retratos hoy solo la foto del hero—. Se versionan
*.pdf                        Piezas gráficas oficiales fuente de verdad
```

## Regenerar el diseño desde los PDFs

`design-extract/` y `.venv-design/` no se versionan; se reconstruyen:

```bash
python -m venv .venv-design
.venv-design/Scripts/pip install pymupdf pillow fonttools
.venv-design/Scripts/python scripts/extract-pdf-design.py   # mide → design-extract/report.md
.venv-design/Scripts/python scripts/build-assets.py         # → public/img/ + src/design/iconos.ts
.venv-design/Scripts/python scripts/upscale-photos.py       # → *@2x.webp para HiDPI
.venv-design/Scripts/python scripts/build-retratos.py       # retratos-origen/ → public/img/ponentes/
.venv-design/Scripts/python scripts/build-foto-hero.py      # fotos-origen/ → la foto del hero, 1x y 2x
.venv-design/Scripts/python scripts/escarapela-medir.py     # mide la pieza del carné → cotas, ondas y referencia
.venv-design/Scripts/python scripts/escarapela-iconos.py    # vectoriza los 3 iconos sólidos del carné
.venv-design/Scripts/python scripts/bios-verificar.py       # las bios de foro.ts siguen siendo la fuente
.venv-design/Scripts/python scripts/bios-verificar.py --regenerar   # adopta una entrega nueva del .docx
```

Dos familias de fotos **no** salen de los PDF:

- **Los retratos de los ponentes.** Se dejan en `retratos-origen/<slug>.jpg` (carpeta ignorada por
  git) y el script produce los cuatro derivados y reescribe `src/design/retratos.ts`. Quien no tenga
  foto no aparece en el manifiesto y cae al monograma de iniciales: **no hay forma de servir un
  404**, y un slug que no exista en `PONENTES` es un error de tipos en `npm run build`.
- **La foto del hero.** La de las piezas viene incrustada a 456×652 y el marco llega a 864×736 en
  una pantalla de 1920. En su lugar va `fotos-origen/hero-matriz-energetica.jpg` (1246×1152), que sí
  se versiona: no es material sensible y sin él no se puede regenerar. Detalle en
  `docs/SISTEMA-DE-DISENO.md` §La foto del hero.

## Comandos

```bash
npm ci            # el lockfile es el pin: no `npm install`
npm run dev       # Vite en :5173 el sitio es público, navega sin más
npm run dev:auth  # el server de identidad en :3000 solo para probar el login real
npm run build     # tsc --noEmit + vite build
npm run preview   # sirve dist/ sin identidad (verificación visual y scripts)
npm start         # sirve dist/ con la identidad; el entorno lo pone systemd
npm run start:local # igual, leyendo el .env del repo

node scripts/inscripcion-test.mjs      # el correo de inscripción: sale UNA vez y solo una.
                                       # No necesita servidor, red ni credenciales
node scripts/envio-qr-test.mjs         # el envío masivo del QR: que nadie reciba el código de
                                       # otro. Sin red ni credenciales; sí necesita navegador

# El envío único del QR a los invitados (estación, no servidor). Ver docs/PLAN-ENVIO-QR.md:
node --env-file=.env scripts/envio-qr-audiencia.mjs                    # congela el grupo de Entra
                                       # --grupo acepta el NOMBRE, no solo el Object ID
                                       # --mas-correo <dir>  añade a quien no esté en el grupo
node --env-file=.env scripts/envio-qr.mjs --audiencia .datos/audiencia-<fecha>-<grupo>.json
                                       # ENSAYO: genera y verifica los QR, no envía
node scripts/envio-qr-auditar.mjs .datos/audiencia-<…>.json
                                       # segunda opinión: decodifica los PNG del ensayo y cruza
                                       # nombre de archivo contra contenido
node --env-file=.env scripts/envio-qr.mjs --audiencia … --confirmar --maximo 4

# Con `npm run preview` levantado, en otra terminal:
node scripts/screenshot.mjs shots      # capturas de las 5 rutas + escarapela con sesión y dorso
node scripts/interactions-test.mjs     # anclas, scrollspy, nav móvil, rutas inválidas,
                                       # volteo del carné y ciclo de la foto
node scripts/a11y-test.mjs             # contraste, encabezados, alt, nombres accesibles,
                                       # y el carné por sus dos caras
node scripts/sesion-test.mjs           # menú de sesión y carné, simulando /api/me
node scripts/qr-test.mjs               # el QR estilizado se LEE (ZXing sobre píxeles reales)
node scripts/escarapela-compare.mjs    # captura el carné a 1024px; luego, para restar:
.venv-design/Scripts/python scripts/escarapela-diff.py   # pieza vs render, cota a cota
node scripts/lockup-compare.mjs        # el lockup del hero de 320 a 1920: que no parta ni
                                       # desborde, y captura el ancho de referencia
.venv-design/Scripts/python scripts/lockup-diff.py       # invitacion gtalk 2026.pdf vs render:
                                       # centroide, masa y cantos de tinta de cada elemento

# Con `npm run start:local` levantado:
node scripts/gate-test.mjs             # matriz pública: 200+CSP, 401 /api/me, CSRF, login OIDC

# Con `npm run dev:auth` + `npm run dev` levantados (necesita internet):
node scripts/login-test.mjs            # login real desde /escarapela hasta Microsoft

# Despliegue (nada de esto necesita servidor):
bash deploy/ensayo-local.sh            # paquete determinista + coreografía de swap/rollback
bash deploy/ensayo-local.sh --completo # además: compila desde el paquete, poda, y comprueba
                                       # que el server arranque podado con la identidad cerrada
bash deploy/deploy.sh --estado         # (ya con deploy/deploy.env) qué commit está desplegado
```

## Convenciones

- **Español de Colombia con tuteo** en todo microcopy nuevo de la UI. El copy institucional
  transcrito de los PDFs se respeta **literal**, aunque mezcle tuteo y ustedeo.
- **Accesibilidad: se corrige, no se documenta.** La regla de PORTALES GECELCA de replicar
  incumplimientos WCAG aplica solo a réplicas 1:1 de Figma. Aquí el diseño es propio y debe
  cumplir **WCAG 2.1 AA**.
- **No tocar el flujo OIDC** de `server/auth/` salvo que se pida. El sitio es público: no hay
  pantalla de login ni SSO silencioso (`prompt=none` no existe; todo login nace del botón de
  `/escarapela`), y los errores del callback aterrizan en `/escarapela?auth=<motivo>`, cuyo
  diccionario vive en `src/data/escarapela.ts`.
- **Seguridad: `docs/SEGURIDAD.md`** es el manual de guardia (qué es público y qué no,
  incidentes, rotación de secretos, registro de asistencia, ciclo anual y riesgos aceptados).
  Cualquier cambio en `server/` se verifica con `node scripts/gate-test.mjs`.
- **Se despliega un commit, nunca el árbol de trabajo.** `deploy/deploy.sh` empaqueta con
  `git archive`, así que lo no commiteado no viaja al servidor (el script lo advierte). El
  rollback es re-desplegar un SHA anterior, y la comprobación de salud verifica que el HTML
  salga **con su CSP** y que `/api/me` siga en **401** sin sesión la identidad cerrada es lo
  innegociable, no el 200. Manual completo y auditoría del origen del diseño: `docs/DESPLIEGUE.md`.
- **Todo el HTML sale por el fallback SPA de `server/app.js`** (por eso `express.static` va con
  `index: false`): es la única puerta donde vive la CSP. Los subrecursos rotos reciben 404 JSON,
  no HTML con 200 la distinción por `Sec-Fetch-*` sigue existiendo para eso.
- **La escarapela es la excepción documentada del retrato**: dentro del carné manda
  `Carnet-foro-1.jpg (1).jpeg` (un CÍRCULO con anillo fino), no `Monogram`. La foto del carné va
  en localStorage por `oid` y NUNCA al servidor; el QR se pinta como SVG en el DOM (nada de
  `<img>` ni de tocar la CSP).
- **La pieza del carné va por entregas, y NO son acumulativas: manda la última.** Hoy es
  `Carnet-foro-1.jpg (1).jpeg`; `Escarapela.png` lo fue hasta el 30 de julio de 2026 y ya no
  manda en nada. Adoptar una entrega nueva es volver a correr el bucle entero, no parchear la
  diferencia: entre esas dos cambiaron la proporción, el troquel, el pie completo, la mitad de
  las tintas y los tres iconos.
- **Ninguna cota del carné se estima: se mide y se resta.** Tocar `Escarapela.tsx`/`.css` sin
  cerrar el bucle `escarapela-medir.py` → `escarapela-compare.mjs` → `escarapela-diff.py` es
  volver a las aproximaciones «a ojo» que costaron la primera versión. Cuatro cosas que no son
  obvias y que ese arnés descubrió en la pieza vigente: va **a sangre** (el carné ES el lienzo de
  1080×1648, proporción **1024/1563** y radio de esquina **0**, al revés que la anterior); usa
  **seis tintas** y no dos ninguna es un token del sistema, y `.gt-carne` las redefine acotadas
  a sí mismo—; el **peso** de cada texto sale del grosor de asta y no del ancho, que lo decide el
  tracking; y el **cuerpo** no se deduce dividiendo la versal por 0.70 (sale hasta un 8 % de más),
  se calibra con el Δ del propio bucle. Todo en `docs/SISTEMA-DE-DISENO.md` §La escarapela.
- **Los tres iconos sólidos del carné se VECTORIZAN de la pieza**, no se dibujan a ojo:
  `scripts/escarapela-iconos.py` → `public/img/carne-*.svg`, declarados en `iconos-extra.ts`
  porque no salen de ningún PDF. `iconos.ts` sigue siendo generado y no se toca a mano.
- **El lockup del hero es una pieza, no cuatro elementos apilados.** El numeral «1», las tres
  líneas, la regla blanca y «Retos y oportunidades» están compuestos como un solo dibujo en
  `invitacion gtalk 2026.pdf`, y lo que lo delata es la regla: **es la prolongación del serif
  inferior del «1»**, con su mismo grosor y su misma cota. Todas sus cotas van en múltiplos del
  cuerpo del titularmedidas, en `src/pages/InicioPage.css` §Titular— y tres valores se apartan
  del sistema a propósito: peso 700 (no el black), tracking natural (no `--gt-tracking-display`) y
  el numeral en blanco pleno (no tono sobre tono). Tocarlo sin cerrar el bucle
  `lockup-compare.mjs` → `lockup-diff.py` es volver a componerlo a ojo. Detalle que no es obvio:
  el `viewBox` de `numeral-uno.svg` es la **caja em** del glifo, no su tinta, que ocupa el 50.9 %
  central. Todo en `docs/SISTEMA-DE-DISENO.md` §El lockup del foro.
- **La foto del hero no lleva `ratio`: la miden el layout y la ventana.** El ancho es una resta
  (la rejilla es `var(--gt-hero-columna) minmax(0, 1fr)`, así que la columna de texto mide lo que
  va a usar y la foto se lleva el resto) y el alto es un **mínimo** sobre un item estirado
  (`min-height: clamp(28rem, 68vh, 46rem)` + `align-self: stretch`), así que las dos columnas
  empiezan y terminan a la vez. Tres cosas que no son obvias y que costaron: volver a una
  proporción fija es volver a la franja vacía entre titular y foto que a 1920 pasaba de 340 px;
  la `<img>` tiene que ir **absoluta** o su alto natural le gana a todo lo anterior al medir la
  fila; y el `padding-top` del hero es solo aire, **no** reserva para el header, que es `sticky`
  y ya ocupa su sitio en el flujo. Por debajo de 64rem sí manda una proporción, `1 / 1`, acorde
  con el original apaisado. Todo en `docs/SISTEMA-DE-DISENO.md` §La foto del hero.
- **Los símbolos monocromos van con `Icono.tsx`, no con `<img>`.** Un SVG cargado por `img` no
  hereda `currentColor`: se pinta de negro. `Icono` lo resuelve con `mask-image`.
- **La caja pequeña de una persona es `Monogram`, siempre** (única excepción: el carné de la
  escarapela, que replica la pieza oficial ver más abajo). Sirve el retrato cuando existe y las
  iniciales cuando no, en la misma forma en «hoja». La agenda la reimplementaba por su cuenta y
  eso significaba que las fotos habrían llegado al índice y al perfil pero no al programa.
- **Lo que es enlace, dato u hora va en `--gt-acento`, no en `--gt-celeste` a mano.** El celeste
  sobre blanco da 1.72:1; `--gt-acento` cambia solo a `--gt-azul-medio` dentro de `.gt-lamina`.
- **Un enlace que sale del sitio se marca con el botón `--externo`**la flecha del sistema girada
  45°, no un glifo nuevo— y va siempre con `target="_blank"` y `rel="noopener noreferrer"`: sin
  `noopener`, la pestaña de destino puede reescribir la de origen, y esta va con sesión
  corporativa. Lo comprueba `scripts/interactions-test.mjs`. Los dos de `/encuestas` llevaron un
  rato una línea debajo que nombraba el dominio de destino; **se quitó por petición del usuario**,
  así que la flecha es hoy la única señal. Si vuelve a hacer falta, que se derive del `href` y no
  se escriba a mano, para que no pueda quedarse mintiendo cuando cambie un formulario.
- **Un `view-transition-name` tiene que ser único en el documento.** Lo lleva solo el retrato de
  `SpeakerCard`una vez por persona— y nunca el de la agenda, donde la misma persona puede salir
  dos veces; si se repite, el navegador descarta la transición entera. Ver `transicionRetrato()`.
- **El campo es oscuro y el papel es la excepción.** Todo vive sobre `--gt-noche`; las
  superficies claras se marcan con `.gt-lamina`, que además invierte el color de foco y de los
  hairlines. Nada de fondos claros sueltos.
- **Nada de revelados por scroll en el contenido.** Una animación que esconde texto hasta que el
  navegador la dispara es una sección en blanco esperando a fallar (pestaña de fondo, captura,
  renderizador sin soporte). Solo se anima por scroll lo que no oculta nada.
- **Toda biografía tiene entradilla, y por eso los párrafos son los de la PÁGINA.** El primero se
  compone como entradilla (`p:first-child:not(:only-child)`), así que una ficha que llegue en un
  bloque único se lee plana al lado de las demás eso fue una discrepancia real, con seis fichas
  de diez sin entradilla—. Cuando pasa, se parte en `foro.ts` **por un punto y seguido de la
  fuente**, donde deja de presentar a la persona y empieza a contar su trayectoria. Partir es
  composición, no copy: un espacio pasa a ser un salto de párrafo y no cambia ni una letra. Hoy
  lo necesitan tres fichas; las otras ocho llegan repartidas. Dos arneses lo sostienen y hay
  que correr los dos tras tocar cualquier `bio`:
  `.venv-design/Scripts/python scripts/bios-verificar.py` exige
  `bio.join(' ') === los párrafos de la fuente` y falla si alguna se queda en un párrafo, y
  `node scripts/interactions-test.mjs` abre los once perfiles y comprueba en el navegador, sobre
  el tamaño calculado, que el primer párrafo destaque sobre el segundo.
- **El correo de inscripción sale UNA vez, y la prueba de que es así es el libro.** En el primer
  inicio de sesión de cada persona, `server/correo/` manda una confirmación; los siguientes no
  vuelven a escribirle. Tres cosas que no son obvias y que no se pueden tocar sin romper la
  garantía: la clave es el **`oid`** (un UPN cambia y partiría el histórico en dos); `reservar()`
  es **síncrona** a propósito, porque ahí es donde se cierra la carrera de dos pestañas entrando a
  la vez, y un `await` en medio abre ese hueco; y el libro es **estado, no un log**, así que vive
  en `/var/lib/gtalks/` y **logrotate no lo toca jamás** con `copytruncate`, el siguiente
  reinicio le escribiría otra vez a todo el mundo—. Lo comprueba
  `node scripts/inscripcion-test.mjs` contra un Graph falso, y hay que correrlo tras tocar
  cualquier cosa de `server/correo/`. Manual completo: `docs/SEGURIDAD.md` §Correo de inscripción.
- **El cuerpo del correo ES la pieza `imagen correo.png` (raíz), otra entrega no acumulativa.**
  Va incrustada **en línea** por `cid:` —nunca como imagen remota: Outlook las bloquea y serían
  rastreo— y envuelta entera en el enlace a `PUBLIC_ORIGIN + /escarapela`, con un enlace textual
  de respaldo debajo. La lee `cargarImagenCorreo()` **al arrancar**, no al enviar: si falta, no es
  un PNG o no cabe en los ~4 MB de `sendMail`, el envío queda apagado desde el arranque con aviso
  ruidoso. Tiene que estar **commiteada** (el despliegue empaqueta con `git archive`) y adoptar
  una entrega nueva es reemplazar el archivo y volver a correr `inscripcion-test.mjs`, que exige
  que los bytes del adjunto sean exactamente los de la pieza.
- **El destinatario no se comprueba una vez, sino tres, y el destino sale de la CONFIGURACIÓN.**
  `destinoAutorizado()` no devuelve un booleano: devuelve **la entrada de
  `INSCRIPCION_DESTINATARIOS`** con la que coincidió, y es esa cadena la que se envía. Así ninguna
  normalización, codificación ni homógrafo puede producir una dirección distinta, porque la
  dirección no se construye a partir de la entrada. Se comprueba al **reservar** y otra vez al
  **enviar** —entre las dos hay un redirect y un llamador externo, así que con una sola la garantía
  sería una convención entre funciones— y `graph-mailer.js` se niega por su cuenta a enviar a algo
  que no sea **una** dirección. No hay `cc` ni `bcc` en el código, y no debe haberlos.
  `inscripcion-test.mjs` lo ejerce contra 32 identidades hostiles y exige que el conjunto de
  direcciones que reciben sea exactamente el de la lista. **El ensayo escribe en un libro con
  sufijo `.simulacro`**: sin eso, ensayar con tu cuenta te dejaría anotado y no recibirías el
  correo real.
- **El dibujo del QR vive en `src/data/qr-arte.ts` y tiene DOS lectores.** La escarapela lo pinta
  como nodos SVG y `scripts/envio-qr.mjs` lo rasteriza a PNG para el correo; copiar el bucle habría
  garantizado que dentro de un mes los dos se PAREZCAN sin ser iguales. Que sean el mismo dibujo no
  es una convención: `qr-test.mjs` compara el `d` del navegador con el que produce Node **carácter
  a carácter** (167 568 hoy) y comprueba que la tinta del carné es la constante que viaja al
  correo. El módulo no puede tocar el DOM (lo carga Node) ni el disco (lo empaqueta Vite): por eso
  `svgQrAutonomo` recibe la marca «G» por parámetro. Y una cota que no es cosmética: **el panel
  mide un número ENTERO de módulos**, porque a 810 px sobre 89.1 módulos salían 9.09 píxeles por
  módulo y **ZXing dejaba de leer el código** medido, no supuesto—.
- **El envío masivo del QR sale UNA vez, y el cruce se aborta, no se anota.** `scripts/envio-qr.mjs`
  le manda a cada invitado su código personal con el ID de la **mañana**. Cinco defensas de
  construcción impiden el único fallo sin arreglo posible que a alguien le llegue el código de
  otro—, y la última es que el script **decodifica con ZXing el PNG que acaba de generar** y, si no
  dice la URL de esa persona, **aborta el proceso entero**. La audiencia se congela en un archivo
  revisable y el envío no consulta Graph. Detalle en `docs/SEGURIDAD.md` §Envío único del QR.
- **Un envío masivo lanzado con el `.env` a secas enlaza a `localhost`.** El correo apunta a
  `PUBLIC_ORIGIN + /escarapela`, y el `.env` de la estación dice `http://localhost:5173` — que ahí
  es lo correcto, porque el arranque lo valida contra `M365_REDIRECT_URI` y sin él no hay login
  local. No lo delata nada: ni el asunto, ni la pieza, ni el QR. Se descubrió minutos antes de la
  corrida real del 2026-08-04, con **ocho correos de prueba ya enviados con enlaces a localhost**.
  Ahora `envio-qr.mjs` **aborta** si `--confirmar` va con un origen que no sea `https://`, y la
  forma de dárselo es en la línea de comando —tiene precedencia sobre `--env-file`—:
  `PUBLIC_ORIGIN=https://cdp.gecelca.com.co node --env-file=.env scripts/envio-qr.mjs …`.
  El dominio es **`cdp.gecelca.com.co`**; `deploy/deploy.env` todavía dice `gtalks.gecelca.com.co`,
  que ni resuelve. Y al comprobarlo con `curl`, `/` da **404** sin cabeceras `Sec-Fetch-*`: es el
  diseño, no un fallo.
- **La pieza de ese correo es `imagen correo qr.png`, NO la de inscripción.** Reemplazar
  `imagen correo.png` cambiaría retroactivamente un correo que ya salió, y `inscripcion-test.mjs`
  seguiría en verde porque compara contra el archivo y no contra los bytes históricos. Mientras el
  arte definitivo no llegue, el script cae a la de inscripción y lo **dice** en cada corrida.
- **El envío no añade superficie HTTP, y así se queda.** No hay ruta para dispararlo, reenviarlo ni
  consultarlo un botón de «reenviar» sería un generador de correo a discreción del cliente—; lo
  único que cambió es un campo dentro de `/api/me`, y `gate-test.mjs` verifica que sigue siendo
  así. La interfaz **solo anuncia lo que el servidor confirma**: `pendiente` y `no_aplica` no
  pintan nada, porque nunca se anuncia un correo que quizá no salió.
- **La encuesta de satisfacción abre por reloj, y el reloj es el del SERVIDOR.** No recibe
  respuestas antes de que el foro termine, así que su URL **no está en el bundle**: vive en
  `server/encuestas.js` y `GET /api/encuestas` (público, solo lectura, `no-store`) la entrega
  cuando pasó `fecha.cierreIso` de `src/data/evento.json` la hora lleva su desfase `-05:00`
  explícito, y sin él el arranque aborta—. El cliente (`src/data/encuestas.ts`) **falla cerrado**:
  sin confirmación del servidor pinta el botón `aria-disabled` con su aviso, y programa el volteo
  restando dos relojes del servidor (`desde − ahora`), nunca con el local. Tocar cualquiera de las
  dos puntas se verifica con `gate-test.mjs` (frontera exacta con reloj inyectado, URL ausente en
  la respuesta cerrada, `POST` 404) e `interactions-test.mjs` (los dos estados del botón y el
  volteo sin recargar). Manual: `docs/SEGURIDAD.md` §La encuesta de satisfacción abre por reloj.
- **La regla que separa una encuesta abierta de una que abre por reloj es tener `url` o no.** Las
  que la traen en `ENCUESTAS` (`foro.ts`) se pintan como enlace y viajan en el bundle; la que **no**
  la trae es la que retiene el servidor. Hoy son tres —oportunidades, preguntas pendientes para
  panelistas, y satisfacción— y **la de satisfacción va SIEMPRE la última**, porque
  `interactions-test.mjs` la localiza con `:last-child`. Añadir una en medio obliga a mirar ese
  arnés: cuando llegó la segunda abierta, la de satisfacción pasó de ser la 2.ª a la 3.ª y los
  selectores por posición se quedaron apuntando a la tarjeta equivocada. Y el texto del botón tiene
  que empezar distinto que el de las demás: quien navega con lector de pantalla recorre la página
  saltando de enlace en enlace y solo oye su nombre.
- **La jornada se anuncia partida en mañana y tarde, y el corte sale de la agenda.** La ficha del
  hero dice «8:30 a.m. – 12:00 p.m.» y «2:30 p.m. – 4:30 p.m.» en dos líneas: de extremo a extremo
  anunciaba ocho horas seguidas y se comía las dos y media de almuerzo libre. El corte es el
  **bloque logístico más largo del día** (`TRAMOS` en `foro.ts`), no una hora escrita a mano, así
  que si el almuerzo se mueve los dos tramos se mueven con él; sin descanso largo queda un solo
  tramo, que es lo correcto. Los rangos no se parten (`.gt-ficha__valor--horas`): un «8:30 a.m. –»
  arriba y un «12:00 p.m.» abajo se leen como dos horas sueltas. El apunte de *Agenda Académica*
  sigue siendo el vano entero, que ahí es lo que se está midiendo.
- **La presidencia va sin línea de horas en el índice de ponentes.** Abrir y cerrar es protocolo,
  no programa, y «A cargo 9:00 a.m. y 4:10 p.m.» lo listaba como una intervención más;
  `SIN_RESUMEN` en `foro.ts` deja esa fila con nombre y cargo. Va **por slug y no por papel**
  —filtrar «a cargo» sería hoy lo mismo, pero mañana escondería sin avisar a quien herede el
  papel— y `resumenDe` devuelve `''`, así que quien la pinte tiene que contar con la cadena vacía
  y no envolverla a ciegas en su etiqueta. Lo fija `interactions-test.mjs` en dos mitades: diez
  filas con línea, y que la que falta sea exactamente esa.
- Los pendientes de contenido (sede real del evento, fotos de ponentes) se registran en
  `docs/PENDIENTES-DE-CONTENIDO.md`.

## Variables de entorno

En `.env` en la raíz de esta carpeta (ver `.env.example`): `M365_TENANT_ID`, `M365_CLIENT_ID`,
`M365_CLIENT_SECRET`, `M365_REDIRECT_URI`, `SESSION_SECRET`, `SERVER_PORT`.
En producción `SESSION_SECRET` es obligatorio y `NODE_ENV=production` fuerza cookie `Secure`.

El correo de inscripción añade `INSCRIPCION_MODO` (`off` · `simulacro` · `lista` · `todos`),
`INSCRIPCION_DESTINATARIOS`, `INSCRIPCION_REMITENTE`, `INSCRIPCION_LIBRO` y `MAIL_*`. **El defecto
es `off`**: sin configurar, la función no existe. Abrir el envío a todo el tenant exige cambiar
**dos** variables (el modo y vaciar la lista), para que ninguna errata de una sola pueda escribirle
a la empresa entera; una configuración a medias aborta el arranque en producción en vez de
encender el envío a medias.

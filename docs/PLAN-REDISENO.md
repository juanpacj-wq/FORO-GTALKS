# Rediseño: de réplica ANDEG a carta de presentación del 1° Foro GECELCA «G-TALKS»

## Contexto

`EVENTO PUERTA DE ORO/` hoy es una réplica 1:1 de `foro2026.andeg.org` un evento **ajeno**. El
markup es JSX generado desde Elementor (clases hasheadas, `data-elementor-*`), el estilo son 48
hojas de CSS de WordPress/Elementor y 103 imágenes de ANDEG (~8 MB), y `elementorRuntime.ts`
reimplementa a mano el JS de Elementor.

Lo que se necesita es otra cosa: la **carta de presentación digital del 1° Foro GECELCA
«Energía en Acción Retos y oportunidades»**, con diseño propio derivado de las tres piezas
gráficas que ya existen en la carpeta, y una navegación de 4 destinos donde los dos primeros se
llenan con el contenido de los PDFs y los dos últimos quedan como placeholders para que el usuario
los construya después.

El chasis que **sí** sirve y se conserva: Vite + React 19 + TS, el gate de Microsoft Entra ID
(`server/`), y los scripts de verificación con Playwright.

### Decisiones ya tomadas (no re-preguntar)

| Decisión | Elegido |
|---|---|
| Estructura del nav | 4 items. El primero es la ruta `/` con 3 anclas (`#bienvenida`, `#sobre-el-foro`, `#agenda`) |
| Voz del copy | **Mixto**: bienvenida con el texto neutro de `invitacion gtalk 2026.pdf`; «Sobre el foro» combinando el propósito de los otros dos PDFs |
| Alcance | **Corte limpio**: se borra todo `public/wp-content/` y el JSX de Elementor |
| Ponentes sin foto | **Avatar de monograma** (iniciales sobre azul de marca), componente listo para recibir foto después |

---

## Fase 0 Fuente de verdad: extraer el sistema de diseño de los PDFs

**Regla dura: ningún color, tamaño o radio se inventa ni se copia de memoria.** Todo valor sale
medido de los PDFs. (Existe memoria del proyecto hermano PORTALES GECELCA con azules `#0046A0` /
`#002F6D` y tipografía Urbanist sirve solo como *cross-check* al final, nunca como sustituto de
la medición: estas piezas son de la línea G-TALKS y pueden diferir.)

### 0.1 Herramienta

Python 3.13 ya está en PATH; no hay librería de PDF instalada. Instalar en un venv local:

```bash
python -m venv .venv-design && .venv-design/Scripts/pip install pymupdf pillow
```

`pdftoppm`, `pdfimages`, ImageMagick y Ghostscript **no** están disponibles no dependas de ellos.

### 0.2 Script `scripts/extract-pdf-design.py`

Corre sobre los 3 PDFs de la raíz y escribe en `design-extract/` (carpeta de trabajo, añadir a
`.gitignore`):

| Qué | Cómo | Salida |
|---|---|---|
| Render de referencia | `page.get_pixmap(dpi=200)` | `render/<pdf>-p<n>.png` |
| Tipografía | `page.get_text("dict")` → spans con `font`, `size`, `color`, `bbox` | `tokens.json → typography[]` |
| Colores de texto | entero `color` de cada span → hex | `tokens.json → colors.text[]` |
| Colores de forma | `page.get_drawings()` → `fill`, `color`, `width`, `rect` de cada path | `tokens.json → colors.shapes[]` |
| Fotos incrustadas | `page.get_images(full=True)` + `doc.extract_image(xref)` | `assets/<hash>.<ext>` a resolución nativa |
| Logos e íconos vectoriales | render con `clip=bbox` a 600 DPI | `assets/logo-*.png` |

Además genera `design-extract/report.md`: histograma de colores ordenado por área cubierta,
escalera tipográfica (tamaño → peso → dónde aparece) y el inventario de assets con sus
dimensiones.

### 0.3 Assets que deben salir de ahí

- Foto aerogeneradores + paneles solares (hero de `invitacion gtalk 2026.pdf` y `2 Arte…`)
- Foto torre de transmisión al atardecer (`invitación expertos.pdf`)
- Foto manos + fichas de madera de colores (`invitación expertos.pdf`)
- Logo **Gecelca** (preferir la versión sobre fondo blanco)
- Logo/badge **G-TALKS** con el ícono de burbujas de chat
- Íconos de calendario y pin de ubicación

Convertir las fotos a WebP con `pillow` (calidad 82) y dejarlas en `public/img/`. Nombres en
kebab-case descriptivo: `hero-aerogeneradores.webp`, `torre-transmision.webp`,
`fichas-conversacion.webp`, `logo-gecelca.png`, `logo-g-talks.png`.

### 0.4 Tipografía

El script reporta el nombre de la fuente incrustada. Política:

1. Si existe como webfont libre (Google Fonts), se usa esa.
2. Si es licenciada y no la tenemos, se elige la sustituta geométrica más cercana **y se deja
   registrada la decisión** en `docs/SISTEMA-DE-DISENO.md` con el nombre original.
3. Se autohospeda en `public/fonts/` (el sitio está detrás de un login corporativo; no conviene
   depender de `fonts.googleapis.com` como hace el `index.html` actual).

### 0.5 Sistema de diseño observado (a confirmar con las mediciones)

De la lectura visual de las tres piezas, el lenguaje es consistente:

- **Paleta**: azul marino profundo de fondo, azul medio, cian/celeste de acento para la segunda
  mitad de los títulos, tinte azul pálido para franjas y cajas destacadas, gris muy claro para la
  tarjeta de agenda, blanco.
- **Formas**: arcos/olas que separan bandas; marcos de foto con **radio asimétrico** (una esquina
  con radio grande, el resto pequeño); píldoras para fecha/lugar; tarjetas redondeadas.
- **Tipografía**: una sola familia sans geométrica. Títulos en peso alto, cuerpo en regular/light.
  Numeral «1» a tamaño display.
- **Patrón de agenda**: chip de dos horas apiladas (`inicio | fin`) con `a.m./p.m.` debajo,
  marcador triangular ▸, etiqueta de categoría en itálica gris (`Ponencia` / `Panel`), título en
  azul, y ponentes colgando de una regla vertical fina nombre en negrita, cargo en gris pequeño.
  Las filas logísticas (breaks, almuerzo) van sobre franja celeste, a ancho completo.

**Entregable de la fase**: `src/design/tokens.css` con custom properties, y
`docs/SISTEMA-DE-DISENO.md` documentando cada token con su origen (qué PDF, qué elemento).

---

## Fase 1 Demolición

Borrar por completo:

- `public/wp-content/` entero (48 CSS, 10 JS, 103 imágenes, ~8 MB)
- `src/pages/` completo las 4 páginas ANDEG y las 6 de conferencista
- `src/components/SiteHeader.tsx`, `SiteFooter.tsx`, `MobileMenuPopup.tsx`
- `src/lib/elementorRuntime.ts` y `src/types/swiper.d.ts`
- La dependencia `swiper` de `package.json`

Reescribir `index.html`: fuera los ~45 `<link>` de Elementor y las dos llamadas a Google Fonts;
`lang="es-CO"`; nuevo `<title>` y favicon. **Conservar el script inline que limpia el marcador
`?auth=`** lo necesita el callback OIDC del gate.

Actualizar `package.json`: `name` y `description` (hoy dicen `foro-andeg-2026-replica`).

---

## Fase 2 Datos: una sola fuente de verdad

`src/data/foro.ts` todo el contenido de los PDFs tipado. La agenda alimenta **a la vez** la
sección de agenda y los perfiles de ponente; nada se duplica.

```ts
export const EVENTO = {
  edicion: 1,
  nombre: 'Foro: Energía en Acción',
  bajada: 'Retos y oportunidades',
  marca: 'G-TALKS',
  fecha: { texto: 'Miércoles 5 de agosto de 2026', iso: '2026-08-05' },
  lugar: 'G Working',                       // ⚠ ver «Pendientes»
  organiza: 'Vicepresidencia de Asuntos Corporativos',
  contacto: { nombre: 'María Cristina Giraldo', telefono: '312 866 0424' },
  tagline: 'Juntos construimos conversaciones que impulsan la evolución del sector energético.',
}

type Ponente = { slug: string; nombre: string; cargo: string }
type Bloque =
  | { tipo: 'logistico'; inicio: string; fin: string; titulo: string }
  | { tipo: 'ponencia';  inicio: string; fin: string; titulo: string; ponente: string }
  | { tipo: 'panel';     inicio: string; fin: string; titulo: string; moderador: string; panelistas: string[] }
```

**11 ponentes** (derivados de la agenda, sin repetir):

| Slug | Nombre | Cargo |
|---|---|---|
| `erick-wehdeking-arcieri` | Erick Wehdeking Arcieri | Presidente de GECELCA |
| `jose-fernando-prada` | José Fernando Prada | Especialista y consultor senior en energía |
| `nicolas-rincon-diaz` | Nicolás Rincón Díaz | Gerente de Proyectos Consultoría y Medio Ambiente S.A. |
| `carlos-naranjo-merino` | Carlos Naranjo Merino | Consultor senior en sostenibilidad y cambio climático |
| `jorge-sierra-almanza` | Jorge Sierra Almanza | Gerente de Operaciones Enersinc |
| `karen-henriquez-leal` | Karen Henríquez Leal | Vicepresidente Financiero de GECELCA |
| `alfredo-chamat-barrios` | Alfredo Chamat Barrios | Vicepresidente de gas y energía Petromil |
| `carolina-palacio-garcerant` | Carolina Palacio Garcerant | Gerente de Regulación y Planeación Energética |
| `miguel-prieto-locarno` | Miguel Prieto Locarno | Gerente de Nuevos Negocios de GECELCA |
| `christian-moreno-rocha` | Christian Moreno Rocha | Docente y consultor en energías renovables |
| `angel-hernandez-montes` | Ángel Hernández Montes | Vicepresidente de Comercialización de GECELCA |

**12 bloques de agenda**:

| Horario | Tipo | Contenido |
|---|---|---|
| 8:30–9:00 a.m. | logístico | Registro 1° Foro GECELCA |
| 9:00–9:20 a.m. | apertura | Erick Wehdeking Arcieri |
| 9:20–10:00 a.m. | ponencia | Sector Energético Colombiano: Situación actual del mercado José Fernando Prada |
| 10:00–10:20 a.m. | logístico | Coffee Break |
| 10:20–10:50 a.m. | ponencia | Licenciamiento ambiental en Colombia Nicolás Rincón Díaz |
| 10:50–11:20 a.m. | ponencia | Carbono como estrategia Carlos Naranjo Merino |
| 11:20–12:00 p.m. | panel | **Seguridad Energética en Transición** · Mod. Karen Henríquez Leal · Panelistas: José Fernando Prada, Alfredo Chamat Barrios, Nicolás Rincón Díaz, Carolina Palacio Garcerant |
| 12:00–2:30 p.m. | logístico | Almuerzo Libre |
| 2:30–3:10 p.m. | ponencia | La tecnología como motor de Transformación Energética Jorge Sierra Almanza |
| 3:10–3:30 p.m. | logístico | Coffee Break |
| 3:30–4:10 p.m. | panel | **Futuro en acción** · Mod. Miguel Prieto Locarno · Panelistas: Christian Moreno Rocha, Jorge Sierra Almanza, Carlos Naranjo Merino, Ángel Hernández Montes |
| 4:10–4:30 p.m. | cierre | Cierre 1° Foro GECELCA Erick Wehdeking Arcieri |

**Copys** (transcritos literal de los PDFs; ver nota de idioma abajo):

- `BIENVENIDA` ← `invitacion gtalk 2026.pdf`: «Un espacio que reúne a líderes, expertos y actores
  clave del sector energético para conversar sobre los desafíos, oportunidades y tendencias que
  están definiendo la transformación energética.» + «Prepárate para compartir conocimiento,
  intercambiar experiencias y construir juntos una visión sostenible, innovadora y competitiva
  para el futuro.»
- `SOBRE_EL_FORO` ← combinación de los otros dos: el párrafo «En GECELCA creemos que las grandes
  transformaciones comienzan cuando el conocimiento se comparte…», el de «Un espacio de análisis y
  conversación…», el de «Más que un foro… Planeación Estratégica 2027-2031», y la caja destacada
  «Los invitamos a participar activamente…».

> **Idioma**: el copy institucional se transcribe **literal** de los PDFs aunque mezcle tuteo
> («Prepárate») y ustedeo («Los invitamos»). Todo microcopy **nuevo** que escribas para la UI
> (botones, estados vacíos, mensajes) va en es-CO con tuteo, sin voseo.

---

## Fase 3 Chasis nuevo

```
src/design/tokens.css       custom properties medidas en fase 0
src/design/base.css         reset propio + estilos de elemento
src/components/
  SiteHeader.tsx            nav 4 items, sticky, scrollspy en la ruta /
  MobileNav.tsx             panel deslizante (reemplaza el popup de Elementor)
  SiteFooter.tsx            banda navy: Gecelca + G-TALKS + organiza + contacto + tagline
  ArcDivider.tsx            los arcos/olas del sistema, como SVG parametrizado
  PhotoFrame.tsx            marco de foto con radio asimétrico
  Pill.tsx                  píldoras de fecha/lugar con ícono
  SectionTitle.tsx          título con reglas laterales («Agenda Académica»)
  AgendaTimeline.tsx        la lista completa de agenda
  SpeakerCard.tsx           monograma + nombre + cargo
  Monogram.tsx              iniciales sobre azul de marca, con prop `foto?` ya prevista
  Placeholder.tsx           bloque «en construcción» reutilizable
```

`Layout.tsx` se reescribe conservando su lógica útil (título por ruta, `scrollTo(0,0)`) y
soltando todo lo de WordPress: las clases `wp-*`/`elementor-*` del `<body>`, `applyCurrentMenuItem`,
`initElementorPage` y el interceptor global de clics (con `<Link>` de React Router deja de hacer
falta).

**Nav** (4 items, en este orden):

| Item | Ruta | Estado |
|---|---|---|
| Bienvenida | `/` → anclas `#bienvenida`, `#sobre-el-foro`, `#agenda` | contenido real |
| Ponentes | `/ponentes` → `/ponentes/:slug` | contenido real |
| Escarapela | `/escarapela` | **placeholder** |
| Encuestas | `/encuestas` | **placeholder** |

Scrollspy con `IntersectionObserver` para resaltar la sección activa dentro de `/`, y scroll suave
respetando `prefers-reduced-motion`.

---

## Fase 4 Páginas

**`InicioPage.tsx`** tres secciones:

1. `#bienvenida` hero: banda navy, numeral «1» display, «Foro: **Energía** en Acción» con el
   quiebre de color cian del PDF, bajada «Retos y oportunidades», badge G-TALKS, foto de
   aerogeneradores en `PhotoFrame`, píldoras de fecha y lugar, y el arco inferior.
2. `#sobre-el-foro` el propósito combinado, con la foto de la torre de transmisión y la caja
   destacada sobre tinte celeste.
3. `#agenda` `SectionTitle` + `AgendaTimeline` con los 12 bloques. Cada nombre de ponente enlaza
   a su perfil.

**`PonentesPage.tsx`** grilla de 11 `SpeakerCard` con monograma.

**`PonentePerfilPage.tsx`** ruta dinámica `/ponentes/:slug`; resuelve el ponente y **deriva sus
intervenciones recorriendo la agenda** (no hay una lista duplicada). Muestra monograma grande,
nombre, cargo, sus bloques, y navegación a otros ponentes. Slug inexistente → redirige a
`/ponentes`.

**`EscarapelaPage.tsx`** y **`EncuestasPage.tsx`** placeholders reales, no páginas vacías: hero
corto con el sistema de diseño aplicado, título, una línea de qué irá ahí, y un bloque
`Placeholder`. Dejar en cada archivo un comentario `// TODO(usuario):` describiendo el hueco.

> **Hook disponible para la escarapela**: `server/app.js` ya expone `GET /api/me` devolviendo
> `{ authenticated, user: { nombre_completo, upn, email, oid, roles } }` desde la sesión Entra.
> La escarapela personalizada puede construirse sobre eso sin backend nuevo. Se deja anotado en el
> placeholder, **sin implementarlo** es trabajo del usuario.

---

## Fase 5 Servidor y gate

Dos ajustes puntuales en `server/`, sin tocar el flujo OIDC:

1. `server/app.js` → `LOGIN_PUBLIC_ASSETS` apunta hoy a rutas de ANDEG
   (`/wp-content/uploads/2026/04/logo.png`, `fav-150x150.jpg`, `fav-300x300.jpg`). Cambiar a los
   assets nuevos que use la pantalla de login. **Mantener el set mínimo** es lo único visible sin
   sesión.
2. `server/login.html` → reemplazar el logo y los textos de ANDEG por los de GECELCA / G-TALKS,
   aplicando los tokens nuevos.

El fallback SPA (`app.get('*')`) ya cubre las rutas nuevas; no requiere cambios.

---

## Verificación

1. **Compila**: `npm run build` (corre `tsc --noEmit` antes de Vite; debe pasar sin errores).
2. **Sin restos**: `grep -ri "elementor\|andeg\|wp-content" src/ index.html server/` no devuelve
   nada. `du -sh public/` muy por debajo de los 8 MB actuales.
3. **Visual**: `npm run preview` y actualizar `scripts/screenshot.mjs` con las rutas nuevas
   (`/`, `/ponentes`, `/ponentes/erick-wehdeking-arcieri`, `/escarapela`, `/encuestas`) en desktop
   1440 y móvil 390. Comparar las capturas contra `design-extract/render/*.png` el criterio no es
   pixel-perfect (el PDF es vertical y el sitio es web), sino **que se lea como la misma familia
   gráfica**: mismos azules, mismos arcos, mismo patrón de agenda.
4. **Interacción**: anclas y scrollspy, nav móvil (abre, cierra con Esc y con clic fuera, atrapa el
   foco), enlaces agenda → perfil de ponente, slug inválido → `/ponentes`.
5. **Accesibilidad**: contraste AA en todas las combinaciones de los tokens, foco visible,
   jerarquía de encabezados, `prefers-reduced-motion` respetado.
   ⚠ Ojo: la regla del proyecto hermano PORTALES GECELCA de *«replicar el incumplimiento y
   documentarlo»* **no aplica aquí** ese contrato es para réplicas 1:1 de Figma. Este es diseño
   propio, así que sí se corrige y debe cumplir AA.
6. **Gate**: `npm run build && npm start`, verificar que sin sesión ningún asset nuevo se sirve
   (401) salvo los de `LOGIN_PUBLIC_ASSETS`, y que con sesión la SPA carga completa.

---

## Pendientes de contenido (registrar en `docs/PENDIENTES-DE-CONTENIDO.md`)

| # | Pendiente | Detalle |
|---|---|---|
| 1 | **Lugar del evento** | Los PDFs dicen «G Working», pero la carpeta del proyecto se llama «EVENTO PUERTA DE ORO». Confirmar cuál es la sede real antes de publicar. Se implementa con «G Working» por ser lo que dice la pieza gráfica. |
| 2 | Fotos de los 11 ponentes | Ninguna pieza las trae. Se entrega con monograma; `Monogram.tsx` ya acepta `foto?`. |
| 3 | Logos vectoriales | Se extraen rasterizados a 600 DPI del PDF. Si se necesitan nítidos a cualquier escala, pedir el `.svg`/`.ai` a Comunicaciones. |
| 4 | Contenido de Escarapela | Lo define el usuario. |
| 5 | Contenido de Encuestas | Lo define el usuario. |
| 6 | Año del evento | `invitacion gtalk 2026.pdf` dice «Miércoles 5 de agosto/2026»; `2 Arte foro gtalk 2026.pdf` solo «Miércoles 5 de agosto». Se toma 2026. |

## Nota de repositorio

Esta carpeta está **sin trackear** dentro del repo `COMUNICACIONES`, cuyo `CLAUDE.md` documenta
otra aplicación (perfiles digitales con QR). Al terminar conviene o bien inicializar un repo propio
aquí, o bien añadir un `CLAUDE.md` a esta carpeta para que el contexto no se mezcle. Fuera del
alcance de este plan, pero vale decidirlo antes del primer commit.

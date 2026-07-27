# 1° Foro GECELCA «Energía en Acción» — G-TALKS

Carta de presentación digital del **1° Foro GECELCA «Energía en Acción — Retos y oportunidades»**,
miércoles 5 de agosto de 2026. SPA de React 19 + Vite + TypeScript, servida detrás de un gate de
Microsoft Entra ID.

## Rutas

| Ruta                | Página                                                    | Estado       |
| ------------------- | --------------------------------------------------------- | ------------ |
| `/`                 | Bienvenida · anclas `#bienvenida`, `#sobre-el-foro`, `#agenda` | contenido real |
| `/ponentes`         | Índice de los 11 ponentes                                  | contenido real |
| `/ponentes/:slug`   | Perfil, con sus intervenciones derivadas de la agenda       | contenido real |
| `/escarapela`       | Escarapela del asistente                                   | **estado vacío** |
| `/encuestas`        | Encuestas del foro                                         | **estado vacío** |

Un slug de ponente que no exista redirige a `/ponentes`; cualquier otra ruta, a `/`.

La agenda y los perfiles están enlazados en los dos sentidos: cada tramo de la línea del día lleva
a su bloque del programa —y lo resalta al señalarlo, en ambas direcciones—, cada nombre del
programa lleva al perfil, y cada intervención del perfil vuelve a su bloque.

## De dónde sale el diseño

Las tres piezas gráficas PDF de la raíz son la fuente de verdad. **Ningún color, tamaño, radio ni
tipografía se inventa ni se cita de memoria**: todo está medido con
`scripts/extract-pdf-design.py`, y el origen de cada token está documentado en
[`docs/SISTEMA-DE-DISENO.md`](docs/SISTEMA-DE-DISENO.md).

```bash
python -m venv .venv-design
.venv-design/Scripts/pip install pymupdf pillow fonttools

.venv-design/Scripts/python scripts/extract-pdf-design.py   # mide  → design-extract/report.md
.venv-design/Scripts/python scripts/contact-sheet.py        # hoja de contactos de los assets
.venv-design/Scripts/python scripts/build-assets.py         # → public/img/ + src/design/iconos.ts
.venv-design/Scripts/python scripts/upscale-photos.py       # → *@2x.webp para pantallas HiDPI
```

Los colores que el sistema necesitó y las piezas no traen —el campo oscuro, los hairlines, el humo—
**no son colores nuevos**: son mezclas declaradas de los medidos, con `color-mix()`. Cada valor o
está medido o es una mezcla trazable de dos que sí lo están.

`design-extract/` y `.venv-design/` no se versionan: son trabajo intermedio y se reconstruyen desde
los PDF.

## Estructura

```
src/
  data/foro.ts          Todo el contenido, tipado. La agenda alimenta también los perfiles.
  data/navegacion.ts    Los 4 destinos y las 3 anclas de la home.
  design/               tokens.css (medidos), fonts.css, base.css, iconos.ts (generado)
  components/           Chasis y primitivas del sistema, cada una con su CSS al lado
                        LineaDelDia.tsx es el elemento firma: la jornada como
                        línea de tiempo de una sola pista, índice interactivo
                        de la agenda
  pages/                Las 5 páginas
server/                 Gate Entra ID (OIDC Authorization Code + PKCE)
scripts/                Extracción de diseño (Python) y verificación (Playwright)
public/img/             Assets extraídos de los PDF + variantes @2x. 365 KB en total.
public/fonts/           Urbanist autohospedada, 64 KB
*.pdf                   Las piezas gráficas oficiales — fuente de verdad
```

## Acceso restringido (Microsoft Entra ID)

> Manual de guardia, respuesta a incidentes, rotación de secretos, registro de asistencia y ciclo
> anual: [`docs/SEGURIDAD.md`](docs/SEGURIDAD.md). Artefactos de despliegue en [`deploy/`](deploy/).

Flujo OIDC **Authorization Code + PKCE** con cliente confidencial (`@azure/msal-node`), cookie de
sesión httpOnly (`express-session`), revalidación silenciosa contra Entra cada 20 min y manejo de
`AADSTS50105` para usuarios del tenant no asignados a la app.

- **Quién entra lo decide Entra**: la Enterprise App debe tener *«¿Se requiere asignación?» = Sí* y
  los usuarios o grupos permitidos asignados. No hay allowlist local.
- **Flujo del visitante**: primer contacto → intento SSO silencioso (`prompt=none`); si ya tiene
  sesión Microsoft y está asignado, entra sin fricción. Si Entra pide interacción, ve la pantalla de
  login (`server/login.html`).
- **Nada de `dist/` se sirve sin sesión** salvo los archivos de `LOGIN_PUBLIC_ASSETS` en
  `server/app.js`, que son los que usa la pantalla de login: la marca y una fuente. Si cambian los
  assets del login, hay que actualizar esa lista a la vez.
- **Política de acceso sin sesión.** Redirigir literalmente *todo* a Microsoft rompería el sitio
  (un 302 sobre un `<script>` devuelve HTML que no parsea; sobre un `POST` pierde el cuerpo). Lo
  que se garantiza es que **ninguna navegación de una persona acaba en un callejón que no sea
  Microsoft**: las navegaciones —incluidas `HEAD` y una URL de asset escrita a mano en la barra de
  direcciones— reciben 302 a Entra; subrecursos, `fetch` y `/api/*` reciben 401. La clasificación
  usa `Sec-Fetch-*`, con `Accept` como respaldo. Un contador en cookie (`gt_lt`) corta el bucle si
  la cookie de sesión no se puede fijar, y nombra la causa.
- **Deep links**: el destino se valida contra la tabla de rutas de la SPA y se guarda en la
  sesión, nunca en la URL. Un enlace a `/ponentes/<slug>` compartido por correo aterriza ahí
  después de autenticar.
- **Logout**: navegar a `/auth/logout`.
- Config: `M365_*`, `PUBLIC_ORIGIN`, `SESSION_*`, `AUTH_RATE_LIMIT`, `AUDIT_LOG_PATH` (ver
  `.env.example`). En producción el arranque **aborta** listando las variables que falten y valida
  que `M365_REDIRECT_URI` empiece por `PUBLIC_ORIGIN`. Los secretos viven en `/etc/gtalks/env`,
  fuera del repo.

**En desarrollo el sitio también está gateado.** Vite (5173) hace proxy de `/auth` y `/api` al
Express (3000) y, además, un plugin propio (`vite.config.ts`) intercepta las navegaciones y las
manda a Entra si no hay sesión. Antes la SPA en 5173 se servía entera sin login: era una trampa,
porque el modo en el que se trabaja a diario no debe comportarse distinto del que se publica.

El plugin falla **cerrado**: si el gate no está levantado, muestra una página que dice
`npm run dev:auth` en vez de servir el sitio. Para trabajar solo el diseño, sin autenticación,
está `npm run preview` sobre un `npm run build`.

`GET /api/me` devuelve `{ authenticated, user: { nombre_completo, cargo, area, upn, email, oid,
roles } }` desde la sesión. La escarapela puede construirse sobre eso sin backend nuevo.

`cargo` y `area` **no son claims de OIDC**: el servidor los pide a Microsoft Graph al iniciar
sesión (scope `User.Read`) y los guarda en la sesión. Si Graph no responde, o si es un invitado
B2B sin cargo en el directorio de GECELCA, llegan vacíos y la interfaz muestra el correo — el
login nunca depende de ello.

**Menú de sesión** (`src/components/SesionMenu.tsx`): arriba a la derecha, con el nombre y el
cargo de quien entró, «Cambiar de cuenta» (`/auth/login?select=1`) y «Cerrar sesión»
(`/auth/logout`). Las dos son navegaciones y no `fetch`: cerrar sesión tiene que llevar al
front-channel logout de Microsoft para que la sesión muera también en Entra. En móvil vive dentro
del panel de navegación. Si el sitio se sirve sin gate, no se pinta.

## Comandos

```bash
npm ci            # no `npm install`: el lockfile es el pin de versiones
npm run dev:auth  # PRIMERO: el gate Entra en :3000
npm run dev       # después: Vite en :5173, TAMBIÉN gateado
npm run build     # tsc --noEmit + vite build
npm run preview   # sirve dist/ SIN gate (solo verificación visual)
npm start         # sirve dist/ DETRÁS del gate — el entorno lo pone systemd
npm run start:local # igual, pero leyendo el .env del repo (desarrollo)
```

## Verificación

Los scripts de Playwright usan el Edge o Chrome del sistema; no descargan navegador.

```bash
npm run build && npm run preview          # en una terminal → http://localhost:4173
node scripts/screenshot.mjs shots         # capturas de las 5 rutas, desktop y móvil
node scripts/interactions-test.mjs        # anclas, scrollspy, nav móvil, rutas inválidas
node scripts/a11y-test.mjs                # contraste, encabezados, alt, nombres accesibles,
                                          # foco, reduced-motion y reflow a 320 y 390 px

npm run build && npm run start:local      # el gate real, en otra terminal → :3000
node scripts/gate-test.mjs                # matriz de acceso sin sesión, CSP, cabeceras y
                                          # rompebucles de cookie
node scripts/sesion-test.mjs              # menú de sesión, simulando la identidad de /api/me

npm run dev:auth && npm run dev           # los dos servidores de desarrollo
node scripts/login-test.mjs               # recorrido real del login en navegador, incluido el
                                          # viaje a Microsoft (necesita salida a internet)
```

`a11y-test` resuelve los colores pintándolos en un lienzo de 1×1 en vez de parsear la cadena:
desde que los tokens derivan con `color-mix()`, `getComputedStyle` devuelve `oklab(...)` y un
parser de `rgb()` los daba por transparentes, asumía fondo blanco y reportaba contrastes falsos.

## Convenciones

- **Español de Colombia con tuteo** en todo el microcopy nuevo de la interfaz. El copy institucional
  transcrito de los PDF se respeta **literal**, aunque mezcle tuteo y ustedeo.
- **Accesibilidad: se corrige, no se documenta.** El diseño es propio y debe cumplir WCAG 2.1 AA.
- **No tocar el flujo OIDC** de `server/auth/` salvo que se pida.
- Los pendientes de contenido están en [`docs/PENDIENTES-DE-CONTENIDO.md`](docs/PENDIENTES-DE-CONTENIDO.md).

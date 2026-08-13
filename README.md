# 1° Foro GECELCA «Energía en Acción» G-TALKS

Carta de presentación digital del **1° Foro GECELCA «Energía en Acción Retos y oportunidades»**,
miércoles 5 de agosto de 2026. SPA de React 19 + Vite + TypeScript, **pública**: el contenido se
navega sin autenticarse, y la sesión de Microsoft Entra ID existe solo para la escarapela
(`/escarapela`), que se llena con la identidad de quien entra.

## Rutas

| Ruta                | Página                                                    | Estado       |
| ------------------- | --------------------------------------------------------- | ------------ |
| `/`                 | Bienvenida · anclas `#bienvenida`, `#sobre-el-foro`, `#agenda` | contenido real |
| `/ponentes`         | Índice de los 11: retrato, cargo y cuándo interviene cada uno | contenido real |
| `/ponentes/:slug`   | Perfil: retrato, trayectoria y sus intervenciones derivadas de la agenda | contenido real |
| `/escarapela`       | El carné del asistente: réplica de `Carnet-foro-1.jpg (1).jpeg` con los datos de la sesión, foto local y QR de asistencia al dorso. Sin sesión, invita a entrar | contenido real |
| `/encuestas`        | Las dos encuestas del foro, enlazadas a Microsoft Forms      | contenido real |

Un slug de ponente que no exista redirige a `/ponentes`; cualquier otra ruta, a `/`.

La agenda y los perfiles están enlazados en los dos sentidos: cada tramo de la línea del día lleva
a su bloque del programay lo resalta al señalarlo, en ambas direcciones, cada nombre del
programa lleva al perfil, y cada intervención del perfil vuelve a su bloque.

## De dónde sale el diseño

Las tres piezas gráficas PDF de la raíz son la fuente de verdad. **Ningún color, tamaño, radio ni
tipografía se inventa ni se cita de memoria**: todo está medido con
`scripts/extract-pdf-design.py`, y el origen de cada token está documentado en
[`docs/SISTEMA-DE-DISENO.md`](docs/SISTEMA-DE-DISENO.md).

El contenido de los ponentesnombre, cargo y trayectoria sale de `PERFIL DE LOS PONENTES.docx`,
también en la raíz, y se transcribe literal a `src/data/foro.ts`.

```bash
python -m venv .venv-design
.venv-design/Scripts/pip install pymupdf pillow fonttools

.venv-design/Scripts/python scripts/extract-pdf-design.py   # mide  → design-extract/report.md
.venv-design/Scripts/python scripts/contact-sheet.py        # hoja de contactos de los assets
.venv-design/Scripts/python scripts/build-assets.py         # → public/img/ + src/design/iconos.ts
.venv-design/Scripts/python scripts/upscale-photos.py       # → *@2x.webp para pantallas HiDPI
.venv-design/Scripts/python scripts/build-retratos.py       # retratos-origen/ → public/img/ponentes/
                                                            #   + src/design/retratos.ts
```

`build-retratos.py` es el único que no lee de los PDF: procesa las fotos de los ponentes tal como
lleguen y escribe un manifiesto tipado con las que existen. Quien no tenga foto cae al monograma
de iniciales, así que el sitio está terminado hoy y mejora solo a medida que llega el material.
`retratos-origen/` no se versiona (originales de personas identificables); el derivado recortado
de `public/img/ponentes/`, sí.

Los colores que el sistema necesitó y las piezas no traenel campo oscuro, los hairlines, el humo
**no son colores nuevos**: son mezclas declaradas de los medidos, con `color-mix()`. Cada valor o
está medido o es una mezcla trazable de dos que sí lo están.

`design-extract/` y `.venv-design/` no se versionan: son trabajo intermedio y se reconstruyen desde
los PDF.

## Estructura

```
src/
  data/foro.ts          Todo el contenido, tipado. La agenda alimenta también los perfiles.
  data/navegacion.ts    Los 4 destinos y las 3 anclas de la home.
  design/               tokens.css (medidos), fonts.css, base.css
                        iconos.ts y retratos.ts son GENERADOS: no editar a mano
  components/           Chasis y primitivas del sistema, cada una con su CSS al lado
                        LineaDelDia.tsx es el elemento firma: la jornada como
                        línea de tiempo de una sola pista, índice interactivo
                        de la agenda
  pages/                Las 5 páginas
server/                 Identidad Entra ID (OIDC Authorization Code + PKCE) + servido de dist/
scripts/                Extracción de diseño (Python) y verificación (Playwright)
public/img/             Assets extraídos de los PDF + variantes @2x. 365 KB en total.
public/img/ponentes/    Retratos procesados (4 derivados por persona)
public/fonts/           Urbanist autohospedada, 64 KB
*.pdf                   Las piezas gráficas oficiales fuente de verdad
```

## Sitio público, identidad para la escarapela (Microsoft Entra ID)

> Manual de guardia, respuesta a incidentes, rotación de secretos, registro de asistencia y ciclo
> anual: [`docs/SEGURIDAD.md`](docs/SEGURIDAD.md). Cómo se publica un commit, cómo se revierte y
> de dónde sale ese diseño: [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md); artefactos en
> [`deploy/`](deploy/).

**El contenido del foro es público por decisión del negocio**: nada redirige solo a Microsoft, y
todo HTML sale con la `Content-Security-Policy` puesta (el fallback SPA de `server/app.js` es la
única puerta del HTML). Público no es indexable: `X-Robots-Tag: noindex` se queda.

**La única superficie con sesión es la identidad** `GET /api/me`, que alimenta la escarapela:

- El login nace únicamente del botón de `/escarapela` («Iniciar sesión con Microsoft» →
  `/auth/login`). Flujo OIDC **Authorization Code + PKCE** con cliente confidencial
  (`@azure/msal-node`), siempre interactivo (el SSO silencioso `prompt=none` murió con el gate),
  cookie de sesión httpOnly (`express-session`, `__Host-` en producción), revalidación contra
  Entra cada 20 min sobre `/api/me` y manejo de `AADSTS50105` para usuarios no asignados.
- **Quién puede iniciar sesión lo decide Entra**: la Enterprise App debe tener *«¿Se requiere
  asignación?» = Sí* y los usuarios o grupos permitidos asignados. No hay allowlist local.
- `GET /api/me` sin sesión responde 401; los métodos que no son de lectura pasan por el CSRF
  (`Sec-Fetch-Site`/`Origin` contra `PUBLIC_ORIGIN` → 403). Los errores del callback aterrizan en
  `/escarapela?auth=<motivo>` y la SPA los explica junto al botón (`src/data/escarapela.ts`).
- El **destino** del retorno pasa por la allowlist de rutas de la SPA (anti-open-redirect) y por
  defecto es `/escarapela`.
- **Logout**: navegar a `/auth/logout` (front-channel de Microsoft).
- Config: `M365_*`, `PUBLIC_ORIGIN`, `SESSION_*`, `AUTH_RATE_LIMIT`, `AUDIT_LOG_PATH` (ver
  `.env.example`). En producción el arranque **aborta** listando las variables que falten y valida
  que `M365_REDIRECT_URI` empiece por `PUBLIC_ORIGIN`. Los secretos viven en `/etc/gtalks/env`,
  fuera del repo.

**La escarapela** (`src/components/Escarapela.tsx`) es réplica de `Carnet-foro-1.jpg (1).jpeg`
(pieza oficial, raíz del repo; sustituye a `Escarapela.png`, que lo fue hasta el 30 de julio de
2026): nombre, cargo→área→correo y píldora «ASISTENTE» desde la sesión; **foto local**
elegida por la persona (canvas 512px sin EXIF → `localStorage` con clave por `oid` nunca viaja
al servidor); y al dorso, con volteo 3D, el **QR de registro de asistencia** hacia la Power App de
capacitaciones, con el usuario de la sesión (sin dominio) y el `ID_CAPACITACION` de la **jornada
en curso** mañana o tarde, decidida en hora de Bogotá con `Intl`/`America/Bogota`, inmune a la
zona horaria del dispositivo o del servidor, y rotando en vivo al cruzar el mediodía (`uqr`,
pintado como SVG en el DOM). Diseño documentado en
[`docs/SISTEMA-DE-DISENO.md`](docs/SISTEMA-DE-DISENO.md) §La escarapela.

`GET /api/me` devuelve `{ authenticated, user: { nombre_completo, cargo, area, upn, email, oid,
roles } }` la respuesta mínima que la interfaz necesita; nada más viaja al navegador.

`cargo` y `area` **no son claims de OIDC**: el servidor los pide a Microsoft Graph al iniciar
sesión (scope `User.Read`) y los guarda en la sesión. Si Graph no responde, o si es un invitado
B2B sin cargo en el directorio de GECELCA, llegan vacíos y la interfaz muestra el correo el
login nunca depende de ello.

**Menú de sesión** (`src/components/SesionMenu.tsx`): arriba a la derecha, con el nombre y el
cargo de quien entró, «Cambiar de cuenta» (`/auth/login?select=1`) y «Cerrar sesión»
(`/auth/logout`). Las dos son navegaciones y no `fetch`: cerrar sesión tiene que llevar al
front-channel logout de Microsoft para que la sesión muera también en Entra. En móvil vive dentro
del panel de navegación. Sin sesión, no se pinta el sitio se ve igual.

**En desarrollo** Vite (5173) hace proxy de `/auth`, `/api` y `/health` al Express (3000), que
solo hace falta levantado para probar el login real. `strictPort: true` evita que Vite caiga a
`:5174` y el redirect URI deje de coincidir (AADSTS50011 sin pista). Para trabajar el diseño sin
identidad está `npm run preview` sobre un `npm run build`.

## Comandos

```bash
npm ci            # no `npm install`: el lockfile es el pin de versiones
npm run dev       # Vite en :5173 el sitio es público, navega sin más
npm run dev:auth  # el server de identidad en :3000 solo hace falta para el login real
npm run build     # tsc --noEmit + vite build
npm run preview   # sirve dist/ sin identidad (verificación visual y scripts)
npm start         # sirve dist/ con la identidad el entorno lo pone systemd
npm run start:local # igual, pero leyendo el .env del repo (desarrollo)
```

## Verificación

Los scripts de Playwright usan el Edge o Chrome del sistema; no descargan navegador.

```bash
npm run build && npm run preview          # en una terminal → http://localhost:4173
node scripts/screenshot.mjs shots         # capturas de las 5 rutas (más la escarapela con
                                          # sesión simulada y su dorso), desktop y móvil
node scripts/interactions-test.mjs        # anclas, scrollspy, nav móvil, rutas inválidas,
                                          # y la escarapela: volteo y ciclo de la foto
node scripts/a11y-test.mjs                # contraste, encabezados, alt, nombres accesibles,
                                          # foco, reduced-motion, reflow a 320 y 390 px,
                                          # y el carné por sus dos caras
node scripts/sesion-test.mjs              # menú de sesión y carné, simulando /api/me
node scripts/qr-test.mjs                  # el QR estilizado del dorso SE LEE: píxeles reales
                                          # decodificados con ZXing a dos densidades

npm run build && npm run start:local      # el server real, en otra terminal → :3000
node scripts/gate-test.mjs                # matriz pública: 200+CSP, 401 /api/me, CSRF,
                                          # login OIDC sin prompt=none, cabeceras

npm run dev:auth && npm run dev           # los dos servidores de desarrollo
node scripts/login-test.mjs               # recorrido real del login desde /escarapela,
                                          # incluido el viaje a Microsoft (necesita internet)

bash deploy/ensayo-local.sh               # despliegue: paquete y coreografía de renames
bash deploy/ensayo-local.sh --completo    # además compila desde el paquete, poda y comprueba
                                          # que el server arranque con la identidad cerrada
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

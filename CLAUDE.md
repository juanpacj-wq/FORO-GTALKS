# EVENTO PUERTA DE ORO — Foro GECELCA «G-TALKS»

> **Ojo con el contexto heredado**: esta carpeta está dentro del repo `COMUNICACIONES`, cuyo
> `CLAUDE.md` describe una app de perfiles digitales con QR (Express + SQLite + npm workspaces).
> **Nada de eso aplica aquí.** Este es un proyecto aparte, sin trackear en git, con su propio
> `package.json`. No hay base de datos, ni workspaces, ni migraciones.

## Qué es

Carta de presentación digital del **1° Foro GECELCA «Energía en Acción — Retos y oportunidades»**
(marca G-TALKS), miércoles 5 de agosto de 2026.

SPA de **React 19 + Vite + TypeScript**, servida detrás de un gate de **Microsoft Entra ID**
(OIDC Authorization Code + PKCE) que vive en `server/`. Nada de `dist/` se sirve sin sesión.

**Estado actual: rediseño completo.** El plan de
[`docs/PLAN-REDISENO.md`](./docs/PLAN-REDISENO.md) se ejecutó entero: la réplica de
`foro2026.andeg.org` de la que partió el proyecto ya no existe. El sistema visual está medido sobre
las piezas y documentado en [`docs/SISTEMA-DE-DISENO.md`](./docs/SISTEMA-DE-DISENO.md) — léelo
antes de tocar `src/design/` o de añadir cualquier valor de estilo.

Lo que queda abierto son las dos páginas placeholder (`/escarapela` y `/encuestas`), que las define
el usuario, y los pendientes de contenido.

## Fuente de verdad del diseño y del contenido

Los tres PDFs de la raíz son las piezas gráficas oficiales del evento:

| Archivo | Pieza |
|---|---|
| `invitacion gtalk 2026.pdf` | Invitación general (copy neutro) |
| `invitación expertos.pdf` | Invitación a ponentes externos |
| `2 Arte foro gtalk 2026.pdf` | Invitación interna (Presidencia) |

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
src/data/foro.ts             Todo el contenido. La agenda alimenta también los perfiles.
src/design/                  tokens.css (medidos), fonts.css, base.css, iconos.ts (generado)
src/components/              Chasis y primitivas, cada una con su CSS al lado
                             LineaDelDia.tsx es el elemento firma: la jornada
                             como línea de tiempo de una sola pista, índice
                             de la agenda y resaltado cruzado con ella
src/pages/                   Las 5 páginas
server/                      Gate Entra ID: app.js, auth/, login.html
scripts/                     Extracción de diseño (Python) y verificación (Playwright)
public/img/                  Assets extraídos de los PDF, todo SVG salvo las 3 fotos
public/fonts/                Urbanist autohospedada
*.pdf                        Piezas gráficas oficiales — fuente de verdad
```

## Regenerar el diseño desde los PDFs

`design-extract/` y `.venv-design/` no se versionan; se reconstruyen:

```bash
python -m venv .venv-design
.venv-design/Scripts/pip install pymupdf pillow fonttools
.venv-design/Scripts/python scripts/extract-pdf-design.py   # mide → design-extract/report.md
.venv-design/Scripts/python scripts/build-assets.py         # → public/img/ + src/design/iconos.ts
.venv-design/Scripts/python scripts/upscale-photos.py       # → *@2x.webp para HiDPI
```

## Comandos

```bash
npm ci            # el lockfile es el pin: no `npm install`
npm run dev:auth  # PRIMERO: el gate Entra en :3000
npm run dev       # después: Vite en :5173, TAMBIÉN gateado (redirige a Entra sin sesión)
npm run build     # tsc --noEmit + vite build
npm run preview   # sirve dist/ SIN gate (solo verificación visual y scripts)
npm start         # sirve dist/ detrás del gate; el entorno lo pone systemd
npm run start:local # igual, leyendo el .env del repo

# Con `npm run preview` levantado, en otra terminal:
node scripts/screenshot.mjs shots      # capturas de las 5 rutas, desktop y móvil
node scripts/interactions-test.mjs     # anclas, scrollspy, nav móvil, rutas inválidas
node scripts/a11y-test.mjs             # contraste, encabezados, alt, nombres accesibles
node scripts/sesion-test.mjs           # menú de sesión, simulando la identidad de /api/me

# Con `npm run start:local` levantado:
node scripts/gate-test.mjs             # matriz del gate sin sesión, CSP, cabeceras

# Con `npm run dev:auth` + `npm run dev` levantados (necesita internet):
node scripts/login-test.mjs            # recorrido real del login, incluido el viaje a Microsoft
```

## Convenciones

- **Español de Colombia con tuteo** en todo microcopy nuevo de la UI. El copy institucional
  transcrito de los PDFs se respeta **literal**, aunque mezcle tuteo y ustedeo.
- **Accesibilidad: se corrige, no se documenta.** La regla de PORTALES GECELCA de replicar
  incumplimientos WCAG aplica solo a réplicas 1:1 de Figma. Aquí el diseño es propio y debe
  cumplir **WCAG 2.1 AA**.
- **No tocar el flujo OIDC** de `server/auth/` salvo que se pida. Si cambian los assets del logo,
  actualizar `LOGIN_PUBLIC_ASSETS` en `server/app.js` — es lo único visible sin sesión, y debe
  mantenerse mínimo.
- **Seguridad: `docs/SEGURIDAD.md`** es el manual de guardia (política de acceso sin sesión,
  incidentes, rotación de secretos, registro de asistencia, ciclo anual y riesgos aceptados).
  Cualquier cambio en `server/` se verifica con `node scripts/gate-test.mjs`.
- **Nada de redirigir subrecursos a Microsoft.** Solo las navegaciones (`Sec-Fetch-Dest: document`)
  reciben 302; scripts, imágenes, fuentes, `fetch` y `/api/*` reciben 401. Un 302 sobre un
  `<script>` devuelve HTML que no parsea, y sobre un `POST` pierde el cuerpo.
- **Los símbolos monocromos van con `Icono.tsx`, no con `<img>`.** Un SVG cargado por `img` no
  hereda `currentColor`: se pinta de negro. `Icono` lo resuelve con `mask-image`.
- **El campo es oscuro y el papel es la excepción.** Todo vive sobre `--gt-noche`; las
  superficies claras se marcan con `.gt-lamina`, que además invierte el color de foco y de los
  hairlines. Nada de fondos claros sueltos.
- **Nada de revelados por scroll en el contenido.** Una animación que esconde texto hasta que el
  navegador la dispara es una sección en blanco esperando a fallar (pestaña de fondo, captura,
  renderizador sin soporte). Solo se anima por scroll lo que no oculta nada.
- Los pendientes de contenido (sede real del evento, fotos de ponentes) se registran en
  `docs/PENDIENTES-DE-CONTENIDO.md`.

## Variables de entorno

En `.env` en la raíz de esta carpeta (ver `.env.example`): `M365_TENANT_ID`, `M365_CLIENT_ID`,
`M365_CLIENT_SECRET`, `M365_REDIRECT_URI`, `SESSION_SECRET`, `SERVER_PORT`.
En producción `SESSION_SECRET` es obligatorio y `NODE_ENV=production` fuerza cookie `Secure`.

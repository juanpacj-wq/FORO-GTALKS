# Despliegue

Cómo llega un commit de este repositorio al servidor, y de dónde sale el diseño de ese
mecanismo: es una adaptación del que ya opera en el proyecto hermano **PORTALES GECELCA**
(`../PORTALES GECELCA/sitio/deploy/`). La primera mitad de este documento es la auditoría de
aquél; la segunda, lo que se construyó aquí y por qué difiere donde difiere.

---

## Parte 0 Dos correcciones al supuesto de partida

Antes de nada, dos cosas que la auditoría desmiente y que conviene tener claras, porque cambian
lo que hay que operar y lo que hay que vigilar.

### No hay «ingreso automatizado al PMP»

Se revisó el repositorio completo buscando cualquier integración con ManageEngine Password
Manager Pro (o con cualquier bóveda de credenciales): no existe. Ni cliente, ni API, ni script,
ni variable de entorno. Lo único que hay son **dos menciones documentales** a PMP como
custodio corporativo de contraseñas:

- `PORTALES GECELCA/docs/PLAN-PILOTO.md:39` «Sin secretos en el repo (credenciales solo en
  PMP; `wp-config.php` fuera de git)».
- `PORTALES GECELCA/docs/SOLICITUD-INFRAESTRUCTURA.md:69` y `:73` «La contraseña sigue
  custodiada en PMP» y el ofrecimiento explícito de pasar las sesiones por PMP **si la política
  lo exigiera**, cosa que a hoy no ocurre.

El acceso real al servidor es **SSH directo con llave pública**: `uportalteg@192.168.77.12`,
puerto `2022`, llave `~/.ssh/id_ed25519`, y `-o BatchMode=yes` para que un prompt interactivo
falle en vez de colgar el script (`sitio/deploy/deploy.sh:21-34`). La contraseña de esa cuenta
está en PMP y el despliegue no la toca nunca. Ese es justamente el punto: **el despliegue no
necesita ninguna credencial reutilizable**, solo una llave que el servidor ya conoce.

Consecuencia práctica para este proyecto: no hay nada de PMP que recrear. Lo que hay que
recrear es el modelo de acceso llave, no contraseña; no interactivo; sin secretos en el repo.

### Tampoco se despliega «al commitear»

No existe ningún gancho de git, ni acción de GitHub, ni servicio que observe el repositorio.
El único workflow del repo padre (`COMUNICACIONES/.github/workflows/ci.yml`) hace typecheck,
tests y build **no despliega**, y ni siquiera cubre esta carpeta.

Lo que sí existe, y es de donde viene la impresión, es una **regla de protocolo**: desde
2026‑07‑23 el script publica exclusivamente lo que está commiteado (`git archive`, nunca el
árbol de trabajo). Como está escrito en `parallel-protocol.md:80-86`: *«si no commiteaste, tu
cambio no se despliega»*. El commit es **condición** del despliegue, no su **disparador**. El
disparo lo da una persona, a mano, y bajo lock.

Aquí se recreó ese modelo tal cual, y además se dejó el disparador que faltaba
`deploy/hooks/post-commit` como algo que **hay que instalar y habilitar a conciencia**, no
como comportamiento por defecto (§Parte 3).

---

## Parte 1 Auditoría del proceso de PORTALES GECELCA

El sistema son cuatro archivos en `PORTALES GECELCA/sitio/deploy/` más el coordinador
`manifest.py` de la skill `figma-wp-replicator`. Lo audité de inicio a fin; esto es lo que hace
y, más importante, **por qué cada pieza está ahí**.

### El contexto que explica el diseño

Varias sesiones de Claude trabajan **en la misma máquina, sobre la misma copia del repo, en
`main`**, y despliegan a **un único servidor** (`madara`). No hay ramas por tarea a propósito:
el manifiesto compartido tiene que ser visible en tiempo real entre sesiones, y el deploy
publica el árbol entero, así que una rama divergente subiría trabajo a medias de otros
(`parallel-protocol.md:5-11`). Todo el blindaje del script sale de esa topología: concurrencia
real, un solo destino, y auditoría exigible.

### El lock, antes de tocar nada

`manifest.py deploy-lock --session <id>` toma un lock **global**vive en
`sitio/pages-manifest.json` aunque la campaña activa use otro manifiesto, porque *un servidor =
un solo dominio de lock* con **TTL de 30 minutos**: un lock más viejo se considera huérfano y
se roba, para que una sesión que murió a media faena no bloquee a todas las demás para siempre.
Cada mutación del manifiesto se **commitea de inmediato**, con reintentos ante `index.lock` de
git: el historial es la traza de quién tuvo el lock y cuándo.

### Los ocho pasos del script

| # | Paso | Qué garantiza |
|---|---|---|
| 0 | `--estado` | Subcomando de auditoría: imprime el SHA local y el desplegado según el servidor. Es lo primero que se corre cuando algo huele raro. |
| 1 | Resolver el commit | `git rev-parse "$REF^{commit}"`. Sin argumento, `HEAD`; con argumento, cualquier ref o SHA **eso es el rollback auditable**: re-desplegar un commit viejo es el mismo camino, no un procedimiento aparte. Avisa (sin abortar) del árbol sucio: con sesiones paralelas siempre hay WIP ajeno, y abortar bloquearía a todos. |
| 2 | Paquete determinista | `git archive $SHA <subárbol> \| gzip -n`. `git archive` fija mtimes a la fecha del commit y ordena las entradas; `gzip -n` omite el nombre y el timestamp de la cabecera. Resultado: **mismo commit → mismo byte stream → mismo SHA‑256**. El checksum deja de ser «un hash» y pasa a ser el identificador reproducible del despliegue. Los scripts de siembra se extraen **del mismo archive**, no del árbol de trabajo. |
| 3 | Backup de BD | `wp db export` a `/var/backups/gecelca/pre-deploy-<fecha>-<sha>.sql`, con purga a 14 días. El nombre lleva el SHA: el backup queda amarrado al despliegue que lo motivó. |
| 4 | Transferencia verificada | El paquete viaja por la tubería de SSH y el servidor devuelve su propio `sha256sum`. Si no coincide con el local, **aborta sin tocar nada**. |
| 5 | Swap bajo `flock` | `flock -w 600 /var/lock/gecelca-deploy.lock` segunda línea de defensa bajo el lock del manifiesto: dos deploys no se solapan ni aunque alguien se salte el protocolo. El paquete se extrae a un **staging** temporal, se verifica que traiga tema *y* plugin, y el reemplazo es **por renames**: la generación viva se mueve a `prev/` y el staging ocupa su lugar. Sin ventana con el directorio a medias, y purga implícita de lo que ya no existe en git. |
| 6 | Activación y cachés | `wp theme activate`, `wp plugin activate`, `delete_pattern_cache()`, `cache flush`, `transient delete --all`. Ese `delete_pattern_cache` está ahí por una lección concreta: WP ≥ 6.4 cachea el listado de patterns contra la versión del tema, y sin invalidarlo un pattern nuevo no se registra. |
| 7 | Siembras idempotentes | `seed-nav.sh` y `seed-contenido.sh`, ejecutados **desde la copia del commit**. Imponen por `wp-cli` lo que vive en la BD y no en git (el menú, el contenido semilla), con guarda editorial: solo escriben lo vacío o lo que aún tiene el placeholder, **jamás pisan contenido editado por Comunicaciones**. Correrlos N veces deja el mismo resultado. |
| 8 | Salud + rollback | `curl` a `/`, `/calendario/`, `/estudios/`, más la comprobación de que el HTML encola `theme.css?ver=` y que ese CSS sirve. Si algo falla, `rollback()` hace el swap inverso desde `prev/`, reactiva, y escribe `ROLLBACK` en el journal. `GEC_DEPLOY_SIMULAR_FALLO=1` fuerza esa rama para poder **ensayar** el rollback. |

Y el cierre: el **journal**. Una línea append-only en `/var/backups/gecelca/deploy-journal.log`
con fecha, SHA, ref, operador (`whoami@hostname`), checksum, backup de BD y resultado; más un
`deploy-actual.json` que `--estado` lee. Se escribe tanto en el camino feliz como en el
rollback.

### Las cinco ideas que hay que llevarse

1. **Se publica un commit, no un directorio.** El árbol de trabajo nunca viaja.
2. **El paquete es determinista y el checksum se verifica dos veces** (al llegar y antes de
   aplicar), en los dos extremos.
3. **El reemplazo es un rename con generación anterior guardada**, así que revertir cuesta lo
   mismo que aplicar.
4. **La comprobación de salud es la que decide**, y su fallo revierte solo. Con un gancho para
   ensayarla.
5. **Todo queda escrito en el servidor**, no en la terminal de quien desplegó.

---

## Parte 2 Qué se trasplanta y qué no

| Pieza de PORTALES | Aquí | Por qué |
|---|---|---|
| Acceso SSH por llave, `BatchMode=yes` | **Igual** | Mismo modelo: sin contraseñas, sin prompts, sin secretos en el repo. |
| `git archive` + `gzip -n` + SHA‑256 | **Igual**, con `-c core.autocrlf=false -c core.eol=lf` | Esta estación es Windows. Sin eso, los `.js` del gate y los `.sh` llegarían con CRLF y bash fallaría por un `\r` invisible. |
| Doble verificación del checksum | **Igual** | |
| Swap por renames + generación `prev` | **Igual**, pero `prev` va **al lado de la app** (`/opt/gtalks.prev`), no en `/var/backups` | Allí `prev/` está fuera de `wp-content` para que WordPress no liste un tema fantasma. Aquí ese riesgo no existe, y en cambio importa que `mv` sea **dentro del mismo sistema de archivos**: entre sistemas deja de ser instantáneo y deja de ser atómico. |
| `flock` en el servidor | **Igual** | |
| Journal + `--estado` | **Igual** (`/var/backups/gtalks/`) | |
| Simulacro de rollback | **Igual**, con `GT_DEPLOY_SIMULAR_FALLO=1` | |
| Lock de manifiesto (`manifest.py`) | **No se trae** | Aquel lock existe porque hay N sesiones concurrentes sobre un repo compartido. Aquí el repo es de una sola línea de trabajo; el `flock` del servidor ya cubre el solapamiento real. Traerlo sería ceremonia sin nadie con quien coordinar. |
| Backup de BD | **No aplica** | No hay base de datos. Lo único con estado es el registro de asistencia, que vive en `/var/log/gtalks` **fuera** del directorio que el deploy reemplaza, y con su propia rotación (`deploy/logrotate/gtalks`). El despliegue no lo puede perder. |
| Siembras `wp-cli` | **No aplican** | Aquí no hay contenido en base de datos: todo sale de `src/data/foro.ts`, que es git. |
| Activación de tema/purga de cachés | **Se convierte en** `systemctl restart gtalks` | |
| `curl` esperando 200 | **Se convierte en** la matriz de salud (abajo) | El 200 del contenido es salud (el sitio es público), pero solo con la CSP puesta y con `/api/me` en 401: la identidad cerrada es lo innegociable. |

### Lo que aquí es nuevo: la compilación

PORTALES despliega archivos que ya son el producto final (PHP, CSS). Este proyecto es una SPA
que hay que **compilar**. El paquete que viaja es el código fuente del commit, y la compilación
ocurre **en el servidor, dentro del staging**:

```
npm ci --ignore-scripts   →   npm run build   →   npm prune --omit=dev   →   swap
```

- Compilar en staging significa que **un build roto no toca el sitio vivo**: si `tsc` o `vite`
  fallan, el swap ni siquiera se intenta. Es estrictamente más seguro que el original, donde el
  paquete se aplica y luego se comprueba.
- `--ignore-scripts` no es paranoia genérica: `playwright` es `devDependency` y su postinstall
  se bajaría ~100 MB de navegadores que el servidor no usa jamás. Ninguna dependencia de
  ejecución (`express`, `helmet`, `@azure/msal-node`) necesita postinstall.
- `NODE_ENV` se limpia antes del `npm ci`: con `NODE_ENV=production`, npm omite las
  devDependencies y `vite` no existiría a la hora de compilar.
- `npm prune --omit=dev` deja en el servidor solo lo que se ejecuta. Menos superficie, menos
  avisos de `npm audit` que atender en cada ronda de `docs/SEGURIDAD.md`.
- **Requisito**: el servidor necesita Node 20 + npm y salida al registro de npm. Si no la
  tiene, el `npm ci` falla en staging es decir, falla **en el lado seguro**, sin haber tocado
  nada.

### Lo que aquí es distinto: la comprobación de salud

El sitio es público, pero «responde 200» a secas sigue sin ser salud: lo que la matriz vigila es
que el HTML salga **con sus cabeceras** y que la identidad siga **cerrada**. Replica las
afirmaciones que sostiene `docs/SEGURIDAD.md`, y las corre **desde el propio servidor** contra
`127.0.0.1`, para no depender del DNS interno ni de la ruta de red de la estación:

| Comprobación | Esperado | Qué caería si fallara |
|---|---|---|
| `GET /health` | `200` | El proceso no arrancó (típicamente: falta una variable en `/etc/gtalks/env` y `exigirEntorno()` abortó). |
| `GET /` con `Sec-Fetch-Dest: document` | `200` **con `Content-Security-Policy`** | El sitio no se sirve, o el HTML sale desnudo de cabeceras (p. ej. alguien quitó `index: false` del static). |
| `GET /api/me` con `Sec-Fetch-Dest: empty` | `401` | **La identidad estaría expuesta sin sesión** la regresión más grave posible del modelo actual. |
| `GET /auth/login` navegando | `302` → `login.microsoftonline.com` | El login de la escarapela murió (credenciales M365 ausentes o rotas en el entorno). |

Además, si `GTALKS_URL` está configurada, se comprueba desde la estación que la URL pública
devuelve `200` (prueba que nginx, TLS y DNS también están de pie). Si la estación **no alcanza**
la URL, se avisa y **no** se cuenta como fallo: la ruta de red de tu portátil no es la salud del
servidor. Un código HTTP inesperado sí cuenta.

Cualquier fallo de esa matriz dispara el rollback automático.

---

## Parte 3 Cómo se opera aquí

### Puesta en marcha (una sola vez)

1. **Servidor**, siguiendo los artefactos de `deploy/`:
   ```bash
   sudo adduser --system --group --home /opt/gtalks gtalks
   sudo mkdir -p /var/log/gtalks /var/backups/gtalks
   sudo chown gtalks:gtalks /var/log/gtalks
   sudo install -m 0700 -d /etc/gtalks          # los secretos, fuera del repo
   sudo install -m 0600 /dev/null /etc/gtalks/env   # llenar con las variables de .env.example
   sudo cp deploy/systemd/gtalks.service /etc/systemd/system/ && sudo systemctl daemon-reload
   sudo cp deploy/nginx/gtalks.conf /etc/nginx/sites-available/gtalks
   sudo ln -s /etc/nginx/sites-available/gtalks /etc/nginx/sites-enabled/
   sudo certbot --nginx -d gtalks.gecelca.com.co
   sudo cp deploy/logrotate/gtalks /etc/logrotate.d/gtalks
   ```
   Node 20 + npm instalados, y la llave pública de la estación en el `authorized_keys` de la
   cuenta de despliegue. Esa cuenta necesita `sudo` para `flock`, `chown` y `systemctl restart`.

2. **Estación**: `deploy/deploy.env` **ya está escrito** con los datos de Melisandre; quedan por
   confirmar el puerto SSH y la URL pública (§Estado del acceso). Si te falta el archivo, sale
   de `deploy/deploy.env.example`.

   Está gitignored: no son secretos, pero este repo tiene remoto en GitHub y el inventario de
   máquinas internas no tiene por qué viajar ahí. (PORTALES los lleva incrustados en su script
   porque su repo no sale de la red corporativa.)

3. **Opcional el gancho al commitear**:
   ```bash
   cp deploy/hooks/post-commit .git/hooks/post-commit && chmod +x .git/hooks/post-commit
   ```
   Por defecto solo **avisa** cuando el commit tocó algo que vive en el servidor. Para que
   despliegue de verdad hay que poner `GTALKS_AUTODEPLOY=1` en `deploy/deploy.env`. La razón de
   que sea opt-in y no automático: desplegar en cada commit es cómodo hasta el día en que
   commiteas a mitad de una idea y el evento está en curso.

### Día a día

```bash
bash deploy/deploy.sh              # publica HEAD
bash deploy/deploy.sh <ref|sha>    # publica ese commit así se hace el rollback auditable
bash deploy/deploy.sh --estado     # SHA desplegado, vs HEAD local, y estado del servicio
```

Lo no commiteado **no se despliega**, y el script lo dice listando el árbol sucio antes de
empezar. Es la misma regla del proyecto hermano.

### Ensayar el rollback (hazlo antes del evento, no durante)

```bash
GT_DEPLOY_SIMULAR_FALLO=1 bash deploy/deploy.sh
```

Fuerza la rama de fallo: el swap se aplica, la comprobación de salud se declara fallida, y el
script restaura la generación anterior y escribe `ROLLBACK` en el journal. Un rollback que
nunca se ha ejecutado no es un rollback, es una intención.

---

## Verificación

Entre que este mecanismo se escribe y que hay una máquina donde correrlo pueden pasar semanas.
La primera ejecución real no puede ser el día del evento, así que todo lo que no depende del
servidor se ensaya aquí:

```bash
bash deploy/ensayo-local.sh              # renames y paquete segundos, sin red
bash deploy/ensayo-local.sh --completo   # además compila y levanta el gate minutos
```

Los bloques de swap y rollback los **extrae de `deploy.sh`**, no los copia: si editas el script
y rompes la coreografía, el ensayo lo dice. Probar una copia no probaría nada.

**Lo verificado a 2026‑07‑27, en verde (16 comprobaciones):**

| Qué | Cómo se probó |
|---|---|
| El paquete es determinista | Dos `git archive` seguidos → mismo SHA‑256 (`f5c656484a31…`, 1.9 MB) |
| Trae lo que el servidor exige | `package-lock.json`, `package.json`, `server/index.js`, `index.html`, `vite.config.ts` |
| Sale sin CRLF pese a compilarse en Windows | `-c core.autocrlf=false -c core.eol=lf` sobre `server/index.js` |
| Un árbol recién extraído **compila** | `npm ci --ignore-scripts` + `npm run build` desde el `git archive`, no desde el árbol de trabajo → `dist/index.html` |
| La poda deja solo lo de ejecución | `vite`, `typescript` y `playwright` desaparecen; `express`, `helmet` y `@azure` quedan |
| **El server arranca *después* de la poda** | El servidor se levanta desde el árbol podado. Es la prueba de que ninguna dependencia de ejecución quedó por error en `devDependencies` un fallo que solo se vería en producción, y allí se leería como «el sitio está caído» (nota: `uqr`, el generador del QR, es a propósito devDependency solo existe en build-time, dentro del bundle de Vite) |
| La matriz de salud da lo esperado | `/health` 200 · `/` navegando → 200 con CSP · `/api/me` → 401 · `/auth/login` → 302 (o 503 sin credenciales M365 en el ensayo) |
| La coreografía de renames no pierde el sitio | Primer deploy (sin `prev`), segundo deploy (`v1`→`prev`, `v2` vivo), rollback (`v1` vuelve, `v2` a `.fallido`) y rollback sin `prev`, que **se niega y deja el sitio en pie** |

El propio ensayo encontró un defecto en su primera corrida: `tar … \| grep -q` hace que `grep`
salga al primer acierto, `tar` reciba SIGPIPE y `pipefail` lea la tubería entera como fallo.
Está corregido y comentado en el script, que para eso existe.

**Lo que sigue sin probar, y solo se puede probar contra la máquina real:** el viaje por SSH,
`sudo`, `flock`, `systemctl`, el borde nginx/TLS y el journal en `/var/backups/gtalks`.

### Cuando algo sale mal

- `bash deploy/deploy.sh --estado` qué SHA hay puesto y si el servicio está activo.
- `sudo tail -20 /var/backups/gtalks/deploy-journal.log` el historial completo.
- `journalctl -u gtalks -n 80` por qué no arranca el proceso. Si es una variable que falta,
  `exigirEntorno()` la nombra explícitamente (`server/index.js`).
- La generación que falló queda en `/opt/gtalks.fallido` para poder mirarla sin prisa.
- Verificación funcional completa: `node scripts/gate-test.mjs` (ver README).

---

## Riesgos aceptados y pendientes

| Asunto | Estado |
|---|---|
| **El servidor necesita salida al registro de npm** | La compilación ocurre allí. Si IT no la concede, hay que invertir el diseño: compilar en la estación y enviar `dist/` + `server/` + `package*.json`, con `npm ci --omit=dev` en el servidor. Se pierde parte de la cadena de auditoría (el artefacto deja de derivarse solo de git), así que es plan B, no plan A. |
| **Melisandre no es alcanzable desde la estación de desarrollo** | Es el bloqueo real, y es de red, no de código (§Estado del acceso). El mecanismo está **ensayado en verde en todo lo que no depende del servidor** (§Verificación), no solo escrito. |
| **Sin lock multi-sesión** | Deliberado (§Parte 2). El `flock` del servidor serializa cada fase, pero no la transacción entera: compilar y promover son dos sesiones SSH distintas. Por eso el staging se llama `/opt/gtalks.stage-<sha>` un segundo deploy no puede borrar el de uno que va a medias. Lo que sigue sin cubrirse es la coordinación humana: si algún día hay varias personas desplegando, ahí sí vale la pena traer el modelo de `manifest.py`. |
| **El primer deploy no tiene generación previa** | Si la comprobación de salud falla en el primerísimo despliegue, no hay `prev` que restaurar. El script lo dice con todas las letras y deja el servicio para revisión manual. A partir del segundo, el rollback es automático. |

---

## Estado del acceso Melisandre (`uprod@192.168.190.61`)

El destino ya está decidido: **Melisandre**, `uprod@192.168.190.61`. `deploy/deploy.env` está
escrito con esos datos. Lo que falta, medido el 2026‑07‑27 desde la estación de desarrollo
(`192.168.11.28`, Wi‑Fi):

| Comprobación | Resultado |
|---|---|
| ICMP a `192.168.190.61` | sin respuesta |
| TCP `192.168.190.61:22` | tiempo de espera agotado |
| TCP `192.168.190.61:2022` | tiempo de espera agotado |
| **Control**: TCP `192.168.77.12:2022` (madara) | **abierto** |
| Desde **madara** → `192.168.190.61` (22, 2022 e ICMP) | sin respuesta |

Dos cosas se deducen de ahí. La primera: no es la llave ni el usuario la estación sí alcanza
el segmento `192.168.77.0/24`, pero **no** el `192.168.190.0/24`. `bash deploy/deploy.sh
--estado` lo reporta tal cual (`connect to host 192.168.190.61 port 22: Connection timed out`).

La segunda: **tampoco sirve saltar por madara**. Se probó, porque un `ProxyJump` habría evitado
el ticket de red; pero el segmento 190 está aislado también del 77. Hacen falta dos orígenes
distintos para descartar que sea un problema de la estación, y ese es el dato que hay que
adjuntar a la solicitud.

### Lo que hace falta, en orden

| # | Qué | Por qué, y quién |
|---|---|---|
| 1 | **Ruta o regla de firewall**: `192.168.11.28` (o el rango de la Wi‑Fi de desarrollo) → `192.168.190.61`, puerto SSH. O una VPN que deje la estación dentro de ese segmento. | Es el bloqueo. Lo resuelve Infraestructura/Redes. |
| 2 | **Puerto SSH real**. `deploy.env` asume 22; madara usa 2022. No se pudo sondear. | Una línea de `deploy.env`. |
| 3 | **Llave pública en `uprod`**. Añadir a `~uprod/.ssh/authorized_keys`:<br>`ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIC7joY2bDXi5qlyzRcqtn86pVRXpQsL/S8CWpwtazdwp jcespedes@gecelca-dev` | El despliegue corre con `BatchMode=yes`: autentica por llave o falla. La contraseña de `uprod` puede seguir custodiada en PMP; el despliegue no la usa nunca. |
| 4 | **`sudo` no interactivo** para `uprod`. Sin esto el despliegue se queda esperando una contraseña que nadie va a teclear. Basta con acotarlo a lo que usa el script:<br>`/etc/sudoers.d/gtalks-deploy` →<br>`uprod ALL=(root) NOPASSWD: /usr/bin/flock, /bin/systemctl restart gtalks, /bin/systemctl is-active gtalks, /usr/bin/tee -a /var/backups/gtalks/*, /usr/bin/tee /var/backups/gtalks/*, /bin/cat /var/backups/gtalks/*` | Si la política no admite NOPASSWD, hay que cambiar el modelo (agente de despliegue en el servidor en vez de empuje por SSH). Conviene saberlo antes, no el día del evento. |
| 5 | **Node 20 + npm** en Melisandre y **salida al registro de npm**. | La compilación ocurre allí. Si no hay salida, plan B de la tabla de riesgos. |
| 6 | **DNS + TLS**: `gtalks.gecelca.com.co` → `192.168.190.61`, con certificado válido. **Ojo**: con IP privada, el reto HTTP‑01 de Let's Encrypt no funciona toca DNS‑01, un certificado de la CA interna, o publicar el sitio por un proxy con IP pública. | No es opcional: en producción `server/index.js` **aborta** si `PUBLIC_ORIGIN` no empieza por `https://`, y Entra exige que `M365_REDIRECT_URI` coincida exacto con lo registrado. |
| 7 | Pendientes que ya venían de `SEGURIDAD.md`: rangos de salida a internet (para fail2ban) y confirmar si el tenant tiene **Entra ID P1**. | Sin los rangos, fail2ban puede banear a la empresa entera. Sin P1, hay que asignar la Enterprise App persona por persona. |

Con (1), (2) y (3) ya se puede entrar y preparar el servidor. Con (4) a (6), desplegar de
verdad. Lo primero que debe correrse allí es un deploy normal seguido de
`GT_DEPLOY_SIMULAR_FALLO=1 bash deploy/deploy.sh`, para estrenar el rollback en frío y no la
mañana del 5 de agosto.

### La aplicación que ya está en Melisandre

Hay una aplicación desplegada y está autorizado retirarla. Aun así, lo primero al entrar es
**mirar antes de borrar**: qué unit de systemd corre, qué vhosts tiene nginx, qué escucha en
80/443 y en 3000, y si comparte la máquina con algo más. Después, en vez de un `rm -rf`, un
tarball fechado en `/var/backups/` y luego el retiro cuesta un minuto y convierte un borrado
irreversible en uno reversible. El inventario de lo encontrado se anota aquí antes de tocar
nada.

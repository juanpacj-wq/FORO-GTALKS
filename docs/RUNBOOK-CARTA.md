# Runbook: la carta de presentación digital en `cdp.gecelca.com.co`

Cómo se enciende el módulo `carta` en el servidor de producción, paso a paso y en orden. Los
valores reales (host de la BD, usuario, clave) **no están aquí**: viven en el `.env` de la estación
y en `/etc/gtalks/env` del servidor. Este archivo es público (el repo tiene remoto en GitHub).

Qué es el módulo, en tres líneas: `/carta_presentacion/<uuid>` es la tarjeta pública de una
persona (foto, cargo, contacto, redes, vCard, QR); `/cdpadmin` es el panel donde quien tenga el App
Role `LOGIN_JEFA` crea y edita esas tarjetas; los datos viven en el esquema `carta` de la base
`PortalG3` (SQL Server), y las fotos dentro de la base. Manual de seguridad:
`docs/SEGURIDAD.md` §La carta de presentación digital.

La doctrina que gobierna todo lo de abajo: **las cinco `DB_*` vacías = el módulo no existe; a
medias = el arranque aborta; completas = el servidor comprueba la BD y el esquema al arrancar y,
si el esquema no está al día, aborta**. Las migraciones **nunca** se aplican solas.

---

## 0. Antes de tocar nada

| Qué | Cómo se comprueba |
|---|---|
| El rol existe y está asignado | Entra → Enterprise App `LOGIN_G_TALKS` → Users and groups: la persona con `LOGIN_JEFA`. **No se crea nada**: ya existe. Tras un login suyo, journald muestra `[acceso] ok oid=… roles=[LOGIN_JEFA]`. |
| La estación alcanza el SQL Server | `node --env-file=.env scripts/carta-migrar.mjs --estado` contra `PortalG3_dev` responde con la lista de migraciones. |
| Los arneses en verde | `node scripts/carta-server-test.mjs` (puro) y `node --env-file=.env scripts/carta-db-test.mjs` (contra `_dev`, limpia lo que crea). |
| El estado a desplegar está commiteado | `git status` limpio en lo que viaja (`deploy.sh` empaqueta un COMMIT, nunca el árbol). |
| La estación alcanza el servidor por ssh | `ssh -p 22 uprod@<servidor> true` (VPN). Si no responde, todo lo de «Servidor» se hace a mano desde una consola con acceso, con los mismos comandos. |

## 1. Estación: aplicar el esquema en `PortalG3`

La base de producción no termina en `_dev`, así que el migrador exige la **doble llave**: el
nombre en el entorno **y** en la línea de comando.

```bash
DB_NAME=PortalG3 node --env-file=.env scripts/carta-migrar.mjs --estado
#   → 4 PENDIENTE (la primera vez)
DB_NAME=PortalG3 node --env-file=.env scripts/carta-migrar.mjs --confirmar --bd PortalG3
#   → aplica 001..004, cada una en su transacción, y anota su sha256 en carta.migracion
DB_NAME=PortalG3 node --env-file=.env scripts/carta-migrar.mjs --estado
#   → 0 pendientes, estado al_dia
```

Un segundo `--confirmar` no hace nada. Si alguna vez dice `SHA DISTINTO`, alguien editó una
migración ya aplicada: no se «arregla» la base, se escribe la migración siguiente.

## 2. Servidor: ¿llega al SQL Server?

```bash
timeout 3 bash -c '</dev/tcp/<DB_HOST>/1433' && echo alcanzable || echo BLOQUEADO
```

`BLOQUEADO` = detenerse aquí. Dos salidas: pedir a Redes la regla `<servidor> → <DB_HOST>:1433`
y esperar; o desplegar igual con las `DB_*` **vacías** (el foro sigue, la carta no existe, `/health`
dice `configurada:false`) y encender el módulo cuando la regla exista. Lo que **no** se hace es
poner las `DB_*` sin ruta: el servidor arrancaría degradado (`bd: no_disponible`, 503 en la carta)
y la matriz de salud lo tomaría por fallo y revertiría.

## 3. Servidor: el entorno

```bash
sudo nano /etc/gtalks/env
```

Añadir al final (los valores reales, del `.env` de la estación):

```
# ── Carta de presentación digital (esquema `carta` en SQL Server) ──
# Las 5 DB_* VACÍAS = el módulo no existe; a medias = el arranque ABORTA.
# Migraciones: SOLO con scripts/carta-migrar.mjs desde la estación.
DB_HOST=<host>
DB_PORT=1433
DB_NAME=PortalG3
DB_USER=<usuario>
DB_PASSWORD=<clave>
DB_TRUST_CERT=true          # certificado autofirmado del SQL Server; riesgo aceptado en docs/SEGURIDAD.md
CARTA_ROL_ADMIN=LOGIN_JEFA
CARTA_RATE_PUBLICO=1200
CARTA_RATE_ADMIN=600
CARTA_RATE_FOTO=60
```

Comprobar: `sudo grep -c '^DB_' /etc/gtalks/env` → `6`. **Sin `restart` todavía**: el servidor
nuevo llega con el despliegue del paso 5.

## 4. Servidor: nginx

El vhost del repo (`deploy/nginx/gtalks.conf`) trae el `location /api/carta/` nuevo: es la única
superficie que recibe cuerpos (fotos de hasta 5 MB) y métodos `PUT`/`DELETE`, que el `location /`
mata en el borde. Tras el despliegue del paso 5 el archivo estará en `/opt/gtalks/deploy/nginx/`:

```bash
sudo cp /opt/gtalks/deploy/nginx/gtalks.conf /etc/nginx/sites-available/gtalks
sudo nginx -t && sudo systemctl reload nginx
```

(Si se prefiere antes del despliegue, se pega a mano el bloque `location /api/carta/` delante de
`location /descargas/`.)

## 5. Estación: desplegar

```bash
bash deploy/deploy.sh
```

Lo que pasa dentro y que conviene saber: el paquete lleva el `package-lock.json` con
`@img/sharp-linux-x64` (el binario de Linux de `sharp`, sin scripts de instalación); al arrancar,
el servidor **auto-comprueba sharp**, conecta con la BD y comprueba las migraciones; la matriz de
salud exige `carta: bd ok`, `migraciones al_dia`, `401` en el panel y `404` en una tarjeta que no
existe. Si algo de eso falla, **revierte solo** a la generación anterior.

Si nginx se actualizó después del despliegue (paso 4 en ese orden), correr el `cp` + `reload` ahora.

## 6. Servidor: salud a mano

```bash
R='--resolve cdp.gecelca.com.co:443:127.0.0.1'
curl -s -o /dev/null -w '%{http_code}\n' $R -H 'Sec-Fetch-Dest: empty' -H 'Sec-Fetch-Mode: cors' https://cdp.gecelca.com.co/api/carta/admin/perfiles      # 401
curl -s -o /dev/null -w '%{http_code}\n' $R https://cdp.gecelca.com.co/api/carta/perfiles/00000000-0000-4000-8000-000000000000              # 404
curl -s -o /dev/null -w '%{http_code}\n' $R -X PUT https://cdp.gecelca.com.co/api/carta/admin/perfiles/00000000-0000-4000-8000-000000000000 # 403 (CSRF, sin Origin)
curl -s http://127.0.0.1:3000/health | grep -o '"carta":{[^}]*}'    # "configurada":true,"bd":"ok","migraciones":"al_dia"
cd /opt/gtalks && node --input-type=module -e "import('sharp').then(s=>console.log(s.default.versions))"
journalctl -u gtalks -n 40 | grep -i carta
#   [carta] activa · bd ok · 4 migraciones al día · rol LOGIN_JEFA · sharp … libvips …
```

## 7. Navegador: la primera tarjeta

1. La persona con el rol entra por `https://cdp.gecelca.com.co/cdpadmin` → «Iniciar sesión con
   Microsoft». Al volver ve el panel (si ve el botón retenido «Tu cuenta no tiene el permiso…», el
   rol aún no llegó a su sesión: cerrar sesión y volver a entrar trae un `id_token` nuevo).
2. «Nueva carta» → nombre, cargo, correo y lo demás → Guardar. Subir la foto. Descargar el QR
   (PNG para imprimir, SVG para diseño).
3. Escanear el QR desde un teléfono **con datos móviles** (dentro de GECELCA, Chrome con DNS
   sobre HTTPS falla por certificado y NO es el servidor: memoria `dns-partido-cdp-chrome-doh`).
   Debe abrir la tarjeta con foto, nombre, «Llamar», «Escribir», «Guardar contacto».
4. Compartir el enlace por Teams o WhatsApp: la vista previa sale con el nombre, el cargo y la
   foto (Open Graph dinámico).
5. Desactivar la tarjeta desde el panel → el enlace muestra «Esta tarjeta no está disponible».
   Reactivar.

## 8. Diagnóstico

| Síntoma | Dónde mirar |
|---|---|
| La carta contesta 503 | `journalctl -u gtalks -n 80 \| grep -i carta`: `[carta/bd] …` dice el código (ETIMEOUT = red, ELOGIN = credenciales). El foro sigue vivo; el pool reintenta solo cada 5 s. |
| 413 o 405 al subir una foto | `/var/log/nginx/gtalks.error.log`: es el borde (`client_max_body_size` o `limit_except` del `location /api/carta/`). |
| El panel dice «Sin permiso» a quien tiene el rol | La sesión aprende los roles al entrar y cada 20 min (`revalidate`). Cerrar sesión y volver a entrar. Comprobar la asignación en la Enterprise App. |
| El buscador del directorio no aparece, o dice que no responde | No aparece = el servidor no tiene `M365_*` (sin credenciales de Graph no existe). «No responde» = `journalctl` muestra `[carta/directorio] Graph respondió 403` (falta `User.Read.All` de aplicación) o un timeout de red. La carta se escribe a mano mientras tanto. |
| Un 500 en `/api/carta/*` | `journalctl -u gtalks -n 80 \| grep '\[carta\] error no mapeado'`: la línea trae método, ruta, nombre del error y códigos. Es un fallo que el mapa de errores no conoce; pegar esa línea al reportar. |
| ¿Quién cambió qué? | `SELECT TOP 20 ts, actor_upn, accion, perfil_id, detalle FROM carta.auditoria ORDER BY ts DESC` (el detalle dice QUÉ campos, nunca sus valores). |
| El arranque aborta con «esquema no está al día» | Paso 1 no se hizo, o se hizo contra `_dev`. Correrlo contra `PortalG3` y reiniciar. |

## Rotar la clave de la BD

Cambiar la clave en el SQL Server, actualizar `DB_PASSWORD` en `/etc/gtalks/env` y en el `.env`
de la estación, `sudo systemctl restart gtalks`, y comprobar `/health` → `bd: ok`. El pool no
guarda la clave en ningún archivo del repo ni la escribe en logs.

## Fuera de alcance (anotado en `docs/PENDIENTES-DE-CONTENIDO.md`)

- Importar los perfiles de la app anterior (`/var/backups/comunicaciones-datos-2026-07-31.tgz`).
- Una cuenta de BD acotada al esquema `carta` (hoy es `db_owner` de `PortalG3`).
- Instalar la CA del SQL Server para poner `DB_TRUST_CERT=false`.

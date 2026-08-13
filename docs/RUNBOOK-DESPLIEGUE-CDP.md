# Runbook: despliegue limpio en `cdp.gecelca.com.co`

Este documento deja el Foro G-TALKS desplegado en un servidor Ubuntu **retirando antes lo que
haya en él**. Está escrito para ejecutarse **copiando y pegando cada bloque, en orden**, en una
terminal del servidor. Solo dos bloques piden editar una línea antes de pegar (están marcados
con `← EDITA`); todo lo demás va tal cual.

Contexto que asume este runbook, y que si cambia hay que revisar antes de pegar nada:

- Servidor **Ubuntu 22.04/24.04 dedicado** a este foro: lo que haya corriendo se puede retirar.
- El servidor **tiene salida a internet** (github.com y registry.npmjs.org): clona y compila solo.
- El dominio es **`cdp.gecelca.com.co`** y los **certificados de CA comercial** ya están copiados
  en el servidor (`certificate.crt`, `ca_bundle.crt`, `private.key`). Son **lo único que se
  preserva** del despliegue anterior.
- El repositorio es público: `https://github.com/juanpacj-wq/FORO-GTALKS` (rama `main`).

> Los documentos históricos (`docs/DESPLIEGUE.md`, `docs/SEGURIDAD.md`) mencionan el dominio
> `gtalks.gecelca.com.co` y certbot: era el plan original. **Manda este runbook**: el dominio es
> `cdp.gecelca.com.co` y el TLS es manual. Todo lo demás de esos documentos (arquitectura,
> seguridad, operación) sigue vigente.

---

## Fase 0  Prerrequisitos (antes de tocar el servidor)

Ninguno de estos pasos es en el servidor. Sin ellos el sitio público funcionará, pero el botón
de la escarapela fallará con `AADSTS50011` (redirect URI no registrada).

- [X] **Entra ID  App Registration del login** (Azure Portal → Microsoft Entra ID →
  App registrations → la app del foro → **Authentication** → plataforma **Web**): agregar
  `https://cdp.gecelca.com.co/auth/redirect` como redirect URI y
  `https://cdp.gecelca.com.co/` como post-logout redirect URI.
- [X] **Enterprise App**: «Asignación requerida = Sí» con los usuarios/grupos del foro asignados
  (el grupo de seguridad del evento). Eso no el código decide quién puede iniciar sesión.
- [X] **Código publicado**: el commit que quieres desplegar está en `main` de GitHub
  (`git push origin main` hecho desde la estación). El servidor clona `main`: lo que no esté
  ahí, no existe para este runbook.
- [X] **A la mano** (los pegarás en la Fase 7): `M365_TENANT_ID`, `M365_CLIENT_ID`,
  `M365_CLIENT_SECRET`.

---

## Fase 1  Inventario: mirar antes de borrar

Imprime qué corre hoy en el servidor. **Anota** los nombres de los servicios de la aplicación
vieja (los usarás en la Fase 4) y confirma que nada de lo que veas te sorprende.

```bash
cat /etc/os-release | head -2
echo "── Servicios corriendo ──"
systemctl list-units --type=service --state=running --no-pager
echo "── vhosts de nginx habilitados ──"
ls -la /etc/nginx/sites-enabled/ 2>/dev/null || echo "(sin nginx)"
echo "── Qué escucha en qué puerto ──"
sudo ss -tlnp
echo "── Código en las raíces habituales ──"
ls -la /opt /srv /var/www 2>/dev/null
echo "── Docker / pm2, si existen ──"
command -v docker >/dev/null 2>&1 && sudo docker ps -a || echo "(sin docker)"
command -v pm2 >/dev/null 2>&1 && pm2 list || echo "(sin pm2)"
echo "── Tareas programadas ──"
sudo crontab -l 2>/dev/null || echo "(root sin crontab)"
crontab -l 2>/dev/null || echo "(este usuario sin crontab)"
ls /etc/cron.d/ 2>/dev/null
```

---

## Fase 2  Respaldo fechado: el borrado, reversible

Un tarball en `/var/backups/` convierte el retiro irreversible en uno reversible. Cuesta un
minuto y no se borra nunca durante este runbook.

```bash
sudo tar --ignore-failed-read --exclude='*/node_modules' -czf \
  "/var/backups/retiro-$(date +%F).tgz" \
  /opt /srv /var/www /etc/nginx/sites-available /etc/systemd/system 2>/dev/null
ls -lh /var/backups/retiro-*.tgz
sudo tar -tzf "/var/backups/retiro-$(date +%F).tgz" | head -20
```

---

## Fase 3  Certificados: localizarlos y asegurarlos ANTES del retiro

Los tres archivos ya están en el servidor, pero hay que dejarlos en su sitio definitivo
(`/etc/ssl/gtalks/`) **antes** de arrasar directorios. Primero, encuéntralos:

```bash
sudo find / -xdev \( -name certificate.crt -o -name ca_bundle.crt -o -name private.key \) \
  -not -path '/etc/ssl/gtalks/*' 2>/dev/null
```

Con la carpeta donde aparecieron, edita la primera línea y pega el bloque. Construye además
`fullchain.pem` (la hoja **primero**, la cadena de la CA **después**  el orden importa: nginx
envía el archivo tal cual y los navegadores esperan la hoja de primera):

```bash
CERT_ORIGEN=/etc/ssl/comunicaciones/private.key   # ← EDITA con la carpeta del find de arriba
sudo bash -euo pipefail <<FIN
install -m 0755 -d /etc/ssl/gtalks
install -m 0644 "$CERT_ORIGEN/certificate.crt" /etc/ssl/gtalks/certificate.crt
install -m 0644 "$CERT_ORIGEN/ca_bundle.crt"   /etc/ssl/gtalks/ca_bundle.crt
install -m 0600 "$CERT_ORIGEN/private.key"     /etc/ssl/gtalks/private.key
{ cat /etc/ssl/gtalks/certificate.crt; echo; cat /etc/ssl/gtalks/ca_bundle.crt; } \
  > /etc/ssl/gtalks/fullchain.pem
chmod 0644 /etc/ssl/gtalks/fullchain.pem
FIN
ls -l /etc/ssl/gtalks/
```

Verifica las tres cosas que pueden estar mal: que el certificado sea de `cdp.gecelca.com.co` y
esté vigente, que la llave privada **corresponda** a ese certificado, y que la cadena de la CA
lo valide:

```bash
openssl x509 -noout -subject -issuer -dates -in /etc/ssl/gtalks/certificate.crt
diff <(openssl x509 -in /etc/ssl/gtalks/certificate.crt -pubkey -noout) \
     <(sudo openssl pkey -in /etc/ssl/gtalks/private.key -pubout) \
  && echo "OK: la llave corresponde al certificado"
openssl verify -CAfile /etc/ssl/gtalks/ca_bundle.crt /etc/ssl/gtalks/certificate.crt
```

Si alguna de las tres falla, **detente aquí**: con TLS roto el resto del runbook termina en un
sitio caído.

---

## Fase 4  Retiro de la aplicación vieja

El único bloque con edición obligatoria: pega en la primera línea los nombres de los servicios
de la app vieja que anotaste en la Fase 1 (separados por espacio, sin el sufijo `.service`).
El bloque **no toca** `/etc/ssl/gtalks/` ni `/var/backups/`.

```bash
SERVICIOS_VIEJOS="nombre-servicio-1 nombre-servicio-2"   # ← EDITA con lo de la Fase 1
for s in $SERVICIOS_VIEJOS; do
  sudo systemctl disable --now "$s" 2>/dev/null || true
  sudo rm -f "/etc/systemd/system/$s.service"
done
sudo systemctl daemon-reload
sudo systemctl reset-failed 2>/dev/null || true

# Si apache estaba sirviendo el 80/443, estorbaría a nginx:
systemctl is-active apache2 >/dev/null 2>&1 && sudo systemctl disable --now apache2 || true

# vhosts de nginx (incluido el default) y el código viejo:
sudo rm -f /etc/nginx/sites-enabled/*
sudo rm -rf /opt/* /srv/* /var/www/*

# Solo si la Fase 1 mostró docker o pm2:
command -v docker >/dev/null 2>&1 && { sudo docker ps -aq | xargs -r sudo docker rm -f; sudo docker system prune -af; } || true
command -v pm2 >/dev/null 2>&1 && { pm2 delete all 2>/dev/null; pm2 unstartup 2>/dev/null; } || true
```

Si la Fase 1 mostró crontabs de la app vieja, retíralos a mano (`sudo crontab -e`, o borrar el
archivo correspondiente en `/etc/cron.d/`): un cron huérfano apuntando a código borrado no rompe
nada, pero ensucia los logs para siempre.

---

## Fase 5  Base del sistema: nginx, git, Node, ufw

`docs/DESPLIEGUE.md` pedía Node 20, pero Node 20 salió de mantenimiento en abril de 2026; el
proyecto exige `>=20` (`package.json` → `engines`), así que se instala la LTS vigente (22).

```bash
sudo apt-get update && sudo apt-get -y upgrade
sudo apt-get -y install nginx git curl ufw ca-certificates
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get -y install nodejs
node --version    # se espera v22.x
nginx -v
```

---

## Fase 6  Usuario de servicio y directorios

La secuencia de `docs/DESPLIEGUE.md` §Puesta en marcha: usuario de sistema sin shell, el log de
asistencia con su dueño, y el directorio de secretos cerrado (`0700`). El estado del correo de
inscripción (`/var/lib/gtalks/`) no se crea aquí: lo crea systemd con `StateDirectory`.

```bash
sudo adduser --system --group --home /opt/gtalks gtalks 2>/dev/null || echo "(el usuario gtalks ya existía)"
sudo mkdir -p /var/log/gtalks /var/backups/gtalks
sudo chown gtalks:gtalks /var/log/gtalks
sudo install -m 0700 -d /etc/gtalks
```

---

## Fase 7  Secretos: `/etc/gtalks/env`

Los secretos viven fuera del repo, en `0600 root:root`; systemd los lee como PID 1 antes de
bajar privilegios, así que ni un `git pull` ni el propio proceso pueden tocarlos. El bloque
escribe la plantilla completa y genera `SESSION_SECRET` al vuelo; después **rellena los tres
`M365_*` con nano**  es el único paso del runbook que no es pegar a ciegas.

`NODE_ENV` no va aquí: lo pone la unit de systemd.

```bash
sudo tee /etc/gtalks/env >/dev/null <<'FIN'
# Entorno de producción del Foro G-TALKS  0600 root:root.
# Lo lee systemd (EnvironmentFile) como PID 1. Tras editar: sudo systemctl restart gtalks

# ── Identidad Entra ID (App Registration del login) ──
M365_TENANT_ID=PEGA_AQUI_EL_TENANT_ID
M365_CLIENT_ID=PEGA_AQUI_EL_CLIENT_ID
M365_CLIENT_SECRET=PEGA_AQUI_EL_CLIENT_SECRET
M365_REDIRECT_URI=https://cdp.gecelca.com.co/auth/redirect
M365_POST_LOGOUT_REDIRECT_URI=https://cdp.gecelca.com.co/
M365_SCOPES=openid profile email offline_access User.Read

# ── Origen público (referencia del chequeo CSRF; debe ser https) ──
PUBLIC_ORIGIN=https://cdp.gecelca.com.co

# ── Sesión ──
SESSION_SECRET=SE_GENERA_EN_EL_SIGUIENTE_PASO
SESSION_COOKIE_NAME=puertadeoro.sid
SESSION_MAX_AGE_MS=28800000
SESSION_VIDA_ABSOLUTA_MS=43200000
SESSION_PRELOGIN_MS=600000

# ── Límite de tasa de /auth/*  es un DIAL: el día del evento se sube (p. ej. 1000) ──
AUTH_RATE_LIMIT=300

# ── Registro de asistencia (JSONL con UPN; rota con logrotate, 12 semanas) ──
AUDIT_LOG_PATH=/var/log/gtalks/acceso.log

# ── Correo de inscripción  apagado hasta que se decida encenderlo (ver el cierre
#    del runbook). El libro NO es un log y NUNCA se rota. ──
INSCRIPCION_MODO=off
INSCRIPCION_DESTINATARIOS=
INSCRIPCION_REMITENTE=
INSCRIPCION_LIBRO=/var/lib/gtalks/inscripciones.jsonl
MAIL_TENANT_ID=
MAIL_CLIENT_ID=
MAIL_CLIENT_SECRET=

# ── Certificados de participación  vacío hasta subirlos con
#    deploy/certificados-subir.sh; a medias, el arranque aborta. Los PDF viven
#    fuera de /opt/gtalks para sobrevivir a los despliegues, como el libro.
#    Tras cada subida: systemctl restart gtalks (el manifiesto se carga al arrancar). ──
CERTIFICADOS_DIR=

# ── Servidor: solo loopback; nginx es el único que le habla ──
SERVER_PORT=3000
SERVER_HOST=127.0.0.1
FIN
sudo chmod 0600 /etc/gtalks/env
sudo sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -hex 32)|" /etc/gtalks/env
```

Ahora los tres `M365_*` reales:

```bash
sudo nano /etc/gtalks/env
```

Y comprueba que no quedó ningún placeholder:

```bash
sudo grep -n 'PEGA_AQUI\|SE_GENERA' /etc/gtalks/env && echo '⚠ FALTAN VALORES: vuelve a nano' || echo 'OK: sin placeholders'
```

---

## Fase 8  Código: clonar, compilar, podar, colocar

La misma receta que usa `deploy/deploy.sh`: `npm ci` reproducible desde el lockfile, build
completo (tsc + vite), poda de dependencias de desarrollo y entrega a `/opt/gtalks` con dueño
`gtalks:gtalks`. Se compila en un directorio de staging: si algo falla, `/opt/gtalks` ni se toca.

```bash
sudo bash -euo pipefail <<'FIN'
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
STAGE=/opt/gtalks.stage-inicial
rm -rf "$STAGE"
git clone --branch main --depth 1 https://github.com/juanpacj-wq/FORO-GTALKS.git "$STAGE"
cd "$STAGE"
echo "── Commit que se despliega:"
git log -1 --format='%h %s (%ci)'
SHA=$(git rev-parse HEAD)
npm ci --ignore-scripts --no-audit --no-fund
npm run build
[ -f dist/index.html ] || { echo "FALTA dist/index.html: el build no produjo el sitio"; exit 1; }
npm prune --omit=dev
rm -rf "$STAGE/.git"    # se despliega un commit, no un repositorio
chown -R gtalks:gtalks "$STAGE"
if [ -d /opt/gtalks ]; then rm -rf /opt/gtalks.prev; mv /opt/gtalks /opt/gtalks.prev; fi
mv "$STAGE" /opt/gtalks
printf '{"fecha":"%s","sha":"%s","ref":"main","operador":"runbook-inicial","resultado":"OK"}\n' \
  "$(date -Is)" "$SHA" > /var/backups/gtalks/deploy-actual.json
echo "── Desplegado $SHA en /opt/gtalks"
FIN
```

---

## Fase 9  systemd: la unit del servicio

```bash
sudo cp /opt/gtalks/deploy/systemd/gtalks.service /etc/systemd/system/gtalks.service
sudo systemctl daemon-reload
sudo systemctl enable --now gtalks
sleep 2
systemctl status gtalks --no-pager -l | head -15
```

Si el estado no es `active (running)`, el propio arranque dice qué le falta (aborta listando
las variables ausentes de `/etc/gtalks/env`):

```bash
journalctl -u gtalks -n 80 --no-pager
```

---

## Fase 10  nginx: el vhost

El vhost viene **ya adaptado en el repo** (dominio `cdp.gecelca.com.co` y rutas de
`/etc/ssl/gtalks/`): se copia, no se edita.

```bash
sudo cp /opt/gtalks/deploy/nginx/gtalks.conf /etc/nginx/sites-available/gtalks
sudo ln -sf /etc/nginx/sites-available/gtalks /etc/nginx/sites-enabled/gtalks
sudo rm -f /etc/nginx/sites-enabled/default   # apt lo recrea al instalar nginx
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
```

---

## Fase 11  logrotate: el registro de asistencia

Rota **solo** `/var/log/gtalks/acceso.log` (12 semanas ≈ 90 días). El libro de inscripciones
vive en `/var/lib/gtalks/` justamente para quedar fuera de esto.

```bash
sudo cp /opt/gtalks/deploy/logrotate/gtalks /etc/logrotate.d/gtalks
sudo logrotate -d /etc/logrotate.d/gtalks 2>&1 | tail -5   # ensayo en seco, no rota nada
```

---

## Fase 12  Firewall

⚠ **Antes de encender ufw, confirma el puerto de SSH**: si va por uno no estándar y no lo
permites, la próxima desconexión es un viaje al datacenter.

```bash
sudo ss -tlnp | grep -i sshd    # ¿en qué puerto escucha sshd?
```

```bash
sudo ufw allow OpenSSH          # si sshd va por OTRO puerto: sudo ufw allow <puerto>/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status verbose
```

---

## Fase 13  Matriz de salud

La misma que usa `deploy.sh` para decidir un rollback. Lo innegociable no es el 200: es que la
portada salga **con su CSP** y que `/api/me` siga en **401** sin sesión (la identidad, cerrada).
Se prueba a través de nginx con `--resolve` para no depender del DNS del servidor  y de paso,
si la cadena TLS quedó mal armada en la Fase 3, estos mismos `curl` fallarán por certificado.

**Ojo con las cabeceras**: `esNavegacion()` (server/app.js) exige `Sec-Fetch-Mode: navigate`
**y** `Sec-Fetch-Dest: document` a la vez. Con una sola, la portada responde el 404 JSON de
subrecursos  que es lo correcto, pero no es lo que esta matriz mide. Salió en el primer
despliegue real: un `curl` solo con `Dest` daba 404 con la app perfectamente sana.

```bash
curl -s -o /dev/null -w 'health (interno)   : %{http_code}   (se espera 200)\n' http://127.0.0.1:3000/health
curl -s -o /dev/null --resolve cdp.gecelca.com.co:443:127.0.0.1 \
  -H 'Sec-Fetch-Dest: document' -H 'Sec-Fetch-Mode: navigate' \
  -w 'portada por nginx  : %{http_code}   (se espera 200)\n' https://cdp.gecelca.com.co/
echo "CSP en la portada  : $(curl -s -I --resolve cdp.gecelca.com.co:443:127.0.0.1 \
  -H 'Sec-Fetch-Dest: document' -H 'Sec-Fetch-Mode: navigate' \
  https://cdp.gecelca.com.co/ | grep -ic content-security-policy)   (se espera 1)"
curl -s -o /dev/null --resolve cdp.gecelca.com.co:443:127.0.0.1 \
  -H 'Sec-Fetch-Dest: empty' -H 'Sec-Fetch-Mode: cors' \
  -w 'api/me sin sesión  : %{http_code}   (se espera 401  lo innegociable)\n' https://cdp.gecelca.com.co/api/me
curl -s -o /dev/null --resolve cdp.gecelca.com.co:443:127.0.0.1 \
  -H 'Sec-Fetch-Dest: document' -H 'Sec-Fetch-Mode: navigate' \
  -w 'auth/login         : %{http_code}   (se espera 302)\n' https://cdp.gecelca.com.co/auth/login
echo "login redirige a   : $(curl -s -I --resolve cdp.gecelca.com.co:443:127.0.0.1 \
  -H 'Sec-Fetch-Dest: document' -H 'Sec-Fetch-Mode: navigate' \
  https://cdp.gecelca.com.co/auth/login | grep -i '^location' | head -1)"
echo "── Certificado que sirve nginx:"
echo | openssl s_client -connect 127.0.0.1:443 -servername cdp.gecelca.com.co 2>/dev/null \
  | openssl x509 -noout -subject -dates
```

El `location` debe apuntar a `login.microsoftonline.com`. Y las dos comprobaciones que solo se
pueden hacer **desde tu navegador**, con el DNS real:

1. Navegar `https://cdp.gecelca.com.co/`  el sitio entero, sin candado roto.
2. `https://cdp.gecelca.com.co/escarapela` → **Iniciar sesión** → login corporativo → el carné
   pinta tu nombre y cargo. (Si cae con `AADSTS50011`, es la Fase 0: la redirect URI.)

Con esto en verde, el despliegue está terminado.

---

## Redespliegues futuros

Para publicar un commit nuevo (ya pusheado a `main`), el mismo bloque de la Fase 8 con swap y
respaldo de la generación anterior:

```bash
sudo bash -euo pipefail <<'FIN'
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
STAGE=/opt/gtalks.stage-manual
rm -rf "$STAGE"
git clone --branch main --depth 1 https://github.com/juanpacj-wq/FORO-GTALKS.git "$STAGE"
cd "$STAGE"
git log -1 --format='── Desplegando: %h %s (%ci)'
SHA=$(git rev-parse HEAD)
npm ci --ignore-scripts --no-audit --no-fund
npm run build
[ -f dist/index.html ] || { echo "FALTA dist/index.html"; exit 1; }
npm prune --omit=dev
rm -rf "$STAGE/.git"
chown -R gtalks:gtalks "$STAGE"
rm -rf /opt/gtalks.prev
mv /opt/gtalks /opt/gtalks.prev
mv "$STAGE" /opt/gtalks
systemctl restart gtalks
printf '{"fecha":"%s","sha":"%s","ref":"main","operador":"runbook-redeploy","resultado":"OK"}\n' \
  "$(date -Is)" "$SHA" > /var/backups/gtalks/deploy-actual.json
FIN
```

…seguido **siempre** de la matriz de salud (Fase 13). Si la matriz falla, el rollback es
deshacer el intercambio:

```bash
sudo bash -euo pipefail <<'FIN'
[ -d /opt/gtalks.prev ] || { echo "No hay generación anterior: no hay a dónde volver"; exit 1; }
mv /opt/gtalks /opt/gtalks.fallido
mv /opt/gtalks.prev /opt/gtalks
systemctl restart gtalks
echo "── Rollback hecho; el intento fallido quedó en /opt/gtalks.fallido para autopsia"
FIN
```

Dos notas:

- Si el commit nuevo cambió `deploy/nginx/gtalks.conf`, `deploy/systemd/gtalks.service` o
  `deploy/logrotate/gtalks`, esos **no** se aplican solos: repite el `cp` de las Fases 9-11
  correspondientes (`nginx -t` antes de recargar).
- Cuando la estación de trabajo tenga SSH hacia el servidor, el camino preferente es
  `bash deploy/deploy.sh` desde el repo (con `deploy/deploy.env` apuntando aquí): hace esto
  mismo con journal de auditoría, verificación de checksum y rollback automático.

---

## Después del despliegue

- **Encender el correo de inscripción** (cuando Comunicaciones lo decida): en
  `/etc/gtalks/env`, `INSCRIPCION_MODO=simulacro` con `INSCRIPCION_DESTINATARIOS` (tu correo)
  e `INSCRIPCION_REMITENTE` puestos → `sudo systemctl restart gtalks` → probar un login →
  revisar `/var/lib/gtalks/inscripciones.jsonl.simulacro`. Después `INSCRIPCION_MODO=lista`
  para el piloto real, y abrir a `todos` exige cambiar **dos** variables (el modo **y** vaciar
  la lista). El libro (`/var/lib/gtalks/inscripciones.jsonl`) **no se borra ni se rota jamás**:
  truncarlo haría que el correo saliera otra vez a todo el mundo.
- **El día del evento**: subir el dial `AUTH_RATE_LIMIT` (p. ej. a `1000`) en `/etc/gtalks/env`
  y `sudo systemctl restart gtalks`; volver a bajarlo al día siguiente. Todo el auditorio entra
  por el NAT corporativo con una sola IP.
- **Diagnóstico rápido**: `journalctl -u gtalks -n 80 --no-pager` (la app),
  `sudo tail /var/log/nginx/gtalks.error.log` (el borde),
  `sudo cat /var/backups/gtalks/deploy-actual.json` (qué commit está desplegado).
- **Manual de guardia**: `docs/SEGURIDAD.md` (incidentes, rotación de secretos, ciclo anual).

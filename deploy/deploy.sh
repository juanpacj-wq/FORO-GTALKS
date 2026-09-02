#!/usr/bin/env bash
# Deploy del foro G-TALKS HEAD-only y auditable.
#
# Mismo contrato que el del proyecto hermano (PORTALES GECELCA/sitio/deploy/deploy.sh),
# adaptado de WordPress a una SPA compilada servida por un Express con identidad Entra:
#
#   · Publica EXACTAMENTE un commit, jamás el árbol de trabajo. El paquete sale de
#     `git archive`, que fija los mtimes a la fecha del commit y ordena las entradas
#     con `gzip -n` el stream es byte-idéntico entre corridas, así que el SHA-256
#     identifica el despliegue de forma reproducible y el servidor lo re-verifica.
#   · La compilación ocurre EN EL SERVIDOR, dentro de un directorio de staging. Si
#     `npm ci` o `npm run build` fallan, el sitio vivo no se tocó: no hay ventana mala.
#   · El reemplazo es un intercambio por renames con la generación anterior guardada
#     al lado (rollback instantáneo).
#   · Cada deploy queda en un journal append-only en el servidor: quién, cuándo, qué
#     SHA, qué checksum, resultado.
#   · La comprobación de salud verifica que el sitio (público) está de pie, que el HTML
#     sale con su CSP, y que la identidad (/api/me) SIGUE CERRADA. Si falla, revierte sola.
#
# Uso (desde la raíz de "EVENTO PUERTA DE ORO"):
#   bash deploy/deploy.sh              # despliega HEAD
#   bash deploy/deploy.sh <ref|sha>    # despliega ese commit (= rollback auditable)
#   bash deploy/deploy.sh --estado     # qué commit está desplegado vs HEAD local
#
# Requisitos del servidor: Node 20 + npm, salida al registro de npm, y sudo para el
# usuario del despliegue. Ver docs/DESPLIEGUE.md.
#
# Gancho de prueba: GT_DEPLOY_SIMULAR_FALLO=1 fuerza la rama de rollback (ensayo).
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$DIR/.." && pwd)"

# ---- Configuración: deploy/deploy.env, con el entorno pisando al archivo ---------
if [ -f "$DIR/deploy.env" ]; then
	# shellcheck disable=SC1091
	. "$DIR/deploy.env"
fi

falta() { echo "ERROR: falta $1. Copia deploy/deploy.env.example a deploy/deploy.env y llénalo." >&2; exit 1; }
[ -n "${GTALKS_SSH_HOST:-}" ] || falta GTALKS_SSH_HOST
[ -n "${GTALKS_APP_DIR:-}" ]  || falta GTALKS_APP_DIR

PORT="${GTALKS_SSH_PORT:-22}"
KEY="${GTALKS_SSH_KEY:-$HOME/.ssh/id_ed25519}"
APP="${GTALKS_APP_DIR%/}"
SERVICIO="${GTALKS_SERVICIO:-gtalks}"
USR_SVC="${GTALKS_USUARIO_SERVICIO:-gtalks}"
APP_PORT="${GTALKS_PORT:-3000}"
URL_PUBLICA="${GTALKS_URL:-}"

PREV="$APP.prev"
BACKUPS="/var/backups/gtalks"
JOURNAL="$BACKUPS/deploy-journal.log"
ESTADO_JSON="$BACKUPS/deploy-actual.json"

# BatchMode=yes: si la llave no sirve, falla en el acto. Sin él, ssh pediría contraseña
# y el script se quedaría colgado esperando a un humano que no está mirando.
SSH=(ssh -p "$PORT" -i "$KEY" -o BatchMode=yes "$GTALKS_SSH_HOST")

# ---- Subcomando de auditoría: ¿qué hay desplegado? ------------------------------
if [ "${1:-}" = "--estado" ]; then
	echo "== Estado del despliegue =="
	echo "HEAD local:  $(git -C "$RAIZ" rev-parse HEAD)"
	echo -n "Servidor:    "
	"${SSH[@]}" "sudo cat $ESTADO_JSON 2>/dev/null || echo '(sin registro ningún deploy con journal todavía)'"
	echo -n "Servicio:    "
	"${SSH[@]}" "systemctl is-active $SERVICIO 2>/dev/null || true"
	exit 0
fi

# ---- 1. Resolver el commit a publicar -------------------------------------------
REF="${1:-HEAD}"
SHA="$(git -C "$RAIZ" rev-parse --verify "$REF^{commit}")" ||
	{ echo "ERROR: '$REF' no resuelve a un commit." >&2; exit 1; }
SHA_CORTO="${SHA:0:10}"
# El staging lleva el SHA: el `flock` serializa cada fase, pero no la transacción entera
# (compilar y promover son dos sesiones SSH distintas). Con un nombre por commit, un
# segundo deploy no puede borrar el staging de uno que va a medias.
STAGE="$APP.stage-$SHA_CORTO"
OPERADOR="$(whoami)@$(hostname)"
FECHA="$(date +%Y-%m-%dT%H:%M:%S%z)"

echo "==> Desplegando commit $SHA_CORTO (ref: $REF)"

# Lo no commiteado NO viaja al servidor. Se advierte y se sigue: abortar por un
# archivo suelto obliga a commitear basura solo para poder desplegar.
SUCIO="$(git -C "$RAIZ" status --porcelain -- src server public index.html vite.config.ts package.json package-lock.json deploy || true)"
if [ -n "$SUCIO" ]; then
	echo "   ADVERTENCIA: cambios sin commitear que NO se despliegan:"
	echo "$SUCIO" | sed 's/^/     /'
fi

# ---- 2. Paquete determinista + checksum -----------------------------------------
# core.autocrlf=false + core.eol=lf: esta estación es Windows y el servidor es Linux.
# Sin esto, `git archive` metería CRLF en los .js del gate y en los .sh, y bash en el
# servidor fallaría con un `\r` invisible al final de cada línea.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PACK="$TMP/pack.tgz"
git -C "$RAIZ" -c core.autocrlf=false -c core.eol=lf archive "$SHA" | gzip -n > "$PACK"
CHECKSUM="$(sha256sum < "$PACK" | cut -d' ' -f1)"
echo "   paquete: $(du -h "$PACK" | cut -f1) | sha256 $CHECKSUM"

# ---- 3. Transferencia con verificación de integridad ----------------------------
echo "==> Transfiriendo paquete"
CHK_REMOTO="$("${SSH[@]}" "cat > /tmp/gtalks-deploy-pack.tgz && sha256sum /tmp/gtalks-deploy-pack.tgz | cut -d' ' -f1" < "$PACK")"
if [ "$CHK_REMOTO" != "$CHECKSUM" ]; then
	echo "ERROR: checksum remoto ($CHK_REMOTO) != local ($CHECKSUM) transferencia corrupta, no se toca nada." >&2
	exit 1
fi
echo "   integridad verificada en el servidor"

# ---- 4. Compilación en staging (el sitio vivo no se toca todavía) ---------------
# `npm ci --ignore-scripts`: el lockfile es el pin (convención del repo) y los scripts
# de instalación se saltan a propósito `playwright` es devDependency y su postinstall
# se bajaría los navegadores, ~100 MB de Chromium que el servidor no necesita jamás.
# Ninguna dependencia de ejecución (express, helmet, msal-node) necesita postinstall.
#
# NODE_ENV se limpia para el `npm ci` de compilación: con NODE_ENV=production, npm
# omite las devDependencies y `vite` no existiría cuando toca compilar.
echo "==> Compilando en el servidor (staging)"
"${SSH[@]}" "sudo flock -w 900 /var/lock/gtalks-deploy.lock bash -euo pipefail -s '$CHECKSUM' '$APP' '$STAGE' '$USR_SVC'" <<'REMOTO'
CHECKSUM="$1"; APP="$2"; STAGE="$3"; USR_SVC="$4"
PACK=/tmp/gtalks-deploy-pack.tgz

echo "$CHECKSUM  $PACK" | sha256sum -c - >/dev/null    # re-verificación independiente

rm -rf "$STAGE"
mkdir -p "$STAGE"
tar -xz -C "$STAGE" < "$PACK"
rm -f "$PACK"

if [ ! -f "$STAGE/package-lock.json" ] || [ ! -f "$STAGE/server/index.js" ]; then
	echo "ERROR: el paquete no trae package-lock.json + server/index.js" >&2
	rm -rf "$STAGE"
	exit 1
fi

cd "$STAGE"
unset NODE_ENV
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
echo "   npm ci (con devDependencies, sin scripts de instalación)"
npm ci --ignore-scripts --no-audit --no-fund >/dev/null
echo "   npm run build (tsc --noEmit + vite build)"
npm run build >/dev/null
[ -f "$STAGE/dist/index.html" ] || { echo "ERROR: la compilación no produjo dist/index.html" >&2; exit 1; }

# Poda a dependencias de ejecución: vite, typescript y playwright no tienen por qué
# quedarse en el servidor. Menos superficie y menos avisos de npm audit que atender.
echo "   npm prune --omit=dev"
npm prune --omit=dev --no-audit --no-fund >/dev/null

chown -R "$USR_SVC":"$USR_SVC" "$STAGE"

# Barrido de staging huérfano: un build que falló deja su directorio atrás. Solo se
# tocan los de más de un día, para no llevarse por delante uno que esté en curso.
find "$(dirname "$APP")" -maxdepth 1 -name "$(basename "$APP").stage-*" -type d -mtime +1 \
	-not -path "$STAGE" -exec rm -rf {} + 2>/dev/null || true

echo "   staging listo"
REMOTO

# ---- Intercambio (swap) y rollback ----------------------------------------------
# El swap es por renames dentro del MISMO sistema de archivos: no hay ventana con el
# directorio a medias, y purga implícitamente lo que ya no existe en git (el directorio
# vivo se reemplaza entero). El proceso Node en vuelo sobrevive al `mv` porque ya tiene
# todo cargado en memoria; el `systemctl restart` viene después.
swap() {
	"${SSH[@]}" "sudo flock -w 900 /var/lock/gtalks-deploy.lock bash -euo pipefail -s '$APP' '$STAGE' '$PREV' '$SERVICIO'" <<'REMOTO'
APP="$1"; STAGE="$2"; PREV="$3"; SERVICIO="$4"
[ -d "$STAGE" ] || { echo "ERROR: no hay staging que promover" >&2; exit 1; }
rm -rf "$PREV"
if [ -d "$APP" ]; then mv "$APP" "$PREV"; fi
mv "$STAGE" "$APP"
systemctl restart "$SERVICIO"
echo "   swap OK y servicio reiniciado"
REMOTO
}

rollback() {
	echo "==> ROLLBACK: restaurando la generación anterior"
	"${SSH[@]}" "sudo flock -w 900 /var/lock/gtalks-deploy.lock bash -euo pipefail -s '$APP' '$PREV' '$SERVICIO'" <<'REMOTO'
APP="$1"; PREV="$2"; SERVICIO="$3"
if [ ! -d "$PREV" ]; then
	echo "ERROR: no hay generación previa que restaurar (este es el primer deploy)." >&2
	echo "       El servidor queda con el despliegue nuevo, que NO pasó la comprobación de salud." >&2
	echo "       Revísalo a mano:  journalctl -u $SERVICIO -n 80" >&2
	exit 1
fi
rm -rf "$APP.fallido"
mv "$APP" "$APP.fallido"
mv "$PREV" "$APP"
systemctl restart "$SERVICIO"
echo "   generación anterior restaurada (la fallida queda en $APP.fallido para revisar)"
REMOTO
}

# ---- Journal de auditoría en el servidor ----------------------------------------
journal() {
	local RESULTADO="$1"
	local LINEA="$FECHA | sha=$SHA | ref=$REF | operador=$OPERADOR | checksum=$CHECKSUM | resultado=$RESULTADO"
	local JSON="{\"fecha\":\"$FECHA\",\"sha\":\"$SHA\",\"ref\":\"$REF\",\"operador\":\"$OPERADOR\",\"checksum\":\"$CHECKSUM\",\"resultado\":\"$RESULTADO\"}"
	"${SSH[@]}" "sudo mkdir -p $BACKUPS && echo '$LINEA' | sudo tee -a $JOURNAL >/dev/null && echo '$JSON' | sudo tee $ESTADO_JSON >/dev/null"
}

echo "==> Aplicando en el servidor"
swap

# ---- 5. Comprobación de salud: el sitio de pie y la identidad cerrada -----------
# El sitio es público por decisión del negocio: aquí un 200 sobre el contenido es salud,
# no regresión. Lo que NO puede pasar es que el HTML salga sin cabeceras o que la
# identidad se entregue sin sesión. Se comprueban las cuatro afirmaciones que sostiene
# docs/SEGURIDAD.md, desde el propio servidor (sin depender de DNS ni de la ruta de red
# de esta estación):
#   1. /health responde ok                   → el proceso arrancó y no murió en el arranque
#   2. GET / navegando → 200 con CSP         → el HTML sale por la puerta con cabeceras
#   3. GET /api/me     → 401                 → la identidad exige sesión
#   4. GET /auth/login → 302 a Microsoft     → el login de la escarapela sigue vivo
echo "==> Comprobación de salud (sitio de pie, identidad cerrada)"
FALLO=""
SALUD="$("${SSH[@]}" "bash -s '$APP_PORT'" <<'REMOTO' || true
PUERTO="$1"
B="http://127.0.0.1:$PUERTO"
# El servicio acaba de reiniciar: se le dan hasta 15 s para atender.
for i in $(seq 1 15); do
	curl -fsS --max-time 3 "$B/health" >/dev/null 2>&1 && break
	sleep 1
done
echo "health=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$B/health" 2>/dev/null || echo 000)"
echo "raiz=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 -H 'Sec-Fetch-Dest: document' -H 'Sec-Fetch-Mode: navigate' "$B/" 2>/dev/null || echo 000)"
echo "raiz_csp=$(curl -sS -D - -o /dev/null --max-time 5 -H 'Sec-Fetch-Dest: document' -H 'Sec-Fetch-Mode: navigate' "$B/" 2>/dev/null | grep -ci '^content-security-policy:' || echo 0)"
echo "api=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 -H 'Sec-Fetch-Dest: empty' -H 'Sec-Fetch-Mode: cors' "$B/api/me" 2>/dev/null || echo 000)"
echo "login=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 -H 'Sec-Fetch-Dest: document' -H 'Sec-Fetch-Mode: navigate' "$B/auth/login" 2>/dev/null || echo 000)"
echo "login_destino=$(curl -sS -o /dev/null -w '%{redirect_url}' --max-time 5 -H 'Sec-Fetch-Dest: document' -H 'Sec-Fetch-Mode: navigate' "$B/auth/login" 2>/dev/null || echo '')"
# La carta de presentación: lo que /health declara y lo que las dos puertas contestan.
echo "carta_salud=$(curl -sS --max-time 5 "$B/health" 2>/dev/null | grep -o '"carta":{[^}]*}' || echo '')"
echo "carta_admin=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 -H 'Sec-Fetch-Dest: empty' -H 'Sec-Fetch-Mode: cors' "$B/api/carta/admin/perfiles" 2>/dev/null || echo 000)"
echo "carta_publico=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 -H 'Sec-Fetch-Dest: empty' -H 'Sec-Fetch-Mode: cors' "$B/api/carta/perfiles/00000000-0000-4000-8000-000000000000" 2>/dev/null || echo 000)"
REMOTO
)"
val() { printf '%s\n' "$SALUD" | sed -n "s/^$1=//p" | head -1; }

[ "$(val health)" = "200" ] && echo "   200 /health" || { echo "   FALLO: /health devolvió $(val health)" >&2; FALLO=1; }
[ "$(val raiz)" = "200" ]   && echo "   200 / (navegación, sitio público)" || { echo "   FALLO: / devolvió $(val raiz), se esperaba 200" >&2; FALLO=1; }
[ "$(val raiz_csp)" -ge 1 ] 2>/dev/null && echo "   / lleva Content-Security-Policy" ||
	{ echo "   FALLO: / salió SIN Content-Security-Policy" >&2; FALLO=1; }
[ "$(val api)" = "401" ] && echo "   401 /api/me (la identidad exige sesión)" ||
	{ echo "   FALLO: /api/me devolvió $(val api), se esperaba 401 LA IDENTIDAD PODRÍA ESTAR EXPUESTA" >&2; FALLO=1; }
[ "$(val login)" = "302" ] && case "$(val login_destino)" in
	https://login.microsoftonline.com/*) echo "   302 /auth/login → Microsoft (el login de la escarapela vive)" ;;
	*) echo "   FALLO: /auth/login redirige a '$(val login_destino)', se esperaba login.microsoftonline.com" >&2; FALLO=1 ;;
esac || { echo "   FALLO: /auth/login devolvió $(val login), se esperaba 302" >&2; FALLO=1; }

# La carta de presentación. Ramifica por lo que /health declara: con el módulo configurado se
# exige la BD de pie, el esquema al día, el panel cerrado (401) y la tarjeta inexistente en 404;
# sin configurar, las dos puertas tienen que ser 404 (el módulo no existe) y se avisa. Cualquier
# otra combinación es un despliegue a medias, y eso revierte.
CARTA="$(val carta_salud)"
case "$CARTA" in
	*'"configurada":true'*)
		case "$CARTA" in *'"bd":"ok"'*) echo "   carta: bd ok" ;; *) echo "   FALLO: carta configurada pero la BD no está ok: $CARTA" >&2; FALLO=1 ;; esac
		case "$CARTA" in *'"migraciones":"al_dia"'*) echo "   carta: migraciones al día" ;; *) echo "   FALLO: carta con migraciones que no están al día: $CARTA" >&2; FALLO=1 ;; esac
		[ "$(val carta_admin)" = "401" ] && echo "   401 /api/carta/admin/perfiles (el panel exige sesión)" ||
			{ echo "   FALLO: /api/carta/admin/perfiles devolvió $(val carta_admin), se esperaba 401 EL PANEL PODRÍA ESTAR EXPUESTO" >&2; FALLO=1; }
		[ "$(val carta_publico)" = "404" ] && echo "   404 /api/carta/perfiles/<nadie> (la tarjeta inexistente no existe)" ||
			{ echo "   FALLO: /api/carta/perfiles/<nadie> devolvió $(val carta_publico), se esperaba 404" >&2; FALLO=1; }
		;;
	*'"configurada":false'*)
		echo "   AVISO: la carta de presentación está APAGADA en este servidor (DB_* vacías)"
		[ "$(val carta_admin)" = "404" ] && [ "$(val carta_publico)" = "404" ] && echo "   404 /api/carta/* (el módulo no existe)" ||
			{ echo "   FALLO: módulo apagado pero /api/carta/* contesta $(val carta_admin)/$(val carta_publico), se esperaba 404/404" >&2; FALLO=1; }
		;;
	*)
		echo "   FALLO: /health no declara el estado de la carta ('$CARTA'): ¿servidor anterior a la función?" >&2; FALLO=1 ;;
esac

# Borde público: prueba que nginx, TLS y DNS también están. Si esta estación no alcanza
# la URL, se avisa y NO se cuenta como fallo del sitio: la ruta de red de tu portátil no
# es la salud del servidor. Un código HTTP inesperado sí cuenta.
if [ -n "$URL_PUBLICA" ]; then
	# Las cabeceras `Sec-Fetch-*` NO son opcionales aquí, igual que en la comprobación de
	# arriba: `server/app.js` distingue una NAVEGACIÓN de un subrecurso, y a un subrecurso
	# inexistente le responde 404 JSON a propósito. Sin ellas, `/` devuelve 404 en un sitio
	# perfectamente sano y este bloque lo tomaría por fallo, disparando el rollback de un
	# despliegue bueno. Estuvo así hasta el 2026-08-04 y no se notó porque la URL configurada
	# no resolvía: daba 000, que se ignora.
	CODIGO="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 \
		-H 'Sec-Fetch-Dest: document' -H 'Sec-Fetch-Mode: navigate' \
		"$URL_PUBLICA/" 2>/dev/null || echo 000)"
	case "$CODIGO" in
		200) echo "   200 $URL_PUBLICA/ (nginx + TLS de pie)" ;;
		000) echo "   AVISO: no se pudo alcanzar $URL_PUBLICA desde esta estación (¿VPN, DNS interno?). No se toma como fallo." ;;
		*)   echo "   FALLO: $URL_PUBLICA/ devolvió $CODIGO, se esperaba 200" >&2; FALLO=1 ;;
	esac
fi

if [ "${GT_DEPLOY_SIMULAR_FALLO:-}" = "1" ]; then
	echo "   SIMULACRO: GT_DEPLOY_SIMULAR_FALLO=1 fuerza la rama de rollback"
	FALLO=1
fi

if [ -n "$FALLO" ]; then
	rollback
	journal "ROLLBACK"
	echo "==> Sitio restaurado a la generación anterior. Journal: ROLLBACK de $SHA_CORTO." >&2
	exit 1
fi

# ---- 6. Cierre auditable --------------------------------------------------------
journal "OK"
echo "==> Deploy completo: $SHA_CORTO | sha256 $CHECKSUM"
echo "    (journal: $JOURNAL consúltalo con: bash deploy/deploy.sh --estado)"

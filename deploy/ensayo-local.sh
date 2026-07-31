#!/usr/bin/env bash
# Ensayo local de `deploy.sh` sin servidor y sin red.
#
# Por qué existe: entre que este mecanismo se escribe y que hay una máquina donde correrlo
# pueden pasar semanas, y la primera vez que se ejecuta de verdad no puede ser el día del
# evento. Esto ejercita, en esta misma estación, todo lo que NO necesita el servidor.
#
# Lo que prueba de verdad:
#   1. Que el paquete de `git archive` es determinista y trae lo que el servidor exige.
#   2. Que un árbol recién extraído COMPILA (`npm ci` + `npm run build`) el fallo clásico
#      es un archivo que está gitignored pero que el build necesita.
#   3. Que tras `npm prune --omit=dev` el server SIGUE ARRANCANDO o sea, que ninguna
#      dependencia de ejecución quedó por error en devDependencies. Ese fallo solo se ve
#      en producción, y allí se ve como «el sitio está caído».
#   4. Que la matriz de salud da lo que `deploy.sh` espera (200 con CSP en / · 401 /api/me
#      · 302 /auth/login → Microsoft, o 503 si el entorno no trae credenciales M365).
#   5. Que la coreografía de renames (stage → vivo → prev → fallido) no pierde el sitio,
#      incluido el caso feo: rollback sin generación previa.
#
# Los bloques de swap y rollback se EXTRAEN de deploy.sh, no se copian: si editas el script
# y rompes la coreografía, este ensayo lo dice. Probar una copia no probaría nada.
#
# Uso (desde la raíz del repo):
#   bash deploy/ensayo-local.sh            # solo renames segundos, sin red
#   bash deploy/ensayo-local.sh --completo # además compila y levanta el gate minutos
#
# Lo único que NO se puede ensayar aquí es lo que exige Linux y una máquina real: sudo,
# flock, systemctl, chown y el viaje por SSH.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$DIR/.." && pwd)"
COMPLETO="${1:-}"
PUERTO="${GTALKS_ENSAYO_PUERTO:-3999}"

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
ok()  { echo "   ✓ $1"; }
mal() { echo "   ✗ $1" >&2; FALLOS=$((FALLOS + 1)); }
FALLOS=0

# ─────────────────────────────────────────── 1. Paquete determinista y completo
echo "== 1. Paquete (git archive) =="
SHA="$(git -C "$RAIZ" rev-parse HEAD)"
A="$(git -C "$RAIZ" -c core.autocrlf=false -c core.eol=lf archive "$SHA" | gzip -n | sha256sum | cut -d' ' -f1)"
B="$(git -C "$RAIZ" -c core.autocrlf=false -c core.eol=lf archive "$SHA" | gzip -n | sha256sum | cut -d' ' -f1)"
[ "$A" = "$B" ] && ok "determinista: dos corridas, mismo sha256 (${A:0:12}…)" ||
	mal "NO determinista: $A vs $B"

git -C "$RAIZ" -c core.autocrlf=false -c core.eol=lf archive "$SHA" > "$T/pack.tar"
# El listado se captura UNA vez y se busca sobre la variable. Nada de `tar … | grep -q`:
# `grep -q` sale al primer acierto, `tar` recibe SIGPIPE y con `pipefail` la tubería
# entera se lee como fallo. (Lo descubrió este mismo ensayo en su primera corrida.)
LISTADO="$(tar -tf "$T/pack.tar")"
for f in package-lock.json package.json server/index.js index.html vite.config.ts; do
	case $'\n'"$LISTADO"$'\n' in
		*$'\n'"$f"$'\n'*) ok "trae $f" ;;
		*) mal "falta $f en el paquete" ;;
	esac
done
# La estación es Windows: un CRLF en los .js o .sh que viajan rompe bash y node en el servidor.
tar -xOf "$T/pack.tar" server/index.js > "$T/crlf-check"
if grep -q $'\r' "$T/crlf-check"; then
	mal "server/index.js sale con CRLF revisa -c core.autocrlf=false -c core.eol=lf"
else
	ok "sin CRLF (core.eol=lf aplicado)"
fi

# ─────────────────────────────────────────── 2. Coreografía de renames
# Se extraen los bloques LITERALES de deploy.sh. `systemctl` se sustituye por un stub:
# es lo único de esos bloques que no existe fuera de Linux.
echo
echo "== 2. Coreografía de swap y rollback (bloques extraídos de deploy.sh) =="
bloque() { # $1 = línea con la que empieza el bloque
	local ini fin
	ini="$(grep -n -F -x "$1" "$DIR/deploy.sh" | cut -d: -f1)"
	[ -n "$ini" ] || { echo "ERROR: no encontré el bloque que empieza por: $1" >&2; exit 1; }
	fin="$(awk -v s="$ini" 'NR>s && /^REMOTO$/{print NR; exit}' "$DIR/deploy.sh")"
	printf 'systemctl(){ echo "   [stub] systemctl $*"; }\n'
	sed -n "${ini},$((fin - 1))p" "$DIR/deploy.sh"
}
bloque 'APP="$1"; STAGE="$2"; PREV="$3"; SERVICIO="$4"' > "$T/swap.sh"
bloque 'APP="$1"; PREV="$2"; SERVICIO="$3"'             > "$T/rollback.sh"

APP="$T/opt/gtalks"; PREV="$APP.prev"
mkdir -p "$T/opt"
corre() { bash -euo pipefail "$@"; }

S1="$APP.stage-aaaaaaaaaa"; mkdir -p "$S1"; echo v1 > "$S1/marca"
corre "$T/swap.sh" "$APP" "$S1" "$PREV" gtalks >/dev/null
[ "$(cat "$APP/marca")" = "v1" ] && [ ! -d "$PREV" ] &&
	ok "primer deploy: v1 queda vivo y no inventa un prev" || mal "primer deploy incorrecto"

S2="$APP.stage-bbbbbbbbbb"; mkdir -p "$S2"; echo v2 > "$S2/marca"
corre "$T/swap.sh" "$APP" "$S2" "$PREV" gtalks >/dev/null
[ "$(cat "$APP/marca")" = "v2" ] && [ "$(cat "$PREV/marca")" = "v1" ] &&
	ok "segundo deploy: v2 vivo, v1 guardado como prev" || mal "segundo deploy incorrecto"

corre "$T/rollback.sh" "$APP" "$PREV" gtalks >/dev/null
[ "$(cat "$APP/marca")" = "v1" ] && [ "$(cat "$APP.fallido/marca")" = "v2" ] &&
	ok "rollback: v1 restaurado, v2 apartado en .fallido para revisar" || mal "rollback incorrecto"

rm -rf "$PREV"
if corre "$T/rollback.sh" "$APP" "$PREV" gtalks >/dev/null 2>&1; then
	mal "rollback sin prev debió NEGARSE y no lo hizo"
else
	[ "$(cat "$APP/marca")" = "v1" ] &&
		ok "rollback sin prev: se niega y deja el sitio en pie (no destruye)" ||
		mal "rollback sin prev destruyó el sitio vivo"
fi

# ─────────────────────────────────────────── 3. Compilación y matriz de salud
if [ "$COMPLETO" = "--completo" ]; then
	echo
	echo "== 3. Compilación desde el paquete y matriz de salud (esto tarda) =="
	mkdir -p "$T/build"
	tar -xf "$T/pack.tar" -C "$T/build"
	(
		cd "$T/build"
		unset NODE_ENV
		export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
		npm ci --ignore-scripts --no-audit --no-fund >/dev/null 2>&1
		npm run build >/dev/null 2>&1
		npm prune --omit=dev --no-audit --no-fund >/dev/null 2>&1
	) && ok "npm ci + build + prune desde un árbol recién extraído" ||
		{ mal "la compilación falló desde el paquete"; }
	[ -f "$T/build/dist/index.html" ] && ok "produjo dist/index.html" || mal "no hay dist/index.html"
	for m in vite typescript playwright; do
		[ -d "$T/build/node_modules/$m" ] && mal "$m sobrevivió a la poda" || ok "$m podado"
	done

	# Arranca el server DESDE EL ÁRBOL PODADO: si algo de ejecución quedó en devDependencies,
	# aquí es donde revienta no en producción.
	( cd "$T/build" && SERVER_PORT="$PUERTO" \
		SESSION_SECRET=ensayo-local-no-es-un-secreto-real-0123456789 \
		node server/index.js > "$T/gate.log" 2>&1 & echo $! > "$T/gate.pid" )
	for _ in $(seq 1 20); do
		curl -fsS --max-time 2 "http://127.0.0.1:$PUERTO/health" >/dev/null 2>&1 && break
		sleep 1
	done

	Bs="http://127.0.0.1:$PUERTO"
	cod() { curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$@" 2>/dev/null || echo 000; }
	[ "$(cod "$Bs/health")" = "200" ] && ok "el server arranca tras la poda · 200 /health" ||
		{ mal "el server NO arranca tras la poda mira $T/gate.log"; cat "$T/gate.log" >&2 || true; }
	[ "$(cod -H 'Sec-Fetch-Dest: document' -H 'Sec-Fetch-Mode: navigate' "$Bs/")" = "200" ] &&
		ok "200 / (navegación, sitio público)" || mal "/ no se sirve"
	CSP="$(curl -sS -D - -o /dev/null --max-time 5 \
		-H 'Sec-Fetch-Dest: document' -H 'Sec-Fetch-Mode: navigate' "$Bs/" 2>/dev/null |
		grep -ci '^content-security-policy:' || true)"
	[ "${CSP:-0}" -ge 1 ] && ok "/ lleva Content-Security-Policy" || mal "/ salió SIN CSP"
	[ "$(cod -H 'Sec-Fetch-Dest: empty' -H 'Sec-Fetch-Mode: cors' "$Bs/api/me")" = "401" ] &&
		ok "401 /api/me (la identidad exige sesión)" || mal "/api/me no da 401"
	# Sin credenciales M365 en el ensayo, /auth/login responde 503 m365_no_configurado: eso
	# también es la respuesta correcta lo que no puede pasar es un 200 o un 500.
	LOGIN="$(cod -H 'Sec-Fetch-Dest: document' -H 'Sec-Fetch-Mode: navigate' "$Bs/auth/login")"
	case "$LOGIN" in
		302|503) ok "$LOGIN /auth/login (el arranque del login responde)" ;;
		*) mal "/auth/login devolvió $LOGIN, se esperaba 302 (o 503 sin credenciales)" ;;
	esac

	kill "$(cat "$T/gate.pid")" 2>/dev/null || true
	# En Git Bash el PID de node no siempre es el que ve Windows; se remata por puerto.
	command -v taskkill >/dev/null && for p in $(netstat -ano 2>/dev/null | grep ":$PUERTO " |
		awk '{print $5}' | sort -u); do taskkill //PID "$p" //F >/dev/null 2>&1 || true; done
else
	echo
	echo "(3. compilación y matriz de salud omitidas añade --completo)"
fi

echo
if [ "$FALLOS" -eq 0 ]; then
	echo "== Ensayo local en verde. Falta lo que solo se puede probar contra el servidor:"
	echo "   SSH, sudo, flock, systemctl y el borde nginx/TLS."
else
	echo "== $FALLOS comprobación(es) en rojo." >&2
	exit 1
fi

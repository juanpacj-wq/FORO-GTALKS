#!/usr/bin/env bash
# Sube los certificados pre-generados al servidor. NUNCA por git: el repo es público
# y estos PDF llevan nombre y cédula.
#
#   bash deploy/certificados-subir.sh                                   # todos los del manifiesto
#   bash deploy/certificados-subir.sh --solo jcespedes,llondono,...     # la etapa acotada
#
# Mismo transporte que deploy.sh: tar por stdin de ssh con sha256 verificado en las
# dos puntas. El destino es /var/lib/gtalks/certificados fuera de /opt/gtalks, para
# que sobreviva a los despliegues igual que el libro, con dueño gtalks:gtalks y modo
# 0640. El manifiesto que viaja es EXACTAMENTE el que describirá lo subido: con
# --solo se filtra aquí, en la estación, y el servidor jamás ve entradas de archivos
# que no tenga (arrancaría abortando: «subida incompleta»).
#
# Después de subir hay que REINICIAR el servicio: el manifiesto se carga al arrancar.
# Este script lo hace y comprueba la salud mínima: servicio activo y /api/certificado
# respondiendo 401 sin sesión (la identidad cerrada es lo innegociable, no el 200).
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$DIR/.." && pwd)"
ORIGEN="$RAIZ/.datos/certificados"

if [ -f "$DIR/deploy.env" ]; then
	# shellcheck disable=SC1091
	. "$DIR/deploy.env"
fi
falta() { echo "ERROR: falta $1 (deploy/deploy.env)." >&2; exit 1; }
[ -n "${GTALKS_SSH_HOST:-}" ] || falta GTALKS_SSH_HOST

PORT="${GTALKS_SSH_PORT:-22}"
KEY="${GTALKS_SSH_KEY:-$HOME/.ssh/id_ed25519}"
SERVICIO="${GTALKS_SERVICIO:-gtalks}"
DESTINO="${GTALKS_CERTIFICADOS_DIR:-/var/lib/gtalks/certificados}"
URL_PUBLICA="${GTALKS_URL:-}"
SSH=(ssh -p "$PORT" -i "$KEY" -o BatchMode=yes "$GTALKS_SSH_HOST")

[ -f "$ORIGEN/manifiesto.json" ] || { echo "ERROR: no existe $ORIGEN/manifiesto.json. Genera primero (scripts/certificados-generar.py)." >&2; exit 1; }

SOLO=""
if [ "${1:-}" = "--solo" ]; then
	SOLO="${2:?--solo necesita una lista de aliases separados por coma}"
fi

# ---- 1. El lote: completo, o filtrado AQUÍ con su manifiesto coherente ----------
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
LOTE="$TMP/lote"
mkdir -p "$LOTE"

if [ -n "$SOLO" ]; then
	node -e '
		const fs = require("fs"), path = require("path")
		const [origen, lote, solo] = process.argv.slice(1)
		const pedidos = new Set(solo.split(",").map(s => s.trim()).filter(Boolean))
		const m = JSON.parse(fs.readFileSync(path.join(origen, "manifiesto.json"), "utf8"))
		const personas = m.personas.filter(p => pedidos.has(p.archivo.replace(/\.pdf$/, "")))
		const faltan = [...pedidos].filter(a => !personas.some(p => p.archivo === a + ".pdf"))
		if (faltan.length) { console.error("ERROR: --solo pide aliases sin PDF en el manifiesto: " + faltan.join(", ")); process.exit(1) }
		for (const p of personas) fs.copyFileSync(path.join(origen, p.archivo), path.join(lote, p.archivo))
		fs.writeFileSync(path.join(lote, "manifiesto.json"), JSON.stringify({ ...m, personas }, null, 2))
		console.log(`   lote acotado: ${personas.length} certificado(s)`)
	' "$ORIGEN" "$LOTE" "$SOLO"
else
	node -e '
		const fs = require("fs"), path = require("path")
		const [origen, lote] = process.argv.slice(1)
		const m = JSON.parse(fs.readFileSync(path.join(origen, "manifiesto.json"), "utf8"))
		for (const p of m.personas) fs.copyFileSync(path.join(origen, p.archivo), path.join(lote, p.archivo))
		fs.copyFileSync(path.join(origen, "manifiesto.json"), path.join(lote, "manifiesto.json"))
		console.log(`   lote completo: ${m.personas.length} certificado(s)`)
	' "$ORIGEN" "$LOTE"
fi

PACK="$TMP/certificados.tgz"
tar -C "$LOTE" -czf "$PACK" .
CHECKSUM="$(sha256sum < "$PACK" | cut -d' ' -f1)"
echo "   paquete: $(du -h "$PACK" | cut -f1) | sha256 $CHECKSUM"

# ---- 2. Transferir con verificación en las dos puntas ---------------------------
# Dos sesiones SSH a propósito, como deploy.sh: el paquete viaja por stdin en la
# primera y el script de instalación por heredoc en la segunda. En una sola, `bash -s`
# y el paquete pelearían por el MISMO stdin y bash intentaría ejecutar el tar.
echo "==> Transfiriendo paquete"
CHK_REMOTO="$("${SSH[@]}" "cat > /tmp/gtalks-certificados.tgz && sha256sum /tmp/gtalks-certificados.tgz | cut -d' ' -f1" < "$PACK")"
if [ "$CHK_REMOTO" != "$CHECKSUM" ]; then
	echo "ERROR: checksum remoto ($CHK_REMOTO) != local ($CHECKSUM) transferencia corrupta, no se toca nada." >&2
	exit 1
fi
echo "   integridad verificada en el servidor"

# ---- 3. Instalar con intercambio por renames -------------------------------------
echo "==> Instalando en $DESTINO"
"${SSH[@]}" "sudo bash -euo pipefail -s '$CHECKSUM' '$DESTINO'" <<'REMOTO'
CHECKSUM="$1"; DESTINO="$2"
PACK=/tmp/gtalks-certificados.tgz
echo "$CHECKSUM  $PACK" | sha256sum -c - >/dev/null    # re-verificación independiente
NUEVO="$DESTINO.nuevo"
rm -rf "$NUEVO"
mkdir -p "$NUEVO"
tar -xz -C "$NUEVO" < "$PACK"
rm -f "$PACK"
chown -R gtalks:gtalks "$NUEVO"
chmod 750 "$NUEVO"
find "$NUEVO" -type f -exec chmod 640 {} +
# Intercambio por renames: si algo de lo anterior falla, el directorio vivo no se tocó.
if [ -d "$DESTINO" ]; then rm -rf "$DESTINO.prev"; mv "$DESTINO" "$DESTINO.prev"; fi
mv "$NUEVO" "$DESTINO"
echo "   instalados: $(ls "$DESTINO" | grep -c '\.pdf$') pdf + manifiesto (anterior en $DESTINO.prev)"
REMOTO

# ---- 4. Reiniciar y comprobar ----------------------------------------------------
echo "==> Reiniciando $SERVICIO (el manifiesto se carga al arrancar)"
"${SSH[@]}" "sudo systemctl restart $SERVICIO && sleep 2 && systemctl is-active $SERVICIO"

if [ -n "$URL_PUBLICA" ]; then
	echo "==> Salud: /api/certificado debe responder 401 sin sesión"
	CODIGO="$(curl -s -o /dev/null -w '%{http_code}' "$URL_PUBLICA/api/certificado" || true)"
	if [ "$CODIGO" != "401" ]; then
		echo "ERROR: /api/certificado respondió $CODIGO y debía 401. Mira 'journalctl -u $SERVICIO':" >&2
		echo "  si el arranque abortó por el manifiesto, el servicio estará caído: revisar y resubir." >&2
		exit 1
	fi
	echo "   401 correcto: identidad cerrada y servicio arriba"
else
	echo "   (GTALKS_URL vacío: comprueba a mano que el servicio esté arriba y /api/certificado dé 401)"
fi

echo
echo "Listo. Recuerda: si es la PRIMERA subida, /etc/gtalks/env necesita"
echo "  CERTIFICADOS_DIR=$DESTINO"
echo "y el restart ya quedó hecho. La prueba de fuego es que una persona del lote descargue el suyo."

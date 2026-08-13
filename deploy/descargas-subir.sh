#!/usr/bin/env bash
# Sube los dos ZIP de «Descargar contenido» (/galeria) al servidor. NUNCA por git:
# el de fotografías pesa ~1.3 GB y el repo es público.
#
#   bash deploy/descargas-subir.sh
#
# Mismo transporte que certificados-subir.sh: tar por stdin de ssh con sha256
# verificado en las dos puntas, destino fuera de /opt/gtalks para que sobreviva a
# los despliegues, intercambio por renames y RESTART al final (el manifiesto se
# carga al arrancar). La salud que se comprueba es /api/descargas anunciando los
# dos roles.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$DIR/.." && pwd)"
ORIGEN="$RAIZ/.datos/descargas"

if [ -f "$DIR/deploy.env" ]; then
	# shellcheck disable=SC1091
	. "$DIR/deploy.env"
fi
falta() { echo "ERROR: falta $1 (deploy/deploy.env)." >&2; exit 1; }
[ -n "${GTALKS_SSH_HOST:-}" ] || falta GTALKS_SSH_HOST

PORT="${GTALKS_SSH_PORT:-22}"
KEY="${GTALKS_SSH_KEY:-$HOME/.ssh/id_ed25519}"
SERVICIO="${GTALKS_SERVICIO:-gtalks}"
DESTINO="${GTALKS_DESCARGAS_DIR:-/var/lib/gtalks/descargas}"
URL_PUBLICA="${GTALKS_URL:-}"
SSH=(ssh -p "$PORT" -i "$KEY" -o BatchMode=yes "$GTALKS_SSH_HOST")

[ -f "$ORIGEN/manifiesto.json" ] || { echo "ERROR: no existe $ORIGEN/manifiesto.json. Genera primero (scripts/descargas-empaquetar.py)." >&2; exit 1; }

# ---- 1. El paquete: tar SIN comprimir (los ZIP ya lo están; gzip solo sumaría minutos) ----
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PACK="$TMP/descargas.tar"
tar -C "$ORIGEN" -cf "$PACK" .
CHECKSUM="$(sha256sum < "$PACK" | cut -d' ' -f1)"
echo "   paquete: $(du -h "$PACK" | cut -f1) | sha256 $CHECKSUM"

# ---- 2. Transferir con verificación en las dos puntas ---------------------------
echo "==> Transfiriendo paquete (~1.4 GB: esto tarda)"
CHK_REMOTO="$("${SSH[@]}" "cat > /tmp/gtalks-descargas.tar && sha256sum /tmp/gtalks-descargas.tar | cut -d' ' -f1" < "$PACK")"
if [ "$CHK_REMOTO" != "$CHECKSUM" ]; then
	echo "ERROR: checksum remoto ($CHK_REMOTO) != local ($CHECKSUM) transferencia corrupta, no se toca nada." >&2
	exit 1
fi
echo "   integridad verificada en el servidor"

# ---- 3. Instalar con intercambio por renames -------------------------------------
echo "==> Instalando en $DESTINO"
"${SSH[@]}" "sudo bash -euo pipefail -s '$CHECKSUM' '$DESTINO'" <<'REMOTO'
CHECKSUM="$1"; DESTINO="$2"
PACK=/tmp/gtalks-descargas.tar
echo "$CHECKSUM  $PACK" | sha256sum -c - >/dev/null    # re-verificación independiente
NUEVO="$DESTINO.nuevo"
rm -rf "$NUEVO"
mkdir -p "$NUEVO"
tar -x -C "$NUEVO" < "$PACK"
rm -f "$PACK"
chown -R gtalks:gtalks "$NUEVO"
chmod 750 "$NUEVO"
find "$NUEVO" -type f -exec chmod 640 {} +
# Intercambio por renames: si algo de lo anterior falla, el directorio vivo no se tocó.
if [ -d "$DESTINO" ]; then rm -rf "$DESTINO.prev"; mv "$DESTINO" "$DESTINO.prev"; fi
mv "$NUEVO" "$DESTINO"
echo "   instalados: $(ls "$DESTINO" | grep -c '\.zip$') zip + manifiesto (anterior en $DESTINO.prev)"
REMOTO

# ---- 4. Reiniciar y comprobar ----------------------------------------------------
echo "==> Reiniciando $SERVICIO (el manifiesto se carga al arrancar)"
"${SSH[@]}" "sudo systemctl restart $SERVICIO && sleep 2 && systemctl is-active $SERVICIO"

if [ -n "$URL_PUBLICA" ]; then
	echo "==> Salud: /api/descargas debe anunciar los roles"
	RESPUESTA="$(curl -s "$URL_PUBLICA/api/descargas" || true)"
	case "$RESPUESTA" in
		*'"imagenes":{'*'"presentaciones":{'*) echo "   roles anunciados: $RESPUESTA" ;;
		*)
			echo "ERROR: /api/descargas no anuncia los dos roles. Respuesta: $RESPUESTA" >&2
			echo "  Mira 'journalctl -u $SERVICIO': si el arranque abortó por el manifiesto, revisar y resubir." >&2
			exit 1
			;;
	esac
else
	echo "   (GTALKS_URL vacío: comprueba a mano que /api/descargas anuncie imagenes y presentaciones)"
fi

echo
echo "Listo. Recuerda: si es la PRIMERA subida, /etc/gtalks/env necesita"
echo "  DESCARGAS_DIR=$DESTINO"
echo "y el restart ya quedó hecho. La prueba de fuego es descargar los dos ZIP desde /galeria."

/**
 * El correo de inscripción. El cuerpo ES la pieza oficial `imagen correo.png` (raíz del repo):
 * va incrustada EN LÍNEA como adjunto con Content-ID (`cid:`) y envuelta entera en un enlace a
 * `/escarapela`. Como las demás piezas de la raíz, va por entregas y NO son acumulativas: manda
 * la última; adoptar una nueva es reemplazar el archivo y volver a correr
 * `node scripts/inscripcion-test.mjs`.
 *
 * `componerInscripcion` sigue siendo una función PURA: mismos datos, mismo HTML, sin red ni
 * reloj. El único I/O del módulo es `cargarImagenCorreo()`, que se llama UNA vez al ARRANCAR
 * (ver `inscripcion.js`), no al enviar: si la pieza falta, no es un PNG o no cabría en Graph,
 * el envío queda desactivado desde el arranque con un aviso ruidoso, en vez de descubrirse la
 * mañana del foro.
 *
 * ── Esto es HTML de CORREO, no HTML de web ───────────────────────────────────
 * Tablas, estilos en línea, 600 px de ancho, sin hoja externa, sin fuentes remotas y **sin
 * imágenes REMOTAS**: Outlook las bloquea por defecto y, además, una imagen remota en un correo
 * automático es un píxel de rastreo aunque nadie lo pretenda. La pieza viaja DENTRO del mensaje
 * (`cid:`), así que ni se bloquea ni delata cuándo se abre. Los colores van literales porque
 * `color-mix()` no existe en los clientes de correo; salen de `src/design/tokens.css`, medidos
 * sobre las piezas.
 *
 * El microcopy de respaldo es nuevo: español de Colombia con tuteo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** La pieza oficial, en la raíz del repo junto a los PDF. El nombre es el de la entrega. */
const RUTA_PIEZA = path.resolve(__dirname, '..', '..', 'imagen correo.png');

/** `sendMail` de Graph acepta ~4 MB de petición y el base64 infla 4/3: más que esto rebota SIEMPRE. */
const PESO_MAX_BYTES = 2.5 * 1024 * 1024;

/** Referencia del adjunto dentro del HTML (`cid:`). Estable a propósito. */
const CID_PIEZA = 'invitacion-gtalks';

/** Escapa lo que se interpola en el HTML, aunque hoy todo venga de la configuración o del repo. */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const NAVY = '#1f335e';
const CARTA = '#ededed';
const TINTA = '#1d1d1b';
const AZUL_MEDIO = '#1c6fb4';
const BLANCO = '#ffffff';
const FUENTE = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

let piezaCache = null;

/**
 * Lee la pieza UNA vez y la deja lista para adjuntar. Lanza con nombre propio si falta, si no es
 * un PNG o si no cabría en `sendMail`: quien llama (el arranque) apaga el envío y lo dice en el log.
 */
export function cargarImagenCorreo() {
  if (piezaCache) return piezaCache;

  let bytes;
  try {
    bytes = fs.readFileSync(RUTA_PIEZA);
  } catch (err) {
    throw new Error(
      `No se pudo leer ${RUTA_PIEZA} (${err.code || err.message}). Esa imagen ES el cuerpo del ` +
      'correo de inscripción. Tiene que estar COMMITEADA: el despliegue empaqueta con `git archive` ' +
      'y lo no versionado no viaja al servidor.'
    );
  }
  if (!bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) {
    throw new Error(`${RUTA_PIEZA} no es un PNG: el adjunto se declararía image/png y mentiría.`);
  }
  if (bytes.length > PESO_MAX_BYTES) {
    throw new Error(
      `${RUTA_PIEZA} pesa ${(bytes.length / 1024 / 1024).toFixed(1)} MB y en base64 no cabe en los ` +
      '~4 MB de sendMail: TODOS los envíos rebotarían. Comprime la pieza antes de adoptarla.'
    );
  }

  piezaCache = { contentBytes: bytes.toString('base64'), contentType: 'image/png' };
  return piezaCache;
}

/**
 * @param {object} datos
 * @param {object} datos.evento  el objeto de `src/data/evento.json`
 * @param {string} datos.url     origen público del sitio, sin barra final (PUBLIC_ORIGIN)
 * @param {{contentBytes: string, contentType: string}} datos.imagen  la pieza (cargarImagenCorreo)
 * @returns {{asunto: string, html: string, adjuntos: object[]}}
 */
export function componerInscripcion({ evento, url, imagen }) {
  if (!imagen?.contentBytes) {
    // Sin pieza no hay correo que valga: un `cid:` sin adjunto se pinta como imagen rota.
    throw new Error('componerInscripcion: falta la imagen del correo (cargarImagenCorreo).');
  }

  const titulo = `${evento.edicion}° Foro GECELCA ${evento.marca}`;
  const asunto = `Tu inscripción al ${titulo} quedó registrada`;
  const escarapela = `${url}/escarapela`;

  // Lo que lee quien no vea la imagen: lectores de pantalla y clientes con imágenes apagadas.
  const alterno =
    `Tu inscripción al ${titulo} quedó registrada. ${evento.fecha.texto}. ` +
    'Toca para abrir tu escarapela digital.';

  const html = `<!DOCTYPE html>
<html lang="es-CO">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(asunto)}</title>
</head>
<body style="margin:0;padding:0;background:${CARTA};">
<!-- Texto de vista previa: lo que se lee en la bandeja antes de abrir. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Tu lugar en el ${esc(titulo)} está confirmado. ${esc(evento.fecha.texto)}.</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CARTA};">
  <tr>
    <td align="center" style="padding:24px 12px;">

      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">

        <!-- La pieza, entera y clicable. El fondo sostiene el texto alterno mientras no cargue. -->
        <tr>
          <td style="background:${NAVY};">
            <a href="${esc(escarapela)}" target="_blank" style="display:block;border:0;text-decoration:none;">
              <img src="cid:${CID_PIEZA}" width="600" alt="${esc(alterno)}"
                   style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;font:400 16px/1.5 ${FUENTE};color:${BLANCO};">
            </a>
          </td>
        </tr>

        <!-- Respaldo textual: el mismo destino, por si la imagen no se ve o no se puede tocar. -->
        <tr>
          <td align="center" style="padding:18px 8px 0 8px;">
            <p style="margin:0;font:400 13px/1.6 ${FUENTE};color:${TINTA};">
              Toca la invitación para abrir tu escarapela digital. Si no la ves, usa este enlace:<br>
              <a href="${esc(escarapela)}" style="color:${AZUL_MEDIO};">${esc(escarapela)}</a>
            </p>
          </td>
        </tr>

      </table>

    </td>
  </tr>
</table>
</body>
</html>`;

  const adjuntos = [
    {
      nombre: 'invitacion-foro-gtalks.png',
      contentType: imagen.contentType,
      contentId: CID_PIEZA,
      contentBytes: imagen.contentBytes,
      enLinea: true,
    },
  ];

  return { asunto, html, adjuntos };
}

/**
 * El correo de inscripción. Función PURA: mismos datos, mismo HTML, sin red ni reloj.
 *
 * Pura para poder probar el escapado y el copy sin levantar nada (ver `scripts/inscripcion-test.mjs`).
 *
 * ── Esto es HTML de CORREO, no HTML de web ───────────────────────────────────
 * Tablas, estilos en línea, 600 px de ancho, sin hoja externa, sin fuentes remotas y **sin
 * imágenes remotas**: Outlook las bloquea por defecto y, además, una imagen remota en un correo
 * automático es un píxel de rastreo aunque nadie lo pretenda. Los colores van literales porque
 * `color-mix()` no existe en los clientes de correo; salen de `src/design/tokens.css`, medidos
 * sobre las piezas.
 *
 * El copy es microcopy nuevo: español de Colombia con tuteo.
 */

/** Escapa lo que viene del directorio. `nombre` es un dato externo al código, aunque venga de Graph. */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const NAVY = '#1f335e';
const CELESTE = '#8bd0e5';
const CARTA = '#ededed';
const TINTA = '#1d1d1b';
const AZUL_MEDIO = '#1c6fb4';
const BLANCO = '#ffffff';
const FUENTE = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * @param {object} datos
 * @param {string} datos.nombre  nombre para mostrar de quien se inscribió
 * @param {object} datos.evento  el objeto de `src/data/evento.json`
 * @param {string} datos.url     origen público del sitio, sin barra final (PUBLIC_ORIGIN)
 * @returns {{asunto: string, html: string}}
 */
export function componerInscripcion({ nombre, evento, url }) {
  const titulo = `${evento.edicion}° Foro GECELCA ${evento.marca}`;
  const asunto = `Tu inscripción al ${titulo} quedó registrada`;

  // Solo el nombre de pila: el correo es una confirmación cercana, no un oficio.
  const saludo = esc(String(nombre || '').trim().split(/\s+/)[0] || '');
  const escarapela = `${url}/escarapela`;

  const fila = (rotulo, valor) => `
              <tr>
                <td style="padding:0 0 6px 0;font:400 12px/1.4 ${FUENTE};letter-spacing:.08em;text-transform:uppercase;color:${NAVY};">${esc(rotulo)}</td>
              </tr>
              <tr>
                <td style="padding:0 0 18px 0;font:600 17px/1.4 ${FUENTE};color:${TINTA};">${esc(valor)}</td>
              </tr>`;

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

      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${BLANCO};">

        <!-- Banda de marca -->
        <tr>
          <td style="background:${NAVY};padding:28px 32px;">
            <div style="font:700 22px/1 ${FUENTE};letter-spacing:.18em;color:${BLANCO};">${esc(evento.marca)}</div>
            <div style="margin-top:10px;font:400 14px/1.4 ${FUENTE};color:${CELESTE};">${esc(titulo)}</div>
          </td>
        </tr>

        <!-- Cuerpo -->
        <tr>
          <td style="padding:32px;">
            <h1 style="margin:0 0 18px 0;font:700 24px/1.25 ${FUENTE};color:${NAVY};">Hola${saludo ? `, ${saludo}` : ''}: tu inscripción quedó registrada</h1>

            <p style="margin:0 0 16px 0;font:400 16px/1.6 ${FUENTE};color:${TINTA};">
              Ya tienes tu lugar en el <strong>${esc(evento.nombre.replace(/^Foro:\s*/, ''))} — ${esc(evento.bajada)}</strong>.
              Este correo es tu confirmación; no tienes que hacer nada más para asistir.
            </p>

            <!-- Datos -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;background:${CARTA};border-left:4px solid ${CELESTE};">
              <tr>
                <td style="padding:20px 24px 6px 24px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    ${fila('Fecha', evento.fecha.texto)}
                    ${fila('Lugar', evento.lugar)}
                  </table>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 16px 0;font:400 16px/1.6 ${FUENTE};color:${TINTA};">
              Tu escarapela digital ya está lista, con tu nombre y tu cargo puestos. Puedes ponerle
              una foto y, el día del foro, el código QR del respaldo registra tu asistencia.
            </p>

            <!-- Enlace, compuesto como botón -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
              <tr>
                <td style="background:${NAVY};">
                  <a href="${esc(escarapela)}" style="display:inline-block;padding:14px 28px;font:600 16px/1 ${FUENTE};color:${BLANCO};text-decoration:none;">Ver mi escarapela</a>
                </td>
              </tr>
            </table>

            <p style="margin:0;font:400 14px/1.6 ${FUENTE};color:${TINTA};">
              Si el botón no funciona, abre este enlace:<br>
              <a href="${esc(escarapela)}" style="color:${AZUL_MEDIO};">${esc(escarapela)}</a>
            </p>
          </td>
        </tr>

        <!-- Pie -->
        <tr>
          <td style="padding:24px 32px 32px 32px;border-top:1px solid ${CARTA};">
            <p style="margin:0 0 8px 0;font:400 13px/1.6 ${FUENTE};color:${TINTA};">
              Organiza: ${esc(evento.organiza)}.
            </p>
            <p style="margin:0;font:400 13px/1.6 ${FUENTE};color:${TINTA};">
              ¿Dudas con tu inscripción? Escribe respondiendo a este correo${
                evento.contacto?.nombre
                  ? ` o comunícate con ${esc(evento.contacto.nombre)}${
                      evento.contacto.telefono ? ` (${esc(evento.contacto.telefono)})` : ''
                    }`
                  : ''
              }.
            </p>
          </td>
        </tr>

      </table>

    </td>
  </tr>
</table>
</body>
</html>`;

  return { asunto, html };
}

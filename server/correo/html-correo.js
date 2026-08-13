/**
 * Las primitivas que comparten las plantillas de correo: el escapado y la paleta.
 *
 * Existe por una razón concreta: `esc()` es una función de SEGURIDAD, y una función de seguridad
 * duplicada es una función de seguridad que un día diverge. Cuando llegó la segunda plantilla
 * (`plantilla-envio-qr.js`), copiarla habría dejado dos escapados que hay que acordarse de
 * arreglar a la vez.
 *
 * ── Esto es HTML de CORREO, no HTML de web ───────────────────────────────────
 * Tablas, estilos en línea, 600 px de ancho, sin hoja externa, sin fuentes remotas y sin imágenes
 * REMOTAS: Outlook las bloquea por defecto y, además, una imagen remota en un correo automático es
 * un píxel de rastreo aunque nadie lo pretenda. Los colores van literales porque `color-mix()` no
 * existe en los clientes de correo; salen de `src/design/tokens.css`, medidos sobre las piezas.
 */

/** Escapa lo que se interpola en el HTML, aunque hoy todo venga de la configuración o del repo. */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const NAVY = '#1f335e';
export const CARTA = '#ededed';
export const TINTA = '#1d1d1b';
export const AZUL_MEDIO = '#1c6fb4';
export const BLANCO = '#ffffff';
export const FUENTE = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** `sendMail` de Graph acepta ~4 MB de petición y el base64 infla 4/3. */
export const PESO_MAX_BYTES = 2.5 * 1024 * 1024;

/**
 * Tope del mensaje ENTERO, sumando todos los adjuntos ya en base64.
 *
 * La guardia por adjunto no basta desde que hay dos: dos piezas de 2.4 MB pasan la comprobación
 * individual y el mensaje rebota igual. Se deja en 3.5 MB sobre los ~4 MB de `sendMail` para que
 * quepan las cabeceras y el HTML.
 */
export const PESO_MAX_MENSAJE_BYTES = 3.5 * 1024 * 1024;

/**
 * Comprueba que la suma de los adjuntos cabe en una petición de `sendMail`.
 *
 * @param {{contentBytes: string}[]} adjuntos  ya en base64
 * @throws si no cabe  fallo cerrado: mejor no enviar que enviar 163 mensajes que rebotan.
 */
export function exigirQueQuepa(adjuntos) {
  const base64 = adjuntos.reduce((suma, a) => suma + (a.contentBytes?.length || 0), 0);
  if (base64 > PESO_MAX_MENSAJE_BYTES) {
    throw new Error(
      `El mensaje pesa ${(base64 / 1024 / 1024).toFixed(1)} MB en base64 y no cabe en los ~4 MB de ` +
      'sendMail: TODOS los envíos rebotarían. Comprime la pieza antes de adoptarla.'
    );
  }
  return base64;
}

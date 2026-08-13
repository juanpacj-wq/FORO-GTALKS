/**
 * El correo del QR de asistencia: la pieza gráfica arriba y, debajo, el código personal de la
 * persona sobre su panel blanco.
 *
 * Lo manda `scripts/envio-qr.mjs` UNA vez a cada invitado, se haya inscrito o no. **El servidor
 * no carga este archivo**: vive aquí porque las reglas de HTML de correo son las mismas que las
 * de `plantilla-inscripcion.js`, no porque Express lo importe. Nada de `server/app.js` lo toca y
 * `gate-test.mjs` sigue comprobando que el sitio no ganó superficie HTTP.
 *
 * ── Tres reglas que no son de estilo, son de seguridad ───────────────────────
 *
 * 1. **El QR NO va envuelto en un enlace**, y la URL de Power Apps no aparece como texto en
 *    ninguna parte del mensaje ni en un `alt`. El código registra la asistencia de quien lo
 *    presenta y no pide autenticación: un enlace tocable sería un botón de «márcame asistente
 *    desde el sofá», y Outlook auto-enlaza cualquier URL suelta que encuentre en el texto, así
 *    que dejarla escrita reabriría el mismo agujero por la puerta de atrás.
 * 2. **Aquí no se memoiza NADA que dependa de la persona.** `plantilla-inscripcion.js` cachea su
 *    pieza porque es la misma para todo el mundo; el QR no lo es. Un `qrCache` en este módulo le
 *    serviría el código del primero a los 163, que es el único fallo de este envío sin arreglo
 *    posible el día del evento. Por eso `componerEnvioQr` recibe el PNG por parámetro, es pura, y
 *    aloca sus adjuntos en cada llamada.
 * 3. **El `alt` del QR es genérico y sin nombre.** `plantilla-inscripcion.js` ya decidió no
 *    interpolar el nombre de nadie; personalizarlo aquí reabriría una superficie de escape a
 *    cambio de nada, porque el mensaje llega a un solo buzón.
 *
 * ── La pieza va aparte de la del correo de inscripción ───────────────────────
 * `imagen correo qr.png`, NO `imagen correo.png`. Reemplazar la de inscripción para este envío
 * cambiaría retroactivamente un correo que ya salió, y `inscripcion-test.mjs` seguiría en verde
 * porque compara contra el archivo, no contra los bytes históricos. Mientras Comunicaciones no
 * entregue el arte definitivo, `cargarPiezaQr()` cae a la de inscripción y lo DICE: el envío no se
 * bloquea, pero nadie puede mandar los 163 creyendo que lleva un arte que no lleva.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AZUL_MEDIO,
  BLANCO,
  CARTA,
  FUENTE,
  NAVY,
  PESO_MAX_BYTES,
  TINTA,
  esc,
  exigirQueQuepa,
} from './html-correo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * La pieza de ESTE correo. Va en la raíz del repo, versionada, junto a las demás entregas.
 *
 * Hay DOS y las dos se conservan, que es la excepción a «manda la última»:
 *
 *   `imagen correo qr.png`      titular «¡Mañana tenemos una importante cita!». Son los bytes
 *                               exactos que recibieron las 169 personas del 2026-08-04.
 *   `imagen correo qr hoy.png`  la misma pieza con el titular en «¡Hoy…», generada por
 *                               `scripts/pieza-correo-hoy.py`. Es la que se usa.
 *
 * La vieja no se borra ni se sobrescribe: el envío del día del foro tenía que decir «hoy», pero
 * reemplazar el archivo haría que el repo afirmara que aquellas 169 recibieron algo que no
 * recibieron, y ningún arnés lo gritaría `envio-qr-test.mjs` compara el adjunto contra el
 * ARCHIVO, no contra los bytes históricos. Es la misma razón por la que este correo nunca
 * compartió pieza con el de inscripción.
 */
const RUTA_PIEZA = path.resolve(__dirname, '..', '..', 'imagen correo qr hoy.png');
/** Mientras no llegue el arte definitivo, se usa la del correo de inscripción y se avisa. */
const RUTA_PIEZA_PROVISIONAL = path.resolve(__dirname, '..', '..', 'imagen correo.png');

/** Los dos `cid` del mensaje. DISTINTOS: con el mismo, uno de los dos se pinta roto. */
const CID_PIEZA = 'invitacion-gtalks-qr';
const CID_QR = 'qr-asistencia';

/** Lado con el que se muestra el QR. El PNG llega a 1080 px: razón 4:1 exacta (ver `qr-arte.ts`). */
const LADO_QR_CSS = 270;

/**
 * El asunto, **literal**, tal como lo entregó Comunicaciones el 2026-08-04.
 *
 * No se compone a partir de `evento.json` como el del correo de inscripción: es copy de la pieza,
 * y el copy de las piezas se transcribe, no se genera (misma regla que `foro.ts`). Lo único que se
 * corrigió es un espacio doble entre «FORO» y la comilla.
 *
 * ⚠ **Este asunto CADUCA, y no caduca solo: caduca con la pieza.** Decía «MAÑANA» y salió así el
 * 2026-08-04, la víspera. El 5, para los rezagados que entraron al grupo esa misma mañana, citarlos
 * para mañana era falso, así que pasó a «HOY»  y con él el titular de la pieza, porque el asunto
 * y la imagen dicen lo mismo y cambiar uno solo deja el mensaje contradiciéndose. Si este envío
 * vuelve a correrse otro día, se cambian **los dos**: aquí y con
 * `scripts/pieza-correo-hoy.py`. `envio-qr-test.mjs` exige que el asunto y la pieza concuerden.
 */
const ASUNTO = 'TE ESPERAMOS HOY EN NUESTRO 1ER FORO “ENERGÍA EN ACCIÓN”';

let piezaCache = null;

/**
 * Lee la pieza UNA vez. Igual que `cargarImagenCorreo()`: lanza con nombre propio si falta, si no
 * es un PNG o si no cabría en `sendMail`, para que quien llame lo descubra al arrancar y no a
 * mitad de una corrida de 163 mensajes.
 *
 * @returns {{contentBytes: string, contentType: string, ruta: string, provisional: boolean}}
 */
export function cargarPiezaQr() {
  if (piezaCache) return piezaCache;

  let ruta = RUTA_PIEZA;
  let provisional = false;
  let bytes;
  try {
    bytes = fs.readFileSync(ruta);
  } catch {
    ruta = RUTA_PIEZA_PROVISIONAL;
    provisional = true;
    try {
      bytes = fs.readFileSync(ruta);
    } catch (err) {
      throw new Error(
        `No se pudo leer ni ${RUTA_PIEZA} ni ${RUTA_PIEZA_PROVISIONAL} (${err.code || err.message}). ` +
        'Esa imagen ES el cuerpo del correo. Tiene que estar COMMITEADA.'
      );
    }
  }
  if (!bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) {
    throw new Error(`${ruta} no es un PNG: el adjunto se declararía image/png y mentiría.`);
  }
  if (bytes.length > PESO_MAX_BYTES) {
    throw new Error(
      `${ruta} pesa ${(bytes.length / 1024 / 1024).toFixed(1)} MB y en base64 no cabe en los ~4 MB ` +
      'de sendMail: TODOS los envíos rebotarían. Comprime la pieza antes de adoptarla.'
    );
  }

  piezaCache = { contentBytes: bytes.toString('base64'), contentType: 'image/png', ruta, provisional };
  return piezaCache;
}

/** Solo para pruebas: olvida la pieza leída. */
export function _olvidarPieza() {
  piezaCache = null;
}

/**
 * Función PURA: mismos datos, mismo HTML. Sin red, sin reloj y sin estado entre llamadas.
 *
 * @param {object} datos
 * @param {object} datos.evento  el objeto de `src/data/evento.json`
 * @param {string} datos.url     origen público del sitio, sin barra final (PUBLIC_ORIGIN)
 * @param {{contentBytes: string, contentType: string}} datos.pieza  la pieza (cargarPiezaQr)
 * @param {Buffer|Uint8Array} datos.qrPng  el PNG del QR de ESTA persona, recién generado
 * @returns {{asunto: string, html: string, adjuntos: object[]}}
 */
export function componerEnvioQr({ evento, url, pieza, qrPng }) {
  if (!pieza?.contentBytes) {
    throw new Error('componerEnvioQr: falta la pieza del correo (cargarPiezaQr).');
  }
  if (!qrPng?.length) {
    // Un `cid:` sin adjunto se pinta como imagen rota, y aquí la imagen rota ES el mensaje.
    throw new Error('componerEnvioQr: falta el PNG del QR de la persona.');
  }

  const titulo = `${evento.edicion}° Foro GECELCA ${evento.marca}`;
  const asunto = ASUNTO;
  const escarapela = `${url}/escarapela`;

  const alterno =
    `Invitación al ${titulo}. ${evento.fecha.texto}. ` +
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
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(evento.fecha.texto)} · ${esc(evento.lugar)}. Preséntalo en el punto de registro; es personal.</div>

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

        <!-- El código, sobre el navy del dorso de la escarapela. SIN enlace: ver la cabecera.
             El ancho y el alto van como ATRIBUTOS además de en el estilo, porque Outlook de
             escritorio usa el motor de Word y no respeta max-width. -->
        <tr>
          <td align="center" bgcolor="${NAVY}" style="background:${NAVY};padding:28px 24px 8px 24px;">
            <img src="cid:${CID_QR}" width="${LADO_QR_CSS}" height="${LADO_QR_CSS}"
                 alt="Código QR de registro de asistencia"
                 style="display:block;border:0;outline:none;width:${LADO_QR_CSS}px;height:${LADO_QR_CSS}px;">
          </td>
        </tr>
        <tr>
          <td align="center" bgcolor="${NAVY}" style="background:${NAVY};padding:8px 24px 28px 24px;">
            <p style="margin:0 0 8px 0;font:600 16px/1.5 ${FUENTE};color:${BLANCO};">
              Muestra este código en el punto de registro, el día del foro.
            </p>
            <p style="margin:0;font:400 13px/1.6 ${FUENTE};color:${BLANCO};opacity:0.85;">
              Es personal e intransferible: no lo reenvíes ni lo compartas.
            </p>
          </td>
        </tr>

        <!-- Respaldo textual: si el cliente no pinta la imagen, el código sigue estando en la
             escarapela. Es el ÚNICO enlace del mensaje, junto con el de la pieza. -->
        <tr>
          <td align="center" style="padding:18px 8px 0 8px;">
            <p style="margin:0;font:400 13px/1.6 ${FUENTE};color:${TINTA};">
              ¿Prefieres tenerlo a la mano en el celular? Abre tu escarapela digital:<br>
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
      contentType: pieza.contentType,
      contentId: CID_PIEZA,
      contentBytes: pieza.contentBytes,
      enLinea: true,
    },
    {
      nombre: 'codigo-qr-asistencia.png',
      contentType: 'image/png',
      contentId: CID_QR,
      contentBytes: Buffer.from(qrPng).toString('base64'),
      enLinea: true,
    },
  ];

  // Con dos adjuntos, la guardia por pieza ya no basta: lo que rebota es el mensaje entero.
  exigirQueQuepa(adjuntos);

  return { asunto, html, adjuntos };
}

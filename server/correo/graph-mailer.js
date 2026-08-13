/**
 * Transporte: poner un mensaje en Microsoft Graph. Nada más.
 *
 * Permiso: `Mail.Send` de APLICACIÓN (client credentials), no delegado. El delegado enviaría
 * «como» el asistente el correo aparecería en SU bandeja de enviados y con él como remitente,
 * que para una confirmación de inscripción es incorrecto; además obligaría a meter el scope en el
 * login, que hoy es mínimo a propósito (ver `auth/m365.js`).
 *
 * ── Dos decisiones de seguridad ──────────────────────────────────────────────
 *
 * 1. **`baseUrl`, `fetchImpl` y `obtenerToken` se inyectan; NO salen del entorno.** Las pruebas
 *    los sustituyen por un Graph falso, y en producción son los valores por defecto de este
 *    módulo. Una variable de entorno capaz de reapuntar a dónde se manda el correo sería un SSRF
 *    con credenciales corporativas dentro.
 * 2. **Nunca se registra el token, la cabecera `Authorization`, el secreto ni el cuerpo del
 *    mensaje.** De un error salen el código HTTP y el `code` de Graph, y nada más.
 *
 * El cliente MSAL es propio del módulo y NO se comparte con el de `auth/m365.js`, que está
 * particionado por sesión: mezclarlos metería un token de aplicación en la caché de una persona.
 */
import crypto from 'node:crypto';
import { ConfidentialClientApplication, LogLevel } from '@azure/msal-node';

const GRAPH_V1 = 'https://graph.microsoft.com/v1.0';
// El mensaje lleva la pieza del correo incrustada (~1.5 MB ya en base64): con 10 s, una subida
// lenta se anotaría como `fallido` sin serlo, y un timeout no se reintenta solo.
const TIEMPO_LIMITE_MS = 30_000;
/** Tope de la espera que pida `Retry-After`: más que esto, se da por fallido y se revisa a mano. */
const ESPERA_MAX_MS = 30_000;
/** Solo estos merecen un reintento. Un 403 no mejora repitiéndolo. */
const REINTENTABLES = new Set([429, 503, 504]);

/**
 * UNA dirección, y solo una. Guardia del TRANSPORTE, independiente de la política de
 * `inscripcion.js`: aunque quien llame se equivoque, de aquí no puede salir un mensaje cuyo
 * destino contenga una coma, un punto y coma, un espacio o un salto de línea es decir, nada
 * que pueda significar «y también a estos otros». Es la última línea antes de Graph.
 */
const UNA_DIRECCION = /^[^\s@,;:<>"'()[\]\\]+@[^\s@,;:<>"'()[\]\\]+\.[^\s@,;:<>"'()[\]\\]+$/;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Proveedor de tokens de aplicación. MSAL cachea en memoria mientras se reutilice la instancia,
 * así que un token (~1 h) sirve para todos los envíos de la jornada.
 */
export function crearProveedorDeToken({ tenantId, clientId, clientSecret }) {
  const app = new ConfidentialClientApplication({
    auth: {
      clientId,
      clientSecret,
      authority: `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}`,
    },
    system: {
      loggerOptions: {
        loggerCallback: (nivel, mensaje) => {
          if (nivel === LogLevel.Error) console.error('[msal:correo]', mensaje);
        },
        piiLoggingEnabled: false,
        logLevel: LogLevel.Warning,
      },
    },
  });

  return async function obtenerToken() {
    const r = await app.acquireTokenByClientCredential({
      scopes: ['https://graph.microsoft.com/.default'],
    });
    if (!r?.accessToken) throw new Error('graph_sin_token');
    return r.accessToken;
  };
}

/**
 * @param {object}   dep
 * @param {Function} dep.obtenerToken  () => Promise<string>
 * @param {string}   [dep.baseUrl]     solo para pruebas
 * @param {Function} [dep.fetchImpl]   solo para pruebas
 * @param {Function} [dep.esperar]     solo para pruebas (evita dormir de verdad)
 */
export function crearMailer({ obtenerToken, baseUrl = GRAPH_V1, fetchImpl = fetch, esperar = dormir }) {
  // Cola de concurrencia 1. Graph limita a ~30 mensajes por minuto y por buzón: hoy son tres
  // destinatarios y sobra, pero el día que la lista se abra, la llegada del auditorio a la misma
  // hora no puede convertirse en una tormenta de 429.
  let cola = Promise.resolve();

  async function intentar({ remitente, para, asunto, html, adjuntos, peticion }) {
    const token = await obtenerToken();
    const url = `${baseUrl}/users/${encodeURIComponent(remitente)}/sendMail`;

    const r = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        // Se manda el nuestro para poder casar una línea del libro con una entrada del
        // `message trace` de Exchange sin ambigüedad.
        'client-request-id': peticion,
        'return-client-request-id': 'true',
      },
      body: JSON.stringify({
        message: {
          subject: asunto,
          body: { contentType: 'HTML', content: html },
          toRecipients: [{ emailAddress: { address: para } }],
          // Adjuntos EN el mensaje (la pieza inline, `cid:`). Se mapean solo los campos
          // conocidos, uno a uno: lo que el llamador ponga de más no viaja a Graph.
          ...(adjuntos?.length && {
            attachments: adjuntos.map((a) => ({
              '@odata.type': '#microsoft.graph.fileAttachment',
              name: a.nombre,
              contentType: a.contentType,
              contentId: a.contentId,
              isInline: a.enLinea === true,
              contentBytes: a.contentBytes,
            })),
          }),
        },
        // Deja copia en Enviados: es evidencia de auditoría sin costo.
        saveToSentItems: true,
      }),
      signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
    });

    if (r.status === 202) return { ok: true, http: 202 };

    // Del cuerpo del error solo se rescata el `code` de Graph. El resto puede traer detalles del
    // buzón o de la petición que no tienen por qué acabar en un log.
    let codigo = '';
    try {
      const cuerpo = await r.json();
      codigo = cuerpo?.error?.code || '';
    } catch {
      /* Graph no siempre devuelve JSON en un 5xx */
    }
    const espera = Number(r.headers.get?.('retry-after')) * 1000;
    return {
      ok: false,
      http: r.status,
      motivo: codigo || `http_${r.status}`,
      esperaMs: Number.isFinite(espera) && espera > 0 ? Math.min(espera, ESPERA_MAX_MS) : 2000,
      reintentable: REINTENTABLES.has(r.status),
    };
  }

  /**
   * NO lanza: devuelve el desenlace. El llamador anota en el libro y sigue; un fallo de correo
   * jamás puede alterar el inicio de sesión de nadie.
   *
   * @returns {Promise<{ok:boolean, http?:number, motivo?:string, peticion:string}>}
   */
  async function enviarAhora(mensaje) {
    const peticion = crypto.randomUUID();

    // Guardia de transporte: una sola dirección de destino y una sola de origen. No es una
    // validación de correos según el RFC, es la negativa a construir un mensaje cuyo número de
    // destinatarios sea ambiguo.
    if (!UNA_DIRECCION.test(String(mensaje.para || ''))) {
      console.error('[correo] BLOQUEADO: el destino no es una única dirección. No se envió nada.');
      return { ok: false, motivo: 'destino_invalido', peticion };
    }
    if (!UNA_DIRECCION.test(String(mensaje.remitente || ''))) {
      console.error('[correo] BLOQUEADO: el remitente no es una única dirección. No se envió nada.');
      return { ok: false, motivo: 'remitente_invalido', peticion };
    }

    try {
      let r = await intentar({ ...mensaje, peticion });
      if (!r.ok && r.reintentable) {
        console.warn(`[correo] ${r.http} (${r.motivo}) reintento único en ${r.esperaMs} ms`);
        await esperar(r.esperaMs);
        r = await intentar({ ...mensaje, peticion });
      }
      return { ok: r.ok, http: r.http, motivo: r.motivo, peticion };
    } catch (err) {
      // Timeout, DNS, TLS, o el token que no llegó. `err.message` de MSAL no lleva secretos.
      return { ok: false, motivo: err.name === 'TimeoutError' ? 'timeout' : err.message, peticion };
    }
  }

  function enviar(mensaje) {
    // El `catch` de la cola evita que un fallo rompa la cadena para los siguientes.
    const turno = cola.then(() => enviarAhora(mensaje));
    cola = turno.then(
      () => undefined,
      () => undefined,
    );
    return turno;
  }

  return { enviar };
}

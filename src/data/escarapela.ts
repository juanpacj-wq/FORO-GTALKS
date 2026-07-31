/**
 * Datos y utilidades de la escarapela digital (/escarapela).
 *
 * Vive aparte de foro.ts a propósito: foro.ts es transcripción literal de las piezas gráficas
 * y este módulo es operación el QR de asistencia, los mensajes del callback OIDC, el correo
 * de inscripción y la foto local. Nada de aquí sale de un PDF.
 */
import type { EstadoInscripcion } from './sesion'

/**
 * Plantilla del QR de registro de asistencia.
 *
 * Apunta a la app de Power Apps de capacitaciones de GECELCA: al escanear, la app registra la
 * asistencia del usuario que viaja en `USUARIO` (solo el usuario, sin `@dominio`) para la
 * capacitación `ID_CAPACITACION` de la jornada en curso, con `TIPO_CAPTURA=LEIDO`. Los dos
 * marcadores se sustituyen en `urlAsistencia` el sitio no guarda ni envía nada: el QR solo
 * se pinta.
 */
export const QR_TEMPLATE =
  'https://apps.powerapps.com/play/e/aa05f599-12ab-ea62-936f-05fb7da5df03/a/b12c5a65-6f11-41e4-a7e1-c05f21bd4876' +
  '?tenantId=221652a5-6cb0-4abb-a8a0-2abb849d134e&skipMobileRedirect=1' +
  '&ID_CAPACITACION=IDCAPACITACION&USUARIO=XXX&TIPO_CAPTURA=LEIDO'

const MARCADOR_USUARIO = 'USUARIO=XXX'
const MARCADOR_ID = 'ID_CAPACITACION=IDCAPACITACION'

/** Las dos jornadas del registro de asistencia en Power Apps. Los ID los entregó el usuario. */
export const ID_CAPACITACION_MANANA = 'fffbd1d0-7af2-4104-ac75-87964da57c19' // 00:00–11:59
export const ID_CAPACITACION_TARDE = 'a6589188-0bf5-4347-ad05-55207015a0e2' // 12:00–23:59

/**
 * El ID de capacitación de la jornada a la que pertenece `fecha`, EN HORA DE BOGOTÁ.
 *
 * La hora se resuelve con `Intl` fijando `America/Bogota` explícitamente (UTC-5 fijo, Colombia
 * no tiene horario de verano): el resultado es el mismo en un celular mal configurado, en esta
 * estación o en el servidor Ubuntu de producción, sea cual sea su zona horaria. Ningún reloj
 * del sistema participa en la decisión solo el instante. `hourCycle: 'h23'` evita el «24:xx»
 * que algunos motores devuelven para medianoche con `hour12: false`.
 *
 * Lo verifica `scripts/qr-test.mjs` congelando el reloj del navegador en las dos fronteras
 * (11:59 y 12:00 de Bogotá) bajo una zona horaria ajena (Tokio).
 */
export function idCapacitacion(fecha: Date): string {
  const hora = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Bogota',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(fecha),
  )
  return hora < 12 ? ID_CAPACITACION_MANANA : ID_CAPACITACION_TARDE
}

/** El usuario de un correo: lo que va antes de la arroba. Power Apps espera `jcespedes`, no
 *  `jcespedes@gecelca.com.co`; para un invitado B2B queda el usuario de su propio dominio. */
export function usuarioDeCorreo(email: string): string {
  return email.split('@')[0]
}

/**
 * La URL que codifica el QR de una persona en el instante `fecha`: la plantilla con su usuario
 * (URL-encoded un punto o un `+` en el alias deben viajar codificados) y el ID de la jornada
 * en curso. El QR se re-genera en vivo (ver Escarapela.tsx): lo que se escanea lleva la
 * jornada del momento del escaneo, no la de cuando se abrió la página.
 */
export function urlAsistencia(email: string, fecha: Date = new Date()): string {
  return QR_TEMPLATE
    .replace(MARCADOR_ID, `ID_CAPACITACION=${idCapacitacion(fecha)}`)
    .replace(MARCADOR_USUARIO, `USUARIO=${encodeURIComponent(usuarioDeCorreo(email))}`)
}

/**
 * Mensajes de los marcadores `?auth=` con los que el callback OIDC redirige a esta página.
 * Heredados de la pantalla de login del server (eliminada al abrir el sitio); mismos códigos
 * que emite server/app.js. Un marcador desconocido no pinta nada.
 */
export const MENSAJES_AUTH: Record<string, string> = {
  no_acceso:
    'Tu cuenta no tiene acceso a la escarapela. Si entraste con una cuenta personal o de otra ' +
    'empresa, prueba con «Entrar con otra cuenta». Si es tu cuenta corporativa, pide al ' +
    'administrador que te asigne a la aplicación.',
  error: 'No se pudo completar el inicio de sesión. Intenta de nuevo.',
  state_invalido: 'No se pudo completar el inicio de sesión. Intenta de nuevo.',
  sesion_revocada: 'Tu acceso fue revocado o tu sesión ya no es válida. Inicia sesión de nuevo.',
  revalidacion_fallida: 'No pudimos validar tu sesión. Inicia sesión de nuevo.',
  cookies_bloqueadas:
    'El navegador está bloqueando las cookies de este sitio, así que no podemos mantener tu ' +
    'sesión. Habilítalas (o sal del modo incógnito) e intenta de nuevo.',
}

/**
 * El correo de inscripción, dicho a quien acaba de entrar.
 *
 * Solo se pinta lo que el servidor confirma: `pendiente` y `no_aplica` no dicen nada, porque la
 * interfaz no puede anunciar un correo que quizá no salió. El estado sale del libro de
 * inscripciones del servidor (`server/correo/inscripcion.js`), nunca de una suposición del
 * navegador.
 */
export const MENSAJES_INSCRIPCION: Record<EstadoInscripcion, string | null> = {
  enviado: 'Te enviamos la confirmación de tu inscripción a tu correo corporativo.',
  fallido:
    'No pudimos enviarte la confirmación por correo. Tu escarapela funciona igual; si necesitas ' +
    'el comprobante, escríbele a Comunicaciones.',
  pendiente: null,
  no_aplica: null,
}

/** Clave de localStorage de la foto, por `oid`: en un computador compartido, la foto de una
 *  cuenta jamás se pinta en otra. La foto nunca viaja al servidor. */
export function claveFoto(oid: string): string {
  return `gt-escarapela-foto:${oid}`
}

/** Lado del recorte cuadrado de la foto. 512px sobra para el círculo del badge (~9rem) incluso
 *  en HiDPI, y deja el dataURL muy por debajo de la cuota de localStorage. */
const FOTO_LADO = 512

/**
 * Convierte el archivo elegido en el dataURL que guarda localStorage: recorte cuadrado centrado,
 * a lo sumo FOTO_LADO de lado, re-codificado como JPEG.
 *
 * El paso por canvas no es solo por tamaño: re-codificar descarta los metadatos EXIF (GPS,
 * fecha, equipo) del archivo original a localStorage llegan solo píxeles.
 *
 * @throws Error('no_es_imagen') si el archivo no se puede decodificar como imagen.
 */
export async function procesarFoto(archivo: File): Promise<string> {
  const bitmap = await createImageBitmap(archivo).catch(() => {
    throw new Error('no_es_imagen')
  })
  try {
    const lado = Math.min(bitmap.width, bitmap.height)
    const destino = Math.min(lado, FOTO_LADO)
    const canvas = document.createElement('canvas')
    canvas.width = destino
    canvas.height = destino
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no_es_imagen')
    ctx.drawImage(
      bitmap,
      (bitmap.width - lado) / 2, (bitmap.height - lado) / 2, lado, lado,
      0, 0, destino, destino,
    )
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally {
    bitmap.close()
  }
}

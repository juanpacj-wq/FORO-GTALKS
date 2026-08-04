// Lo que comparten los dos scripts del envío del QR: credenciales, normalización y la derivación
// del alias que viaja en el código.
//
// Son DOS scripts a propósito —`envio-qr-audiencia.mjs` lee el directorio y `envio-qr.mjs` manda
// correo— porque son dos privilegios distintos y no tienen por qué ejecutarse juntos. Entre ellos
// solo viaja un archivo JSON revisable por un humano.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { urlAsistencia, usuarioDeCorreo } from '../src/data/escarapela.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** La raíz del repo, resuelta contra ESTE archivo. Nunca contra el `cwd`: correr el script desde
 *  otra carpeta crearía un libro nuevo vacío y todo el mundo recibiría un segundo correo. */
export const RAIZ = path.resolve(__dirname, '..')
export const DIR_DATOS = path.join(RAIZ, '.datos')

/** Grupo de seguridad de Entra con los invitados al foro. */
export const GRUPO_POR_DEFECTO = '4d6d78fa-9636-4b43-aa3b-bc827839100c'

/** Una sola dirección: el mismo criterio que la guardia del transporte en `graph-mailer.js`. */
export const DIRECCION = /^[^\s@,;:<>"'()[\]\\]+@[^\s@,;:<>"'()[\]\\]+\.[^\s@,;:<>"'()[\]\\]+$/

/**
 * El instante con el que se congela la jornada del QR del correo: las 9:00 de Bogotá del día del
 * foro. Es una CONSTANTE, y ahí está media respuesta a «¿el QR que reciban hoy servirá el 5?».
 *
 * La escarapela rota su código al mediodía porque se re-pinta en vivo; un correo no puede, así
 * que el suyo lleva SIEMPRE el ID de la mañana. Al no depender del reloj, el código que se genera
 * hoy y el que se generaría dentro de un año son **el mismo**: `envio-qr-test.mjs` lo fija contra
 * una URL escrita a mano, así que si alguien cambia esto por un `new Date()` se pone rojo.
 */
export const INSTANTE_MANANA = new Date('2026-08-05T14:00:00Z')

/**
 * La URL que codifica el QR del correo de una persona.
 *
 * No lleva token, ni firma, ni marca de tiempo, ni nada que caduque: son cinco parámetros fijos
 * más su usuario. El QR, por tanto, no expira **por sí mismo** — lo que puede dejar de funcionar
 * está del otro lado, en la Power App. Ver `docs/PLAN-ENVIO-QR.md` §Lo que ningún script puede decir.
 */
export function urlDelCorreo(correo) {
  return urlAsistencia(correo, INSTANTE_MANANA)
}

export const norm = (s) => String(s ?? '').trim().toLowerCase()

/**
 * Credenciales de aplicación para Graph, con el MISMO respaldo todo-o-nada que `inscripcion.js`:
 * las tres `MAIL_*` o ninguna (y entonces las del login). Un bloque a medias mezclaría
 * credenciales de dos apps, así que se rechaza en vez de adivinar.
 */
export function credencialesGraph(env) {
  const claves = ['MAIL_TENANT_ID', 'MAIL_CLIENT_ID', 'MAIL_CLIENT_SECRET']
  const puestas = claves.filter((k) => String(env[k] || '').trim())
  if (puestas.length && puestas.length < claves.length) {
    throw new Error(
      `El bloque MAIL_* está a medias (${puestas.join(', ')}): o las tres, o ninguna. ` +
      'A medias mezclaría las credenciales de dos aplicaciones.',
    )
  }
  const [t, c, s] = puestas.length
    ? ['MAIL_TENANT_ID', 'MAIL_CLIENT_ID', 'MAIL_CLIENT_SECRET']
    : ['M365_TENANT_ID', 'M365_CLIENT_ID', 'M365_CLIENT_SECRET']
  const cred = {
    tenantId: String(env[t] || '').trim(),
    clientId: String(env[c] || '').trim(),
    clientSecret: String(env[s] || '').trim(),
    origen: puestas.length ? 'MAIL_* (app propia del correo)' : 'M365_* (la MISMA app del login)',
  }
  const faltan = ['tenantId', 'clientId', 'clientSecret'].filter((k) => !cred[k])
  if (faltan.length) throw new Error(`Faltan credenciales de Graph: ${faltan.join(', ')}`)
  return cred
}

/**
 * El alias que viaja en el QR como `USUARIO`, derivado igual que lo haría la escarapela de esa
 * persona.
 *
 * `/api/me` resuelve `email = claims.email || upn` (`server/app.js`) y `Escarapela.tsx` pinta el
 * QR con ESE email; el claim `email` de Entra se surte del atributo `mail` del directorio. Así que
 * la réplica fiel desde Graph es `mail || userPrincipalName`, y no otra cosa.
 *
 * Devuelve también de dónde salió y si hay discrepancia, porque las dos cosas hay que MIRARLAS
 * antes de mandar 163 correos: un alias sacado del UPN cuando el `mail` dice otra cosa es un QR
 * que no coincide con el de su propia escarapela.
 */
export function aliasDe(persona) {
  const mail = norm(persona.mail)
  const upn = norm(persona.userPrincipalName)
  const fuente = mail ? 'mail' : 'userPrincipalName'
  const correo = mail || upn
  const alias = usuarioDeCorreo(correo)
  return {
    correo,
    alias,
    fuente,
    aliasSegunUpn: upn ? usuarioDeCorreo(upn) : '',
    discrepa: Boolean(mail && upn && usuarioDeCorreo(mail) !== usuarioDeCorreo(upn)),
  }
}

/**
 * Los motivos por los que una persona NO debería recibir el correo sin que alguien lo mire.
 * Devuelve un array vacío cuando está limpia.
 */
export function anomaliasDe(persona, alias) {
  const motivos = []
  if (!alias.correo) motivos.push('sin correo ni UPN')
  if (!alias.alias) motivos.push('alias vacío')
  if (/#EXT#|%23/i.test(alias.alias)) motivos.push('alias de invitado B2B (#EXT#)')
  if (alias.correo && !DIRECCION.test(alias.correo)) motivos.push('el correo no es una dirección')
  if (alias.discrepa) motivos.push(`el alias del mail (${alias.alias}) no es el del UPN (${alias.aliasSegunUpn})`)
  if (alias.alias !== alias.alias.toLowerCase()) motivos.push('el alias trae mayúsculas')
  if (persona.accountEnabled === false) motivos.push('la cuenta está deshabilitada')
  return motivos
}

/** El runner de aserciones del repo. */
export function crearVerificador() {
  const estado = { fallos: 0 }
  return {
    estado,
    check(nombre, ok, detalle = '') {
      console.log(`${ok ? '  ok  ' : ' FALLA'} ${nombre}${detalle ? ` ${detalle}` : ''}`)
      if (!ok) estado.fallos++
    },
  }
}

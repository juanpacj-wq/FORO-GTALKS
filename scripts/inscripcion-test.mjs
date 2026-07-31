// Verificación del correo de inscripción (server/correo/). Sale con código 1 si algo falla.
//
//   node scripts/inscripcion-test.mjs
//
// No necesita servidor, ni red, ni credenciales: levanta un **Graph falso** en loopback y se lo
// inyecta al mailer, que está escrito justo para eso (`baseUrl`/`fetchImpl` se inyectan y nunca
// salen del entorno, ver graph-mailer.js). El libro de inscripciones trabaja sobre archivos
// temporales, así que nada toca el de producción.
//
// Lo que se prueba aquí es LA GARANTÍA del módulo: que el correo sale una vez y solo una. Si esta
// prueba pasa, la respuesta a «¿cómo sé que nadie recibió dos correos?» es este archivo.
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { crearMailer } from '../server/correo/graph-mailer.js'
import { componerInscripcion } from '../server/correo/plantilla-inscripcion.js'
import { cargarEvento } from '../server/correo/evento.js'
import {
  leerConfiguracion, iniciarInscripcion, reservarInscripcion, enviarInscripcion,
  estadoInscripcion, _reiniciar,
} from '../server/correo/inscripcion.js'

let fallos = 0
function check(nombre, ok, detalle = '') {
  console.log(`${ok ? '  ok  ' : ' FALLA'} ${nombre}${detalle ? ` ${detalle}` : ''}`)
  if (!ok) fallos++
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gtalks-inscripcion-'))
let n = 0
const nuevoLibro = () => path.join(TMP, `libro-${++n}.jsonl`)
const leer = (ruta) => {
  try {
    return fs.readFileSync(ruta, 'utf8')
  } catch {
    return ''
  }
}
const lineas = (ruta) => leer(ruta).split('\n').filter(Boolean).map((l) => JSON.parse(l))

// ── Graph falso ──────────────────────────────────────────────────────────────
// `guion` programa las respuestas de los próximos envíos; sin guion, 202 (que es lo que Graph
// devuelve cuando acepta un sendMail).
let peticiones = []
let guion = []
let enVuelo = 0
let maxEnVuelo = 0

const graph = http.createServer((req, res) => {
  let cuerpo = ''
  req.on('data', (d) => (cuerpo += d))
  req.on('end', async () => {
    enVuelo++
    maxEnVuelo = Math.max(maxEnVuelo, enVuelo)
    const plan = guion.shift() || { status: 202 }
    peticiones.push({
      url: req.url,
      peticionId: req.headers['client-request-id'],
      autorizacion: req.headers.authorization,
      mensaje: JSON.parse(cuerpo || '{}'),
    })
    if (plan.demoraMs) await new Promise((s) => setTimeout(s, plan.demoraMs))
    enVuelo--
    if (plan.retryAfter) res.setHeader('retry-after', String(plan.retryAfter))
    res.statusCode = plan.status
    res.setHeader('content-type', 'application/json')
    res.end(plan.status === 202 ? '' : JSON.stringify({ error: { code: plan.code || 'ErrorGenerico' } }))
  })
})
await new Promise((s) => graph.listen(0, '127.0.0.1', s))
const BASE = `http://127.0.0.1:${graph.address().port}/v1.0`

const mailerDePrueba = () =>
  crearMailer({
    obtenerToken: async () => 'token-de-prueba',
    baseUrl: BASE,
    esperar: async () => {}, // no dormir de verdad en la espera del reintento
  })

const ENTORNO = (extra = {}) => ({
  INSCRIPCION_MODO: 'lista',
  INSCRIPCION_DESTINATARIOS: 'ana@gecelca.com.co, BETO@gecelca.com.co ',
  INSCRIPCION_REMITENTE: 'foro@gecelca.com.co',
  PUBLIC_ORIGIN: 'https://gtalks.gecelca.com.co',
  MAIL_TENANT_ID: 'tenant', MAIL_CLIENT_ID: 'cliente', MAIL_CLIENT_SECRET: 'secreto',
  ...extra,
})

function arrancar(extra = {}, { conMailer = true } = {}) {
  _reiniciar()
  peticiones = []
  guion = []
  return iniciarInscripcion({
    env: ENTORNO(extra),
    mailer: conMailer ? mailerDePrueba() : undefined,
  })
}

// ── Configuración ────────────────────────────────────────────────────────────
console.log('\nConfiguración: fallo cerrado')

{
  const c = leerConfiguracion({ INSCRIPCION_MODO: 'lista', PUBLIC_ORIGIN: 'https://x' })
  check('modo lista sin destinatarios es un problema', c.problemas.some((p) => p.includes('DESTINATARIOS')))
  check('y sin credenciales de Graph, también', c.problemas.some((p) => p.includes('MAIL_')))
}
{
  const c = leerConfiguracion({ INSCRIPCION_MODO: 'encendido' })
  check('un modo inventado se rechaza', c.problemas.some((p) => p.includes('no existe')))
}
{
  const c = leerConfiguracion({})
  check('sin nada configurado, el modo es off y no hay problemas', c.modo === 'off' && !c.problemas.length)
}
{
  // Sin bloque MAIL_*, el correo usa las credenciales del login: hoy es la MISMA app, y duplicar
  // el secreto en el entorno sería que rotarlo en un sitio rompiera el correo en silencio.
  const c = leerConfiguracion({
    INSCRIPCION_MODO: 'todos',
    INSCRIPCION_REMITENTE: 'foro@gecelca.com.co',
    PUBLIC_ORIGIN: 'https://gtalks.gecelca.com.co',
    M365_TENANT_ID: 'tenant-login', M365_CLIENT_ID: 'cliente-login', M365_CLIENT_SECRET: 'secreto-login',
  })
  check('sin MAIL_*, las credenciales caen a las del login', c.graph.clientId === 'cliente-login')
  check('  y el arranque lo declara', c.credenciales.includes('MISMA app del login'), c.credenciales)
  check('  sin problemas', !c.problemas.length, c.problemas.join(' · '))
}
{
  // Todo o nada: un client id nuevo con el secreto viejo es un error, no una mezcla que adivinar.
  const c = leerConfiguracion({
    INSCRIPCION_MODO: 'todos',
    INSCRIPCION_REMITENTE: 'foro@gecelca.com.co',
    PUBLIC_ORIGIN: 'https://gtalks.gecelca.com.co',
    M365_TENANT_ID: 't', M365_CLIENT_ID: 'c', M365_CLIENT_SECRET: 's',
    MAIL_CLIENT_ID: 'solo-el-client-id',
  })
  check('un bloque MAIL_* a medias se rechaza', c.problemas.some((p) => p.includes('a medias')))
  check('  y NO mezcla con las del login', c.graph.clientId === '')
}
{
  // Una configuración a medias NO enciende el envío a medias: se apaga entero.
  const r = arrancar({ INSCRIPCION_DESTINATARIOS: '' })
  check('con configuración incompleta, el módulo queda en off', r.modo === 'off')
  check('y no reserva a nadie', reservarInscripcion({ oid: 'x', correo: 'ana@gecelca.com.co' }) === false)
}

// ── La garantía: una vez y solo una ──────────────────────────────────────────
console.log('\nIdempotencia')

const LIBRO_1 = nuevoLibro()
{
  arrancar({ INSCRIPCION_LIBRO: LIBRO_1 })

  const primera = reservarInscripcion({ oid: 'oid-ana', correo: 'ana@gecelca.com.co' })
  await enviarInscripcion({ oid: 'oid-ana', correo: 'ana@gecelca.com.co', nombre: 'Ana Ruiz Peña' })
  const segunda = reservarInscripcion({ oid: 'oid-ana', correo: 'ana@gecelca.com.co' })

  check('el primer inicio de sesión reserva', primera === true)
  check('el segundo NO reserva', segunda === false)
  check('Graph recibió exactamente UN envío', peticiones.length === 1, `${peticiones.length}`)
  check('el estado queda en enviado', estadoInscripcion('oid-ana').estado === 'enviado')
  check('con marca de tiempo', Boolean(estadoInscripcion('oid-ana').ts))

  const l = lineas(LIBRO_1)
  check('el libro anotó reserva y desenlace', l.length === 2 && l[0].estado === 'reservado' && l[1].estado === 'enviado')
  check('guarda el identificador de la petición a Graph', Boolean(l[1].peticion), l[1].peticion || '(sin peticion)')
  check(
    'y NO guarda la dirección de correo (minimización)',
    !leer(LIBRO_1).includes('ana@gecelca.com.co'),
  )

  const env = peticiones[0]
  check('el envío va al buzón remitente configurado', env.url.includes(encodeURIComponent('foro@gecelca.com.co')), env.url)
  check('con el destinatario correcto', env.mensaje.message.toRecipients[0].emailAddress.address === 'ana@gecelca.com.co')
  check('deja copia en Enviados (evidencia)', env.mensaje.saveToSentItems === true)
  check('y lleva el client-request-id que se anotó en el libro', env.peticionId === l[1].peticion)
}

console.log('\nLista blanca')

{
  const LIBRO = nuevoLibro()
  arrancar({ INSCRIPCION_LIBRO: LIBRO })

  check('quien no está en la lista no reserva', reservarInscripcion({ oid: 'oid-ajeno', correo: 'otro@gecelca.com.co' }) === false)
  check('y NO deja línea en el libro', !leer(LIBRO).includes('oid-ajeno'), leer(LIBRO).slice(0, 60))
  check('su estado es no_aplica', estadoInscripcion('oid-ajeno').estado === 'no_aplica')
  check('Graph no recibió nada', peticiones.length === 0)

  // La comparación normaliza espacios y mayúsculas: la lista trae « BETO@gecelca.com.co ».
  check('la lista no distingue mayúsculas ni espacios', reservarInscripcion({ oid: 'oid-beto', correo: 'beto@GECELCA.com.co' }) === true)
}

console.log('\nReinicio del proceso')

{
  // El libro se relee de disco: la memoria del proceso no es la garantía, el archivo sí.
  arrancar({ INSCRIPCION_LIBRO: LIBRO_1 })
  check('tras reiniciar, quien ya recibió no vuelve a reservar', reservarInscripcion({ oid: 'oid-ana', correo: 'ana@gecelca.com.co' }) === false)
  check('y sigue apareciendo como enviado', estadoInscripcion('oid-ana').estado === 'enviado')
  check('sin un solo envío nuevo', peticiones.length === 0, `${peticiones.length}`)
}

{
  // Documenta POR QUÉ el libro no puede rotar: truncado, el correo se repite.
  fs.writeFileSync(LIBRO_1, '')
  arrancar({ INSCRIPCION_LIBRO: LIBRO_1 })
  check(
    'con el libro truncado, SÍ vuelve a reservar (por eso logrotate no lo toca)',
    reservarInscripcion({ oid: 'oid-ana', correo: 'ana@gecelca.com.co' }) === true,
  )
}

{
  // Una línea ilegible no puede tumbar el arranque del sitio.
  const LIBRO = nuevoLibro()
  fs.writeFileSync(LIBRO, '{"ts":"2026-08-05T00:00:00.000Z","oid":"oid-ana","estado":"enviado"}\n{roto\n')
  arrancar({ INSCRIPCION_LIBRO: LIBRO })
  check('una línea corrupta se ignora sin romper el arranque', estadoInscripcion('oid-ana').estado === 'enviado')
}

// ── Fallos de Graph ──────────────────────────────────────────────────────────
console.log('\nFallos de Graph')

{
  const LIBRO = nuevoLibro()
  arrancar({ INSCRIPCION_LIBRO: LIBRO })
  guion = [{ status: 429, retryAfter: 1 }, { status: 202 }]

  reservarInscripcion({ oid: 'oid-ana', correo: 'ana@gecelca.com.co' })
  await enviarInscripcion({ oid: 'oid-ana', correo: 'ana@gecelca.com.co', nombre: 'Ana' })

  check('un 429 se reintenta UNA vez', peticiones.length === 2, `${peticiones.length}`)
  check('y termina en enviado', estadoInscripcion('oid-ana').estado === 'enviado')
  check(
    'el reintento conserva el mismo client-request-id',
    peticiones[0].peticionId === peticiones[1].peticionId,
  )
}

{
  const LIBRO = nuevoLibro()
  arrancar({ INSCRIPCION_LIBRO: LIBRO })
  guion = [{ status: 500, code: 'InternalServerError' }, { status: 202 }]

  reservarInscripcion({ oid: 'oid-ana', correo: 'ana@gecelca.com.co' })
  await enviarInscripcion({ oid: 'oid-ana', correo: 'ana@gecelca.com.co', nombre: 'Ana' })

  check('un 500 NO se reintenta', peticiones.length === 1, `${peticiones.length}`)
  check('y queda fallido', estadoInscripcion('oid-ana').estado === 'fallido')
  const ultima = lineas(LIBRO).at(-1)
  check('anotando el motivo de Graph', ultima.motivo === 'InternalServerError', ultima.motivo)
  check('y su código HTTP', ultima.http === 500, String(ultima.http))
  check('un fallo no libera la reserva: no se reintenta solo', reservarInscripcion({ oid: 'oid-ana', correo: 'ana@gecelca.com.co' }) === false)
}

{
  const LIBRO = nuevoLibro()
  arrancar({ INSCRIPCION_LIBRO: LIBRO })
  guion = [{ status: 403, code: 'ErrorAccessDenied' }]

  reservarInscripcion({ oid: 'oid-ana', correo: 'ana@gecelca.com.co' })
  await enviarInscripcion({ oid: 'oid-ana', correo: 'ana@gecelca.com.co', nombre: 'Ana' })
  check('un 403 tampoco se reintenta (no mejora repitiéndolo)', peticiones.length === 1, `${peticiones.length}`)
  check('y queda fallido', estadoInscripcion('oid-ana').estado === 'fallido')
}

// ── Simulacro ────────────────────────────────────────────────────────────────
console.log('\nModo simulacro')

{
  const LIBRO = nuevoLibro()
  arrancar({ INSCRIPCION_MODO: 'simulacro', INSCRIPCION_LIBRO: LIBRO })

  check('reserva igual que en modo lista', reservarInscripcion({ oid: 'oid-ana', correo: 'ana@gecelca.com.co' }) === true)
  await enviarInscripcion({ oid: 'oid-ana', correo: 'ana@gecelca.com.co', nombre: 'Ana' })
  check('pero NO llama a Graph', peticiones.length === 0, `${peticiones.length}`)
  // El ensayo escribe en su propio libro, no en el real. Ver §El ensayo no contamina el envío real.
  check('lo anota como simulado, en el libro del ensayo', lineas(`${LIBRO}.simulacro`).at(-1).estado === 'simulado')
  check('y la interfaz no anuncia nada', estadoInscripcion('oid-ana').estado === 'no_aplica')
  check('la lista blanca sigue aplicando', reservarInscripcion({ oid: 'oid-x', correo: 'otro@gecelca.com.co' }) === false)
}

// ── Concurrencia ─────────────────────────────────────────────────────────────
console.log('\nConcurrencia')

{
  const LIBRO = nuevoLibro()
  arrancar({ INSCRIPCION_MODO: 'todos', INSCRIPCION_DESTINATARIOS: '', INSCRIPCION_LIBRO: LIBRO })
  maxEnVuelo = 0
  guion = Array.from({ length: 10 }, () => ({ status: 202, demoraMs: 20 }))

  const gente = Array.from({ length: 10 }, (_, i) => ({
    oid: `oid-${i}`,
    correo: `p${i}@gecelca.com.co`,
    nombre: `Persona ${i}`,
  }))
  for (const p of gente) reservarInscripcion(p)
  await Promise.all(gente.map((p) => enviarInscripcion(p)))

  check('los diez envíos salieron', peticiones.length === 10, `${peticiones.length}`)
  check('la cola los serializa: nunca dos en vuelo', maxEnVuelo === 1, `máximo en vuelo: ${maxEnVuelo}`)
  check('los diez quedaron enviados', gente.every((p) => estadoInscripcion(p.oid).estado === 'enviado'))
}

{
  // La carrera que cierra la reserva síncrona: dos pestañas del mismo `oid` a la vez.
  const LIBRO = nuevoLibro()
  arrancar({ INSCRIPCION_MODO: 'todos', INSCRIPCION_DESTINATARIOS: '', INSCRIPCION_LIBRO: LIBRO })
  const intentos = Array.from({ length: 5 }, () => reservarInscripcion({ oid: 'oid-doble', correo: 'ana@gecelca.com.co' }))
  check('de cinco intentos simultáneos, reserva exactamente uno', intentos.filter(Boolean).length === 1)
}

// ── Blindaje del destinatario ────────────────────────────────────────────────
// La pregunta que esta sección contesta: «¿puede el correo llegarle a alguien que no sea uno de
// los tres?». Se ejecuta una población de identidades hostiles contra la lista real y se exige
// que el conjunto de direcciones que recibieron algo sea EXACTAMENTE el de la lista.
console.log('\nBlindaje del destinatario')

const AUTORIZADOS = ['jcespedes@gecelca.com.co', 'llondono@gecelca.com.co', 'lrojas@gecelca.com.co']

{
  const POBLACION = [
    // Los tres autorizados, escritos como podrían llegar del directorio.
    { correo: 'JCESPEDES@GECELCA.COM.CO', pasa: true, nota: 'en mayúsculas' },
    { correo: '  llondono@gecelca.com.co  ', pasa: true, nota: 'con espacios alrededor' },
    { correo: 'lrojas@gecelca.com.co', pasa: true, nota: 'tal cual' },

    // Vecinos: se parecen, no son.
    { correo: 'jcespedes@gecelca.com', pasa: false, nota: 'dominio recortado' },
    { correo: 'jcespedes@gecelca.com.co.evil.test', pasa: false, nota: 'dominio con sufijo' },
    { correo: 'evil.test.jcespedes@gecelca.com.co', pasa: false, nota: 'usuario con prefijo' },
    { correo: 'xjcespedes@gecelca.com.co', pasa: false, nota: 'una letra de más delante' },
    { correo: 'jcespedes2@gecelca.com.co', pasa: false, nota: 'una cifra de más detrás' },
    { correo: 'jcespedes+foro@gecelca.com.co', pasa: false, nota: 'sufijo +etiqueta' },
    { correo: 'jcespedes@correo.gecelca.com.co', pasa: false, nota: 'subdominio' },
    { correo: 'jcespedes@gecelca.com.co.', pasa: false, nota: 'punto final' },
    { correo: 'j.cespedes@gecelca.com.co', pasa: false, nota: 'punto en el usuario' },

    // Invitados B2B: llegan con el UPN mutilado del tenant.
    { correo: 'jcespedes_otraempresa.com#EXT#@gecelca.com.co', pasa: false, nota: 'invitado B2B' },
    { correo: 'llondono_gmail.com#EXT#@gecelca.com.co', pasa: false, nota: 'invitado B2B (2)' },

    // Intentos de meter un segundo destinatario por la puerta de atrás.
    { correo: 'jcespedes@gecelca.com.co,evil@evil.test', pasa: false, nota: 'coma' },
    { correo: 'jcespedes@gecelca.com.co;evil@evil.test', pasa: false, nota: 'punto y coma' },
    { correo: 'jcespedes@gecelca.com.co evil@evil.test', pasa: false, nota: 'espacio' },
    { correo: 'jcespedes@gecelca.com.co\nBcc: evil@evil.test', pasa: false, nota: 'salto de línea' },
    { correo: '"jcespedes@gecelca.com.co" <evil@evil.test>', pasa: false, nota: 'nombre para mostrar' },
    { correo: 'jcespedes@gecelca.com.co<evil@evil.test>', pasa: false, nota: 'ángulos' },

    // Homógrafos y codificaciones.
    { correo: 'jcespedes@gecelсa.com.co', pasa: false, nota: 'с cirílica en el dominio' },
    { correo: 'jcespedes@gecelca.com.cо', pasa: false, nota: 'о cirílica en el TLD' },
    { correo: 'jcespedes%40gecelca.com.co', pasa: false, nota: 'arroba percent-encoded' },
    { correo: 'jcespedes@gecelca.com.co%00evil@evil.test', pasa: false, nota: 'byte nulo' },

    // Ajenos del propio tenant y basura.
    { correo: 'otra.persona@gecelca.com.co', pasa: false, nota: 'compañero cualquiera' },
    { correo: 'presidencia@gecelca.com.co', pasa: false, nota: 'un buzón sensible' },
    { correo: 'evil@evil.test', pasa: false, nota: 'externo' },
    { correo: '', pasa: false, nota: 'vacío' },
    { correo: '   ', pasa: false, nota: 'solo espacios' },
    { correo: null, pasa: false, nota: 'null' },
    { correo: undefined, pasa: false, nota: 'undefined' },
    { correo: 'jcespedes@gecelca.com.co@evil.test', pasa: false, nota: 'doble arroba' },
  ]

  const LIBRO = nuevoLibro()
  arrancar({ INSCRIPCION_DESTINATARIOS: AUTORIZADOS.join(','), INSCRIPCION_LIBRO: LIBRO })

  let desviados = 0
  for (const [i, p] of POBLACION.entries()) {
    const persona = { oid: `pob-${i}`, correo: p.correo, nombre: `Persona ${i}` }
    const reservo = reservarInscripcion(persona)
    await enviarInscripcion(persona)
    if (reservo !== p.pasa) {
      desviados++
      console.log(` FALLA  «${p.nota}» debía ${p.pasa ? 'pasar' : 'quedar fuera'} y no lo hizo: ${JSON.stringify(p.correo)}`)
    }
  }

  check(`la población de ${POBLACION.length} identidades se resuelve como toca`, desviados === 0, `${desviados} desviación(es)`)
  check('salieron exactamente 3 correos', peticiones.length === 3, `${peticiones.length}`)

  const recibieron = peticiones.map((q) => q.mensaje.message.toRecipients[0].emailAddress.address).sort()
  check(
    'y llegaron EXACTAMENTE a las tres direcciones de la lista',
    JSON.stringify(recibieron) === JSON.stringify([...AUTORIZADOS].sort()),
    recibieron.join(', '),
  )
  check('cada mensaje lleva UN solo destinatario', peticiones.every((q) => q.mensaje.message.toRecipients.length === 1))
  check('ningún mensaje lleva copia ni copia oculta', peticiones.every((q) => !q.mensaje.message.ccRecipients && !q.mensaje.message.bccRecipients))
  check(
    'la dirección enviada sale de la CONFIGURACIÓN, no del token (normalizada)',
    recibieron.every((d) => AUTORIZADOS.includes(d)),
  )
}

{
  // El agujero estructural que tenía la versión anterior: la lista se comprobaba al reservar y el
  // envío confiaba en que el llamador pasara el mismo correo. Ahora el envío la vuelve a mirar.
  const LIBRO = nuevoLibro()
  arrancar({ INSCRIPCION_DESTINATARIOS: AUTORIZADOS.join(','), INSCRIPCION_LIBRO: LIBRO })

  check('reserva con un correo autorizado', reservarInscripcion({ oid: 'oid-cambiazo', correo: 'jcespedes@gecelca.com.co' }) === true)
  await enviarInscripcion({ oid: 'oid-cambiazo', correo: 'evil@evil.test', nombre: 'Suplantador' })
  check('si el destino cambia entre reservar y enviar, NO se envía', peticiones.length === 0, `${peticiones.length}`)
  check('y queda anotado como destino no autorizado', lineas(LIBRO).at(-1).motivo === 'destino_no_autorizado')
}

{
  // Llamar dos veces a enviar (llamador duplicado, reintento a mano) no puede dar dos correos.
  const LIBRO = nuevoLibro()
  arrancar({ INSCRIPCION_DESTINATARIOS: AUTORIZADOS.join(','), INSCRIPCION_LIBRO: LIBRO })
  const p = { oid: 'oid-doble-envio', correo: 'lrojas@gecelca.com.co', nombre: 'Luisa' }
  reservarInscripcion(p)
  await enviarInscripcion(p)
  await enviarInscripcion(p)
  await enviarInscripcion(p)
  check('tres llamadas a enviar sobre una sola reserva → UN correo', peticiones.length === 1, `${peticiones.length}`)
  check('y el registro de envío no se pisa', lineas(LIBRO).at(-1).estado === 'enviado')
}

{
  // Guardia del transporte, sin pasar por la política: el mailer se niega solo.
  peticiones = []
  const solo = crearMailer({ obtenerToken: async () => 'tk', baseUrl: BASE, esperar: async () => {} })
  const r1 = await solo.enviar({ remitente: 'foro@gecelca.com.co', para: 'a@x.test,b@y.test', asunto: 'x', html: 'x' })
  const r2 = await solo.enviar({ remitente: 'foro@gecelca.com.co,otro@x.test', para: 'a@x.test', asunto: 'x', html: 'x' })
  check('el transporte rechaza un destino con coma', r1.ok === false && r1.motivo === 'destino_invalido')
  check('y un remitente con coma', r2.ok === false && r2.motivo === 'remitente_invalido')
  check('sin llegar a tocar Graph', peticiones.length === 0, `${peticiones.length}`)
}

console.log('\nLas dos llaves del envío masivo')

{
  const c = leerConfiguracion({
    INSCRIPCION_MODO: 'todos',
    INSCRIPCION_DESTINATARIOS: AUTORIZADOS.join(','),
    INSCRIPCION_REMITENTE: 'foro@gecelca.com.co',
    PUBLIC_ORIGIN: 'https://x.test',
    M365_TENANT_ID: 't', M365_CLIENT_ID: 'c', M365_CLIENT_SECRET: 's',
  })
  check('modo `todos` con la lista puesta se rechaza', c.problemas.some((p) => p.includes('limita nada')))

  const r = arrancar({ INSCRIPCION_MODO: 'todos', INSCRIPCION_DESTINATARIOS: AUTORIZADOS.join(',') })
  check('  y el módulo queda en off, no en «todos»', r.modo === 'off')
  check('  sin escribirle a nadie', reservarInscripcion({ oid: 'x', correo: 'cualquiera@gecelca.com.co' }) === false)
}

{
  const c = leerConfiguracion({
    INSCRIPCION_MODO: 'lista',
    INSCRIPCION_DESTINATARIOS: 'jcespedes@gecelca.com.co;llondono@gecelca.com.co',
    INSCRIPCION_REMITENTE: 'foro@gecelca.com.co',
    PUBLIC_ORIGIN: 'https://x.test',
    M365_TENANT_ID: 't', M365_CLIENT_ID: 'c', M365_CLIENT_SECRET: 's',
  })
  check('separar la lista con `;` es un error ruidoso, no una lista vacía', c.problemas.some((p) => p.includes('no son direcciones')))
}

{
  const c = leerConfiguracion({
    INSCRIPCION_MODO: 'lista',
    INSCRIPCION_DESTINATARIOS: 'jcespedes@gecelca.com.co, no-es-un-correo',
    INSCRIPCION_REMITENTE: 'foro@gecelca.com.co',
    PUBLIC_ORIGIN: 'https://x.test',
    M365_TENANT_ID: 't', M365_CLIENT_ID: 'c', M365_CLIENT_SECRET: 's',
  })
  check('una entrada basura en la lista también', c.problemas.some((p) => p.includes('no son direcciones')))
}

{
  const c = leerConfiguracion({
    INSCRIPCION_MODO: 'lista',
    INSCRIPCION_DESTINATARIOS: AUTORIZADOS.join(','),
    INSCRIPCION_REMITENTE: 'foro@gecelca.com.co, otro@gecelca.com.co',
    PUBLIC_ORIGIN: 'https://x.test',
    M365_TENANT_ID: 't', M365_CLIENT_ID: 'c', M365_CLIENT_SECRET: 's',
  })
  check('un remitente con dos direcciones se rechaza', c.problemas.some((p) => p.includes('UN buzón')))
}

console.log('\nEl ensayo no contamina el envío real')

{
  // El caso que se va a ejecutar de verdad: primero simulacro, después lista. Si el ensayo
  // escribiera en el libro real, quienes lo hicieron NO recibirían el correo de verdad.
  const LIBRO = nuevoLibro()
  const yo = { oid: 'oid-jcespedes', correo: 'jcespedes@gecelca.com.co', nombre: 'Juan Pablo' }

  const ensayo = arrancar({ INSCRIPCION_MODO: 'simulacro', INSCRIPCION_DESTINATARIOS: AUTORIZADOS.join(','), INSCRIPCION_LIBRO: LIBRO })
  check('el simulacro usa un libro APARTE', ensayo.libro === `${LIBRO}.simulacro`, ensayo.libro)
  reservarInscripcion(yo)
  await enviarInscripcion(yo)
  check('  anota el ensayo', lineas(`${LIBRO}.simulacro`).at(-1).estado === 'simulado')
  check('  y deja el libro real intacto', leer(LIBRO) === '')

  arrancar({ INSCRIPCION_DESTINATARIOS: AUTORIZADOS.join(','), INSCRIPCION_LIBRO: LIBRO })
  check('al pasar a `lista`, quien ensayó SÍ recibe el correo real', reservarInscripcion(yo) === true)
  await enviarInscripcion(yo)
  check('  y sale de verdad', peticiones.length === 1, `${peticiones.length}`)
  check('  a su dirección', peticiones[0].mensaje.message.toRecipients[0].emailAddress.address === yo.correo)
}

// ── La plantilla ─────────────────────────────────────────────────────────────
console.log('\nLa plantilla')

{
  const evento = cargarEvento()
  const { asunto, html } = componerInscripcion({
    nombre: '<script>alert(1)</script> Ana',
    evento,
    url: 'https://gtalks.gecelca.com.co',
  })

  check('el asunto nombra el foro', asunto.includes(`${evento.edicion}° Foro GECELCA ${evento.marca}`), asunto)
  check('el nombre sale ESCAPADO', html.includes('&lt;script&gt;') && !html.includes('<script>'))
  check('cita la fecha del evento', html.includes(evento.fecha.texto))
  check('y el lugar', html.includes(evento.lugar))
  check('enlaza a /escarapela del origen público', html.includes('https://gtalks.gecelca.com.co/escarapela'))
  check('declara el idioma es-CO', html.includes('lang="es-CO"'))
  check('sin imágenes remotas (Outlook las bloquea, y serían rastreo)', !/<img/i.test(html))
  check('sin hojas de estilo externas', !/<link/i.test(html))
  check('no pide credenciales ni verificaciones', !/contrase|verifica tu cuenta/i.test(html))

  // Regla dura del proyecto: es-CO con TUTEO. Ningún imperativo en voseo.
  const voseo = /\b(cre[áa]|gener[áa]|abr[íi]|hac[ée]|ten[ée]|pon[ée]|eleg[íi]|guard[áa]|envi[áa]|segu[íi]|registrate|logueate)\b/i
  check('el copy no tiene voseo', !voseo.test(html.replace(/<[^>]+>/g, ' ')))
}

// ── Limpieza ─────────────────────────────────────────────────────────────────
graph.close()
fs.rmSync(TMP, { recursive: true, force: true })

console.log(fallos === 0 ? '\nCorreo de inscripción: todo en orden.\n' : `\n${fallos} verificación(es) fallaron.\n`)
process.exit(fallos === 0 ? 0 : 1)

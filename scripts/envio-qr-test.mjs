// Verificación del envío del QR de asistencia. Sale con código 1 si algo falla.
//
//   node scripts/envio-qr-test.mjs
//
// No necesita servidor, ni red, ni credenciales: el Graph al que se le habla es un `node:http` en
// loopback y los libros viven en un directorio temporal. Sí necesita Edge o Chrome, porque la
// prueba estrella exige PNG de verdad.
//
// ── La prueba estrella ───────────────────────────────────────────────────────
//
// Por cada mensaje que sale, se toma el adjunto del QR, se decodifica **el base64 real** con
// ZXing y se exige que la URL diga el usuario de ESA persona y el ID de la MAÑANA. La población
// son alias que se parecen entre sí a propósito (`jcespedes`, `jcespede`, `jcespedez`), porque un
// cruce entre dos alias muy distintos salta a la vista y entre dos parecidos no.
//
// Es la única prueba que descarta el fallo que no tiene arreglo el día del foro: que a alguien le
// llegue el código de otro y registre su asistencia sin que ninguno de los dos se entere.

import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { readBarcodes } from 'zxing-wasm/reader'
import { crearLibro } from '../server/correo/libro-inscripciones.js'
import { crearMailer } from '../server/correo/graph-mailer.js'
import { cargarEvento } from '../server/correo/evento.js'
import { cargarPiezaQr, componerEnvioQr } from '../server/correo/plantilla-envio-qr.js'
import { ID_CAPACITACION_MANANA, ID_CAPACITACION_TARDE, urlAsistencia } from '../src/data/escarapela.ts'
import { LADO_PX_CORREO, QR_TINTA, svgQrAutonomo } from '../src/data/qr-arte.ts'
import { INSTANTE_MANANA, RAIZ, urlDelCorreo } from './envio-qr-comun.mjs'
import { EnvioAbortado, decidir, procesar, resolverDestinos } from './envio-qr-nucleo.mjs'

let fallos = 0
function check(nombre, ok, detalle = '') {
  console.log(`${ok ? '  ok  ' : ' FALLA'} ${nombre}${detalle ? ` ${detalle}` : ''}`)
  if (!ok) fallos++
}


const REMITENTE = 'admapps365@gecelca.com.co'
const ORIGEN = 'https://cdp.gecelca.com.co'
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gtalks-envio-qr-'))

// ── Graph falso ──────────────────────────────────────────────────────────────
const peticiones = []
let guion = []
const graph = http.createServer((req, res) => {
  let cuerpo = ''
  req.on('data', (c) => (cuerpo += c))
  req.on('end', () => {
    peticiones.push({
      url: req.url,
      mensaje: JSON.parse(cuerpo),
      peticionId: req.headers['client-request-id'] ?? null,
    })
    const paso = guion.shift() || { status: 202 }
    const cabeceras = { 'Content-Type': 'application/json' }
    if (paso.retryAfter !== undefined) cabeceras['retry-after'] = String(paso.retryAfter)
    res.writeHead(paso.status, cabeceras)
    res.end(paso.status === 202 ? '' : JSON.stringify({ error: { code: paso.code || 'Error' } }))
  })
})
await new Promise((r) => graph.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${graph.address().port}/v1.0`

const nuevoMailer = () =>
  crearMailer({ obtenerToken: async () => 'token-de-prueba', baseUrl: BASE, esperar: async () => {} })

// ── El navegador, uno para todo el arnés ─────────────────────────────────────
let navegador = null
for (const channel of ['msedge', 'chrome']) {
  try {
    navegador = await chromium.launch({ channel })
    break
  } catch { /* siguiente */ }
}
if (!navegador) {
  console.error('\nNo hay Edge ni Chrome: el arnés necesita rasterizar QR de verdad.\n')
  process.exit(1)
}

const marcaSvg = fs.readFileSync(path.join(RAIZ, 'public', 'img', 'marca-g.svg'), 'utf8')
async function generarQr(correo) {
  const url = urlAsistencia(correo, INSTANTE_MANANA)
  const { svg, ladoPx } = svgQrAutonomo(url, { marcaSvg, ladoPx: LADO_PX_CORREO })
  const contexto = await navegador.newContext({ viewport: { width: ladoPx, height: ladoPx } })
  try {
    const pagina = await contexto.newPage()
    await pagina.setContent(
      `<style>html,body{margin:0;padding:0}#q,#q>svg{display:block;width:${ladoPx}px;height:${ladoPx}px}</style><div id="q">${svg}</div>`,
    )
    const png = await pagina.locator('#q').screenshot({ type: 'png' })
    const leido = await readBarcodes(new Uint8Array(png), { formats: ['QRCode'], tryHarder: true })
    return { url, png, leido: leido[0]?.text ?? '' }
  } finally {
    await contexto.close()
  }
}

const evento = cargarEvento()
const pieza = cargarPiezaQr()
const componerMensaje = (qrPng) => componerEnvioQr({ evento, url: ORIGEN, pieza, qrPng })

let nLibro = 0
function nuevoLibro() {
  const l = crearLibro(path.join(TMP, `libro-${++nLibro}.jsonl`))
  l.cargar()
  return l
}

const persona = (alias, extra = {}) => ({
  oid: `oid-${alias}`,
  nombre: alias,
  mail: `${alias}@gecelca.com.co`,
  upn: `${alias}@gecelca.com.co`,
  correo: `${alias}@gecelca.com.co`,
  alias,
  anomalias: [],
  ...extra,
})

async function correr(destinos, opciones = {}) {
  peticiones.length = 0
  const libro = opciones.libro || nuevoLibro()
  const resumen = await procesar({
    destinos,
    libro,
    motivos: opciones.motivos || new Map(),
    generarQr: opciones.generarQr || generarQr,
    componerMensaje,
    enviar: (m) => nuevoMailer().enviar({ remitente: REMITENTE, ...m }),
    idManana: ID_CAPACITACION_MANANA,
    modo: opciones.modo || 'lista',
    confirmar: opciones.confirmar !== false,
    maximo: opciones.maximo ?? Infinity,
    reintentar: opciones.reintentar,
    forzar: opciones.forzar,
  })
  return { resumen, libro, mensajes: peticiones.map((p) => p.mensaje.message) }
}

/** Decodifica el adjunto del QR de un mensaje capturado. Es lo que ve el destinatario. */
async function qrDelMensaje(mensaje) {
  const adj = mensaje.attachments.find((a) => a.contentId === 'qr-asistencia')
  if (!adj) return ''
  const leido = await readBarcodes(new Uint8Array(Buffer.from(adj.contentBytes, 'base64')), {
    formats: ['QRCode'],
    tryHarder: true,
  })
  return leido[0]?.text ?? ''
}

// ── La prueba estrella: cada quien recibe SU código ──────────────────────────
console.log('\nCada persona recibe su propio QR (alias parecidos a propósito)')
{
  const alias = ['jcespedes', 'jcespede', 'jcespedez', 'lrojas', 'lrojasm', 'smunevar']
  const { mensajes } = await correr(alias.map((a) => persona(a)))
  check(`salieron ${alias.length} mensajes`, mensajes.length === alias.length, `(${mensajes.length})`)

  let cruces = 0
  let sinManana = 0
  for (let i = 0; i < mensajes.length; i++) {
    const url = await qrDelMensaje(mensajes[i])
    const destinatario = mensajes[i].toRecipients[0].emailAddress.address
    const esperado = destinatario.split('@')[0]
    if (!url.includes(`USUARIO=${esperado}&`)) cruces++
    if (!url.includes(`ID_CAPACITACION=${ID_CAPACITACION_MANANA}`)) sinManana++
  }
  check('el QR de cada mensaje lleva el usuario de SU destinatario', cruces === 0, `(${cruces} cruces)`)
  check('y todos llevan el ID de la MAÑANA', sinManana === 0, `(${sinManana} sin él)`)
  check(
    'ninguno lleva el ID de la tarde',
    !mensajes.some((m) => JSON.stringify(m).includes(ID_CAPACITACION_TARDE)),
  )
}

// ── La red de seguridad: un cruce ABORTA, no se salta ────────────────────────
console.log('\nUn código cruzado aborta el proceso entero')
{
  const destinos = [persona('jcespedes'), persona('lrojas'), persona('smunevar')].map((p) => ({
    oid: p.oid,
    nombre: p.nombre,
    correo: p.correo,
    alias: p.alias,
  }))
  // Un generador saboteado: al segundo le entrega el código del primero.
  let vuelta = 0
  const saboteado = async (correo) => generarQr(++vuelta === 2 ? 'jcespedes@gecelca.com.co' : correo)
  let abortado = null
  try {
    await correr(destinos, { generarQr: saboteado })
  } catch (err) {
    abortado = err
  }
  // `correr()` pone el contador a cero al empezar, así que lo que quede aquí es lo que salió en
  // ESTA corrida: el primero, y nadie más. El tercero ni se llegó a componer.
  check('lanza EnvioAbortado', abortado instanceof EnvioAbortado, abortado ? '' : '(no lanzó)')
  check('solo salió el mensaje anterior al cruce', peticiones.length === 1, `(salieron ${peticiones.length})`)
  check(
    'y el que salió es el del primero, con su propio código',
    peticiones[0]?.mensaje.message.toRecipients[0].emailAddress.address === 'jcespedes@gecelca.com.co',
  )
}

console.log('\nUn PNG ilegible también aborta')
{
  const destinos = [persona('jcespedes')].map((p) => ({ oid: p.oid, nombre: p.nombre, correo: p.correo, alias: p.alias }))
  const ilegible = async (correo) => ({ url: urlAsistencia(correo, INSTANTE_MANANA), png: Buffer.alloc(10), leido: '' })
  let abortado = null
  try {
    await correr(destinos, { generarQr: ilegible })
  } catch (err) {
    abortado = err
  }
  check('lanza EnvioAbortado ante un código que no se lee', abortado instanceof EnvioAbortado)
}

// ── Idempotencia ─────────────────────────────────────────────────────────────
console.log('\nUna vez y solo una')
{
  const destinos = [persona('jcespedes'), persona('lrojas')].map((p) => ({
    oid: p.oid, nombre: p.nombre, correo: p.correo, alias: p.alias,
  }))
  const libro = nuevoLibro()
  const primera = await correr(destinos, { libro })
  const segunda = await correr(destinos, { libro })
  check('la primera corrida manda 2', primera.mensajes.length === 2, `(${primera.mensajes.length})`)
  check('la segunda no manda ninguno', segunda.mensajes.length === 0, `(${segunda.mensajes.length})`)
  check('y los anota como omitidos', segunda.resumen.omitidos === 2)

  const lineas = fs.readFileSync(libro.ruta, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  check('el libro tiene reservado + enviado por persona', lineas.length === 4, `(${lineas.length})`)
  check('guarda el `peticion` para casar con el message trace', lineas.some((l) => l.peticion))
  check(
    'y NO guarda la dirección de correo (minimización)',
    !fs.readFileSync(libro.ruta, 'utf8').includes('@'),
  )
}

// ── Reanudación ──────────────────────────────────────────────────────────────
console.log('\nReanudación: qué se reintenta y qué no')
{
  const prev = { estado: 'fallido' }
  check('un `enviado` no se repite nunca', decidir({ previo: { estado: 'enviado' } }).enviar === false)
  check('sin línea, se envía', decidir({ previo: null }).enviar === true)
  check('un `simulado` no cuenta como envío', decidir({ previo: { estado: 'simulado' } }).enviar === true)
  check('un `fallido` no se reintenta solo', decidir({ previo: prev }).enviar === false)
  check('con --reintentar sí', decidir({ previo: prev, reintentar: true }).enviar === true)
  check(
    'un `fallido` por timeout NO se reintenta ni con --reintentar',
    decidir({ previo: prev, motivo: 'timeout', reintentar: true }).enviar === false,
  )
  check(
    'hace falta --forzar, porque un timeout pudo haberse entregado',
    decidir({ previo: prev, motivo: 'timeout', reintentar: true, forzar: true }).enviar === true,
  )
  check('un `reservado` huérfano exige --forzar', decidir({ previo: { estado: 'reservado' } }).enviar === false)
}

// ── El par (destinatario, alias) sale de la MISMA cadena ─────────────────────
console.log('\nLa lista blanca liga el destinatario con su alias')
{
  const AUTORIZADOS = ['jcespedes@gecelca.com.co', 'lrojas@gecelca.com.co', 'smunevar@gecelca.com.co']
  const hostiles = [
    'jcespedes@gecelca.com.co.evil.test', 'evil.jcespedes@gecelca.com.co', 'jcespedes@evil.test',
    'jcespedes+etiqueta@gecelca.com.co', 'jcespedes@sub.gecelca.com.co', 'jcespede@gecelca.com.co',
    'jcespedess@gecelca.com.co', 'jcespedes@gecelca.com.co.', 'j.cespedes@gecelca.com.co',
    'jcespedes_gecelca.com.co#EXT#@otra.com', 'jсespedes@gecelca.com.co', 'jcespedes@gecelсa.com.co',
    'jcespedes%40gecelca.com.co', 'jcespedes@@gecelca.com.co', 'jcespedes@gecelca.com.co,evil@evil.test',
    'jcespedes@gecelca.com.co;evil@evil.test', 'jcespedes@gecelca.com.co evil@evil.test',
    'jcespedes@gecelca.com.co\nBcc: evil@evil.test', '"Juan" <evil@evil.test>', 'evil@evil.test',
  ]
  const audiencia = [
    ...AUTORIZADOS.map((c) => persona(c.split('@')[0])),
    // Los hostiles entran a la audiencia como si Graph los hubiera devuelto.
    ...hostiles.map((c, i) => ({
      oid: `oid-hostil-${i}`, nombre: `hostil ${i}`, mail: c, upn: c, correo: c,
      alias: c.split('@')[0], anomalias: [],
    })),
  ]
  const { destinos } = resolverDestinos({ modo: 'lista', destinatarios: AUTORIZADOS, audiencia })
  check('resuelve exactamente 3 destinos', destinos.length === 3, `(${destinos.length})`)
  check(
    'y cada alias sale de la MISMA cadena que la dirección',
    destinos.every((d) => d.alias === d.correo.split('@')[0] && AUTORIZADOS.includes(d.correo)),
  )

  const { mensajes } = await correr(destinos)
  const recibieron = mensajes.map((m) => m.toRecipients[0].emailAddress.address).sort()
  check('salen exactamente 3 mensajes', mensajes.length === 3, `(${mensajes.length})`)
  check('a exactamente las 3 direcciones de la lista', JSON.stringify(recibieron) === JSON.stringify([...AUTORIZADOS].sort()))
  check('un destinatario por mensaje', mensajes.every((m) => m.toRecipients.length === 1))
  check('ningún `cc`', mensajes.every((m) => !m.ccRecipients?.length))
  check('ningún `bcc`', mensajes.every((m) => !m.bccRecipients?.length))

  let cruces = 0
  for (const m of mensajes) {
    const url = await qrDelMensaje(m)
    if (!url.includes(`USUARIO=${m.toRecipients[0].emailAddress.address.split('@')[0]}&`)) cruces++
  }
  check('y ninguno de los tres lleva el QR de otro', cruces === 0)

  const conAnomalia = resolverDestinos({
    modo: 'todos',
    audiencia: [persona('jcespedes'), persona('ext', { anomalias: ['alias de invitado B2B (#EXT#)'] })],
  })
  check('en modo `todos`, una anomalía queda fuera', conAnomalia.destinos.length === 1 && conAnomalia.excluidos === 1)

  const falta = resolverDestinos({ modo: 'lista', destinatarios: ['nadie@gecelca.com.co'], audiencia })
  check('una entrada que no está en la audiencia es un error ruidoso', Boolean(falta.error))
}

// ── Un fallo de Graph NO puede parar la corrida ─────────────────────────────
// La distinción es deliberada y es la que evita las dos catástrofes opuestas: un QR cruzado
// ABORTA (el mecanismo está roto, no se sigue), pero un Graph que devuelve 500 en la persona 40
// de 164 solo anota `fallido` y sigue con las 124 restantes. Lo contrario dejaría a dos tercios
// del auditorio sin correo por un hipo de red.
console.log('\nUn fallo de Graph se anota y la corrida sigue')
{
  const destinos = ['f1', 'f2', 'f3'].map((a) => {
    const p = persona(a)
    return { oid: p.oid, nombre: p.nombre, correo: p.correo, alias: p.alias }
  })
  guion = [{ status: 500, code: 'InternalServerError' }]
  const { resumen, libro, mensajes } = await correr(destinos)
  guion = []
  check('se intentaron los tres', mensajes.length === 3, `(${mensajes.length})`)
  check('uno quedó fallido y dos enviados', resumen.fallidos === 1 && resumen.enviados === 2,
    `(${resumen.fallidos} fallidos / ${resumen.enviados} enviados)`)
  const lineas = fs.readFileSync(libro.ruta, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const fallida = lineas.find((l) => l.estado === 'fallido')
  check('el libro guarda el motivo y el HTTP', fallida?.motivo === 'InternalServerError' && fallida?.http === 500,
    JSON.stringify({ motivo: fallida?.motivo, http: fallida?.http }))
  check('y la reserva NO se libera: no se reintenta sola', libro.estado(destinos[0].oid).estado === 'fallido')
}

console.log('\nUn 429 se reintenta solo, con el mismo identificador')
{
  const destinos = [persona('r1')].map((p) => ({ oid: p.oid, nombre: p.nombre, correo: p.correo, alias: p.alias }))
  guion = [{ status: 429, retryAfter: 0 }]
  const { resumen } = await correr(destinos)
  guion = []
  check('Graph recibió dos intentos', peticiones.length === 2, `(${peticiones.length})`)
  check('y el desenlace es `enviado`', resumen.enviados === 1)
  // Mismo identificador en los dos intentos: es lo que permite casar una línea del libro con UNA
  // entrada del message trace de Exchange, sin quedarse con la duda de si salieron dos correos.
  const ids = peticiones.map((p) => p.peticionId)
  check('los dos intentos comparten el `client-request-id`', Boolean(ids[0]) && ids[0] === ids[1], ids.join(' / '))
}

// ── El tope ──────────────────────────────────────────────────────────────────
console.log('\nEl tope de la corrida')
{
  const destinos = ['a1', 'a2', 'a3'].map((a) => {
    const p = persona(a)
    return { oid: p.oid, nombre: p.nombre, correo: p.correo, alias: p.alias }
  })
  const { mensajes } = await correr(destinos, { maximo: 2 })
  check('--maximo 2 manda 2 de 3', mensajes.length === 2, `(${mensajes.length})`)
}

// ── La plantilla ─────────────────────────────────────────────────────────────
console.log('\nLa plantilla')
{
  const qr = await generarQr('jcespedes@gecelca.com.co')
  const { asunto, html, adjuntos } = componerMensaje(qr.png)

  // El asunto va escrito a mano como ESPECIFICACIÓN, igual que los ID de capacitación en
  // `qr-test.mjs`: es copy entregado por Comunicaciones, así que un cambio accidental tiene que
  // ponerse rojo en vez de colarse a 163 bandejas.
  check(
    'el asunto es exactamente el entregado por Comunicaciones',
    asunto === 'TE ESPERAMOS HOY EN NUESTRO 1ER FORO “ENERGÍA EN ACCIÓN”',
    `«${asunto}»`,
  )
  check('sin espacios dobles', !/ {2}/.test(asunto))
  // El asunto y el titular de la pieza dicen lo mismo, y por eso caducan juntos. Con «HOY» en el
  // asunto y la pieza de la víspera dentro, el mensaje se contradiría a sí mismo: arriba «¡Mañana
  // tenemos una importante cita!» y en la bandeja «TE ESPERAMOS HOY». Esto lo ata.
  const diaDelAsunto = /\bHOY\b/.test(asunto) ? 'hoy' : /\bMAÑANA\b/.test(asunto) ? 'víspera' : '?'
  const diaDeLaPieza = /qr hoy\.png$/.test(pieza.ruta) ? 'hoy' : 'víspera'
  check(
    'el asunto y el titular de la pieza hablan del mismo día',
    diaDelAsunto === diaDeLaPieza,
    `(asunto «${diaDelAsunto}» · pieza «${path.basename(pieza.ruta)}»)`,
  )
  check('declara el idioma es-CO', html.includes('lang="es-CO"'))
  check('sin hojas de estilo externas', !html.includes('<link'))
  check('sin imágenes remotas', !html.includes('src="http'))
  check('dos adjuntos', adjuntos.length === 2, `(${adjuntos.length})`)
  check('los dos en línea', adjuntos.every((a) => a.enLinea === true))
  check(
    'con `cid` DISTINTOS',
    adjuntos[0].contentId !== adjuntos[1].contentId,
    `${adjuntos[0].contentId} / ${adjuntos[1].contentId}`,
  )
  check('ambos referenciados en el HTML', adjuntos.every((a) => html.includes(`cid:${a.contentId}`)))
  check(
    'los bytes de la pieza son los del archivo en disco',
    adjuntos[0].contentBytes === fs.readFileSync(pieza.ruta).toString('base64'),
  )
  check('el QR viaja como image/png', adjuntos[1].contentType === 'image/png')

  // El agujero por la puerta de atrás: Outlook auto-enlaza cualquier URL suelta que encuentre.
  check('la URL de Power Apps NO aparece en el HTML', !html.includes('apps.powerapps.com'))
  const imgQr = html.match(/<img[^>]*cid:qr-asistencia[^>]*>/)?.[0] || ''
  check('el QR se pinta', Boolean(imgQr))
  check('el QR NO va envuelto en un enlace', !/<a\b[^>]*>\s*<img[^>]*cid:qr-asistencia/.test(html))
  check('con `width` y `height` como atributos (Outlook usa el motor de Word)',
    /width="\d+"/.test(imgQr) && /height="\d+"/.test(imgQr))
  check('y con texto alterno genérico, sin nombre y sin URL', /alt="Código QR de registro de asistencia"/.test(html))

  check('la pieza SÍ es clicable, hacia /escarapela', /<a href="https:\/\/[^"]*\/escarapela"[^>]*>\s*<img/.test(html))
  check('y hay un enlace textual de respaldo', (html.match(/\/escarapela/g) || []).length >= 2)

  // Regla dura del proyecto: es-CO con TUTEO.
  const voseo = /\b(cre[áa]|gener[áa]|abr[íi]|hac[ée]|ten[ée]|pon[ée]|eleg[íi]|guard[áa]|envi[áa]|segu[íi]|registrate|logueate)\b/i
  const texto = `${html.replace(/<[^>]+>/g, ' ')} ${html.match(/alt="([^"]*)"/)?.[1] || ''}`
  check('el copy no tiene voseo', !voseo.test(texto))

  let sinQr = null
  try {
    componerEnvioQr({ evento, url: ORIGEN, pieza, qrPng: Buffer.alloc(0) })
  } catch (err) {
    sinQr = err
  }
  check('sin PNG del QR, se niega a componer', sinQr instanceof Error)

  let pesado = null
  try {
    componerEnvioQr({ evento, url: ORIGEN, pieza: { contentBytes: 'A'.repeat(4e6), contentType: 'image/png' }, qrPng: qr.png })
  } catch (err) {
    pesado = err
  }
  check('un mensaje que no cabe en sendMail se rechaza antes de enviarlo', pesado instanceof Error)
}

// ── El código no caduca, y no depende de cuándo se genere ───────────────────
// La pregunta operativa del 5 de agosto: si alguien recibe su QR hoy, ¿le sirve dentro de tres
// meses? De este lado la respuesta es sí, y aquí está fijada. La URL va escrita a mano como
// ESPECIFICACIÓN: si alguien cambia el instante congelado por un `new Date()`, este bloque se
// pone rojo en cuanto se corra fuera de la mañana del 5.
console.log('\nEl contenido del QR no caduca ni depende del reloj')
{
  const ESPERADA =
    'https://apps.powerapps.com/play/e/aa05f599-12ab-ea62-936f-05fb7da5df03' +
    '/a/b12c5a65-6f11-41e4-a7e1-c05f21bd4876' +
    '?tenantId=221652a5-6cb0-4abb-a8a0-2abb849d134e&skipMobileRedirect=1' +
    '&ID_CAPACITACION=fffbd1d0-7af2-4104-ac75-87964da57c19&USUARIO=smunevar&TIPO_CAPTURA=LEIDO'

  check('la URL del correo es exactamente la esperada', urlDelCorreo('smunevar@gecelca.com.co') === ESPERADA)

  const u = new URL(urlDelCorreo('smunevar@gecelca.com.co'))
  const claves = [...u.searchParams.keys()].sort()
  check(
    'y lleva exactamente cinco parámetros, ninguno más',
    JSON.stringify(claves) === JSON.stringify(['ID_CAPACITACION', 'TIPO_CAPTURA', 'USUARIO', 'skipMobileRedirect', 'tenantId']),
    claves.join(','),
  )
  check(
    'ninguno es un token, una firma ni una marca de tiempo',
    !claves.some((k) => /exp|token|sig|time|stamp|nonce|valid|caduc/i.test(k)),
  )

  // Con el reloj del proceso en otro año y a otra hora del día, la URL no se mueve.
  const RealDate = Date
  class Falso extends RealDate {
    constructor(...a) { return a.length ? new RealDate(...a) : new RealDate('2027-03-14T22:41:00Z') }
    static now() { return new RealDate('2027-03-14T22:41:00Z').getTime() }
  }
  globalThis.Date = Falso
  const conRelojFalso = urlDelCorreo('smunevar@gecelca.com.co')
  globalThis.Date = RealDate
  check('con el reloj del sistema en 2027 y por la tarde, la URL es la misma', conRelojFalso === ESPERADA)
}

// ── El color del QR es el mismo del sistema de diseño ───────────────────────
console.log('\nCoherencia con el sistema de diseño')
{
  const tokens = fs.readFileSync(path.join(RAIZ, 'src', 'design', 'tokens.css'), 'utf8')
  const azul = tokens.match(/--gt-azul-gecelca:\s*(#[0-9a-f]{6})/i)?.[1] || ''
  check(
    'la tinta del QR es --gt-azul-gecelca, no un azul escrito a mano',
    azul.toLowerCase() === QR_TINTA.toLowerCase(),
    `tokens=${azul} qr-arte=${QR_TINTA}`,
  )
}

// ── Limpieza ─────────────────────────────────────────────────────────────────
await navegador.close()
graph.close()
fs.rmSync(TMP, { recursive: true, force: true })

console.log(fallos === 0 ? '\nEnvío del QR: todo en orden.\n' : `\n${fallos} verificación(es) fallaron.\n`)
process.exit(fallos === 0 ? 0 : 1)

// El envío ÚNICO del QR de asistencia: un correo por invitado, con su código personal dentro.
//
//   node --env-file=.env scripts/envio-qr-audiencia.mjs                          # 1. congela la audiencia
//   node --env-file=.env scripts/envio-qr.mjs --audiencia .datos/audiencia-2026-08-03.json
//                                                                                # 2. ENSAYO (no envía)
//   node --env-file=.env scripts/envio-qr.mjs --audiencia … --confirmar --maximo 4
//                                                                                # 3. las 4 pruebas
//   node --env-file=.env scripts/envio-qr.mjs --audiencia … --confirmar --maximo 163
//                                                                                # 4. el envío real
//
// Corre en la ESTACIÓN, no en el servidor: necesita Playwright, que el despliegue poda
// (`npm prune --omit=dev`). Tampoco necesita que el sitio esté levantado.
//
// ── El único fallo sin arreglo posible: que a alguien le llegue el QR de otro ─
//
// Si a Ana le llega el código de Beto, Ana registra la asistencia de Beto y ninguno de los dos se
// entera. Todo lo de aquí abajo está ordenado alrededor de impedirlo:
//
//   · Un bucle SECUENCIAL con `for…of` + `await`. Nada de `Promise.all`: la cola de
//     `graph-mailer` serializa el HTTP, pero no la composición del mensaje.
//   · Un CONTEXTO de navegador nuevo por persona, con sus datos capturados en un `const` del
//     closure. Reutilizar una página y mutar una variable compartida es, textualmente, el
//     mecanismo por el que se cruzan dos códigos.
//   · Cero memoria entre vueltas: `componerEnvioQr` es pura y aloca sus adjuntos cada vez. La
//     pieza sí se cachea (es la misma para todos); el QR JAMÁS.
//   · Y la red de seguridad: antes de enviar, el script DECODIFICA con ZXing el PNG que acaba de
//     generar y exige que diga la URL de esa persona. Si no coincide, **aborta el proceso
//     entero**, no salta a la siguiente: un cruce detectado significa que el mecanismo está roto,
//     y seguir enviando sería apostar a que solo estaba roto en esa vuelta.
//
// ── Modos, y las dos llaves ──────────────────────────────────────────────────
//
//   off        (defecto) no hace nada.
//   simulacro  recorre todo, genera y verifica los QR, pero NO llama a Graph. Escribe en
//              `<libro>.simulacro` para que ensayar no deje anotado a nadie en el libro real.
//   lista      envía SOLO a ENVIO_QR_DESTINATARIOS.
//   todos      envía a toda la audiencia congelada.
//
// Pasar de `lista` a `todos` exige cambiar el modo Y vaciar la lista: ninguna errata de una sola
// variable puede escribirle a los 163.
//
// ── Reanudación ──────────────────────────────────────────────────────────────
//
//   enviado                  nunca se repite.
//   sin línea                se envía.
//   simulado                 se envía (un ensayo no es un envío).
//   fallido                  se reintenta con --reintentar.
//   fallido por timeout      NO se reintenta sin --forzar: un timeout puede haberse ENTREGADO, y
//   reservado (huérfano)     eso se resuelve mirando Enviados o el message trace, no repitiendo.

import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { readBarcodes } from 'zxing-wasm/reader'
import { crearLibro } from '../server/correo/libro-inscripciones.js'
import { crearMailer, crearProveedorDeToken } from '../server/correo/graph-mailer.js'
import { cargarEvento } from '../server/correo/evento.js'
import { cargarPiezaQr, componerEnvioQr } from '../server/correo/plantilla-envio-qr.js'
import { ID_CAPACITACION_MANANA } from '../src/data/escarapela.ts'
import { LADO_PX_CORREO, svgQrAutonomo } from '../src/data/qr-arte.ts'
import { DIR_DATOS, DIRECCION, RAIZ, credencialesGraph, norm, urlDelCorreo } from './envio-qr-comun.mjs'
import { EnvioAbortado, procesar, resolverDestinos } from './envio-qr-nucleo.mjs'

const argv = process.argv.slice(2)
const bandera = (n) => argv.includes(n)
const opcion = (n, d) => {
  const i = argv.indexOf(n)
  return i === -1 ? d : argv[i + 1]
}

const confirmar = bandera('--confirmar')
const reintentar = bandera('--reintentar')
const forzar = bandera('--forzar')
const maximo = Number(opcion('--maximo', confirmar ? '0' : '100000'))
const ritmoMs = Number(opcion('--ritmo-ms', '3000'))
const rutaAudiencia = opcion('--audiencia', '')

function abortar(mensaje) {
  console.error(`\n${mensaje}\n`)
  process.exit(1)
}

// ── Requisitos del entorno, dichos ANTES de empezar ──────────────────────────
const [mayor, menor] = process.versions.node.split('.').map(Number)
if (mayor < 22 || (mayor === 22 && menor < 6)) {
  abortar(
    `Node ${process.versions.node}: este script importa TypeScript directamente y hace falta ` +
    'Node 22.6 o superior. Actualiza Node en la estación.',
  )
}
if (!rutaAudiencia) {
  abortar(
    'Falta --audiencia <archivo>. El envío NO consulta Graph: usa la audiencia congelada por ' +
    '`scripts/envio-qr-audiencia.mjs`, para que lo que se manda sea exactamente lo que se revisó.',
  )
}
if (confirmar && !(maximo > 0)) {
  abortar(
    'Con --confirmar hay que pasar --maximo N. Es el tope de mensajes de esta corrida: si el ' +
    'libro se perdiera, el daño son N correos repetidos y no 163.',
  )
}

// ── Configuración ────────────────────────────────────────────────────────────
const modo = norm(process.env.ENVIO_QR_MODO || 'off')
const destinatarios = String(process.env.ENVIO_QR_DESTINATARIOS || '')
  .split(',')
  .map(norm)
  .filter(Boolean)
const remitente = norm(process.env.ENVIO_QR_REMITENTE)
const origen = String(process.env.PUBLIC_ORIGIN || '').replace(/\/+$/, '')
// Ruta ABSOLUTA contra la raíz del repo, nunca contra el `cwd`: correr el script desde otra
// carpeta abriría un libro nuevo vacío y todo el mundo recibiría un segundo correo.
const libroBase = process.env.ENVIO_QR_LIBRO
  ? path.resolve(RAIZ, process.env.ENVIO_QR_LIBRO)
  : path.join(DIR_DATOS, 'envio-qr.jsonl')
const rutaLibro = modo === 'simulacro' || !confirmar ? `${libroBase}.simulacro` : libroBase

const problemas = []
if (!['off', 'simulacro', 'lista', 'todos'].includes(modo)) problemas.push(`ENVIO_QR_MODO=${modo} no existe`)
if (modo !== 'off' && !origen) problemas.push('falta PUBLIC_ORIGIN')
if ((modo === 'lista' || modo === 'simulacro') && !destinatarios.length)
  problemas.push('ENVIO_QR_DESTINATARIOS está vacía y el modo la exige')
if (modo === 'todos' && destinatarios.length)
  problemas.push('modo `todos` con ENVIO_QR_DESTINATARIOS puesta: son las dos llaves, no una lista que se ignora')
if (destinatarios.some((d) => !DIRECCION.test(d)))
  problemas.push('hay entradas de ENVIO_QR_DESTINATARIOS que no son direcciones')
if ((modo === 'lista' || modo === 'todos') && !DIRECCION.test(remitente))
  problemas.push('ENVIO_QR_REMITENTE tiene que ser UNA dirección')
if (problemas.length) abortar(`Configuración incompleta:\n  · ${problemas.join('\n  · ')}`)
if (modo === 'off') abortar('ENVIO_QR_MODO=off: la función no existe. Nada que hacer.')

const evento = cargarEvento()
const pieza = cargarPiezaQr()
const audienciaArchivo = JSON.parse(fs.readFileSync(path.resolve(RAIZ, rutaAudiencia), 'utf8'))
const audiencia = audienciaArchivo.audiencia || []

console.log('\nEnvío del QR de asistencia')
console.log(`  modo        ${modo}${confirmar ? ' · CONFIRMADO (se envía de verdad)' : ' · ENSAYO (no se envía nada)'}`)
console.log(`  audiencia   ${rutaAudiencia} (${audiencia.length} personas, congelada ${audienciaArchivo.generado})`)
console.log(`  remitente   ${remitente || '(sin remitente)'}`)
console.log(`  libro       ${rutaLibro}`)
console.log(`  tope        ${confirmar ? maximo : 'sin tope (ensayo)'}`)
console.log(`  ritmo       ${ritmoMs} ms entre mensajes`)
console.log(`  pieza       ${path.basename(pieza.ruta)}${pieza.provisional ? '  ⚠ PROVISIONAL' : ''}`)
if (pieza.provisional) {
  console.log('              ↑ es la pieza del correo de INSCRIPCIÓN. El arte definitivo de este')
  console.log('                envío va en «imagen correo qr.png» y todavía no está en el repo.')
}

// El envío a TODOS con la pieza provisional es el error caro de este trabajo: 163 personas con el
// arte equivocado y un libro que dice `enviado`, así que no hay segunda oportunidad. Una línea de
// aviso en la consola no basta se lee y se olvida, y por eso aquí se ABORTA. Las pruebas en
// modo `lista` sí pueden salir con la provisional: para verificar el renderizado y el escaneo, el
// arte da igual, y esperar a Comunicaciones habría dejado eso sin probar.
if (modo === 'todos' && confirmar && pieza.provisional && !bandera('--con-pieza-provisional')) {
  abortar(
    'ABORTADO: ibas a escribirle a TODA la audiencia con la pieza PROVISIONAL.\n' +
    '  Deja el arte definitivo en «imagen correo qr.png» (raíz del repo), commitéalo y vuelve a\n' +
    '  correr `node scripts/envio-qr-test.mjs`. Si de verdad quieres enviar con la provisional,\n' +
    '  pásale --con-pieza-provisional.',
  )
}

// El `.env` de la ESTACIÓN tiene `PUBLIC_ORIGIN=http://localhost:5173`, que es lo correcto para
// desarrollar el flujo OIDC lo valida contra `M365_REDIRECT_URI` al arrancar y una catástrofe
// silenciosa para un envío masivo: los 165 correos llevarían un «Abre tu escarapela digital» que
// apunta al portátil de quien los mandó. No se ve en el asunto, ni en la pieza, ni en el QR; solo
// se descubre cuando alguien toca el enlace. Casi pasa el 2026-08-04.
//
// Por eso el envío real EXIGE un origen público, y la forma de dárselo es en la línea de comando
// (`PUBLIC_ORIGIN=https://… node --env-file=.env …`), que tiene precedencia sobre el `.env` y no
// obliga a tocar un archivo del que depende el login local.
if (confirmar && !/^https:\/\//i.test(origen)) {
  abortar(
    `ABORTADO: PUBLIC_ORIGIN es «${origen}», y el correo enlaza ahí.\n` +
    '  Un envío real necesita el dominio público por HTTPS. Vuelve a lanzarlo así:\n' +
    '    PUBLIC_ORIGIN=https://cdp.gecelca.com.co node --env-file=.env scripts/envio-qr.mjs …',
  )
}

// ── A quién se le escribe, y con qué alias ───────────────────────────────────
const resuelto = resolverDestinos({ modo, destinatarios, audiencia })
if (resuelto.error) abortar(resuelto.error)
if (resuelto.excluidos) {
  console.log(`\n  ${resuelto.excluidos} persona(s) con anomalías quedan fuera (revísalas en la audiencia).`)
}
const destinos = resuelto.destinos

// ── El libro ─────────────────────────────────────────────────────────────────
fs.mkdirSync(path.dirname(rutaLibro), { recursive: true })
const libro = crearLibro(rutaLibro)
libro.cargar()

/** Lee el motivo de la última línea de cada `oid`: el libro en memoria solo guarda estado y `ts`. */
function motivosDelLibro() {
  const m = new Map()
  if (!fs.existsSync(rutaLibro)) return m
  for (const linea of fs.readFileSync(rutaLibro, 'utf8').split('\n')) {
    if (!linea.trim()) continue
    try {
      const r = JSON.parse(linea)
      if (r.oid) m.set(r.oid, r.motivo || '')
    } catch { /* línea corrupta: la ignora igual que el libro */ }
  }
  return m
}
const motivos = motivosDelLibro()

// ── El navegador y la marca ──────────────────────────────────────────────────
const marcaSvg = fs.readFileSync(path.join(RAIZ, 'public', 'img', 'marca-g.svg'), 'utf8')
let navegador = null
for (const channel of ['msedge', 'chrome']) {
  try {
    navegador = await chromium.launch({ channel })
    break
  } catch { /* probamos el siguiente */ }
}
if (!navegador) abortar('No hay Edge ni Chrome disponibles: el QR se rasteriza con el navegador del sistema.')

const dirQr = path.join(DIR_DATOS, 'qr')
fs.mkdirSync(dirQr, { recursive: true })

/**
 * Genera el PNG del QR de UNA persona y lo verifica leyéndolo. Todo lo que devuelve nace en esta
 * llamada: no hay buffer ni archivo compartido entre personas.
 */
async function rasterizarUnaVez(url) {
  const { svg, ladoPx } = svgQrAutonomo(url, { marcaSvg, ladoPx: LADO_PX_CORREO })
  const contexto = await navegador.newContext({ viewport: { width: ladoPx, height: ladoPx } })
  try {
    const pagina = await contexto.newPage()
    await pagina.setContent(
      `<style>html,body{margin:0;padding:0}#q,#q>svg{display:block;width:${ladoPx}px;height:${ladoPx}px}</style><div id="q">${svg}</div>`,
    )
    const png = await pagina.locator('#q').screenshot({ type: 'png' })
    const leido = await readBarcodes(new Uint8Array(png), { formats: ['QRCode'], tryHarder: true })
    return { png, leido: leido[0]?.text ?? '' }
  } finally {
    await contexto.close()
  }
}

async function generarQr(correo) {
  // La URL sale del MISMO `correo` que va en el `para`, con la misma función que usa la
  // escarapela. El alias no se pasa por parámetro para que no pueda desparejarse: se deriva aquí
  // y quien llama lo comprueba contra el suyo. `urlDelCorreo` congela la jornada de la mañana:
  // el contenido NO depende de cuándo se corra el script.
  const url = urlDelCorreo(correo)

  // Un segundo intento si el primero no se deja leer. NO debilita la detección de cruces: un
  // código cruzado es DETERMINISTA el SVG lleva la URL equivocada y el reintento la volvería a
  // llevar, así que solo sobrevive al reintento lo que era un tropiezo del rasterizado. Y sin
  // esto, un tropiezo en la persona 120 de 163 abortaría la corrida entera.
  let r = await rasterizarUnaVez(url)
  if (r.leido !== url) {
    console.log(`  ··  reintentando el rasterizado de ${correo.split('@')[0]}`)
    r = await rasterizarUnaVez(url)
  }
  return { url, png: r.png, leido: r.leido }
}

// ── Transporte ───────────────────────────────────────────────────────────────
let mailer = null
if (confirmar && modo !== 'simulacro') {
  mailer = crearMailer({ obtenerToken: crearProveedorDeToken(credencialesGraph(process.env)) })
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

// ── El bucle ─────────────────────────────────────────────────────────────────
console.log(`\nProcesando ${destinos.length} destino(s)…\n`)
let resumen
try {
  resumen = await procesar({
    destinos,
    libro,
    motivos,
    generarQr,
    componerMensaje: (qrPng) => componerEnvioQr({ evento, url: origen, pieza, qrPng }),
    enviar: (mensaje) => mailer.enviar({ remitente, ...mensaje }),
    guardarPng: (alias, png) => fs.writeFileSync(path.join(dirQr, `${alias}.png`), png),
    idManana: ID_CAPACITACION_MANANA,
    modo,
    confirmar,
    maximo,
    reintentar,
    forzar,
    ritmoMs,
    dormir,
    log: console.log,
  })
} catch (err) {
  await navegador.close()
  if (err instanceof EnvioAbortado) abortar(`ABORTADO. ${err.message}`)
  throw err
}

await navegador.close()

console.log('\nResumen')
console.log(`  QR generados y verificados  ${resumen.generados}`)
console.log(`  enviados                    ${resumen.enviados}`)
console.log(`  simulados                   ${resumen.simulados}`)
console.log(`  fallidos                    ${resumen.fallidos}`)
console.log(`  omitidos                    ${resumen.omitidos}`)
console.log(`\n  Los PNG quedaron en ${dirQr}  ábrelos y mira unos cuantos al azar.`)
console.log(`  El libro es ${rutaLibro}: RESPÁLDALO, es la memoria de «una sola vez».`)
if (confirmar && modo !== 'simulacro') {
  console.log(`  Y cuadra el conteo con la carpeta Enviados de ${remitente}: ese es el registro autoritativo.`)
}
console.log('')
process.exit(resumen.fallidos === 0 ? 0 : 1)

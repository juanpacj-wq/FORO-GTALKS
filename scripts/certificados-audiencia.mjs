// La audiencia del certificado de participación se CONGELA en un archivo revisable.
//
//   node --env-file=.env scripts/certificados-audiencia.mjs
//   node --env-file=.env scripts/certificados-audiencia.mjs --esperados 135
//
// ── Quién recibe certificado, y de dónde sale ────────────────────────────────
//
// La fuente es el REGISTRO DE ASISTENCIA, no el grupo de invitados: certifica quien fue.
// Concretamente: la hoja `Hoja1` de «ASISTENCIA FORO.xlsx» (completada contra Entra y contra la
// planta el 2026-08-10) más los tres contratistas que asistieron sin escanear QR, que están en
// `.datos/planta-contratistas-2026-08-10.txt` y no en la hoja. Los 14 de la hoja «query (13)»
// que no pasaron a Hoja1 quedan FUERA por decisión del usuario (2026-08-10) — si eso cambia,
// se re-congela, no se parchea.
//
// ── Por qué se congela, y por qué se revisa a mano ───────────────────────────
//
// El mismo argumento que `envio-qr-audiencia.mjs`: el generador de PDFs no debe consultar ni el
// Excel ni Graph — entre «quién es la audiencia» y «generar los artefactos» tiene que mediar un
// archivo que un humano pueda leer, corregir y volver a verificar. Aquí además se DERIVA un dato
// (el nombre en el orden «NOMBRES APELLIDOS», en mayúsculas) y toda derivación puede equivocarse:
// la que no particione limpio queda marcada como anomalía y NO deja escribir el archivo final
// hasta que alguien la resuelva editando la lista de excepciones de abajo.
//
// ── La clave es el `oid` ─────────────────────────────────────────────────────
//
// El servidor entregará el PDF buscando el `oid` de la sesión en el manifiesto. Un correo cambia
// de forma (mayúsculas, alias), un UPN puede cambiar entero; el `oid` no. Por eso cada persona se
// resuelve contra Graph aquí, UNA vez, y el resto de la cadena no vuelve a tocar el directorio.

import fs from 'node:fs'
import path from 'node:path'
import { crearProveedorDeToken } from '../server/correo/graph-mailer.js'
import { DIR_DATOS, RAIZ, credencialesGraph, crearVerificador, norm } from './envio-qr-comun.mjs'
import { usuarioDeCorreo } from '../src/data/escarapela.ts'
import { abrirLibro } from './xlsx-editar.mjs'

const GRAPH = 'https://graph.microsoft.com/v1.0'

const argv = process.argv.slice(2)
const opcion = (n, d) => {
  const i = argv.indexOf(n)
  return i === -1 ? d : argv[i + 1]
}
// 135 asistentes menos Howard (sin cuenta en Entra → entrega manual) = 134 descargables.
const esperados = Number(opcion('--esperados', '134'))
const rutaXlsx = path.resolve(RAIZ, opcion('--archivo', 'ASISTENCIA FORO.xlsx'))
const rutaPlanta = path.resolve(RAIZ, opcion('--planta', '.datos/planta-contratistas-2026-08-10.txt'))

function abortar(mensaje) {
  console.error(`\n✗ ${mensaje}\n`)
  process.exit(1)
}

// ── Los tres que asistieron sin QR ───────────────────────────────────────────
// Van por NOMBRE, no por correo: la planta no trae direcciones. Se resuelven contra el
// directorio con el criterio de `personas-resolver.mjs`: UNA coincidencia exacta o nada.
const SIN_QR = [
  'HOWARD DIAZ GRANADOS CATRIN',
  'LOPEZ HINCAPIE ALEJANDRO JOSE',
  'AGAMEZ CALDERON DANILO',
]

// Quien se sabe SIN cuenta en Entra no bloquea el congelado: no puede iniciar sesión, así que su
// certificado se entrega a mano. Queda registrado en el JSON bajo `entregaManual` para que nadie
// lo relea como olvido. Comprobado contra el directorio el 2026-08-10: cero coincidencias.
const SIN_CUENTA = new Set([
  'HOWARD DIAZ GRANADOS CATRIN',
])

// ── Excepciones del ORDEN del nombre ─────────────────────────────────────────
// Cuando givenName/surname de Entra no permiten particionar el NOMBRE del Excel sin ambigüedad,
// la fila cae aquí, a mano, tras mirarla. La clave es el correo; el valor, el nombre YA ordenado
// «Nombres Apellidos» (la caja no importa: se sube a mayúsculas después).
// Los nueve de abajo son la convención «Apellidos Nombres» del Excel con una grafía que difiere
// de la de Entra en una letra (Jimenes/Jimenez, Escaf/Escaff, Bustillos/Bustillo, Echeverry/
// Echeverri, Barbosa/Barboza, Yennifer/Yenifer, Degiovany/Degiovanni) o con partículas que Entra
// no registra («De La Concepcion», «De Jesus»). Se REORDENA conservando la grafía del Excel: es
// la fuente del listado de asistencia. Si alguna grafía resulta estar mal en el Excel, se
// corrige ALLÍ y se re-congela — no aquí.
const ORDEN_A_MANO = new Map([
  ['cconsuegra@gecelca.com.co', 'Camilo Andres Consuegra Jimenes'],
  ['adegiovanni@gecelca.com.co', 'Augusto Rafael Degiovany Mejia'],
  ['namin@gecelca.com.co', 'Nicolle Amin Escaf'],
  ['mbustillo@gecelca.com.co', 'Maria Claudia Bustillos Lopez'],
  ['jpadillae@gecelca.com.co', 'Javier Eduardo Padilla Echeverry'],
  ['tgomez@gecelca.com.co', 'Teresa Gomez Barbosa'],
  ['ytorrenegra@gecelca.com.co', 'Yennifer Yojana Torrenegra Antequera'],
  ['lcrismatt@gecelca.com.co', 'Liliana De La Concepcion Crismatt Castillo'],
  ['nvilla@gecelca.com.co', 'Neicer De Jesus Villa Jimenez'],
])

/** Palabras normalizadas (sin tildes, sin ñ/n, MAYÚSCULAS) — el criterio de personas-resolver. */
const palabras = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z\s]/g, ' ').replace(/\s+/g, ' ').trim()
  .split(' ').filter(Boolean)

const mismas = (a, b) => a.length === b.length && [...a].sort().join(' ') === [...b].sort().join(' ')

/**
 * Ordena el nombre del Excel como «Nombres Apellidos» usando los campos de Entra.
 *
 * No se COPIA el displayName de Entra (a veces está incompleto: «Renato Reyes Bilbao» sin el
 * «Andrés», «Maria Daniela Miranda» sin el «Agressott»): se REORDENAN las palabras del Excel,
 * que es la fuente completa. givenName/surname solo dicen qué palabra es nombre y cuál apellido.
 * Devuelve { nombre, fuente } o null si no particiona limpio.
 */
function ordenarNombre(nombreExcel, u) {
  const total = String(nombreExcel).replace(/\s+/g, ' ').trim().split(' ')
  const setNombres = new Set(palabras(u.givenName))
  const setApellidos = new Set(palabras(u.surname))
  if (!setNombres.size || !setApellidos.size) return null

  // Cada palabra del Excel tiene que caer en exactamente un lado. Una que caiga en los dos
  // («De» en givenName y surname a la vez) o en ninguno hace la partición ambigua.
  const nombres = []
  const apellidos = []
  for (const cruda of total) {
    const p = palabras(cruda)[0]
    if (!p) return null
    const esNombre = setNombres.has(p)
    const esApellido = setApellidos.has(p)
    if (esNombre === esApellido) return null
    ;(esNombre ? nombres : apellidos).push(cruda)
  }
  if (!nombres.length || !apellidos.length) return null

  // El displayName de Entra ya viene «Nombres Apellidos»: si sus palabras coinciden con las del
  // Excel, sirve además de contraste del ORDEN interno de cada mitad.
  return { nombre: [...nombres, ...apellidos].join(' '), fuente: 'entra:givenName/surname' }
}

/** 1003239160 → 1.003.239.160 */
const conPuntos = (ced) => String(ced).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

// ── Leer las fuentes ─────────────────────────────────────────────────────────
const CABECERAS = ['USUARIO', 'NOMBRE', 'CEDULA', 'TIPO', 'SEDE', 'EMPRESA', 'TIPO_IDENTIFICACION', 'POLITICA', 'CARGO', 'DEPENDENCIA', 'NIVEL']
const libro = abrirLibro(rutaXlsx, 'Hoja1', CABECERAS, abortar)
const filas = libro.filas
console.log(`\nCongelar la audiencia del certificado`)
console.log(`  asistencia  ${path.relative(RAIZ, rutaXlsx)} · ${filas.length} filas`)

if (!fs.existsSync(rutaPlanta)) abortar(`No existe ${rutaPlanta} (los 3 sin QR salen de ahí).`)
const plantaLineas = fs.readFileSync(rutaPlanta, 'utf8').split(/\r?\n/)
  .map((l) => l.split('#')[0].trim()).filter(Boolean)
const cedulaDePlanta = new Map()
for (const linea of plantaLineas) {
  const m = /^(.*?)[\t ]{1,}([\d.\-\s]+)$/.exec(linea)
  if (!m) continue
  cedulaDePlanta.set(palabras(m[1]).sort().join(' '), m[2].replace(/[.\-\s]/g, ''))
}
console.log(`  planta      ${path.relative(RAIZ, rutaPlanta)} · ${cedulaDePlanta.size} cédulas`)

// ── El directorio, una vez ───────────────────────────────────────────────────
const cred = credencialesGraph(process.env)
console.log(`  credencial  ${cred.origen}`)
const token = await (crearProveedorDeToken(cred))()
const cabeceras = { Authorization: `Bearer ${token}` }
async function pedir(url) {
  const r = await fetch(url, { headers: cabeceras, signal: AbortSignal.timeout(60_000) })
  if (r.ok) return r.json()
  let codigo = ''
  try { codigo = (await r.json())?.error?.code || '' } catch { /* Graph no siempre da JSON */ }
  abortar(`Graph respondió ${r.status}${codigo ? ` (${codigo})` : ''} en ${url.replace(GRAPH, '')}`)
}

const usuarios = []
let url = `${GRAPH}/users?$select=id,displayName,givenName,surname,mail,userPrincipalName,accountEnabled&$top=999`
while (url) {
  const c = await pedir(url)
  usuarios.push(...(c.value || []))
  url = c['@odata.nextLink'] || null
}
console.log(`  directorio  ${usuarios.length} usuarios\n`)

const porCorreo = new Map()
for (const u of usuarios) {
  for (const k of [u.mail, u.userPrincipalName]) {
    const c = norm(k)
    if (!c) continue
    if (!porCorreo.has(c)) porCorreo.set(c, u)
    else if (porCorreo.get(c)?.id !== u.id) porCorreo.set(c, null) // ambigüedad pegajosa
  }
}
const indexados = usuarios
  .filter((u) => norm(u.mail || u.userPrincipalName).endsWith('@gecelca.com.co'))
  .map((u) => ({ u, p: palabras(u.displayName) }))

// ── Componer la audiencia ────────────────────────────────────────────────────
const personas = []
const anomaliasGlobales = []

function componer({ correo, nombreExcel, cedula, origen }) {
  const u = porCorreo.get(norm(correo))
  const anomalias = []
  if (u === null) anomalias.push('el correo apunta a dos usuarios distintos del directorio')
  if (!u) anomalias.push('no está en el directorio de Entra: no podrá iniciar sesión')

  let nombrePintado = ''
  let fuenteDelOrden = ''
  const aMano = ORDEN_A_MANO.get(norm(correo))
  if (aMano) {
    if (!mismas(palabras(aMano), palabras(nombreExcel))) {
      anomalias.push(`ORDEN_A_MANO no usa las mismas palabras que el Excel («${aMano}» vs «${nombreExcel}»)`)
    }
    nombrePintado = aMano.toLocaleUpperCase('es')
    fuenteDelOrden = 'a-mano'
  } else if (u) {
    const ordenado = ordenarNombre(nombreExcel, u)
    if (ordenado) {
      nombrePintado = ordenado.nombre.toLocaleUpperCase('es')
      fuenteDelOrden = ordenado.fuente
    } else if (mismas(palabras(u.displayName), palabras(nombreExcel))) {
      // El displayName trae exactamente las mismas palabras: su orden ya es «Nombres Apellidos».
      nombrePintado = String(u.displayName).replace(/\s+/g, ' ').trim().toLocaleUpperCase('es')
      fuenteDelOrden = 'entra:displayName'
    } else {
      anomalias.push('el orden del nombre no se puede derivar: añadir a ORDEN_A_MANO')
    }
  }

  if (!/^\d{5,12}$/.test(String(cedula))) anomalias.push(`cédula rara: «${cedula}»`)
  if (u && u.accountEnabled === false) anomalias.push('cuenta deshabilitada: no podrá iniciar sesión')

  const alias = usuarioDeCorreo(norm(correo))
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(alias)) anomalias.push(`alias raro para nombre de archivo: «${alias}»`)

  personas.push({
    oid: u?.id ?? '',
    correo: norm(correo),
    alias,
    nombreExcel: String(nombreExcel).replace(/\s+/g, ' ').trim(),
    nombrePintado,
    cedula: String(cedula),
    cedulaPintada: conPuntos(cedula),
    fuenteDelOrden,
    accountEnabled: u ? u.accountEnabled !== false : false,
    origen,
    anomalias,
  })
  if (anomalias.length) anomaliasGlobales.push({ correo: norm(correo), anomalias })
}

for (const f of filas) {
  componer({ correo: f.USUARIO, nombreExcel: f.NOMBRE, cedula: String(f.CEDULA ?? '').trim(), origen: 'hoja1' })
}

// Los tres sin QR: nombre exacto (una coincidencia y solo una) contra el directorio.
const entregaManual = []
for (const pedido of SIN_QR) {
  const pp = palabras(pedido)
  const clavePlanta = [...pp].sort().join(' ')
  const cedula = cedulaDePlanta.get(clavePlanta)
  if (!cedula) { anomaliasGlobales.push({ correo: `(sin resolver) ${pedido}`, anomalias: ['no está en la lista de la planta'] }); continue }
  if (SIN_CUENTA.has(pedido)) {
    entregaManual.push({ nombre: pedido, cedula, motivo: 'sin cuenta en Entra: no puede iniciar sesión' })
    continue
  }
  const exactas = indexados.filter((x) => mismas(x.p, pp))
  const contenidas = exactas.length ? [] : indexados.filter((x) => {
    const resto = [...x.p]
    return pp.every((w) => { const i = resto.indexOf(w); if (i === -1) return false; resto.splice(i, 1); return true })
  })
  const casadas = exactas.length ? exactas : contenidas
  if (casadas.length !== 1) {
    anomaliasGlobales.push({
      correo: `(sin resolver) ${pedido}`,
      anomalias: [`${casadas.length} coincidencias en el directorio${casadas.length ? ': ' + casadas.map((c) => c.u.displayName).join(' · ') : ''} — si de verdad no tiene cuenta, pásalo a SIN_CUENTA`],
    })
    continue
  }
  const u = casadas[0].u
  componer({ correo: u.mail || u.userPrincipalName, nombreExcel: pedido, cedula, origen: 'planta-sin-qr' })
}

// ── Verificar ────────────────────────────────────────────────────────────────
const { estado, check } = crearVerificador()
check(`la audiencia trae ${esperados} personas`, personas.length === esperados, `(hay ${personas.length})`)
const repetidos = (xs) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map())].filter(([, n]) => n > 1).map(([k]) => k)
check('ningún oid repetido', repetidos(personas.map((p) => p.oid).filter(Boolean)).length === 0)
check('ningún alias repetido — dos alias iguales son dos PDF que se pisan', repetidos(personas.map((p) => p.alias)).length === 0)
check('ninguna cédula repetida', repetidos(personas.map((p) => p.cedula)).length === 0)
check('todas con oid (sin él no hay descarga)', personas.every((p) => p.oid))
check('todas con nombre pintado', personas.every((p) => p.nombrePintado))
check('ninguna anomalía sin resolver', anomaliasGlobales.length === 0)

if (anomaliasGlobales.length) {
  console.log('\nAnomalías (se resuelven editando ORDEN_A_MANO o mirando el directorio):')
  for (const a of anomaliasGlobales) console.log(`  · ${a.correo}\n      ${a.anomalias.join('\n      ')}`)
}

console.log(`\nOrden del nombre: ${JSON.stringify(personas.reduce((m, p) => ({ ...m, [p.fuenteDelOrden || '(sin)']: (m[p.fuenteDelOrden || '(sin)'] ?? 0) + 1 }), {}))}`)

if (estado.fallos) {
  abortar(`${estado.fallos} comprobación(es) fallida(s): NO se escribe la audiencia. Media lista sería peor que ninguna.`)
}

// ── Escribir ─────────────────────────────────────────────────────────────────
personas.sort((a, b) => a.alias.localeCompare(b.alias, 'es'))
const hoy = new Date().toISOString().slice(0, 10)
const destino = path.join(DIR_DATOS, `certificados-audiencia-${hoy}.json`)
if (fs.existsSync(destino)) {
  abortar(`${destino} ya existe y NO se sobrescribe: es el registro de a quién se le iba a generar. Bórralo a mano si de verdad quieres re-congelar.`)
}
fs.writeFileSync(destino, JSON.stringify({ generado: new Date().toISOString(), esperados, personas, entregaManual }, null, 2), { mode: 0o640 })

console.log(`\n✔ Audiencia congelada: ${personas.length} personas → ${path.relative(RAIZ, destino)}`)
for (const e of entregaManual) console.log(`  ⚠ ENTREGA MANUAL: ${e.nombre} (C.C. ${e.cedula}) — ${e.motivo}`)
console.log('\nRevisa el archivo A MANO antes de generar — sobre todo cada `nombrePintado`: es lo que')
console.log('va impreso en el diploma de esa persona. El siguiente paso es:')
console.log(`  .venv-design/Scripts/python scripts/certificados-generar.py --audiencia ${path.relative(RAIZ, destino).replace(/\\/g, '/')}\n`)

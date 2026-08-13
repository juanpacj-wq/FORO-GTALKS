// Completa NOMBRE y CEDULA de la hoja de asistencia con lo que dice el directorio de Entra.
//
//   node --env-file=.env scripts/asistencia-completar.mjs                 # ENSAYO: no escribe
//   node --env-file=.env scripts/asistencia-completar.mjs --confirmar     # escribe (con respaldo)
//
// ── Por qué existe ───────────────────────────────────────────────────────────
//
// El listado sale de la lista de SharePoint de capacitaciones, que se surte de la planta de
// personal. A los CONTRATISTAS no los cubre esa planta, así que llegan con NOMBRE vacío y con
// CEDULA en «No Disponible». El directorio de Entra sí los tiene dados de alta tienen correo
// corporativo y entraron al foro con él, así que es la única fuente disponible para taparlo.
//
// ── Qué se rellena, y qué NO ─────────────────────────────────────────────────
//
//   NOMBRE  ← `displayName`. Se copia LITERAL, en el orden del directorio («Nombres Apellidos»),
//             que NO es el de la columna («Apellidos Nombres»). Se decidió así a propósito:
//             `surname` trae un solo apellido en 8 de los 13 casos, con lo que reordenar sería
//             adivinar dónde cortar. Un nombre en otro orden se ve; un apellido inventado no.
//
//   CEDULA  ← `employeeId`, y solo cuando lo hay. Que `employeeId` ES la cédula no se supone: el
//             script lo COMPRUEBA contra las filas que ya la traen y aborta si alguna discrepa.
//             En el tenant solo 144 usuarios lo tienen relleno, así que la mayoría de los huecos
//             de cédula NO se pueden cerrar por aquí y se dejan como están.
//
// ── Fallo cerrado ────────────────────────────────────────────────────────────
//
// Nunca se pisa un dato que ya esté. Nunca se escribe una cédula que contradiga a la del Excel.
// Si un USUARIO no resuelve contra el directorio, o si `employeeId` discrepa de una cédula ya
// escrita, el archivo NO se toca: un listado medio corregido es peor que uno con huecos, porque
// los huecos se ven y una corrección equivocada no.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { crearProveedorDeToken } from '../server/correo/graph-mailer.js'
import { RAIZ, credencialesGraph, norm } from './envio-qr-comun.mjs'

const GRAPH = 'https://graph.microsoft.com/v1.0'

const argv = process.argv.slice(2)
const opcion = (n, d) => {
  const i = argv.indexOf(n)
  return i === -1 ? d : argv[i + 1]
}
const confirmar = argv.includes('--confirmar')
const rutaXlsx = path.resolve(RAIZ, opcion('--archivo', 'ASISTENCIA FORO.xlsx'))
const nombreHoja = opcion('--hoja', 'Hoja1')

function abortar(mensaje) {
  console.error(`\n✗ ${mensaje}\n`)
  process.exit(1)
}

// ── ZIP: leer y volver a escribir preservando todas las partes ───────────────
const TABLA_CRC = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
const crc32 = (buf) => {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = TABLA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/** Descomprime el .xlsx a un mapa nombre → bytes, conservando el orden de las entradas. */
function leerZip(buf) {
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  if (eocd === -1) abortar('El archivo no es un ZIP válido (¿está abierto en Excel a medio guardar?).')
  const n = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  const entradas = []
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) abortar('Directorio central del ZIP corrupto.')
    const metodo = buf.readUInt16LE(off + 10)
    const tamComp = buf.readUInt32LE(off + 20)
    const lenNombre = buf.readUInt16LE(off + 28)
    const lenExtra = buf.readUInt16LE(off + 30)
    const lenCom = buf.readUInt16LE(off + 32)
    const offLocal = buf.readUInt32LE(off + 42)
    const nombre = buf.toString('utf8', off + 46, off + 46 + lenNombre)
    const inicio = offLocal + 30 + buf.readUInt16LE(offLocal + 26) + buf.readUInt16LE(offLocal + 28)
    const crudo = buf.subarray(inicio, inicio + tamComp)
    entradas.push({ nombre, datos: metodo === 8 ? zlib.inflateRawSync(crudo) : Buffer.from(crudo) })
    off += 46 + lenNombre + lenExtra + lenCom
  }
  return entradas
}

function escribirZip(entradas) {
  const locales = []; const central = []; let offset = 0
  for (const { nombre, datos } of entradas) {
    const nb = Buffer.from(nombre, 'utf8')
    const comp = zlib.deflateRawSync(datos, { level: 9 })
    const crc = crc32(datos)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6)
    local.writeUInt16LE(8, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0x0021, 12)
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(datos.length, 22)
    local.writeUInt16LE(nb.length, 26); local.writeUInt16LE(0, 28)
    locales.push(local, nb, comp)
    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6)
    dir.writeUInt16LE(0, 8); dir.writeUInt16LE(8, 10); dir.writeUInt16LE(0, 12); dir.writeUInt16LE(0x0021, 14)
    dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(comp.length, 20); dir.writeUInt32LE(datos.length, 24)
    dir.writeUInt16LE(nb.length, 28); dir.writeUInt32LE(offset, 42)
    central.push(dir, nb)
    offset += 30 + nb.length + comp.length
  }
  const directorio = Buffer.concat(central)
  const fin = Buffer.alloc(22)
  fin.writeUInt32LE(0x06054b50, 0)
  fin.writeUInt16LE(entradas.length, 8); fin.writeUInt16LE(entradas.length, 10)
  fin.writeUInt32LE(directorio.length, 12); fin.writeUInt32LE(offset, 16)
  return Buffer.concat([...locales, directorio, fin])
}

// ── XML del .xlsx ────────────────────────────────────────────────────────────
const desesc = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&amp;/g, '&')
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** El texto de un `<si>`: concatena sus `<t>` (un `<si>` con formato se parte en varios `<r>`). */
function textoSi(xml) {
  const partes = []
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\s*\/>/g
  let m
  while ((m = re.exec(xml))) partes.push(desesc(m[1] ?? ''))
  return partes.join('')
}

function leerSst(xml) {
  const res = []
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\s*\/>/g
  let m
  while ((m = re.exec(xml))) res.push(m[1] === undefined ? '' : textoSi(m[1]))
  return res
}

const colNum = (ref) => {
  let n = 0
  for (const c of ref.match(/^[A-Z]+/)[0]) n = n * 26 + (c.charCodeAt(0) - 64)
  return n
}

/** Las filas de una hoja como objetos por nombre de columna. `[^>]*?` es PEREZOSO a propósito:
 *  con el codicioso, una celda vacía `<c r="C10"/>` se come la barra, falla la rama `/>`, entra
 *  por la rama `>` y adopta como contenido el `<v>` de la celda siguiente. */
function leerHoja(xml, sst, cabeceras) {
  const filas = []
  const reFila = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g
  let mf
  while ((mf = reFila.exec(xml))) {
    const r = +(mf[1].match(/\br="(\d+)"/)?.[1] ?? 0)
    const o = { _r: r }
    const reC = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
    let mc
    while ((mc = reC.exec(mf[2] ?? ''))) {
      const ref = mc[1].match(/\br="([A-Z]+\d+)"/)?.[1]
      if (!ref) continue
      const t = mc[1].match(/\bt="([^"]+)"/)?.[1] ?? 'n'
      const cont = mc[2] ?? ''
      const v = t === 's' ? (sst[+(cont.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? -1)] ?? '')
        : t === 'inlineStr' ? textoSi(cont)
        : desesc(cont.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '')
      o[cabeceras[colNum(ref) - 1] ?? ref] = v
    }
    filas.push(o)
  }
  return filas
}

// ── 1. Leer el libro ─────────────────────────────────────────────────────────
if (!fs.existsSync(rutaXlsx)) abortar(`No existe ${rutaXlsx}`)
const entradas = leerZip(fs.readFileSync(rutaXlsx))
const parte = (n) => entradas.find((e) => e.nombre === n)

const wb = parte('xl/workbook.xml')?.datos.toString('utf8') ?? abortar('Sin xl/workbook.xml')
const hojas = [...wb.matchAll(/<sheet\b[^>]*name="([^"]*)"[^>]*sheetId="(\d+)"[^>]*r:id="rId(\d+)"/g)]
  .map((m) => ({ nombre: desesc(m[1]), rId: +m[3] }))
const wbRels = parte('xl/_rels/workbook.xml.rels')?.datos.toString('utf8') ?? ''
const destino = hojas.find((h) => h.nombre === nombreHoja)
if (!destino) abortar(`El libro no tiene una hoja «${nombreHoja}». Tiene: ${hojas.map((h) => h.nombre).join(', ')}`)
const objetivo = new RegExp(`Id="rId${destino.rId}"[^>]*Target="([^"]+)"`).exec(wbRels)?.[1]
if (!objetivo) abortar(`No se resuelve el destino de la hoja «${nombreHoja}».`)
const rutaHoja = 'xl/' + objetivo.replace(/^\/?/, '')

const partSst = parte('xl/sharedStrings.xml')
if (!partSst) abortar('El libro no tiene xl/sharedStrings.xml.')
let xmlSst = partSst.datos.toString('utf8')
const sst = leerSst(xmlSst)

const partHoja = parte(rutaHoja)
if (!partHoja) abortar(`No existe la parte ${rutaHoja}.`)
let xmlHoja = partHoja.datos.toString('utf8')

const CABECERAS = ['USUARIO', 'NOMBRE', 'CEDULA', 'TIPO', 'SEDE', 'EMPRESA', 'TIPO_IDENTIFICACION', 'POLITICA', 'CARGO', 'DEPENDENCIA', 'NIVEL']
const filas = leerHoja(xmlHoja, sst, CABECERAS).filter((f) => f._r > 1)

// La cabecera real, para no escribir a ciegas en la columna equivocada si el libro cambia.
const cabeceraReal = leerHoja(xmlHoja, sst, CABECERAS).find((f) => f._r === 1)
for (const [i, esperada] of ['USUARIO', 'NOMBRE', 'CEDULA'].entries()) {
  const puesta = cabeceraReal?.[CABECERAS[i]]
  if (norm(puesta).toUpperCase() !== esperada) {
    abortar(`La columna ${String.fromCharCode(65 + i)} de «${nombreHoja}» dice «${puesta}», no «${esperada}». No se escribe a ciegas.`)
  }
}

console.log(`\nCompletar la asistencia desde el directorio`)
console.log(`  archivo   ${path.relative(RAIZ, rutaXlsx)}`)
console.log(`  hoja      ${nombreHoja}  (${rutaHoja})`)
console.log(`  filas     ${filas.length}`)
console.log(`  modo      ${confirmar ? 'ESCRIBE' : 'ENSAYO (no escribe)'}`)

// ── 2. El directorio ─────────────────────────────────────────────────────────
const cred = credencialesGraph(process.env)
console.log(`  credencial ${cred.origen}\n`)
const token = await (crearProveedorDeToken(cred))()
const cabeceras = { Authorization: `Bearer ${token}` }

async function pedir(url) {
  const r = await fetch(url, { headers: cabeceras, signal: AbortSignal.timeout(60_000) })
  if (r.ok) return r.json()
  let codigo = ''
  try { codigo = (await r.json())?.error?.code || '' } catch { /* Graph no siempre da JSON */ }
  abortar(`Graph respondió ${r.status}${codigo ? ` (${codigo})` : ''} en ${url.replace(GRAPH, '')}`)
}

// Se trae el directorio ENTERO por el mismo motivo que `personas-resolver.mjs`: pedir usuario a
// usuario deja que Graph elija por relevancia, y aquí no se puede aceptar «el mejor».
const SEL = 'id,displayName,mail,userPrincipalName,employeeId,jobTitle,department,accountEnabled'
const usuarios = []
let url = `${GRAPH}/users?$select=${SEL}&$top=999`
let paginas = 0
while (url) {
  const c = await pedir(url)
  usuarios.push(...(c.value || []))
  paginas++
  url = c['@odata.nextLink'] || null
}
console.log(`Directorio: ${usuarios.length} usuarios en ${paginas} página(s).`)

const porCorreo = new Map()
for (const u of usuarios) {
  for (const k of [u.mail, u.userPrincipalName]) {
    const c = norm(k)
    if (!c) continue
    // Un correo que apunte a dos usuarios distintos es ambigüedad, y la ambigüedad se aborta.
    // `null` es la marca de «ambiguo» y es PEGAJOSA: una tercera aparición no puede deshacerla.
    if (!porCorreo.has(c)) porCorreo.set(c, u)
    else if (porCorreo.get(c)?.id !== u.id) porCorreo.set(c, null)
  }
}

// ── 3. ¿`employeeId` es de verdad la cédula? ─────────────────────────────────
const esCedula = (s) => /^\d{5,12}$/.test(norm(s))
let coinciden = 0
const discrepan = []
for (const f of filas) {
  if (!esCedula(f.CEDULA)) continue
  const u = porCorreo.get(norm(f.USUARIO))
  if (!u?.employeeId) continue
  if (String(u.employeeId) === norm(f.CEDULA)) coinciden++
  else discrepan.push(`r${f._r} ${f.USUARIO}: el Excel dice ${norm(f.CEDULA)} y el directorio ${u.employeeId} (${u.displayName})`)
}
console.log(`\n«employeeId» contra las cédulas que el Excel YA trae: ${coinciden} coinciden, ${discrepan.length} discrepan.`)
if (discrepan.length) {
  abortar(
    `El directorio contradice al Excel en ${discrepan.length} fila(s):\n    ` + discrepan.join('\n    ') +
    '\n  Si «employeeId» no es la cédula, rellenar con él sería inventar. No se escribe nada.',
  )
}
if (!coinciden) {
  abortar('Ni una sola fila permite comprobar que «employeeId» sea la cédula. Sin esa prueba no se rellena.')
}

// ── 4. Qué hay que rellenar ──────────────────────────────────────────────────
const cambios = []
const sinFuente = []
for (const f of filas) {
  const faltaNombre = !norm(f.NOMBRE)
  const faltaCedula = !esCedula(f.CEDULA)
  if (!faltaNombre && !faltaCedula) continue

  const correo = norm(f.USUARIO)
  const u = porCorreo.get(correo)
  if (u === null) abortar(`r${f._r}: «${f.USUARIO}» apunta a más de un usuario del directorio. Ambiguo: no se escribe nada.`)
  if (!u) { sinFuente.push({ fila: f._r, usuario: f.USUARIO, motivo: 'no está en el directorio' }); continue }

  const c = { fila: f._r, usuario: f.USUARIO, dir: u }
  if (faltaNombre) {
    if (!norm(u.displayName)) { sinFuente.push({ fila: f._r, usuario: f.USUARIO, motivo: 'el directorio no le pone nombre' }); }
    else c.nombre = String(u.displayName).trim()
  }
  if (faltaCedula) {
    if (esCedula(u.employeeId)) c.cedula = String(u.employeeId).trim()
    else sinFuente.push({ fila: f._r, usuario: f.USUARIO, motivo: `sin cédula en el directorio (employeeId=${u.employeeId ?? 'vacío'})`, cedulaActual: norm(f.CEDULA) })
  }
  if (c.nombre || c.cedula) cambios.push(c)
}

console.log('\n' + '─'.repeat(104))
console.log('FILA  USUARIO                          NOMBRE que se escribe                CEDULA')
console.log('─'.repeat(104))
for (const c of cambios) {
  console.log(
    `${String(c.fila).padStart(4)}  ${c.usuario.padEnd(32)} ${(c.nombre ?? '(ya la tiene)').padEnd(36)} ${c.cedula ?? '(sin cambio)'}`,
  )
}
console.log('─'.repeat(104))
console.log(`\n${cambios.length} fila(s) a completar · ${cambios.filter((c) => c.nombre).length} nombre(s) · ${cambios.filter((c) => c.cedula).length} cédula(s)`)

if (sinFuente.length) {
  console.log(`\n⚠ ${sinFuente.length} hueco(s) que el directorio NO puede cerrar (se dejan como están):`)
  for (const s of sinFuente) console.log(`    r${String(s.fila).padStart(3)} ${s.usuario.padEnd(32)} ${s.motivo}`)
}

if (!cambios.length) {
  console.log('\nNada que hacer.\n')
  process.exit(0)
}

// ── 5. Escribir ──────────────────────────────────────────────────────────────
if (!confirmar) {
  console.log('\nEnsayo: no se ha tocado el archivo. Repite con --confirmar para escribirlo.\n')
  process.exit(0)
}

// Índice de cadena compartida, reutilizando la que ya exista (el .xlsx las deduplica).
const indiceSst = new Map(sst.map((s, i) => [s, i]))
const nuevas = []
let refsNuevas = 0
function idxDe(texto) {
  if (indiceSst.has(texto)) return indiceSst.get(texto)
  const i = sst.length + nuevas.length
  nuevas.push(texto)
  indiceSst.set(texto, i)
  return i
}

/** Reemplaza el `<v>` de una celda que ya existe, exigiendo que sea `t="s"`. */
function repuntarCelda(ref, idx) {
  const re = new RegExp(`(<c r="${ref}"[^>]*\\bt="s"[^>]*>)<v>\\d+</v>(</c>)`)
  if (!re.test(xmlHoja)) abortar(`No se encuentra la celda ${ref} como cadena compartida. No se escribe nada.`)
  xmlHoja = xmlHoja.replace(re, `$1<v>${idx}</v>$2`)
}

/** Inserta una celda que NO existe, justo detrás de la celda `previa` de su misma fila. */
function insertarCelda(ref, previa, idx) {
  if (new RegExp(`<c r="${ref}"[\\s>/]`).test(xmlHoja)) abortar(`La celda ${ref} ya existe: no se pisa. No se escribe nada.`)
  const re = new RegExp(`(<c r="${previa}"[^>]*?(?:/>|>[\\s\\S]*?</c>))`)
  if (!re.test(xmlHoja)) abortar(`No se encuentra la celda ${previa}, que es donde iría ${ref}. No se escribe nada.`)
  xmlHoja = xmlHoja.replace(re, `$1<c r="${ref}" t="s"><v>${idx}</v></c>`)
  refsNuevas++
}

for (const c of cambios) {
  if (c.nombre) insertarCelda(`B${c.fila}`, `A${c.fila}`, idxDe(c.nombre))
  if (c.cedula) repuntarCelda(`C${c.fila}`, idxDe(c.cedula))
}

// sharedStrings: se añaden los `<si>` nuevos y se corrigen los dos contadores.
if (nuevas.length) {
  const bloque = nuevas.map((s) => `<si><t${/^\s|\s$/.test(s) ? ' xml:space="preserve"' : ''}>${esc(s)}</t></si>`).join('')
  if (!xmlSst.includes('</sst>')) abortar('xl/sharedStrings.xml no cierra con </sst>.')
  xmlSst = xmlSst.replace('</sst>', `${bloque}</sst>`)
}
xmlSst = xmlSst.replace(/(<sst\b[^>]*?)\bcount="(\d+)"/, (_, pre, n) => `${pre}count="${+n + refsNuevas}"`)
xmlSst = xmlSst.replace(/(<sst\b[^>]*?)\buniqueCount="(\d+)"/, (_, pre, n) => `${pre}uniqueCount="${+n + nuevas.length}"`)

partHoja.datos = Buffer.from(xmlHoja, 'utf8')
partSst.datos = Buffer.from(xmlSst, 'utf8')

const sello = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const respaldo = rutaXlsx.replace(/\.xlsx$/i, '') + ` (antes de completar ${sello}).xlsx`
fs.copyFileSync(rutaXlsx, respaldo)
try {
  fs.writeFileSync(rutaXlsx, escribirZip(entradas))
} catch (e) {
  if (e.code === 'EBUSY' || e.code === 'EPERM') {
    abortar(`No se puede escribir ${path.basename(rutaXlsx)}: ¿lo tienes abierto en Excel? Ciérralo y repite.`)
  }
  throw e
}

// ── 6. Releer lo escrito ─────────────────────────────────────────────────────
// El archivo se comprueba abriéndolo otra vez, no dando por bueno lo que se creyó escribir.
const releidas = (() => {
  const e2 = leerZip(fs.readFileSync(rutaXlsx))
  const sst2 = leerSst(e2.find((x) => x.nombre === 'xl/sharedStrings.xml').datos.toString('utf8'))
  return leerHoja(e2.find((x) => x.nombre === rutaHoja).datos.toString('utf8'), sst2, CABECERAS)
})()
const porFila = new Map(releidas.map((f) => [f._r, f]))

let fallos = 0
for (const c of cambios) {
  const f = porFila.get(c.fila)
  if (c.nombre && norm(f?.NOMBRE) !== norm(c.nombre)) { console.log(` FALLA r${c.fila} NOMBRE: quedó «${f?.NOMBRE}»`); fallos++ }
  if (c.cedula && norm(f?.CEDULA) !== norm(c.cedula)) { console.log(` FALLA r${c.fila} CEDULA: quedó «${f?.CEDULA}»`); fallos++ }
}
// Y que NO se haya movido nada más: mismo número de filas y mismos USUARIO en el mismo sitio.
if (releidas.filter((f) => f._r > 1).length !== filas.length) { console.log(' FALLA cambió el número de filas'); fallos++ }
for (const f of filas) {
  if (norm(porFila.get(f._r)?.USUARIO) !== norm(f.USUARIO)) { console.log(` FALLA r${f._r} el USUARIO ya no es el mismo`); fallos++ }
}
const cambiadas = new Set(cambios.map((c) => c.fila))
for (const f of filas) {
  if (cambiadas.has(f._r)) continue
  const g = porFila.get(f._r)
  if (norm(g?.NOMBRE) !== norm(f.NOMBRE) || norm(g?.CEDULA) !== norm(f.CEDULA)) {
    console.log(` FALLA r${f._r} se tocó una fila que no había que tocar`); fallos++
  }
}

if (fallos) abortar(`${fallos} comprobación(es) fallida(s). El original está en «${path.basename(respaldo)}».`)

console.log(`\n✔ Escrito y releído: ${cambios.length} fila(s) completadas, el resto intacto.`)
console.log(`  archivo  ${path.relative(RAIZ, rutaXlsx)}`)
console.log(`  respaldo ${path.relative(RAIZ, respaldo)}\n`)

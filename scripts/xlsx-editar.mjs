// Editar celdas de TEXTO en un .xlsx que ya existe, sin dependencias y sin tocar nada más.
//
// Es el gemelo de `xlsx-minimo.mjs`: aquél CREA un libro desde cero, éste MODIFICA uno ajeno.
// Son problemas distintos. Al crear, uno manda sobre las 6 partes del paquete; al modificar, el
// libro trae 18 tablas, una consulta viva a SharePoint, estilos, tema y la única regla que
// importa es no romper ninguna. Por eso aquí se descomprimen TODAS las entradas y se vuelven a
// escribir tal cual, y solo se tocan `sharedStrings.xml` y la hoja de destino.
//
// Alcance deliberado: celdas de texto en columnas que ya existen. Ni filas nuevas, ni fórmulas,
// ni formatos. Lo que este módulo no sabe hacer, aborta.
//
// ── Dos cosas que no son obvias y que costaron ───────────────────────────────
//
//  1. La expresión de las celdas lleva `[^>]*?` PEREZOSO. Con el codicioso, una celda vacía
//     `<c r="C10" s="1"/>` se come la barra, falla la rama `/>`, entra por la rama `>` y adopta
//     como contenido el `<v>` de la celda SIGUIENTE. El síntoma es un valor que aparece en la
//     columna de al lado y no en la suya, y no lo delata ningún error.
//  2. Las celdas de una fila van ORDENADAS por columna. Una celda nueva no se añade al final:
//     se inserta detrás de la última que le precede. Excel abre el archivo igual, pero el
//     `ListObject` de la tabla deja de cuadrar y la hoja se ve corrida.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

// ── ZIP ──────────────────────────────────────────────────────────────────────
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

/** Todas las entradas del ZIP, descomprimidas y EN ORDEN. */
export function leerZip(buf, abortar = (m) => { throw new Error(m) }) {
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
    // Los tamaños se toman del directorio central, no de la cabecera local: con descriptor de
    // datos (bit 3 de las banderas) la local los trae en cero y se leería una entrada vacía.
    const inicio = offLocal + 30 + buf.readUInt16LE(offLocal + 26) + buf.readUInt16LE(offLocal + 28)
    const crudo = buf.subarray(inicio, inicio + tamComp)
    entradas.push({ nombre, datos: metodo === 8 ? zlib.inflateRawSync(crudo) : Buffer.from(crudo) })
    off += 46 + lenNombre + lenExtra + lenCom
  }
  return entradas
}

export function escribirZip(entradas) {
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

// ── XML ──────────────────────────────────────────────────────────────────────
const desesc = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&amp;/g, '&')

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // Los caracteres de control no son válidos en XML 1.0 y Excel da por corrupto el libro entero
  // por uno solo. Un nombre traído de un directorio o de un pegado puede arrastrarlos.
  // eslint-disable-next-line no-control-regex
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')

/** El texto de un `<si>`: se concatenan sus `<t>`, porque uno con formato se parte en varios `<r>`. */
function textoSi(xml) {
  const partes = []
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\s*\/>/g
  let m
  while ((m = re.exec(xml))) partes.push(desesc(m[1] ?? ''))
  return partes.join('')
}

export function leerSst(xml) {
  const res = []
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\s*\/>/g
  let m
  while ((m = re.exec(xml))) res.push(m[1] === undefined ? '' : textoSi(m[1]))
  return res
}

/** «C» → 3, «AA» → 27. */
export const colNum = (letras) => {
  let n = 0
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64)
  return n
}
/** 3 → «C», 27 → «AA». */
export const colLetra = (n) => {
  let s = ''
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) }
  return s
}

const RE_FILA = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g
const RE_CELDA = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g

/** Las filas de una hoja como objetos, con las claves que digan `cabeceras`. */
export function leerHoja(xml, sst, cabeceras) {
  const filas = []
  RE_FILA.lastIndex = 0
  let mf
  while ((mf = RE_FILA.exec(xml))) {
    const r = +(mf[1].match(/\br="(\d+)"/)?.[1] ?? 0)
    const o = { _r: r }
    const reC = new RegExp(RE_CELDA.source, 'g')
    let mc
    while ((mc = reC.exec(mf[2] ?? ''))) {
      const ref = mc[1].match(/\br="([A-Z]+)(\d+)"/)
      if (!ref) continue
      const t = mc[1].match(/\bt="([^"]+)"/)?.[1] ?? 'n'
      const cont = mc[2] ?? ''
      const v = t === 's' ? (sst[+(cont.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? -1)] ?? '')
        : t === 'inlineStr' ? textoSi(cont)
        : desesc(cont.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '')
      o[cabeceras[colNum(ref[1]) - 1] ?? ref[1]] = v
    }
    filas.push(o)
  }
  return filas
}

// ── La API que usan los scripts ──────────────────────────────────────────────

/**
 * Abre el libro, localiza la hoja por su NOMBRE (no por el número de parte: `Hoja1` es
 * `sheet2.xml` en este libro, y dar por buena la correspondencia sería escribir en la otra) y
 * comprueba que la fila 1 diga lo que se espera antes de dejar tocar nada.
 */
export function abrirLibro(rutaXlsx, nombreHoja, cabeceras, abortar) {
  if (!fs.existsSync(rutaXlsx)) abortar(`No existe ${rutaXlsx}`)
  const entradas = leerZip(fs.readFileSync(rutaXlsx), abortar)
  const parte = (n) => entradas.find((e) => e.nombre === n)

  const wb = parte('xl/workbook.xml')?.datos.toString('utf8')
  if (!wb) abortar('El libro no tiene xl/workbook.xml.')
  const hojas = [...wb.matchAll(/<sheet\b[^>]*?name="([^"]*)"[^>]*?r:id="rId(\d+)"/g)]
    .map((m) => ({ nombre: desesc(m[1]), rId: +m[2] }))
  const destino = hojas.find((h) => h.nombre === nombreHoja)
  if (!destino) abortar(`El libro no tiene una hoja «${nombreHoja}». Tiene: ${hojas.map((h) => h.nombre).join(', ')}`)

  const rels = parte('xl/_rels/workbook.xml.rels')?.datos.toString('utf8') ?? ''
  const objetivo = new RegExp(`Id="rId${destino.rId}"[^>]*?Target="([^"]+)"`).exec(rels)?.[1]
  if (!objetivo) abortar(`No se resuelve el destino de la hoja «${nombreHoja}».`)
  const rutaHoja = 'xl/' + objetivo.replace(/^\/?/, '')

  const partSst = parte('xl/sharedStrings.xml')
  if (!partSst) abortar('El libro no tiene xl/sharedStrings.xml.')
  const partHoja = parte(rutaHoja)
  if (!partHoja) abortar(`No existe la parte ${rutaHoja}.`)

  const sst = leerSst(partSst.datos.toString('utf8'))
  const todas = leerHoja(partHoja.datos.toString('utf8'), sst, cabeceras)

  // La cabecera real, para no escribir a ciegas si el libro se reordena algún día.
  const cabecera = todas.find((f) => f._r === 1)
  for (const [i, esperada] of cabeceras.entries()) {
    if (!esperada) continue
    const puesta = String(cabecera?.[esperada] ?? '').trim().toUpperCase()
    if (puesta !== esperada.toUpperCase()) {
      abortar(`La columna ${colLetra(i + 1)} de «${nombreHoja}» no dice «${esperada}» (dice «${puesta}»). No se escribe a ciegas.`)
    }
  }

  return {
    rutaXlsx, rutaHoja, nombreHoja, cabeceras, entradas, partSst, partHoja, sst,
    filas: todas.filter((f) => f._r > 1),
    /** Vuelve a abrir el archivo del DISCO: comprobar sobre lo que se creyó escribir no comprueba nada. */
    releer() {
      const e = leerZip(fs.readFileSync(rutaXlsx), abortar)
      const s = leerSst(e.find((x) => x.nombre === 'xl/sharedStrings.xml').datos.toString('utf8'))
      const f = leerHoja(e.find((x) => x.nombre === rutaHoja).datos.toString('utf8'), s, cabeceras)
      return new Map(f.map((x) => [x._r, x]))
    },
  }
}

/**
 * Escribe los cambios y devuelve la ruta del respaldo.
 * `cambios`: `[{ fila, <NOMBRE DE COLUMNA>: 'valor', … }]`, con las claves de `cabeceras`.
 */
export function escribirLibro(libro, cambios, abortar) {
  let xmlHoja = libro.partHoja.datos.toString('utf8')
  let xmlSst = libro.partSst.datos.toString('utf8')

  // Índice de cadenas compartidas, reutilizando las que ya existan: el .xlsx las deduplica y
  // añadir una repetida engorda el archivo sin motivo.
  const indice = new Map(libro.sst.map((s, i) => [s, i]))
  const nuevas = []
  let refsNuevas = 0
  const idxDe = (texto) => {
    if (indice.has(texto)) return indice.get(texto)
    const i = libro.sst.length + nuevas.length
    nuevas.push(texto)
    indice.set(texto, i)
    return i
  }

  for (const c of cambios) {
    for (const clave of Object.keys(c)) {
      if (clave === 'fila') continue
      const col = libro.cabeceras.indexOf(clave) + 1
      if (!col) abortar(`«${clave}» no es una columna conocida de la hoja.`)
      const ref = `${colLetra(col)}${c.fila}`
      const idx = idxDe(String(c[clave]))

      const reExiste = new RegExp(`<c r="${ref}"(?=[\\s/>])[^>]*?(?:/>|>[\\s\\S]*?</c>)`)
      const existente = reExiste.exec(xmlHoja)

      if (existente) {
        // Repuntar: la celda ya está y tiene que ser una cadena compartida.
        const reRep = new RegExp(`(<c r="${ref}"(?=[\\s/>])[^>]*?\\bt="s"[^>]*?>)<v>\\d+</v>(</c>)`)
        if (!reRep.test(xmlHoja)) abortar(`La celda ${ref} existe pero no es una cadena compartida editable: ${existente[0].slice(0, 80)}`)
        xmlHoja = xmlHoja.replace(reRep, `$1<v>${idx}</v>$2`)
        continue
      }

      // Insertar: hay que meterla DETRÁS de la última celda que la precede en su fila, porque
      // las celdas de una fila van ordenadas por columna.
      const reFila = new RegExp(`<row\\b[^>]*?\\br="${c.fila}"[^>]*?>([\\s\\S]*?)</row>`)
      const mFila = reFila.exec(xmlHoja)
      if (!mFila) abortar(`No existe la fila ${c.fila} en la hoja: no se crean filas.`)
      const reC = new RegExp(RE_CELDA.source, 'g')
      let mc, previa = null
      while ((mc = reC.exec(mFila[1]))) {
        const r = mc[1].match(/\br="([A-Z]+)\d+"/)
        if (r && colNum(r[1]) < col) previa = mc[0]
      }
      const celda = `<c r="${ref}" t="s"><v>${idx}</v></c>`
      const cuerpo = previa
        ? mFila[1].replace(previa, previa + celda)
        : celda + mFila[1]
      xmlHoja = xmlHoja.replace(mFila[0], mFila[0].replace(mFila[1], cuerpo))
      refsNuevas++
    }
  }

  if (nuevas.length) {
    const bloque = nuevas
      .map((s) => `<si><t${/^\s|\s$/.test(s) ? ' xml:space="preserve"' : ''}>${esc(s)}</t></si>`)
      .join('')
    if (!xmlSst.includes('</sst>')) abortar('xl/sharedStrings.xml no cierra con </sst>.')
    xmlSst = xmlSst.replace('</sst>', `${bloque}</sst>`)
  }
  // `count` son las REFERENCIAS a cadenas y `uniqueCount` los `<si>`. Repuntar una celda no
  // cambia el primero; insertarla, sí.
  xmlSst = xmlSst.replace(/(<sst\b[^>]*?)\bcount="(\d+)"/, (_, p, n) => `${p}count="${+n + refsNuevas}"`)
  xmlSst = xmlSst.replace(/(<sst\b[^>]*?)\buniqueCount="(\d+)"/, (_, p, n) => `${p}uniqueCount="${+n + nuevas.length}"`)

  libro.partHoja.datos = Buffer.from(xmlHoja, 'utf8')
  libro.partSst.datos = Buffer.from(xmlSst, 'utf8')

  const sello = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const respaldo = libro.rutaXlsx.replace(/\.xlsx$/i, '') + ` (antes de ${sello}).xlsx`
  fs.copyFileSync(libro.rutaXlsx, respaldo)
  try {
    fs.writeFileSync(libro.rutaXlsx, escribirZip(libro.entradas))
  } catch (e) {
    if (e.code === 'EBUSY' || e.code === 'EPERM') {
      abortar(`No se puede escribir ${path.basename(libro.rutaXlsx)}: ¿lo tienes abierto en Excel? Ciérralo y repite.`)
    }
    throw e
  }
  return respaldo
}

// Un .xlsx de verdad, sin dependencias. Tablas de texto y nada más.
//
// Por qué no un CSV a secas: Excel en español abre los CSV con `;` o con `,` según la
// configuración regional de cada máquina, así que el mismo archivo se ve bien en una estación y
// en una sola columna en la de al lado. Un .xlsx no tiene ese problema, y por eso la pieza que
// se entrega es esta (el CSV se genera también, como respaldo).
//
// Por qué no una librería: `npm ci` aquí instala el lockfile y este repo no añade dependencias
// para un listado. Un .xlsx es un ZIP con cuatro XML dentro; escribirlos cuesta menos que
// justificar el paquete.
//
// Alcance deliberado: celdas de TEXTO (`inlineStr`), fila de encabezado en negrita, panel
// congelado y autofiltro. Sin fórmulas, sin fechas numéricas, sin formatos condicionales. Las
// fechas van como texto `AAAA-MM-DD HH:MM`, que ordena igual que una fecha de verdad y no
// depende de la zona horaria de quien abra el archivo.
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

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = TABLA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/**
 * @param {Array<{nombre: string, datos: Buffer}>} entradas
 * @returns {Buffer}
 */
function zip(entradas) {
  const locales = []
  const central = []
  let offset = 0

  for (const { nombre, datos } of entradas) {
    const nombreBuf = Buffer.from(nombre, 'utf8')
    const comprimido = zlib.deflateRawSync(datos, { level: 9 })
    const crc = crc32(datos)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // versión mínima
    local.writeUInt16LE(0, 6) // banderas
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(0, 10) // hora DOS
    local.writeUInt16LE(0x0021, 12) // fecha DOS = 1980-01-01, fija: el archivo es determinista
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(comprimido.length, 18)
    local.writeUInt32LE(datos.length, 22)
    local.writeUInt16LE(nombreBuf.length, 26)
    local.writeUInt16LE(0, 28)
    locales.push(local, nombreBuf, comprimido)

    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(20, 4)
    dir.writeUInt16LE(20, 6)
    dir.writeUInt16LE(0, 8)
    dir.writeUInt16LE(8, 10)
    dir.writeUInt16LE(0, 12)
    dir.writeUInt16LE(0x0021, 14)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(comprimido.length, 20)
    dir.writeUInt32LE(datos.length, 24)
    dir.writeUInt16LE(nombreBuf.length, 28)
    dir.writeUInt32LE(offset, 42)
    central.push(dir, nombreBuf)

    offset += 30 + nombreBuf.length + comprimido.length
  }

  const directorio = Buffer.concat(central)
  const fin = Buffer.alloc(22)
  fin.writeUInt32LE(0x06054b50, 0)
  fin.writeUInt16LE(entradas.length, 8)
  fin.writeUInt16LE(entradas.length, 10)
  fin.writeUInt32LE(directorio.length, 12)
  fin.writeUInt32LE(offset, 16)

  return Buffer.concat([...locales, directorio, fin])
}

// ── XML ──────────────────────────────────────────────────────────────────────
const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Los caracteres de control no son válidos en XML 1.0 y Excel se niega a abrir el archivo
    // entero por uno solo. Un nombre traído del directorio puede traerlos.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')

/** 1 → A, 27 → AA. */
function columna(n) {
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function hoja({ encabezados, filas, anchos }) {
  const celdas = (valores, fila, estilo) =>
    valores
      .map((v, i) =>
        v === '' || v === null || v === undefined
          ? ''
          : `<c r="${columna(i + 1)}${fila}" t="inlineStr"${estilo ? ` s="${estilo}"` : ''}>` +
            `<is><t xml:space="preserve">${esc(v)}</t></is></c>`,
      )
      .join('')

  const cols = anchos?.length
    ? `<cols>${anchos
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join('')}</cols>`
    : ''

  const cuerpo = filas
    .map((f, i) => `<row r="${i + 2}">${celdas(f, i + 2, 0)}</row>`)
    .join('')

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    // Encabezado siempre a la vista: 163 filas no se leen sin esto.
    '<sheetViews><sheetView workbookViewId="0">' +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '</sheetView></sheetViews>' +
    cols +
    `<sheetData><row r="1">${celdas(encabezados, 1, 1)}</row>${cuerpo}</sheetData>` +
    `<autoFilter ref="A1:${columna(encabezados.length)}${filas.length + 1}"/>` +
    '</worksheet>'
  )
}

/**
 * @param {Array<{nombre: string, encabezados: string[], filas: Array<Array<string|number>>, anchos?: number[]}>} hojas
 * @returns {Buffer} los bytes del .xlsx
 */
export function construirXlsx(hojas) {
  const nS = hojas.length
  const rango = (n) => Array.from({ length: n }, (_, i) => i + 1)

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    rango(nS)
      .map(
        (i) =>
          `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join('') +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>'

  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>'

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    hojas
      .map((h, i) => `<sheet name="${esc(h.nombre).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('') +
    '</sheets></workbook>'

  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    hojas
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join('') +
    `<Relationship Id="rId${nS + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    '</Relationships>'

  // Dos estilos: 0 normal, 1 negrita. Los dos rellenos son obligatorios aunque no se usen 
  // Excel da el archivo por corrupto si `fills` no empieza por `none` y `gray125`.
  const styles =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
    '</styleSheet>'

  return zip([
    { nombre: '[Content_Types].xml', datos: Buffer.from(contentTypes, 'utf8') },
    { nombre: '_rels/.rels', datos: Buffer.from(rels, 'utf8') },
    { nombre: 'xl/workbook.xml', datos: Buffer.from(workbook, 'utf8') },
    { nombre: 'xl/_rels/workbook.xml.rels', datos: Buffer.from(workbookRels, 'utf8') },
    { nombre: 'xl/styles.xml', datos: Buffer.from(styles, 'utf8') },
    ...hojas.map((h, i) => ({
      nombre: `xl/worksheets/sheet${i + 1}.xml`,
      datos: Buffer.from(hoja(h), 'utf8'),
    })),
  ])
}

/** CSV de respaldo: BOM para que Excel lo lea como UTF-8, `;` como separador. */
export function construirCsv({ encabezados, filas }) {
  const campo = (v) => {
    const s = String(v ?? '')
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lineas = [encabezados, ...filas].map((f) => f.map(campo).join(';'))
  return '\ufeff' + 'sep=;\r\n' + lineas.join('\r\n') + '\r\n'
}

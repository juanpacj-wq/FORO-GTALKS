// Auditoría INDEPENDIENTE de los QR que dejó un ensayo en `.datos/qr/`.
//
//   node scripts/envio-qr-auditar.mjs .datos/audiencia-final.json
//
// No genera nada: lee los PNG del disco, los decodifica y los cruza con la audiencia. Es una
// segunda opinión sobre el mismo trabajo, hecha por otro camino:
//
//   · El auto-chequeo de `envio-qr.mjs` compara el PNG contra la URL que ACABA de construir, en
//     memoria, dentro de la misma vuelta del bucle. Si el bucle estuviera cruzado —la persona A
//     con los datos de B—, la comparación seguiría cuadrando, porque compararía B contra B.
//   · Esto compara el NOMBRE DEL ARCHIVO (que sale del alias de la persona) contra el CONTENIDO
//     decodificado, y ambos contra la audiencia congelada. Un cruce en el bucle sí se ve aquí.
//
// Y comprueba lo que solo se puede ver mirando el conjunto entero: que no haya dos personas con
// el mismo código, que no falte ni sobre ninguno, y que todos lleven la jornada de la mañana.

import fs from 'node:fs'
import path from 'node:path'
import { readBarcodes } from 'zxing-wasm/reader'
import { ID_CAPACITACION_MANANA } from '../src/data/escarapela.ts'
import { DIR_DATOS, RAIZ, urlDelCorreo } from './envio-qr-comun.mjs'

let fallos = 0
function check(nombre, ok, detalle = '') {
  console.log(`${ok ? '  ok  ' : ' FALLA'} ${nombre}${detalle ? ` ${detalle}` : ''}`)
  if (!ok) fallos++
}

const rutaAudiencia = process.argv[2]
if (!rutaAudiencia) {
  console.error('\nUso: node scripts/envio-qr-auditar.mjs <archivo-de-audiencia>\n')
  process.exit(1)
}
const audiencia = JSON.parse(fs.readFileSync(path.resolve(RAIZ, rutaAudiencia), 'utf8')).audiencia
const dirQr = path.join(DIR_DATOS, 'qr')
const archivos = fs.readdirSync(dirQr).filter((f) => f.endsWith('.png'))

console.log(`\nAuditoría de ${archivos.length} PNG contra ${audiencia.length} personas\n`)

const esperados = audiencia.filter((p) => !p.anomalias?.length)
check('hay un PNG por persona, ni uno más ni uno menos', archivos.length === esperados.length,
  `(${archivos.length} archivos / ${esperados.length} personas)`)

const porAlias = new Map(esperados.map((p) => [p.alias, p]))
const contenidos = new Map()
let ilegibles = 0
let cruzados = 0
let sinManana = 0
let huerfanos = 0

for (const archivo of archivos) {
  const alias = path.basename(archivo, '.png')
  const persona = porAlias.get(alias)
  if (!persona) {
    huerfanos++
    console.log(`  ··  ${archivo} no corresponde a nadie de la audiencia`)
    continue
  }
  const png = fs.readFileSync(path.join(dirQr, archivo))
  const leido = await readBarcodes(new Uint8Array(png), { formats: ['QRCode'], tryHarder: true })
  const url = leido[0]?.text ?? ''
  if (!url) {
    ilegibles++
    console.log(`  ··  ${archivo} NO SE LEE`)
    continue
  }
  // La URL esperada se reconstruye desde el CORREO de la audiencia, no desde el nombre del
  // archivo: así el cruce es contra la fuente, no contra sí mismo.
  if (url !== urlDelCorreo(persona.correo)) {
    cruzados++
    console.log(`  ··  ${archivo} lleva OTRA url: ${url.slice(-40)}`)
  }
  if (!url.includes(`ID_CAPACITACION=${ID_CAPACITACION_MANANA}`)) sinManana++
  contenidos.set(url, (contenidos.get(url) || 0) + 1)
}

check('todos los PNG se decodifican', ilegibles === 0, `(${ilegibles} ilegibles)`)
check('ningún PNG lleva el código de otra persona', cruzados === 0, `(${cruzados} cruzados)`)
check('ningún PNG sobra', huerfanos === 0, `(${huerfanos} huérfanos)`)
check('todos llevan la jornada de la MAÑANA', sinManana === 0, `(${sinManana} sin ella)`)
check('no hay dos personas con el mismo código', contenidos.size === archivos.length - ilegibles - huerfanos,
  `(${contenidos.size} códigos distintos)`)

const faltan = esperados.filter((p) => !archivos.includes(`${p.alias}.png`))
check('no falta el PNG de nadie', faltan.length === 0, faltan.map((p) => p.alias).join(', '))

console.log(fallos === 0 ? '\nAuditoría de los QR: todo en orden.\n' : `\n${fallos} verificación(es) fallaron.\n`)
process.exit(fallos === 0 ? 0 : 1)

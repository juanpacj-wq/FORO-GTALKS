// Rellena la columna CEDULA de la hoja de asistencia con una lista de la PLANTA DE PERSONAL.
//
//   node scripts/asistencia-cedulas.mjs --lista .datos/planta-contratistas-<fecha>.txt
//   node scripts/asistencia-cedulas.mjs --lista … --confirmar
//
// ── Por qué existe, teniendo ya `asistencia-completar.mjs` ───────────────────
//
// Aquél saca los datos del directorio de Entra, que es una fuente CONSULTABLE: se le pregunta y
// responde lo mismo mañana. Éste los saca de una lista que pega un humano, que no lo es. Son dos
// niveles de confianza distintos y por eso son dos scripts: lo que aquí se escribe no se puede
// volver a comprobar contra nada, así que todo el peso recae en las guardas de abajo.
//
// No necesita red ni credenciales: la lista ES la fuente.
//
// ── Las guardas, y qué error real ataja cada una ─────────────────────────────
//
//   1. Una CÉDULA REPETIDA en dos personas distintas aborta. Es el error de copiar y pegar una
//      fila y olvidar cambiar el número, y sin esta guarda se escribe sin que nada chille.
//   2. Una cédula que CONTRADIGA a la que el Excel ya trae aborta. Nunca se pisa un dato.
//   3. Un nombre que no case con EXACTAMENTE una fila no se aplica: se enseñan los candidatos y
//      decide un humano. Se comparan CONJUNTOS de palabras porque la lista llega «APELLIDOS
//      NOMBRES» y la hoja quedó en «Nombres Apellidos» el orden no puede importar, y se acepta
//      que a un lado sobren palabras (un segundo apellido que el directorio no tenía).
//   4. Lo que no se quiera aplicar se COMENTA en la lista con `#`. Queda el rastro en el archivo,
//      que es revisable, en vez de en una bandera de la línea de comandos, que no lo es.

import fs from 'node:fs'
import path from 'node:path'
import { RAIZ, norm } from './envio-qr-comun.mjs'
import { abrirLibro, escribirLibro } from './xlsx-editar.mjs'

const argv = process.argv.slice(2)
const opcion = (n, d) => {
  const i = argv.indexOf(n)
  return i === -1 ? d : argv[i + 1]
}
const confirmar = argv.includes('--confirmar')
const rutaXlsx = path.resolve(RAIZ, opcion('--archivo', 'ASISTENCIA FORO.xlsx'))
const rutaLista = path.resolve(RAIZ, opcion('--lista', ''))
const nombreHoja = opcion('--hoja', 'Hoja1')

const abortar = (m) => { console.error(`\n✗ ${m}\n`); process.exit(1) }

if (!opcion('--lista', '')) abortar('Falta --lista <ruta> con «NOMBRE<tab>CEDULA» por línea.')
if (!fs.existsSync(rutaLista)) abortar(`No existe ${rutaLista}`)

// ── La lista ─────────────────────────────────────────────────────────────────
const CEDULA = /^\d{5,12}$/
const pedidos = []
const comentadas = []
for (const [i, cruda] of fs.readFileSync(rutaLista, 'utf8').split(/\r?\n/).entries()) {
  const linea = cruda.trim()
  if (!linea) continue
  if (linea.startsWith('#')) { comentadas.push(linea); continue }
  // Nombre y cédula separados por tabulador o por dos o más espacios: dentro del nombre hay
  // espacios sueltos (y en esta lista hasta dobles), así que un solo espacio no puede ser el corte.
  const m = /^(.*?)[\t ]{1,}([\d.\-\s]+)$/.exec(linea)
  if (!m) abortar(`Línea ${i + 1} de la lista, no se entiende: «${linea}»`)
  const nombre = m[1].trim()
  const cedula = m[2].replace(/[.\-\s]/g, '')
  if (!nombre) abortar(`Línea ${i + 1}: sin nombre.`)
  if (!CEDULA.test(cedula)) abortar(`Línea ${i + 1}: «${m[2].trim()}» no parece una cédula.`)
  pedidos.push({ linea: i + 1, nombre, cedula })
}
if (!pedidos.length) abortar('La lista no trae ni una entrada activa.')

console.log('\nCédulas desde la planta de personal')
console.log(`  archivo  ${path.relative(RAIZ, rutaXlsx)}`)
console.log(`  lista    ${path.relative(RAIZ, rutaLista)}  (${pedidos.length} activas, ${comentadas.length - 3 > 0 ? comentadas.length - 3 : 0} comentadas)`)
console.log(`  modo     ${confirmar ? 'ESCRIBE' : 'ENSAYO (no escribe)'}\n`)

// ── GUARDA 1: cédulas repetidas dentro de la propia lista ───────────────────
const porCedula = new Map()
for (const p of pedidos) {
  if (!porCedula.has(p.cedula)) porCedula.set(p.cedula, [])
  porCedula.get(p.cedula).push(p)
}
const repetidas = [...porCedula.entries()].filter(([, v]) => v.length > 1)
if (repetidas.length) {
  console.error('✗ La lista da la MISMA cédula a personas distintas:\n')
  for (const [ced, gente] of repetidas) {
    console.error(`   ${ced}`)
    for (const p of gente) console.error(`      línea ${p.linea}: ${p.nombre}`)
  }
  abortar(
    'Dos personas no pueden compartir cédula: una de las dos está mal y no hay forma de saber cuál\n' +
    '  desde aquí. Corrige la lista (o comenta con «#» la entrada dudosa) y repite.',
  )
}

// ── La hoja ──────────────────────────────────────────────────────────────────
const CABECERAS = ['USUARIO', 'NOMBRE', 'CEDULA', 'TIPO', 'SEDE', 'EMPRESA', 'TIPO_IDENTIFICACION', 'POLITICA', 'CARGO', 'DEPENDENCIA', 'NIVEL']
const libro = abrirLibro(rutaXlsx, nombreHoja, CABECERAS, abortar)
const filas = libro.filas

/** Sin tildes, sin ñ, sin puntuación, en mayúsculas: el mismo criterio que `personas-resolver`. */
const palabras = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z\s]/g, ' ').replace(/\s+/g, ' ').trim()
  .split(' ').filter(Boolean)

const contiene = (grande, chico) => {
  const resto = [...grande]
  return chico.every((p) => {
    const i = resto.indexOf(p)
    if (i === -1) return false
    resto.splice(i, 1)
    return true
  })
}

const indexadas = filas.map((f) => ({ f, p: palabras(f.NOMBRE) })).filter((x) => x.p.length)

// ── Casar cada entrada con UNA fila ─────────────────────────────────────────
const cambios = []
const sinAplicar = []
for (const p of pedidos) {
  const pp = palabras(p.nombre)
  const exactas = indexadas.filter((x) => x.p.length === pp.length && [...x.p].sort().join(' ') === [...pp].sort().join(' '))
  // Sin coincidencia exacta se acepta que a un lado le sobren palabras, pero solo si la
  // candidata es ÚNICA: dos «Miguel Calderon» distintos volverían a ser cosa de un humano.
  const laxas = exactas.length ? [] : indexadas.filter((x) => contiene(x.p, pp) || contiene(pp, x.p))
  const casadas = exactas.length ? exactas : laxas

  if (casadas.length !== 1) {
    sinAplicar.push({
      p,
      motivo: casadas.length === 0 ? 'no casa con ninguna fila de la hoja' : `casa con ${casadas.length} filas`,
      candidatas: casadas.map((x) => `r${x.f._r} ${x.f.NOMBRE}`),
    })
    continue
  }
  const f = casadas[0].f
  const actual = norm(f.CEDULA)

  // ── GUARDA 2: nunca se pisa, y una contradicción aborta ───────────────────
  if (CEDULA.test(actual)) {
    if (actual !== p.cedula) {
      abortar(
        `CONTRADICCIÓN en r${f._r} (${f.USUARIO} · ${f.NOMBRE}):\n` +
        `    el Excel ya dice  ${actual}\n` +
        `    y la lista dice   ${p.cedula}  (línea ${p.linea}, «${p.nombre}»)\n` +
        '  Una de las dos está mal. No se escribe NADA hasta que se aclare.',
      )
    }
    sinAplicar.push({ p, motivo: `r${f._r} ya la tiene y coincide`, ok: true })
    continue
  }
  cambios.push({ fila: f._r, usuario: f.USUARIO, nombre: f.NOMBRE, cedula: p.cedula, pedido: p })
}

// ── El informe ───────────────────────────────────────────────────────────────
console.log('─'.repeat(96))
console.log('FILA  USUARIO                        NOMBRE en la hoja                    CEDULA que se escribe')
console.log('─'.repeat(96))
for (const c of cambios) {
  console.log(`${String(c.fila).padStart(4)}  ${String(c.usuario).padEnd(30)} ${String(c.nombre).padEnd(36)} ${c.cedula}`)
}
console.log('─'.repeat(96))

const confirmadas = sinAplicar.filter((s) => s.ok)
if (confirmadas.length) {
  console.log(`\n✔ ${confirmadas.length} entrada(s) que la hoja YA tenía y la lista CONFIRMA:`)
  for (const s of confirmadas) console.log(`    ${s.p.nombre.padEnd(34)} ${s.p.cedula}  (${s.motivo})`)
}
const problemas = sinAplicar.filter((s) => !s.ok)
if (problemas.length) {
  console.log(`\n⚠ ${problemas.length} entrada(s) de la lista que NO se aplican:`)
  for (const s of problemas) {
    console.log(`    línea ${String(s.p.linea).padStart(2)}  ${s.p.nombre.padEnd(34)} ${s.p.cedula}   → ${s.motivo}`)
    for (const c of s.candidatas ?? []) console.log(`              candidata: ${c}`)
  }
}

console.log(`\n${cambios.length} celda(s) de CEDULA a escribir.`)

// Qué sigue faltando después de esto
const quedan = filas.filter((f) => !CEDULA.test(norm(f.CEDULA)) && !cambios.some((c) => c.fila === f._r))
if (quedan.length) {
  console.log(`\nSeguirán sin cédula ${quedan.length} fila(s):`)
  for (const f of quedan) console.log(`    r${String(f._r).padStart(3)} ${String(f.USUARIO).padEnd(30)} ${f.NOMBRE}`)
}

if (!cambios.length) { console.log('\nNada que escribir.\n'); process.exit(0) }
if (!confirmar) {
  console.log('\nEnsayo: no se ha tocado el archivo. Repite con --confirmar para escribirlo.\n')
  process.exit(0)
}

// ── Escribir y releer ────────────────────────────────────────────────────────
const respaldo = escribirLibro(libro, cambios.map((c) => ({ fila: c.fila, CEDULA: c.cedula })), abortar)

let fallos = 0
for (const c of cambios) {
  const f = libro.releer().get(c.fila)
  if (norm(f?.CEDULA) !== c.cedula) { console.log(` FALLA r${c.fila} CEDULA quedó «${f?.CEDULA}»`); fallos++ }
}
const despues = libro.releer()
for (const f of filas) {
  const g = despues.get(f._r)
  if (norm(g?.USUARIO) !== norm(f.USUARIO) || norm(g?.NOMBRE) !== norm(f.NOMBRE)) {
    console.log(` FALLA r${f._r} se movió USUARIO o NOMBRE`); fallos++
  }
  if (!cambios.some((c) => c.fila === f._r) && norm(g?.CEDULA) !== norm(f.CEDULA)) {
    console.log(` FALLA r${f._r} se tocó una CEDULA que no había que tocar`); fallos++
  }
}
if (fallos) abortar(`${fallos} comprobación(es) fallida(s). El original está en «${path.basename(respaldo)}».`)

console.log(`\n✔ Escrito y releído: ${cambios.length} cédula(s), el resto intacto.`)
console.log(`  archivo  ${path.relative(RAIZ, rutaXlsx)}`)
console.log(`  respaldo ${path.relative(RAIZ, respaldo)}\n`)

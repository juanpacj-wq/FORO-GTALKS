// De una lista de NOMBRES a una lista de DIRECCIONES, resolviendo contra el directorio de Entra.
// No escribe nada en el directorio, no manda correo y no toca el libro: solo lee y propone.
//
//   node --env-file=.env scripts/personas-resolver.mjs --archivo .datos/nuevos-2026-08-05.txt
//
// ── Por qué existe ───────────────────────────────────────────────────────────
//
// Las listas de invitados llegan como «APELLIDOS NOMBRES» («BOLAÑO YEPES LUZ MARIA»), y el
// directorio guarda «Nombres Apellidos» («Luz Maria Bolaño Yepes»). Traducir eso a mano es
// exactamente donde se cuela el error que este proyecto no puede permitirse: quien entra al grupo
// recibe un correo con su QR de asistencia PERSONAL, así que confundir a dos personas con el
// mismo apellido le entrega a una el código de la otra.
//
// ── Cómo casa los nombres, y por qué así ─────────────────────────────────────
//
// Compara CONJUNTOS DE PALABRAS normalizadas (sin tildes, sin mayúsculas, sin la ñ frente a n),
// no cadenas. El orden no importa —que es justo la diferencia entre los dos formatos— y las
// coincidencias se clasifican en tres:
//
//   exacta    las mismas palabras, en cualquier orden. Es la única que se da por buena sola.
//   contenida todas las palabras pedidas están en el nombre del directorio, que trae alguna más
//             (un segundo nombre que la lista omitió). Se PROPONE, no se acepta.
//   parcial   falta alguna palabra pedida. Solo se lista para que un humano mire.
//
// Fallo cerrado: si un nombre no da exactamente UNA coincidencia exacta, el archivo de salida no
// se escribe. Media lista resuelta es peor que ninguna, porque nadie sabría cuál mitad revisar.

import fs from 'node:fs'
import path from 'node:path'
import { crearProveedorDeToken } from '../server/correo/graph-mailer.js'
import { DIR_DATOS, GRUPO_POR_DEFECTO, RAIZ, aliasDe, anomaliasDe, credencialesGraph } from './envio-qr-comun.mjs'

const GRAPH = 'https://graph.microsoft.com/v1.0'

const argv = process.argv.slice(2)
const opcion = (n, d) => {
  const i = argv.indexOf(n)
  return i === -1 ? d : argv[i + 1]
}

const archivo = opcion('--archivo', '')
const grupo = opcion('--grupo', process.env.ENVIO_QR_GRUPO || GRUPO_POR_DEFECTO)
const dominio = opcion('--dominio', 'gecelca.com.co')

function abortar(mensaje) {
  console.error(`\n${mensaje}\n`)
  process.exit(1)
}

if (!archivo) abortar('Falta --archivo <ruta> con un nombre por línea.')

const rutaEntrada = path.resolve(RAIZ, archivo)
if (!fs.existsSync(rutaEntrada)) abortar(`No existe ${rutaEntrada}`)

const pedidos = fs.readFileSync(rutaEntrada, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.split('#')[0].trim())
  .filter(Boolean)

if (!pedidos.length) abortar(`${rutaEntrada} no tiene ni un nombre.`)

/** Sin tildes, sin ñ, sin puntuación, en mayúsculas y con los espacios colapsados. */
const normalizar = (s) => String(s ?? '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')  // los diacríticos que soltó el NFD
  .toUpperCase()
  .replace(/[^A-Z\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const palabras = (s) => normalizar(s).split(' ').filter(Boolean)
const mismasPalabras = (a, b) => a.length === b.length && [...a].sort().join(' ') === [...b].sort().join(' ')
const contiene = (grande, chico) => {
  const resto = [...grande]
  return chico.every((p) => {
    const i = resto.indexOf(p)
    if (i === -1) return false
    resto.splice(i, 1)
    return true
  })
}

console.log('\nResolver nombres contra el directorio')
console.log(`  archivo   ${path.relative(RAIZ, rutaEntrada)}`)
console.log(`  nombres   ${pedidos.length}`)
console.log(`  dominio   ${dominio}`)

const cred = credencialesGraph(process.env)
console.log(`  credencial ${cred.origen}\n`)
const obtenerToken = crearProveedorDeToken(cred)
const token = await obtenerToken()
const cabeceras = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

async function pedir(url) {
  const r = await fetch(url, { headers: cabeceras, signal: AbortSignal.timeout(30_000) })
  if (r.ok) return r.json()
  let codigo = ''
  try {
    codigo = (await r.json())?.error?.code || ''
  } catch { /* Graph no siempre devuelve JSON */ }
  abortar(`Graph respondió ${r.status}${codigo ? ` (${codigo})` : ''} en ${url.replace(GRAPH, '')}`)
}

// ── Todo el directorio, una vez ──────────────────────────────────────────────
// Se trae entero en vez de buscar nombre a nombre a propósito: `$search` de Graph puntúa por
// relevancia y devuelve «el mejor», que es precisamente la clase de respuesta que no se puede
// aceptar aquí. Con la lista completa en memoria, la ambigüedad se VE y se decide.
const usuarios = []
let url = `${GRAPH}/users?$select=id,displayName,givenName,surname,mail,userPrincipalName,accountEnabled,jobTitle&$top=999`
let paginas = 0
while (url) {
  const cuerpo = await pedir(url)
  usuarios.push(...(cuerpo.value || []))
  paginas++
  url = cuerpo['@odata.nextLink'] || null
}
console.log(`Directorio: ${usuarios.length} usuarios en ${paginas} página(s).`)

const delDominio = usuarios.filter((u) => {
  const correo = String(u.mail || u.userPrincipalName || '').toLowerCase()
  return correo.endsWith(`@${dominio}`)
})
console.log(`De @${dominio}: ${delDominio.length}.\n`)

// Quién está ya en el grupo, y a quién ya se le mandó el correo: dos datos que cambian lo que hay
// que hacer con cada persona, y que conviene ver en la MISMA tabla que la resolución.
const miembros = []
let urlG = `${GRAPH}/groups/${encodeURIComponent(grupo)}/members/microsoft.graph.user?$select=id&$top=999`
while (urlG) {
  const cuerpo = await pedir(urlG)
  miembros.push(...(cuerpo.value || []))
  urlG = cuerpo['@odata.nextLink'] || null
}
const enElGrupo = new Set(miembros.map((m) => m.id))

const rutaLibro = path.join(DIR_DATOS, 'envio-qr.jsonl')
const yaConCorreo = new Set()
if (fs.existsSync(rutaLibro)) {
  for (const linea of fs.readFileSync(rutaLibro, 'utf8').split('\n')) {
    if (!linea.trim()) continue
    try {
      const r = JSON.parse(linea)
      if (r.estado === 'enviado' && r.oid) yaConCorreo.add(r.oid)
    } catch { /* línea corrupta */ }
  }
}
console.log(`En el grupo: ${enElGrupo.size} · con el correo ya enviado: ${yaConCorreo.size}\n`)

// ── Casar ────────────────────────────────────────────────────────────────────
const indexados = delDominio.map((u) => ({ u, p: palabras(u.displayName) }))
const resultados = []

for (const pedido of pedidos) {
  const pp = palabras(pedido)
  const exactas = indexados.filter((x) => mismasPalabras(x.p, pp))
  const contenidas = indexados.filter((x) => !mismasPalabras(x.p, pp) && contiene(x.p, pp))
  // «Parcial» es para cuando la lista trae un nombre que el directorio abrevia: se exige que al
  // menos DOS palabras coincidan, para no llenar la pantalla con todos los «MARIA» del tenant.
  const parciales = indexados
    .filter((x) => !exactas.includes(x) && !contenidas.includes(x))
    .map((x) => ({ x, n: pp.filter((w) => x.p.includes(w)).length }))
    .filter((c) => c.n >= Math.max(2, pp.length - 1))
    .sort((a, b) => b.n - a.n)
    .slice(0, 4)
    .map((c) => c.x)
  resultados.push({ pedido, exactas, contenidas, parciales })
}

// ── El informe ───────────────────────────────────────────────────────────────
const ficha = (u) => {
  const alias = aliasDe(u)
  const anomalias = anomaliasDe(u, alias)
  const marcas = []
  if (enElGrupo.has(u.id)) marcas.push('YA EN EL GRUPO')
  if (yaConCorreo.has(u.id)) marcas.push('CORREO YA ENVIADO')
  if (u.accountEnabled === false) marcas.push('CUENTA DESHABILITADA')
  return { u, alias, anomalias, marcas }
}

let sinResolver = 0
console.log('─'.repeat(100))
for (const r of resultados) {
  console.log(`\n«${r.pedido}»`)
  if (r.exactas.length === 1) {
    const f = ficha(r.exactas[0].u)
    console.log(`   ✔ ${f.u.displayName}`)
    console.log(`     ${f.alias.correo}   ·   ${f.u.jobTitle || '(sin cargo)'}`)
    console.log(`     oid ${f.u.id} · alias del QR «${f.alias.alias}»`)
    if (f.marcas.length) console.log(`     → ${f.marcas.join(' · ')}`)
    if (f.anomalias.length) console.log(`     ⚠ ${f.anomalias.join('; ')}`)
    continue
  }
  sinResolver++
  if (r.exactas.length > 1) {
    console.log(`   ✗ AMBIGUO: ${r.exactas.length} personas con ese mismo nombre exacto:`)
    for (const c of r.exactas) console.log(`       · ${c.u.displayName} <${aliasDe(c.u).correo}> — ${c.u.jobTitle || 'sin cargo'}`)
    continue
  }
  console.log('   ✗ SIN coincidencia exacta.')
  if (r.contenidas.length) {
    console.log('     Candidatos que CONTIENEN todas las palabras pedidas:')
    for (const c of r.contenidas) console.log(`       · ${c.u.displayName} <${aliasDe(c.u).correo}> — ${c.u.jobTitle || 'sin cargo'}`)
  }
  if (r.parciales.length) {
    console.log('     Parecidos (revisar a mano):')
    for (const c of r.parciales) console.log(`       · ${c.u.displayName} <${aliasDe(c.u).correo}> — ${c.u.jobTitle || 'sin cargo'}`)
  }
  if (!r.contenidas.length && !r.parciales.length) console.log('     (nada parecido en el directorio)')
}
console.log(`\n${'─'.repeat(100)}`)

const resueltos = resultados.filter((r) => r.exactas.length === 1).map((r) => ficha(r.exactas[0].u))
console.log(`\nResueltos sin ambigüedad: ${resueltos.length} de ${pedidos.length}`)
console.log(`  ya en el grupo          ${resueltos.filter((f) => f.marcas.includes('YA EN EL GRUPO')).length}`)
console.log(`  con el correo ya salido ${resueltos.filter((f) => f.marcas.includes('CORREO YA ENVIADO')).length}`)
console.log(`  pendientes de todo      ${resueltos.filter((f) => !f.marcas.length).length}`)

if (sinResolver) {
  abortar(
    `${sinResolver} nombre(s) sin resolver: NO se escribe el archivo de direcciones.\n` +
    '  Elige a mano entre los candidatos de arriba y corrige el archivo de nombres. Una lista a\n' +
    '  medias sería peor que ninguna: nadie sabría qué mitad revisar.',
  )
}

// ── Los artefactos ───────────────────────────────────────────────────────────
const base = path.basename(rutaEntrada).replace(/\.txt$/i, '')
const rutaCorreos = path.join(DIR_DATOS, `${base}-correos.txt`)
const rutaJson = path.join(DIR_DATOS, `${base}-resueltos.json`)
fs.writeFileSync(
  rutaCorreos,
  resueltos.map((f) => `${f.alias.correo}  # ${f.u.displayName}${f.marcas.length ? ` — ${f.marcas.join(' · ')}` : ''}`).join('\n') + '\n',
  { mode: 0o640 },
)
fs.writeFileSync(
  rutaJson,
  JSON.stringify(
    {
      generado: new Date().toISOString(),
      origen: path.relative(RAIZ, rutaEntrada),
      personas: resueltos.map((f) => ({
        pedido: resultados.find((r) => r.exactas[0]?.u.id === f.u.id)?.pedido || '',
        oid: f.u.id,
        nombre: f.u.displayName,
        correo: f.alias.correo,
        alias: f.alias.alias,
        cargo: f.u.jobTitle || '',
        yaEnElGrupo: f.marcas.includes('YA EN EL GRUPO'),
        correoYaEnviado: f.marcas.includes('CORREO YA ENVIADO'),
        anomalias: f.anomalias,
      })),
    },
    null,
    2,
  ),
  { mode: 0o640 },
)

console.log(`\nDirecciones en  ${path.relative(RAIZ, rutaCorreos)}`)
console.log(`Detalle en      ${path.relative(RAIZ, rutaJson)}`)
console.log('\nRevisa la tabla persona a persona antes de seguir. El siguiente paso es:')
console.log(`  node --env-file=.env scripts/grupo-agregar.mjs --archivo ${path.relative(RAIZ, rutaCorreos).replace(/\\/g, '/')}\n`)

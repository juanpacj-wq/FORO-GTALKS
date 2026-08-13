// Añade personas al grupo de Entra de los invitados al foro. Y nada más: NO manda correo, NO
// toca el libro del envío y NO congela ninguna audiencia.
//
//   node --env-file=.env scripts/grupo-agregar.mjs --archivo .datos/nuevos.txt          # ENSAYO
//   node --env-file=.env scripts/grupo-agregar.mjs --archivo .datos/nuevos.txt --confirmar
//   node --env-file=.env scripts/grupo-agregar.mjs --correo a@gecelca.com.co --correo b@…
//
// Por qué existe: hasta hoy esto se hacía a mano con un `POST` suelto (así entró `csotomayor` el
// 2026-08-04, ver `docs/PLAN-ENVIO-QR.md`). Un `POST` a mano no deja registro, no comprueba a
// quién resolvió la dirección antes de escribir, y no verifica después. Las tres cosas importan
// aquí: quien entra al grupo recibe un correo con un QR **personal**, así que meter al Juan
// equivocado no es un error de membresía, es un código de asistencia en manos de otra persona.
//
// Permiso: `GroupMember.ReadWrite.All` de APLICACIÓN con consentimiento de administrador  el
// que ya está concedido a la App Registration del login (§0.1 de `docs/PLAN-ENVIO-QR.md`).
//
// ── Las cuatro garantías ─────────────────────────────────────────────────────
//
//   1. **Se resuelve antes de escribir, y se enseña.** Cada dirección se busca en Graph y se
//      imprime el nombre, el `mail`, el UPN y el `oid` de quien salió. En ensayo eso es todo lo
//      que pasa: la corrida entera es revisable antes de que exista un solo cambio.
//   2. **Todo o nada en la resolución.** Si una sola dirección no existe en el tenant, se aborta
//      sin añadir a nadie. Media lista dentro es peor que ninguna: nadie sabría cuál mitad.
//   3. **Es idempotente.** Quien ya está en el grupo se salta. Un `POST` repetido devuelve un 400
//      que aquí se lee y se traduce, no se propaga como fallo.
//   4. **Se verifica LISTANDO.** `GET /groups/{id}/members/{oid}/$ref` devuelve 404 aunque la
//      persona sí esté  el detalle que costó una confusión el 2026-08-04. La comprobación buena
//      es volver a traer los miembros y buscar ahí, que es lo que se hace al final.

import fs from 'node:fs'
import path from 'node:path'
import { crearProveedorDeToken } from '../server/correo/graph-mailer.js'
import {
  DIRECCION,
  GRUPO_POR_DEFECTO,
  RAIZ,
  aliasDe,
  anomaliasDe,
  credencialesGraph,
  crearVerificador,
  norm,
} from './envio-qr-comun.mjs'

const GRAPH = 'https://graph.microsoft.com/v1.0'

const argv = process.argv.slice(2)
const bandera = (n) => argv.includes(n)
const opcion = (n, d) => {
  const i = argv.indexOf(n)
  return i === -1 ? d : argv[i + 1]
}
const repetible = (n) => argv.reduce((a, v, i) => (v === n ? [...a, argv[i + 1]] : a), [])

const confirmar = bandera('--confirmar')
const grupoPedido = opcion('--grupo', process.env.ENVIO_QR_GRUPO || GRUPO_POR_DEFECTO)

function abortar(mensaje) {
  console.error(`\n${mensaje}\n`)
  process.exit(1)
}

// ── De dónde salen las direcciones ───────────────────────────────────────────
// Un archivo de texto es el camino bueno para una lista larga: queda en el disco, se puede diffear
// y es lo que un humano revisó. Se acepta «Nombre Apellido <correo@dominio>» además del correo
// pelado, porque es como se pegan las listas desde Outlook.
function direccionesDeTexto(texto, procedencia) {
  const salida = []
  texto.split(/\r?\n/).forEach((linea, i) => {
    const limpia = linea.split('#')[0].trim()
    if (!limpia) return
    const entreAngulos = limpia.match(/<([^>]+)>/)
    const candidata = norm(entreAngulos ? entreAngulos[1] : limpia.split(/[\s;,]+/).filter(Boolean).pop())
    if (!DIRECCION.test(candidata)) {
      abortar(
        `${procedencia}, línea ${i + 1}: «${linea.trim()}» no contiene una dirección de correo.\n` +
        '  No se adivina: corrige la línea o bórrala. Nadie entra al grupo por aproximación.',
      )
    }
    salida.push(candidata)
  })
  return salida
}

const pedidas = []
const archivo = opcion('--archivo', '')
if (archivo) {
  const ruta = path.resolve(RAIZ, archivo)
  if (!fs.existsSync(ruta)) abortar(`No existe ${ruta}`)
  pedidas.push(...direccionesDeTexto(fs.readFileSync(ruta, 'utf8'), path.basename(ruta)))
}
pedidas.push(...direccionesDeTexto(repetible('--correo').join('\n'), '--correo'))

if (!pedidas.length) {
  abortar(
    'No hay a quién añadir. Pásale --archivo <ruta> (una dirección por línea) o --correo <dir> ' +
    '(repetible).',
  )
}

// Duplicadas en la propia lista: se dicen y se colapsan. Silenciarlas haría que el conteo final
// no cuadrara con lo que la persona escribió, y ese conteo es la comprobación de quien revisa.
const unicas = [...new Set(pedidas)]
if (unicas.length !== pedidas.length) {
  const vistas = new Set()
  const repes = pedidas.filter((d) => (vistas.has(d) ? true : (vistas.add(d), false)))
  console.log(`\n  Aviso: ${pedidas.length - unicas.length} dirección(es) repetida(s) en la lista: ${[...new Set(repes)].join(', ')}`)
}

const { check, estado } = crearVerificador()

console.log('\nAñadir personas al grupo de invitados')
console.log(`  grupo      ${grupoPedido}`)
console.log(`  pedidas    ${unicas.length}`)
console.log(`  modo       ${confirmar ? 'CONFIRMADO (se escribe en el directorio)' : 'ENSAYO (no se escribe nada)'}`)

const cred = credencialesGraph(process.env)
console.log(`  credencial ${cred.origen}\n`)
const obtenerToken = crearProveedorDeToken(cred)
const token = await obtenerToken()
const cabeceras = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

async function pedir(url) {
  const r = await fetch(url, { headers: cabeceras, signal: AbortSignal.timeout(30_000) })
  if (r.ok) return { ok: true, cuerpo: await r.json() }
  let codigo = ''
  let mensaje = ''
  try {
    const e = (await r.json())?.error
    codigo = e?.code || ''
    mensaje = e?.message || ''
  } catch { /* Graph no siempre devuelve JSON */ }
  return { ok: false, status: r.status, codigo, mensaje }
}

// ── Resolver el grupo: acepta el Object ID o el NOMBRE ───────────────────────
const ES_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
let grupo = grupoPedido
let nombreGrupo = ''
if (!ES_GUID.test(grupoPedido)) {
  const filtro = `displayName eq '${grupoPedido.replace(/'/g, "''")}'`
  const r = await pedir(`${GRAPH}/groups?$filter=${encodeURIComponent(filtro)}&$select=id,displayName`)
  if (!r.ok) abortar(`Graph respondió ${r.status} (${r.codigo}) buscando el grupo.`)
  const encontrados = r.cuerpo.value || []
  if (encontrados.length === 0) abortar(`No hay ningún grupo llamado «${grupoPedido}» en el tenant.`)
  if (encontrados.length > 1) {
    abortar(
      `Hay ${encontrados.length} grupos llamados «${grupoPedido}». Pasa el Object ID:\n` +
      encontrados.map((g) => `  · ${g.id}`).join('\n'),
    )
  }
  grupo = encontrados[0].id
  nombreGrupo = encontrados[0].displayName
} else {
  const r = await pedir(`${GRAPH}/groups/${encodeURIComponent(grupo)}?$select=id,displayName`)
  if (!r.ok) abortar(`Graph respondió ${r.status} (${r.codigo}) leyendo el grupo ${grupo}.`)
  nombreGrupo = r.cuerpo.displayName || ''
}
console.log(`Grupo: «${nombreGrupo}» → ${grupo}`)

// ── Los miembros de ahora ────────────────────────────────────────────────────
async function traerMiembros() {
  const lista = []
  let url = `${GRAPH}/groups/${encodeURIComponent(grupo)}/members/microsoft.graph.user` +
    '?$select=id,displayName,mail,userPrincipalName,accountEnabled&$top=999'
  while (url) {
    const r = await pedir(url)
    if (!r.ok) abortar(`Graph respondió ${r.status} (${r.codigo}) listando los miembros.`)
    lista.push(...(r.cuerpo.value || []))
    url = r.cuerpo['@odata.nextLink'] || null
  }
  return lista
}

const antes = await traerMiembros()
console.log(`Miembros antes: ${antes.length}\n`)
const oidsAntes = new Set(antes.map((m) => m.id))

// ── Resolver cada dirección, TODO o NADA ─────────────────────────────────────
// Primero se resuelven las 13, se imprimen y se auditan. Solo si no falla ninguna se escribe. Una
// dirección que no existe casi siempre es una errata, y una errata que se descubre a mitad de la
// escritura deja el grupo en un estado que nadie pidió.
console.log('Resolviendo las direcciones contra el directorio…\n')
const resueltas = []
const fallidas = []
for (const correo of unicas) {
  const r = await pedir(
    `${GRAPH}/users/${encodeURIComponent(correo)}?$select=id,displayName,mail,userPrincipalName,accountEnabled`,
  )
  if (!r.ok) {
    fallidas.push({ correo, motivo: r.status === 404 ? 'no existe en el tenant' : `${r.status} ${r.codigo}` })
    console.log(`  ✗  ${correo.padEnd(34)} ${r.status === 404 ? 'NO EXISTE en el tenant' : `Graph ${r.status} (${r.codigo})`}`)
    continue
  }
  const u = r.cuerpo
  const alias = aliasDe(u)
  const anomalias = anomaliasDe(u, alias)
  const yaEsta = oidsAntes.has(u.id)
  resueltas.push({ correo, usuario: u, alias, anomalias, yaEsta })
  console.log(`  ${yaEsta ? '·' : '+'}  ${correo.padEnd(34)} ${u.displayName}`)
  console.log(`     mail ${u.mail || '(vacío)'} · upn ${u.userPrincipalName} · oid ${u.id}`)
  console.log(`     alias del QR: «${alias.alias}» (de ${alias.fuente})${yaEsta ? ' · YA ESTÁ en el grupo' : ''}`)
  if (anomalias.length) console.log(`     ⚠ ${anomalias.join('; ')}`)
  console.log('')
}

console.log('Auditoría')
check(`las ${unicas.length} direcciones existen en el tenant`, fallidas.length === 0,
  fallidas.map((f) => `${f.correo} (${f.motivo})`).join(', '))
const conAnomalias = resueltas.filter((r) => r.anomalias.length)
check('ninguna persona trae anomalías de alias', conAnomalias.length === 0,
  conAnomalias.map((r) => r.correo).join(', '))
// Dos personas con el mismo alias son dos QR idénticos: el envío lo rechazaría después, pero es
// mejor saberlo antes de tocar el grupo.
const aliasNuevos = resueltas.map((r) => r.alias.alias)
const chocan = aliasNuevos.filter((a, i) => aliasNuevos.indexOf(a) !== i)
const aliasDelGrupo = new Set(antes.map((m) => aliasDe(m).alias))
const chocanConGrupo = resueltas.filter((r) => !r.yaEsta && aliasDelGrupo.has(r.alias.alias))
check('ningún alias repetido entre las nuevas', chocan.length === 0, [...new Set(chocan)].join(', '))
check('ningún alias choca con alguien que ya está', chocanConGrupo.length === 0,
  chocanConGrupo.map((r) => r.alias.alias).join(', '))

if (estado.fallos) {
  abortar(
    `${estado.fallos} verificación(es) fallaron: NO se añadió a nadie.\n` +
    '  Corrige la lista y vuelve a correrlo. Media lista dentro es peor que ninguna.',
  )
}

const porAnadir = resueltas.filter((r) => !r.yaEsta)
const yaEstaban = resueltas.filter((r) => r.yaEsta)
console.log(`\n  ya en el grupo   ${yaEstaban.length}`)
console.log(`  por añadir       ${porAnadir.length}`)

if (!porAnadir.length) {
  console.log('\nNo hay nada que hacer: las ' + unicas.length + ' ya están en el grupo.\n')
  process.exit(0)
}
if (!confirmar) {
  console.log('\nENSAYO: no se escribió nada. Revisa los nombres de arriba uno por uno y, si son')
  console.log('los correctos, vuelve a lanzarlo con --confirmar.\n')
  process.exit(0)
}

// ── Escribir ─────────────────────────────────────────────────────────────────
console.log('\nAñadiendo…\n')
const anadidos = []
const errores = []
for (const r of porAnadir) {
  const respuesta = await fetch(`${GRAPH}/groups/${encodeURIComponent(grupo)}/members/$ref`, {
    method: 'POST',
    headers: cabeceras,
    body: JSON.stringify({ '@odata.id': `${GRAPH}/directoryObjects/${r.usuario.id}` }),
    signal: AbortSignal.timeout(30_000),
  })
  if (respuesta.status === 204) {
    anadidos.push(r)
    console.log(`  +  ${r.usuario.displayName} <${r.correo}>`)
    continue
  }
  let codigo = ''
  let mensaje = ''
  try {
    const e = (await respuesta.json())?.error
    codigo = e?.code || ''
    mensaje = e?.message || ''
  } catch { /* puede venir sin cuerpo */ }
  // Un 400 con «already exist» no es un fallo: es la idempotencia hablando.
  if (respuesta.status === 400 && /already exist/i.test(mensaje)) {
    console.log(`  ·  ${r.usuario.displayName} <${r.correo}> ya estaba (carrera con otro cambio)`)
    continue
  }
  errores.push({ correo: r.correo, status: respuesta.status, codigo, mensaje })
  console.log(`  ✗  ${r.correo}  Graph ${respuesta.status} (${codigo})`)
}

// ── Verificar LISTANDO, que es la única comprobación que sirve ───────────────
const despues = await traerMiembros()
const oidsDespues = new Set(despues.map((m) => m.id))
console.log(`\nMiembros después: ${despues.length} (antes ${antes.length}, +${despues.length - antes.length})`)

console.log('\nVerificación')
const { check: check2, estado: estado2 } = crearVerificador()
for (const r of resueltas) {
  check2(`${r.correo} está en el grupo`, oidsDespues.has(r.usuario.id))
}
check2('ningún error de Graph al escribir', errores.length === 0,
  errores.map((e) => `${e.correo}: ${e.status} ${e.codigo}`).join(', '))
check2(
  `el grupo creció exactamente en ${porAnadir.length}`,
  despues.length === antes.length + porAnadir.length,
  `(${antes.length} → ${despues.length})`,
)

console.log(`\n  añadidos ahora   ${anadidos.length}`)
console.log(`  ya estaban       ${yaEstaban.length}`)
console.log('\n  Siguiente paso: volver a congelar la audiencia con `envio-qr-audiencia.mjs`')
console.log(`  (--esperados ${despues.length}) y enviar SOLO a los nuevos en modo \`lista\`.\n`)
process.exit(estado2.fallos === 0 ? 0 : 1)

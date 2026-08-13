// Congela la audiencia del envío del QR: lee los miembros del grupo de Entra y los escribe a un
// archivo JSON revisable. NO manda correo y NO toca el libro.
//
//   node --env-file=.env scripts/envio-qr-audiencia.mjs
//   node --env-file=.env scripts/envio-qr-audiencia.mjs --esperados 163
//
// Por qué la audiencia se CONGELA en un archivo en vez de consultarse al enviar:
//
//   · Un grupo puede cambiar entre el ensayo y el envío real, y con una consulta en vivo nadie se
//     enteraría de que se mandó a un conjunto distinto del que se revisó.
//   · Leer el directorio y mandar correo son dos privilegios distintos. Separados, el script que
//     manda los 163 mensajes no necesita `GroupMember.Read.All` para nada.
//   · El archivo es un artefacto AUDITABLE: 163 líneas que un humano puede leer y comparar antes
//     de que salga un solo mensaje. `docs/SEGURIDAD.md` §Ciclo anual ya pedía archivar esa
//     membresía; este archivo ES ese artefacto.
//
// Permiso necesario: `GroupMember.Read.All` de APLICACIÓN con consentimiento de administrador.
// Es el mínimo que lee `/groups/{id}/members`; `Group.Read.All` y `Directory.Read.All` son más
// anchos y no hacen falta. Ojo: los permisos de aplicación de Graph son de TENANT y no se pueden
// acotar a un solo grupo, así que conviene retirarlo en cuanto termine el envío
// (`docs/SEGURIDAD.md` §Ciclo anual).

import fs from 'node:fs'
import path from 'node:path'
import { crearProveedorDeToken } from '../server/correo/graph-mailer.js'
import {
  DIR_DATOS,
  GRUPO_POR_DEFECTO,
  RAIZ,
  aliasDe,
  anomaliasDe,
  credencialesGraph,
  crearVerificador,
} from './envio-qr-comun.mjs'

const GRAPH = 'https://graph.microsoft.com/v1.0'

const argv = process.argv.slice(2)
const opcion = (nombre, defecto) => {
  const i = argv.indexOf(nombre)
  return i === -1 ? defecto : argv[i + 1]
}

const grupoPedido = opcion('--grupo', process.env.ENVIO_QR_GRUPO || GRUPO_POR_DEFECTO)
/** Tamaño del grupo que se da por bueno. Es un CANDADO, no un dato: si el grupo crece o encoge
 *  sin que nadie lo sepa, la corrida se pone roja antes de mandar nada. Se actualiza a mano y a
 *  propósito cuando el cambio es deliberado  163 al congelarlo el 2026-08-03, 164 desde que se
 *  añadió a `csotomayor` el 2026-08-04. */
const esperados = Number(opcion('--esperados', '164'))
/** Personas que deben recibir el correo aunque NO estén en el grupo. Repetible. Se resuelven una
 *  a una contra Graph, así que quedan en el archivo con su `oid` real y su nombre real: no es un
 *  apaño a mano sobre el JSON, es parte del artefacto reproducible. */
const masCorreos = argv.reduce((a, v, i) => (v === '--mas-correo' ? [...a, argv[i + 1]] : a), [])
const { check, estado } = crearVerificador()

console.log('\nAudiencia del envío del QR')
console.log(`  grupo     ${grupoPedido}`)
console.log(`  esperados ${esperados}`)

const cred = credencialesGraph(process.env)
console.log(`  credencial ${cred.origen}\n`)
const obtenerToken = crearProveedorDeToken(cred)
const token = await obtenerToken()

const cabeceras = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

/** Graph al que se le pide algo, con el error traducido a algo accionable. */
async function pedir(url) {
  const r = await fetch(url, { headers: cabeceras, signal: AbortSignal.timeout(30_000) })
  if (r.ok) return r.json()
  let codigo = ''
  try {
    codigo = (await r.json())?.error?.code || ''
  } catch { /* Graph no siempre devuelve JSON */ }
  console.error(
    `\nGraph respondió ${r.status}${codigo ? ` (${codigo})` : ''}. ` +
    'Si es 403, falta el permiso de lectura de grupos de APLICACIÓN con consentimiento de administrador.\n',
  )
  process.exit(1)
}

// ── Resolver el grupo: acepta el Object ID o el NOMBRE ───────────────────────
// Un GUID es lo inequívoco, pero obligar a buscarlo en el portal cada vez que se crea un grupo de
// prueba es una invitación a pegar el que no era. Si lo que llega no tiene forma de GUID, se
// resuelve por `displayName`  y si hay más de uno con ese nombre, se ABORTA en vez de elegir:
// mandarle a la audiencia equivocada es exactamente lo que este script existe para evitar.
const ES_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
let grupo = grupoPedido
if (!ES_GUID.test(grupoPedido)) {
  const filtro = `displayName eq '${grupoPedido.replace(/'/g, "''")}'`
  const r = await pedir(`${GRAPH}/groups?$filter=${encodeURIComponent(filtro)}&$select=id,displayName`)
  const encontrados = r.value || []
  if (encontrados.length === 0) {
    console.error(`\nNo hay ningún grupo llamado «${grupoPedido}» en el tenant.\n`)
    process.exit(1)
  }
  if (encontrados.length > 1) {
    console.error(
      `\nHay ${encontrados.length} grupos llamados «${grupoPedido}». Pasa el Object ID:\n` +
      encontrados.map((g) => `  · ${g.id}`).join('\n') + '\n',
    )
    process.exit(1)
  }
  grupo = encontrados[0].id
  console.log(`  «${grupoPedido}» → ${grupo}\n`)
}

// ── Traer los miembros ───────────────────────────────────────────────────────
// El casteo `/microsoft.graph.user` no es adorno: `/members` a secas devuelve objetos de
// directorio MEZCLADOS. Un grupo anidado o un principal de servicio no tienen `mail` ni
// `userPrincipalName`, y el script produciría un `USUARIO` vacío sin enterarse. Con el casteo,
// Graph devuelve solo usuarios  y sigue sin expandir grupos anidados, que es justo lo que la
// comprobación del conteo tiene que gritar.
const miembros = []
let url = `${GRAPH}/groups/${encodeURIComponent(grupo)}/members/microsoft.graph.user` +
  '?$select=id,displayName,mail,userPrincipalName,accountEnabled&$top=999'
let paginas = 0

while (url) {
  const cuerpo = await pedir(url)
  miembros.push(...(cuerpo.value || []))
  paginas++
  // El `nextLink` se sigue TAL CUAL: lleva un `$skiptoken` que ya codifica la proyección, y
  // re-añadirle `$select` a mano rompe la paginación.
  url = cuerpo['@odata.nextLink'] || null
}

const delGrupo = miembros.length
console.log(`Traídos ${delGrupo} miembros del grupo en ${paginas} página(s).`)

// ── Añadidos que no están en el grupo ────────────────────────────────────────
// Se resuelven contra Graph igual que los del grupo, así que llegan con su `oid` y su nombre
// reales. Si ya venían en el grupo, NO se duplican: el `oid` manda.
const yaEstan = new Set(miembros.map((m) => m.id))
for (const correo of masCorreos) {
  const u = await pedir(
    `${GRAPH}/users/${encodeURIComponent(correo)}?$select=id,displayName,mail,userPrincipalName,accountEnabled`,
  )
  if (yaEstan.has(u.id)) {
    console.log(`  «${correo}» ya venía en el grupo: no se duplica.`)
    continue
  }
  yaEstan.add(u.id)
  miembros.push(u)
  console.log(`  + ${correo} (${u.displayName}) añadido fuera del grupo.`)
}
if (masCorreos.length) console.log(`Total con añadidos: ${miembros.length}.`)
console.log('')

// ── Derivar el alias y auditar ───────────────────────────────────────────────
// Se ORDENA por alias antes de nada. Graph no garantiza el orden de los miembros comprobado: dos
// lecturas seguidas del mismo grupo devolvieron los mismos 163 en distinta secuencia, y un
// archivo cuyo orden baila no se puede diffear. Como el archivo congelado existe justamente para
// que un humano compare antes de mandar 163 correos, sin orden estable no serviría para nada.
const audiencia = miembros.map((m) => {
  const alias = aliasDe(m)
  return {
    oid: m.id,
    nombre: m.displayName || '',
    mail: m.mail || '',
    upn: m.userPrincipalName || '',
    accountEnabled: m.accountEnabled !== false,
    correo: alias.correo,
    alias: alias.alias,
    fuenteDelAlias: alias.fuente,
    anomalias: anomaliasDe(m, alias),
  }
}).sort((x, y) => (x.alias || x.oid).localeCompare(y.alias || y.oid, 'es'))

const conAnomalias = audiencia.filter((p) => p.anomalias.length)
const limpios = audiencia.filter((p) => !p.anomalias.length)

const cuentaPor = (lista, clave) => {
  const m = new Map()
  for (const p of lista) m.set(p[clave], (m.get(p[clave]) || 0) + 1)
  return [...m.entries()].filter(([, n]) => n > 1)
}
const aliasRepetidos = cuentaPor(audiencia.filter((p) => p.alias), 'alias')
const oidsRepetidos = cuentaPor(audiencia, 'oid')

console.log('Auditoría')
// El conteo se comprueba sobre el GRUPO, no sobre el total: los añadidos son explícitos y ya se
// listaron uno a uno arriba. Si el grupo cambia de tamaño sin que nadie lo sepa, esto lo grita.
check(`el grupo trae ${esperados} personas`, delGrupo === esperados, `(trajo ${delGrupo})`)
check('ningún `oid` repetido', oidsRepetidos.length === 0, oidsRepetidos.map(([a]) => a).join(', '))
check(
  'ningún alias repetido  dos alias iguales son dos QR idénticos',
  aliasRepetidos.length === 0,
  aliasRepetidos.map(([a, n]) => `${a}×${n}`).join(', '),
)
check('todas las personas resuelven un alias limpio', conAnomalias.length === 0, `(${conAnomalias.length} con anomalías)`)

if (conAnomalias.length) {
  console.log('\nPersonas que NO recibirán el correo sin revisión manual:')
  for (const p of conAnomalias) {
    console.log(`  · ${p.nombre || '(sin nombre)'} <${p.correo || 'sin correo'}>  ${p.anomalias.join('; ')}`)
  }
}

const porFuente = audiencia.reduce((a, p) => ({ ...a, [p.fuenteDelAlias]: (a[p.fuenteDelAlias] || 0) + 1 }), {})
console.log(`\nOrigen del alias: ${JSON.stringify(porFuente)}`)
console.log(`Listos para enviar: ${limpios.length}`)

// ── Escribir el archivo, sin sobrescribir jamás ──────────────────────────────
// El nombre lleva la fecha Y los primeros dígitos del grupo: con un grupo de PRUEBA y el real
// congelados el mismo día, un nombre solo-por-fecha haría que el segundo se negara a escribir
// creyendo que ya existe, o peor, que se enviara con la audiencia equivocada.
const hoy = new Date().toISOString().slice(0, 10)
const destino = path.resolve(
  RAIZ,
  opcion('--salida', path.join(DIR_DATOS, `audiencia-${hoy}-${grupo.slice(0, 8)}.json`)),
)
fs.mkdirSync(DIR_DATOS, { recursive: true })
if (fs.existsSync(destino)) {
  console.error(
    `\n${destino} ya existe y NO se sobrescribe: es el registro de a quién se le iba a escribir. ` +
    'Bórralo a mano si de verdad quieres volver a congelar la audiencia.\n',
  )
  process.exit(1)
}
fs.writeFileSync(destino, JSON.stringify({ grupo, generado: new Date().toISOString(), audiencia }, null, 2), {
  mode: 0o640,
})

console.log(`\nAudiencia congelada en ${destino}`)
console.log('Revísala antes de enviar. El envío usa ESE archivo y no vuelve a consultar Graph.\n')
console.log(estado.fallos === 0 ? 'Audiencia: todo en orden.\n' : `${estado.fallos} verificación(es) fallaron.\n`)
process.exit(estado.fallos === 0 ? 0 : 1)

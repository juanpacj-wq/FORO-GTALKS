// El listado de inscritos, en Excel. Corre EN LA ESTACIÓN, con el informe que produjo
// `scripts/inscritos-exportar.mjs` en el servidor.
//
//   node scripts/inscritos-excel.mjs
//   node scripts/inscritos-excel.mjs --informe .datos/inscritos-2026-08-04.json \
//                                    --audiencia .datos/audiencia-2026-08-04-4d6d78fa.json
//
// ── El cruce se hace aquí, y por eso el informe puede ser seudónimo ──────────
// El servidor exporta `oid` + fechas. Los nombres y los correos ya están en esta máquina, en el
// archivo de audiencia que congeló `envio-qr-audiencia.mjs` leyendo el grupo de Entra. Cruzar
// aquí significa que lo que tuvo que salir del servidor y viajar por el canal que fuera no era
// una lista de 163 correos corporativos, sino una de identificadores opacos.
//
// Todo el mundo que puede iniciar sesión está asignado al grupo (la Enterprise App exige
// asignación), así que la audiencia congelada cubre a los inscritos. Quien no aparezca en ella
// sale igualmente en el listado, marcado, en vez de desaparecer sin ruido: sería alguien asignado
// a mano, o alguien que entró después de congelar la audiencia.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { construirXlsx, construirCsv } from './xlsx-minimo.mjs'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR_DATOS = path.join(RAIZ, '.datos')

const argv = process.argv.slice(2)
const opcion = (nombre, defecto) => {
  const i = argv.indexOf(nombre)
  return i === -1 ? defecto : argv[i + 1]
}
/** Todas las veces que aparece una opción, en orden. */
const opciones = (nombre) =>
  argv.map((a, i) => (a === nombre ? argv[i + 1] : null)).filter(Boolean)

/** Los archivos de `.datos/` que empiezan por `prefijo`, del más nuevo al más viejo. */
function candidatos(prefijo) {
  if (!fs.existsSync(DIR_DATOS)) return []
  return fs
    .readdirSync(DIR_DATOS)
    .filter((f) => f.startsWith(prefijo) && f.endsWith('.json'))
    .map((f) => path.join(DIR_DATOS, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
}

function elegir(prefijo, pedido, queEs) {
  if (pedido) return path.resolve(RAIZ, pedido)
  const opciones = candidatos(prefijo)
  if (opciones.length === 0) {
    console.error(`\nNo encuentro ${queEs} en .datos/ (busco ${prefijo}*.json).\n`)
    process.exit(1)
  }
  // Con más de uno NO se adivina: elegir el que no era produce un listado que parece correcto.
  // El grupo de prueba de cuatro personas y el real de 163 se congelaron el mismo día.
  if (opciones.length > 1) {
    console.error(
      `\nHay ${opciones.length} archivos de ${queEs}. Dime cuál con --${prefijo.replace(/-$/, '')}:\n` +
        opciones.map((o) => `  · ${path.relative(RAIZ, o)}`).join('\n') +
        '\n',
    )
    process.exit(1)
  }
  return opciones[0]
}

const RUTA_INFORME = elegir('inscritos-', opcion('--informe'), 'informe del servidor')

// `--audiencia` se puede repetir. La PRIMERA es la audiencia de referencia: la que decide quién
// cuenta como invitado, quién falta por entrar y qué sale en la columna «En el grupo». Las demás
// solo sirven para ponerle NOMBRE a quien entró sin estar en ella el grupo de prueba, por
// ejemplo, porque «(fuera de la audiencia congelada)» es cierto pero no dice quién es.
const RUTAS_AUDIENCIA = opciones('--audiencia')
const RUTA_AUDIENCIA = RUTAS_AUDIENCIA.length
  ? path.resolve(RAIZ, RUTAS_AUDIENCIA[0])
  : elegir('audiencia-', null, 'audiencia congelada')

const informe = JSON.parse(fs.readFileSync(RUTA_INFORME, 'utf8'))
const audiencia = JSON.parse(fs.readFileSync(RUTA_AUDIENCIA, 'utf8'))

console.log('\nListado de inscritos  Foro G-TALKS')
console.log(`  informe    ${path.relative(RAIZ, RUTA_INFORME)}  (generado ${informe.generado})`)
console.log(`  audiencia  ${path.relative(RAIZ, RUTA_AUDIENCIA)}  (${audiencia.audiencia.length} personas)`)

const porOid = new Map(audiencia.audiencia.map((p) => [p.oid, p]))

/** Solo para nombrar: nunca decide pertenencia al grupo ni entra en «Sin ingresar». */
const soloNombres = new Map()
for (const ruta of RUTAS_AUDIENCIA.slice(1)) {
  const extra = JSON.parse(fs.readFileSync(path.resolve(RAIZ, ruta), 'utf8'))
  for (const p of extra.audiencia) if (!porOid.has(p.oid)) soloNombres.set(p.oid, p)
  console.log(`  también    ${ruta}  (${extra.audiencia.length} personas, solo para nombrar)`)
}
console.log('')

// ── Fechas: hora de Bogotá, formato que ordena ───────────────────────────────
// `AAAA-MM-DD HH:MM` como TEXTO: ordena igual que una fecha de verdad y no cambia según la
// configuración regional de quien abra el archivo. La hora es la de Colombia, no la del UTC del
// registro: «entró a las 14:30» tiene que querer decir lo que la gente entiende.
const RELOJ = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
function fecha(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = Object.fromEntries(RELOJ.formatToParts(d).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}`
}

const ETIQUETA_CORREO = {
  enviado: 'Enviado',
  fallido: 'Falló',
  reservado: 'Pendiente de revisión',
  simulado: 'Simulacro',
}

// Sin registro de acceso, la única señal de que alguien entró es su línea en el libro. Es peor
// el libro solo tiene a quien el modo del correo dejó pasar y por eso se dice en voz alta.
const sinAcceso = !informe.fuentes?.acceso?.lineas
if (sinAcceso) {
  console.warn(
    '  ⚠  el informe no trae registro de acceso (AUDIT_LOG_PATH vacío en el servidor).\n' +
      '     La lista sale del libro de inscripciones, que solo contiene a quien el modo del\n' +
      '     correo dejó pasar. NO es la lista completa de quien ha entrado.\n',
  )
}

// ── Ajustes a mano ───────────────────────────────────────────────────────────
// Dos correcciones que el registro no puede hacer solo, y que van por la LÍNEA DE ÓRDENES y no
// editando el .xlsx: así el listado del día siguiente se rehace con el mismo comando en vez de
// repetir la edición a mano y olvidarse de la mitad.
//
//   · `--excluir` saca a alguien de las DOS hojas. Es para las cuentas de prueba: entraron de
//     verdad, así que el registro las tiene, pero no son asistentes y contarlas infla el número.
//   · `--incluir` añade a quien entró DESPUÉS de sacar el exporte. Se le pone la FECHA del informe
//     y se deja la hora, el número de ingresos y el estado del correo EN BLANCO: es la precisión
//     que de verdad se tiene. Inventar una hora exacta sería escribir un dato que nadie midió.
const clave = (v) => String(v || '').trim().toLowerCase()
const EXCLUIR = new Set(opciones('--excluir').map(clave))
const INCLUIR = opciones('--incluir').map(clave)
const identifica = (ficha, oid, valor) =>
  clave(oid) === valor || [ficha?.correo, ficha?.mail, ficha?.upn].some((c) => c && clave(c) === valor)

const inscritos = []
const rechazados = []
const oidsConIngreso = new Set()
const excluidos = []
const anadidos = []

for (const p of informe.personas) {
  const ficha = porOid.get(p.oid)
  const fuera = [...EXCLUIR].find((v) => identifica(ficha || soloNombres.get(p.oid), p.oid, v))
  if (fuera) {
    excluidos.push((ficha || soloNombres.get(p.oid))?.nombre || p.oid)
    continue
  }
  // `conocida` puede venir de otra audiencia: sirve para el nombre y el correo, no para decir
  // que la persona está en el grupo. Esa distinción es la columna «En el grupo».
  const conocida = ficha || soloNombres.get(p.oid)
  const nombre = conocida?.nombre || (p.upn ? '' : '(fuera de la audiencia congelada)')
  const correo = conocida?.correo || conocida?.mail || conocida?.upn || p.upn || ''
  const entro = p.ingresos > 0 || (sinAcceso && p.correo)

  if (entro) {
    oidsConIngreso.add(p.oid)
    inscritos.push({
      nombre: nombre || '(sin nombre en el directorio)',
      correo,
      primero: fecha(p.primerIngreso),
      ultimo: fecha(p.ultimoIngreso),
      ingresos: p.ingresos || '',
      correoInscripcion: p.correo ? ETIQUETA_CORREO[p.correo.estado] || p.correo.estado : '',
      enGrupo: ficha ? 'Sí' : 'No',
      oid: p.oid,
    })
    continue
  }

  // Sin ingresos pero con líneas en el acceso: alguien intentó entrar y Entra lo rechazó.
  const motivos = Object.entries(p.resultados || {})
  if (motivos.length) {
    rechazados.push({
      nombre: nombre || '(sin nombre en el directorio)',
      correo,
      motivos: motivos.map(([m, n]) => `${m} ×${n}`).join(', '),
      oid: p.oid,
    })
  }
}

// Los que entraron después del exporte. El día sale del informe y en hora de Bogotá, para que sea
// el mismo día que ve quien lee la hoja.
const DIA = fecha(informe.generado).slice(0, 10)
const conocidas = [...porOid.values(), ...soloNombres.values()]
for (const valor of INCLUIR) {
  const ficha = conocidas.find((p) => identifica(p, p.oid, valor))
  // No se inventa a nadie: si el valor no resuelve contra una audiencia, se aborta. Un nombre
  // tecleado a medias produciría una fila con datos a medias y nadie se enteraría.
  if (!ficha) {
    console.error(`\n--incluir «${valor}» no coincide con nadie en las audiencias cargadas.\n`)
    process.exit(1)
  }
  if (oidsConIngreso.has(ficha.oid)) {
    console.log(`  · ${ficha.nombre} ya estaba en la lista; --incluir no hace nada`)
    continue
  }
  oidsConIngreso.add(ficha.oid)
  inscritos.push({
    nombre: ficha.nombre,
    correo: ficha.correo || ficha.mail || ficha.upn || '',
    primero: DIA,
    ultimo: DIA,
    ingresos: '',
    correoInscripcion: '',
    enGrupo: porOid.has(ficha.oid) ? 'Sí' : 'No',
    oid: ficha.oid,
  })
  anadidos.push(ficha.nombre)
}

// Los invitados del grupo que todavía no han abierto su escarapela. Es la otra mitad de la
// pregunta y sale del mismo cruce: sin ella, «se han inscrito 41» no dice de cuántos.
const faltantes = audiencia.audiencia
  .filter((p) => !oidsConIngreso.has(p.oid))
  .filter((p) => ![...EXCLUIR].some((v) => identifica(p, p.oid, v)))
  .map((p) => ({ nombre: p.nombre || '(sin nombre)', correo: p.correo || p.mail || p.upn || '', oid: p.oid }))

// ── Las hojas ────────────────────────────────────────────────────────────────
const hojaInscritos = {
  nombre: 'Inscritos',
  encabezados: [
    'N.º',
    'Nombre',
    'Correo',
    'Primer ingreso',
    'Último ingreso',
    'Ingresos',
    'Correo de inscripción',
    'En el grupo',
    'oid',
  ],
  anchos: [5, 34, 34, 18, 18, 10, 22, 12, 38],
  filas: inscritos.map((p, i) => [
    String(i + 1),
    p.nombre,
    p.correo,
    p.primero,
    p.ultimo,
    String(p.ingresos),
    p.correoInscripcion,
    p.enGrupo,
    p.oid,
  ]),
}

const hojas = [
  hojaInscritos,
  {
    nombre: 'Sin ingresar',
    encabezados: ['N.º', 'Nombre', 'Correo', 'oid'],
    anchos: [5, 34, 34, 38],
    filas: faltantes.map((p, i) => [String(i + 1), p.nombre, p.correo, p.oid]),
  },
]
if (rechazados.length) {
  hojas.push({
    nombre: 'Intentos rechazados',
    encabezados: ['N.º', 'Nombre', 'Correo', 'Motivo', 'oid'],
    anchos: [5, 34, 34, 30, 38],
    filas: rechazados.map((p, i) => [String(i + 1), p.nombre, p.correo, p.motivos, p.oid]),
  })
}

const sello = (informe.generado || new Date().toISOString()).slice(0, 10)
const base = path.resolve(RAIZ, opcion('--salida', path.join('.datos', `inscritos-gtalks-${sello}`)))
fs.mkdirSync(path.dirname(base), { recursive: true })
fs.writeFileSync(`${base}.xlsx`, construirXlsx(hojas))
fs.writeFileSync(`${base}.csv`, construirCsv(hojaInscritos), 'utf8')

console.log('Resumen')
if (excluidos.length) console.log(`  excluidos a mano       ${excluidos.join(', ')}`)
if (anadidos.length) console.log(`  añadidos a mano        ${anadidos.join(', ')} (fecha ${DIA}, sin hora)`)
console.log(`  inscritos              ${inscritos.length} de ${audiencia.audiencia.length} invitados`)
console.log(`  sin ingresar todavía   ${faltantes.length}`)
if (rechazados.length) console.log(`  intentos rechazados    ${rechazados.length}`)
const fuera = inscritos.filter((p) => p.enGrupo === 'No').length
if (fuera) console.log(`  ⚠  ${fuera} entraron sin estar en la audiencia congelada (revisa la hoja)`)
console.log(`\n  ${path.relative(RAIZ, base)}.xlsx`)
console.log(`  ${path.relative(RAIZ, base)}.csv\n`)

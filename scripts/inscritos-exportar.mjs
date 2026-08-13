// Exporta quién ha entrado al foro en PRODUCCIÓN. Corre EN EL SERVIDOR, con `sudo`.
//
//   sudo node /tmp/inscritos-exportar.mjs
//   sudo node /tmp/inscritos-exportar.mjs --con-correos
//   sudo bash -c 'set -a; . /etc/gtalks/env; set +a; node /tmp/inscritos-exportar.mjs --enviar tu.correo@gecelca.com.co'
//
// ── Por qué existe ───────────────────────────────────────────────────────────
// El servidor no tiene «una tabla de inscritos»: tiene dos artefactos con propósitos distintos
// (docs/SEGURIDAD.md §Registro de acceso y §Correo de inscripción), y la lista sale de cruzarlos.
//
//   · `/var/log/gtalks/acceso.log`          quién inició sesión y cuándo. `ts`, `resultado`,
//     (AUDIT_LOG_PATH)                      `oid`, `upn`. ROTA cada semana, 12 rotaciones: este
//                                           script lee también `acceso.log.1` y los `.gz`.
//   · `/var/lib/gtalks/inscripciones.jsonl` a quién se le mandó el correo de confirmación.
//     (INSCRIPCION_LIBRO)                   `ts`, `oid`, estado. SIN la dirección de correo.
//
// El acceso es la fuente de la LISTA; el libro solo dice si además salió el correo. Al revés no
// funciona: en modo `lista` el libro solo tiene a los tres de la lista blanca, y una exportación
// hecha con él parecería decir que se inscribieron tres personas.
//
// ── Seudónimo por defecto, y eso es lo que lo hace transportable ─────────────
// La salida lleva `oid` y fechas, NO nombres ni correos. El `oid` es un identificador opaco del
// directorio: con él solo no se sabe de quién se habla. Los nombres ya están en la estación, en
// el archivo de audiencia que congeló `envio-qr-audiencia.mjs`, y el cruce se hace ALLÍ
// (`scripts/inscritos-excel.mjs`). Así el archivo que tiene que salir del servidor no es una
// lista de 163 correos corporativos, y el canal por el que viaje deja de ser un problema de
// datos personales. Con `--con-correos` se incluye el UPN, para cuando alguien entró sin estar
// en la audiencia congelada y hay que ponerle nombre; úsalo solo si hace falta.
//
// ── Solo LEE ────────────────────────────────────────────────────────────────
// No escribe en el libro, no lo trunca y no toca el servicio. Un `resolver()` de más aquí
// significaría que a alguien no le llega su correo de inscripción, o que le llega dos veces.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

const argv = process.argv.slice(2)
const opcion = (nombre, defecto) => {
  const i = argv.indexOf(nombre)
  return i === -1 ? defecto : argv[i + 1]
}
const bandera = (nombre) => argv.includes(nombre)

const LIBRO = opcion('--libro', process.env.INSCRIPCION_LIBRO || '/var/lib/gtalks/inscripciones.jsonl')
const ACCESO = opcion('--acceso', process.env.AUDIT_LOG_PATH || '/var/log/gtalks/acceso.log')
const CON_CORREOS = bandera('--con-correos')
const HOY = new Date().toISOString().slice(0, 10)
const SALIDA = path.resolve(opcion('--salida', `/tmp/inscritos-${HOY}.json`))
const ENVIAR_A = String(opcion('--enviar', '') || '').trim()
const REMITENTE = String(opcion('--remitente', process.env.INSCRIPCION_REMITENTE || '') || '').trim()

/** UNA dirección y solo una, igual que `server/correo/graph-mailer.js`. */
const UNA_DIRECCION = /^[^\s@,;:<>"'()[\]\\]+@[^\s@,;:<>"'()[\]\\]+\.[^\s@,;:<>"'()[\]\\]+$/

console.log('\nExportación de inscritos  Foro G-TALKS')
console.log(`  servidor  ${os.hostname()}`)
console.log(`  acceso    ${ACCESO}`)
console.log(`  libro     ${LIBRO}`)
console.log(`  salida    ${SALIDA}${CON_CORREOS ? '  (CON correos)' : '  (seudónimo)'}\n`)

// ── Leer el registro de acceso, rotaciones incluidas ─────────────────────────
// logrotate deja `acceso.log`, `acceso.log.1` y `acceso.log.N.gz` en el mismo directorio. Leer
// solo el vigente perdería a todo el que entró hace más de una semana, y lo haría en silencio.
function lineasDeAcceso(ruta) {
  const dir = path.dirname(ruta)
  const base = path.basename(ruta)
  let archivos = []
  try {
    archivos = fs
      .readdirSync(dir)
      .filter((f) => f === base || f.startsWith(`${base}.`))
      .sort()
      .map((f) => path.join(dir, f))
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }

  const lineas = []
  const leidos = []
  for (const archivo of archivos) {
    let crudo
    try {
      const bytes = fs.readFileSync(archivo)
      crudo = archivo.endsWith('.gz') ? zlib.gunzipSync(bytes).toString('utf8') : bytes.toString('utf8')
      // Si el archivo pasó por una redirección de PowerShell viene con BOM, y el BOM se le pega a
      // la primera línea: `JSON.parse` la rechaza y se perdería la primera persona en silencio.
      crudo = crudo.replace(/^\uFEFF/, '')
    } catch (err) {
      console.warn(`  ⚠  no se pudo leer ${archivo}: ${err.message}`)
      continue
    }
    let n = 0
    for (const linea of crudo.split('\n')) {
      if (!linea.trim()) continue
      try {
        lineas.push(JSON.parse(linea))
        n++
      } catch {
        /* una línea a medias (rotación en pleno vuelo) no puede tumbar la exportación */
      }
    }
    leidos.push({ archivo, lineas: n })
  }
  return { lineas, leidos }
}

const acceso = lineasDeAcceso(ACCESO)

// ── Leer el libro de inscripciones ───────────────────────────────────────────
// Es append-only: la ÚLTIMA línea de cada `oid` es su estado actual.
function leerLibro(ruta) {
  let crudo = ''
  try {
    crudo = fs.readFileSync(ruta, 'utf8').replace(/^\uFEFF/, '')
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    return { estados: new Map(), lineas: 0, existe: false }
  }
  const estados = new Map()
  let lineas = 0
  for (const linea of crudo.split('\n')) {
    if (!linea.trim()) continue
    try {
      const r = JSON.parse(linea)
      if (r?.oid) {
        estados.set(r.oid, { estado: r.estado, ts: r.ts })
        lineas++
      }
    } catch {
      /* ídem */
    }
  }
  return { estados, lineas, existe: true }
}

const libro = leerLibro(LIBRO)

if (!acceso.leidos.length) {
  console.warn(
    `  ⚠  no hay registro de acceso en ${ACCESO}.\n` +
    '     Sin él, la lista sale SOLO del libro de inscripciones, que en modo `lista` contiene\n' +
    '     únicamente a la lista blanca. Comprueba AUDIT_LOG_PATH en /etc/gtalks/env.\n',
  )
}

// ── Agregar por persona ──────────────────────────────────────────────────────
const personas = new Map()
const dePersona = (oid) => {
  if (!personas.has(oid)) {
    personas.set(oid, {
      oid,
      upn: '',
      ingresos: 0,
      primerIngreso: '',
      ultimoIngreso: '',
      resultados: {},
      correo: null,
    })
  }
  return personas.get(oid)
}

for (const r of acceso.lineas) {
  if (!r?.oid) continue
  const p = dePersona(r.oid)
  const resultado = r.resultado || '(sin resultado)'
  p.resultados[resultado] = (p.resultados[resultado] || 0) + 1
  if (r.upn && !p.upn) p.upn = r.upn
  if (resultado !== 'ok') continue
  p.ingresos++
  const ts = r.ts || ''
  if (ts && (!p.primerIngreso || ts < p.primerIngreso)) p.primerIngreso = ts
  if (ts && (!p.ultimoIngreso || ts > p.ultimoIngreso)) p.ultimoIngreso = ts
}

for (const [oid, estado] of libro.estados) {
  dePersona(oid).correo = { estado: estado.estado, ts: estado.ts }
}

// Orden estable por primer ingreso: un archivo cuyo orden baila no se puede diffear entre dos
// exportaciones del mismo día, que es justo lo que se va a hacer si el foro se llena en dos días.
const lista = [...personas.values()].sort(
  (a, b) => (a.primerIngreso || '9').localeCompare(b.primerIngreso || '9') || a.oid.localeCompare(b.oid),
)

const conIngreso = lista.filter((p) => p.ingresos > 0)
const rechazados = lista.filter((p) => p.ingresos === 0 && Object.keys(p.resultados).length)
const porEstadoDeCorreo = {}
for (const p of lista) {
  if (p.correo) porEstadoDeCorreo[p.correo.estado] = (porEstadoDeCorreo[p.correo.estado] || 0) + 1
}

const informe = {
  generado: new Date().toISOString(),
  servidor: os.hostname(),
  conCorreos: CON_CORREOS,
  fuentes: {
    acceso: { ruta: ACCESO, archivos: acceso.leidos, lineas: acceso.lineas.length },
    libro: { ruta: LIBRO, existe: libro.existe, lineas: libro.lineas },
  },
  resumen: {
    personasConIngreso: conIngreso.length,
    ingresosTotales: conIngreso.reduce((n, p) => n + p.ingresos, 0),
    intentosRechazados: rechazados.length,
    correoDeInscripcion: porEstadoDeCorreo,
  },
  personas: lista.map((p) => ({
    oid: p.oid,
    ...(CON_CORREOS && p.upn ? { upn: p.upn } : {}),
    ingresos: p.ingresos,
    primerIngreso: p.primerIngreso || null,
    ultimoIngreso: p.ultimoIngreso || null,
    resultados: p.resultados,
    correo: p.correo,
  })),
}

fs.writeFileSync(SALIDA, JSON.stringify(informe, null, 2), { mode: 0o600 })

console.log('Fuentes')
for (const f of acceso.leidos) console.log(`  · ${f.archivo}  ${f.lineas} línea(s)`)
console.log(`  · ${LIBRO}  ${libro.existe ? `${libro.lineas} línea(s)` : 'no existe'}\n`)
console.log('Resumen')
console.log(`  personas que han entrado   ${informe.resumen.personasConIngreso}`)
console.log(`  inicios de sesión totales  ${informe.resumen.ingresosTotales}`)
console.log(`  intentos rechazados        ${informe.resumen.intentosRechazados}`)
console.log(`  correo de inscripción      ${JSON.stringify(porEstadoDeCorreo)}\n`)
console.log(`Escrito ${SALIDA} (${fs.statSync(SALIDA).size} bytes)\n`)

// ── Transporte opcional: mandarlo por correo con las credenciales que ya hay ──
// El servidor no puede pegarte el archivo en el portapapeles, pero sí sabe mandar correo: es lo
// que hace el correo de inscripción. Se reutiliza ESA credencial (Mail.Send de aplicación) y no
// se abre ninguna ruta HTTP nueva  un endpoint que sirviera el registro de asistencia sería la
// peor puerta que se le puede poner a este servidor (docs/SEGURIDAD.md).
//
// Un solo destinatario, validado con la misma guardia del transporte real. Sin `cc` ni `bcc`.
if (!ENVIAR_A) {
  console.log('Sin --enviar: el archivo se queda en el servidor.\n')
  process.exit(0)
}

if (!UNA_DIRECCION.test(ENVIAR_A)) {
  console.error(`\n--enviar «${ENVIAR_A}» no es UNA dirección. No se mandó nada.\n`)
  process.exit(1)
}
if (!UNA_DIRECCION.test(REMITENTE)) {
  console.error(
    '\nFalta el remitente. Es INSCRIPCION_REMITENTE de /etc/gtalks/env, o pásalo con --remitente.\n' +
    'Recuerda cargar el entorno:\n' +
    "  sudo bash -c 'set -a; . /etc/gtalks/env; set +a; node /tmp/inscritos-exportar.mjs --enviar …'\n",
  )
  process.exit(1)
}

const cred = process.env.MAIL_TENANT_ID
  ? {
      tenantId: process.env.MAIL_TENANT_ID,
      clientId: process.env.MAIL_CLIENT_ID,
      clientSecret: process.env.MAIL_CLIENT_SECRET,
      origen: 'MAIL_*',
    }
  : {
      tenantId: process.env.M365_TENANT_ID,
      clientId: process.env.M365_CLIENT_ID,
      clientSecret: process.env.M365_CLIENT_SECRET,
      origen: 'M365_*',
    }

if (!cred.tenantId || !cred.clientId || !cred.clientSecret) {
  console.error(
    '\nNo hay credenciales de Graph en el entorno. Carga /etc/gtalks/env antes de correr esto:\n' +
    "  sudo bash -c 'set -a; . /etc/gtalks/env; set +a; node /tmp/inscritos-exportar.mjs --enviar …'\n",
  )
  process.exit(1)
}

console.log(`Enviando a ${ENVIAR_A} desde ${REMITENTE} (credencial ${cred.origen})…`)

// Token de aplicación por client credentials, a pelo con `fetch`: este script tiene que poder
// correr desde /tmp, sin el node_modules de /opt/gtalks.
const respuestaToken = await fetch(
  `https://login.microsoftonline.com/${encodeURIComponent(cred.tenantId)}/oauth2/v2.0/token`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cred.clientId,
      client_secret: cred.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
    signal: AbortSignal.timeout(30_000),
  },
)
if (!respuestaToken.ok) {
  console.error(`\nNo se pudo obtener el token (HTTP ${respuestaToken.status}). No se mandó nada.\n`)
  process.exit(1)
}
const { access_token: token } = await respuestaToken.json()

const adjunto = fs.readFileSync(SALIDA)
const nombreAdjunto = path.basename(SALIDA)
const cuerpo =
  `<p>Exportación de inscritos del Foro G-TALKS.</p>` +
  `<p>Servidor <b>${os.hostname()}</b> · generado ${informe.generado}<br>` +
  `Personas que han entrado: <b>${informe.resumen.personasConIngreso}</b> · ` +
  `inicios de sesión: ${informe.resumen.ingresosTotales} · ` +
  `intentos rechazados: ${informe.resumen.intentosRechazados}</p>` +
  `<p>El adjunto va ${CON_CORREOS ? 'CON correos corporativos' : 'en seudónimo (solo <code>oid</code>)'}. ` +
  `Guárdalo en <code>.datos/</code> del repositorio y cruza los nombres con ` +
  `<code>node scripts/inscritos-excel.mjs</code>.</p>`

const envio = await fetch(
  `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(REMITENTE)}/sendMail`,
  {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: `[G-TALKS] Inscritos ${HOY}  ${informe.resumen.personasConIngreso} personas`,
        body: { contentType: 'HTML', content: cuerpo },
        toRecipients: [{ emailAddress: { address: ENVIAR_A } }],
        attachments: [
          {
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: nombreAdjunto,
            contentType: 'application/json',
            contentBytes: adjunto.toString('base64'),
          },
        ],
      },
      saveToSentItems: true,
    }),
    signal: AbortSignal.timeout(30_000),
  },
)

if (envio.status === 202) {
  console.log(`\nEnviado. Revisa la bandeja de ${ENVIAR_A}.\n`)
  process.exit(0)
}
let codigo = ''
try {
  codigo = (await envio.json())?.error?.code || ''
} catch {
  /* Graph no siempre devuelve JSON */
}
console.error(`\nGraph respondió ${envio.status}${codigo ? ` (${codigo})` : ''}. El archivo sigue en ${SALIDA}.\n`)
process.exit(1)

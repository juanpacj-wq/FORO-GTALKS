// Verificación del server público + identidad Entra ID (server/).
// Sale con código 1 si algo falla.
//
//   npm run build
//   npm run start:local                  # en una terminal (o `npm start` con el entorno puesto)
//   node scripts/gate-test.mjs           # en otra
//
// La regla que verifica este archivo, y que es el requisito del sitio desde la apertura:
//
//   El contenido del foro es PÚBLICO; ninguna navegación redirige sola a Microsoft.
//   Lo único con sesión es la identidad: /api/me responde 401 sin ella, los métodos que no son
//   de lectura pasan por el CSRF, y todo HTML sale con la Content-Security-Policy puesta.
//
// Usa `node:http` y NO `fetch`: undici fuerza `Sec-Fetch-Mode: cors` y no permite emular una
// navegación de navegador, que sigue siendo lo que hay que distinguir (el fallback SPA responde
// HTML a las navegaciones y 404 JSON a los subrecursos rotos).
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { estadoEncuestas } from '../server/encuestas.js'

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:3000')
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let fallos = 0
function check(nombre, ok, detalle = '') {
  console.log(`${ok ? '  ok  ' : ' FALLA'} ${nombre}${detalle ? ` ${detalle}` : ''}`)
  if (!ok) fallos++
}

function pedir(ruta, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: base.hostname, port: base.port, path: ruta, method, headers },
      (res) => {
        const trozos = []
        res.on('data', (d) => trozos.push(d))
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, cuerpo: Buffer.concat(trozos).toString('utf8') }),
        )
      },
    )
    req.on('error', reject)
    req.end()
  })
}

/** Cabeceras que manda un navegador al NAVEGAR (barra de direcciones, clic en un enlace). */
const NAVEGA = {
  'sec-fetch-mode': 'navigate',
  'sec-fetch-dest': 'document',
  'sec-fetch-site': 'none',
  accept: 'text/html,application/xhtml+xml',
}
/** Cabeceras de un subrecurso pedido por el propio documento. */
const SUBRECURSO = (dest) => ({
  'sec-fetch-mode': 'no-cors',
  'sec-fetch-dest': dest,
  'sec-fetch-site': 'same-origin',
})

// ─────────────────────────────────────── navegaciones: públicas, con cabeceras
console.log('\nNavegación sin sesión → el sitio se sirve, con la CSP puesta')

/** Un id de tarjeta que no existe: la ruta es válida para la SPA aunque el perfil no. */
const UUID_NADIE = '00000000-0000-4000-8000-000000000000'

for (const ruta of ['/', '/ponentes', '/ponentes/karen-henriquez-leal', '/escarapela', '/encuestas', '/certificado', '/galeria', '/cdpadmin', `/carta_presentacion/${UUID_NADIE}`]) {
  const r = await pedir(ruta, { headers: NAVEGA })
  const csp = r.headers['content-security-policy'] || ''
  check(`${ruta} se sirve (200, HTML)`, r.status === 200 && (r.headers['content-type'] || '').includes('text/html'), String(r.status))
  check(`${ruta} lleva la CSP`, csp.includes("default-src 'none'"), csp ? csp.slice(0, 40) : '(ausente)')
  check(`${ruta} no se cachea`, (r.headers['cache-control'] || '').includes('no-store'))
  // Minimización: navegar anónimo NO crea sesión (saveUninitialized: false, y sin gate que
  // escriba `destino`). Una cookie aquí sería un session store llenándose con visitas.
  check(`${ruta} no fija cookies`, r.headers['set-cookie'] === undefined, String(r.headers['set-cookie'] || ''))
}

{
  const r = await pedir('/', { method: 'HEAD', headers: NAVEGA })
  check('HEAD / responde 200', r.status === 200, String(r.status))
}

{
  // Clientes viejos sin Sec-Fetch: se decide por Accept, para no dejar fuera a nadie.
  const r = await pedir('/', { headers: { accept: 'text/html' } })
  check('un cliente sin Sec-Fetch también recibe el sitio', r.status === 200, String(r.status))
}

// ─────────────────────────────────────────────── subrecursos: públicos, cacheables
console.log('\nSubrecursos → 200, cacheables en cachés compartidas')

for (const [ruta, dest, cache] of [
  ['/img/hero-matriz-energetica.webp', 'image', 'public'],
  ['/img/fichas-conversacion.webp', 'image', 'public'],
  ['/fonts/urbanist-latin.woff2', 'font', 'public'],
  ['/favicon.svg', 'image', 'public'],
]) {
  const r = await pedir(ruta, { headers: SUBRECURSO(dest) })
  check(`${ruta} es público`, r.status === 200, String(r.status))
  check(`${ruta} se puede cachear`, (r.headers['cache-control'] || '').includes(cache), r.headers['cache-control'] || '')
}

{
  // El fallback SPA es solo para navegaciones: un asset roto pedido por un <img> recibe el 404
  // JSON, no HTML con 200 (que envenenaría cachés y confundiría al navegador).
  const roto = await pedir('/no-existe.png', { headers: SUBRECURSO('image') })
  check('un subrecurso inexistente recibe 404 JSON', roto.status === 404 && (roto.headers['content-type'] || '').includes('json'), String(roto.status))
  const navegado = await pedir('/no-existe.png', { headers: NAVEGA })
  check('esa misma URL navegada recibe la SPA (200)', navegado.status === 200 && (navegado.headers['content-type'] || '').includes('text/html'), String(navegado.status))
}

// ─────────────────────────────── identidad y mutadores: lo único que sigue cerrado
console.log('\nIdentidad y mutadores → 401 / 403')

{
  const r = await pedir('/api/me')
  check('/api/me responde 401 sin sesión', r.status === 401, String(r.status))
  check('y no se cachea', (r.headers['cache-control'] || '').includes('no-store'))
  check('y dice authenticated: false', r.cuerpo.includes('"authenticated":false'), r.cuerpo.slice(0, 40))
}

{
  const r = await pedir('/api/me', { method: 'POST' })
  check('POST sin Origin ni Sec-Fetch-Site responde 403', r.status === 403, String(r.status))
}

{
  const r = await pedir('/api/me', { method: 'PATCH' })
  check('PATCH está cubierto por el CSRF', r.status === 403, String(r.status))
}

{
  const r = await pedir('/api/me', {
    method: 'POST',
    headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
  })
  check('POST desde otro origen responde 403', r.status === 403, String(r.status))
}

{
  // El correo de inscripción NO añadió superficie. No hay ruta para dispararlo, reenviarlo ni
  // consultarlo: un botón de «reenviar» sería un generador de correo a discreción del cliente.
  // Lo único que cambió es un campo DENTRO de /api/me, que sigue cerrado sin sesión.
  for (const ruta of ['/api/inscripcion', '/api/inscripciones', '/api/correo', '/api/me/inscripcion']) {
    const post = await pedir(ruta, { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } })
    check(`POST ${ruta} no existe`, post.status === 404, String(post.status))
    const get = await pedir(ruta, { headers: SUBRECURSO('empty') })
    check(`GET ${ruta} tampoco`, get.status === 404, String(get.status))
  }
}

// ─────────────────── el certificado: identidad cerrada y CERO superficie extra
console.log('\nCertificado → 401 sin sesión, sin rutas hermanas, sin fallback')

{
  const r = await pedir('/api/certificado')
  check('/api/certificado responde 401 sin sesión', r.status === 401, String(r.status))
  check('y no se cachea', (r.headers['cache-control'] || '').includes('no-store'), r.headers['cache-control'] || '')
  check('y no fija cookies', r.headers['set-cookie'] === undefined, String(r.headers['set-cookie'] || ''))
  check('y no filtra nada un PDF empieza por %PDF, un 401 por {', r.cuerpo.startsWith('{'), r.cuerpo.slice(0, 24))
}

{
  // Navegar directo a /api/certificado sin sesión NO cae al fallback SPA: la identidad decide,
  // no la heurística de navegación (`esNavegacion` excluye /api/ por construcción, y esto lo fija).
  const r = await pedir('/api/certificado', { headers: NAVEGA })
  check('/api/certificado navegado sin sesión sigue siendo 401 JSON', r.status === 401 && !(r.headers['content-type'] || '').includes('html'), `${r.status} ${r.headers['content-type'] || ''}`)
}

{
  // Mutadores: la ruta es de SOLO lectura. Cross-site los corta el CSRF; same-origin no existen.
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const r = await pedir('/api/certificado', { method, headers: { 'sec-fetch-site': 'same-origin' } })
    check(`${method} /api/certificado no existe`, r.status === 404, String(r.status))
  }
}

{
  // La «peor puerta» (docs/EXPORTAR-INSCRITOS.md) sigue sin existir: nada de listar, nada de
  // pedir por identificador. El certificado de OTRO no se puede nombrar en ninguna URL.
  for (const ruta of [
    '/api/certificados',
    '/api/certificado/jcespedes',
    '/api/certificado/00000000-1111-2222-3333-444444444444',
    '/api/certificado?oid=otro',
    '/api/asistentes',
  ]) {
    const r = await pedir(ruta, { headers: SUBRECURSO('empty') })
    // `?oid=` cae en la MISMA ruta (el parámetro se ignora y responde su propio 401);
    // todo lo demás no existe.
    const esperado = ruta.includes('?') ? 401 : 404
    check(`GET ${ruta} → ${esperado}`, r.status === esperado, String(r.status))
    check(`GET ${ruta} no filtra datos`, !/nombre|cedula|cédula|\.pdf/i.test(r.cuerpo), r.cuerpo.slice(0, 40))
  }
}

// ─────────────────────── la encuesta de satisfacción: la URL la entrega el reloj
console.log('\nEncuesta de satisfacción → la URL solo existe tras el cierre del evento')

{
  // La hora de cierre sale del MISMO archivo que lee el servidor: si esta prueba
  // y server/encuestas.js leyeran fuentes distintas, la coherencia de abajo no
  // probaría nada.
  const evento = JSON.parse(fs.readFileSync(path.join(RAIZ, 'src', 'data', 'evento.json'), 'utf8'))
  const cierreMs = Date.parse(evento.fecha.cierreIso)
  check('evento.json declara el cierre con desfase explícito', Number.isFinite(cierreMs), String(evento.fecha.cierreIso))

  // La frontera exacta, sin esperar al 5 de agosto: `estadoEncuestas` es pura y
  // acepta el reloj inyectado. Un milisegundo antes NO viaja la URL ni ningún
  // rastro de ella; en el instante del cierre, viaja.
  const antes = estadoEncuestas(cierreMs - 1)
  check(
    'un milisegundo antes: cerrada y sin URL (ni el campo existe)',
    antes.satisfaccion.habilitada === false && !('url' in antes.satisfaccion),
  )
  check(
    'y la respuesta cerrada no filtra el destino por ningún campo',
    !JSON.stringify(antes).includes('forms.cloud.microsoft'),
  )
  const justo = estadoEncuestas(cierreMs)
  check(
    'en el instante del cierre: abierta y con URL https',
    justo.satisfaccion.habilitada === true && /^https:\/\//.test(justo.satisfaccion.url ?? ''),
  )

  // El endpoint público, contra el server de verdad. La coherencia se comprueba
  // con el reloj de esta máquina, que es la misma del server local; solo sería
  // ambigua corriendo la prueba en el minuto exacto del cierre.
  const r = await pedir('/api/encuestas', { headers: SUBRECURSO('empty') })
  check('/api/encuestas responde 200 JSON', r.status === 200 && (r.headers['content-type'] || '').includes('json'), String(r.status))
  check('y no se cachea', (r.headers['cache-control'] || '').includes('no-store'), r.headers['cache-control'] || '')
  check('y no fija cookies', r.headers['set-cookie'] === undefined, String(r.headers['set-cookie'] || ''))

  const cuerpo = JSON.parse(r.cuerpo)
  const abierta = Date.now() >= cierreMs
  check(
    `el estado coincide con el reloj (${abierta ? 'ya cerró el evento' : 'aún no cierra'})`,
    cuerpo.satisfaccion?.habilitada === abierta,
    r.cuerpo.slice(0, 80),
  )
  if (abierta) {
    check('abierta: la URL viaja y es https', /^https:\/\//.test(cuerpo.satisfaccion.url ?? ''), String(cuerpo.satisfaccion.url))
  } else {
    check('cerrada: la URL NO viaja en la respuesta', !r.cuerpo.includes('forms.cloud.microsoft') && cuerpo.satisfaccion.url === undefined, r.cuerpo.slice(0, 80))
  }

  // Solo lectura: no hay mutador que abrir la encuesta antes de hora ni nada que
  // un POST pueda hacerle. El CSRF lo intercepta cross-site; same-origin, no existe.
  const post = await pedir('/api/encuestas', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } })
  check('POST /api/encuestas no existe', post.status === 404, String(post.status))
}

// ─────────────────────────────────── descargas de /galeria: público y coherente
// Contenido público servido con la doctrina del certificado: el servidor solo
// entrega lo que la estación empaquetó, y la página solo anuncia lo que este
// endpoint confirme. Aquí se comprueba la COHERENCIA entre las dos puntas: cada
// rol anunciado entrega su ZIP como adjunto (HEAD, que el de fotos pesa 1.3 GB),
// y lo no anunciado o inventado cae al 404 genérico.
console.log('\nDescargas de /galeria → estado público, entrega coherente')
{
  const r = await pedir('/api/descargas', { headers: SUBRECURSO('empty') })
  check('/api/descargas responde 200 JSON', r.status === 200 && (r.headers['content-type'] || '').includes('json'), String(r.status))
  check('y no se cachea', (r.headers['cache-control'] || '').includes('no-store'), r.headers['cache-control'] || '')
  check('y no fija cookies', r.headers['set-cookie'] === undefined, String(r.headers['set-cookie'] || ''))

  const estado = JSON.parse(r.cuerpo)
  for (const rol of ['imagenes', 'presentaciones']) {
    const anunciado = estado[rol]
    if (anunciado) {
      check(
        `«${rol}» anunciado con bytes y elementos`,
        Number(anunciado.bytes) > 0 && Number(anunciado.elementos) > 0,
        JSON.stringify(anunciado),
      )
      // Con NAVEGA a propósito: un clic en `<a download>` NO es un subrecurso, viaja con las
      // mismas cabeceras que escribir la URL en la barra. Pedir esto «a secas» (sin `accept`)
      // era el punto ciego que dejó pasar el fallo: por ese camino `esNavegacion()` da falso y
      // el 404 salía por una puerta que un navegador nunca toca.
      const zip = await pedir(`/descargas/${rol}`, { method: 'HEAD', headers: NAVEGA })
      check(
        `y /descargas/${rol} entrega el ZIP como adjunto`,
        zip.status === 200 &&
          (zip.headers['content-disposition'] || '').startsWith('attachment') &&
          Number(zip.headers['content-length']) === Number(anunciado.bytes),
        `${zip.status} · ${zip.headers['content-disposition'] || '(sin disposición)'}`,
      )
      check(
        `y /descargas/${rol} se reanuda por rangos`,
        (zip.headers['accept-ranges'] || '') === 'bytes',
        zip.headers['accept-ranges'] || '(sin accept-ranges)',
      )
    } else {
      const zip = await pedir(`/descargas/${rol}`, { method: 'HEAD', headers: NAVEGA })
      check(`«${rol}» no anunciado: su descarga no existe (404)`, zip.status === 404, String(zip.status))
    }
  }

  // Lo que no existe bajo /descargas/ es 404 JSON, y esto se comprueba NAVEGANDO porque así es
  // como llega el clic. Un 200 con `text/html` aquí es el fallo entero: el navegador se guarda el
  // index.html con el nombre del rol («imagenes.htm»), sin nada que parezca un error.
  for (const ruta of ['/descargas/otra-cosa', '/descargas/imagenes/extra', '/descargas/']) {
    const r = await pedir(ruta, { headers: NAVEGA })
    const tipo = r.headers['content-type'] || ''
    check(
      `${ruta} navegado NO devuelve la SPA`,
      r.status === 404 && !tipo.includes('text/html'),
      `${r.status} · ${tipo || '(sin tipo)'}`,
    )
  }

  const post = await pedir('/api/descargas', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } })
  check('POST /api/descargas no existe', post.status === 404, String(post.status))
}

// ─────────────────────────── la carta de presentación: pública la tarjeta, cerrado el panel
// Ramifica por lo que /health declara: con las DB_* puestas el módulo existe y se exige la
// matriz entera; sin ellas, TODO /api/carta/* tiene que ser 404, que es «el módulo no existe».
console.log('\nCarta de presentación → la tarjeta es pública, el panel exige sesión Y rol')
{
  const salud = JSON.parse((await pedir('/health', { headers: SUBRECURSO('empty') })).cuerpo)
  const carta = salud.carta || {}
  console.log(`  (/health dice carta.configurada=${carta.configurada} bd=${carta.bd} migraciones=${carta.migraciones})`)

  // Un rastreador de vista previa (Teams, WhatsApp) pide la tarjeta sin Sec-Fetch y sin Accept:
  // tiene que recibir HTML igual, con la CSP. Es la excepción acotada de `esNavegacion`.
  const rastreador = await pedir(`/carta_presentacion/${UUID_NADIE}`, { headers: { 'user-agent': 'WhatsApp/2.0' } })
  check('la tarjeta pedida sin Sec-Fetch ni Accept recibe HTML (rastreadores OG)', rastreador.status === 200 && (rastreador.headers['content-type'] || '').includes('text/html'), String(rastreador.status))
  check('  con la CSP', (rastreador.headers['content-security-policy'] || '').includes("default-src 'none'"))
  check('  y sin cookie', rastreador.headers['set-cookie'] === undefined)
  // Pero SOLO esa forma exacta: cualquier otra ruta sin cabeceras sigue siendo 404 JSON.
  const otra = await pedir('/cdpadmin', { headers: { 'user-agent': 'WhatsApp/2.0' } })
  check('  /cdpadmin sin cabeceras NO abre la excepción (404 JSON)', otra.status === 404, String(otra.status))
  const mal = await pedir('/carta_presentacion/no-es-uuid', { headers: { 'user-agent': 'WhatsApp/2.0' } })
  check('  ni un id que no sea UUID', mal.status === 404, String(mal.status))

  if (carta.configurada === true) {
    check('/health: bd ok', carta.bd === 'ok', String(carta.bd))
    check('/health: migraciones al día', carta.migraciones === 'al_dia', String(carta.migraciones))

    const admin = await pedir('/api/carta/admin/perfiles', { headers: SUBRECURSO('empty') })
    check('GET /api/carta/admin/perfiles sin sesión → 401 JSON', admin.status === 401 && admin.cuerpo.includes('"authenticated":false'), String(admin.status))
    check('  no-store', (admin.headers['cache-control'] || '').includes('no-store'))
    check('  sin cookie', admin.headers['set-cookie'] === undefined)
    const adminNav = await pedir('/api/carta/admin/perfiles', { headers: NAVEGA })
    check('  navegado también 401 JSON (no cae al fallback)', adminNav.status === 401 && !(adminNav.headers['content-type'] || '').includes('html'), String(adminNav.status))
    const putSin = await pedir(`/api/carta/admin/perfiles/${UUID_NADIE}`, { method: 'PUT', headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' } })
    check('PUT same-origin sin sesión → 401', putSin.status === 401, String(putSin.status))
    const putX = await pedir(`/api/carta/admin/perfiles/${UUID_NADIE}`, { method: 'PUT', headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' } })
    check('PUT cross-site → 403 (CSRF antes que nada)', putX.status === 403, String(putX.status))
    const postSin = await pedir('/api/carta/admin/perfiles', { method: 'POST', headers: { 'content-type': 'application/json' } })
    check('POST sin Origin ni Sec-Fetch-Site → 403', postSin.status === 403, String(postSin.status))
    const delX = await pedir(`/api/carta/admin/perfiles/${UUID_NADIE}/foto`, { method: 'DELETE', headers: { 'sec-fetch-site': 'cross-site' } })
    check('DELETE cross-site → 403', delX.status === 403, String(delX.status))

    const pub = await pedir(`/api/carta/perfiles/${UUID_NADIE}`, { headers: SUBRECURSO('empty') })
    check('GET perfil público inexistente → 404 JSON', pub.status === 404 && (pub.headers['content-type'] || '').includes('json'), String(pub.status))
    check('  sin PII en el cuerpo', !/nombre|correo|@|tel/i.test(pub.cuerpo), pub.cuerpo.slice(0, 40))
    check('  no-store y sin cookie', (pub.headers['cache-control'] || '').includes('no-store') && pub.headers['set-cookie'] === undefined)
    for (const ruta of ['/api/carta/perfiles/not-a-uuid', `/api/carta/perfiles/${UUID_NADIE}/foto`, `/api/carta/perfiles/${UUID_NADIE}/vcard`]) {
      const r = await pedir(ruta, { headers: NAVEGA })
      check(`${ruta} navegado → 404 JSON, nunca HTML`, r.status === 404 && !(r.headers['content-type'] || '').includes('html'), `${r.status} ${r.headers['content-type'] || ''}`)
    }
    const listado = await pedir('/api/carta/perfiles', { headers: SUBRECURSO('empty') })
    check('GET /api/carta/perfiles (listado público) no existe', listado.status === 404, String(listado.status))
    const postPub = await pedir('/api/carta/perfiles', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' } })
    check('POST público no existe', postPub.status === 404, String(postPub.status))
  } else {
    console.log('  (módulo apagado: se exige que NADA de /api/carta/* exista)')
    for (const [ruta, method] of [
      ['/api/carta/admin/perfiles', 'GET'],
      [`/api/carta/perfiles/${UUID_NADIE}`, 'GET'],
      [`/api/carta/perfiles/${UUID_NADIE}/foto`, 'GET'],
      [`/api/carta/perfiles/${UUID_NADIE}/vcard`, 'GET'],
      ['/api/carta/admin/perfiles', 'POST'],
    ]) {
      const r = await pedir(ruta, { method, headers: { ...SUBRECURSO('empty'), 'sec-fetch-site': 'same-origin' } })
      check(`${method} ${ruta} → 404 (módulo apagado)`, r.status === 404, String(r.status))
    }
    check('/health: bd apagada', carta.bd === 'apagada', String(carta.bd))
  }
}

// ──────────────────────────────────────────── el login sigue vivo, y es explícito
console.log('\nLogin OIDC → solo por clic, siempre interactivo')

{
  const r = await pedir('/auth/login', { headers: NAVEGA })
  const destino = r.headers.location || ''
  check(
    'el login apunta a login.microsoftonline.com',
    r.status === 302 && destino.startsWith('https://login.microsoftonline.com/'),
    destino.slice(0, 56),
  )
  check('y lleva PKCE S256', destino.includes('code_challenge_method=S256'))
  check('y lleva state', destino.includes('state='))
  check('y lleva nonce', destino.includes('nonce='))
  // El SSO silencioso murió con el gate: un `prompt=none` aquí sería el fantasma del modelo
  // viejo, capaz de resucitar el bucle de redirecciones que el rompebucles existía para cortar.
  check('y NO pide prompt=none', !destino.includes('prompt=none'), destino.includes('prompt=none') ? 'prompt=none presente' : '')
}

{
  const r = await pedir('/auth/login?select=1', { headers: NAVEGA })
  const destino = r.headers.location || ''
  check('«entrar con otra cuenta» pide select_account', destino.includes('prompt=select_account'), destino.slice(0, 56))
}

{
  // El destino del retorno pasa por la allowlist RUTAS_SPA: uno inválido no impide el login
  // (cae al default /escarapela), y jamás puede salir del sitio.
  const r = await pedir('/auth/login?destino=//evil.example', { headers: NAVEGA })
  check('un destino inválido no rompe el login', r.status === 302 && (r.headers.location || '').startsWith('https://login.microsoftonline.com/'), String(r.status))
}

// ────────────────────────────────────────────────────────── cabeceras
console.log('\nCabeceras de seguridad')

{
  const r = await pedir('/', { headers: NAVEGA })
  const esperadas = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    // Público ≠ indexable: es el evento interno de una empresa, no una página que deba salir
    // en un buscador. La cabecera cubre también los assets, donde el <meta> no llega.
    'x-robots-tag': 'noindex, nofollow',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
  }
  for (const [cabecera, valor] of Object.entries(esperadas)) {
    check(`${cabecera}: ${valor}`, (r.headers[cabecera] || '') === valor, r.headers[cabecera] || '(ausente)')
  }
  check('referrer-policy presente', Boolean(r.headers['referrer-policy']), r.headers['referrer-policy'] || '')
  check('no expone x-powered-by', !r.headers['x-powered-by'])
}

console.log(fallos === 0 ? '\nServer público + identidad: todo en orden.\n' : `\n${fallos} verificación(es) fallaron.\n`)
process.exit(fallos === 0 ? 0 : 1)

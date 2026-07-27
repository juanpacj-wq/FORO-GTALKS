// Verificación del gate de Microsoft Entra ID sobre el sitio servido por server/.
// Sale con código 1 si algo falla.
//
//   npm run build
//   npm run start:local                  # en una terminal (o `npm start` con el entorno puesto)
//   node scripts/gate-test.mjs           # en otra
//
// La regla que verifica este archivo, y que es el requisito del sitio:
//
//   NINGUNA navegación de una persona termina en un callejón sin salida que no sea Microsoft.
//   Todo lo demás —subrecursos, fetch, API, métodos que no son de lectura— recibe 401, porque
//   redirigirlos a Entra devuelve HTML donde se esperaba un script, una imagen o un JSON.
//
// Usa `node:http` y NO `fetch`: undici fuerza `Sec-Fetch-Mode: cors` y no permite emular una
// navegación de navegador, que es justo lo que hay que distinguir aquí. Con `fetch` este script
// reportaría 401 en las navegaciones y el fallo estaría en la prueba, no en el servidor.
import http from 'node:http'

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:3000')

let fallos = 0
function check(nombre, ok, detalle = '') {
  console.log(`${ok ? '  ok  ' : ' FALLA'} ${nombre}${detalle ? ` — ${detalle}` : ''}`)
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

// ─────────────────────────────────────────────── navegaciones: todas a Microsoft
console.log('\nNavegación sin sesión → autenticación de Microsoft')

for (const ruta of ['/', '/ponentes', '/ponentes/karen-henriquez-leal', '/escarapela', '/encuestas']) {
  const r = await pedir(ruta, { headers: NAVEGA })
  check(
    `${ruta} redirige al login`,
    r.status === 302 && (r.headers.location || '').startsWith('/auth/login'),
    `${r.status} → ${r.headers.location}`,
  )
}

// El caso que antes fallaba: una URL de asset ESCRITA A MANO en la barra de direcciones es una
// navegación, no un subrecurso, y debe acabar en Microsoft igual que cualquier otra.
{
  const r = await pedir('/img/hero-aerogeneradores.webp', { headers: NAVEGA })
  check('un asset escrito en la barra también redirige', r.status === 302, `${r.status} → ${r.headers.location}`)
}

{
  const r = await pedir('/', { method: 'HEAD', headers: NAVEGA })
  check('HEAD / redirige (no 401)', r.status === 302, String(r.status))
}

{
  // Clientes viejos sin Sec-Fetch: se decide por Accept, para no dejar fuera a nadie.
  const r = await pedir('/', { headers: { accept: 'text/html' } })
  check('un cliente sin Sec-Fetch también redirige', r.status === 302, String(r.status))
}

{
  const r = await pedir('/auth/login?silent=1', { headers: NAVEGA })
  const destino = r.headers.location || ''
  check(
    'el login apunta a login.microsoftonline.com',
    r.status === 302 && destino.startsWith('https://login.microsoftonline.com/'),
    destino.slice(0, 56),
  )
  check('y pide prompt=none (SSO silencioso)', destino.includes('prompt=none'))
  check('y lleva PKCE S256', destino.includes('code_challenge_method=S256'))
}

// ────────────────────────────────────────────── subrecursos y API: 401, no 302
console.log('\nSubrecursos, API y mutadores → 401 / 403, nunca redirect')

for (const [ruta, dest] of [
  ['/img/hero-aerogeneradores.webp', 'image'],
  ['/fonts/urbanist-latin-ext.woff2', 'font'],
]) {
  const r = await pedir(ruta, { headers: SUBRECURSO(dest) })
  check(`${ruta} (${dest}) responde 401`, r.status === 401, String(r.status))
}

{
  const r = await pedir('/api/me')
  check('/api/me responde 401', r.status === 401, String(r.status))
  check('y no se cachea', (r.headers['cache-control'] || '').includes('no-store'))
}

{
  const r = await pedir('/api/logout', { method: 'POST' })
  check('POST sin Origin ni Sec-Fetch-Site responde 403', r.status === 403, String(r.status))
}

{
  const r = await pedir('/api/me', { method: 'PATCH' })
  check('PATCH está cubierto por el CSRF', r.status === 403, String(r.status))
}

{
  const r = await pedir('/api/logout', {
    method: 'POST',
    headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
  })
  check('POST desde otro origen responde 403', r.status === 403, String(r.status))
}

// ──────────────────────────────────────────────────── lo único público
console.log('\nSuperficie pública')

for (const ruta of [
  '/favicon.svg',
  '/img/logo-gecelca.svg',
  '/img/icono-burbujas.svg',
  '/img/wordmark-g-talks.svg',
  '/fonts/urbanist-latin.woff2',
]) {
  const r = await pedir(ruta)
  check(`${ruta} es público (lo usa la pantalla de login)`, r.status === 200, String(r.status))
}

{
  const r = await pedir('/img/fichas-conversacion.webp', { headers: SUBRECURSO('image') })
  check('el contenido del foro NO es público', r.status === 401, String(r.status))
}

{
  const r = await pedir('/?auth=no_acceso', { headers: NAVEGA })
  check('con marcador se sirve la pantalla de login', r.status === 200, String(r.status))
  const csp = r.headers['content-security-policy'] || ''
  check('esa pantalla lleva CSP con hashes derivados', csp.includes("script-src 'sha256-"), csp.slice(0, 38))
  check('y no se cachea', (r.headers['cache-control'] || '').includes('no-store'))
  check('el aviso de registro de acceso está a la vista', r.cuerpo.includes('queda registrado'))
}

// ────────────────────────────────────────────────────────── cabeceras
console.log('\nCabeceras de seguridad')

{
  const r = await pedir('/', { headers: NAVEGA })
  const esperadas = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
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

// ─────────────────────────────────────────────────────── rompebucles
console.log('\nRompebucles de cookie')

{
  // Tres vueltas AUTOMÁTICAS sin conseguir sesión significan que la cookie no se puede fijar. A la
  // cuarta hay que dejar de reintentar y NOMBRAR la causa, o el navegador rebota para siempre.
  const r = await pedir('/auth/login?silent=1', { headers: { ...NAVEGA, cookie: 'gt_lt=3' } })
  check(
    'tras 3 intentos automáticos se corta hacia la pantalla',
    r.status === 302 && (r.headers.location || '').includes('cookies_bloqueadas'),
    `${r.status} → ${r.headers.location}`,
  )

  // REGRESIÓN: el contador llegó a incluir también los clics de la persona. Como cada carga de
  // página dispara un intento silencioso, a la tercera recarga el botón «Iniciar sesión» dejaba
  // de hacer absolutamente nada durante cinco minutos.
  const clic = await pedir('/auth/login', { headers: { ...NAVEGA, cookie: 'gt_lt=9' } })
  check(
    'un clic explícito SIEMPRE arranca el login, aunque el contador esté al tope',
    clic.status === 302 && (clic.headers.location || '').startsWith('https://login.microsoftonline.com/'),
    `${clic.status} → ${(clic.headers.location || '').slice(0, 46)}`,
  )
  check(
    'y reinicia el contador',
    String(clic.headers['set-cookie'] || '').includes('gt_lt=;'),
    String(clic.headers['set-cookie'] || '').slice(0, 40),
  )
}

console.log(fallos === 0 ? '\nGate: todo en orden.\n' : `\n${fallos} verificación(es) fallaron.\n`)
process.exit(fallos === 0 ? 0 : 1)

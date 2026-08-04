// Verificación del QR de la escarapela: que se LEA, y que diga LO CORRECTO.
// Sale con código 1 si algo falla.
//
//   npm run build && npm run preview     # en una terminal
//   node scripts/qr-test.mjs             # en otra
//
// Dos frentes:
//
// 1. LECTURA. El QR del dorso no es el de una librería estándar: replica la pieza «Diseño de
//    Código QR.png» (puntos separados, marcadores redondeados, la «G» al centro), y cada uno
//    de esos gestos le quita margen al decodificador. Se capturan los PÍXELES REALES del panel
//    renderizadolo que ve la cámara de un teléfono— y se decodifican con ZXing (zxing-wasm),
//    la misma familia de lectores de los escáneres reales, a dos densidades de captura
//    (deviceScaleFactor 2 y 3). jsQR no sirve de árbitro aquí: es mucho más estricto que un
//    lector real y solo acepta este estilo con puntos tangentes, que no son el diseño.
//
// 2. JORNADA. El ID_CAPACITACION depende de la hora DE BOGOTÁ del momento del escaneo
//    (00:00–11:59 → mañana; 12:00–23:59 → tarde), y el cálculo tiene que ser inmune a la zona
//    horaria del entorno el servidor Ubuntu de producción no necesariamente corre en UTC-5,
//    y el navegador de un visitante tampoco. Se congela el reloj del navegador en los cuatro
//    instantes frontera BAJO LA ZONA HORARIA DE TOKIO (UTC+9): si el cálculo usara la hora
//    local en vez de resolver América/Bogotá con Intl, las jornadas saldrían todas al revés.
//    También se cruza el mediodía EN VIVO: el carné abierto desde las 11:59 debe rotar su QR
//    a la jornada de la tarde sin recargar la página.
import { chromium } from 'playwright'
import { readBarcodes } from 'zxing-wasm/reader'

const base = process.argv[2] ?? 'http://localhost:4173'

let fallos = 0
function check(nombre, ok, detalle = '') {
  console.log(`${ok ? '  ok  ' : ' FALLA'} ${nombre}${detalle ? ` ${detalle}` : ''}`)
  if (!ok) fallos++
}

for (let intento = 1; ; intento++) {
  try {
    await fetch(base, { signal: AbortSignal.timeout(2000) })
    break
  } catch {
    if (intento >= 15) throw new Error(`El servidor no respondió en ${base}`)
    await new Promise((r) => setTimeout(r, 500))
  }
}

const IDENTIDAD = {
  authenticated: true,
  user: {
    nombre_completo: 'María Cristina Giraldo',
    cargo: 'Profesional de Comunicaciones',
    area: 'Vicepresidencia de Asuntos Corporativos',
    upn: 'mcgiraldo@gecelca.com.co',
    email: 'mcgiraldo@gecelca.com.co',
    oid: '00000000-1111-2222-3333-444444444444',
    roles: [],
  },
}

let browser
for (const channel of ['msedge', 'chrome']) {
  try {
    browser = await chromium.launch({ channel })
    break
  } catch {
    /* siguiente canal */
  }
}
if (!browser) throw new Error('No hay Edge ni Chrome disponibles')

console.log('\nEl QR del dorso se lee con un decodificador real')

for (const dsf of [2, 3]) {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 1400 },
    deviceScaleFactor: dsf,
  })
  await page.route('**/api/me', (ruta) => ruta.fulfill({ json: IDENTIDAD }))
  await page.goto(base + '/escarapela', { waitUntil: 'networkidle' })
  await page.click('.gt-escarapela-voltear')
  await page.waitForTimeout(1100) // la vuelta + el retardo de visibility de la cara

  const esperado = await page.locator('.gt-carne__qr').getAttribute('data-contenido')
  const png = await page.locator('.gt-carne__qr-panel').screenshot()
  const res = await readBarcodes(new Uint8Array(png), { formats: ['QRCode'], tryHarder: true })

  check(
    `a densidad ${dsf}x, ZXing decodifica el panel`,
    res.length === 1 && res[0].text === esperado,
    res.length ? `leyó ${res[0].text.slice(0, 60)}…` : 'no encontró ningún QR',
  )
  check(
    `y el contenido lleva el usuario de la sesión, sin dominio`,
    res.length === 1 && res[0].text.includes(`USUARIO=${IDENTIDAD.user.email.split('@')[0]}&`),
  )
  await page.close()
}

// ── 1b. El dibujo del navegador y el de Node son EL MISMO ────────────────────────────────────
// El arte del QR salió de `Escarapela.tsx` a `src/data/qr-arte.ts` porque tiene dos lectores:
// esta pantalla y `scripts/envio-qr.mjs`, que lo rasteriza para el correo. Que sea «el mismo
// diseño» no puede quedar en una convención entre dos implementaciones: aquí se compara el `d`
// que el navegador tiene pintado en el DOM con el que produce Node para la misma URL, carácter a
// carácter. Si alguien toca una cota, el correo y la escarapela dejan de coincidir y esto se pone
// rojo antes de que salgan 163 correos con otro código.
console.log('\nEl dibujo del navegador es exactamente el que produce Node')
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 1400 } })
  await page.route('**/api/me', (ruta) => ruta.fulfill({ json: IDENTIDAD }))
  await page.goto(base + '/escarapela', { waitUntil: 'networkidle' })
  await page.click('.gt-escarapela-voltear')
  await page.waitForTimeout(1100)

  const url = await page.locator('.gt-carne__qr').getAttribute('data-contenido')
  const dNavegador = await page.locator('.gt-carne__qr path').first().getAttribute('d')
  const tintaNavegador = await page.locator('.gt-carne__qr').evaluate((el) => getComputedStyle(el).color)

  const { arteQr, codificarQr, QR_TINTA } = await import('../src/data/qr-arte.ts')
  const dNode = arteQr(codificarQr(url)).d

  check('el `d` del navegador y el de Node son idénticos', dNavegador === dNode,
    dNavegador === dNode ? `(${dNode.length} caracteres)` : 'el arte divergió')

  // Y la tinta: el correo no tiene `tokens.css`, así que `qr-arte.ts` la lleva literal. Que sea
  // el MISMO azul que pinta el carné se comprueba, no se supone.
  const aHex = (rgb) => {
    const [r, g, b] = rgb.match(/\d+/g).map(Number)
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
  }
  check('y la tinta del carné es la constante que viaja al correo',
    aHex(tintaNavegador) === QR_TINTA.toLowerCase(), `carné=${aHex(tintaNavegador)} qr-arte=${QR_TINTA}`)

  await page.close()
}

// ── 2. La jornada del ID_CAPACITACION es la de Bogotá, venga de donde venga el reloj ─────────
console.log('\nLa jornada del ID_CAPACITACION se decide en hora de Bogotá (UTC-5)')

// Los ID son la ESPECIFICACIÓN, escritos aquí a mano a propósito: si alguien los cambia en
// src/data/escarapela.ts sin querer, este archivo no se entera y se pone rojo.
const ID_MANANA = 'fffbd1d0-7af2-4104-ac75-87964da57c19'
const ID_TARDE = 'a6589188-0bf5-4347-ad05-55207015a0e2'

const FRONTERAS = [
  ['2026-08-05T16:59:00Z', 'a las 11:59 de Bogotá, el QR es de la MAÑANA', ID_MANANA],
  ['2026-08-05T17:00:00Z', 'a las 12:00 de Bogotá, el QR es de la TARDE', ID_TARDE],
  ['2026-08-05T04:59:00Z', 'a las 23:59 de Bogotá, el QR sigue siendo de la TARDE', ID_TARDE],
  ['2026-08-05T05:00:00Z', 'a las 00:00 de Bogotá, el QR vuelve a la MAÑANA', ID_MANANA],
]

for (const [instante, nombre, idEsperado] of FRONTERAS) {
  // Tokio (UTC+9): la zona más hostil posible allá esas horas caen en la jornada contraria.
  const ctx = await browser.newContext({
    timezoneId: 'Asia/Tokyo',
    viewport: { width: 1200, height: 1400 },
  })
  const p = await ctx.newPage()
  await p.clock.install({ time: new Date(instante) })
  await p.route('**/api/me', (ruta) => ruta.fulfill({ json: IDENTIDAD }))
  await p.goto(base + '/escarapela', { waitUntil: 'networkidle' })
  const contenido = (await p.locator('.gt-carne__qr').getAttribute('data-contenido')) || ''
  check(
    `${nombre} (aunque el reloj corra en Tokio)`,
    contenido.includes(`ID_CAPACITACION=${idEsperado}`),
    contenido.slice(contenido.indexOf('ID_CAPACITACION=')).slice(0, 55),
  )
  await ctx.close()
}

// El cruce del mediodía EN VIVO: el carné quedó abierto desde las 11:59 y a las 12:01 el QR
// ya debe ser de la tarde, sin recargar es el tic de 30 s de Escarapela.tsx trabajando.
{
  const ctx = await browser.newContext({
    timezoneId: 'Asia/Tokyo',
    viewport: { width: 1200, height: 1400 },
  })
  const p = await ctx.newPage()
  await p.clock.install({ time: new Date('2026-08-05T16:59:00Z') })
  await p.route('**/api/me', (ruta) => ruta.fulfill({ json: IDENTIDAD }))
  await p.goto(base + '/escarapela', { waitUntil: 'networkidle' })

  const antes = (await p.locator('.gt-carne__qr').getAttribute('data-contenido')) || ''
  check('el carné abierto a las 11:59 muestra la mañana', antes.includes(`ID_CAPACITACION=${ID_MANANA}`))

  await p.clock.fastForward('02:00') // dos minutos: cruza el mediodía y dispara el tic
  await p.waitForTimeout(400) // React re-pinta en tiempo real, no en el reloj falso

  const despues = (await p.locator('.gt-carne__qr').getAttribute('data-contenido')) || ''
  check(
    'dos minutos después, el MISMO carné ya muestra la tarde, sin recargar',
    despues.includes(`ID_CAPACITACION=${ID_TARDE}`),
    despues.slice(despues.indexOf('ID_CAPACITACION=')).slice(0, 55),
  )
  await ctx.close()
}

await browser.close()
console.log(fallos === 0 ? '\nQR: todo en orden.\n' : `\n${fallos} verificación(es) fallaron.\n`)
process.exit(fallos === 0 ? 0 : 1)

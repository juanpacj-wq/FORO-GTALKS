// Captura las rutas del sitio en desktop y móvil, para verificación visual.
// Usa el navegador del sistema (Edge o Chrome), no descarga ninguno.
//
//   npm run preview                       # sirve dist/ en :4173, sin gate
//   node scripts/screenshot.mjs shots     # captura ahí
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { ID_FIXTURE, instalarMocks } from './fixture-carta.mjs'

const outDir = process.argv[2] ?? 'shots'
const base = process.argv[3] ?? 'http://localhost:4173'
const prefix = process.argv[4] ?? 'gtalks'

const routes = [
  ['inicio', '/'],
  ['ponentes', '/ponentes'],
  // Dos perfiles: quien abre y cierra la jornada, y un ponente de bloque.
  // Fueron «sin biografía» y «con ella» hasta la última entrega, que completó
  // las once fichas: ya no hay perfil sin bio que capturar.
  ['perfil-apertura', '/ponentes/erick-wehdeking-arcieri'],
  ['perfil-ponencia', '/ponentes/jose-fernando-prada'],
  ['escarapela', '/escarapela'],
  ['encuestas', '/encuestas'],
  ['certificado', '/certificado'],
  ['galeria', '/galeria'],
]

mkdirSync(outDir, { recursive: true })

let browser
for (const channel of ['msedge', 'chrome']) {
  try {
    browser = await chromium.launch({ channel })
    break
  } catch {
    /* intenta el siguiente canal */
  }
}
if (!browser) throw new Error('No hay Edge ni Chrome disponibles')

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  const page = await browser.newPage({ viewport })
  for (const [name, route] of routes) {
    await page.goto(base + route, { waitUntil: 'networkidle' })
    // Las fuentes tienen font-display: swap; sin esperarlas la captura sale
    // con la tipografía de reserva y las medidas no son las reales.
    await page.evaluate(() => document.fonts.ready)
    // Y un paseo hasta el fondo antes de disparar: la rejilla de /galeria va
    // con loading="lazy", y la captura fullPage no pasa por el viewport real,
    // así que sin recorrer la página las fotos de abajo salen como huecos.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) {
        window.scrollTo({ top: y, behavior: 'instant' })
        await new Promise((r) => setTimeout(r, 60))
      }
      window.scrollTo({ top: 0, behavior: 'instant' })
      // `complete` no basta: con decoding="async" una imagen puede estar
      // cargada y aún sin decodificar, y la captura la pinta como hueco.
      // decode() fuerza las dos cosas y falla inofensivo si ya estaba.
      await Promise.allSettled([...document.images].map((img) => img.decode()))
    })
    await page.waitForTimeout(300)
    await page.screenshot({
      path: `${outDir}/${prefix}-${name}-${viewport.name}.png`,
      fullPage: true,
    })
    console.log(`${prefix}-${name}-${viewport.name}.png`)
  }
  await page.close()

  // La escarapela con sesión: el carné solo existe autenticado, así que se simula /api/me
  // (misma técnica de sesion-test.mjs). Es la captura que se coteja contra Escarapela.png.
  const conSesion = await browser.newPage({ viewport })
  await conSesion.route('**/api/me', (ruta) =>
    ruta.fulfill({
      json: {
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
      },
    }),
  )
  await conSesion.goto(base + '/escarapela', { waitUntil: 'networkidle' })
  await conSesion.evaluate(() => document.fonts.ready)
  await conSesion.waitForTimeout(300)
  await conSesion.screenshot({
    path: `${outDir}/${prefix}-escarapela-sesion-${viewport.name}.png`,
    fullPage: true,
  })
  console.log(`${prefix}-escarapela-sesion-${viewport.name}.png`)
  await conSesion.click('.gt-escarapela-voltear')
  await conSesion.waitForTimeout(1100)
  await conSesion.screenshot({
    path: `${outDir}/${prefix}-escarapela-dorso-${viewport.name}.png`,
    fullPage: true,
  })
  console.log(`${prefix}-escarapela-dorso-${viewport.name}.png`)
  await conSesion.close()

  // La carta de presentación: la tarjeta pública y el panel, con los fixtures de
  // scripts/fixture-carta.mjs (preview no tiene BD). El panel se captura en su
  // detalle (`?perfil=`), que es donde está todo: formulario, foto, QR y previa.
  for (const [name, route] of [
    ['carta', `/carta_presentacion/${ID_FIXTURE}`],
    ['cdpadmin', `/cdpadmin?perfil=${ID_FIXTURE}`],
  ]) {
    const carta = await browser.newPage({ viewport })
    await instalarMocks(carta)
    await carta.goto(base + route, { waitUntil: 'networkidle' })
    await carta.evaluate(() => document.fonts.ready)
    if (name === 'carta') {
      // La tarjeta se captura dos veces: con el diálogo del QR abierto (solo la ventana) y,
      // abajo, entera en reposo.
      await carta.evaluate(async () => {
        await Promise.allSettled([...document.images].map((img) => img.decode()))
      })
      await carta.click('.cp__qr-abrir')
      await carta.waitForSelector('.cp__qr-modal')
      await carta.waitForTimeout(350)
      await carta.screenshot({ path: `${outDir}/${prefix}-carta-qr-abierto-${viewport.name}.png`, fullPage: false })
      console.log(`${prefix}-carta-qr-abierto-${viewport.name}.png`)
      await carta.keyboard.press('Escape')
      await carta.waitForTimeout(200)
    }
    await carta.evaluate(async () => {
      await Promise.allSettled([...document.images].map((img) => img.decode()))
    })
    await carta.waitForTimeout(300)
    await carta.screenshot({ path: `${outDir}/${prefix}-${name}-${viewport.name}.png`, fullPage: true })
    console.log(`${prefix}-${name}-${viewport.name}.png`)
    await carta.close()
  }
}
await browser.close()

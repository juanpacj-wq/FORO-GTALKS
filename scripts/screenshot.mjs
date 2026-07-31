// Captura las rutas del sitio en desktop y móvil, para verificación visual.
// Usa el navegador del sistema (Edge o Chrome), no descarga ninguno.
//
//   npm run preview                       # sirve dist/ en :4173, sin gate
//   node scripts/screenshot.mjs shots     # captura ahí
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

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
}
await browser.close()

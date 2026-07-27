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
  ['perfil', '/ponentes/erick-wehdeking-arcieri'],
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
}
await browser.close()

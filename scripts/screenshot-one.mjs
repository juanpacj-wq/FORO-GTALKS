// Captura una sola ruta (uso: node screenshot-one.mjs <outDir> <base> <prefijo> <ruta> <archivo>)
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const [outDir, base, prefix, route, name] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })

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

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(base + route, { waitUntil: 'networkidle' })
await page.evaluate(async () => {
  const step = window.innerHeight / 2
  for (let y = 0; y <= document.body.scrollHeight; y += step) {
    window.scrollTo(0, y)
    await new Promise((r) => setTimeout(r, 250))
  }
  window.scrollTo(0, 0)
})
await page.waitForTimeout(1500)
await page.screenshot({ path: `${outDir}/${prefix}-${name}.png`, fullPage: true })
console.log(`${prefix}-${name}.png`)
await browser.close()

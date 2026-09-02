// Captura comparativa de la marca vectorizada contra su raster de origen, para mirarla a ojo.
//
//   node scripts/marca-compare.mjs            # → shots/marca-g.png y shots/marca-logo.png
//
// No necesita servidor: renderiza desde file://. Arriba el JPG de Comunicaciones, abajo el SVG
// que produjo scripts/build-marca-gecelca.py, ambos al mismo ancho; y una tercera fila con el
// SVG superpuesto al JPG en modo `difference`, donde cualquier canto que no coincida se ve claro.
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = process.argv[2] ?? 'shots'
mkdirSync(outDir, { recursive: true })

const PIEZAS = [
  ['marca-g', 'marca-origen/G-color.jpg', 'public/img/marca-g.svg', 52, 52, 896, 896, 1000, 1000],
  ['marca-logo', 'marca-origen/Logo-gecelca-color.jpg', 'public/img/logo-gecelca.svg', 16, 103, 1968, 289, 2000, 495],
]

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

for (const [nombre, jpg, svg, x, y, w, h, W, H] of PIEZAS) {
  const ancho = 900
  const escala = ancho / W
  const jpgUrl = pathToFileURL(path.join(RAIZ, jpg)).href
  const svgUrl = pathToFileURL(path.join(RAIZ, svg)).href
  const html = `<!doctype html><body style="margin:0;background:#fff;font:14px sans-serif">
    <p style="margin:6px">raster de origen (${jpg})</p>
    <img src="${jpgUrl}" style="display:block;width:${ancho}px">
    <p style="margin:6px">SVG vectorizado (${svg}), colocado en la misma caja</p>
    <div style="position:relative;width:${ancho}px;height:${H * escala}px;background:#fff">
      <img src="${svgUrl}" style="position:absolute;left:${x * escala}px;top:${y * escala}px;width:${w * escala}px;height:${h * escala}px">
    </div>
    <p style="margin:6px">diferencia (SVG sobre el JPG, mix-blend-mode: difference): lo que se ve es lo que no coincide</p>
    <div style="position:relative;width:${ancho}px;height:${H * escala}px;background:#fff">
      <img src="${jpgUrl}" style="position:absolute;left:0;top:0;width:${ancho}px">
      <img src="${svgUrl}" style="position:absolute;left:${x * escala}px;top:${y * escala}px;width:${w * escala}px;height:${h * escala}px;mix-blend-mode:difference">
    </div>
  </body>`
  const page = await browser.newPage({ viewport: { width: ancho + 20, height: 400 } })
  // Desde file://, no con setContent: una página about:blank no puede cargar archivos locales.
  const htmlPath = path.join(RAIZ, outDir, `${nombre}.html`)
  writeFileSync(htmlPath, html)
  await page.goto(pathToFileURL(htmlPath).href)
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${outDir}/${nombre}.png`, fullPage: true })
  console.log(`${outDir}/${nombre}.png`)
  await page.close()
}
await browser.close()

// Captura la cara frontal del carné a 1024 px de ancho, para cotejarla contra la pieza.
//
//   npm run build && npm run preview      # en una terminal
//   node scripts/escarapela-compare.mjs   # en otra
//   .venv-design/Scripts/python scripts/escarapela-diff.py
//
// Escribe `design-extract/escarapela/render.png`, del mismo tamaño exacto que la referencia
// `carne.png` que produce `escarapela-medir.py`. Ese par es todo lo que necesita el diff.
//
// Para que la comparación mida el DISEÑO y no los datos, la captura iguala todo lo que es
// contenido de sesión:
//
//   · `/api/me` responde con la persona de la pieza (Sofía Munévar, Gerencia de Comunicaciones).
//   · La foto de la pieza se inyecta en localStorage con la misma clave por `oid` que usa la
//     app recortada por `escarapela-medir.py` del propio carné, así que el interior del
//     círculo solo puede diferir en el remuestreo.
//   · Dos textos del pie se cambian EN EL DOM a los de la pieza, y solo para la foto del diff:
//     la fecha («agosto / 2026» en la pieza, «agosto de 2026» en `src/data/evento.json`, que
//     es transcripción literal de los PDF y manda en todo el sitio) y el lugar («GWorking» en
//     la pieza, «G Working» en los datos). Con textos distintos el diff marcaría los dos
//     renglones enteros. El rótulo de la píldora ya NO hace falta igualarlo: esta pieza dice
//     «ASISTENTE», que es justo lo que pinta la app.
//   · La ranura se pinta con `--gt-fondo`, que en el sitio es el campo oscuro: es un troquel,
//     enseña lo que hay detrás del carné. En la pieza lo que hay detrás es el blanco del
//     export, así que aquí se iguala ese fondo se compara la forma del agujero, no lo que
//     se ve por él.
//
// El ancho lo fija un `addStyleTag` sobre el marco (el carné escala como una imagen, así que
// 1024 px no es un tamaño «de escritorio», es el mismo dibujo a la resolución de la pieza).
import { chromium } from 'playwright'
import { mkdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)))
const DIR = join(RAIZ, 'design-extract', 'escarapela')
const base = process.argv[2] ?? 'http://localhost:4173'

const OID = '00000000-1111-2222-3333-444444444444'
const IDENTIDAD = {
  authenticated: true,
  user: {
    nombre_completo: 'Sofía Munévar',
    cargo: 'Gerencia de Comunicaciones',
    area: 'Gerencia de Comunicaciones',
    upn: 'smunevar@gecelca.com.co',
    email: 'smunevar@gecelca.com.co',
    oid: OID,
    roles: [],
  },
}

const fixture = join(DIR, 'foto-fixture.jpg')
if (!existsSync(fixture)) {
  throw new Error(
    'Falta design-extract/escarapela/foto-fixture.jpg corre primero:\n' +
      '  .venv-design/Scripts/python scripts/escarapela-medir.py',
  )
}
const fotoDataUrl = `data:image/jpeg;base64,${readFileSync(fixture).toString('base64')}`

for (let intento = 1; ; intento++) {
  try {
    await fetch(base, { signal: AbortSignal.timeout(2000) })
    break
  } catch {
    if (intento >= 15) throw new Error(`El servidor no respondió en ${base}`)
    await new Promise((r) => setTimeout(r, 500))
  }
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

// Viewport holgado: el carné a 1024 px no cabe en el ancho de página habitual, y una captura
// de elemento con scroll de por medio sale con costuras.
const page = await browser.newPage({ viewport: { width: 1600, height: 2200 } })
await page.route('**/api/me', (ruta) => ruta.fulfill({ json: IDENTIDAD }))
// Antes de que la página corra: la foto ya en su sitio, para que el carné no se pinte primero
// con las iniciales y luego con el retrato.
await page.addInitScript(
  ([clave, valor]) => {
    try {
      localStorage.setItem(clave, valor)
    } catch {
      /* si el navegador la veta, el diff lo dirá */
    }
  },
  [`gt-escarapela-foto:${OID}`, fotoDataUrl],
)

await page.goto(`${base}/escarapela`, { waitUntil: 'networkidle' })
await page.addStyleTag({
  content: `
    /* El carné a la resolución de la pieza, y el blanco del export detrás de la ranura (la
       pieza tiene ahí su propio blanco, no el campo oscuro del sitio). */
    .gt-escarapela-marco { width: 1024px !important; max-width: none !important; }
    .gt-escarapela-escena { background: #ffffff; --gt-fondo: #ffffff; }
    /* La sombra del sistema queda fuera de la captura de elemento, pero no el desenfoque que
       proyecta sobre sí misma: sin quitarla, los cantos del carné salen sucios. */
    .gt-carne__cara { box-shadow: none !important; }
    /* Ni transición ni transformación: la cara frontal, quieta y de frente. */
    .gt-carne { transition: none !important; }
  `,
})
// Contenido, no diseño: se iguala al de la pieza solo para la foto del diff.
const VALORES = ['Miércoles 5 de agosto / 2026', 'GWorking']
for (const [i, valor] of VALORES.entries()) {
  await page.locator('.gt-carne__pie-valor').nth(i).evaluate((el, v) => {
    el.textContent = v
  }, valor)
}
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(400)

const carne = page.locator('.gt-carne__cara--frontal')
const caja = await carne.boundingBox()
mkdirSync(DIR, { recursive: true })
await carne.screenshot({ path: join(DIR, 'render.png') })
await browser.close()

console.log(`render.png  ${Math.round(caja.width)}×${Math.round(caja.height)} px`)
if (Math.abs(caja.width - 1024) > 1) {
  console.log(`  aviso: el ancho no salió en 1024 (${caja.width}) el diff reescalará`)
}

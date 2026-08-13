// Captura el lockup del foro en el hero y anota su geometría, para cotejarlo contra la pieza.
//
//   npm run build && npm run preview   # en una terminal
//   node scripts/lockup-compare.mjs    # en otra
//   .venv-design/Scripts/python scripts/lockup-diff.py
//
// Escribe `design-extract/lockup/render.png` y `render.json`. Ese par es todo lo que necesita el
// diff: el PNG trae la tinta y el JSON, el cuerpo del titular y la posición de la regla, que es
// el origen al que se normaliza todo a los dos lados.
//
// Tres decisiones que hacen que la comparación mida el DISEÑO:
//
//   · Se captura con `reducedMotion: 'reduce'`, que apaga la secuencia de entrada del hero. Sin
//     eso, la opacidad del fotograma en que cae la captura entra en la medida.
//   · Se captura a `deviceScaleFactor` 3 y el diff rasteriza la pieza a la MISMA densidad de
//     píxel por em, así que el sesgo del antialias es el mismo en los dos lados y se cancela al
//     restar. Comparar un render a 3x contra la pieza a 200 dpi mide la resolución, no el diseño.
//   · El origen no es el borde de la captura sino el canto de la regla, leído del DOM. Así el
//     resultado no depende de dónde caiga el bloque en la página.
//
// Se prueban varios anchos porque el cuerpo del lockup se acota por el ancho disponible. El que
// se captura para el diff es el primeroescritorio ancho, el titular en su techo de 6rem o el
// que se pase como argumento: `node scripts/lockup-compare.mjs 1440`.

import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:4173'
const SALIDA = 'design-extract/lockup'
const ESCALA = 3
const ANCHOS = [1920, 1440, 1024, 900, 390, 320]

const CAPTURA = Number(process.argv[2]) || ANCHOS[0]
if (!ANCHOS.includes(CAPTURA)) ANCHOS.push(CAPTURA)

mkdirSync(SALIDA, { recursive: true })

const navegador = await chromium.launch()
let fallos = 0

for (const ancho of ANCHOS) {
  const ctx = await navegador.newContext({
    viewport: { width: ancho, height: 1000 },
    deviceScaleFactor: ESCALA,
    reducedMotion: 'reduce',
  })
  const pagina = await ctx.newPage()
  await pagina.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  // `networkidle` no garantiza que React haya montado: sin esto, el evaluate de abajo se
  // encuentra el árbol vacío y falla con «parameter 1 is not of type Element».
  await pagina.waitForSelector('.gt-hero__lockup')
  await pagina.evaluate(() => document.fonts.ready)

  const datos = await pagina.evaluate(() => {
    const q = (s) => document.querySelector(s)
    const caja = (el) => {
      const b = el.getBoundingClientRect()
      return { x: b.x, y: b.y, w: b.width, h: b.height }
    }
    const titulo = q('.gt-hero__titulo')
    const bajada = q('.gt-hero__bajada')
    const cs = getComputedStyle(titulo)
    return {
      cuerpo: parseFloat(cs.fontSize),
      peso: cs.fontWeight,
      interlinea: parseFloat(cs.lineHeight),
      tracking: cs.letterSpacing,
      cuerpoBajada: parseFloat(getComputedStyle(bajada).fontSize),
      // La regla es el ::before de la bajada; su caja arranca donde la bajada.
      grosorRegla: parseFloat(getComputedStyle(bajada, '::before').height),
      lockup: caja(q('.gt-hero__lockup')),
      // El origen de todo: canto izquierdo y borde superior de la regla.
      regla: caja(bajada),
      numeral: caja(q('.gt-hero__numeral')),
      lineas: [...document.querySelectorAll('.gt-hero__linea')].map(caja),
      columna: caja(q('.gt-hero__texto')),
      scrollAncho: document.documentElement.scrollWidth,
      ventana: window.innerWidth,
    }
  })

  // Lo que ningún diff de píxeles detecta: que el conjunto se haya partido o desborde.
  const paso = datos.interlinea
  const partida = datos.lineas.some((l) => l.h > paso * 1.6)
  const desborda = datos.scrollAncho > datos.ventana
  const cabe = datos.lockup.x + datos.lockup.w <= datos.columna.x + datos.columna.w + 1
  const veredicto = partida ? 'LÍNEA PARTIDA' : desborda ? 'DESBORDA' : cabe ? 'ok' : 'SE SALE DE LA COLUMNA'
  if (veredicto !== 'ok') fallos++
  console.log(
    `${String(ancho).padStart(4)} px  cuerpo ${datos.cuerpo.toFixed(2)}  ` +
      `conjunto ${datos.lockup.w.toFixed(1)} = ${(datos.lockup.w / datos.cuerpo).toFixed(3)} del cuerpo  ` +
      `${veredicto}`,
  )

  if (ancho === CAPTURA) {
    // Recorte generoso: el diff necesita tramos de campo limpio alrededor del conjunto para
    // estimar el nivel de fondo, que en el sitio lleva grano y en la pieza no es uniforme.
    // Acotado a la ventana: un `clip` que se sale lo recorta Playwright sin avisar, y entonces
    // el PNG mide menos de lo que dice el JSON y el diff busca ventanas que no existen.
    const pad = datos.cuerpo * 0.9
    const x = Math.max(0, datos.lockup.x - pad)
    const y = Math.max(0, datos.lockup.y - pad)
    const clip = {
      x,
      y,
      width: Math.min(datos.lockup.w + 2 * pad, datos.ventana - x),
      height: Math.min(datos.lockup.h + 2 * pad, 1000 - y),
    }
    await pagina.screenshot({ path: `${SALIDA}/render.png`, clip })
    writeFileSync(
      `${SALIDA}/render.json`,
      JSON.stringify({ ...datos, clip, escala: ESCALA, ancho }, null, 2),
    )
  }
  await ctx.close()
}

await navegador.close()
console.log(
  fallos
    ? `\n${fallos} ancho(s) con problemas de composición.`
    : `\nCapturado ${SALIDA}/render.png a ${CAPTURA} px. Ahora: scripts/lockup-diff.py`,
)
process.exit(fallos ? 1 : 0)

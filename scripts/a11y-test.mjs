// Verificación de accesibilidad sobre dist/ servido por `npm run preview`.
//
// Este proyecto es diseño propio, no una réplica 1:1 de un Figma: los
// incumplimientos de WCAG se corrigen, no se documentan. Por eso el contraste
// se comprueba de verdad, calculándolo sobre el DOM renderizado.
//
//   npm run build && npm run preview   # en una terminal
//   node scripts/a11y-test.mjs         # en otra
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:4173'
const RUTAS = ['/', '/ponentes', '/ponentes/erick-wehdeking-arcieri', '/escarapela', '/encuestas']

let fallos = 0
function check(nombre, ok, detalle = '') {
  console.log(`${ok ? '  ok  ' : ' FALLA'} ${nombre}${detalle ? ` — ${detalle}` : ''}`)
  if (!ok) fallos++
}

/** Se evalúa dentro del navegador: necesita getComputedStyle sobre el render real. */
const AUDITORIA = () => {
  const lum = (rgb) => {
    const c = rgb.map((v) => {
      const s = v / 255
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
    return (x + 0.05) / (y + 0.05)
  }

  // Cualquier sintaxis de color a sRGB + alfa, pintándola en un lienzo de 1×1.
  // Parsear la cadena a mano solo funcionaba con `rgb()`: desde que los tokens
  // derivan colores con `color-mix()`, getComputedStyle devuelve `oklab(...)` o
  // `color(srgb ...)` y el parser antiguo los daba por transparentes, asumía
  // fondo blanco y reportaba contrastes falsos de 1:1.
  const lienzo = document.createElement('canvas')
  lienzo.width = lienzo.height = 1
  const ctx = lienzo.getContext('2d', { willReadFrequently: true })
  const aRGBA = (css) => {
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = '#000'
    ctx.fillStyle = css // si no lo entiende, conserva el negro anterior
    ctx.fillRect(0, 0, 1, 1)
    const d = ctx.getImageData(0, 0, 1, 1).data
    return { rgb: [d[0], d[1], d[2]], a: d[3] / 255 }
  }

  const sobre = (capa, base) =>
    base.map((v, i) => Math.round(capa.rgb[i] * capa.a + v * (1 - capa.a)))

  /**
   * Fondo efectivo: acumula las capas de los ancestros hasta la primera opaca y
   * las compone. Con la versión anterior, un fondo semitransparente se ignoraba
   * por completo; así se mide el color que de verdad hay detrás del texto.
   */
  const fondoDe = (el) => {
    const capas = []
    let n = el
    while (n && n !== document.documentElement) {
      const capa = aRGBA(getComputedStyle(n).backgroundColor)
      if (capa.a > 0) {
        capas.push(capa)
        if (capa.a === 1) break
      }
      n = n.parentElement
    }
    let base = [255, 255, 255]
    for (let i = capas.length - 1; i >= 0; i--) base = sobre(capas[i], base)
    return base
  }

  const problemas = { contraste: [], sinAlt: [], sinNombre: [], encabezados: [] }

  // --- contraste de todo texto visible ---
  for (const el of document.querySelectorAll('body *')) {
    const texto = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join('')
    if (!texto) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    // el texto oculto para lectores no se ve, no aplica contraste visual
    if (el.closest('.gt-oculto-visual')) continue

    const px = parseFloat(cs.fontSize)
    const peso = parseInt(cs.fontWeight, 10) || 400
    const grande = px >= 24 || (px >= 18.66 && peso >= 700)
    const umbral = grande ? 3 : 4.5
    const fondo = fondoDe(el)
    // El color del texto también puede traer alfa: se compone sobre el fondo.
    const rr = ratio(sobre(aRGBA(cs.color), fondo), fondo)
    if (rr < umbral) {
      problemas.contraste.push({
        texto: texto.slice(0, 40),
        ratio: +rr.toFixed(2),
        umbral,
        px: +px.toFixed(1),
        peso,
        color: cs.color,
      })
    }
  }

  // --- imágenes sin alt ---
  for (const img of document.querySelectorAll('img')) {
    if (!img.hasAttribute('alt')) problemas.sinAlt.push(img.getAttribute('src'))
  }

  // --- enlaces y botones sin nombre accesible ---
  for (const el of document.querySelectorAll('a[href], button')) {
    const nombre =
      (el.getAttribute('aria-label') ?? '').trim() ||
      el.textContent.trim() ||
      (el.querySelector('img')?.getAttribute('alt') ?? '').trim()
    if (!nombre) problemas.sinNombre.push(el.outerHTML.slice(0, 80))
  }

  // --- jerarquía de encabezados ---
  const niveles = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) =>
    Number(h.tagName[1]),
  )
  for (let i = 1; i < niveles.length; i++) {
    if (niveles[i] - niveles[i - 1] > 1) {
      problemas.encabezados.push(`h${niveles[i - 1]} → h${niveles[i]}`)
    }
  }

  return { problemas, h1: document.querySelectorAll('h1').length, lang: document.documentElement.lang }
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

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

for (const ruta of RUTAS) {
  console.log(`\n${ruta}`)
  await page.goto(base + ruta, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  const { problemas, h1, lang } = await page.evaluate(AUDITORIA)

  check('idioma declarado es-CO', lang === 'es-CO', lang)
  check('exactamente un h1', h1 === 1, `hay ${h1}`)
  check(
    'sin saltos de nivel en encabezados',
    problemas.encabezados.length === 0,
    problemas.encabezados.join(', '),
  )
  check('todas las imágenes tienen alt', problemas.sinAlt.length === 0, problemas.sinAlt.join(', '))
  check(
    'enlaces y botones con nombre accesible',
    problemas.sinNombre.length === 0,
    problemas.sinNombre.join(' | '),
  )
  check(
    'contraste AA en todo el texto',
    problemas.contraste.length === 0,
    problemas.contraste
      .map((p) => `«${p.texto}» ${p.ratio}:1 < ${p.umbral}:1 (${p.px}px/${p.peso})`)
      .join(' | '),
  )
}

// --- reflow: sin scroll horizontal en pantalla estrecha (WCAG 1.4.10) ------
// Una sola pieza que se sale del ancho obliga a desplazar toda la página en
// horizontal para leer cualquier línea. Se mide en las dos anchuras que de
// verdad usan los asistentes desde el celular.
for (const ancho of [320, 390]) {
  console.log(`\nReflow a ${ancho} px`)
  const estrecha = await browser.newPage({ viewport: { width: ancho, height: 800 } })
  for (const ruta of RUTAS) {
    await estrecha.goto(base + ruta, { waitUntil: 'networkidle' })
    await estrecha.evaluate(() => document.fonts.ready)
    const desborde = await estrecha.evaluate(() => {
      const d = document.documentElement
      const culpables = []
      for (const el of document.querySelectorAll('body *')) {
        const b = el.getBoundingClientRect()
        if (b.width > 0 && b.right > d.clientWidth + 1) {
          // Si un ancestro recorta en horizontal, el desborde no llega al
          // documento: no es el culpable.
          // El clip de `body` se propaga al viewport y no cuenta como recorte
          // propio: si se tuviera en cuenta, ningún culpable se reportaría.
          let recortado = false
          for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
            const ox = getComputedStyle(n).overflowX
            if (ox === 'hidden' || ox === 'auto' || ox === 'scroll') {
              recortado = true
              break
            }
          }
          if (recortado) continue
          culpables.push(
            `${el.tagName.toLowerCase()}.${(el.className || '').toString().trim()} (${b.width.toFixed(0)}px, sale ${(b.right - d.clientWidth).toFixed(0)}px)`,
          )
        }
      }
      return { px: d.scrollWidth - d.clientWidth, culpables: culpables.slice(0, 3) }
    })
    check(`${ruta} sin desborde horizontal`, desborde.px <= 0, desborde.culpables.join(' | '))
  }
  await estrecha.close()
}

// --- foco visible ---
console.log('\nFoco')
await page.goto(base + '/', { waitUntil: 'networkidle' })
await page.keyboard.press('Tab')
const foco = await page.evaluate(() => {
  const el = document.activeElement
  const cs = getComputedStyle(el)
  return { etiqueta: el.className, outline: cs.outlineWidth, estilo: cs.outlineStyle }
})
check(
  'el primer tabulado muestra anillo de foco',
  foco.outline !== '0px' && foco.estilo !== 'none',
  `${foco.etiqueta} outline=${foco.outline} ${foco.estilo}`,
)

// --- prefers-reduced-motion ---
await page.emulateMedia({ reducedMotion: 'reduce' })
await page.goto(base + '/', { waitUntil: 'networkidle' })
const scroll = await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)
check('con reduced-motion el scroll no es suave', scroll === 'auto', scroll)

await browser.close()
console.log(fallos === 0 ? '\nAccesibilidad: todo en orden.\n' : `\n${fallos} problema(s).\n`)
process.exit(fallos === 0 ? 0 : 1)

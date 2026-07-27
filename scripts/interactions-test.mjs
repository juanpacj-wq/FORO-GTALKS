// Pruebas de interacción sobre dist/ servido por `npm run preview`.
// Sale con código 1 si algo falla.
//
//   npm run build && npm run preview     # en una terminal
//   node scripts/interactions-test.mjs   # en otra
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:4173'

let fallos = 0
function check(nombre, ok, detalle = '') {
  console.log(`${ok ? '  ok  ' : ' FALLA'} ${nombre}${detalle ? ` — ${detalle}` : ''}`)
  if (!ok) fallos++
}

// Espera a que el servidor esté listo. Sin esto, la primera corrida justo después de levantar
// `npm run preview` fallaba por arranque en frío y la segunda pasaba: un falso positivo recurrente
// que hacía dudar del código en vez del arnés.
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

// ───────────────────────────────────────────────────────────── escritorio
const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await desktop.goto(base + '/', { waitUntil: 'networkidle' })

console.log('\nAnclas y scrollspy')
check(
  'las 3 secciones existen',
  (await desktop.locator('#bienvenida, #sobre-el-foro, #agenda').count()) === 3,
)

await desktop.click('.gt-header__ancla[href="#agenda"]')
await desktop.waitForTimeout(1200)
check(
  'el scrollspy marca Agenda como activa',
  (await desktop.locator('.gt-header__ancla[aria-current]').textContent())?.trim() === 'Agenda',
)

await desktop.evaluate(() => window.scrollTo(0, 0))
await desktop.waitForTimeout(900)
check(
  'al volver arriba marca Bienvenida',
  (await desktop.locator('.gt-header__ancla[aria-current]').textContent())?.trim() === 'Bienvenida',
)

console.log('\nAgenda → perfil de ponente')
await desktop.locator('.gt-agenda__nombre').first().click()
await desktop.waitForURL('**/ponentes/**')
check('un nombre de la agenda lleva a su perfil', desktop.url().includes('/ponentes/'))
check('el perfil lista intervenciones', (await desktop.locator('.gt-perfil__item').count()) > 0)

console.log('\nRutas inválidas')
await desktop.goto(base + '/ponentes/no-existe', { waitUntil: 'networkidle' })
check(
  'un slug inexistente redirige a /ponentes',
  new URL(desktop.url()).pathname === '/ponentes',
  desktop.url(),
)

await desktop.goto(base + '/ruta-que-no-existe', { waitUntil: 'networkidle' })
check('una ruta inexistente redirige a /', new URL(desktop.url()).pathname === '/')

console.log('\nDatos')
await desktop.goto(base + '/ponentes', { waitUntil: 'networkidle' })
check('hay 11 ponentes', (await desktop.locator('.gt-ponente').count()) === 11)
await desktop.goto(base + '/', { waitUntil: 'networkidle' })
check('hay 12 bloques de agenda', (await desktop.locator('.gt-agenda__fila').count()) === 12)

await desktop.close()

// ───────────────────────────────────────────────────────────────── móvil
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
await mobile.goto(base + '/', { waitUntil: 'networkidle' })

console.log('\nNav móvil')
check('el nav de escritorio está oculto', !(await mobile.locator('.gt-header__nav').isVisible()))

await mobile.click('.gt-header__hamburguesa')
check('el panel abre', await mobile.locator('.gt-navmovil__panel').isVisible())
check(
  'el foco entra al panel',
  await mobile.evaluate(() => !!document.activeElement?.closest('.gt-navmovil__panel')),
)

await mobile.keyboard.press('Escape')
await mobile.waitForTimeout(250)
check('Esc cierra el panel', (await mobile.locator('.gt-navmovil__panel').count()) === 0)
check(
  'el foco vuelve a la hamburguesa',
  await mobile.evaluate(() =>
    document.activeElement?.classList.contains('gt-header__hamburguesa'),
  ),
)

await mobile.click('.gt-header__hamburguesa')
await mobile.waitForTimeout(250)
await mobile.mouse.click(20, 400) // fuera del panel, que ocupa la derecha
await mobile.waitForTimeout(250)
check('el clic fuera cierra el panel', (await mobile.locator('.gt-navmovil__panel').count()) === 0)

await mobile.click('.gt-header__hamburguesa')
await mobile.waitForTimeout(250)
await mobile.click('.gt-navmovil__enlace[href="/ponentes"]')
await mobile.waitForURL('**/ponentes')
check('navega y cierra el panel', (await mobile.locator('.gt-navmovil__panel').count()) === 0)

await mobile.close()
await browser.close()

console.log(fallos === 0 ? '\nTodo en orden.\n' : `\n${fallos} verificación(es) fallaron.\n`)
process.exit(fallos === 0 ? 0 : 1)

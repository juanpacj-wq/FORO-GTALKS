// Verificación del menú de sesión (quién entró / cambiar de cuenta / cerrar sesión).
//
//   npm run build && npm run preview     # en una terminal
//   node scripts/sesion-test.mjs         # en otra
//
// El menú solo aparece con sesión iniciada, y un login real contra Entra no se puede automatizar
// (MFA de por medio). Así que se intercepta `/api/me` y se responde con una identidad de prueba:
// lo que se verifica es que la interfaz pinta lo que el gate le entrega y que las salidas apuntan
// a donde deben. El gate en sí lo cubre `gate-test.mjs`.
import { chromium } from 'playwright'

let fallos = 0
function check(nombre, ok, detalle = '') {
  console.log(`${ok ? '  ok  ' : ' FALLA'} ${nombre}${detalle ? ` — ${detalle}` : ''}`)
  if (!ok) fallos++
}

const base = process.argv[2] ?? 'http://localhost:4173'

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

// ─────────────────────────────────────────────────────────── con sesión
console.log('\nCon sesión iniciada')

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.route('**/api/me', (ruta) => ruta.fulfill({ json: IDENTIDAD }))
await page.goto(base + '/', { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)

check('el menú aparece en la barra', await page.locator('.gt-sesion__boton').isVisible())
check(
  'muestra el nombre de quien entró',
  (await page.locator('.gt-sesion__nombre').first().textContent())?.trim() === IDENTIDAD.user.nombre_completo,
)
check(
  'muestra su cargo',
  (await page.locator('.gt-sesion__cargo').first().textContent())?.trim() === IDENTIDAD.user.cargo,
)

await page.locator('.gt-sesion__boton').click()
await page.waitForTimeout(250)
check('el panel abre', await page.locator('.gt-sesion__panel').isVisible())
check(
  'ofrece cambiar de cuenta',
  (await page.locator('.gt-sesion__accion').first().getAttribute('href')) === '/auth/login?select=1',
)
check(
  'y cerrar sesión por el front-channel de Microsoft',
  (await page.locator('.gt-sesion__accion--salir').getAttribute('href')) === '/auth/logout',
)

await page.keyboard.press('Escape')
await page.waitForTimeout(200)
check('Esc cierra el panel', (await page.locator('.gt-sesion__panel').count()) === 0)

// Sin cargo (invitado B2B, o Graph no disponible): el correo es el respaldo.
const sinCargo = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await sinCargo.route('**/api/me', (ruta) =>
  ruta.fulfill({ json: { ...IDENTIDAD, user: { ...IDENTIDAD.user, cargo: '', area: '' } } }),
)
await sinCargo.goto(base + '/', { waitUntil: 'networkidle' })
check(
  'sin cargo cae al correo, no deja el hueco',
  (await sinCargo.locator('.gt-sesion__cargo').first().textContent())?.trim() === IDENTIDAD.user.email,
)
await sinCargo.close()

// ─────────────────────────────────────────────────────────────── móvil
console.log('\nMóvil')

const movil = await browser.newPage({ viewport: { width: 390, height: 844 } })
await movil.route('**/api/me', (ruta) => ruta.fulfill({ json: IDENTIDAD }))
await movil.goto(base + '/', { waitUntil: 'networkidle' })
await movil.click('.gt-header__hamburguesa')
await movil.waitForTimeout(300)
check('el menú vive dentro del panel de navegación', await movil.locator('.gt-sesion--movil').isVisible())
check(
  'con la opción de cerrar sesión',
  await movil.locator('.gt-sesion--movil .gt-sesion__accion--salir').isVisible(),
)
await movil.close()

// ────────────────────────────────────────────────────────────── sin gate
console.log('\nServido sin gate (preview, capturas)')

const sinGate = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await sinGate.route('**/api/me', (ruta) => ruta.fulfill({ status: 401, json: { authenticated: false } }))
await sinGate.goto(base + '/', { waitUntil: 'networkidle' })
check('no se pinta ningún menú', (await sinGate.locator('.gt-sesion').count()) === 0)
check('y el sitio se ve igual que siempre', await sinGate.locator('.gt-hero__titulo').isVisible())
await sinGate.close()

await page.close()
await browser.close()

console.log(fallos === 0 ? '\nSesión: todo en orden.\n' : `\n${fallos} verificación(es) fallaron.\n`)
process.exit(fallos === 0 ? 0 : 1)

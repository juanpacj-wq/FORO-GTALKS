// Verificación de la sesión en la interfaz: el menú de la barra y la escarapela.
//
//   npm run build && npm run preview     # en una terminal
//   node scripts/sesion-test.mjs         # en otra
//
// El menú y el carné solo aparecen con sesión iniciada, y un login real contra Entra no se puede
// automatizar (MFA de por medio). Así que se intercepta `/api/me` y se responde con una identidad
// de prueba: lo que se verifica es que la interfaz pinta lo que el server le entrega y que las
// salidas apuntan a donde deben. El server en sí lo cubre `gate-test.mjs`.
import { chromium } from 'playwright'

let fallos = 0
function check(nombre, ok, detalle = '') {
  console.log(`${ok ? '  ok  ' : ' FALLA'} ${nombre}${detalle ? ` ${detalle}` : ''}`)
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
  // El correo de inscripción. Por defecto, nada que anunciar: es el estado de casi todo el mundo.
  inscripcion: { estado: 'no_aplica' },
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

// ─────────────────────────────────────────────────────── /escarapela, el carné
console.log('\nLa escarapela, con sesión')

const carne = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
await carne.route('**/api/me', (ruta) => ruta.fulfill({ json: IDENTIDAD }))
await carne.goto(base + '/escarapela', { waitUntil: 'networkidle' })
await carne.evaluate(() => document.fonts.ready)

check('el carné aparece', await carne.locator('.gt-carne').isVisible())
check(
  'con el nombre de quien entró',
  (await carne.locator('.gt-carne__nombre').textContent())?.trim() === IDENTIDAD.user.nombre_completo,
)
check(
  'la línea bajo el nombre es el cargo',
  (await carne.locator('.gt-carne__cargo').textContent())?.trim() === IDENTIDAD.user.cargo,
)
check(
  'la píldora dice Asistente',
  ((await carne.locator('.gt-carne__pildora-rol').textContent()) || '').trim().toLowerCase() === 'asistente',
)
const qrContenido = (await carne.locator('.gt-carne__qr').getAttribute('data-contenido')) || ''
check(
  'el QR lleva el usuario de la sesión, sin dominio',
  qrContenido.includes(`USUARIO=${IDENTIDAD.user.email.split('@')[0]}&`),
  qrContenido.slice(qrContenido.indexOf('USUARIO=')).slice(0, 40),
)
check(
  'y el ID de capacitación de una de las dos jornadas',
  qrContenido.includes('ID_CAPACITACION=fffbd1d0-7af2-4104-ac75-87964da57c19') ||
    qrContenido.includes('ID_CAPACITACION=a6589188-0bf5-4347-ad05-55207015a0e2'),
  qrContenido.slice(qrContenido.indexOf('ID_CAPACITACION=')).slice(0, 55),
)
check(
  'y apunta a la app de asistencia de Power Apps',
  qrContenido.startsWith('https://apps.powerapps.com/play/'),
)
await carne.close()

// La cascada de la segunda línea: cargo → área → correo, la misma del menú.
const carneSinCargo = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
await carneSinCargo.route('**/api/me', (ruta) =>
  ruta.fulfill({ json: { ...IDENTIDAD, user: { ...IDENTIDAD.user, cargo: '' } } }),
)
await carneSinCargo.goto(base + '/escarapela', { waitUntil: 'networkidle' })
check(
  'sin cargo, la línea cae al área',
  (await carneSinCargo.locator('.gt-carne__cargo').textContent())?.trim() === IDENTIDAD.user.area,
)
await carneSinCargo.close()

const carneSinNada = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
await carneSinNada.route('**/api/me', (ruta) =>
  ruta.fulfill({ json: { ...IDENTIDAD, user: { ...IDENTIDAD.user, cargo: '', area: '' } } }),
)
await carneSinNada.goto(base + '/escarapela', { waitUntil: 'networkidle' })
check(
  'sin cargo ni área, cae al correo',
  (await carneSinNada.locator('.gt-carne__cargo').textContent())?.trim() === IDENTIDAD.user.email,
)
await carneSinNada.close()

// ────────────────────────────────────── el correo de inscripción, en la interfaz
console.log('\nEl correo de inscripción')

// La interfaz solo anuncia lo que el servidor CONFIRMA. `pendiente` (el envío va después del
// redirect del login, así que la primera consulta puede adelantársele) y `no_aplica` no pintan
// nada: nunca se anuncia un correo que quizá no salió.
for (const [estado, fragmento] of [
  ['enviado', 'confirmación de tu inscripción'],
  ['fallido', 'No pudimos enviarte'],
  ['pendiente', null],
  ['no_aplica', null],
]) {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
  await p.route('**/api/me', (ruta) => ruta.fulfill({ json: { ...IDENTIDAD, inscripcion: { estado } } }))
  await p.goto(base + '/escarapela', { waitUntil: 'networkidle' })

  const linea = p.locator('.gt-escarapela__inscripcion')
  if (fragmento) {
    check(`«${estado}» se anuncia`, await linea.isVisible())
    check(`  con el texto que le toca`, ((await linea.textContent()) || '').includes(fragmento))
    check(`  y como región de estado`, (await linea.getAttribute('role')) === 'status')
  } else {
    check(`«${estado}» no anuncia nada`, (await linea.count()) === 0)
  }
  await p.close()
}

{
  // El aviso de privacidad va ANTES del login, junto al botón de entrar: es el orden que exige
  // un tratamiento de datos que se anuncia.
  const p = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
  await p.route('**/api/me', (ruta) => ruta.fulfill({ status: 401, json: { authenticated: false } }))
  await p.goto(base + '/escarapela', { waitUntil: 'networkidle' })
  const aviso = ((await p.locator('.gt-escarapela__registro').textContent()) || '').toLowerCase()
  check('el aviso previo al login menciona el registro de asistencia', aviso.includes('asistencia'))
  check('y el correo de inscripción', aviso.includes('correo') && aviso.includes('inscripción'))
  await p.close()
}

// ──────────────────────────────────────────────────────────── sin sesión
console.log('\nSin sesión (visitante anónimo, preview, capturas)')

const sinSesion = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
await sinSesion.route('**/api/me', (ruta) => ruta.fulfill({ status: 401, json: { authenticated: false } }))
await sinSesion.goto(base + '/', { waitUntil: 'networkidle' })
check('no se pinta ningún menú', (await sinSesion.locator('.gt-sesion').count()) === 0)
check('y el sitio se ve igual que siempre', await sinSesion.locator('.gt-hero__titulo').isVisible())

await sinSesion.goto(base + '/escarapela', { waitUntil: 'networkidle' })
check('la escarapela invita a entrar', await sinSesion.locator('.gt-escarapela__entrar').isVisible())
check('sin pintar ningún carné', (await sinSesion.locator('.gt-carne').count()) === 0)
// El nombre del fixture coincide a propósito con el contacto del pie de página (EVENTO.contacto
// en foro.ts), que es contenido público: lo que jamás puede aparecer sin sesión es el correo,
// que solo existe en /api/me.
check(
  'y sin ningún dato de la sesión en el DOM',
  !(await sinSesion.content()).includes(IDENTIDAD.user.email),
)
await sinSesion.close()

await page.close()
await browser.close()

console.log(fallos === 0 ? '\nSesión: todo en orden.\n' : `\n${fallos} verificación(es) fallaron.\n`)
process.exit(fallos === 0 ? 0 : 1)

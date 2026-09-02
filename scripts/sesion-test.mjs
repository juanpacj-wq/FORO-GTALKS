// Verificación de la sesión en la interfaz: el menú de la barra y la escarapela.
//
//   npm run build && npm run preview     # en una terminal
//   node scripts/sesion-test.mjs         # en otra
//
// El menú y el carné solo aparecen con sesión iniciada, y un login real contra Entra no se puede
// automatizar (MFA de por medio). Así que se intercepta `/api/me` y se responde con una identidad
// de prueba: lo que se verifica es que la interfaz pinta lo que el server le entrega y que las
// salidas apuntan a donde deben. El server en sí lo cubre `gate-test.mjs`.
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { readBarcodes } from 'zxing-wasm/reader'
import {
  ID_FIXTURE,
  ID_INEXISTENTE,
  IDENTIDAD_ADMIN,
  PERFIL_PUBLICO,
  RESPUESTA_400,
  instalarMocks,
} from './fixture-carta.mjs'

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

// El blindaje del cargo largo: la pieza reserva UNA línea entre la regla y la píldora, y un
// cargo que partía en dos («Gerente De Tecnologia De Informacion», caso real de producción)
// invadía la banda de ASISTENTE. El carné lo encoge para asentarlo en una línea; si ni al piso
// cabe, dos líneas más pequeñas caben en la luz. Aquí se ejercen los dos casos.
for (const [cargoLargo, descripcion] of [
  ['Gerente De Tecnologia De Informacion', 'el caso real de producción'],
  ['Gerente De Tecnologia De Informacion Y Transformacion Digital Corporativa', 'el peor caso'],
]) {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
  await p.route('**/api/me', (ruta) =>
    ruta.fulfill({ json: { ...IDENTIDAD, user: { ...IDENTIDAD.user, cargo: cargoLargo } } }),
  )
  await p.goto(base + '/escarapela', { waitUntil: 'networkidle' })
  await p.evaluate(() => document.fonts.ready)
  await p.waitForTimeout(150)
  const cajas = await p.evaluate(() => {
    const cargo = document.querySelector('.gt-carne__cargo')?.getBoundingClientRect()
    const pildora = document.querySelector('.gt-carne__pildora')?.getBoundingClientRect()
    return cargo && pildora ? { cargoFondo: cargo.bottom, pildoraTecho: pildora.top } : null
  })
  check(
    `un cargo largo no invade la píldora (${descripcion})`,
    !!cajas && cajas.cargoFondo <= cajas.pildoraTecho + 0.5,
  )
  await p.close()
}

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
  // Hasta el 2026-08-12 aquí se exigía que el aviso anunciara ADEMÁS el correo de inscripción.
  // El envío está apagado (INSCRIPCION_MODO=off) y el usuario retiró la frase: no se anuncia un
  // correo que no va a salir. La comprobación se invierte para que la mención no vuelva sola.
  check('y ya no anuncia el correo de inscripción', !aviso.includes('inscripción'))
  await p.close()
}

// ───────────────────────────────────────── el certificado, en la interfaz
console.log('\nEl certificado')

// La misma regla del correo: solo se anuncia lo que el servidor CONFIRMA. `disponible` literal
// pinta la descarga; `no_aplica` pinta el botón retenido con su aviso; y el campo AUSENTE (un
// servidor viejo) cae en retenido  jamás en descarga.
for (const [nombre, extra, esperaDescarga] of [
  ['disponible', { certificado: 'disponible' }, true],
  ['no_aplica', { certificado: 'no_aplica' }, false],
  ['campo ausente (server viejo)', {}, false],
]) {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
  await p.route('**/api/me', (ruta) => ruta.fulfill({ json: { ...IDENTIDAD, ...extra } }))
  await p.goto(base + '/certificado', { waitUntil: 'networkidle' })

  const enlace = p.locator('a.gt-certificado__descargar')
  const retenido = p.locator('button.gt-certificado__descargar')
  if (esperaDescarga) {
    check(`«${nombre}»: la descarga es un enlace a /api/certificado`,
      (await enlace.count()) === 1 && (await enlace.getAttribute('href')) === '/api/certificado')
    check('  sin botón retenido', (await retenido.count()) === 0)
  } else {
    check(`«${nombre}»: no hay ningún enlace de descarga`, (await enlace.count()) === 0)
    check('  y el botón retenido existe, enfocable y descrito',
      (await retenido.count()) === 1 &&
      (await retenido.getAttribute('aria-disabled')) === 'true' &&
      (await retenido.getAttribute('aria-describedby')) === 'gt-certificado-aviso')
  }
  await p.close()
}

{
  // El aviso del botón retenido: emerge con el clic, se cierra con Escape, y nombra el contacto.
  const p = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
  await p.route('**/api/me', (ruta) => ruta.fulfill({ json: { ...IDENTIDAD, certificado: 'no_aplica' } }))
  await p.goto(base + '/certificado', { waitUntil: 'networkidle' })
  const aviso = p.locator('#gt-certificado-aviso')
  check('el aviso vive en el DOM aunque no se vea', (await aviso.count()) === 1)
  check('  y no es visible en reposo', !(await aviso.isVisible()))
  // `force`: Playwright respeta aria-disabled y se niega a pulsarlo sin él  señal de que el
  // botón se anuncia como corresponde.
  await p.click('button.gt-certificado__descargar', { force: true })
  await p.waitForTimeout(250)
  check('  el toque lo hace emerger', await aviso.isVisible())
  check('  y dice a quién escribirle', ((await aviso.textContent()) || '').includes('María Cristina'))
  // El flujo de teclado: el foco lo hace emerger (focus-within) y Escape lo DESCARTA aunque el
  // foco siga en el botón (WCAG 1.4.13; el estado --suprimido gana a hover y foco).
  await p.locator('button.gt-certificado__descargar').focus()
  check('  el foco también lo hace emerger', await aviso.isVisible())
  await p.keyboard.press('Escape')
  await p.waitForTimeout(250)
  check('  Escape lo cierra sin soltar el foco', !(await aviso.isVisible()))
  await p.close()
}

// ───────────────────────────────── la carta de presentación, en la interfaz
// Misma regla que el certificado: solo el literal `carta: 'admin'` que confirma el servidor
// pinta el enlace del menú y el panel; `no_aplica` (y el campo ausente) caen en el botón
// retenido. La autorización real es del servidor; aquí se verifica lo que se ENSEÑA.
console.log('\nLa carta de presentación: el menú y el gate del panel')

{
  // `IDENTIDAD` (roles: []) sigue sin pintar el enlace: los roles no deciden nada aquí.
  const sinRol = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await sinRol.route('**/api/me', (ruta) => ruta.fulfill({ json: IDENTIDAD }))
  await sinRol.goto(base + '/', { waitUntil: 'networkidle' })
  await sinRol.locator('.gt-sesion__boton').click()
  await sinRol.waitForTimeout(200)
  check('sin `carta: admin` el menú no ofrece el panel', (await sinRol.locator('.gt-sesion__panel a[href="/cdpadmin"]').count()) === 0)
  await sinRol.close()

  const conRol = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await conRol.route('**/api/me', (ruta) => ruta.fulfill({ json: IDENTIDAD_ADMIN }))
  await conRol.goto(base + '/', { waitUntil: 'networkidle' })
  await conRol.locator('.gt-sesion__boton').click()
  await conRol.waitForTimeout(200)
  check(
    'con `carta: admin` el menú enlaza a /cdpadmin',
    (await conRol.locator('.gt-sesion__panel a[href="/cdpadmin"]').count()) === 1,
  )
  await conRol.close()

  const movilRol = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await movilRol.route('**/api/me', (ruta) => ruta.fulfill({ json: IDENTIDAD_ADMIN }))
  await movilRol.goto(base + '/', { waitUntil: 'networkidle' })
  await movilRol.click('.gt-header__hamburguesa')
  await movilRol.waitForTimeout(300)
  check('y también en el menú móvil', (await movilRol.locator('.gt-sesion--movil a[href="/cdpadmin"]').count()) === 1)
  await movilRol.close()
}

for (const [nombre, me, espera] of [
  ['sin sesión', null, 'entrar'],
  ['no_aplica', { ...IDENTIDAD, carta: 'no_aplica' }, 'retenido'],
  ['campo ausente (server viejo)', IDENTIDAD, 'retenido'],
  ['admin', IDENTIDAD_ADMIN, 'panel'],
]) {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
  await instalarMocks(p, { me })
  await p.goto(base + '/cdpadmin', { waitUntil: 'networkidle' })
  if (espera === 'entrar') {
    check(`«${nombre}»: /cdpadmin invita a entrar con retorno`,
      (await p.locator('a.gt-cdp__entrar').getAttribute('href')) === '/auth/login?destino=/cdpadmin')
    check('  y no pinta el panel', (await p.locator('.gt-cdp__panel').count()) === 0)
  } else if (espera === 'retenido') {
    const retenido = p.locator('button.gt-cdp__entrar')
    check(`«${nombre}»: el botón retenido existe, enfocable y descrito`,
      (await retenido.count()) === 1 &&
      (await retenido.getAttribute('aria-disabled')) === 'true' &&
      (await retenido.getAttribute('aria-describedby')) === 'gt-cdp-aviso')
    const aviso = ((await p.locator('#gt-cdp-aviso').textContent()) || '').toLowerCase()
    check('  y el aviso explica cerrar sesión y volver a entrar', aviso.includes('cerrar sesión'))
    check('  y no pinta el panel', (await p.locator('.gt-cdp__panel').count()) === 0)
  } else {
    check(`«${nombre}»: el panel lista las cartas`, (await p.locator('.gt-cdp__tabla tbody tr').count()) === 2)
    check('  la tabla lleva caption y encabezados de columna',
      (await p.locator('.gt-cdp__tabla caption').count()) === 1 &&
      (await p.locator('.gt-cdp__tabla thead th[scope="col"]').count()) === 6)
  }
  await p.close()
}

{
  // «Nueva carta» vacía: el resumen es una alerta, los cuatro obligatorios van marcados y
  // el foco cae en el primero.
  const p = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
  await instalarMocks(p)
  await p.goto(base + '/cdpadmin', { waitUntil: 'networkidle' })
  await p.click('.gt-cdp__nueva')
  await p.waitForSelector('form.gt-formulario')
  check('el formulario no lleva `action` (la CSP tiene form-action none)',
    (await p.locator('form.gt-formulario').getAttribute('action')) === null)
  await p.click('form.gt-formulario button[type="submit"]')
  await p.waitForTimeout(200)
  check('vacío: aparece la alerta', (await p.locator('.gt-formulario [role="alert"]').count()) === 1)
  check('  y los cuatro obligatorios van aria-invalid',
    (await p.locator('.gt-formulario input[aria-invalid="true"]').count()) === 4)
  check('  y el foco cae en el primero (Nombres)',
    await p.evaluate(() => document.activeElement?.getAttribute('name')) === 'nombres')

  // El 400 del servidor: cada código se pinta bajo su campo, con el nombre del campo delante.
  const p2 = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
  await instalarMocks(p2, { alGuardar: () => RESPUESTA_400 })
  await p2.goto(base + '/cdpadmin?perfil=nueva', { waitUntil: 'networkidle' })
  await p2.waitForSelector('form.gt-formulario')
  await p2.fill('input[name="nombres"]', 'Ana')
  await p2.fill('input[name="apellidos"]', 'Pérez')
  await p2.fill('input[name="cargo"]', 'Jefa')
  await p2.fill('input[name="correo"]', 'ana@gecelca')
  await p2.fill('input[name="linkedin"]', 'https://evil.example/')
  await p2.click('form.gt-formulario button[type="submit"]')
  await p2.waitForTimeout(300)
  const errorCorreo = ((await p2.locator('input[name="correo"] ~ .gt-campo__error').textContent()) || '').trim()
  check('400 simulado: el error del correo va bajo su campo, con el nombre delante',
    errorCorreo.startsWith('Correo corporativo:') && errorCorreo.includes('formato'), errorCorreo)
  check('  el de LinkedIn también, nombrando el dominio',
    (((await p2.locator('input[name="linkedin"] ~ .gt-campo__error').textContent()) || '')).includes('linkedin.com'))
  check('  y el foco va al primero inválido (correo)',
    await p2.evaluate(() => document.activeElement?.getAttribute('name')) === 'correo')
  check('  sin borrar lo escrito', (await p2.inputValue('input[name="nombres"]')) === 'Ana')
  await p2.close()
  await p.close()
}

console.log('\nLa carta de presentación: la tarjeta pública')
{
  const p = await browser.newPage({ viewport: { width: 1440, height: 1200 }, acceptDownloads: true })
  // Sin `navigator.share` y con un portapapeles espía: se verifica el respaldo de copiar.
  await p.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
    window.__copiado = null
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (t) => { window.__copiado = t } },
      configurable: true,
    })
  })
  await instalarMocks(p, { me: null })
  await p.goto(base + `/carta_presentacion/${ID_FIXTURE}`, { waitUntil: 'networkidle' })
  await p.evaluate(() => document.fonts.ready)

  check('el nombre es el h1 de la página',
    (await p.locator('h1').count()) === 1 && (await p.locator('h1').textContent())?.trim() === PERFIL_PUBLICO.nombre)
  check('«Llamar» marca el E.164', (await p.locator('a.gt-boton[href^="tel:+57"]').count()) === 1)
  check('«Escribir» abre el correo', (await p.locator(`a.gt-boton[href="mailto:${PERFIL_PUBLICO.correo}"]`).count()) === 1)
  const wa = p.locator('a.gt-boton[href^="https://wa.me/573001234567"]')
  check('«WhatsApp» va a wa.me con los dígitos', (await wa.count()) === 1)
  const externos = await p.$$eval('a[target="_blank"]', (as) => as.map((a) => ({ href: a.href, rel: a.rel })))
  check('todo lo que sale del sitio lleva noopener noreferrer',
    externos.length >= 4 && externos.every((a) => a.rel.includes('noopener') && a.rel.includes('noreferrer')),
    JSON.stringify(externos.map((a) => a.rel)))
  check('«Guardar contacto» es una descarga del vCard del servidor',
    (await p.locator(`a[download][href$="/perfiles/${ID_FIXTURE}/vcard"]`).count()) === 1)
  check('la foto sale del servidor, con el ETag como rompecachés',
    ((await p.locator('.gt-tarjeta__retrato img').getAttribute('src')) || '').includes(`/perfiles/${ID_FIXTURE}/foto?v=`))

  await p.click('.gt-tarjeta__compartir')
  await p.waitForTimeout(200)
  check('«Compartir» sin navigator.share copia el enlace',
    (await p.evaluate(() => window.__copiado)) === PERFIL_PUBLICO.url)
  check('  y lo anuncia en una región de estado',
    ((await p.locator('.gt-tarjeta [role="status"]').textContent()) || '').includes('copiado'))

  const abrir = p.locator('.gt-qr-tarjeta__abrir')
  check('el QR va plegado tras un botón aria-pressed', (await abrir.getAttribute('aria-pressed')) === 'false')
  await abrir.click()
  await p.waitForTimeout(200)
  check('  al abrirlo, el código lleva la URL absoluta de la tarjeta',
    (await p.locator('.gt-qr-tarjeta__codigo').getAttribute('data-contenido')) === PERFIL_PUBLICO.url &&
    (await abrir.getAttribute('aria-pressed')) === 'true')
  check('  y sin ningún dato de sesión en el DOM', !(await p.content()).includes(IDENTIDAD_ADMIN.user.oid))
  await p.close()
}

{
  // El PNG que descarga el panel se LEE con un decodificador real y dice la URL de la tarjeta.
  const p = await browser.newPage({ viewport: { width: 1440, height: 1200 }, acceptDownloads: true })
  await instalarMocks(p)
  await p.goto(base + `/cdpadmin?perfil=${ID_FIXTURE}`, { waitUntil: 'networkidle' })
  await p.waitForSelector('.gt-qr-tarjeta__descargas')
  const [descarga] = await Promise.all([
    p.waitForEvent('download', { timeout: 15000 }),
    p.click('.gt-qr-tarjeta__descargas button:has-text("PNG")'),
  ])
  const ruta = await descarga.path()
  const png = readFileSync(ruta)
  const res = await readBarcodes(new Uint8Array(png), { formats: ['QRCode'], tryHarder: true })
  check('el PNG descargado del panel lo decodifica ZXing y dice la URL de la tarjeta',
    res.length === 1 && res[0].text === PERFIL_PUBLICO.url,
    res.length ? res[0].text.slice(0, 70) : `no encontró ningún QR (${descarga.suggestedFilename()})`)
  check('  con nombre de archivo a partir de la persona',
    descarga.suggestedFilename() === 'qr-Stefany-Vides-Osorio.png', descarga.suggestedFilename())
  await p.close()
}

for (const [nombre, opciones, ruta, fragmento, boton] of [
  ['404', { perfil: 404 }, `/carta_presentacion/${ID_FIXTURE}`, 'no está disponible', 'a[href="/"]'],
  ['id sin forma de UUID', {}, '/carta_presentacion/no-es-un-uuid', 'no está disponible', 'a[href="/"]'],
  ['503', { perfil: 503 }, `/carta_presentacion/${ID_FIXTURE}`, 'No pudimos cargar', 'button.gt-boton'],
]) {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
  await instalarMocks(p, { me: null, ...opciones })
  await p.goto(base + ruta, { waitUntil: 'networkidle' })
  check(`«${nombre}»: la ruta se queda y pinta su aviso`,
    new URL(p.url()).pathname === ruta && ((await p.locator('.gt-carta-pagina__aviso h1').textContent()) || '').includes(fragmento))
  check('  con su salida', (await p.locator(`.gt-carta-pagina__aviso ${boton}`).count()) === 1)
  await p.close()
}

{
  // El 404 de un id válido que no existe tampoco redirige ni filtra nada.
  const p = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
  await instalarMocks(p, { me: null })
  await p.goto(base + `/carta_presentacion/${ID_INEXISTENTE}`, { waitUntil: 'networkidle' })
  check('un UUID válido que no existe: «no disponible» en su propia URL',
    new URL(p.url()).pathname === `/carta_presentacion/${ID_INEXISTENTE}` &&
    (await p.locator('.gt-carta-pagina__aviso').count()) === 1)
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

await sinSesion.goto(base + '/certificado', { waitUntil: 'networkidle' })
check('el certificado invita a entrar, con su destino de retorno',
  (await sinSesion.locator('.gt-certificado__entrar').getAttribute('href')) === '/auth/login?destino=/certificado')
check('sin ninguna descarga ni botón retenido', (await sinSesion.locator('.gt-certificado__descargar').count()) === 0)
{
  const aviso = ((await sinSesion.locator('.gt-certificado__registro').textContent()) || '').toLowerCase()
  check('y con el aviso de privacidad antes del login', aviso.includes('asistencia'))
  // La misma inversión que en /escarapela: con el envío apagado, el aviso ya no anuncia
  // ningún correo de inscripción, y esta comprobación impide que la frase vuelva sola.
  check('que tampoco anuncia el correo de inscripción', !aviso.includes('inscripción'))
}
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

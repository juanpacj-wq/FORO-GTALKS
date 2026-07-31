// Recorrido completo del login en un navegador real, incluido el viaje a Microsoft.
//
//   npm run dev:auth                 # terminal 1 el server de identidad en :3000
//   npm run dev                      # terminal 2 Vite en :5173
//   node scripts/login-test.mjs      # terminal 3
//
// Se ejecuta contra :5173 a propósito: es el origen registrado en el App Registration, y por
// tanto el único donde el redirect URI coincide. Necesita salida a internet llega hasta la
// pantalla de Microsoft, aunque no puede escribir credenciales (MFA de por medio).
//
// Lo que verifica es todo lo que puede fallar sin que nadie se entere:
//   · que el sitio se vea SIN sesión (es público: una redirección aquí sería la regresión),
//   · que /escarapela invite a entrar, con el aviso de registro a la vista,
//   · que el botón lleve a Microsoft de un clic,
//   · que la CSP no bloquee nada por el camino,
//   · y que la URL de autorización lleve PKCE, state, nonce y el redirect URI correcto.
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:5173'

let fallos = 0
function check(nombre, ok, detalle = '') {
  console.log(`${ok ? '  ok  ' : ' FALLA'} ${nombre}${detalle ? ` ${detalle}` : ''}`)
  if (!ok) fallos++
}

for (const url of [base, 'http://localhost:3000/health']) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(3000) })
  } catch {
    console.error(
      `\nNo responde ${url}.\n` +
        '  Levanta los dos: `npm run dev:auth` (identidad, :3000) y `npm run dev` (Vite, :5173).\n',
    )
    process.exit(1)
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

// Contexto limpio: sin cookies, como quien abre el enlace por primera vez.
const ctx = await browser.newContext()
const page = await ctx.newPage()

const violacionesCSP = []
page.on('console', (m) => {
  if (m.text().includes('Content Security Policy')) violacionesCSP.push(m.text())
})

// ── 1. El sitio es público: se ve sin sesión ──────────────────────────────────
console.log('\nPrimer contacto, sin sesión')

await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
await page.waitForLoadState('networkidle').catch(() => {})

check(
  'la home se queda en el sitio (nada redirige solo a Microsoft)',
  page.url() === base + '/',
  page.url().slice(0, 70),
)
check('el contenido del foro SÍ se ve sin sesión', (await page.locator('.gt-hero__titulo').count()) === 1)

// ── 2. /escarapela invita a entrar ────────────────────────────────────────────
console.log('\nLa invitación de /escarapela')

await page.goto(base + '/escarapela', { waitUntil: 'domcontentloaded' })
await page.waitForLoadState('networkidle').catch(() => {})

const boton = page.locator('.gt-escarapela__entrar')
check('el botón de Microsoft está', await boton.isVisible())
check('y apunta al arranque del login', (await boton.getAttribute('href')) === '/auth/login')
check(
  'el aviso de registro de asistencia está a la vista',
  await page.getByText('queda registrado').isVisible(),
)
check('la CSP no bloqueó nada por el camino', violacionesCSP.length === 0, violacionesCSP[0] || '')

// ── 3. El clic lleva a Microsoft, con la URL de autorización bien formada ─────
console.log('\nPetición de autorización a Entra')

await boton.click()
await page.waitForURL(/login\.microsoftonline\.com/, { timeout: 20000 }).catch(() => {})

const autorizacion = new URL(page.url())
if (autorizacion.host.endsWith('login.microsoftonline.com')) {
  const p = autorizacion.searchParams
  check('response_type=code (nunca token en la URL)', p.get('response_type') === 'code')
  check('lleva client_id', Boolean(p.get('client_id')))
  check(
    'el redirect_uri es el registrado en el App Registration',
    p.get('redirect_uri') === `${base}/auth/redirect`,
    p.get('redirect_uri') || '(ausente)',
  )
  check('lleva PKCE con S256', p.get('code_challenge_method') === 'S256' && Boolean(p.get('code_challenge')))
  check('lleva state', Boolean(p.get('state')))
  check('lleva nonce', Boolean(p.get('nonce')))
  check(
    'pide User.Read (el cargo del carné y del menú de sesión)',
    (p.get('scope') || '').includes('User.Read'),
    p.get('scope') || '',
  )
  check('el tenant NO es «common»', !autorizacion.pathname.startsWith('/common/'), autorizacion.pathname)
  check('NO pide prompt=none (el SSO silencioso murió con el gate)', p.get('prompt') !== 'none')
} else {
  check('se llegó a la pantalla de Microsoft', false, page.url().slice(0, 70))
}

await browser.close()
console.log(fallos === 0 ? '\nLogin: todo en orden.\n' : `\n${fallos} verificación(es) fallaron.\n`)
process.exit(fallos === 0 ? 0 : 1)

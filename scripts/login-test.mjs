// Recorrido completo del login en un navegador real, incluido el viaje a Microsoft.
//
//   npm run dev:auth                 # terminal 1 — el gate en :3000
//   npm run dev                      # terminal 2 — Vite en :5173
//   node scripts/login-test.mjs      # terminal 3
//
// Se ejecuta contra :5173 a propósito: es el origen registrado en el App Registration, y por
// tanto el único donde el redirect URI coincide. Necesita salida a internet — llega hasta la
// pantalla de Microsoft, aunque no puede escribir credenciales (MFA de por medio).
//
// Lo que verifica es todo lo que puede fallar sin que nadie se entere:
//   · que abrir el sitio sin sesión acabe SIEMPRE en Microsoft o en la pantalla de login,
//   · que el botón haga algo (una regresión anterior lo dejó muerto tras tres recargas),
//   · que la CSP no bloquee el script de la pantalla de login,
//   · y que la URL de autorización lleve PKCE, state, nonce y el redirect URI correcto.
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:5173'

let fallos = 0
function check(nombre, ok, detalle = '') {
  console.log(`${ok ? '  ok  ' : ' FALLA'} ${nombre}${detalle ? ` — ${detalle}` : ''}`)
  if (!ok) fallos++
}

for (const url of [base, 'http://localhost:3000/health']) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(3000) })
  } catch {
    console.error(
      `\nNo responde ${url}.\n` +
        '  Levanta los dos: `npm run dev:auth` (gate, :3000) y `npm run dev` (Vite, :5173).\n',
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

// ── 1. Abrir el sitio sin sesión ──────────────────────────────────────────────
console.log('\nPrimer contacto, sin sesión')

await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
await page.waitForLoadState('networkidle').catch(() => {})

const url1 = page.url()
const enMicrosoft = url1.startsWith('https://login.microsoftonline.com/')
const enPantallaLogin = (await page.locator('a.ms-btn').count()) > 0

check(
  'acaba en Microsoft o en la pantalla de login, nunca en el sitio',
  enMicrosoft || enPantallaLogin,
  url1.slice(0, 70),
)
check(
  'el contenido del foro NO se ve sin sesión',
  (await page.locator('.gt-hero__titulo').count()) === 0,
)

// ── 2. La pantalla de login funciona ──────────────────────────────────────────
if (enPantallaLogin) {
  console.log('\nPantalla de login')

  check('el botón de Microsoft está', await page.locator('a.ms-btn').isVisible())
  check(
    'y apunta al arranque del login',
    (await page.locator('a.ms-btn').getAttribute('href')) === '/auth/login',
  )
  check('la CSP no bloquea el script de la pantalla', violacionesCSP.length === 0, violacionesCSP[0] || '')

  // El fallo que motivó esta prueba: tras varias recargas el botón dejaba de hacer nada, porque
  // el rompebucles contaba TODOS los arranques de login en vez de solo los automáticos.
  console.log('\nEl botón sigue vivo tras varias recargas')
  for (let i = 0; i < 4; i++) {
    await page.goto(base + '/?auth=interactive_required', { waitUntil: 'domcontentloaded' })
  }
  await page.locator('a.ms-btn').click()
  await page.waitForURL(/login\.microsoftonline\.com|\/\?auth=/, { timeout: 20000 }).catch(() => {})
  check(
    'tras 4 recargas, el botón sigue llevando a Microsoft',
    page.url().startsWith('https://login.microsoftonline.com/'),
    page.url().slice(0, 70),
  )
}

// ── 3. La URL de autorización está bien formada ───────────────────────────────
console.log('\nPetición de autorización a Entra')

if (!page.url().startsWith('https://login.microsoftonline.com/')) {
  await page.goto(base + '/auth/login', { waitUntil: 'domcontentloaded' }).catch(() => {})
}

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
    'pide User.Read (el cargo que muestra el menú de sesión)',
    (p.get('scope') || '').includes('User.Read'),
    p.get('scope') || '',
  )
  check('el tenant NO es «common»', !autorizacion.pathname.startsWith('/common/'), autorizacion.pathname)
} else {
  check('se llegó a la pantalla de Microsoft', false, page.url().slice(0, 70))
}

await browser.close()
console.log(fallos === 0 ? '\nLogin: todo en orden.\n' : `\n${fallos} verificación(es) fallaron.\n`)
process.exit(fallos === 0 ? 0 : 1)

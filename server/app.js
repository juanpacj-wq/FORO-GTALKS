/**
 * Compositor de la app Express — gate de Microsoft Entra ID sobre un sitio ESTÁTICO.
 * Aquí no hay BD ni API de datos: lo que se protege es la SPA completa (dist/).
 *
 * Pipeline, en orden:
 *   helmet → cabeceras propias → session → csrf → /health → auth (login/redirect/me/logout) →
 *   revalidate → gate (requireEntra) → estáticos de dist/ → fallback SPA → 404 → errorHandler.
 *
 * ── Política de acceso sin sesión ──────────────────────────────────────────────
 * El requisito es «todo acceso sin autenticación acaba en Microsoft». Aplicado al pie de la
 * letra rompería el sitio: un 302 a login.microsoftonline.com sobre un <script> devuelve HTML
 * que no parsea, sobre un fetch() da un error de CORS opaco, y sobre un POST pierde el cuerpo.
 * Lo que sí se garantiza —y es lo que el requisito quiere decir— es que **ninguna navegación de
 * una persona termina en un callejón sin salida que no sea Microsoft**:
 *
 *   navegación (Sec-Fetch-Dest: document)  → 302 a Entra, incluso para /img/foto.webp escrito
 *                                            a mano en la barra de direcciones
 *   subrecurso, fetch/XHR, /api/*, no-GET  → 401 JSON
 *
 * El gate de QUIÉN entra vive en Entra: Enterprise App con "Asignación requerida = Sí".
 * Un usuario del tenant NO asignado autentica pero Entra responde AADSTS50105 → /?auth=no_acceso.
 */
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectRoles } from './auth/roles.js';
import { revalidate, REVALIDATE_INTERVAL_MS } from './auth/revalidate.js';
import { registrarAcceso } from './auth/auditoria.js';
import {
  isConfigured as m365Configured, m365Config,
  getAuthCodeUrl, acquireTokenByCode, getLogoutUrl, obtenerPerfil,
} from './auth/m365.js';
import {
  SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS, SESSION_COOKIE_SECURE,
  SESSION_VIDA_ABSOLUTA_MS, SESSION_PRELOGIN_MS, PUBLIC_ORIGIN, AUTH_RATE_LIMIT,
} from './auth/entra-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const LOGIN_PAGE = path.join(__dirname, 'login.html');

// Únicos archivos de dist/ visibles SIN sesión: los que usa la pantalla de login. Mantener MÍNIMA.
// Son la marca del evento y la tipografía; nada de contenido del foro (ni agenda, ni ponentes, ni
// las fotos). Si cambian los assets del login, esta lista se actualiza a la vez.
const LOGIN_PUBLIC_ASSETS = new Set([
  '/favicon.svg',
  '/img/logo-gecelca.svg',
  '/img/icono-burbujas.svg',
  '/img/wordmark-g-talks.svg',
  '/fonts/urbanist-latin.woff2',
]);

// Destino de los redirects de error del callback OIDC. El éxito NO lleva marcador: redirige
// limpio al destino guardado, y por eso hace falta el rompebucles de más abajo.
const home = (auth) => `/?auth=${auth}`;

/**
 * Rutas que la SPA sabe resolver. Es la lista blanca contra la que se valida el destino de un
 * deep link, y está escrita con un allowlist de caracteres (`[a-z0-9-]`), no con un denylist de
 * trucos: `//evil.com`, `/\evil`, `/%2f%2f…` y los CRLF fallan el match por construcción, así que
 * la clase entera de open redirect desaparece sin depender de cómo normalice `res.redirect`.
 */
const RUTAS_SPA = [
  /^\/$/,
  /^\/ponentes$/,
  /^\/ponentes\/[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/,
  /^\/escarapela$/,
  /^\/encuestas$/,
];
const destinoSeguro = (p) => (RUTAS_SPA.some((r) => r.test(p)) ? p : '/');

/**
 * ¿Es una persona navegando, o un subrecurso que pide el navegador?
 *
 * `Sec-Fetch-*` viaja en todo contexto seguro (HTTPS y localhost), así que distingue lo que la
 * heurística por extensión no puede: `/img/hero.webp` escrito en la barra de direcciones llega
 * con `Sec-Fetch-Dest: document` y debe ir a Microsoft, mientras que ese mismo archivo pedido
 * por un <img> de una pestaña vieja llega con `dest: image` y debe recibir 401.
 * Se exige `document` a propósito: un <iframe> recibe 401, no una cadena de redirects.
 */
function esNavegacion(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (req.path.startsWith('/api/')) return false;
  const modo = req.get('sec-fetch-mode');
  if (modo) return modo === 'navigate' && req.get('sec-fetch-dest') === 'document';
  return (req.get('accept') || '').includes('text/html'); // clientes sin Sec-Fetch
}

/**
 * Predicado ÚNICO de sesión válida, usado por el gate, por /api/me y por la revalidación.
 * Antes había dos distintos (`session.user` vs `session.user.oid`) y una sesión con `oid` vacío
 * era «autenticada» para /api/me y rechazada por el gate.
 *
 * Incluye la vida ABSOLUTA: con `rolling: true` no existe tope superior, y una pestaña abierta
 * renovaría la sesión indefinidamente.
 */
export function estaAutenticado(sess) {
  const u = sess?.user;
  if (!u?.oid) return false;
  const inicio = Date.parse(u.loginAt || '');
  if (Number.isFinite(inicio) && Date.now() - inicio > SESSION_VIDA_ABSOLUTA_MS) return false;
  return true;
}

function clearAuthTransients(s) {
  delete s.pkceVerifier; delete s.authState; delete s.authNonce; delete s.silent;
}

// Envuelve un handler async y enruta el throw al error-handler de Express.
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ── Rompebucles ───────────────────────────────────────────────────────────────
// Si la cookie de sesión no se puede fijar (proxy sin X-Forwarded-Proto, navegador bloqueando
// cookies), el callback vuelve, el gate no ve sesión y redirige otra vez: bucle infinito y MUDO.
// El contador no puede vivir en la sesión —la sesión es justo lo que está roto—, así que va en
// una cookie propia de vida corta.
//
// OJO con QUÉ se cuenta. La primera versión contaba «veces que se arrancó un login», y como cada
// carga de página dispara un intento silencioso, a la tercera recarga el botón «Iniciar sesión»
// dejaba de hacer nada durante cinco minutos. Contar mal aquí rompe el login entero.
//
// Solo se cuentan los intentos AUTOMÁTICOS (`silent=1`), que son los únicos que pueden encadenarse
// solos. Un clic de una persona es intención, no un bucle: siempre arranca un login real y pone el
// contador a cero.
const COOKIE_BUCLE = 'gt_lt';
const MAX_INTENTOS = 3;

function intentos(req) {
  const m = /(?:^|;\s*)gt_lt=(\d+)/.exec(req.headers.cookie || '');
  return m ? Number(m[1]) : 0;
}

/** CSRF de mutadores. Tres correcciones sobre la versión anterior:
 *  - cubre CUALQUIER método que no sea de lectura (antes PATCH quedaba fuera),
 *  - compara contra PUBLIC_ORIGIN y no contra `x-forwarded-host`, que es una cabecera que el
 *    propio request puede traer: usarla como referencia de «mi host» es autorreferencial,
 *  - exige `Sec-Fetch-Site: same-origin` u `Origin` válido. Antes, si NO llegaba `Origin`, la
 *    petición pasaba sin validar; ese era el hueco real.
 */
const METODOS_LECTURA = new Set(['GET', 'HEAD', 'OPTIONS']);

function csrfMiddleware(req, res, next) {
  if (METODOS_LECTURA.has(req.method)) return next();

  const sitio = req.get('sec-fetch-site');
  if (sitio === 'same-origin' || sitio === 'none') return next();

  const origin = req.get('origin');
  if (origin && PUBLIC_ORIGIN && origin === PUBLIC_ORIGIN) return next();

  return res.status(403).json({ error: 'Origen no permitido', codigo: 'origen_no_permitido' });
}

// ── CSP derivada, no declarada ────────────────────────────────────────────────
// Los hashes de los bloques inline se calculan leyendo los HTML al arrancar. Una CSP con hashes
// pegados a mano en un sitio que se reconstruye cada año está garantizada a pudrirse: así es
// correcta por construcción después de cada `vite build`.
function hashesInline(html, etiqueta) {
  const re = new RegExp(`<${etiqueta}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${etiqueta}>`, 'g');
  return [...html.matchAll(re)]
    .map((m) => `'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
}

// El hash del login se recalcula si el archivo cambió, en vez de fijarse al arrancar. Sin esto,
// editar `login.html` y no reiniciar deja la CSP con el hash viejo: el navegador bloquea el script
// EN SILENCIO y la pantalla se queda sin mensajes ni botones, sin ningún error visible. Pasó
// exactamente eso durante el desarrollo. Un `stat` por visita a la pantalla de login no se nota.
let cacheLogin = { mtime: 0, csp: '' };

function construirCSP() {
  // La SPA no tiene inline: el <script> que limpiaba `?auth=` se eliminó al dejar de emitir ese
  // marcador, así que `script-src 'self'` queda sin excepciones que mantener.
  const spa = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",   // data: lo exige el grano SVG de tokens.css
    "font-src 'self'",
    "connect-src 'self'",     // 'none' sería una trampa para quien implemente /escarapela
    "base-uri 'none'",
    "form-action 'none'",     // el sitio no tiene ni un <form>; el salto a Entra es un 302
    "frame-ancestors 'none'",
    "object-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ');

  return { spa, login: () => cspLogin(spa) };
}

function cspLogin(porDefecto) {
  try {
    const mtime = fs.statSync(LOGIN_PAGE).mtimeMs;
    if (mtime === cacheLogin.mtime) return cacheLogin.csp;

    const html = fs.readFileSync(LOGIN_PAGE, 'utf8');
    const js = hashesInline(html, 'script').join(' ');
    const css = hashesInline(html, 'style').join(' ');
    const csp = [
      "default-src 'none'",
      `script-src ${js || "'none'"}`,
      `style-src ${css || "'none'"}`,
      "img-src 'self'",
      "font-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      'upgrade-insecure-requests',
    ].join('; ');
    cacheLogin = { mtime, csp };
    return csp;
  } catch (err) {
    console.error('[csp] no se pudo leer login.html para derivar hashes:', err.message);
    return porDefecto;
  }
}

// ── Cache-Control ─────────────────────────────────────────────────────────────
// Lo decisivo es `private`, no el max-age: el riesgo real es que un proxy corporativo vea el
// `public` que pone serve-static por defecto, cachee /img y /assets y se los sirva a un colega
// SIN sesión. Contenido con gate detrás de una caché compartida es una fuga que no pasa por Entra.
function cacheDe(ruta) {
  if (ruta.startsWith('/assets/')) return 'private, max-age=31536000, immutable'; // llevan hash
  if (ruta.startsWith('/fonts/')) return 'private, max-age=86400, must-revalidate';
  if (/\.(webp|png|svg|jpg|jpeg|ico)$/.test(ruta)) return 'private, max-age=3600, must-revalidate';
  return 'no-store';
}

export function buildAuthApp() {
  const app = express();
  // 'loopback' y no 1: con `1` Express confía en el peer inmediato, y quien alcance el puerto
  // directamente podría falsificar X-Forwarded-Proto (cookie Secure sobre HTTP en claro) y
  // X-Forwarded-For (evadir límites, envenenar logs). Va emparejado con listen('127.0.0.1').
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');

  const isProduction = process.env.NODE_ENV === 'production';
  const CSP = construirCSP();

  if (isProduction && !process.env.SESSION_SECRET) {
    throw new Error(
      'SESSION_SECRET es obligatorio en producción (NODE_ENV=production). ' +
      'Genera uno con `openssl rand -hex 32` y configúralo en el entorno antes de arrancar.'
    );
  }
  const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
  if (!process.env.SESSION_SECRET) {
    console.warn('  ⚠  SESSION_SECRET no está en .env — se generó uno efímero (las sesiones mueren al reiniciar).');
  }

  // helmet sin CSP (ponemos la nuestra, que depende del contenido) y sin HSTS (dueño: nginx, que
  // es quien termina TLS). Se queda por lo que sí aporta y por mantenerse al día con cabeceras
  // nuevas que en un sitio de un día al año nadie va a revisitar.
  app.use(helmet({
    contentSecurityPolicy: false,      // la nuestra depende del contenido (SPA vs login)
    strictTransportSecurity: false,    // dueño: nginx, que es quien termina TLS
    crossOriginEmbedderPolicy: false,  // COEP no aporta nada aquí y rompe recursos con facilidad
    // DENY y no el SAMEORIGIN por defecto: contradecía a `frame-ancestors 'none'` de la CSP.
    xFrameOptions: { action: 'deny' },
  }));

  app.use((req, res, next) => {
    // El <meta robots> solo cubre el HTML; la cabecera cubre también assets y login.html.
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
  });

  // Store en MEMORIA a propósito: persistirla significaría escribir el refresh token de Entra a
  // disco en una máquina expuesta a internet. Tras un reinicio, la siguiente navegación va sin
  // marcador → /auth/login?silent=1 → Entra aún tiene la sesión del navegador → el usuario vuelve
  // a entrar con cero clics. El costo de un reinicio es un round-trip invisible.
  app.use(session({
    name: SESSION_COOKIE_NAME,
    secret: sessionSecret,
    store: new session.MemoryStore(),
    resave: false,
    saveUninitialized: false,
    rolling: true,         // renueva la expiración en cada request
    cookie: {
      httpOnly: true,
      sameSite: 'lax',     // permite que la cookie viaje en la redirección OIDC (navegación top-level)
      secure: isProduction ? true : SESSION_COOKIE_SECURE,
      maxAge: SESSION_MAX_AGE_MS,
      path: '/',
    },
  }));

  app.use(csrfMiddleware);

  // ── Healthcheck. nginx lo restringe a 127.0.0.1: no tiene por qué ser público. ──
  app.get('/health', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  const limitador = (nombre) => rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: AUTH_RATE_LIMIT,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Cortacircuitos, NO política de seguridad: con NAT corporativo, un límite que tolere las
    // ~300 llegadas simultáneas de la sede no detiene a nadie decidido. Sirve para cortar un
    // bucle desbocado o un cliente roto. El dial se sube el día del evento (AUTH_RATE_LIMIT).
    handler: (req, res) => {
      console.warn(`[rate-limit] ${nombre} agotado desde ${req.ip}`);
      res.status(429).json({ error: 'Demasiados intentos', codigo: 'demasiados_intentos' });
    },
  });

  // ── Paso 1: arranca el login OIDC ──────────────────────────────────────────
  app.get('/auth/login', limitador('auth/login'), async (req, res) => {
    if (!m365Configured()) {
      return res.status(503).json({ ok: false, reason: 'm365_no_configurado',
        detail: 'Faltan M365_TENANT_ID / M365_CLIENT_ID / M365_CLIENT_SECRET en el entorno.' });
    }

    const silent = req.query.silent === '1' || req.query.silent === 'true';

    if (silent) {
      // Tres intentos automáticos seguidos sin conseguir sesión significan que la cookie no se
      // puede fijar. Se corta y se manda a la pantalla CON marcador, para que diga la causa: si se
      // sirviera el HTML aquí mismo, la URL no llevaría `?auth=` y la tarjeta saldría en blanco.
      if (intentos(req) >= MAX_INTENTOS) {
        return res.redirect(home('cookies_bloqueadas'));
      }
      res.cookie(COOKIE_BUCLE, String(intentos(req) + 1), {
        httpOnly: true, sameSite: 'lax', secure: isProduction, path: '/', maxAge: 300_000,
      });
    } else {
      // Clic explícito: el contador se reinicia y el login arranca siempre.
      res.clearCookie(COOKIE_BUCLE, { path: '/' });
    }

    try {
      const select = req.query.switch === '1' || req.query.select === '1';
      const fresh = req.query.fresh === '1';
      const { url, pkceVerifier, state, nonce } = await getAuthCodeUrl(req.session, { silent, select, fresh });
      req.session.pkceVerifier = pkceVerifier;
      req.session.authState = state;
      req.session.authNonce = nonce;
      req.session.silent = silent;
      // La sesión PRE-LOGIN vive 10 minutos, no 8 horas. Es la medida antiabuso más efectiva del
      // plan: un escáner que golpee /auth/login no llena el store con sesiones de larga vida.
      req.session.cookie.maxAge = SESSION_PRELOGIN_MS;
      req.session.save(() => res.redirect(url));
    } catch (err) {
      console.error('[auth/login]', err);
      res.status(500).json({ ok: false, reason: 'error_auth_url',
        detail: 'No se pudo iniciar sesión con Microsoft. Intenta de nuevo; si continúa, contacta a soporte.' });
    }
  });

  // ── Paso 2: callback de Microsoft con el código de autorización ─────────────
  app.get('/auth/redirect', limitador('auth/redirect'), async (req, res) => {
    const wasSilent = Boolean(req.session.silent);

    if (req.query.error) {
      const e = String(req.query.error);
      clearAuthTransients(req.session);
      if (e === 'login_required' || e === 'interaction_required' || e === 'consent_required') {
        return req.session.save(() => res.redirect(home('interactive_required')));
      }
      const desc = String(req.query.error_description || '');
      if (desc.includes('AADSTS50105')) {
        // Autenticó (y pasó MFA) pero NO está asignado a la Enterprise App. Este es el gate.
        registrarAcceso({ resultado: 'no_asignado' });
        return req.session.destroy(() => res.redirect(home('no_acceso')));
      }
      console.warn(`[auth/redirect] error de Entra: ${e} — ${desc}`);
      return req.session.save(() => res.redirect(home('error')));
    }

    const { code, state } = req.query;
    if (!code || !state || state !== req.session.authState) {
      clearAuthTransients(req.session);
      return req.session.save(() => res.redirect(home(wasSilent ? 'interactive_required' : 'state_invalido')));
    }

    try {
      const result = await acquireTokenByCode(req.session, {
        code: String(code),
        pkceVerifier: req.session.pkceVerifier,
        nonce: req.session.authNonce,
      });

      const claims = result.idTokenClaims || {};
      const upn = claims.preferred_username || claims.upn || claims.email || result.account?.username || '';
      const fullName = claims.name || result.account?.name || '';
      const email = claims.email || upn;
      const oid = claims.oid || result.account?.localAccountId || '';
      const tenantId = claims.tid || '';
      const roles = detectRoles(claims);

      // Sin `oid` no hay identidad utilizable: el login FALLA, en vez de crear una sesión que
      // /api/me aceptaría y el gate rechazaría.
      if (!oid) {
        console.warn('[auth/redirect] id_token sin oid — sesión no creada');
        clearAuthTransients(req.session);
        return req.session.save(() => res.redirect(home('error')));
      }

      registrarAcceso({ resultado: 'ok', oid, upn, roles });

      // El cargo no es un claim OIDC: se pide a Graph. Si no llega, el menú de sesión muestra el
      // correo en su lugar — el login nunca depende de esto.
      const perfil = await obtenerPerfil(result.accessToken);

      const user = {
        // Los invitados B2B llegan con un UPN mutilado (`usuario_dominio.com#EXT#@…`), que no se
        // debe mostrar nunca: se prefiere el nombre del directorio.
        nombre_completo: perfil?.displayName || fullName || upn.split('#EXT#')[0],
        cargo: perfil?.jobTitle || '',
        area: perfil?.department || '',
        upn, email, oid, tenantId, roles,
        loginAt: new Date().toISOString(),
        via: 'm365',
      };

      // Sesión NUEVA (anti session-fixation), preservando la caché de tokens MSAL recién obtenida
      // y el destino del deep link — si se olvida cualquiera de los dos, falla en silencio.
      const msalCache = req.session.msalCache;
      const destino = destinoSeguro(req.session.destino || '/');
      req.session.regenerate((err) => {
        if (err) {
          console.error('[auth/redirect] regenerate', err);
          return res.redirect(home('error'));
        }
        req.session.user = user;
        req.session.msalCache = msalCache;
        req.session.lastRevalidatedAt = Date.now();
        req.session.cookie.maxAge = SESSION_MAX_AGE_MS; // sale del TTL corto de pre-login
        res.clearCookie(COOKIE_BUCLE, { path: '/' });
        req.session.save(() => res.redirect(destino));
      });
    } catch (err) {
      console.error('[auth/redirect]', err);
      clearAuthTransients(req.session);
      req.session.save(() => res.redirect(home('error')));
    }
  });

  // ── Identidad ────────────────────────────────────────────────────────────────
  app.get('/api/me', asyncH(revalidate), (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!estaAutenticado(req.session)) return res.status(401).json({ authenticated: false });
    res.json({ authenticated: true, user: req.session.user });
  });

  // ── Logout: destruye la cookie + front-channel a Microsoft ──────────────────
  app.post('/api/logout', (req, res) => {
    const logoutUrl = getLogoutUrl();
    req.session.destroy(() => {
      res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ ok: true, logoutUrl });
    });
  });

  app.get('/auth/logout', (req, res) => {
    const logoutUrl = getLogoutUrl();
    req.session.destroy(() => {
      res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
      res.redirect(logoutUrl);
    });
  });

  // ── Revalidación silenciosa sobre la navegación (throttled por sesión) ──────
  app.use(asyncH(revalidate));

  // ── Gate ─────────────────────────────────────────────────────────────────────
  app.use((req, res, next) => {
    if (estaAutenticado(req.session)) return next();

    // Sesión que existe pero superó la vida absoluta: se destruye antes de reautenticar.
    if (req.session?.user) {
      return req.session.destroy(() => res.redirect('/auth/login?silent=1'));
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && LOGIN_PUBLIC_ASSETS.has(req.path)) {
      return next();
    }

    if (esNavegacion(req)) {
      res.setHeader('Cache-Control', 'no-store');
      // Sin marcador → primer contacto: se guarda el destino y se intenta el SSO silencioso.
      if (req.query.auth === undefined) {
        req.session.destino = destinoSeguro(req.path);
        return req.session.save(() => res.redirect('/auth/login?silent=1'));
      }
      // Con marcador → pantalla de login con el mensaje correspondiente.
      res.setHeader('Content-Security-Policy', CSP.login());
      return res.sendFile(LOGIN_PAGE);
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(401).json({ error: 'No autenticado', codigo: 'no_autenticado' });
  });

  // ── SPA estática (solo autenticados llegan aquí) ─────────────────────────────
  if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    console.warn(`  ⚠  No existe ${DIST_DIR}\\index.html — corre \`npm run build\` antes de servir en producción.`);
  }
  app.use(express.static(DIST_DIR, {
    setHeaders: (res, ruta) => {
      res.setHeader('Cache-Control', cacheDe('/' + path.relative(DIST_DIR, ruta).replace(/\\/g, '/')));
    },
  }));

  // Fallback SPA: solo para navegaciones. Antes servía index.html para CUALQUIER ruta, así que
  // un /no-existe.png devolvía 200 con Content-Type text/html.
  app.use((req, res, next) => {
    if (!esNavegacion(req)) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', CSP.spa);
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });

  // ── 404 propio ───────────────────────────────────────────────────────────────
  app.use((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).json({ error: 'No encontrado', codigo: 'no_encontrado' });
  });

  // ── Error-handler: sanea (no filtra internals al cliente) ───────────────────
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    console.error('[server]', err);
    if (res.headersSent) return;
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({ error: 'Error interno', codigo: 'error_interno' });
  });

  console.log(`  [auth] Entra ID ${m365Config().configured ? 'CONFIGURADO (tenant ' + m365Config().tenant + ')' : 'NO configurado (faltan M365_* en el entorno)'}`);
  console.log(`  [auth] sesión: ${Math.round(SESSION_MAX_AGE_MS / 3600000)} h inactividad · ${Math.round(SESSION_VIDA_ABSOLUTA_MS / 3600000)} h absoluta · revalidación cada ${Math.round(REVALIDATE_INTERVAL_MS / 60000)} min`);

  return app;
}

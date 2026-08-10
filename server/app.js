/**
 * Compositor de la app Express sitio PÚBLICO con identidad opcional de Microsoft Entra ID.
 * Aquí no hay BD ni API de datos: dist/ se sirve a cualquiera, y la única superficie con
 * sesión es la identidad (`/api/me`) que alimenta la escarapela de `/escarapela`.
 *
 * Pipeline, en orden:
 *   helmet → cabeceras propias → session → csrf → /health → auth (login/redirect/me/logout) →
 *   estáticos de dist/ → fallback SPA → 404 → errorHandler.
 *
 * ── Política de acceso ─────────────────────────────────────────────────────────
 * El contenido del foro es público por decisión del negocio; nada redirige solo a Microsoft.
 * El login nace únicamente del botón de `/escarapela` (→ /auth/login) y lo que protege no es
 * el sitio sino la IDENTIDAD:
 *
 *   navegación y subrecursos              → 200, con la CSP en todo HTML
 *   GET /api/me sin sesión                → 401 JSON (no-store)
 *   GET /api/encuestas                    → 200 JSON público; la URL de la encuesta de
 *                                           satisfacción solo viaja tras el cierre del evento
 *   métodos no-lectura cross-site         → 403 (csrfMiddleware)
 *
 * El gate de QUIÉN puede iniciar sesión sigue viviendo en Entra: Enterprise App con
 * "Asignación requerida = Sí". Un usuario del tenant NO asignado autentica pero Entra responde
 * AADSTS50105 → /escarapela?auth=no_acceso. Los errores del callback llevan siempre a
 * /escarapela?auth=<motivo>, donde la SPA los explica junto al botón de entrar.
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
  iniciarInscripcion, reservarInscripcion, enviarInscripcion, estadoInscripcion,
} from './correo/inscripcion.js';
import { estadoEncuestas } from './encuestas.js';
import { iniciarCertificados, estadoCertificado, rutaCertificado } from './certificados.js';
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

// Destino de los redirects de error del callback OIDC. El éxito NO lleva marcador: redirige
// limpio al destino guardado. Los errores caen en /escarapela, que es donde vive el botón de
// entrar y donde la SPA sabe explicar cada motivo.
const aEscarapela = (auth) => `/escarapela?auth=${auth}`;

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
  /^\/certificado$/,
];
const destinoSeguro = (p) => (RUTAS_SPA.some((r) => r.test(p)) ? p : '/');

/**
 * ¿Es una persona navegando, o un subrecurso que pide el navegador?
 *
 * `Sec-Fetch-*` viaja en todo contexto seguro (HTTPS y localhost), así que distingue lo que la
 * heurística por extensión no puede. Hoy su único trabajo es decidir el fallback de la SPA:
 * una navegación a `/ponentes` recibe index.html; un `/no-existe.png` pedido por un <img>
 * recibe el 404 JSON en vez de HTML con 200. Se exige `document` a propósito: un <iframe>
 * tampoco merece el fallback.
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
  delete s.pkceVerifier; delete s.authState; delete s.authNonce;
}

// Envuelve un handler async y enruta el throw al error-handler de Express.
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

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

// ── CSP ───────────────────────────────────────────────────────────────────────
// Una sola política: la de la SPA, emitida en TODO HTML que sale de aquí (el fallback es la única
// puerta, ver `index: false` abajo). La SPA no tiene inline, así que `script-src 'self'` queda sin
// excepciones que mantener. El QR de la escarapela se pinta como <svg> en el DOM (nodos, no
// imagen) y la foto del asistente viaja como data: URI, que `img-src` ya permite por el grano SVG.
const CSP_SPA = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",   // data: lo exigen el grano SVG de tokens.css y la foto local del badge
  "font-src 'self'",
  "connect-src 'self'",     // /api/me, la identidad de la escarapela
  "base-uri 'none'",
  "form-action 'none'",     // el sitio no tiene ni un <form>; el salto a Entra es un 302
  "frame-ancestors 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  'upgrade-insecure-requests',
].join('; ');

// ── Cache-Control ─────────────────────────────────────────────────────────────
// Con el sitio público, los assets pueden vivir en cachés compartidas sin fugar nada: el único
// contenido por persona es /api/me, que va `no-store` en su propia ruta. El HTML sigue `no-store`
// para que un despliegue no conviva con index.html viejos apuntando a hashes que ya no existen.
function cacheDe(ruta) {
  if (ruta.startsWith('/assets/')) return 'public, max-age=31536000, immutable'; // llevan hash
  if (ruta.startsWith('/fonts/')) return 'public, max-age=86400, must-revalidate';
  if (/\.(webp|png|svg|jpg|jpeg|ico)$/.test(ruta)) return 'public, max-age=3600, must-revalidate';
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

  if (isProduction && !process.env.SESSION_SECRET) {
    throw new Error(
      'SESSION_SECRET es obligatorio en producción (NODE_ENV=production). ' +
      'Genera uno con `openssl rand -hex 32` y configúralo en el entorno antes de arrancar.'
    );
  }
  const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
  if (!process.env.SESSION_SECRET) {
    console.warn('  ⚠  SESSION_SECRET no está en .env se generó uno efímero (las sesiones mueren al reiniciar).');
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
  // disco en una máquina expuesta a internet. Tras un reinicio, el sitio sigue en pie (es público)
  // y quien tenía sesión ve otra vez el botón en /escarapela; como Entra aún tiene la sesión del
  // navegador, ese clic no vuelve a pedir credenciales. El costo de un reinicio es un clic.
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

    try {
      const select = req.query.switch === '1' || req.query.select === '1';
      const fresh = req.query.fresh === '1';
      // Todo login nace de un clic en /escarapela, así que el retorno por defecto es esa página.
      // `destinoSeguro` (allowlist RUTAS_SPA) sigue cerrando la clase entera de open redirect.
      req.session.destino = destinoSeguro(String(req.query.destino ?? '/escarapela'));
      const { url, pkceVerifier, state, nonce } = await getAuthCodeUrl(req.session, { select, fresh });
      req.session.pkceVerifier = pkceVerifier;
      req.session.authState = state;
      req.session.authNonce = nonce;
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
    if (req.query.error) {
      const e = String(req.query.error);
      clearAuthTransients(req.session);
      const desc = String(req.query.error_description || '');
      if (desc.includes('AADSTS50105')) {
        // Autenticó (y pasó MFA) pero NO está asignado a la Enterprise App. Este es el gate.
        registrarAcceso({ resultado: 'no_asignado' });
        return req.session.destroy(() => res.redirect(aEscarapela('no_acceso')));
      }
      console.warn(`[auth/redirect] error de Entra: ${e} ${desc}`);
      return req.session.save(() => res.redirect(aEscarapela('error')));
    }

    const { code, state } = req.query;
    if (!code || !state || state !== req.session.authState) {
      // Si Microsoft SÍ devolvió código y estado pero aquí no hay rastro del intento, la sesión
      // pre-login no sobrevivió el viaje: la causa es la cookie (bloqueada o sin fijar), no una
      // manipulación. Sin esta distinción, un navegador con cookies bloqueadas vería el mensaje
      // de `state_invalido`, que acusa a la persona equivocada.
      const motivo = code && state && !req.session.authState ? 'cookies_bloqueadas' : 'state_invalido';
      clearAuthTransients(req.session);
      return req.session.save(() => res.redirect(aEscarapela(motivo)));
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
        console.warn('[auth/redirect] id_token sin oid sesión no creada');
        clearAuthTransients(req.session);
        return req.session.save(() => res.redirect(aEscarapela('error')));
      }

      registrarAcceso({ resultado: 'ok', oid, upn, roles });

      // ¿Es su primer inicio de sesión? La reserva es SÍNCRONA y va aquí, con la identidad ya
      // validada: es el punto donde se cierra la carrera de dos pestañas entrando a la vez. El
      // envío en sí se dispara más abajo, DESPUÉS de responder (ver correo/inscripcion.js).
      const inscribir = reservarInscripcion({ oid, correo: upn });

      // El cargo no es un claim OIDC: se pide a Graph. Si no llega, el menú de sesión muestra el
      // correo en su lugar el login nunca depende de esto.
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
      // y el destino del deep link si se olvida cualquiera de los dos, falla en silencio.
      const msalCache = req.session.msalCache;
      const destino = destinoSeguro(req.session.destino || '/escarapela');
      req.session.regenerate((err) => {
        if (err) {
          console.error('[auth/redirect] regenerate', err);
          return res.redirect(aEscarapela('error'));
        }
        req.session.user = user;
        req.session.msalCache = msalCache;
        req.session.lastRevalidatedAt = Date.now();
        req.session.cookie.maxAge = SESSION_MAX_AGE_MS; // sale del TTL corto de pre-login
        req.session.save(() => {
          res.redirect(destino);
          // El correo de inscripción va DESPUÉS de responder: el redirect no espera a Graph, así
          // que quien entra ya está viendo su carné mientras el mensaje sale. El `.catch` no es
          // decorativo: `index.js` mata el proceso ante un rechazo sin manejar.
          if (inscribir) {
            enviarInscripcion({ oid, correo: upn, nombre: user.nombre_completo }).catch((e) =>
              console.error('[inscripcion] rechazo no manejado:', e.message),
            );
          }
        });
      });
    } catch (err) {
      console.error('[auth/redirect]', err);
      clearAuthTransients(req.session);
      req.session.save(() => res.redirect(aEscarapela('error')));
    }
  });

  // ── Identidad la ÚNICA superficie con sesión del sitio ────────────────────
  // `revalidate` vive solo aquí: con el contenido público, lo que la revocación en Entra debe
  // cortar es esta respuesta (la escarapela consulta al montar), no las navegaciones.
  // La respuesta es la MÍNIMA que la escarapela necesita: `tenantId`, `loginAt` y `via` se quedan
  // en la sesión (loginAt lo usa `estaAutenticado`), pero no tienen por qué viajar al navegador.
  app.get('/api/me', asyncH(revalidate), (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!estaAutenticado(req.session)) return res.status(401).json({ authenticated: false });
    const { nombre_completo, cargo, area, upn, email, oid, roles } = req.session.user;
    // `inscripcion` es estado del servidor, no una promesa de la interfaz: se lee del libro (en
    // memoria) y vale `no_aplica` siempre que el envío esté apagado o la persona quede fuera.
    res.json({
      authenticated: true,
      user: { nombre_completo, cargo, area, upn, email, oid, roles },
      inscripcion: estadoInscripcion(oid),
      // Como `inscripcion`: estado del servidor, no promesa. `no_aplica` cuando la función está
      // apagada, cuando la persona no asistió y cuando el oid no existe — a la interfaz le da
      // igual cuál de los tres, y a un curioso también debe darle igual.
      certificado: estadoCertificado(oid),
    });
  });

  // ── El certificado de participación: bytes pre-generados, SOLO del oid de la sesión ────────
  // No admite parámetros: no hay forma de pedir el de otro, ni de listar, ni de enumerar (la
  // regla de docs/EXPORTAR-INSCRITOS.md sobre «la peor puerta» se cumple por construcción).
  // `revalidate` va aquí igual que en /api/me: esto ES identidad —entrega un documento con
  // nombre y cédula—, y una sesión revocada en Entra no debe poder descargarlo.
  app.get('/api/certificado', asyncH(revalidate), (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!estaAutenticado(req.session)) return res.status(401).json({ authenticated: false });
    const ruta = rutaCertificado(req.session.user.oid);
    // La misma forma que el 404 genérico: la respuesta no distingue «no asististe» de «esto no
    // existe», que es exactamente lo que /api/me ya dice con `no_aplica`.
    if (!ruta) return res.status(404).json({ error: 'No encontrado', codigo: 'no_encontrado' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Certificado de participacion G-TALKS.pdf"');
    res.sendFile(ruta);
  });

  // ── Encuestas: estado público, de solo lectura ──────────────────────────────
  // La ÚNICA pieza del sitio que abre por reloj. No hay sesión ni cookie de por medio: es un
  // hecho público («¿ya cerró el evento?») más la URL del formulario, que se RETIENE hasta esa
  // hora la decisión vive en server/encuestas.js, no aquí—. `no-store` no es manía: una caché
  // compartida que guardara la respuesta «cerrada» seguiría negando la encuesta después de las 4.
  app.get('/api/encuestas', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(estadoEncuestas());
  });

  // ── Logout: destruye la cookie + front-channel a Microsoft ──────────────────
  app.get('/auth/logout', (req, res) => {
    const logoutUrl = getLogoutUrl();
    req.session.destroy(() => {
      res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
      res.redirect(logoutUrl);
    });
  });

  // ── SPA estática, pública ────────────────────────────────────────────────────
  if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    console.warn(`  ⚠  No existe ${DIST_DIR}\\index.html corre \`npm run build\` antes de servir en producción.`);
  }
  // `index: false` no es cosmético: sin él, serve-static respondería `GET /` por su cuenta y ese
  // HTML saldría SIN Content-Security-Policy (el setHeaders de aquí solo pone Cache-Control).
  // Con él, TODA navegaciónincluida la raíz— cae al fallback de abajo, que es la única puerta
  // por la que sale HTML y por tanto el único sitio donde la CSP tiene que estar bien.
  app.use(express.static(DIST_DIR, {
    index: false,
    setHeaders: (res, ruta) => {
      res.setHeader('Cache-Control', cacheDe('/' + path.relative(DIST_DIR, ruta).replace(/\\/g, '/')));
    },
  }));

  // Fallback SPA: solo para navegaciones. Un /no-existe.png pedido por un <img> cae al 404 JSON
  // en vez de recibir HTML con 200.
  app.use((req, res, next) => {
    if (!esNavegacion(req)) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', CSP_SPA);
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

  // Correo de inscripción. La línea dice el modo y CUÁNTOS destinatarios hay, nunca cuáles: esto
  // va a journald, que lee cualquiera con acceso al servidor.
  const ins = iniciarInscripcion();
  console.log(
    ins.modo === 'off'
      ? '  [inscripcion] envío DESACTIVADO (INSCRIPCION_MODO=off)'
      : `  [inscripcion] modo ${ins.modo}` +
        (ins.destinatarios === null ? ' · TODO el tenant' : ` · ${ins.destinatarios} destinatario(s)`) +
        ` · remitente ${ins.remitente || '(sin envío)'}` +
        ` · credenciales ${ins.credenciales}` +
        ` · libro ${ins.libro}` +
        ` · ya inscritos: ${JSON.stringify(ins.resumen)}`,
  );

  // Certificados: la línea dice CUÁNTOS hay, nunca quiénes (esto va a journald).
  const certs = iniciarCertificados();
  console.log(
    certs.activo
      ? `  [certificados] ${certs.personas} certificado(s) servibles desde ${certs.dir}`
      : '  [certificados] descarga DESACTIVADA (CERTIFICADOS_DIR vacío)',
  );

  return app;
}

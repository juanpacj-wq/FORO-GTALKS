/**
 * Configuración central del login con Microsoft Entra ID.
 *
 * El gate de acceso es la asignación a la Enterprise App ("Asignación requerida = Sí" +
 * usuarios/grupos asignados); aquí no hay roles de negocio ni allowlist local.
 *
 * Variables de entorno (ver .env.example):
 *   M365_TENANT_ID, M365_CLIENT_ID, M365_CLIENT_SECRET  — App Registration (cliente confidencial).
 *   M365_REDIRECT_URI, M365_POST_LOGOUT_REDIRECT_URI    — callbacks OIDC.
 *   M365_SCOPES                                         — scopes solicitados (incluye offline_access).
 *   PUBLIC_ORIGIN                                       — origen público, p. ej. https://gtalks.gecelca.com.co
 *   SESSION_*                                           — cookie y duraciones de sesión.
 *   AUTH_RATE_LIMIT                                     — dial del cortacircuitos de /auth/*.
 *   AUDIT_LOG_PATH                                      — registro de acceso (ver auth/auditoria.js).
 */

/** Origen público del sitio. Es la referencia del chequeo CSRF: una cabecera del propio request
 *  (`x-forwarded-host`) no sirve como definición de «mi host», porque el request la controla. */
export const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || '';

// En producción la cookie lleva el prefijo __Host-, que el navegador solo acepta con Secure, sin
// Domain y con Path=/ — las tres se cumplen. Sobre HTTP en dev el prefijo rompería, así que se
// deriva del entorno en vez de fijarse.
const NOMBRE_BASE = process.env.SESSION_COOKIE_NAME || 'puertadeoro.sid';
export const SESSION_COOKIE_NAME =
  process.env.NODE_ENV === 'production' ? `__Host-${NOMBRE_BASE}` : NOMBRE_BASE;

/** Inactividad. Con `rolling: true` se renueva en cada request: cubre una jornada completa con
 *  almuerzo largo y expira de noche. */
export const SESSION_MAX_AGE_MS = Number(process.env.SESSION_MAX_AGE_MS || 8 * 60 * 60 * 1000);

/** Vida ABSOLUTA desde el login, la que `rolling` no acota. Sin este tope, una pestaña abierta
 *  renueva la sesión indefinidamente. */
export const SESSION_VIDA_ABSOLUTA_MS =
  Number(process.env.SESSION_VIDA_ABSOLUTA_MS || 12 * 60 * 60 * 1000);

/** Sesión PRE-LOGIN (solo lleva PKCE/state/nonce). Vida corta: es lo que impide que golpear
 *  /auth/login llene el store con sesiones de larga vida. */
export const SESSION_PRELOGIN_MS = Number(process.env.SESSION_PRELOGIN_MS || 10 * 60 * 1000);

export const SESSION_COOKIE_SECURE =
  String(process.env.SESSION_COOKIE_SECURE).toLowerCase() === 'true';

/** Cortacircuitos de /auth/login y /auth/redirect, por ventana de 15 min y por IP. Es un DIAL:
 *  con NAT corporativo toda la sede comparte IP, así que el día del evento se sube. */
export const AUTH_RATE_LIMIT = Number(process.env.AUTH_RATE_LIMIT || 300);

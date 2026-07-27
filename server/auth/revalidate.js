/**
 * Revalidación silenciosa ("problema del egresado") — réplica de Bit-cora-g3 sin la parte de BD.
 *
 * La sesión de login (cookie Entra) puede durar días; si a alguien lo desasignan de la Enterprise
 * App o lo deshabilitan en Entra, su cookie seguiría válida hasta expirar. Este middleware, cada
 * REVALIDATE_INTERVAL_MS, usa el refresh token (offline_access) para re-pedir un token a Entra
 * EN SILENCIO:
 *   - Si Entra responde -> el usuario sigue con acceso; actualizamos sus roles actuales.
 *   - Si Entra rechaza por revocación (lo deshabilitaron / lo desasignaron) -> matamos la sesión.
 *   - Si Entra falla de forma transitoria (red/throttling) -> NO matamos al primer blip, pero
 *     llevamos un contador por sesión y, tras MAX_FALLOS_TRANSITORIOS consecutivos, cerramos
 *     fail-closed: dejamos de preservar indefinidamente una sesión que no podemos validar.
 *
 * Throttle por sesión (lastRevalidatedAt) para no pegarle a Entra en cada request. Se monta
 * global (el sitio completo está detrás del gate), así la revocación corta también la navegación.
 */
import path from 'node:path';
import { refreshSilently } from './m365.js';
import { detectRoles } from './roles.js';
import { registrarAcceso } from './auditoria.js';

export const REVALIDATE_INTERVAL_MS = Number(process.env.REVALIDATE_INTERVAL_MS || 20 * 60 * 1000);

// Fail-closed acotado: tras N errores transitorios CONSECUTIVOS para una misma sesión dejamos de
// fallar-abierto y la invalidamos. Un blip aislado (1-2) sigue preservando la sesión.
export const MAX_FALLOS_TRANSITORIOS = Number(process.env.REVALIDATE_MAX_FALLOS || 3);

// Contador de fallos transitorios consecutivos por sesión (req.sessionID). En memoria del proceso
// es suficiente: si el proceso se reinicia, la cookie igual se re-revalida contra Entra. Se borra
// la entrada ante cualquier desenlace terminal (éxito, kill) para que el Map no crezca sin techo.
const fallosTransitorios = new Map();

/**
 * ¿El error del refresh significa que Entra REVOCÓ el acceso (hay que matar la sesión),
 * o es transitorio (red/Entra caído/throttling) y NO debemos desloguear de inmediato?
 * Solo destruimos ante señales claras de revocación; ante lo demás, contamos y reintentamos.
 */
function isRevocation(err) {
  if (!err) return false;
  if (err.message === 'sin_cuenta_en_cache') return true;           // no hay refresh token/cuenta
  if (err.name === 'InteractionRequiredAuthError') return true;     // el refresh ya no sirve -> re-login
  const code = String(err.errorCode || '');
  if (['invalid_grant', 'interaction_required', 'no_tokens_found', 'no_account_in_silent_request'].includes(code)) return true;
  // Códigos AADSTS de revocación/expiración/desasignación explícita:
  return /AADSTS(50173|700082|700084|50105|50076|50078|50079|65001)/.test(String(err.message || ''));
}

/**
 * Registra un fallo transitorio para una sesión y devuelve el conteo CONSECUTIVO acumulado.
 * PURA respecto del Map que se le pasa (el caller decide si alcanzó el umbral).
 */
export function contarFallo(map, sessionId) {
  const n = (map.get(sessionId) || 0) + 1;
  map.set(sessionId, n);
  return n;
}

// ¿El request es una navegación de página (y no un fetch de asset/API)? Decide el formato de la
// respuesta al matar la sesión: redirect a la pantalla de login vs 401 JSON.
function esNavegacionHtml(req) {
  return req.method === 'GET' && !path.extname(req.path) && !req.path.startsWith('/api/');
}

/**
 * Mata la sesión de login: destruye la cookie y, según el tipo de request, redirige a la pantalla
 * de login (navegación) o responde 401 (API/asset). Sin BD que desactivar en este sitio.
 */
function matarSesion(req, res, reason) {
  fallosTransitorios.delete(req.sessionID);
  return req.session.destroy(() => {
    if (esNavegacionHtml(req)) return res.redirect(`/?auth=${reason}`);
    res.status(401).json({ authenticated: false, reason });
  });
}

export async function revalidate(req, res, next) {
  if (!req.session?.user) return next(); // sin sesión: lo resuelve el gate de la ruta

  const last = req.session.lastRevalidatedAt || 0;
  if (Date.now() - last < REVALIDATE_INTERVAL_MS) return next(); // dentro de la ventana: no revalida

  const sid = req.sessionID;
  try {
    const result = await refreshSilently(req.session);
    req.session.user.roles = detectRoles(result.idTokenClaims || {});
    req.session.lastRevalidatedAt = Date.now();
    fallosTransitorios.delete(sid); // revalidación OK -> resetea el contador fail-closed
    return next();
  } catch (err) {
    // En los logs de operación va el `oid`, que es seudónimo, y no el UPN: el correo corporativo
    // solo tiene función de auditoría en el registro de acceso (auth/auditoria.js), no regado por
    // los logs del sistema, que lee cualquiera con acceso al servidor.
    const quien = req.session.user.oid || '(sin oid)';
    if (isRevocation(err)) {
      console.warn(`[revalidate] acceso REVOCADO para oid=${quien}: ${err.errorCode || err.message}`);
      registrarAcceso({ resultado: 'revocada', oid: req.session.user.oid, upn: req.session.user.upn });
      return matarSesion(req, res, 'sesion_revocada');
    }
    // Transitorio (red/Entra caído/throttling): fail-closed acotado. NO tocamos lastRevalidatedAt
    // (reintenta en el próximo request). Tras MAX_FALLOS_TRANSITORIOS consecutivos, cerramos.
    const fallos = contarFallo(fallosTransitorios, sid);
    if (fallos >= MAX_FALLOS_TRANSITORIOS) {
      console.warn(`[revalidate] ${fallos} fallos transitorios consecutivos para oid=${quien} -> fail-closed, invalido sesión`);
      registrarAcceso({ resultado: 'revalidacion_fallida', oid: req.session.user.oid, upn: req.session.user.upn });
      return matarSesion(req, res, 'revalidacion_fallida');
    }
    console.warn(`[revalidate] error transitorio (${fallos}/${MAX_FALLOS_TRANSITORIOS}) para oid=${quien} (sesión preservada): ${err.errorCode || err.message}`);
    return next();
  }
}

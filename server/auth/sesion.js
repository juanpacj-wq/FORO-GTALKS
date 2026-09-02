/**
 * El predicado ÚNICO de sesión válida.
 *
 * Vivía en app.js; se movió aquí cuando la carta de presentación necesitó guardias de sesión y
 * de rol (auth/guardias.js) que app.js también importa. Dejarlo en app.js habría creado un
 * import circular app.js → guardias.js → app.js, y esta función no depende de nada de la app:
 * solo de la configuración de la sesión. app.js lo sigue re-exportando para no mover a nadie.
 *
 * Lo usan el gate, /api/me, la revalidación y los guardias. Antes había dos predicados distintos
 * (`session.user` vs `session.user.oid`) y una sesión con `oid` vacío era «autenticada» para
 * /api/me y rechazada por el gate.
 *
 * Incluye la vida ABSOLUTA: con `rolling: true` no existe tope superior, y una pestaña abierta
 * renovaría la sesión indefinidamente.
 */
import { SESSION_VIDA_ABSOLUTA_MS } from './entra-config.js';

export function estaAutenticado(sess) {
  const u = sess?.user;
  if (!u?.oid) return false;
  const inicio = Date.parse(u.loginAt || '');
  if (Number.isFinite(inicio) && Date.now() - inicio > SESSION_VIDA_ABSOLUTA_MS) return false;
  return true;
}

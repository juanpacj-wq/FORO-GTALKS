/**
 * Guardias de sesión y de rol para las rutas que los necesiten.
 *
 * Hasta la carta de presentación el sitio no tenía ninguna ruta «solo para quien tenga el rol
 * X»: la única superficie con sesión era la identidad misma (/api/me, /api/certificado), y
 * cada una comprobaba `estaAutenticado` en línea. El panel de /cdpadmin exige además un App
 * Role de Entra, así que las dos comprobaciones se sacan a middlewares reutilizables.
 *
 * Decisiones que no son obvias:
 *
 * - `requiereRol` es AFIRMATIVO: pasa solo si `roles` es un array y contiene el rol pedido.
 *   Un `roles` ausente, `null`, o un string suelto («LOGIN_JEFA» como cadena en vez de
 *   `['LOGIN_JEFA']`) es 403, nunca 200 por omisión. `detectRoles` ya normaliza a array al
 *   entrar, así que un string aquí solo puede ser una sesión corrupta y se trata como tal.
 * - `soloRol` empieza por `revalidate`: la revocación en Entra (quitar el rol, desasignar de la
 *   Enterprise App) tiene que cortar el panel en a lo sumo REVALIDATE_INTERVAL_MS, igual que
 *   corta /api/me. Sin él, una cookie viva seguiría administrando con un rol que ya no tiene.
 * - El 401 tiene la MISMA forma que el de /api/me (`{authenticated:false}`): la interfaz ya
 *   sabe leerlo y no hay que enseñarle un segundo formato.
 * - Los tres son síncronos salvo `revalidate`, que va envuelto en `asyncH` para que un throw
 *   suyo aterrice en el error-handler y no en un rechazo sin manejar (index.js mata el proceso
 *   ante uno de esos).
 */
import { revalidate } from './revalidate.js';
import { estaAutenticado } from './sesion.js';

/** Envuelve un handler async y enruta el throw al error-handler de Express. */
export const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function requiereSesion(req, res, next) {
  if (estaAutenticado(req.session)) return next();
  res.setHeader('Cache-Control', 'no-store');
  return res.status(401).json({ authenticated: false });
}

export const requiereRol = (rol) => (req, res, next) => {
  const roles = req.session?.user?.roles;
  if (Array.isArray(roles) && roles.includes(rol)) return next(); // afirmativo, nunca por omisión
  res.setHeader('Cache-Control', 'no-store');
  return res.status(403).json({ error: 'Sin permiso', codigo: 'sin_rol' });
};

/** La cadena completa para una ruta de administración: revalidar → sesión → rol. */
export const soloRol = (rol) => [asyncH(revalidate), requiereSesion, requiereRol(rol)];

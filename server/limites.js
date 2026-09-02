/**
 * Cortacircuitos por IP y ventana de 15 minutos.
 *
 * Era el `limitador` local de buildAuthApp (solo para /auth/login y /auth/redirect). La carta de
 * presentación necesita tres más, con diales propios (CARTA_RATE_*), así que la fábrica se saca
 * aquí y cada consumidor le pasa su nombre y su límite.
 *
 * NO es una política de seguridad: con NAT corporativo, un límite que tolere las ~300 llegadas
 * simultáneas de la sede no detiene a nadie decidido. Sirve para cortar un bucle desbocado o un
 * cliente roto. El nombre va al log para saber cuál se agotó, y la IP es la que pone
 * `trust proxy: 'loopback'` (la real detrás de nginx, no la de nginx).
 */
import rateLimit from 'express-rate-limit';

export function crearLimitador({ nombre, limite, ventanaMs = 15 * 60 * 1000 }) {
  return rateLimit({
    windowMs: ventanaMs,
    limit: limite,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      console.warn(`[rate-limit] ${nombre} agotado desde ${req.ip}`);
      res.setHeader('Cache-Control', 'no-store');
      res.status(429).json({ error: 'Demasiados intentos', codigo: 'demasiados_intentos' });
    },
  });
}

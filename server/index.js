/**
 * Bootstrap del servidor con gate Entra ID.
 *
 * Escucha SOLO en loopback: quien llegue a la máquina no puede hablar con el proceso sin pasar
 * por nginx. Va emparejado con `trust proxy: 'loopback'` en app.js sin ese par, cualquiera que
 * alcanzara el puerto podría falsificar `X-Forwarded-Proto` (y conseguir que Express fije la
 * cookie `Secure` sobre HTTP en claro) o `X-Forwarded-For` (evadir límites, envenenar logs).
 *
 * Entorno: en el servidor lo inyecta systemd con EnvironmentFile=/etc/gtalks/env; en desarrollo,
 * `npm run dev:auth` lo carga con `node --env-file=.env`.
 */
import { buildAuthApp } from './app.js';
import { leerConfiguracion } from './correo/inscripcion.js';
import { leerConfiguracionCarta } from './carta/config.js';
import { cerrarCarta } from './carta/index.js';

const PORT = Number(process.env.SERVER_PORT || 3000);
const HOST = process.env.SERVER_HOST || '127.0.0.1';
const esProduccion = process.env.NODE_ENV === 'production';

/**
 * Falla temprano y con nombre propio. Antes solo abortaba si faltaba SESSION_SECRET: sin
 * M365_CLIENT_SECRET el proceso arrancaba feliz y /auth/login devolvía 503, que la mañana del
 * evento se lee como «el sitio está caído» y no como «falta una variable».
 */
function exigirEntorno() {
  const requeridas = [
    'M365_TENANT_ID', 'M365_CLIENT_ID', 'M365_CLIENT_SECRET',
    'M365_REDIRECT_URI', 'SESSION_SECRET', 'PUBLIC_ORIGIN',
  ];
  const faltan = requeridas.filter((k) => !process.env[k]);
  if (faltan.length) {
    throw new Error(
      `Faltan variables de entorno obligatorias: ${faltan.join(', ')}.\n` +
      '  En el servidor van en /etc/gtalks/env (EnvironmentFile de systemd), no en un .env del repo.'
    );
  }

  // El desajuste entre PUBLIC_ORIGIN y el redirect URI es el clásico AADSTS50011, y se descubre
  // en mitad del despliegue. Aquí cuesta una línea detectarlo.
  const origen = process.env.PUBLIC_ORIGIN;
  const redirect = process.env.M365_REDIRECT_URI;
  if (!origen.startsWith('https://')) {
    throw new Error(`PUBLIC_ORIGIN debe ser https:// en producción (recibido: ${origen}).`);
  }
  if (!redirect.startsWith(origen)) {
    throw new Error(
      `M365_REDIRECT_URI (${redirect}) no empieza por PUBLIC_ORIGIN (${origen}). ` +
      'Entra exige coincidencia exacta con lo registrado en el App Registration.'
    );
  }

  // El correo de inscripción. En producción, una configuración a medias ABORTA en vez de
  // degradarse a `off` en silencio: `deploy/deploy.sh` revierte solo si el servicio no levanta,
  // así que el error se ve en el despliegue y no la mañana del foro. En desarrollo el módulo
  // avisa y se apaga (ver correo/inscripcion.js).
  const correo = leerConfiguracion();
  if (correo.problemas.length) {
    throw new Error(
      'Configuración del correo de inscripción incompleta:\n' +
      correo.problemas.map((p) => `    · ${p}`).join('\n') +
      '\n  Con INSCRIPCION_MODO=off el resto del bloque no hace falta.'
    );
  }

  // La carta de presentación: misma doctrina. Las cinco DB_* vacías = el módulo no existe;
  // a medias, o con un valor que no vale = se aborta AQUÍ, en el despliegue, y deploy.sh
  // revierte. Que la BD responda y que el esquema esté al día se comprueba después, al
  // arrancar (server/carta/index.js), porque exige red.
  const carta = leerConfiguracionCarta();
  if (carta.problemas.length) {
    throw new Error(
      'Configuración de la carta de presentación incompleta:\n' +
      carta.problemas.map((p) => `    · ${p}`).join('\n') +
      '\n  Con las cinco DB_* vacías el módulo no existe y el resto del bloque no hace falta.'
    );
  }
}

if (esProduccion) exigirEntorno();

const app = buildAuthApp();
const server = app.listen(PORT, HOST, () => {
  console.log(`1° Foro GECELCA «G-TALKS» (con gate Entra ID) escuchando en http://${HOST}:${PORT}`);
});

// Apagado ordenado: systemd manda SIGTERM en cada `restart`. Sin esto, las peticiones en vuelo se
// cortan a media respuesta.
function apagar(senal) {
  console.log(`\n  ▸ ${senal} recibido cerrando conexiones…`);
  cerrarCarta().catch(() => {}); // el pool del SQL Server, si lo hay
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref(); // si algo se cuelga, no bloquear el reinicio
}
process.on('SIGTERM', () => apagar('SIGTERM'));
process.on('SIGINT', () => apagar('SIGINT'));

// Un rechazo sin manejar deja el proceso en estado indeterminado: se registra y se sale con código
// ≠0 para que systemd lo reinicie limpio, en vez de seguir sirviendo desde un estado roto.
process.on('unhandledRejection', (err) => {
  console.error('[fatal] promesa rechazada sin manejar:', err);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('[fatal] excepción no capturada:', err);
  process.exit(1);
});

/**
 * El correo de inscripción: la política y la orquestación.
 *
 * Es la única pieza que conoce las reglas de negocio. Debajo tiene tres módulos con una sola
 * responsabilidad cada uno `libro-inscripciones.js` (idempotencia), `graph-mailer.js`
 * (transporte) y `plantilla-inscripcion.js` (contenido), y por encima solo la expone
 * `server/app.js` con tres funciones.
 *
 * ── La decisión, en orden ────────────────────────────────────────────────────
 *
 *   1. modo `off`                        → nada
 *   2. modo `lista` y el correo no está  → nada, y NO se escribe en el libro (ver abajo)
 *   3. el libro ya tiene ese `oid`       → nada (ya se le escribió, o hay un envío en curso)
 *   4. modo `simulacro`                  → se anota `simulado`, sin tocar la red
 *   5. resto                             → se envía y se anota el desenlace
 *
 * **Quien queda fuera de la lista no deja línea en el libro.** Es deliberado: cuando la lista se
 * amplíe (o se pase a `todos`), esas personas siguen contando como no inscritas y reciben su
 * correo en su siguiente inicio de sesión. Si se anotaran como «omitidas», abrir la lista no
 * serviría de nada y el fallo sería silencioso.
 *
 * ── Dos llaves para abrir el envío masivo, no una ────────────────────────────
 * Pasar de tres personas a todo el mundo exige cambiar `INSCRIPCION_MODO` **y** vaciar
 * `INSCRIPCION_DESTINATARIOS`: con las dos puestas a la vez, el arranque lo trata como error de
 * configuración y apaga el envío. Ninguna errata de una sola variable puede escribirle al tenant
 * entero.
 *
 * ── Por qué el destinatario no puede desviarse ───────────────────────────────
 * La lista se comprueba en DOS sitios y el destino sale de un TERCERO:
 *
 *   · `reservar()`   comprueba la lista antes de anotar nada.
 *   · `enviar()`     la vuelve a comprobar justo antes de construir el mensaje. No es redundancia
 *                    ociosa: entre las dos llamadas hay un redirect y un llamador externo
 *                    (`server/app.js`), y el destino viaja por parámetro. Sin esta segunda
 *                    comprobación, la garantía sería una convención entre dos funciones.
 *   · `destinoAutorizado()` devuelve **la entrada de la configuración**, no la cadena que llegó
 *                    en el token: en modo `lista`, la dirección a la que sale el correo está
 *                    literalmente escrita en `INSCRIPCION_DESTINATARIOS`.
 *
 * Y por debajo, `graph-mailer.js` se niega a enviar a cualquier cosa que no sea UNA dirección.
 * Lo comprueba `scripts/inscripcion-test.mjs` contra una población de identidades hostiles.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { crearLibro } from './libro-inscripciones.js';
import { crearMailer, crearProveedorDeToken } from './graph-mailer.js';
import { componerInscripcion, cargarImagenCorreo } from './plantilla-inscripcion.js';
import { cargarEvento } from './evento.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const MODOS = ['off', 'simulacro', 'lista', 'todos'];

/** En producción lo fija `INSCRIPCION_LIBRO` (`/var/lib/gtalks/…`, ver el unit de systemd). */
const LIBRO_POR_DEFECTO = path.resolve(__dirname, '..', '..', '.datos', 'inscripciones.jsonl');

/** Normaliza un correo para comparar: los espacios y las mayúsculas no distinguen a nadie. */
const norm = (correo) => String(correo || '').trim().toLowerCase();

/**
 * Forma mínima de una dirección: exactamente una arroba y ningún carácter que pudiera significar
 * «aquí hay más de un destinatario» (coma, punto y coma, espacio, ángulos, comillas).
 *
 * No pretende validar correos según el RFC: pretende que una entrada mal escrita en
 * `INSCRIPCION_DESTINATARIOS` sea un ERROR RUIDOSO y no una lista silenciosamente inútil. El caso
 * real que cierra: separar con `;` en vez de `,` produciría una única entrada
 * «a@x.com;b@x.com» que no coincide con nadie, y el envío parecería configurado sin serlo.
 */
const DIRECCION = /^[^\s@,;:<>"'()[\]\\]+@[^\s@,;:<>"'()[\]\\]+\.[^\s@,;:<>"'()[\]\\]+$/;

/**
 * Lee el entorno y devuelve la configuración junto con sus problemas. No lanza: quien llama
 * decide si aborta (producción, vía `exigirEntorno`) o si degrada a `off` con un aviso (dev).
 */
export function leerConfiguracion(env = process.env) {
  const modo = String(env.INSCRIPCION_MODO || 'off').trim().toLowerCase();
  const anotados = String(env.INSCRIPCION_DESTINATARIOS || '')
    .split(',')
    .map(norm)
    .filter(Boolean);
  const destinatarios = anotados.filter((d) => DIRECCION.test(d));
  const remitente = norm(env.INSCRIPCION_REMITENTE);
  const origen = String(env.PUBLIC_ORIGIN || '').replace(/\/+$/, '');

  // El ensayo NUNCA escribe en el libro real. Si lo hiciera, los `oid` del simulacro quedarían
  // marcados y, al pasar a `lista`, esas mismas personas las que hicieron el ensayo NO
  // recibirían el correo de verdad, porque ya constarían como atendidas. El sufijo lo hace
  // imposible por construcción, en vez de confiar en que alguien se acuerde de borrar el archivo.
  const libroBase = env.INSCRIPCION_LIBRO || LIBRO_POR_DEFECTO;
  const libro = modo === 'simulacro' ? `${libroBase}.simulacro` : libroBase;

  const problemas = [];

  // ── Credenciales del envío ────────────────────────────────────────────────
  // Si no hay bloque `MAIL_*`, se reutiliza el del login. Hoy es la MISMA App Registration, y
  // duplicar los tres valores en el entorno significaría que rotar el secreto en un sitio y
  // olvidarlo en el otro rompiera el correo en silencio, con el login intacto y nadie mirando.
  //
  // El respaldo es TODO o NADA: un `MAIL_*` suelto (un client id nuevo con el secreto viejo) es
  // un error de configuración, no una mezcla que haya que adivinar. Si algún día se separa la app
  // del correo, se ponen las tres y este bloque deja de mirar a `M365_*`.
  const CLAVES_MAIL = ['MAIL_TENANT_ID', 'MAIL_CLIENT_ID', 'MAIL_CLIENT_SECRET'];
  const puestas = CLAVES_MAIL.filter((k) => env[k]);
  let graph;
  let credenciales;
  if (puestas.length === CLAVES_MAIL.length) {
    graph = { tenantId: env.MAIL_TENANT_ID, clientId: env.MAIL_CLIENT_ID, clientSecret: env.MAIL_CLIENT_SECRET };
    credenciales = 'MAIL_* (app propia del correo)';
  } else if (puestas.length === 0) {
    graph = {
      tenantId: env.M365_TENANT_ID || '',
      clientId: env.M365_CLIENT_ID || '',
      clientSecret: env.M365_CLIENT_SECRET || '',
    };
    credenciales = 'M365_* (la MISMA app del login)';
  } else {
    graph = { tenantId: '', clientId: '', clientSecret: '' };
    credenciales = '(bloque a medias)';
    problemas.push(
      `el bloque MAIL_* está a medias (solo ${puestas.join(', ')}): ponlas las tres, para usar una ` +
      'app propia, o ninguna, para reutilizar la del login. A medias mezclaría credenciales.',
    );
  }

  if (!MODOS.includes(modo)) {
    problemas.push(`INSCRIPCION_MODO=«${modo}» no existe (usa ${MODOS.join(', ')})`);
  }
  if (modo !== 'off') {
    if (!origen) problemas.push('falta PUBLIC_ORIGIN (el correo enlaza a /escarapela)');

    // Una entrada mal escrita no puede pasar en silencio: la lista es el control que limita a
    // quién le llega el correo, y una lista que «no coincide con nadie» se parece demasiado a una
    // que funciona.
    const invalidas = anotados.filter((d) => !DIRECCION.test(d));
    if (invalidas.length) {
      problemas.push(
        `INSCRIPCION_DESTINATARIOS tiene ${invalidas.length} entrada(s) que no son direcciones: ` +
        `«${invalidas.join('», «')}». Se separan con COMAS, una dirección por entrada.`,
      );
    }

    // `simulacro` aplica la MISMA lista blanca que `lista`: es el modo de ensayo de esa
    // configuración, no un modo distinto. Sin lista no reservaría a nadie y el ensayo no probaría
    // nada, así que se trata como error de configuración y no como silencio.
    if ((modo === 'lista' || modo === 'simulacro') && !destinatarios.length) {
      problemas.push(`INSCRIPCION_MODO=${modo} sin INSCRIPCION_DESTINATARIOS: no recibiría nadie`);
    }

    // Las DOS llaves, hechas cumplir. En `todos` la lista no limita nada, así que dejarla puesta
    // es casi siempre una confusión: alguien cambió el modo creyendo que la lista seguía
    // acotando, y le acaba de escribir a todo el que inicie sesión. Se exige vaciarla, que es el
    // gesto explícito de decir «sí, a cualquiera».
    if (modo === 'todos' && destinatarios.length) {
      problemas.push(
        'INSCRIPCION_MODO=todos con INSCRIPCION_DESTINATARIOS puesta: en modo `todos` la lista NO ' +
        'limita nada. Vacíala para confirmar que quieres escribirle a cualquiera que inicie ' +
        'sesión, o vuelve a INSCRIPCION_MODO=lista.',
      );
    }
  }
  if (modo === 'lista' || modo === 'todos') {
    if (!DIRECCION.test(remitente)) {
      problemas.push('INSCRIPCION_REMITENTE debe ser UN buzón del tenant (una sola dirección)');
    }
    if (!graph.tenantId || !graph.clientId || !graph.clientSecret) {
      problemas.push(
        'faltan credenciales para enviar: pon MAIL_TENANT_ID / MAIL_CLIENT_ID / MAIL_CLIENT_SECRET, ' +
        'o deja el bloque vacío y ten configuradas las M365_* del login',
      );
    }
  }

  return { modo, destinatarios, remitente, origen, libro, graph, credenciales, problemas };
}

// ── Estado del módulo ────────────────────────────────────────────────────────
// Sin `iniciar()`, todo es no-op: `npm run preview` y los scripts de verificación sirven `dist/`
// sin identidad, y ahí esto no debe existir.
let cfg = null;
let libro = null;
let mailer = null;
let evento = null;
let imagen = null;

/**
 * Arranca el módulo. Idempotente. Devuelve un resumen para la línea de arranque.
 * @param {object} [opciones.mailer]  inyectable: las pruebas pasan un Graph falso
 */
export function iniciarInscripcion({ env = process.env, mailer: mailerInyectado } = {}) {
  const conf = leerConfiguracion(env);

  if (conf.problemas.length) {
    console.warn(
      `  ⚠  [inscripcion] configuración incompleta, se desactiva el envío:\n` +
      conf.problemas.map((p) => `       · ${p}`).join('\n'),
    );
    cfg = { ...conf, modo: 'off' };
    return { modo: 'off', destinatarios: 0 };
  }

  cfg = conf;
  if (cfg.modo === 'off') return { modo: 'off', destinatarios: 0 };

  // El contenido del evento, la pieza del correo y el libro son requisitos del ENVÍO, no del
  // sitio. Si fallan, se apaga el correo y se sigue sirviendo: el foro es público y tumbarlo
  // entero porque a `evento.json` le falte la sede sería desproporcionado. El aviso es ruidoso
  // a propósito.
  try {
    evento = cargarEvento();
    imagen = cargarImagenCorreo();
    libro = crearLibro(cfg.libro);
    libro.cargar();
  } catch (err) {
    console.error(`  ⚠  [inscripcion] no se pudo arrancar el envío, queda DESACTIVADO: ${err.message}`);
    cfg = { ...conf, modo: 'off' };
    libro = null;
    imagen = null;
    return { modo: 'off', destinatarios: 0 };
  }

  if (cfg.modo !== 'simulacro') {
    mailer =
      mailerInyectado ||
      crearMailer({ obtenerToken: crearProveedorDeToken(cfg.graph) });
  } else {
    mailer = mailerInyectado || null;
  }

  // Nunca se listan los destinatarios, solo cuántos son: son datos personales y esta línea va a
  // journald, que lee cualquiera con acceso al servidor.
  return {
    modo: cfg.modo,
    // `null` significa «todo el tenant»; un número, el tamaño de la lista blanca.
    destinatarios: cfg.modo === 'todos' ? null : cfg.destinatarios.length,
    remitente: cfg.remitente || null,
    // De qué app salen las credenciales. Va al arranque a propósito: que la app por la que todo
    // el mundo inicia sesión sea además la que manda correo es una decisión que tiene que
    // quedar dicha en los logs, no deducirse leyendo el .env.
    credenciales: cfg.credenciales,
    libro: cfg.libro,
    resumen: libro.resumen(),
  };
}

/** Solo para las pruebas: devuelve el módulo a su estado de reposo. */
export function _reiniciar() {
  cfg = null;
  libro = null;
  mailer = null;
  evento = null;
  imagen = null;
}

/**
 * La dirección a la que se puede enviar, o `null` si no se puede.
 *
 * **En modo `lista` devuelve LA ENTRADA DE LA CONFIGURACIÓN con la que coincidió, no la cadena
 * que llegó en el token.** Es la diferencia entre «comprobamos que se parece a una autorizada» y
 * «la dirección de destino sale del entorno del servidor». Con esto, en modo `lista` el correo no
 * puede salir hacia ninguna cadena que no esté escrita en `INSCRIPCION_DESTINATARIOS`: no hay
 * normalización, codificación ni homógrafo que produzca una dirección distinta, porque la
 * dirección no se construye a partir de la entrada.
 *
 * En modo `todos` no hay lista contra la que casar, así que se envía a la propia dirección de la
 * sesión, exigiéndole al menos la forma de una única dirección.
 */
function destinoAutorizado(correo) {
  const n = norm(correo);
  if (!n) return null;
  if (cfg.modo === 'todos') return DIRECCION.test(n) ? n : null;
  return cfg.destinatarios.find((d) => d === n) || null;
}

/**
 * Paso 1, SÍNCRONO: ¿le toca correo a esta persona? Se llama dentro del callback OIDC, donde la
 * identidad ya está validada. Es síncrono porque ahí es donde se cierra la carrera de dos
 * pestañas iniciando sesión a la vez.
 *
 * @returns {boolean} `true` si hay que enviar; el llamador dispara `enviarInscripcion` después.
 */
export function reservarInscripcion({ oid, correo }) {
  if (!cfg || cfg.modo === 'off' || !libro) return false;
  if (!oid) return false;
  if (!destinoAutorizado(correo)) return false; // sin línea en el libro: ver la cabecera
  return libro.reservar(oid);
}

/**
 * Paso 2, ASÍNCRONO: envía y anota el desenlace. Se dispara DESPUÉS de que la respuesta del
 * callback haya salido, así que el redirect nunca espera a Graph.
 *
 * No lanza nunca. Un fallo de correo no puede alterar el inicio de sesión de nadie: es el mismo
 * criterio de degradación suave que `obtenerPerfil` en `auth/m365.js`.
 */
export async function enviarInscripcion({ oid, correo }) {
  if (!cfg || cfg.modo === 'off' || !libro) return;

  try {
    // ── Guardia 1: solo se actúa sobre una reserva VIVA ──────────────────────
    // Dos llamadas para el mismo `oid` no pueden convertirse en dos correos, venga la segunda de
    // donde venga (un llamador duplicado, un reintento a mano, un futuro cambio en app.js). Va
    // ANTES que la guardia de destino a propósito: si el estado ya fuera `enviado`, marcarlo
    // `fallido` borraría el registro de un envío que sí ocurrió.
    const previo = libro.estado(oid);
    if (previo?.estado !== 'reservado') {
      console.warn(
        `[inscripcion] ignorado: oid=${oid} no tiene reserva viva (estado=${previo?.estado ?? 'ninguno'})`,
      );
      return;
    }

    // ── Guardia 2: el destino, comprobado OTRA VEZ y aquí ────────────────────
    // La lista blanca ya se comprobó en `reservar`, pero entre las dos llamadas hay un redirect y
    // un llamador externo (`server/app.js`), y el destino llega por parámetro. Que hoy sea la
    // misma variable en ambas es cierto y es una CONVENCIÓN; esta línea lo convierte en
    // estructura: el correo no puede salir hacia una dirección que no esté en la lista, aunque
    // alguien cambie el llamador. Si alguna vez se dispara, es un fallo grave y grita como tal.
    const destino = destinoAutorizado(correo);
    if (!destino) {
      libro.resolver(oid, 'fallido', { motivo: 'destino_no_autorizado' });
      console.error(
        `[inscripcion] BLOQUEADO: el destino de oid=${oid} no está en la lista. NO se envió nada. ` +
        'Esto significa que el destino cambió entre la reserva y el envío: revisa server/app.js.',
      );
      return;
    }

    if (cfg.modo === 'simulacro') {
      libro.resolver(oid, 'simulado');
      console.log(`[inscripcion] simulacro: correo NO enviado para oid=${oid}`);
      return;
    }

    const { asunto, html, adjuntos } = componerInscripcion({ evento, url: cfg.origen, imagen });
    const r = await mailer.enviar({
      remitente: cfg.remitente,
      // `destino`, no `correo`: en modo `lista` es la entrada de la configuración, no la cadena
      // que llegó en el token. Ver `destinoAutorizado`.
      para: destino,
      asunto,
      html,
      adjuntos,
    });

    if (r.ok) {
      libro.resolver(oid, 'enviado', { peticion: r.peticion, http: r.http });
      console.log(`[inscripcion] enviado oid=${oid} peticion=${r.peticion}`);
    } else {
      libro.resolver(oid, 'fallido', { peticion: r.peticion, http: r.http, motivo: r.motivo });
      console.warn(`[inscripcion] FALLÓ oid=${oid} peticion=${r.peticion} motivo=${r.motivo}`);
    }
  } catch (err) {
    // Cinturón: si algo se rompe fuera de lo previsto, queda anotado y el login sigue intacto.
    libro.resolver(oid, 'fallido', { motivo: err.message });
    console.error(`[inscripcion] error inesperado para oid=${oid}: ${err.message}`);
  }
}

/**
 * Lo que `/api/me` le cuenta al navegador. `no_aplica` cubre a la vez «no configurado», «fuera de
 * la lista» y «simulacro»: el frontend no puede distinguirlos, y así debe ser.
 *
 * `simulado` NO se reporta como `enviado` a propósito: la interfaz jamás anuncia un correo que no
 * salió. Los tres estados de la interfaz se prueban con `/api/me` simulado en `sesion-test.mjs`.
 */
export function estadoInscripcion(oid) {
  if (!cfg || cfg.modo === 'off' || !libro || !oid) return { estado: 'no_aplica' };
  const r = libro.estado(oid);
  if (!r) return { estado: 'no_aplica' };
  if (r.estado === 'enviado') return { estado: 'enviado', ts: r.ts };
  if (r.estado === 'fallido') return { estado: 'fallido', ts: r.ts };
  if (r.estado === 'reservado') return { estado: 'pendiente' };
  return { estado: 'no_aplica' };
}

/** Para diagnóstico desde el arranque y las pruebas. */
export function _libro() {
  return libro;
}

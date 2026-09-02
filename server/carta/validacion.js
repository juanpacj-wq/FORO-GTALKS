/**
 * Validación del perfil de una carta de presentación. PURA: sin BD, sin red, sin `req`.
 *
 * Rechaza, no sanea. Cada campo que no vale devuelve un CÓDIGO (`obligatorio`, `demasiado_largo`,
 * `formato`, `caracteres_no_permitidos`, `dominio_no_permitido`, `solo_https`), y la interfaz
 * los traduce a texto junto al campo. Lo único que se normaliza es lo que no cambia el dato:
 * recortar espacios, colapsar los repetidos, pasar el correo a minúsculas y el teléfono a E.164.
 *
 * Las redes sociales van ACOTADAS POR DOMINIO: `linkedin` solo admite linkedin.com o un
 * subdominio suyo, siempre https, sin userinfo (`https://x.com@evil.com` resuelve a evil.com y
 * el hostname lo delata), sin fragmento. Lo que se guarda es `url.href` ya normalizado.
 */

export const LIMITES = {
  nombres: 80,
  apellidos: 80,
  cargo: 120,
  area: 120,
  correo: 254,
  telefono: 20,
  red: 200,
};

/** Las siete redes y los dominios que cada una admite (el propio o cualquier subdominio). */
export const REDES = {
  linkedin: ['linkedin.com'],
  instagram: ['instagram.com'],
  x: ['x.com', 'twitter.com'],
  facebook: ['facebook.com', 'fb.com'],
  youtube: ['youtube.com', 'youtu.be'],
  tiktok: ['tiktok.com'],
};

const NOMBRE = /^[\p{L}\p{M}' .-]+$/u;
const CARGO = /^[\p{L}\p{M}\p{N}&,.()'/ -]+$/u;
const CORREO = /^[a-z0-9](?:[a-z0-9._%+-]*[a-z0-9])?@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const E164 = /^\+[1-9]\d{6,14}$/;
// Controles ASCII (incluido DEL) y los dos ángulos: ningún campo de la tarjeta los necesita, y
// rechazarlos aquí es lo que hace que ni la vCard ni el Open Graph tengan que pensar en HTML.
// eslint-disable-next-line no-control-regex
const CONTROLES = /[\u0000-\u001f\u007f<>]/;

const cadena = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v === undefined || v === null ? '' : null);

function texto(valor, { max, obligatorio, patron }) {
  const s = cadena(valor);
  if (s === null) return { error: 'formato' };
  if (!s) return obligatorio ? { error: 'obligatorio' } : { valor: null };
  if (s.length > max) return { error: 'demasiado_largo' };
  if (CONTROLES.test(s) || !patron.test(s)) return { error: 'caracteres_no_permitidos' };
  return { valor: s };
}

/**
 * Teléfono → E.164. Acepta E.164 tal cual, o las formas colombianas de escribirlo: celular
 * `3xx xxx xxxx`, fijo `60x xxx xxxx` (con indicativo nacional) o cualquiera de las dos con
 * el `57` delante. Espacios, paréntesis, guiones y puntos se quitan antes.
 * @returns {string|null} E.164, o null si no se reconoce.
 */
export function normalizarTelefono(crudo) {
  const s = String(crudo ?? '').replace(/[\s().-]/g, '');
  if (!s) return null;
  if (E164.test(s)) return s;
  if (/^00[1-9]\d{6,14}$/.test(s)) return `+${s.slice(2)}`;
  if (/^3\d{9}$/.test(s) || /^60[1-8]\d{7}$/.test(s)) return `+57${s}`;
  if (/^57(?:3\d{9}|60[1-8]\d{7})$/.test(s)) return `+${s}`;
  return null;
}

function telefono(valor, obligatorio = false) {
  const s = cadena(valor);
  if (s === null) return { error: 'formato' };
  if (!s) return obligatorio ? { error: 'obligatorio' } : { valor: null };
  if (s.length > 32) return { error: 'demasiado_largo' };
  const e164 = normalizarTelefono(s);
  if (!e164) return { error: 'formato' };
  if (e164.length > LIMITES.telefono) return { error: 'demasiado_largo' };
  return { valor: e164 };
}

/**
 * Una URL de red social: https, sin credenciales ni fragmento, y con el hostname dentro de los
 * dominios de esa red. Devuelve `url.href` normalizado.
 */
export function validarRed(valor, dominios) {
  const s = cadena(valor);
  if (s === null) return { error: 'formato' };
  if (!s) return { valor: null };
  if (s.length > LIMITES.red) return { error: 'demasiado_largo' };
  let url;
  try {
    url = new URL(s);
  } catch {
    return { error: 'formato' };
  }
  if (url.protocol !== 'https:') return { error: 'solo_https' };
  if (url.username || url.password || url.hash) return { error: 'formato' };
  const host = url.hostname.toLowerCase();
  const permitido = dominios.some((d) => host === d || host.endsWith(`.${d}`));
  if (!permitido) return { error: 'dominio_no_permitido' };
  if (url.href.length > LIMITES.red) return { error: 'demasiado_largo' };
  return { valor: url.href };
}

/** El sitio web: https, sin credenciales, hostname con punto y que no sea una IP. */
export function validarSitio(valor) {
  const s = cadena(valor);
  if (s === null) return { error: 'formato' };
  if (!s) return { valor: null };
  if (s.length > LIMITES.red) return { error: 'demasiado_largo' };
  let url;
  try {
    url = new URL(s);
  } catch {
    return { error: 'formato' };
  }
  if (url.protocol !== 'https:') return { error: 'solo_https' };
  if (url.username || url.password) return { error: 'formato' };
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.startsWith('[')) return { error: 'formato' };
  if (url.href.length > LIMITES.red) return { error: 'demasiado_largo' };
  return { valor: url.href };
}

/**
 * Valida un cuerpo entero. Cualquier clave que no sea de las conocidas se IGNORA (no es un
 * error: la interfaz no las manda, y un cliente que las mande no consigue nada).
 *
 * @returns {{ valor: object|null, campos: Record<string, string> }} `campos` vacío = válido.
 */
export function validarPerfil(cuerpo) {
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) {
    return { valor: null, campos: { _: 'formato' } };
  }
  const campos = {};
  const valor = {};
  const poner = (nombre, r) => {
    if (r.error) campos[nombre] = r.error;
    else valor[nombre] = r.valor;
  };

  poner('nombres', texto(cuerpo.nombres, { max: LIMITES.nombres, obligatorio: true, patron: NOMBRE }));
  poner('apellidos', texto(cuerpo.apellidos, { max: LIMITES.apellidos, obligatorio: true, patron: NOMBRE }));
  poner('cargo', texto(cuerpo.cargo, { max: LIMITES.cargo, obligatorio: true, patron: CARGO }));
  poner('area', texto(cuerpo.area, { max: LIMITES.area, obligatorio: false, patron: CARGO }));

  {
    const s = cadena(cuerpo.correo);
    if (s === null) campos.correo = 'formato';
    else if (!s) campos.correo = 'obligatorio';
    else if (s.length > LIMITES.correo) campos.correo = 'demasiado_largo';
    else {
      const bajo = s.toLowerCase();
      if (!CORREO.test(bajo)) campos.correo = 'formato';
      else valor.correo = bajo;
    }
  }

  poner('telefono', telefono(cuerpo.telefono));
  poner('whatsapp', telefono(cuerpo.whatsapp));
  for (const [red, dominios] of Object.entries(REDES)) poner(red, validarRed(cuerpo[red], dominios));
  poner('sitio_web', validarSitio(cuerpo.sitio_web));

  return Object.keys(campos).length ? { valor: null, campos } : { valor, campos };
}

/** El cambio de estado: exactamente `{activo: boolean}`. */
export function validarEstado(cuerpo) {
  if (!cuerpo || typeof cuerpo !== 'object' || typeof cuerpo.activo !== 'boolean') {
    return { valor: null, campos: { activo: 'formato' } };
  }
  return { valor: { activo: cuerpo.activo }, campos: {} };
}

export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const esUuid = (s) => typeof s === 'string' && UUID_V4.test(s);

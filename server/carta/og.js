/**
 * Open Graph dinámico para `/carta_presentacion/<uuid>`.
 *
 * El enlace de una tarjeta se comparte por Teams y WhatsApp, y la vista previa la arma un
 * rastreador que NO ejecuta JavaScript: lee el `<title>` y las `og:*` del HTML tal como llega.
 * Con el index.html de la SPA a secas saldría «1° Foro GECELCA» y la foto del hero para todas las
 * tarjetas. Aquí se reemplazan por el nombre, el cargo y la foto de ESA persona.
 *
 * Cómo, y por qué así:
 * - `prepararOg(indexHtml)` se llama UNA vez al arrancar: comprueba por regex que el HTML trae
 *   `<title>` y las tres `og:` que se van a sustituir. Si falta alguna, el OG queda apagado con
 *   aviso y las tarjetas salen con el index.html intacto (la SPA funciona igual).
 * - `htmlConOg` sustituye por regex, no con un parser: son cuatro etiquetas de un archivo que
 *   este mismo repo escribe. Todo lo que entra en un atributo pasa por `escapar()`, y
 *   validacion.js ya rechazó `<` y `>` en cualquier campo, así que hay dos vallas.
 * - Perfil inexistente o inactivo → `null` (index.html intacto). BD caída o lenta → `null` con
 *   un tope de 1,5 s (Promise.race): un rastreador no espera y una persona tampoco.
 */

const RE_TITLE = /<title>[^<]*<\/title>/i;
const RE_OG = (prop) => new RegExp(`<meta\\s+property="og:${prop}"\\s+content="[^"]*"\\s*/?>`, 'i');
const RE_OG_MULTILINEA = (prop) =>
  new RegExp(`<meta\\s+property="og:${prop}"\\s+content="[^"]*"\\s*/?>|<meta\\s+property="og:${prop}"\\s+content="[\\s\\S]*?"\\s*/?>`, 'i');

const TOPE_MS = 1500;

export function escapar(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * @returns {{ activo: boolean, motivo?: string, plantilla?: string }}
 */
export function prepararOg(indexHtml) {
  if (typeof indexHtml !== 'string' || !indexHtml.includes('<html')) {
    return { activo: false, motivo: 'index.html ilegible' };
  }
  const faltan = [];
  if (!RE_TITLE.test(indexHtml)) faltan.push('<title>');
  for (const p of ['title', 'description', 'image']) {
    if (!RE_OG_MULTILINEA(p).test(indexHtml)) faltan.push(`og:${p}`);
  }
  if (faltan.length) return { activo: false, motivo: `faltan ${faltan.join(', ')} en index.html` };
  return { activo: true, plantilla: indexHtml };
}

/**
 * El HTML de una tarjeta concreta. `perfil` es el público (obtenerPublico) o null.
 */
export function componerOg(plantilla, perfil, origen) {
  if (!perfil) return null;
  const nombre = `${perfil.nombres} ${perfil.apellidos}`.trim();
  const titulo = `${nombre} · ${perfil.cargo}`;
  const descripcion = [perfil.area, 'GECELCA'].filter(Boolean).join(' · ');
  const url = `${origen}/carta_presentacion/${perfil.id}`;
  const imagen = perfil.foto
    ? `${origen}/api/carta/perfiles/${perfil.id}/foto?v=${perfil.foto.etag.slice(0, 8)}`
    : `${origen}/img/hero-matriz-energetica.webp`;

  let html = plantilla
    .replace(RE_TITLE, `<title>${escapar(titulo)}</title>`)
    .replace(RE_OG_MULTILINEA('title'), `<meta property="og:title" content="${escapar(titulo)}" />`)
    .replace(RE_OG_MULTILINEA('description'), `<meta property="og:description" content="${escapar(descripcion)}" />`)
    .replace(RE_OG_MULTILINEA('image'), `<meta property="og:image" content="${escapar(imagen)}" />`);
  if (!RE_OG('url').test(html)) {
    html = html.replace('<meta property="og:locale"', `<meta property="og:url" content="${escapar(url)}" />\n    <meta property="og:locale"`);
  }
  return html;
}

/**
 * Fábrica del `htmlConOg(id)` que usa el fallback SPA: resuelve el perfil con tope de tiempo y
 * devuelve el HTML compuesto, o null para que salga el index.html de siempre.
 */
export function crearHtmlConOg({ plantilla, repositorio, origen, topeMs = TOPE_MS }) {
  return async function htmlConOg(id) {
    let perfil = null;
    try {
      perfil = await Promise.race([
        repositorio.obtenerPublico(id),
        new Promise((resolve) => setTimeout(() => resolve(null), topeMs).unref?.()),
      ]);
    } catch {
      perfil = null; // BD caída: la SPA pinta su propio «sin servicio»
    }
    return componerOg(plantilla, perfil, origen);
  };
}

/**
 * Las descargas de /galeria: el servidor SIRVE dos ZIP que no compuso.
 *
 * El mismo camino que los certificados, sin la parte de identidad: los paquetes
 * se arman y verifican en la estación (scripts/descargas-empaquetar.py), se
 * suben a `DESCARGAS_DIR` fuera del repo (deploy/descargas-subir.sh) y este
 * módulo aprende el manifiesto al arrancar. A diferencia del certificado, esto
 * es contenido PÚBLICO las mismas fotos que la página ya enseña y las
 * presentaciones que se proyectaron, así que no hay sesión de por medio.
 *
 * Lo que sí se conserva del patrón, porque es lo que lo hace seguro:
 *
 *  · No hay parámetros libres: solo existen los roles del manifiesto
 *    («imagenes», «presentaciones») y cada uno resuelve a UN archivo validado
 *    al arranque. Ni listados, ni rutas construidas con entrada del cliente.
 *  · Vacío = la función NO EXISTE (el defecto). A medias = el arranque ABORTA:
 *    un manifiesto que promete un ZIP ausente o de otro tamaño es una subida
 *    incompleta, y mejor no arrancar que servir descargas truncadas.
 *  · La interfaz solo anuncia lo que el servidor confirma: `estadoDescargas()`
 *    publica bytes y elementos por rol, y sin esa confirmación los botones de
 *    la página quedan retenidos (ver src/data/descargas.ts).
 *
 * Configuración: `DESCARGAS_DIR` (ruta absoluta a la carpeta con los ZIP y su
 * manifiesto.json).
 */
import fs from 'node:fs';
import path from 'node:path';

/** rol → { ruta, nombre, bytes, elementos } cuando está activa; null apagada. */
let porRol = null;

const ROLES = ['imagenes', 'presentaciones'];
const ARCHIVO_SANO = /^[a-z0-9][a-z0-9._-]*\.zip$/;

/** Nombre con el que el navegador guarda cada ZIP. Fijo aquí, no en el manifiesto. */
const NOMBRE_DESCARGA = {
  imagenes: 'Fotografias Foro G-TALKS 2026.zip',
  presentaciones: 'Presentaciones Foro G-TALKS 2026.zip',
};

/**
 * Lee el manifiesto y deja el módulo listo. Se llama UNA vez desde `buildAuthApp()`.
 * @returns {{activo: boolean, roles?: string[], dir?: string}} para la línea de arranque.
 */
export function iniciarDescargas(env = process.env) {
  const dir = String(env.DESCARGAS_DIR || '').trim();
  if (!dir) {
    porRol = null;
    return { activo: false };
  }

  const base = path.resolve(dir);
  const rutaManifiesto = path.join(base, 'manifiesto.json');
  let manifiesto;
  try {
    manifiesto = JSON.parse(fs.readFileSync(rutaManifiesto, 'utf8'));
  } catch (err) {
    throw new Error(
      `DESCARGAS_DIR=${dir} pero ${rutaManifiesto} no se puede leer (${err.message}). ` +
      'Una configuración a medias no enciende la función a medias: o el directorio completo ' +
      '(ZIPs + manifiesto.json subidos por deploy/descargas-subir.sh) o la variable vacía.',
    );
  }

  const roles = manifiesto?.roles;
  if (!roles || typeof roles !== 'object') {
    throw new Error(`${rutaManifiesto} no trae roles: manifiesto corrupto o vacío.`);
  }

  const mapa = new Map();
  for (const rol of ROLES) {
    const entrada = roles[rol];
    if (!entrada) continue; // un rol puede faltar: su botón queda retenido
    const archivo = String(entrada.archivo || '').trim();
    const bytes = Number(entrada.bytes);
    const elementos = Number(entrada.elementos);
    // El allowlist del nombre niega el traversal por construcción; el resolve +
    // startsWith lo vuelve a negar por si acaso (mismas dos vallas que los
    // certificados).
    if (!ARCHIVO_SANO.test(archivo) || !Number.isFinite(bytes) || bytes <= 0) {
      throw new Error(`Entrada inválida en el manifiesto para «${rol}»: ${JSON.stringify(entrada)}`);
    }
    const ruta = path.resolve(base, archivo);
    if (!ruta.startsWith(base + path.sep)) {
      throw new Error(`La entrada «${archivo}» del manifiesto resuelve fuera de ${base}.`);
    }
    let real;
    try {
      real = fs.statSync(ruta).size;
    } catch {
      throw new Error(`El manifiesto promete ${archivo} y no está en ${base}: subida incompleta.`);
    }
    if (real !== bytes) {
      throw new Error(
        `${archivo} pesa ${real} bytes y el manifiesto promete ${bytes}: subida corrupta o a medias.`,
      );
    }
    mapa.set(rol, { ruta, bytes, elementos });
  }

  if (mapa.size === 0) {
    throw new Error(`${rutaManifiesto} no trae ningún rol conocido (${ROLES.join(', ')}).`);
  }

  porRol = mapa;
  return { activo: true, roles: [...mapa.keys()], dir: base };
}

/**
 * Lo que `GET /api/descargas` anuncia: bytes y elementos por rol, para que la
 * página pinte el peso REAL junto a cada botón. Un rol ausente va en `null`
 * la única palabra que la interfaz necesita para retener su botón.
 */
export function estadoDescargas() {
  const estado = {};
  for (const rol of ROLES) {
    const e = porRol?.get(rol);
    estado[rol] = e ? { bytes: e.bytes, elementos: e.elementos } : null;
  }
  return estado;
}

/**
 * La entrega de un rol, o `null` si no existe. Único consumidor:
 * `GET /descargas/:rol`, que solo acepta lo que este mapa conozca.
 */
export function entregaDescarga(rol) {
  const e = porRol?.get(String(rol || ''));
  return e ? { ruta: e.ruta, nombre: NOMBRE_DESCARGA[rol] } : null;
}

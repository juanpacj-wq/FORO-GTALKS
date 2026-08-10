/**
 * El certificado de participación: el servidor SIRVE archivos que no compuso.
 *
 * Los PDF se generan en la estación (scripts/certificados-generar.py), se verifican dos veces
 * (el auto-chequeo del generador y la segunda opinión de certificados-auditar.py) y se suben a
 * `CERTIFICADOS_DIR` fuera del repo, con un manifiesto. Este módulo solo aprende ese manifiesto
 * al arrancar y responde una pregunta: ¿qué archivo le corresponde al `oid` de ESTA sesión?
 *
 * Por qué así, y no generando aquí: producir el PDF exigiría la primera dependencia de
 * producción no trivial del servidor y sacaría la composición del alcance de los arneses de la
 * estación. El precedente es el envío del QR: los artefactos personales se producen y verifican
 * FUERA, y el servidor no sabe componer ninguno.
 *
 * La regla de oro, heredada de docs/EXPORTAR-INSCRITOS.md («una ruta que sirva el registro de
 * asistencia sería la peor puerta»): esta ruta NO es esa puerta porque no admite parámetros.
 * Solo existe `GET /api/certificado`, que resuelve únicamente el oid de la sesión que pregunta.
 * No hay forma de pedir el certificado de otro, ni de listar, ni de enumerar: el mapa entero
 * vive en este proceso y jamás viaja.
 *
 * El manifiesto lleva `oid → archivo` y nada más ni nombres ni cédulas: el servidor no los
 * necesita, así que no los conoce (minimización, como el libro de inscripción que no guarda
 * direcciones).
 *
 * Configuración: `CERTIFICADOS_DIR` (ruta absoluta). Vacío o sin definir = la función NO EXISTE
 * (el defecto, como INSCRIPCION_MODO=off). Definido pero con el manifiesto ilegible, corrupto o
 * con archivos que falten = el arranque ABORTA: mejor no arrancar que arrancar sirviendo a
 * medias, que es exactamente la política del correo de inscripción.
 */
import fs from 'node:fs';
import path from 'node:path';

/** `Map<oid, ruta absoluta>` cuando la función está activa; `null` cuando está apagada. */
let porOid = null;

/** Nombre de archivo del manifiesto tal como lo produce el generador. */
const ARCHIVO_SANO = /^[a-z0-9][a-z0-9._-]*\.pdf$/;

/**
 * Lee el manifiesto y deja el módulo listo. Se llama UNA vez desde `buildAuthApp()`.
 * @returns {{activo: boolean, personas?: number, dir?: string}} para la línea de arranque.
 */
export function iniciarCertificados(env = process.env) {
  const dir = String(env.CERTIFICADOS_DIR || '').trim();
  if (!dir) {
    porOid = null;
    return { activo: false };
  }

  const base = path.resolve(dir);
  const rutaManifiesto = path.join(base, 'manifiesto.json');
  let manifiesto;
  try {
    manifiesto = JSON.parse(fs.readFileSync(rutaManifiesto, 'utf8'));
  } catch (err) {
    throw new Error(
      `CERTIFICADOS_DIR=${dir} pero ${rutaManifiesto} no se puede leer (${err.message}). ` +
      'Una configuración a medias no enciende la función a medias: o el directorio completo ' +
      '(PDFs + manifiesto.json subidos por deploy/certificados-subir.sh) o la variable vacía.',
    );
  }

  const personas = Array.isArray(manifiesto?.personas) ? manifiesto.personas : null;
  if (!personas || !personas.length) {
    throw new Error(`${rutaManifiesto} no trae personas: manifiesto corrupto o vacío.`);
  }

  const mapa = new Map();
  for (const p of personas) {
    const oid = String(p?.oid || '').trim();
    const archivo = String(p?.archivo || '').trim();
    // El allowlist del nombre hace imposible el traversal por construcción (ni «/», ni «..»
    // pueden pasar el patrón), y el `resolve` + `startsWith` lo vuelve a negar por si acaso.
    if (!oid || !ARCHIVO_SANO.test(archivo)) {
      throw new Error(`Entrada inválida en el manifiesto: ${JSON.stringify({ oid: p?.oid, archivo: p?.archivo })}`);
    }
    const ruta = path.resolve(base, archivo);
    if (!ruta.startsWith(base + path.sep)) {
      throw new Error(`La entrada «${archivo}» del manifiesto resuelve fuera de ${base}.`);
    }
    if (!fs.existsSync(ruta)) {
      throw new Error(`El manifiesto promete ${archivo} y no está en ${base}: subida incompleta.`);
    }
    if (mapa.has(oid)) {
      throw new Error(`El manifiesto trae el oid ${oid} dos veces.`);
    }
    mapa.set(oid, ruta);
  }

  porOid = mapa;
  return { activo: true, personas: mapa.size, dir: base };
}

/**
 * Lo que `/api/me` anuncia. `no_aplica` cubre a propósito TRES casos con una sola palabra
 * la función apagada, la persona sin certificado, y un oid desconocido—: distinguirlos no le
 * sirve a la interfaz y sí le contaría cosas a quien no debe.
 * @returns {'disponible'|'no_aplica'}
 */
export function estadoCertificado(oid) {
  return porOid?.has(String(oid || '')) ? 'disponible' : 'no_aplica';
}

/** La ruta absoluta del PDF del oid, o `null`. Único consumidor: `GET /api/certificado`. */
export function rutaCertificado(oid) {
  return porOid?.get(String(oid || '')) ?? null;
}

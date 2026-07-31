/**
 * Los hechos del evento, para el correo de inscripción.
 *
 * Lee EL MISMO archivo que el sitio (`src/data/evento.json`, que `src/data/foro.ts` importa),
 * en vez de mantener una copia aquí. La alternativa —dos listas con la misma fecha y el mismo
 * lugar— se habría separado en cuanto se resolviera el pendiente #1 (la sede: los PDF dicen
 * «G Working», la carpeta dice «Puerta de Oro»), y el correo habría seguido citando la vieja.
 *
 * `src/` sí llega al servidor: `deploy/deploy.sh` empaqueta el repo con `git archive` y la poda
 * posterior es `npm prune --omit=dev`, que solo toca `node_modules`. Aun así se comprueba al
 * ARRANCAR y no al enviar: si algún día cambia el empaquetado, el proceso lo dice en el arranque
 * en vez de descubrirse la mañana del foro con un correo que dice «undefined».
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUTA = path.resolve(__dirname, '..', '..', 'src', 'data', 'evento.json');

/** Lo que la plantilla del correo usa. Si falta uno, el correo saldría incompleto: se aborta. */
const OBLIGATORIOS = ['edicion', 'nombre', 'bajada', 'marca', 'lugar', 'organiza'];

let cache = null;

/**
 * @returns {{edicion:number, nombre:string, bajada:string, marca:string,
 *            fecha:{texto:string, iso:string, cierreIso:string}, lugar:string, organiza:string,
 *            contacto:{nombre:string, telefono:string}, tagline:string}}
 * @throws  Error con nombre propio si el archivo falta o está incompleto.
 */
export function cargarEvento() {
  if (cache) return cache;

  let crudo;
  try {
    crudo = fs.readFileSync(RUTA, 'utf8');
  } catch (err) {
    throw new Error(
      `No se pudo leer ${RUTA} (${err.code || err.message}). Es la fuente de los datos del evento ` +
      'que cita el correo de inscripción, compartida con el sitio. Si el empaquetado del ' +
      'despliegue dejó de incluir src/, hay que arreglarlo ahí, no duplicar el archivo aquí.'
    );
  }

  let datos;
  try {
    datos = JSON.parse(crudo);
  } catch (err) {
    throw new Error(`${RUTA} no es JSON válido: ${err.message}`);
  }

  const faltan = OBLIGATORIOS.filter((k) => datos[k] === undefined || datos[k] === '');
  if (!datos.fecha?.texto) faltan.push('fecha.texto');
  if (faltan.length) {
    throw new Error(`A ${RUTA} le faltan campos que el correo necesita: ${faltan.join(', ')}.`);
  }

  cache = datos;
  return cache;
}

/** «1° Foro GECELCA G-TALKS» — con lo que el correo se presenta en el asunto. */
export function tituloCorto(evento) {
  return `${evento.edicion}° Foro GECELCA ${evento.marca}`;
}

/**
 * La encuesta de satisfacción abre cuando el evento CIERRA, y quien decide la
 * hora es este proceso, no el navegador.
 *
 * La regla de negocio: la encuesta pregunta por la experiencia del foro, así
 * que no debe recibir respuestas antes de que el foro termine. Un gate solo en
 * la interfaz sería cosmético —cualquiera puede adelantar el reloj de su
 * equipo, o leer la URL del bundle—, así que la defensa es de retención: la
 * URL del formulario vive AQUÍ, nunca en `src/`, y solo viaja al navegador
 * cuando `Date.now()` del servidor pasó el cierre. Antes de esa hora, el
 * cliente no tiene nada que habilitar.
 *
 * La hora de cierre no se escribe aquí: sale de `src/data/evento.json`
 * (`fecha.cierreIso`), el mismo archivo de hechos que leen el sitio y el
 * correo de inscripción. Un archivo, tres lectores. El instante lleva su
 * desfase explícito (`-05:00`, Colombia no tiene horario de verano): así
 * `Date.parse` es determinista y la zona horaria del servidor no participa en
 * la decisión. Un `cierreIso` ausente o sin desfase ABORTA el arranque, igual
 * que una configuración a medias del correo: mejor no arrancar que arrancar
 * decidiendo con una hora ambigua.
 *
 * `estadoEncuestas` es una función pura con el reloj inyectable, y esa es su
 * prueba: `gate-test.mjs` la ejercita en la frontera exacta (un milisegundo
 * antes y el instante justo) sin esperar al 5 de agosto.
 */
import { cargarEvento } from './correo/evento.js';

/**
 * El formulario de satisfacción, en Microsoft Forms (tenant de GECELCA).
 * Antes vivía en `src/data/foro.ts`; se mudó aquí para que el bundle público
 * no lo contenga. Si Comunicaciones entrega un formulario nuevo, se cambia
 * esta constante y nada más.
 */
const URL_SATISFACCION =
  'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=pVIWIrBsu0qooCq7hJ0TTnWRtCL9WMV' +
  'BiJvbBugF__1UNTBMOEdSNUMzQlQwWEZVV1NHTklLNzY1VC4u';

const CIERRE_ISO = cargarEvento().fecha?.cierreIso ?? '';

// El desfase explícito es obligatorio: «2026-08-05T16:00:00» a secas lo
// interpretaría cada máquina en SU zona, y la de este servidor no es un hecho
// del evento.
if (!/(Z|[+-]\d{2}:\d{2})$/.test(CIERRE_ISO)) {
  throw new Error(
    `fecha.cierreIso en src/data/evento.json vale «${CIERRE_ISO}» y necesita el desfase horario ` +
    'explícito (ej. 2026-08-05T16:00:00-05:00). Sin él, la hora de apertura de la encuesta de ' +
    'satisfacción dependería de la zona horaria del servidor.'
  );
}

const CIERRE_MS = Date.parse(CIERRE_ISO);
if (!Number.isFinite(CIERRE_MS)) {
  throw new Error(`fecha.cierreIso en src/data/evento.json no es una fecha válida: «${CIERRE_ISO}»`);
}

/**
 * Lo que `/api/encuestas` responde. Cerrada, el objeto NO tiene `url` —no es
 * un campo vacío ni oculto: no existe—; `desde` y `ahora` viajan siempre para
 * que el cliente pueda programar su recomprobación restando DOS relojes del
 * servidor, sin fiarse del suyo.
 *
 * @param {number} [ahoraMs] reloj inyectable, solo para las pruebas.
 */
export function estadoEncuestas(ahoraMs = Date.now()) {
  const habilitada = ahoraMs >= CIERRE_MS;
  return {
    ahora: new Date(ahoraMs).toISOString(),
    satisfaccion: habilitada
      ? { habilitada: true, desde: CIERRE_ISO, url: URL_SATISFACCION }
      : { habilitada: false, desde: CIERRE_ISO },
  };
}

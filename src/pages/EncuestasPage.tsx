import { useEffect, useState } from 'react'
import SectionTitle from '../components/SectionTitle'
import {
  ENCUESTAS,
  ENCUESTAS_INTRO,
  ENCUESTA_SATISFACCION_AVISO,
  type Encuesta,
} from '../data/foro'
import { useEncuestaSatisfaccion } from '../data/encuestas'
import './PonentesPage.css'
import './EncuestasPage.css'

/**
 * Las tres encuestas del foro.
 *
 * No hay formulario propio ni hace falta: las respuestas viven en Microsoft
 * Forms, dentro del tenant de GECELCA, así que el proyecto sigue sin base de
 * datos ni endpoint de escritura. El trabajo de esta página es entregar los
 * destinos diciendo qué se pregunta en cada uno.
 *
 * Con una diferencia entre ellas: la de satisfacción pregunta por la
 * experiencia del foro, así que no abre hasta que el foro cierra. Su URL no
 * está en este bundle la retiene el servidor y la entrega `/api/encuestas`
 * pasada la hora de `evento.json`—, y mientras tanto el botón va deshabilitado
 * con su aviso. Quien decide es el reloj del SERVIDOR: adelantar el del
 * teléfono no fabrica el enlace. Ver `BotonSatisfaccion` abajo.
 *
 * Las otras dos —oportunidades y las preguntas pendientes para panelistas— van
 * abiertas siempre: traen su `url` y `PieEncuesta` las pinta como enlace. La
 * regla que separa unas de otras es esa y solo esa: **sin `url`, el servidor
 * decide**.
 *
 * Que el enlace sale del sitio lo marca la flecha en diagonal del botón
 * (`--externo`), y nada más: el aviso escrito debajo de cada botón se quitó por
 * petición del usuario. Los `target="_blank"` siguen con `rel="noopener
 * noreferrer"`.
 *
 * El contenido vive en `src/data/foro.ts`, como todo lo demás.
 */

/** Cuántos ms se queda visible el aviso tras un toque (móvil no tiene hover). */
const AVISO_TOQUE_MS = 4000

function BotonEncuesta({ accion, url }: { accion: string; url: string }) {
  return (
    <>
      <a
        className="gt-boton gt-boton--solido gt-boton--externo gt-encuesta__boton"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {accion}
      </a>

      {/* Solo al imprimir. El botón se oculta sobre papel (base.css) y una
          tarjeta que ofrece un enlace ausente no sirve de nada, así que ahí se
          escribe la URL. En pantalla no existe: va con `display: none`, que
          también la oculta a los lectores. */}
      <span className="gt-encuesta__url-papel">{url}</span>
    </>
  )
}

/**
 * El pie de la encuesta de satisfacción. Abierta, es el mismo botón que el de
 * al lado; cerrada, un botón deshabilitado con el aviso como tooltip.
 *
 * Tres decisiones de accesibilidad que no son capricho:
 *
 * - `aria-disabled` y no `disabled`: un botón `disabled` no recibe foco, así
 *   que quien navega con teclado o lector pasaría de largo sin enterarse de
 *   que la encuesta existe ni de cuándo abre.
 * - El aviso va SIEMPRE en el DOM, enlazado con `aria-describedby`: los
 *   lectores lo anuncian como descripción del botón aunque esté oculto a la
 *   vista. Verlo (hover, foco) es progresivo; oírlo no depende de eso.
 * - En táctil no hay hover, y el público responde desde el celular: tocar el
 *   botón muestra el aviso un momento. Escape lo cierra (WCAG 1.4.13).
 */
function BotonSatisfaccion({ accion }: { accion: string }) {
  const satisfaccion = useEncuestaSatisfaccion()
  const [avisando, setAvisando] = useState(false)

  useEffect(() => {
    if (!avisando) return
    const t = window.setTimeout(() => setAvisando(false), AVISO_TOQUE_MS)
    return () => clearTimeout(t)
  }, [avisando])

  if (satisfaccion.estado === 'abierta') {
    return <BotonEncuesta accion={accion} url={satisfaccion.url} />
  }

  return (
    <span className={'gt-encuesta__gate' + (avisando ? ' gt-encuesta__gate--avisando' : '')}>
      <button
        type="button"
        className="gt-boton gt-encuesta__boton gt-boton--inactivo"
        aria-disabled="true"
        aria-describedby="gt-satisfaccion-aviso"
        onClick={() => setAvisando((v) => !v)}
        onKeyDown={(e) => e.key === 'Escape' && setAvisando(false)}
        onBlur={() => setAvisando(false)}
      >
        {accion}
      </button>
      <span role="tooltip" id="gt-satisfaccion-aviso" className="gt-encuesta__aviso gt-lamina">
        {ENCUESTA_SATISFACCION_AVISO}
      </span>

      {/* Sobre papel no hay URL que escribir mientras no la haya: se imprime el
          aviso, que es la verdad de este estado. */}
      <span className="gt-encuesta__url-papel">{ENCUESTA_SATISFACCION_AVISO}</span>
    </span>
  )
}

function PieEncuesta({ encuesta }: { encuesta: Encuesta }) {
  return encuesta.url ? (
    <BotonEncuesta accion={encuesta.accion} url={encuesta.url} />
  ) : (
    <BotonSatisfaccion accion={encuesta.accion} />
  )
}

export default function EncuestasPage() {
  return (
    <section className="gt-pagina gt-grano">
      <div className="gt-contenedor">
        <SectionTitle como="h1" apunte={`${ENCUESTAS.length} encuestas`}>
          Encuestas
        </SectionTitle>

        <p className="gt-pagina__intro">{ENCUESTAS_INTRO}</p>

        {/* La entradilla termina en dos puntos y anuncia una lista: esto es esa
            lista, y los ordinales son los que la vuelven enumerable a la vista.
            Van `aria-hidden` porque el `ul` ya la enumera para quien escucha. */}
        <ul className="gt-encuestas">
          {ENCUESTAS.map((encuesta, i) => (
            <li className="gt-encuesta" key={encuesta.id}>
              <span className="gt-dato gt-encuesta__orden" aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>

              <h2 className="gt-encuesta__titulo">{encuesta.titulo}</h2>
              <p className="gt-encuesta__texto">{encuesta.descripcion}</p>

              <div className="gt-encuesta__pie">
                <PieEncuesta encuesta={encuesta} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

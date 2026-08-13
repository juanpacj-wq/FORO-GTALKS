import { useEffect, useState } from 'react'
import SectionTitle from '../components/SectionTitle'
import VisorRespuestas from '../components/VisorRespuestas'
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
 * Las tres tarjetas del foro: las respuestas del panel y dos encuestas.
 *
 * No hay formulario propio ni hace falta: las encuestas viven en Microsoft
 * Forms, dentro del tenant de GECELCA, así que el proyecto sigue sin base de
 * datos ni endpoint de escritura. El trabajo de esta página es entregar los
 * destinos diciendo qué hay en cada uno.
 *
 * La primera ya no es una encuesta: el panel pasó y la tarjeta de preguntas
 * para panelistas ENTREGA las respuestas (`resultados` en `foro.ts`): su botón
 * abre el visor de la pieza —las páginas para leer de corrido y el PDF para
 * llevar (2026-08-13, en vez de redirigir al Forms)—. Por eso se pinta
 * destacada, lámina celeste a todo lo ancho y sin ordinal: la numeración es
 * solo de lo que la entradilla invita a responder.
 *
 * De las dos encuestas, la de satisfacción pregunta por la experiencia del
 * foro, así que no abre hasta que el foro cierra. Su URL no está en este
 * bundle la retiene el servidor y la entrega `/api/encuestas` pasada la hora
 * de `evento.json`, y mientras tanto el botón va deshabilitado con su aviso.
 * Quien decide es el reloj del SERVIDOR: adelantar el del teléfono no fabrica
 * el enlace. Ver `BotonSatisfaccion` abajo.
 *
 * La regla que reparte los pies quedó en tres ramas: `resultados` abre el
 * visor local; `url` es un enlace que sale del sitio (flecha `--externo`,
 * `target="_blank"` con `rel="noopener noreferrer"`); y sin ninguna de las
 * dos, el servidor decide.
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

/**
 * El pie de la tarjeta de resultados: abre el visor con las páginas de la
 * pieza y su descarga. Es un botón y no un enlace porque no navega a ningún
 * sitio el documento se enseña aquí mismo.
 */
function BotonRespuestas({ accion }: { accion: string }) {
  const [abierto, setAbierto] = useState(false)

  return (
    <>
      <button
        type="button"
        className="gt-boton gt-boton--solido gt-encuesta__boton"
        onClick={() => setAbierto(true)}
      >
        {accion}
      </button>
      {abierto && <VisorRespuestas alCerrar={() => setAbierto(false)} />}

      {/* Sobre papel el visor no existe: se escribe dónde queda el documento. */}
      <span className="gt-encuesta__url-papel">
        Descarga: /docs/respuestas-panelistas.pdf
      </span>
    </>
  )
}

function PieEncuesta({ encuesta }: { encuesta: Encuesta }) {
  if (encuesta.resultados) return <BotonRespuestas accion={encuesta.accion} />
  return encuesta.url ? (
    <BotonEncuesta accion={encuesta.accion} url={encuesta.url} />
  ) : (
    <BotonSatisfaccion accion={encuesta.accion} />
  )
}

export default function EncuestasPage() {
  // La numeración es solo de las encuestas por responder: la tarjeta de
  // resultados no es una de ellas y lleva etiqueta en vez de ordinal.
  const porResponder = ENCUESTAS.filter((e) => !e.resultados)

  return (
    <section className="gt-pagina gt-grano">
      <div className="gt-contenedor">
        <SectionTitle como="h1" apunte={`${ENCUESTAS.length} encuestas`}>
          Encuestas
        </SectionTitle>

        <p className="gt-pagina__intro">{ENCUESTAS_INTRO}</p>

        {/* Los ordinales vuelven enumerable a la vista la lista que la
            entradilla anuncia. Van `aria-hidden` porque el `ul` ya la enumera
            para quien escucha; la etiqueta de la tarjeta de resultados también,
            porque solo repite lo que su descripción ya dice. */}
        <ul className="gt-encuestas">
          {ENCUESTAS.map((encuesta) => (
            <li
              className={
                'gt-encuesta' +
                (encuesta.resultados ? ' gt-lamina gt-encuesta--respuestas' : '')
              }
              key={encuesta.id}
            >
              <span className="gt-dato gt-encuesta__orden" aria-hidden="true">
                {encuesta.resultados
                  ? 'Ya disponibles'
                  : String(porResponder.indexOf(encuesta) + 1).padStart(2, '0')}
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

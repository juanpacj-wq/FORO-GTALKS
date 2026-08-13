import { Link } from 'react-router-dom'
import type { Ponente } from '../data/foro'
import { resumenDe, transicionRetrato } from '../data/foro'
import { retratoDe } from '../design/retratos'
import Monogram from './Monogram'
import './SpeakerCard.css'

/**
 * Fila de ponente dentro de un listado.
 *
 * Once personas en tarjetas iguales es una rejilla de relleno: todas pesan lo
 * mismo y ninguna se lee. Como filaretrato, nombre grande, cargo, y una
 * regla de 1 px separando el listado se lee como el índice de un programa,
 * que es lo que es.
 *
 * El retrato va cuadrado y no vertical: en una fila la foto no puede competir
 * con el nombre. El 4:5 se reserva para la cabecera del perfil, donde el
 * retrato sí es el sujeto.
 */
export default function SpeakerCard({
  ponente,
  resumen = false,
  como: Como = 'h2',
}: {
  ponente: Ponente
  /**
   * Añade una línea con lo que hace la persona y a qué hora.
   *
   * Apagado por defecto a propósito. En la home este listado va dos secciones
   * por debajo de la agenda completa, así que ahí la línea sería decir lo
   * mismo dos veces en la misma pantalla; en /ponentes, en cambio, es el valor
   * entero de la página.
   */
  resumen?: boolean
  /** Nivel del encabezado según de qué cuelgue el listado. */
  como?: 'h2' | 'h3'
}) {
  /* Se resuelve antes de pintar porque puede venir vacía: la presidencia no
     lleva línea (ver SIN_RESUMEN). Envolverla a ciegas dejaba un <span> vacío
     ocupando su hueco bajo el cargo. */
  const linea = resumen ? resumenDe(ponente.slug) : ''

  return (
    <li className="gt-ponente">
      <Link className="gt-ponente__enlace" to={`/ponentes/${ponente.slug}`} viewTransition>
        <Monogram
          nombre={ponente.nombre}
          foto={retratoDe(ponente.slug)?.cuadrado}
          tamano="sm"
          transicion={transicionRetrato(ponente.slug)}
        />
        <span className="gt-ponente__texto">
          <Como className="gt-ponente__nombre">{ponente.nombre}</Como>
          <span className="gt-ponente__cargo">{ponente.cargo}</span>
          {linea && <span className="gt-ponente__resumen">{linea}</span>}
        </span>
        <span className="gt-ponente__flecha" aria-hidden="true">
          →
        </span>
      </Link>
    </li>
  )
}

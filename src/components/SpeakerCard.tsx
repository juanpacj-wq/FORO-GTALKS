import { Link } from 'react-router-dom'
import type { Ponente } from '../data/foro'
import Monogram from './Monogram'
import './SpeakerCard.css'

/**
 * Fila de ponente dentro del listado.
 *
 * Once personas en tarjetas iguales es una rejilla de relleno: todas pesan lo
 * mismo y ninguna se lee. Como fila —monograma, nombre grande, cargo, y una
 * regla de 1 px separando— el listado se lee como el índice de un programa,
 * que es lo que es.
 */
export default function SpeakerCard({
  ponente,
  foto,
  como: Como = 'h2',
}: {
  ponente: Ponente
  foto?: string
  /** Nivel del encabezado según de qué cuelgue el listado. */
  como?: 'h2' | 'h3'
}) {
  return (
    <li className="gt-ponente">
      <Link className="gt-ponente__enlace" to={`/ponentes/${ponente.slug}`} viewTransition>
        <Monogram nombre={ponente.nombre} foto={foto} tamano="sm" />
        <span className="gt-ponente__texto">
          <Como className="gt-ponente__nombre">{ponente.nombre}</Como>
          <span className="gt-ponente__cargo">{ponente.cargo}</span>
        </span>
        <span className="gt-ponente__flecha" aria-hidden="true">
          →
        </span>
      </Link>
    </li>
  )
}

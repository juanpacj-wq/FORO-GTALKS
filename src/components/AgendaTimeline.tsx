import { Link } from 'react-router-dom'
import {
  AGENDA,
  anclaDe,
  formatoHora,
  ponentePorSlug,
  type Bloque,
  type PonenteSlug,
} from '../data/foro'
import { retratoDe } from '../design/retratos'
import Monogram from './Monogram'
import './AgendaTimeline.css'

/**
 * Nombre enlazado al perfil, con su retrato y su cargo.
 *
 * La caja pequeña es `Monogram` y no un cuadro propio: antes el programa
 * reimplementaba la forma en «hoja» por su cuenta, así que las fotos habrían
 * llegado al listado y al perfil y aquídonde el visitante pasa más tiempo
 * se habrían quedado las iniciales.
 *
 * No lleva `transicion`: la misma persona puede salir dos veces en la agenda
 * (ponencia y panel), y dos `view-transition-name` iguales hacen que el
 * navegador descarte la transición entera. Ver `transicionRetrato()`.
 */
function Persona({ slug }: { slug: PonenteSlug }) {
  const p = ponentePorSlug(slug)
  if (!p) return null
  return (
    <li>
      <Link className="gt-agenda__nombre" to={`/ponentes/${p.slug}`} viewTransition>
        <Monogram nombre={p.nombre} foto={retratoDe(p.slug)?.cuadrado} tamano="xs" />
        <span className="gt-agenda__persona">
          <span className="gt-agenda__persona-nombre">{p.nombre}</span>
          <span className="gt-agenda__cargo">{p.cargo}</span>
        </span>
      </Link>
    </li>
  )
}

function Personas({ bloque }: { bloque: Bloque }) {
  // Ponencia y apertura/cierre tienen una sola persona; el hito puede no
  // tenerla (el registro no la tiene).
  const unico =
    bloque.tipo === 'ponencia' || bloque.tipo === 'hito' ? bloque.ponente : undefined

  if (unico) {
    return (
      <ul className="gt-agenda__personas">
        <Persona slug={unico} />
      </ul>
    )
  }

  if (bloque.tipo === 'panel') {
    return (
      <div className="gt-agenda__panel">
        <div className="gt-agenda__grupo">
          <p className="gt-dato gt-agenda__rol">Modera</p>
          <ul className="gt-agenda__personas">
            <Persona slug={bloque.moderador} />
          </ul>
        </div>
        <div className="gt-agenda__grupo">
          <p className="gt-dato gt-agenda__rol">Panelistas</p>
          <ul className="gt-agenda__personas gt-agenda__personas--rejilla">
            {bloque.panelistas.map((s) => (
              <Persona key={s} slug={s} />
            ))}
          </ul>
        </div>
      </div>
    )
  }

  return null
}

const CATEGORIA: Partial<Record<Bloque['tipo'], string>> = {
  ponencia: 'Ponencia',
  panel: 'Panel',
}

export default function AgendaTimeline({
  activo = null,
  onActivo,
}: {
  /** Ancla del bloque señalado desde la línea del día. */
  activo?: string | null
  /** Avisa hacia arriba para que la línea del día marque el mismo bloque. */
  onActivo?: (ancla: string | null) => void
}) {
  return (
    <ol className="gt-agenda">
      {AGENDA.map((bloque) => {
        const ini = formatoHora(bloque.inicio)
        const fin = formatoHora(bloque.fin)
        const ancla = anclaDe(bloque)
        return (
          <li
            key={`${bloque.inicio}-${bloque.titulo}`}
            id={ancla}
            className={`gt-agenda__fila gt-agenda__fila--${bloque.tipo}`}
            data-activo={activo === ancla ? '' : undefined}
            onMouseEnter={() => onActivo?.(ancla)}
            onMouseLeave={() => onActivo?.(null)}
          >
            {/* El riel de horas es visual; para lectores de pantalla va el
                rango escrito, que se entiende sin ver la maquetación. */}
            <span className="gt-oculto-visual">
              De {ini.hora} {ini.meridiano} a {fin.hora} {fin.meridiano}:
            </span>

            <div className="gt-agenda__riel" aria-hidden="true">
              <span className="gt-agenda__inicio">
                {ini.hora}
                <small>{ini.meridiano}</small>
              </span>
              <span className="gt-agenda__fin">
                {fin.hora} {fin.meridiano}
              </span>
            </div>

            <div className="gt-agenda__cuerpo">
              {CATEGORIA[bloque.tipo] && (
                <p className="gt-dato gt-agenda__categoria">{CATEGORIA[bloque.tipo]}</p>
              )}
              <h3 className="gt-agenda__titulo">{bloque.titulo}</h3>
              <Personas bloque={bloque} />
            </div>
          </li>
        )
      })}
    </ol>
  )
}

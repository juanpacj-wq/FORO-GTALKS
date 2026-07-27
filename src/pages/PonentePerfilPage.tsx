import { Link, Navigate, useParams } from 'react-router-dom'
import Monogram from '../components/Monogram'
import { useTituloPagina } from '../components/Layout'
import { PONENTES, anclaDe, formatoHora, intervencionesDe, ponentePorSlug } from '../data/foro'
import './PonentePerfilPage.css'

const ETIQUETA_PAPEL: Record<string, string> = {
  ponente: 'Ponente',
  moderador: 'Moderador',
  panelista: 'Panelista',
  'a cargo': 'A cargo',
}

export default function PonentePerfilPage() {
  const { slug = '' } = useParams()
  const ponente = ponentePorSlug(slug)

  // El hook va antes del return condicional: no puede quedar detrás de una
  // salida temprana. Con el ponente ausente recibe undefined y no hace nada.
  useTituloPagina(ponente?.nombre)

  if (!ponente) return <Navigate to="/ponentes" replace />

  const intervenciones = intervencionesDe(ponente.slug)
  const indice = PONENTES.findIndex((p) => p.slug === ponente.slug)
  const anterior = PONENTES[indice - 1]
  const siguiente = PONENTES[indice + 1]

  return (
    <article className="gt-perfil gt-grano">
      <header className="gt-contenedor gt-perfil__cabecera">
        <Monogram nombre={ponente.nombre} tamano="lg" />
        <div>
          <h1 className="gt-perfil__nombre">{ponente.nombre}</h1>
          <p className="gt-perfil__cargo">{ponente.cargo}</p>
        </div>
      </header>

      <div className="gt-contenedor gt-perfil__cuerpo">
        <h2 className="gt-perfil__subtitulo">
          {intervenciones.length === 1
            ? 'Su intervención en el foro'
            : 'Sus intervenciones en el foro'}
        </h2>

        <ul className="gt-perfil__lista">
          {intervenciones.map(({ bloque, papel }) => {
            const ini = formatoHora(bloque.inicio)
            const fin = formatoHora(bloque.fin)
            return (
              <li key={`${bloque.inicio}-${bloque.titulo}`} className="gt-perfil__item">
                <p className="gt-dato gt-perfil__hora">
                  {ini.hora} {ini.meridiano}
                  <span className="gt-perfil__hora-fin">
                    hasta {fin.hora} {fin.meridiano}
                  </span>
                </p>
                {/* Cierra el circuito: de la agenda al perfil y del perfil de
                    vuelta a su bloque en el programa. */}
                <h3 className="gt-perfil__bloque">
                  <Link className="gt-perfil__enlace" to={`/#${anclaDe(bloque)}`}>
                    {bloque.titulo}
                  </Link>
                </h3>
                <p className="gt-chip gt-perfil__papel">{ETIQUETA_PAPEL[papel] ?? papel}</p>
              </li>
            )
          })}
        </ul>

        <nav className="gt-perfil__nav" aria-label="Otros ponentes">
          {anterior ? (
            <Link className="gt-perfil__salto" to={`/ponentes/${anterior.slug}`} rel="prev" viewTransition>
              <span className="gt-dato gt-perfil__salto-dir">← Anterior</span>
              <span className="gt-perfil__salto-nombre">{anterior.nombre}</span>
            </Link>
          ) : (
            <span />
          )}

          <Link className="gt-perfil__todos" to="/ponentes" viewTransition>
            Ver todos los ponentes
          </Link>

          {siguiente ? (
            <Link
              className="gt-perfil__salto gt-perfil__salto--der"
              to={`/ponentes/${siguiente.slug}`}
              rel="next"
              viewTransition
            >
              <span className="gt-dato gt-perfil__salto-dir">Siguiente →</span>
              <span className="gt-perfil__salto-nombre">{siguiente.nombre}</span>
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </div>
    </article>
  )
}

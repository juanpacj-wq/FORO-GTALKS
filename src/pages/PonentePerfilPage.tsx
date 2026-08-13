import type { CSSProperties } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import Monogram from '../components/Monogram'
import Parrafos from '../components/Parrafos'
import PhotoFrame from '../components/PhotoFrame'
import SectionTitle from '../components/SectionTitle'
import { useTituloPagina } from '../components/Layout'
import {
  ETIQUETA_PAPEL,
  PONENTES,
  anclaDe,
  formatoHora,
  iniciales,
  intervencionesDe,
  ponentePorSlug,
  transicionRetrato,
} from '../data/foro'
import { retratoDe } from '../design/retratos'
import './PonentePerfilPage.css'

export default function PonentePerfilPage() {
  const { slug = '' } = useParams()
  const ponente = ponentePorSlug(slug)

  // El hook va antes del return condicional: no puede quedar detrás de una
  // salida temprana. Con el ponente ausente recibe undefined y no hace nada.
  useTituloPagina(ponente?.nombre)

  if (!ponente) return <Navigate to="/ponentes" replace />

  const intervenciones = intervencionesDe(ponente.slug)
  const retrato = retratoDe(ponente.slug)
  const indice = PONENTES.findIndex((p) => p.slug === ponente.slug)
  const anterior = PONENTES[indice - 1]
  const siguiente = PONENTES[indice + 1]

  /*
   * El programa se define una vez y se coloca en uno de dos sitios, según haya
   * biografía o no. No es un capricho: el retrato ocupa exactamente el alto de
   * la columna de texto, así que esa columna tiene que tener contenido.
   *
   *   con biografía → la columna ya está llena; el programa va debajo, a ancho
   *                   completo, que es donde mejor se lee una tabla de horas.
   *   sin biografía → la columna serían dos líneas y el retrato quedaría
   *                   flotando contra medio metro de vacío; el programa sube a
   *                   su sitio y la página entra de una sola pantalla.
   *
   * Es la misma asimetría 6/5 de los datos, resuelta en la maqueta en vez de
   * disimulada con un hueco.
   */
  const programa = (
    <div className="gt-lamina gt-perfil__programa">
      <SectionTitle
        apunte={
          intervenciones.length === 1 ? '1 intervención' : `${intervenciones.length} intervenciones`
        }
      >
        En el programa
      </SectionTitle>

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
              <p className="gt-chip gt-perfil__papel">{ETIQUETA_PAPEL[papel]}</p>
            </li>
          )
        })}
      </ul>
    </div>
  )

  return (
    <article className="gt-perfil gt-grano">
      {/* Dos columnas y nada más: el retrato a la izquierda, estirado al alto
          exacto de la columna de texto, y a la derecha el nombre, el cargo y lo
          que sepamos de la persona. */}
      <header className="gt-contenedor gt-perfil__intro">
        {/* El retrato no lleva `alt`: el nombre va escrito justo al lado como
            h1, así que describirlo otra vez solo añade ruido al lector de
            pantalla. Mientras no llegue la foto, el monograma ocupa su sitio
            con la misma forma. */}
        {retrato ? (
          <PhotoFrame
            className="gt-perfil__retrato"
            src={retrato.vertical.src}
            srcSet={retrato.vertical.srcSet}
            alt=""
            tratamiento="retrato"
            ratio="4 / 5"
            contorno="var(--gt-celeste)"
            prioridad
            transicion={transicionRetrato(ponente.slug)}
          />
        ) : (
          /* Mientras no llegue la foto, una placa que ocupa su sitio exacto:
             misma columna, mismo alto, misma forma en «hoja» y el mismo
             contorno desplazado. Dos motivos, y ninguno es decorativo.

             Uno, la maqueta no se mueve el día que llegue el retrato lo que
             hay ahora es lo que habrá. Y dos, un monograma de 128 px en una
             columna de 460 deja un hueco de media página, que es justo lo que
             hace que una ficha se lea como una plantilla a la que le falta un
             trozo. */
          <div
            className="gt-perfil__retrato gt-perfil__placa gt-grano gt-retrato-vt"
            style={{ '--gt-vt': transicionRetrato(ponente.slug) } as CSSProperties}
            aria-hidden="true"
          >
            <span className="gt-perfil__iniciales">{iniciales(ponente.nombre)}</span>
          </div>
        )}

        <div className="gt-perfil__texto">
          <div className="gt-perfil__identidad">
            <h1 className="gt-perfil__nombre">{ponente.nombre}</h1>
            <p className="gt-perfil__cargo">{ponente.cargo}</p>
          </div>

          <span className="gt-perfil__regla" aria-hidden="true" />

          {/* Sin biografía no se pinta nada: ni cartel de «no disponible» ni
              caja vacía. El día que llegue el texto se pega en foro.ts y la
              maqueta se reacomoda sola. */}
          {ponente.bio ? (
            <div className="gt-perfil__bio">
              <Parrafos contenido={ponente.bio.map((parrafo) => [parrafo])} />
            </div>
          ) : (
            programa
          )}
        </div>
      </header>

      <div className="gt-contenedor gt-perfil__cuerpo">
        {ponente.bio && programa}

        <nav className="gt-perfil__nav" aria-label="Otros ponentes">
          {anterior ? (
            <Link className="gt-perfil__salto" to={`/ponentes/${anterior.slug}`} rel="prev" viewTransition>
              <span className="gt-dato gt-perfil__salto-dir">← Anterior</span>
              <span className="gt-perfil__salto-persona">
                {/* Nombrada también: así saltar al perfil vecino mueve su
                    miniatura hasta la cabecera en vez de cortar en seco. Los
                    tres nombres de esta página son distintos, que es la
                    condición para que el navegador no descarte la transición. */}
                <Monogram
                  nombre={anterior.nombre}
                  foto={retratoDe(anterior.slug)?.cuadrado}
                  tamano="xs"
                  transicion={transicionRetrato(anterior.slug)}
                />
                <span className="gt-perfil__salto-nombre">{anterior.nombre}</span>
              </span>
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
              <span className="gt-perfil__salto-persona">
                <Monogram
                  nombre={siguiente.nombre}
                  foto={retratoDe(siguiente.slug)?.cuadrado}
                  tamano="xs"
                  transicion={transicionRetrato(siguiente.slug)}
                />
                <span className="gt-perfil__salto-nombre">{siguiente.nombre}</span>
              </span>
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </div>
    </article>
  )
}

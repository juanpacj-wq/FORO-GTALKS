import { Fragment } from 'react'
import type { Parrafo } from '../data/foro'

/**
 * Pinta los párrafos del copy respetando la negrita que traen las piezas.
 *
 * El copy se guarda como fragmentos tipados en vez de como HTML o markdown
 * para no tener que parsear nada ni usar `dangerouslySetInnerHTML`.
 */
export default function Parrafos({
  contenido,
  className = '',
}: {
  contenido: Parrafo[]
  className?: string
}) {
  return (
    <>
      {contenido.map((parrafo, i) => (
        <p key={i} className={className}>
          {parrafo.map((frag, j) => (
            <Fragment key={j}>
              {typeof frag === 'string' ? frag : <strong>{frag.fuerte}</strong>}
            </Fragment>
          ))}
        </p>
      ))}
    </>
  )
}

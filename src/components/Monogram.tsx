import type { CSSProperties } from 'react'
import { iniciales } from '../data/foro'
import './Monogram.css'

/**
 * La caja pequeña de una persona: su retrato, o sus iniciales mientras el
 * retrato no exista.
 *
 * Va siempre en la forma en «hoja» del sistema y nunca en un círculo. El
 * círculo con iniciales es el relleno por defecto de cualquier sitio; la hoja
 * es la misma forma que el marco de las fotos, así que la ausencia se lee como
 * decisión y no como un hueco. Es la caja de tres sitiosel índice de
 * ponentes, el roster de la home y el programa—, y por eso vive aquí en vez de
 * reimplementarse en cada uno.
 *
 * Es decorativa (`aria-hidden`): el nombre completo va siempre escrito al lado.
 *
 * Con retrato no devuelve un `<img>` pelado sino el mismo `<span>` de siempre
 * con la imagen dentro. Dos razones: los selectores de hover de quien la
 * contiene siguen encontrando `.gt-monograma`, y el `<span>` aporta los dos
 * pseudoelementos que necesita el tratamiento de retratodos modos de fusión
 * distintos piden dos capas—.
 */
export default function Monogram({
  nombre,
  foto,
  tamano = 'sm',
  transicion,
}: {
  nombre: string
  /** La variante cuadrada del manifiesto (`retratoDe(slug)?.cuadrado`). */
  foto?: { src: string; srcSet: string }
  tamano?: 'xs' | 'sm' | 'lg'
  /** Identidad para la View Transition; ver `transicionRetrato()`. */
  transicion?: string
}) {
  const clases = ['gt-monograma', `gt-monograma--${tamano}`]
  if (foto) clases.push('gt-monograma--foto')
  if (transicion) clases.push('gt-retrato-vt')
  const style = transicion ? ({ '--gt-vt': transicion } as CSSProperties) : undefined

  if (foto) {
    return (
      <span className={clases.join(' ')} style={style} aria-hidden="true">
        <img
          className="gt-monograma__img"
          src={foto.src}
          srcSet={foto.srcSet}
          alt=""
          loading="lazy"
          decoding="async"
        />
      </span>
    )
  }

  return (
    <span className={clases.join(' ')} style={style} aria-hidden="true">
      {iniciales(nombre)}
    </span>
  )
}

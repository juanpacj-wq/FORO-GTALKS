import { iniciales } from '../data/foro'
import './Monogram.css'

/**
 * Avatar de monograma: las iniciales dentro de la forma en «hoja» del sistema,
 * no en un círculo. Ninguna pieza trae fotos de los ponentes (pendiente #2), y
 * un círculo con iniciales es el relleno por defecto de cualquier sitio; la
 * hoja, en cambio, es la misma forma que el marco de las fotos, así que la
 * ausencia se lee como decisión.
 *
 * La prop `foto` ya está prevista para cuando lleguen: en cuanto se pase una
 * ruta, el componente la usa y no hay que tocar nada más.
 */
export default function Monogram({
  nombre,
  foto,
  tamano = 'md',
}: {
  nombre: string
  /** Ruta de la foto, cuando exista. Mientras tanto se ve el monograma. */
  foto?: string
  tamano?: 'sm' | 'md' | 'lg'
}) {
  if (foto) {
    return (
      <img
        className={`gt-monograma gt-monograma--${tamano} gt-monograma--foto`}
        src={foto}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
      />
    )
  }

  return (
    <span className={`gt-monograma gt-monograma--${tamano}`} aria-hidden="true">
      {iniciales(nombre)}
    </span>
  )
}

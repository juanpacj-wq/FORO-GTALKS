import type { CSSProperties } from 'react'
import './PhotoFrame.css'

/**
 * Marco de foto con el radio asimétrico del sistema.
 *
 * Medido en las tres piezas: 101.9 pt de radio en la esquina superior-izquierda
 * y en la inferior-derecha, y 0 en las otras dos. Es la forma en «hoja» que
 * caracteriza al sistema. La variante `der` la refleja, que es como aparece en
 * `invitación expertos.pdf`.
 *
 * El tratamiento `duotono` no es un filtro decorativo: las tres fotos vienen
 * incrustadas en los PDF a baja resolución (456×652 la mayor) y con una
 * dominante naranja de atardecer que pelea con el celeste de la marca. El
 * duotono navy→celeste resuelve las dos cosas a la vez —unifica la paleta y
 * disimula la falta de detalle— y hace que la foto se lea como decisión
 * gráfica y no como un JPG pequeño estirado.
 */
export default function PhotoFrame({
  src,
  srcSet,
  alt,
  variante = 'izq',
  tratamiento = 'duotono',
  contorno,
  ratio,
  prioridad = false,
  className = '',
}: {
  src: string
  /** Variantes por densidad, p. ej. `foto.webp 1x, foto@2x.webp 2x`. */
  srcSet?: string
  alt: string
  /** `izq`: radio arriba-izquierda y abajo-derecha. `der`: reflejado. */
  variante?: 'izq' | 'der'
  /** `duotono`: navy→celeste. `natural`: la foto tal cual, solo recortada. */
  tratamiento?: 'duotono' | 'natural'
  /** Color del contorno desplazado de 1 pt. Sin valor, no se dibuja. */
  contorno?: string
  /** Proporción del recorte, p. ej. `4 / 5`. Sin valor, la de la imagen. */
  ratio?: string
  /**
   * Para la foto del hero. Es el elemento más grande de la primera pantalla,
   * o sea el LCP: cargarla en diferido —el default de este componente— retrasa
   * justo la métrica que mide cuándo la página «aparece».
   */
  prioridad?: boolean
  className?: string
}) {
  return (
    <figure
      className={`gt-marco gt-marco--${variante} gt-marco--${tratamiento} ${className}`}
      style={{ '--gt-marco-ratio': ratio } as CSSProperties}
    >
      {contorno && (
        <span className="gt-marco__contorno" aria-hidden="true" style={{ borderColor: contorno }} />
      )}
      <span className="gt-marco__lienzo">
        <img
          className="gt-marco__img"
          src={src}
          srcSet={srcSet}
          alt={alt}
          loading={prioridad ? 'eager' : 'lazy'}
          fetchPriority={prioridad ? 'high' : undefined}
          decoding={prioridad ? 'sync' : 'async'}
        />
        <span className="gt-marco__tinte" aria-hidden="true" />
        <span className="gt-marco__grano" aria-hidden="true" />
      </span>
    </figure>
  )
}

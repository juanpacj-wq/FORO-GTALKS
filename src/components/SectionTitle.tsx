import type { ReactNode } from 'react'
import './SectionTitle.css'

/**
 * Título de sección: el texto a la izquierda, un hairline que ocupa lo que
 * sobra y, si se le pasa, un apunte de dato al final de la línea.
 *
 * En las piezas el título va centrado entre dos reglas de 1 pt. Centrado
 * funciona en una vertical impresa de 612 pt; en pantalla ancha deja el título
 * flotando en medio de la nada, así que se ancla a la izquierda y la regla
 * hace de riel hasta el borde. El apunte es dato real (la duración de la
 * jornada, cuántos ponentes), nunca una etiqueta decorativa.
 */
export default function SectionTitle({
  children,
  id,
  apunte,
  como: Como = 'h2',
}: {
  children: ReactNode
  id?: string
  /** Dato al final del riel, p. ej. «8:30 a.m. – 4:30 p.m.». */
  apunte?: string
  como?: 'h1' | 'h2' | 'h3'
}) {
  return (
    <div className="gt-titulo-seccion">
      <Como id={id} className="gt-titulo-seccion__texto">
        {children}
      </Como>
      <span className="gt-titulo-seccion__riel" aria-hidden="true" />
      {apunte && <span className="gt-titulo-seccion__apunte gt-dato">{apunte}</span>}
    </div>
  )
}

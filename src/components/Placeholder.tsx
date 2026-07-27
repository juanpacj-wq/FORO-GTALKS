import type { ReactNode } from 'react'
import './Placeholder.css'

/**
 * Sección todavía sin contenido definido.
 *
 * No es una página vacía con un «Próximamente»: dice qué va a aparecer, de
 * dónde van a salir los datos y qué tendrá que hacer quien entre. Los pasos van
 * numerados porque son una secuencia real, no un adorno.
 */
export default function Placeholder({
  titulo,
  estado,
  pasos,
  children,
}: {
  titulo: string
  /** Cuándo estará, si se sabe. */
  estado?: string
  /** Secuencia de lo que ocurrirá, en orden. */
  pasos?: string[]
  children?: ReactNode
}) {
  return (
    <div className="gt-placeholder">
      <div className="gt-placeholder__texto">
        <h2 className="gt-placeholder__titulo">{titulo}</h2>
        {children && <div className="gt-placeholder__cuerpo">{children}</div>}
        {estado && <p className="gt-chip gt-placeholder__estado">{estado}</p>}
      </div>

      {pasos && (
        <ol className="gt-placeholder__pasos">
          {pasos.map((paso, i) => (
            <li className="gt-placeholder__paso" key={paso}>
              <span className="gt-dato gt-placeholder__numero" aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span>{paso}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

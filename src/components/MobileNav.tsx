import { useEffect, useRef } from 'react'
import { NavLink } from 'react-router-dom'
import { NAV, type Ancla } from '../data/navegacion'
import SesionMenu from './SesionMenu'
import './MobileNav.css'

const FOCUSABLES = 'a[href], button:not([disabled])'

/**
 * Panel de navegación deslizante para móvil.
 *
 * Cumple lo que se espera de un diálogo modal: cierra con Esc y con clic
 * fuera, atrapa el foco dentro mientras está abierto, bloquea el scroll del
 * fondo y devuelve el foco al botón que lo abrió.
 */
export default function MobileNav({
  abierto,
  onCerrar,
  anclas,
}: {
  abierto: boolean
  onCerrar: () => void
  /** El riel de la página actual (home, galería): sus anclas se listan también aquí. */
  anclas: readonly Ancla[]
}) {
  const panel = useRef<HTMLDivElement>(null)
  const origenFoco = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!abierto) return

    origenFoco.current = document.activeElement as HTMLElement | null
    const overflowPrevio = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // El primer enlace recibe el foco al abrir.
    panel.current?.querySelector<HTMLElement>(FOCUSABLES)?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCerrar()
        return
      }
      if (e.key !== 'Tab' || !panel.current) return

      const focusables = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLES))
      if (focusables.length === 0) return
      const primero = focusables[0]
      const ultimo = focusables[focusables.length - 1]

      if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault()
        ultimo.focus()
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault()
        primero.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = overflowPrevio
      origenFoco.current?.focus()
    }
  }, [abierto, onCerrar])

  if (!abierto) return null

  return (
    <div
      className="gt-navmovil"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar()
      }}
    >
      <div
        className="gt-navmovil__panel"
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Menú de navegación"
      >
        <button className="gt-navmovil__cerrar" type="button" onClick={onCerrar}>
          <span className="gt-oculto-visual">Cerrar el menú</span>
          <span aria-hidden="true">×</span>
        </button>

        <nav>
          <ul className="gt-navmovil__lista">
            {NAV.map((item) => (
              <li key={item.ruta}>
                <NavLink className="gt-navmovil__enlace" to={item.ruta} end onClick={onCerrar} viewTransition>
                  {item.etiqueta}
                </NavLink>
              </li>
            ))}
          </ul>

          {anclas.length > 0 && (
            <ul className="gt-navmovil__anclas">
              {anclas.map((a) => (
                <li key={a.id}>
                  <a className="gt-navmovil__ancla" href={`#${a.id}`} onClick={onCerrar}>
                    {a.etiqueta}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </nav>

        <SesionMenu variante="movil" />
      </div>
    </div>
  )
}

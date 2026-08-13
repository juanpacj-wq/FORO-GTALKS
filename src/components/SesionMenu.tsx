import { useEffect, useRef, useState } from 'react'
import { iniciales } from '../data/foro'
import { useSesion } from '../data/sesion'
import './SesionMenu.css'

/**
 * Quién entró, y cómo salir.
 *
 * Muestra el nombre y el cargo de la persona autenticada, y da las dos salidas que hacen falta:
 * cambiar de cuentael tropiezo más probable de un ponente externo, que suele llegar ya
 * autenticado con su propio Microsoft y cerrar sesión.
 *
 * Las dos acciones son enlaces de navegación, no `fetch`: cerrar sesión tiene que llevar al
 * front-channel logout de Microsoft para que la sesión muera también en Entra, y eso solo lo
 * consigue una navegación de primer nivel. Un POST por detrás dejaría la sesión de Microsoft viva
 * y el siguiente visitante entraría solo.
 *
 * Si el sitio se sirve sin gate (preview, capturas) no se pinta nada.
 */
export default function SesionMenu({ variante = 'header' }: { variante?: 'header' | 'movil' }) {
  const sesion = useSesion()
  const [abierto, setAbierto] = useState(false)
  const caja = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!abierto) return
    const alPulsar = (e: MouseEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false)
    }
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false)
    }
    document.addEventListener('mousedown', alPulsar)
    document.addEventListener('keydown', alTeclear)
    return () => {
      document.removeEventListener('mousedown', alPulsar)
      document.removeEventListener('keydown', alTeclear)
    }
  }, [abierto])

  if (sesion.estado !== 'dentro') return null
  const { usuario } = sesion

  // El cargo puede no existir (invitado B2B, Graph caído): el correo es el respaldo honesto.
  const segundaLinea = usuario.cargo || usuario.email || usuario.upn

  if (variante === 'movil') {
    return (
      <div className="gt-sesion gt-sesion--movil">
        <p className="gt-dato gt-sesion__rotulo">Tu sesión</p>
        <p className="gt-sesion__nombre">{usuario.nombre_completo}</p>
        <p className="gt-sesion__cargo">{segundaLinea}</p>
        <a className="gt-sesion__accion" href="/auth/login?select=1">
          Cambiar de cuenta
        </a>
        <a className="gt-sesion__accion gt-sesion__accion--salir" href="/auth/logout">
          Cerrar sesión
        </a>
      </div>
    )
  }

  return (
    <div className="gt-sesion" ref={caja}>
      <button
        className="gt-sesion__boton"
        type="button"
        aria-expanded={abierto}
        aria-haspopup="menu"
        onClick={() => setAbierto((v) => !v)}
      >
        <span className="gt-sesion__inicial" aria-hidden="true">
          {iniciales(usuario.nombre_completo)}
        </span>
        <span className="gt-sesion__texto">
          <span className="gt-sesion__nombre">{usuario.nombre_completo}</span>
          <span className="gt-sesion__cargo">{segundaLinea}</span>
        </span>
        <span className="gt-sesion__chevron" aria-hidden="true" />
      </button>

      {abierto && (
        <div className="gt-sesion__panel" role="menu">
          <p className="gt-sesion__panel-nombre">{usuario.nombre_completo}</p>
          {usuario.cargo && <p className="gt-sesion__panel-cargo">{usuario.cargo}</p>}
          {usuario.area && <p className="gt-sesion__panel-area">{usuario.area}</p>}
          <p className="gt-sesion__panel-correo">{usuario.email || usuario.upn}</p>

          <a className="gt-sesion__accion" href="/auth/login?select=1" role="menuitem">
            Cambiar de cuenta
          </a>
          <a
            className="gt-sesion__accion gt-sesion__accion--salir"
            href="/auth/logout"
            role="menuitem"
          >
            Cerrar sesión
          </a>
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { ANCLAS, NAV, type AnclaId } from '../data/navegacion'
import { EVENTO } from '../data/foro'
import Icono from './Icono'
import MobileNav from './MobileNav'
import SesionMenu from './SesionMenu'
import './SiteHeader.css'

/**
 * Resalta la sección visible dentro de la home.
 *
 * En cada disparo del observer se recalcula la posición de las tres secciones y
 * se toma la última que ya cruzó el 40% superior del viewport. Se hace así, y
 * no quedándose con la entrada que disparó el callback, porque cuando dos
 * secciones entran a la vez el orden de las entradas no es fiable y el
 * resaltado parpadea.
 */
function useScrollspy(activo: boolean): AnclaId | null {
  const [visible, setVisible] = useState<AnclaId | null>(null)

  useEffect(() => {
    if (!activo) {
      setVisible(null)
      return
    }

    const secciones = ANCLAS.map((a) => document.getElementById(a.id)).filter(
      (el): el is HTMLElement => el !== null,
    )
    if (secciones.length === 0) return

    const observer = new IntersectionObserver(
      () => {
        const enPantalla = secciones
          .map((el) => ({ id: el.id as AnclaId, top: el.getBoundingClientRect().top }))
          .filter(({ top }) => top < window.innerHeight * 0.4)
        setVisible(enPantalla.length ? enPantalla[enPantalla.length - 1].id : ANCLAS[0].id)
      },
      { rootMargin: '-40% 0px -55% 0px', threshold: [0, 1] },
    )

    secciones.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [activo])

  return visible
}

/**
 * `true` en cuanto la página baja del hero.
 *
 * Sobre el hero el header va transparenteel campo oscuro ya es su fondo,
 * pero más abajo pasa por encima de la lámina blanca del programa y necesita
 * su propio plano para que el texto blanco se siga leyendo.
 */
function useDesplazado(umbral = 80) {
  const [desplazado, setDesplazado] = useState(false)

  useEffect(() => {
    const alScroll = () => setDesplazado(window.scrollY > umbral)
    alScroll()
    window.addEventListener('scroll', alScroll, { passive: true })
    return () => window.removeEventListener('scroll', alScroll)
  }, [umbral])

  return desplazado
}

export default function SiteHeader() {
  const { pathname } = useLocation()
  const [menuAbierto, setMenuAbierto] = useState(false)
  const enHome = pathname === '/'
  const seccionActiva = useScrollspy(enHome)
  const desplazado = useDesplazado()

  return (
    <>
      {/* Fuera de la home no hay hero oscuro debajo: la barra va sólida desde
          el primer píxel en vez de esperar al scroll. */}
      <header className={`gt-header ${!enHome || desplazado ? 'gt-header--solido' : ''}`}>
        <div className="gt-header__barra gt-contenedor">
          <Link className="gt-header__marca" to="/" aria-label={`${EVENTO.marca} ir al inicio`}>
            <Icono nombre="icono-burbujas" alto="1.6rem" />
            <Icono nombre="wordmark-g-talks" alto="0.85rem" />
          </Link>

          <nav className="gt-header__nav" aria-label="Principal">
            <ul>
              {NAV.map((item) => (
                <li key={item.ruta}>
                  <NavLink className="gt-header__enlace" to={item.ruta} end viewTransition>
                    {item.etiqueta}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          {/* Quién entró y cómo salir. No se pinta si el sitio se sirve sin gate. */}
          <SesionMenu />

          <button
            className="gt-header__hamburguesa"
            type="button"
            aria-expanded={menuAbierto}
            onClick={() => setMenuAbierto(true)}
          >
            <span className="gt-oculto-visual">Abrir el menú</span>
            <span className="gt-header__rayas" aria-hidden="true" />
          </button>
        </div>

        {enHome && (
          <nav className="gt-header__anclas" aria-label="Secciones de esta página">
            <ul className="gt-contenedor">
              {ANCLAS.map((a) => (
                <li key={a.id}>
                  <a
                    className="gt-header__ancla"
                    href={`#${a.id}`}
                    aria-current={seccionActiva === a.id ? 'true' : undefined}
                  >
                    {a.etiqueta}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>

      <MobileNav abierto={menuAbierto} onCerrar={() => setMenuAbierto(false)} enHome={enHome} />
    </>
  )
}

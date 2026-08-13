import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { anclasDe, NAV, type Ancla } from '../data/navegacion'
import { EVENTO } from '../data/foro'
import Icono from './Icono'
import MobileNav from './MobileNav'
import SesionMenu from './SesionMenu'
import './SiteHeader.css'

/**
 * Resalta la sección visible dentro de la página que tenga riel (la home y la
 * galería, según `anclasDe`).
 *
 * En cada recálculo se mide la posición de las secciones y se toma la última
 * que ya cruzó el 40% superior del viewport. El recálculo va atado al SCROLL
 * (con rAF), no a un IntersectionObserver: el observer solo dispara cuando una
 * sección CRUZA su banda observada, pero la decisión usa otra línea ese 40%,
 * y entre el último cruce y el reposo del scroll la respuesta correcta puede
 * cambiar sin que haya evento. Con las secciones de /galeria eso dejaba el riel
 * marcando «Descargar contenido» con «Resumen de jornada» ya arriba (medido por
 * interactions-test); en la home no pasaba por pura geometría de sus secciones.
 */
function useScrollspy(anclas: readonly Ancla[]): string | null {
  const [visible, setVisible] = useState<string | null>(null)

  useEffect(() => {
    if (anclas.length === 0) {
      setVisible(null)
      return
    }

    const secciones = anclas
      .map((a) => document.getElementById(a.id))
      .filter((el): el is HTMLElement => el !== null)
    if (secciones.length === 0) return

    let marco = 0
    const recalcular = () => {
      marco = 0
      const enPantalla = secciones
        .map((el) => ({ id: el.id, top: el.getBoundingClientRect().top }))
        .filter(({ top }) => top < window.innerHeight * 0.4)
      setVisible(enPantalla.length ? enPantalla[enPantalla.length - 1].id : anclas[0].id)
    }
    const alMoverse = () => {
      if (!marco) marco = requestAnimationFrame(recalcular)
    }

    recalcular()
    window.addEventListener('scroll', alMoverse, { passive: true })
    window.addEventListener('resize', alMoverse)
    return () => {
      cancelAnimationFrame(marco)
      window.removeEventListener('scroll', alMoverse)
      window.removeEventListener('resize', alMoverse)
    }
  }, [anclas])

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
  const anclas = anclasDe(pathname)
  const seccionActiva = useScrollspy(anclas)
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

        {anclas.length > 0 && (
          <nav className="gt-header__anclas" aria-label="Secciones de esta página">
            <ul className="gt-contenedor">
              {anclas.map((a) => (
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

      <MobileNav abierto={menuAbierto} onCerrar={() => setMenuAbierto(false)} anclas={anclas} />
    </>
  )
}

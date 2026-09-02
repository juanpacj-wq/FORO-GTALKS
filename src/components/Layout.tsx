import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import SiteHeader from './SiteHeader'
import SiteFooter from './SiteFooter'

const TITULO_BASE = '1° Foro GECELCA Energía en Acción'

/** Títulos por ruta. Las rutas dinámicas ponen el suyo con `useTituloPagina`. */
const TITULOS: Record<string, string> = {
  '/': TITULO_BASE,
  '/ponentes': `Ponentes ${TITULO_BASE}`,
  '/escarapela': `Escarapela ${TITULO_BASE}`,
  '/encuestas': `Encuestas ${TITULO_BASE}`,
  '/certificado': `Certificado ${TITULO_BASE}`,
  '/galeria': `Memorias del evento ${TITULO_BASE}`,
  '/cdpadmin': `Cartas de presentación ${TITULO_BASE}`,
  // /carta_presentacion/:id pone el nombre de la persona con `useTituloPagina`.
}

/** Deja que una página fije su propio `<title>`, para las rutas dinámicas. */
export function useTituloPagina(titulo: string | undefined) {
  useEffect(() => {
    if (titulo) document.title = `${titulo} ${TITULO_BASE}`
  }, [titulo])
}

export default function Layout() {
  const { pathname, hash } = useLocation()

  useEffect(() => {
    const titulo = TITULOS[pathname]
    if (titulo) document.title = titulo
  }, [pathname])

  // Al cambiar de ruta se sube arriba, salvo que la URL apunte a un ancla: en
  // ese caso manda el ancla. El `scroll-behavior` del CSS ya respeta
  // prefers-reduced-motion, así que aquí no hay que volver a comprobarlo.
  useEffect(() => {
    if (!hash) {
      window.scrollTo(0, 0)
      return
    }

    const destino = document.getElementById(hash.slice(1))
    if (!destino) return
    destino.scrollIntoView()

    // `:target` solo lo actualiza una navegación de fragmento real; con el
    // pushState del router se queda sin aplicar. Al llegar desde otra ruta hay
    // que marcar el destino a mano para que el bloque se resalte igual que al
    // pulsar una barra de la curva.
    destino.setAttribute('data-marcado', '')
    return () => destino.removeAttribute('data-marcado')
  }, [pathname, hash])

  return (
    <>
      <a className="gt-saltar" href="#contenido">
        Saltar al contenido
      </a>
      <SiteHeader />
      <main id="contenido">
        <Outlet />
      </main>
      <SiteFooter />
    </>
  )
}

import { useEffect, useRef } from 'react'
import type { FotoGaleria } from '../design/galeria'
import './VisorFotos.css'

/**
 * El visor a pantalla completa. Es un `<dialog>` nativo a propósito: `showModal`
 * pone el fondo inerte, atrapa el foco, cierra con Escape y devuelve el foco al
 * elemento que lo abrió, todo sin una línea de código propio el mismo trabajo
 * que MobileNav hace a mano porque nació antes. Aquí la foto se enseña ENTERA
 * (`object-fit: contain`): el abanico y la rejilla recortan a 3:2 por
 * composición, y este es el sitio donde las cuatro verticales se ven completas.
 *
 * Las flechas del teclado navegan sin cerrar. El clic fuera de la foto cierra:
 * `e.target` solo es el propio dialog cuando el clic cayó en su backdrop o en
 * su padding, nunca dentro de la figura.
 */
export default function VisorFotos({
  fotos,
  indice,
  alNavegar,
  alCerrar,
}: {
  fotos: readonly FotoGaleria[]
  indice: number
  alNavegar: (indice: number) => void
  alCerrar: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const foto = fotos[indice]
  // Circular, como el abanico: tras la última viene la primera y viceversa.
  const irA = (destino: number) =>
    alNavegar(((destino % fotos.length) + fotos.length) % fotos.length)

  useEffect(() => {
    const dialogo = ref.current
    if (dialogo && !dialogo.open) dialogo.showModal()
  }, [])

  const alTeclado = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') irA(indice - 1)
    else if (e.key === 'ArrowRight') irA(indice + 1)
    else return
    e.preventDefault()
  }

  return (
    <dialog
      className="gt-visor"
      ref={ref}
      aria-label={`Fotografía ${indice + 1} de ${fotos.length}, tomada a las ${foto.hora}`}
      onClose={alCerrar}
      onKeyDown={alTeclado}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close()
      }}
    >
      <figure className="gt-visor__figura">
        {/* La key fuerza un <img> nuevo por foto: sin ella, navegar deja la
            anterior pintada mientras llega la siguiente y el visor «miente»
            durante la carga. */}
        <img
          key={foto.id}
          src={foto.src}
          width={foto.ancho}
          height={foto.alto}
          alt={`Fotografía del foro tomada a las ${foto.hora}`}
          decoding="async"
        />
        <figcaption className="gt-visor__pie">
          <span className="gt-visor__hora">{foto.hora}</span>
          <span aria-hidden="true">
            {indice + 1} / {fotos.length}
          </span>
        </figcaption>
      </figure>

      <button
        type="button"
        className="gt-visor__cerrar"
        onClick={() => ref.current?.close()}
      >
        <span className="gt-oculto-visual">Cerrar el visor</span>
        <span aria-hidden="true">×</span>
      </button>

      <button
        type="button"
        className="gt-visor__paso gt-visor__paso--anterior"
        onClick={() => irA(indice - 1)}
        aria-label="Fotografía anterior"
      >
        <span aria-hidden="true">→</span>
      </button>
      <button
        type="button"
        className="gt-visor__paso gt-visor__paso--siguiente"
        onClick={() => irA(indice + 1)}
        aria-label="Siguiente fotografía"
      >
        <span aria-hidden="true">→</span>
      </button>
    </dialog>
  )
}

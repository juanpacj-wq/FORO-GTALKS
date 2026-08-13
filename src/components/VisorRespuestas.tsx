import { useEffect, useRef } from 'react'
import { RESPUESTAS_PAGINAS, RESPUESTAS_PDF } from '../design/respuestas'
import './VisorRespuestas.css'

/**
 * El visor de las respuestas de los panelistas: un `<dialog>` nativo —el mismo
 * chasis del visor de la galería: fondo inerte, Escape, foco atrapado y
 * devuelto gratis— con las páginas de la pieza apiladas para leer de corrido y
 * la descarga del PDF en la barra.
 *
 * Las páginas son IMÁGENES y no un `<iframe>` del PDF a propósito: la CSP del
 * sitio (`default-src 'none'`, sin `frame-src`) bloquea cualquier documento
 * incrustado, y aflojarla por una pieza sería cambiar la política de todo el
 * HTML. Los webp viajan por `img-src 'self'`, que ya está. Quien prefiera el
 * documento de verdad —o lo lea con lector de pantalla, porque una imagen de
 * texto no se puede oír— tiene el PDF completo en «Descargar PDF».
 */
export default function VisorRespuestas({ alCerrar }: { alCerrar: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialogo = ref.current
    if (dialogo && !dialogo.open) dialogo.showModal()
  }, [])

  return (
    <dialog
      className="gt-respuestas"
      ref={ref}
      aria-label="Respuestas de los panelistas"
      onClose={alCerrar}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close()
      }}
    >
      <div className="gt-respuestas__marco">
        <header className="gt-respuestas__barra">
          <p className="gt-respuestas__titulo">Respuestas de los panelistas</p>

          <a
            className="gt-boton gt-boton--solido gt-respuestas__descarga"
            href={RESPUESTAS_PDF}
            download="Respuestas preguntas pendientes panelistas.pdf"
          >
            Descargar PDF
          </a>

          <button
            type="button"
            className="gt-respuestas__cerrar"
            onClick={() => ref.current?.close()}
          >
            <span className="gt-oculto-visual">Cerrar el visor</span>
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="gt-respuestas__paginas">
          {RESPUESTAS_PAGINAS.map((pagina, i) => (
            <img
              key={pagina.src}
              src={pagina.src}
              srcSet={pagina.srcSet}
              width={pagina.ancho}
              height={pagina.alto}
              alt={`Respuestas de los panelistas, página ${i + 1} de ${RESPUESTAS_PAGINAS.length}`}
              loading={i === 0 ? 'eager' : 'lazy'}
              decoding="async"
            />
          ))}
        </div>
      </div>
    </dialog>
  )
}

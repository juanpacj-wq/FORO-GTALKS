import { useEffect, useState } from 'react'
import Monogram from '../components/Monogram'
import PhotoFrame from '../components/PhotoFrame'
import QrTarjeta from './QrTarjeta'
import { NOMBRE_RED, REDES, formatoTelefono, nombreCompleto, srcFoto, type PerfilPublico } from './tipos'
import './Tarjeta.css'

/**
 * La tarjeta de presentación: la pieza que abre quien escanea el QR o recibe el enlace.
 *
 * La misma en la página pública y en la previsualización del panel, por eso el encabezado se
 * pasa por `nivel`: en la pública el nombre ES el h1 de la página; en el panel el h1 es el
 * título de la sección y la tarjeta baja a h3. Un `view-transition-name` no hace falta aquí:
 * ninguna otra página enseña esta misma foto.
 *
 * Composición: el retrato y la lámina con los datos van juntos (la lámina es el papel del
 * sistema, `.gt-lamina`), y las acciones van DEBAJO, sobre el campo oscuro, porque `.gt-boton`
 * está pintado para el campo oscuro (celeste sobre navy) y sobre lámina daría 1.72:1.
 *
 * Todo lo que sale del sitio va con `--externo` y `rel="noopener noreferrer"`: sin `noopener` la
 * pestaña de destino puede reescribir la de origen. «Guardar contacto» es una navegación al
 * vCard del servidor (`<a download>`): cero JavaScript, y el servidor pone el
 * `Content-Disposition`. «Compartir» usa `navigator.share` donde exista (teléfonos) y, si no,
 * copia el enlace y lo dice en una región de estado.
 *
 * Sin `Icono` en las filas de datos: el catálogo de símbolos del sistema sale de los PDF del
 * foro y no trae teléfono ni sobre; inventarlos a ojo iría contra la regla del repo. Los datos
 * van con su rótulo en `.gt-dato`, que es como el pie de página y la ficha del hero rotulan.
 */
export default function Tarjeta({
  perfil,
  nivel: Nivel = 'h1',
  qr = true,
}: {
  perfil: PerfilPublico
  nivel?: 'h1' | 'h2' | 'h3'
  /** Sin QR (el panel lo pinta aparte, con sus descargas). */
  qr?: boolean
}) {
  const nombre = nombreCompleto(perfil)
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    if (!copiado) return
    const t = window.setTimeout(() => setCopiado(false), 4000)
    return () => clearTimeout(t)
  }, [copiado])

  async function compartir() {
    const datos = { title: `${nombre} · GECELCA`, text: `${nombre}, ${perfil.cargo}`, url: perfil.url }
    if (typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare(datos))) {
      try {
        await navigator.share(datos)
        return
      } catch (err) {
        // Cerrar la hoja de compartir no es un fallo; cualquier otra cosa cae a copiar.
        if ((err as DOMException)?.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(perfil.url)
      setCopiado(true)
    } catch {
      setCopiado(false)
    }
  }

  const redes = REDES.filter((r) => perfil.redes[r])
  const whatsappDigitos = perfil.whatsapp ? perfil.whatsapp.replace(/\D/g, '') : null

  return (
    <article className="gt-tarjeta" aria-label={`Carta de presentación de ${nombre}`}>
      <div className="gt-tarjeta__cuerpo">
        <div className="gt-tarjeta__retrato">
          {perfil.foto ? (
            // alt vacío a propósito: el nombre va escrito al lado, en el encabezado.
            <PhotoFrame
              src={srcFoto(perfil.foto)}
              alt=""
              tratamiento="natural"
              ratio="4 / 5"
              contorno="var(--gt-celeste)"
              prioridad
            />
          ) : (
            <div className="gt-tarjeta__placa">
              <Monogram nombre={nombre} tamano="lg" />
            </div>
          )}
        </div>

        <div className="gt-tarjeta__datos gt-lamina">
          <p className="gt-dato gt-tarjeta__marca">GECELCA</p>
          <Nivel className="gt-tarjeta__nombre">{nombre}</Nivel>
          <p className="gt-tarjeta__cargo">{perfil.cargo}</p>
          {perfil.area && <p className="gt-tarjeta__area">{perfil.area}</p>}

          <dl className="gt-tarjeta__contacto">
            <div className="gt-tarjeta__fila">
              <dt className="gt-dato">Correo</dt>
              <dd>
                <a href={`mailto:${perfil.correo}`}>{perfil.correo}</a>
              </dd>
            </div>
            {perfil.telefono && (
              <div className="gt-tarjeta__fila">
                <dt className="gt-dato">Teléfono</dt>
                <dd>
                  <a href={`tel:${perfil.telefono}`}>{formatoTelefono(perfil.telefono)}</a>
                </dd>
              </div>
            )}
            {perfil.whatsapp && (
              <div className="gt-tarjeta__fila">
                <dt className="gt-dato">WhatsApp</dt>
                <dd>
                  <a href={`https://wa.me/${whatsappDigitos}`} target="_blank" rel="noopener noreferrer">
                    {formatoTelefono(perfil.whatsapp)}
                  </a>
                </dd>
              </div>
            )}
          </dl>
        </div>
      </div>

      <div className="gt-tarjeta__acciones">
        {perfil.telefono && (
          <a className="gt-boton" href={`tel:${perfil.telefono}`}>
            Llamar
          </a>
        )}
        <a className="gt-boton" href={`mailto:${perfil.correo}`}>
          Escribir
        </a>
        {perfil.whatsapp && (
          <a
            className="gt-boton gt-boton--externo"
            href={`https://wa.me/${whatsappDigitos}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            WhatsApp
          </a>
        )}
        <a className="gt-boton gt-boton--solido" href={`/api/carta/perfiles/${perfil.id}/vcard`} download>
          Guardar contacto
        </a>
        <button type="button" className="gt-boton gt-tarjeta__compartir" onClick={compartir}>
          Compartir
        </button>
        {copiado && (
          <p className="gt-tarjeta__estado" role="status">
            Enlace copiado
          </p>
        )}
      </div>

      {redes.length > 0 && (
        <ul className="gt-tarjeta__redes" aria-label="Redes y sitio web">
          {redes.map((r) => (
            <li key={r}>
              <a
                className="gt-boton gt-boton--externo"
                href={perfil.redes[r] ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
              >
                {NOMBRE_RED[r]}
              </a>
            </li>
          ))}
        </ul>
      )}

      {qr && (
        <div className="gt-tarjeta__qr">
          <QrTarjeta url={perfil.url} nombre={nombre} plegable />
        </div>
      )}

      {/* Solo al imprimir: los botones desaparecen sobre papel (base.css) y aquí queda el
          destino escrito. */}
      <p className="gt-tarjeta__url-papel">{perfil.url}</p>
    </article>
  )
}

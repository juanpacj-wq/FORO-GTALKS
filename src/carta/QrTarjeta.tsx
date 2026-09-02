import { useMemo, useState } from 'react'
import { arteQr, cajaMarca, codificarQr } from '../data/qr-arte'
import { descargarQr } from './qr-descarga'

/**
 * El QR de una tarjeta, pintado como `<svg>` en el DOM.
 *
 * Es EL MISMO dibujo del dorso de la escarapela (`Escarapela.tsx`): un solo `<path>` con todos
 * los módulos como puntos, los marcadores redondeados que respetan el 1:1:3:1:1 del patrón de
 * posición, y la «G» de Gecelca al centro como `<image>` (marca bicolor de colores fijos: va
 * como imagen, nunca por `Icono`). La geometría sale entera de `data/qr-arte.ts`, así que este
 * QR, el del carné y el del correo del envío masivo son el mismo dibujo por construcción.
 *
 * Se pinta como nodos SVG y no como imagen por lo mismo que en el carné: no toca `img-src` de
 * la CSP ni necesita red. Lo que codifica es la URL ABSOLUTA de la tarjeta (`data-contenido`
 * la lleva escrita para que los arneses la lean sin decodificar).
 *
 * Dos modos: `plegable` (la página pública: un botón «Ver código QR» con `aria-pressed` que lo
 * despliega) y desplegado con descargas (el panel: PNG y SVG por `qr-descarga.ts`).
 */
export default function QrTarjeta({
  url,
  nombre,
  plegable = false,
  descargas = false,
}: {
  /** La URL absoluta de la tarjeta: lo que codifica el QR. */
  url: string
  /** El nombre de la persona, para el nombre accesible y el archivo descargado. */
  nombre: string
  plegable?: boolean
  descargas?: boolean
}) {
  const [abierto, setAbierto] = useState(!plegable)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<'png' | 'svg' | null>(null)

  const qr = useMemo(() => codificarQr(url), [url])
  const qrArte = useMemo(() => arteQr(qr), [qr])
  const marca = useMemo(() => cajaMarca(qr, qrArte.centro), [qr, qrArte.centro])

  async function descargar(formato: 'png' | 'svg') {
    setAviso(null)
    setOcupado(formato)
    try {
      await descargarQr(url, formato, nombre)
    } catch {
      setAviso('No se pudo generar el archivo. Intenta de nuevo.')
    } finally {
      setOcupado(null)
    }
  }

  return (
    <div className="gt-qr-tarjeta">
      {plegable && (
        <button
          type="button"
          className="gt-boton gt-qr-tarjeta__abrir"
          aria-pressed={abierto}
          aria-controls="gt-qr-tarjeta-panel"
          onClick={() => setAbierto((v) => !v)}
        >
          {abierto ? 'Ocultar el código QR' : 'Ver código QR'}
        </button>
      )}

      {abierto && (
        <div className="gt-qr-tarjeta__panel gt-lamina" id="gt-qr-tarjeta-panel">
          <svg
            className="gt-qr-tarjeta__codigo"
            viewBox={`0 0 ${qr.size} ${qr.size}`}
            role="img"
            aria-label={`Código QR de la carta de presentación de ${nombre}`}
            data-contenido={url}
          >
            <path d={qrArte.d} fill="currentColor" />
            {qrArte.marcadores.map(([mx, my]) => (
              <g key={`${mx}-${my}`}>
                <rect x={mx} y={my} width={7} height={7} rx={2.1} fill="currentColor" />
                <rect x={mx + 1} y={my + 1} width={5} height={5} rx={1.5} fill="var(--gt-blanco)" />
                <rect x={mx + 2} y={my + 2} width={3} height={3} rx={1} fill="currentColor" />
              </g>
            ))}
            <image href="/img/marca-g.svg" x={marca.x} y={marca.y} width={marca.ancho} height={marca.alto} />
          </svg>
          <p className="gt-qr-tarjeta__url">{url}</p>
        </div>
      )}

      {descargas && (
        <div className="gt-qr-tarjeta__descargas">
          <button
            type="button"
            className="gt-boton"
            aria-busy={ocupado === 'png' || undefined}
            disabled={ocupado !== null}
            onClick={() => descargar('png')}
          >
            Descargar QR (PNG)
          </button>
          <button
            type="button"
            className="gt-boton"
            aria-busy={ocupado === 'svg' || undefined}
            disabled={ocupado !== null}
            onClick={() => descargar('svg')}
          >
            Descargar QR (SVG)
          </button>
          {aviso && (
            <p className="gt-qr-tarjeta__aviso" role="status">
              {aviso}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

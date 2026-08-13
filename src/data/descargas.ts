import { useEffect, useState } from 'react'

/**
 * Estado de las descargas de /galeria, tal como lo decide `GET /api/descargas`
 * (ver `server/descargas.js`).
 *
 * La misma doctrina que la encuesta de satisfacción: la interfaz solo anuncia
 * lo que el servidor confirma. Un rol existe únicamente cuando la respuesta
 * trajo sus bytes; todo lo demás (paquete sin subir, preview sin servidor, red
 * caída, respuesta malformada) es `null` y su botón queda retenido. Fallar
 * cerrado es la garantía: la página nunca ofrece un enlace que va a dar 404.
 */
export interface DescargaRol {
  bytes: number
  /** Cuántos archivos trae el ZIP: 77 fotografías, 4 presentaciones… */
  elementos: number
}

export interface EstadoDescargas {
  imagenes: DescargaRol | null
  presentaciones: DescargaRol | null
}

const CERRADO: EstadoDescargas = { imagenes: null, presentaciones: null }

function rolValido(r: unknown): DescargaRol | null {
  const bytes = Number((r as DescargaRol)?.bytes)
  const elementos = Number((r as DescargaRol)?.elementos)
  if (!Number.isFinite(bytes) || bytes <= 0 || !Number.isFinite(elementos) || elementos <= 0) {
    return null
  }
  return { bytes, elementos }
}

/** Consulta al montar, una vez: los paquetes no abren por reloj ni cambian solos. */
export function useDescargas(): EstadoDescargas {
  const [estado, setEstado] = useState<EstadoDescargas>(CERRADO)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const r = await fetch('/api/descargas', { headers: { accept: 'application/json' } })
        // El cuerpo se consume SIEMPRE (misma lección que /api/me): una respuesta
        // a medio leer mantiene viva la conexión y rompe el `networkidle` de las
        // pruebas.
        const datos = await r.json().catch(() => null)
        if (!vivo || !r.ok || !datos) return
        setEstado({
          imagenes: rolValido(datos.imagenes),
          presentaciones: rolValido(datos.presentaciones),
        })
      } catch {
        /* sin servidor no hay descargas que anunciar: se queda cerrado */
      }
    })()
    return () => {
      vivo = false
    }
  }, [])

  return estado
}

/**
 * «1,3 GB» / «29 MB», con la coma decimal de es-CO. El peso viene del
 * manifiesto que escribió el empaquetador: es dato medido, no copy.
 */
export function pesoLegible(bytes: number): string {
  const GB = 1024 ** 3
  if (bytes >= GB) return `${(bytes / GB).toFixed(1).replace('.', ',')} GB`
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`
}

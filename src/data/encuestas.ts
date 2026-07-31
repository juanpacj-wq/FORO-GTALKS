import { useEffect, useState } from 'react'

/**
 * Estado de la encuesta de satisfacción, tal como lo decide `GET /api/encuestas`
 * (ver `server/encuestas.js`).
 *
 * La interfaz solo anuncia lo que el servidor confirma la misma doctrina que
 * el correo de inscripción—: `abierta` existe únicamente cuando la respuesta
 * trajo la URL, y todo lo demás (aún no es la hora, preview sin servidor, red
 * caída, respuesta malformada) es `cerrada`. Fallar cerrado es la garantía:
 * ningún reloj de cliente, adelantado o no, puede fabricar el enlace, porque el
 * enlace no está en el bundle.
 */
export type EstadoSatisfaccion = { estado: 'cerrada' } | { estado: 'abierta'; url: string }

interface Consulta {
  abierta: boolean
  url?: string
  /** Cuánto falta para el cierre, restando DOS relojes del servidor. */
  restanteMs?: number
}

/**
 * Margen tras la hora exacta antes de recomprobar: absorbe el redondeo entre
 * los dos instantes del servidor sin dejar el botón viejo más de un suspiro.
 */
const MARGEN_MS = 1500
/** Piso del temporizador: si el servidor dice «ya casi», no se pregunta en bucle. */
const PISO_MS = 5000
/** Tope de `setTimeout` (2³¹−1 ms): más allá, el entero se desborda y dispara ya. */
const TOPE_TIMEOUT_MS = 2147483647

/** Una consulta a `/api/encuestas`. Nunca rechaza: sin respuesta válida, cerrada. */
async function consultarEncuestas(): Promise<Consulta> {
  try {
    const r = await fetch('/api/encuestas', { headers: { accept: 'application/json' } })
    // El cuerpo se consume SIEMPRE (misma lección que /api/me): una respuesta a
    // medio leer mantiene viva la conexión y rompe el `networkidle` de las pruebas.
    const datos = await r.json().catch(() => null)
    const s = datos?.satisfaccion
    if (!r.ok || !s) return { abierta: false }

    // La URL se acepta solo si es https absoluta: defensa en profundidad frente
    // a una respuesta manipulada un `javascript:` jamás llega a un href.
    if (s.habilitada === true && typeof s.url === 'string' && /^https:\/\//.test(s.url)) {
      return { abierta: true, url: s.url }
    }

    const desde = Date.parse(String(s.desde ?? ''))
    const ahora = Date.parse(String(datos.ahora ?? ''))
    if (Number.isFinite(desde) && Number.isFinite(ahora)) {
      return { abierta: false, restanteMs: Math.max(0, desde - ahora) }
    }
    return { abierta: false }
  } catch {
    return { abierta: false }
  }
}

/**
 * Consulta al montar y, si aún está cerrada, se programa para el instante del
 * cierre con la resta de relojes DEL SERVIDOR (`desde − ahora`): el reloj local
 * no participa, así que un equipo atrasado recomprueba igual de puntual.
 *
 * Dos redes de seguridad para la pestaña que se queda abierta durante el foro:
 * el temporizador solo se arma si cabe en `setTimeout` (pasado el tope no hay
 * espera legítima que programar), y `visibilitychange` recomprueba al volver a
 * primer plano, porque un teléfono congela los temporizadores de las pestañas
 * de fondo y las cuatro de la tarde pueden pasarle por el lado.
 */
export function useEncuestaSatisfaccion(): EstadoSatisfaccion {
  const [estado, setEstado] = useState<EstadoSatisfaccion>({ estado: 'cerrada' })

  useEffect(() => {
    let vivo = true
    let abierta = false // abierta una vez, no hay vuelta atrás ni nada que recomprobar
    let temporizador: number | undefined

    const consultar = async () => {
      const c = await consultarEncuestas()
      if (!vivo || abierta) return
      if (c.abierta && c.url) {
        abierta = true
        setEstado({ estado: 'abierta', url: c.url })
        return
      }
      if (c.restanteMs !== undefined) {
        const espera = Math.max(c.restanteMs + MARGEN_MS, PISO_MS)
        if (espera <= TOPE_TIMEOUT_MS) {
          clearTimeout(temporizador)
          temporizador = window.setTimeout(consultar, espera)
        }
      }
    }

    const alVolver = () => {
      if (!abierta && document.visibilityState === 'visible') void consultar()
    }

    void consultar()
    document.addEventListener('visibilitychange', alVolver)

    return () => {
      vivo = false
      clearTimeout(temporizador)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [])

  return estado
}

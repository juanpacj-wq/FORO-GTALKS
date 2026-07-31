import { useEffect, useState } from 'react'

/**
 * Identidad de quien está viendo el sitio, tal como la devuelve `GET /api/me` del gate.
 *
 * `cargo` y `area` NO son claims de OIDC: el servidor los pide a Microsoft Graph al iniciar
 * sesión (scope `User.Read`). Pueden venir vacíosinvitados B2B sin cargo en el directorio de
 * GECELCA, o Graph no disponible—, así que la interfaz nunca debe darlos por hechos.
 */
export interface Usuario {
  nombre_completo: string
  cargo: string
  area: string
  upn: string
  email: string
  oid: string
  roles: string[]
}

/**
 * El correo de inscripción, tal como lo reporta el servidor (ver `server/correo/inscripcion.js`).
 *
 * `no_aplica` cubre a la vez «el envío está apagado», «esta persona queda fuera de la lista» y
 * «fue un simulacro»: desde aquí no se distinguen, y así debe ser. `pendiente` existe porque el
 * envío ocurre después del redirect del login, así que la primera consulta puede adelantarse al
 * desenlace.
 */
export type EstadoInscripcion = 'enviado' | 'pendiente' | 'fallido' | 'no_aplica'

export interface Inscripcion {
  estado: EstadoInscripcion
  /** ISO 8601. Solo viene en los estados terminales. */
  ts?: string
}

export type EstadoSesion =
  | { estado: 'cargando' }
  | { estado: 'dentro'; usuario: Usuario; inscripcion: Inscripcion }
  | { estado: 'sin-sesion' } // sin identidad: visitante anónimo, o servido sin el server (preview)

/**
 * Consulta la sesión una vez al montar.
 *
 * Falla en silencio a propósito: el sitio es público y la sesión es opcional sin ella no se
 * pinta el menú y `/escarapela` muestra la invitación a entrar. `npm run preview` y los scripts
 * de verificación sirven `dist/` sin el server de identidad, y ahí `/api/me` ni existe: mismo
 * estado, mismo comportamiento.
 */
/** Espera de la ÚNICA recomprobación cuando la inscripción llega «pendiente». Ver abajo. */
const RECOMPROBAR_MS = 6000

/** Una consulta a `/api/me`. Nunca rechaza: sin identidad, el sitio se ve igual. */
async function consultarSesion(): Promise<EstadoSesion> {
  try {
    const r = await fetch('/api/me', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    })
    // El cuerpo se consume SIEMPRE, también en el 401. Una respuesta cuyo cuerpo nadie lee deja
    // la petición sin cerrar: mantiene viva la conexión y, de paso, hace que `networkidle` no
    // llegue nuncaasí se cayeron las pruebas de Playwright—.
    const datos = await r.json().catch(() => null)
    if (!r.ok || !datos?.authenticated || !datos.user) return { estado: 'sin-sesion' }
    return {
      estado: 'dentro',
      usuario: datos.user,
      inscripcion: datos.inscripcion ?? { estado: 'no_aplica' },
    }
  } catch {
    return { estado: 'sin-sesion' }
  }
}

export function useSesion(): EstadoSesion {
  const [estado, setEstado] = useState<EstadoSesion>({ estado: 'cargando' })

  useEffect(() => {
    let vivo = true
    let temporizador: number | undefined

    consultarSesion().then((s) => {
      if (!vivo) return
      setEstado(s)
      // Una SOLA recomprobación, no un sondeo: el correo de inscripción sale después del redirect
      // del login, así que esta primera consulta puede adelantarse a su desenlace. Si a los 6 s
      // sigue pendiente, no se vuelve a preguntar y la interfaz no anuncia nada la alternativa
      // sería un temporizador vivo toda la visita para pintar una línea.
      if (s.estado === 'dentro' && s.inscripcion.estado === 'pendiente') {
        temporizador = window.setTimeout(() => {
          consultarSesion().then((s2) => {
            if (vivo) setEstado(s2)
          })
        }, RECOMPROBAR_MS)
      }
    })

    return () => {
      vivo = false
      if (temporizador !== undefined) clearTimeout(temporizador)
    }
  }, [])

  return estado
}

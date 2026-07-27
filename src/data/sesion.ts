import { useEffect, useState } from 'react'

/**
 * Identidad de quien está viendo el sitio, tal como la devuelve `GET /api/me` del gate.
 *
 * `cargo` y `area` NO son claims de OIDC: el servidor los pide a Microsoft Graph al iniciar
 * sesión (scope `User.Read`). Pueden venir vacíos —invitados B2B sin cargo en el directorio de
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

export type EstadoSesion =
  | { estado: 'cargando' }
  | { estado: 'dentro'; usuario: Usuario }
  | { estado: 'sin-gate' } // servido sin el servidor de autenticación (preview, capturas)

/**
 * Consulta la sesión una vez al montar.
 *
 * Falla en silencio a propósito: `npm run preview` y los scripts de verificación sirven `dist/`
 * sin el gate, y ahí `/api/me` no existe. En ese caso no se pinta el menú y el sitio se ve igual
 * que siempre — la protección real es del servidor, no de este componente.
 */
export function useSesion(): EstadoSesion {
  const [estado, setEstado] = useState<EstadoSesion>({ estado: 'cargando' })

  useEffect(() => {
    let vivo = true

    fetch('/api/me', { credentials: 'same-origin', headers: { accept: 'application/json' } })
      .then(async (r) => {
        // El cuerpo se consume SIEMPRE, también en el 401. Una respuesta cuyo cuerpo nadie lee
        // deja la petición sin cerrar: mantiene viva la conexión y, de paso, hace que
        // `networkidle` no llegue nunca —así se cayeron las pruebas de Playwright—.
        const datos = await r.json().catch(() => null)
        return r.ok ? datos : null
      })
      .then((datos) => {
        if (!vivo) return
        if (datos?.authenticated && datos.user) setEstado({ estado: 'dentro', usuario: datos.user })
        else setEstado({ estado: 'sin-gate' })
      })
      .catch(() => vivo && setEstado({ estado: 'sin-gate' }))

    return () => {
      vivo = false
    }
  }, [])

  return estado
}

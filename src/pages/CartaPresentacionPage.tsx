import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import CartaPublica from '../carta/CartaPublica'
import { ErrorApi, obtenerPerfil } from '../carta/api'
import { UUID_V4, nombreCompleto, type PerfilPublico } from '../carta/tipos'
import '../carta/CartaPublica.css'

/**
 * `/carta_presentacion/:id`: la página a la que llega quien escanea un QR o recibe el enlace.
 *
 * Es una página APARTE del foro (se monta fuera de `Layout` en App.tsx): sin header, sin
 * footer y sin navegación a otras secciones, como el visor de la app anterior. Solo la carta.
 *
 * Cuatro estados, y los dos de fallo son RUTA VÁLIDA, no el comodín: una tarjeta retirada o un
 * enlace incompleto pintan su propio aviso en esta URL, sin redirigir a `/`, que es lo que hace
 * el comodín con las rutas inventadas (`interactions-test.mjs` lo fija). Alguien que escanea un
 * QR impreso viejo tiene que leer qué pasó, no aterrizar en la home del foro.
 *
 * - `cargando`: la pantalla azul con el girador del original, `aria-busy`.
 * - `ok`: la carta.
 * - `no_disponible` (404, o un id que ni siquiera tiene forma de UUID: ese ni se pide): el
 *   «Página no encontrada» del original, sin salida a ningún otro sitio.
 * - `sin_servicio` (503, red): mensaje y «Reintentar», porque la BD puede volver sola.
 *
 * El `<title>` sigue la forma del original («Nombre - Cargo - GECELCA»); para los rastreadores
 * de vista previa, que no ejecutan esto, el servidor lo pone en el HTML (server/carta/og.js).
 */
type Estado =
  | { estado: 'cargando' }
  | { estado: 'ok'; perfil: PerfilPublico }
  | { estado: 'no_disponible' }
  | { estado: 'sin_servicio' }

export default function CartaPresentacionPage() {
  const { id = '' } = useParams()
  const idValido = UUID_V4.test(id)
  const [estado, setEstado] = useState<Estado>(idValido ? { estado: 'cargando' } : { estado: 'no_disponible' })

  // `intento` es lo que dispara «Reintentar»: subirlo vuelve a correr el efecto, que es el único
  // sitio que pide el perfil. Así una respuesta tardía de un intento anterior no pisa la nueva.
  const [intento, setIntento] = useState(0)
  const reintentar = useCallback(() => setIntento((n) => n + 1), [])

  useEffect(() => {
    if (!idValido) return
    let vivo = true
    setEstado({ estado: 'cargando' })
    obtenerPerfil(id).then(
      (perfil) => vivo && setEstado({ estado: 'ok', perfil }),
      (err) => {
        if (!vivo) return
        if (err instanceof ErrorApi && err.status === 404) setEstado({ estado: 'no_disponible' })
        else setEstado({ estado: 'sin_servicio' })
      },
    )
    return () => {
      vivo = false
    }
  }, [id, idValido, intento])

  useEffect(() => {
    document.title =
      estado.estado === 'ok'
        ? `${nombreCompleto(estado.perfil)} - ${estado.perfil.cargo} - GECELCA`
        : estado.estado === 'cargando'
          ? 'Cargando perfil - GECELCA'
          : estado.estado === 'no_disponible'
            ? 'Perfil no encontrado - GECELCA'
            : 'Perfil no disponible - GECELCA'
  }, [estado])

  if (estado.estado === 'ok') return <CartaPublica perfil={estado.perfil} />

  if (estado.estado === 'cargando') {
    return (
      <main className="cp__pantalla" role="status" aria-live="polite" aria-busy="true">
        <div className="cp__girando" aria-hidden="true" />
        <span className="cp__oculto">Cargando perfil</span>
      </main>
    )
  }

  if (estado.estado === 'no_disponible') {
    return (
      <main className="cp__pantalla cp__aviso">
        <div role="alert" aria-live="assertive">
          <h1>Página no encontrada</h1>
          <p>El perfil solicitado no existe o fue removido.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="cp__pantalla cp__aviso">
      <div role="alert" aria-live="assertive">
        <h1>No pudimos cargar la tarjeta</h1>
        <p>El servicio no responde en este momento. Espera unos segundos e intenta de nuevo.</p>
      </div>
      <button type="button" className="cp__reintentar" onClick={reintentar}>
        Reintentar
      </button>
    </main>
  )
}

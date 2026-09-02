import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTituloPagina } from '../components/Layout'
import Tarjeta from '../carta/Tarjeta'
import { ErrorApi, obtenerPerfil } from '../carta/api'
import { UUID_V4, nombreCompleto, type PerfilPublico } from '../carta/tipos'
import './PonentesPage.css'
import './CartaPresentacionPage.css'

/**
 * `/carta_presentacion/:id`: la página a la que llega quien escanea un QR o recibe el enlace.
 *
 * Cuatro estados, y los dos de fallo son RUTA VÁLIDA, no el comodín: una tarjeta retirada o un
 * enlace incompleto pintan su propio «no disponible» en esta URL, sin redirigir a `/`, que es
 * lo que hace el comodín con las rutas inventadas (`interactions-test.mjs` lo fija). Alguien que
 * escanea un QR impreso viejo tiene que leer qué pasó, no aterrizar en la home del foro.
 *
 * - `cargando`: la región va `aria-busy` y sin texto de relleno.
 * - `ok`: la tarjeta.
 * - `no_disponible` (404, o un id que ni siquiera tiene forma de UUID: ese ni se pide).
 * - `sin_servicio` (503, red): mensaje y «Reintentar», porque la BD puede volver sola.
 *
 * El `<title>` lleva el nombre de la persona; para los rastreadores de vista previa, que no
 * ejecutan esto, el servidor lo pone en el HTML (server/carta/og.js).
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

  useTituloPagina(
    estado.estado === 'ok'
      ? `${nombreCompleto(estado.perfil)} · Carta de presentación`
      : estado.estado === 'cargando'
        ? undefined
        : 'Carta de presentación',
  )

  return (
    <section className="gt-pagina gt-grano">
      <div className="gt-contenedor gt-carta-pagina" aria-busy={estado.estado === 'cargando' || undefined}>
        {estado.estado === 'ok' && <Tarjeta perfil={estado.perfil} nivel="h1" />}

        {estado.estado === 'no_disponible' && (
          <div className="gt-carta-pagina__aviso">
            <h1>Esta tarjeta no está disponible</h1>
            <p className="gt-pagina__intro">
              Puede que el enlace esté incompleto o que la tarjeta se haya retirado.
            </p>
            <Link className="gt-boton" to="/">
              Ir al inicio
            </Link>
          </div>
        )}

        {estado.estado === 'sin_servicio' && (
          <div className="gt-carta-pagina__aviso">
            <h1>No pudimos cargar la tarjeta</h1>
            <p className="gt-pagina__intro">
              El servicio no responde en este momento. Espera unos segundos e intenta de nuevo.
            </p>
            <button type="button" className="gt-boton gt-boton--solido" onClick={reintentar}>
              Reintentar
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

import { useEffect, useState, type ChangeEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import SectionTitle from '../components/SectionTitle'
import Escarapela from '../components/Escarapela'
import { useSesion } from '../data/sesion'
import { MENSAJES_AUTH, MENSAJES_INSCRIPCION, claveFoto, procesarFoto } from '../data/escarapela'
import './PonentesPage.css'
import './EscarapelaPage.css'

/**
 * La marca de un QR, construida con EL MISMO PATRÓN DE POSICIÓN que el QR de verdad.
 *
 * No es un icono de catálogo y por eso no pasa por `Icono.tsx`: el marcador respeta el
 * 1:1:3:1:1 canónico —anillo de un módulo, claro de uno, núcleo de 3×3— que es exactamente lo
 * que `Escarapela.tsx` dibuja en el dorso, con su mismo radio proporcional. La regla del sistema
 * («los símbolos monocromos van con Icono») existe para que un SVG no pierda `currentColor` al
 * cargarse por `img`; aquí va inline, que lo hereda por definición.
 *
 * Lo que SÍ se aparta del código real es la separación entre marcadores: en un QR versión 1
 * sobran 7 módulos entre esquina y esquina, y a tamaño de glifo eso deja cada módulo en poco
 * más de un píxel y la marca se lee como cuatro puntos borrosos. Aquí van a 3, que es lo que
 * hace legible el anillo. Es un glifo, no una réplica: lo canónico es el marcador.
 */
function MarcaQR() {
  const marcadores = [
    [0, 0],
    [10, 0],
    [0, 10],
  ] as const
  // Cuatro bloques del tamaño del núcleo en el cuadrante libre: lo que queda de un QR cuando se
  // le quitan los datos son sus tres esquinas y algo de mancha abajo a la derecha.
  const bloques = [
    [10, 10],
    [14, 10],
    [10, 14],
    [14, 14],
  ] as const
  return (
    <svg className="gt-marca-qr" viewBox="-0.6 -0.6 18.2 18.2" aria-hidden="true">
      {marcadores.map(([x, y]) => (
        <g key={`m${x}-${y}`}>
          {/* Trazo de 1.2 módulos centrado en el borde del marcador de 7: el anillo queda
              legible sin dejar de ser el anillo de un módulo del patrón. */}
          <rect
            x={x + 0.5}
            y={y + 0.5}
            width={6}
            height={6}
            rx={1.6}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.2}
          />
          <rect x={x + 2} y={y + 2} width={3} height={3} rx={0.9} fill="currentColor" />
        </g>
      ))}
      {bloques.map(([x, y]) => (
        <rect key={`b${x}-${y}`} x={x} y={y} width={3} height={3} rx={0.9} fill="currentColor" />
      ))}
    </svg>
  )
}

/** Visto bueno del correo de inscripción. Trazo, no relleno: pesa lo mismo que el texto al que
 *  acompaña, que es lo que lo mantiene en su sitio de nota y no de adorno. */
function MarcaVisto() {
  return (
    <svg className="gt-marca-estado" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2.6 8.6 6.2 12.1 13.4 4.2"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** El mismo peso de trazo para el desenlace contrario: el correo no salió. */
function MarcaAviso() {
  return (
    <svg className="gt-marca-estado" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 2.4 15 14.2H1Z M8 6.6v3.1"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={8} cy={12} r={0.9} fill="currentColor" />
    </svg>
  )
}

/**
 * La escarapela del asistente la única página del sitio donde la sesión importa.
 *
 * Tres estados, decididos por `useSesion()`:
 *  - `cargando`: el molde del carné, sin texto ni botón. Evita el parpadeo botón→carné en
 *    quien ya tiene sesión.
 *  - `sin-sesion`: el mismo molde + la invitación a entrar. El botón es una NAVEGACIÓN a
 *    /auth/login (flujo server-side; aquí no hay MSAL ni tokens), con el aviso de registro de
 *    asistencia heredado de la pantalla de login que se eliminó al abrir el sitio.
 *  - `dentro`: el carné real (`Escarapela`) y el control de la foto.
 *
 * **La página es un díptico: el discurso a la izquierda y la pieza a la derecha.** No es
 * decoración: el carné mide 1024/1563, o sea ~670px de alto con sus 27.5rem de ancho, y apilado
 * bajo el texto empujaba su propia base fuera de la primera pantalla mientras la mitad derecha
 * quedaba vacía.
 *
 * Son TRES bloques, no dos, y por eso el grid va por áreas: `discurso` (lo que se lee),
 * `pieza` (el carné o su molde) y `acciones` (la que toca ahora: «Iniciar sesión con Microsoft»
 * sin sesión, «Subir foto» con ella). En escritorio, discurso y acciones se apilan a la
 * izquierda y la pieza ocupa la derecha entera; en móvil el orden es discurso → pieza →
 * acciones, para que el carné no quede detrás de sus propios controles. Los controles
 * estuvieron un momento bajo el carné, por proximidad, y ahí caían justo en el canto de la
 * ventana: el botón que hay que pulsar, medio cortado.
 *
 * El copy del cuerpo cambia con la sesión y el aviso del QR no: «inicia sesión con tu correo
 * corporativo» es una instrucción caducada para quien ya entró, pero el QR del dorso registra el
 * ingreso igual en los dos estados.
 *
 * La foto vive SOLO en este navegador: `localStorage`, con clave por `oid` para que en un
 * computador compartido la foto de una cuenta jamás se pinte en otra. No hay endpoint de
 * subida al servidor no viaja ni un byte de la imagen.
 *
 * Los errores del callback OIDC llegan como `/escarapela?auth=<motivo>`: se muestran una vez
 * y el marcador se borra de la URL con `replace`, para que un F5 o un marcador guardado no
 * resuciten el mensaje.
 *
 * El correo de inscripción se ANUNCIA, no se decide, aquí: lo manda el servidor en el primer
 * inicio de sesión y su desenlace viaja en `/api/me`. Esta página solo pinta lo que el servidor
 * confirma nunca supone que salió—, y por eso `pendiente` y `no_aplica` no dicen nada.
 */
export default function EscarapelaPage() {
  const sesion = useSesion()
  const [searchParams, setSearchParams] = useSearchParams()
  const [marcador, setMarcador] = useState<string | null>(null)

  useEffect(() => {
    const auth = searchParams.get('auth')
    if (!auth) return
    setMarcador(auth)
    const limpios = new URLSearchParams(searchParams)
    limpios.delete('auth')
    setSearchParams(limpios, { replace: true })
  }, [searchParams, setSearchParams])

  const oid = sesion.estado === 'dentro' ? sesion.usuario.oid : null
  const [foto, setFoto] = useState<string | null>(null)
  const [avisoFoto, setAvisoFoto] = useState<string | null>(null)
  // Qué cara del carné se ve. Vive AQUÍ y no en `Escarapela` porque tiene dos mandos: el botón
  // que va bajo el carné y el aviso del QR, que en vez de describir el dorso lo enseña.
  const [girada, setGirada] = useState(false)

  useEffect(() => {
    if (!oid) return
    // localStorage puede estar vetado (cookies bloqueadas): sin foto, no sin página.
    try {
      setFoto(localStorage.getItem(claveFoto(oid)))
    } catch {
      setFoto(null)
    }
  }, [oid])

  async function elegirFoto(e: ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0]
    e.target.value = '' // permite volver a elegir el mismo archivo
    if (!archivo || !oid) return
    setAvisoFoto(null)
    try {
      const dataUrl = await procesarFoto(archivo)
      setFoto(dataUrl)
      try {
        localStorage.setItem(claveFoto(oid), dataUrl)
      } catch {
        // Cuota llena o storage vetado: la foto queda para esta visita y se avisa.
        setAvisoFoto('La foto se ve en esta visita, pero el navegador no dejó guardarla: al volver, tendrás que elegirla de nuevo.')
      }
    } catch {
      setAvisoFoto('Ese archivo no se pudo leer como imagen. Elige una foto en JPG, PNG o similar.')
    }
  }

  function quitarFoto() {
    if (oid) {
      try {
        localStorage.removeItem(claveFoto(oid))
      } catch {
        /* si no se pudo guardar, tampoco hay nada que borrar */
      }
    }
    setFoto(null)
    setAvisoFoto(null)
  }

  const mensaje = marcador ? MENSAJES_AUTH[marcador] : undefined
  const avisoInscripcion =
    sesion.estado === 'dentro' ? MENSAJES_INSCRIPCION[sesion.inscripcion.estado] : null

  return (
    <section className="gt-pagina gt-grano">
      <div className="gt-contenedor">
        <div className="gt-escarapela__zona">
          {/* El título va DENTRO de la rejilla: es lo que deja que la pieza suba a su altura
              en vez de arrancar bajo la entradilla. */}
          <div className="gt-escarapela__titulo">
            <SectionTitle como="h1">Escarapela</SectionTitle>
          </div>

          {/* ── El discurso: lo que se lee ─────────────────────────────────── */}
          <div className="gt-escarapela__discurso">
            <p className="gt-escarapela__lead">¡Tu escarapela en un clic!</p>

            <p className="gt-pagina__intro gt-escarapela__texto">
              {sesion.estado === 'dentro'
                ? 'Tu información se cargó automáticamente desde tu cuenta corporativa; solo agrega tu fotografía y estará lista.'
                : 'Inicia sesión con tu correo corporativo y genera tu escarapela oficial del foro. Tu información se cargará automáticamente; solo agrega tu fotografía y estará lista.'}
            </p>

            {/* El aviso del QR. Vale en los dos estados el dorso registra el ingreso se haya
                entrado hace un minuto o el día del foro—, pero solo es PULSABLE cuando hay
                carné que voltear: un control que no puede actuar no se ofrece. Con sesión, en
                vez de contar que el QR está detrás, lo enseña. */}
            {sesion.estado === 'dentro' ? (
              <button
                type="button"
                className="gt-aviso-qr gt-aviso-qr--control"
                aria-pressed={girada}
                onClick={() => setGirada((g) => !g)}
              >
                <MarcaQR />
                <span className="gt-aviso-qr__texto">
                  <strong>Importante:</strong> el código QR ubicado en la parte posterior de la
                  escarapela será utilizado para registrar tu asistencia al evento.
                </span>
                <span className="gt-aviso-qr__accion">
                  {girada ? 'Ver el frente' : 'Ver el respaldo'}
                </span>
              </button>
            ) : (
              <p className="gt-aviso-qr">
                <MarcaQR />
                <span className="gt-aviso-qr__texto">
                  <strong>Importante:</strong> el código QR ubicado en la parte posterior de la
                  escarapela será utilizado para registrar tu asistencia al evento.
                </span>
              </p>
            )}

            {mensaje && (
              <p className="gt-escarapela__alerta" role="alert">
                {mensaje}
              </p>
            )}
          </div>

          {/* ── La pieza ───────────────────────────────────────────────────── */}
          <div className="gt-escarapela__pieza">
            {sesion.estado === 'dentro' ? (
              <Escarapela
                usuario={sesion.usuario}
                foto={foto}
                girada={girada}
                onGirar={() => setGirada((g) => !g)}
              />
            ) : (
              /* El molde se muestra también mientras carga: quien ya tiene sesión pasa del
                 molde al carné sin ver aparecer y desaparecer un botón. */
              <div className="gt-escarapela__molde" aria-hidden="true">
                <span className="gt-escarapela__molde-ranura" />
                <span className="gt-escarapela__molde-retrato" />
                <span className="gt-escarapela__molde-linea gt-escarapela__molde-linea--nombre" />
                <span className="gt-escarapela__molde-linea gt-escarapela__molde-linea--cargo" />
                <span className="gt-escarapela__molde-pildora" />
              </div>
            )}
          </div>

          {/* ── La acción que toca ahora ───────────────────────────────────── */}
          <div className="gt-escarapela__acciones">
            {sesion.estado === 'sin-sesion' && (
              <>
                <a className="gt-boton gt-boton--solido gt-escarapela__entrar" href="/auth/login">
                  <svg className="gt-escarapela__entrar-logo" viewBox="0 0 21 21" aria-hidden="true">
                    <rect x="0" y="0" width="10" height="10" fill="#f25022" />
                    <rect x="11" y="0" width="10" height="10" fill="#7fba00" />
                    <rect x="0" y="11" width="10" height="10" fill="#00a4ef" />
                    <rect x="11" y="11" width="10" height="10" fill="#ffb900" />
                  </svg>
                  Iniciar sesión con Microsoft
                </a>
                {marcador === 'no_acceso' && (
                  <a className="gt-escarapela__otra-cuenta" href="/auth/login?select=1">
                    Entrar con otra cuenta
                  </a>
                )}
                {/* Aviso de privacidad. Va ANTES del login, no después: es el orden que exige
                    un tratamiento de datos que se anuncia. Tuvo una segunda frase sobre el
                    correo de inscripción; se retiró el 2026-08-12 con el envío ya apagado
                    (INSCRIPCION_MODO=off): no se anuncia un correo que no va a salir. */}
                <p className="gt-escarapela__registro">
                  Tu acceso queda registrado para el control de asistencia del foro.
                </p>
              </>
            )}

            {sesion.estado === 'dentro' && (
              <>
                <div className="gt-escarapela__foto-controles">
                  <label className="gt-boton" htmlFor="gt-escarapela-foto">
                    {foto ? 'Cambiar foto' : 'Subir foto'}
                    <input
                      id="gt-escarapela-foto"
                      type="file"
                      accept="image/*"
                      onChange={elegirFoto}
                      className="gt-oculto-visual"
                    />
                  </label>
                  {foto && (
                    <button type="button" className="gt-boton" onClick={quitarFoto}>
                      Quitar foto
                    </button>
                  )}
                </div>
                {avisoFoto && (
                  <p className="gt-escarapela__aviso-foto" role="status">
                    {avisoFoto}
                  </p>
                )}
                <p className="gt-escarapela__nota">
                  La foto se guarda solo en este navegador; nunca sale de tu equipo.
                </p>
                {/* El desenlace del correo de inscripción, como recibo y no como caja: una
                    marca de trazo y la frase, al mismo peso que la nota de al lado. La marca
                    dice cuál de los dos desenlaces es sin repetirlo por escrito. */}
                {avisoInscripcion && (
                  <p className="gt-escarapela__inscripcion" role="status">
                    {sesion.inscripcion.estado === 'enviado' ? <MarcaVisto /> : <MarcaAviso />}
                    <span>{avisoInscripcion}</span>
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

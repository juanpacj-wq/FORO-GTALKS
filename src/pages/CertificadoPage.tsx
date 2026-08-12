import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import SectionTitle from '../components/SectionTitle'
import { useSesion } from '../data/sesion'
import { MENSAJES_AUTH } from '../data/escarapela'
import './CertificadoPage.css'

/**
 * El certificado de participación: cada asistente descarga el suyo, en PDF.
 *
 * La página no compone nada y no sabe nada: los PDF se generaron y verificaron
 * en la estación (uno por asistente, con su nombre y su cédula) y el servidor
 * los sirve en `GET /api/certificado`, resolviendo ÚNICAMENTE el `oid` de la
 * sesión que pregunta. Aquí solo se anuncia lo que el servidor confirma:
 * `/api/me` dice `certificado: 'disponible'` o `'no_aplica'`, y sin esa
 * confirmación no se pinta ninguna descarga (fallo cerrado, como el correo de
 * inscripción y la encuesta de satisfacción).
 *
 * La descarga es una NAVEGACIÓN a `/api/certificado`: cero JavaScript de PDF,
 * cero permisos nuevos en la CSP. El servidor responde con
 * `Content-Disposition: attachment` y el navegador guarda el archivo sin
 * abandonar la página.
 *
 * Quien entra y no tiene certificado ve el botón retenido (`--inactivo`) con
 * su aviso emergente: el mismo patrón accesible del gate de encuestas
 * (`aria-disabled` + `aria-describedby`, hover/foco/toque, Escape lo cierra).
 */

/** Cuántos ms se queda visible el aviso tras un toque (móvil no tiene hover). */
const AVISO_TOQUE_MS = 6000

/** El aviso del botón retenido. El contacto es de Comunicaciones (pendiente de
 *  confirmar el canal exacto; ver docs/PENDIENTES-DE-CONTENIDO.md). */
const AVISO_SIN_ASISTENCIA =
  'No podemos entregarte tu certificado: no tenemos registrada tu asistencia al foro. ' +
  'Si asististe y crees que es un error, escríbele a María Cristina Giraldo ' +
  '(mgiraldo@gecelca.com.co).'

function BotonDescarga() {
  return (
    <>
      <a className="gt-boton gt-boton--solido gt-certificado__descargar" href="/api/certificado">
        Descarga tu certificado (PDF)
      </a>
      {/* Solo al imprimir: el botón desaparece sobre papel (base.css) y ahí se
          escribe el destino entero. */}
      <span className="gt-certificado__url-papel">
        Descarga: https://cdp.gecelca.com.co/certificado
      </span>
    </>
  )
}

function BotonRetenido() {
  const [avisando, setAvisando] = useState(false)
  // Escape SUPRIME el aviso aunque el botón siga enfocado. Sin este estado, `:focus-within`
  // lo mantendría visible y Escape no descartaría nada (WCAG 1.4.13). Se levanta al volver a
  // interactuar (clic) o al salir del botón.
  const [suprimido, setSuprimido] = useState(false)

  useEffect(() => {
    if (!avisando) return
    const t = window.setTimeout(() => setAvisando(false), AVISO_TOQUE_MS)
    return () => clearTimeout(t)
  }, [avisando])

  return (
    <span
      className={
        'gt-certificado__gate' +
        (avisando ? ' gt-certificado__gate--avisando' : '') +
        (suprimido ? ' gt-certificado__gate--suprimido' : '')
      }
    >
      <button
        type="button"
        className="gt-boton gt-boton--inactivo gt-certificado__descargar"
        aria-disabled="true"
        aria-describedby="gt-certificado-aviso"
        onClick={() => {
          setSuprimido(false)
          setAvisando((v) => !v)
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          setAvisando(false)
          setSuprimido(true)
        }}
        onBlur={() => {
          setAvisando(false)
          setSuprimido(false)
        }}
      >
        Descarga tu certificado (PDF)
      </button>
      <span role="tooltip" id="gt-certificado-aviso" className="gt-certificado__aviso gt-lamina">
        {AVISO_SIN_ASISTENCIA}
      </span>
      <span className="gt-certificado__url-papel">{AVISO_SIN_ASISTENCIA}</span>
    </span>
  )
}

export default function CertificadoPage() {
  const sesion = useSesion()
  const [searchParams, setSearchParams] = useSearchParams()
  const [marcador, setMarcador] = useState<string | null>(null)

  // Los errores del callback OIDC aterrizan con `?auth=<motivo>` también aquí
  // (el login puede nacer de esta página). Se lee, se guarda y se limpia la
  // URL, para que un F5 no resucite el mensaje mismo trato que /escarapela.
  useEffect(() => {
    const auth = searchParams.get('auth')
    if (!auth) return
    setMarcador(auth)
    const limpios = new URLSearchParams(searchParams)
    limpios.delete('auth')
    setSearchParams(limpios, { replace: true })
  }, [searchParams, setSearchParams])

  const mensaje = marcador ? MENSAJES_AUTH[marcador] : undefined

  return (
    <section className="gt-pagina gt-grano">
      <div className="gt-contenedor gt-certificado">
        <SectionTitle como="h1">Certificado</SectionTitle>

        <p className="gt-certificado__lead">Tu certificado de participación, listo para descargar.</p>

        <p className="gt-pagina__intro gt-certificado__texto">
          {sesion.estado === 'dentro' && sesion.certificado === 'disponible'
            ? 'Gracias por acompañarnos en el 1° Foro GECELCA «Energía en Acción: Retos y Oportunidades». Tu certificado va personalizado con tu nombre y tu cédula, listo para guardar o imprimir.'
            : sesion.estado === 'dentro'
              ? 'El certificado oficial del 1° Foro GECELCA «Energía en Acción: Retos y Oportunidades» se entrega personalizado a quienes asistieron al evento.'
              : 'Inicia sesión con tu correo corporativo y descarga el certificado oficial de tu participación en el 1° Foro GECELCA, personalizado con tu nombre y tu cédula.'}
        </p>

        {mensaje && (
          <p className="gt-certificado__alerta" role="alert">
            {mensaje}
          </p>
        )}

        <div className="gt-certificado__acciones">
          {sesion.estado === 'sin-sesion' && (
            <>
              <a
                className="gt-boton gt-boton--solido gt-certificado__entrar"
                href="/auth/login?destino=/certificado"
              >
                <svg className="gt-certificado__entrar-logo" viewBox="0 0 21 21" aria-hidden="true">
                  <rect x="0" y="0" width="10" height="10" fill="#f25022" />
                  <rect x="11" y="0" width="10" height="10" fill="#7fba00" />
                  <rect x="0" y="11" width="10" height="10" fill="#00a4ef" />
                  <rect x="11" y="11" width="10" height="10" fill="#ffb900" />
                </svg>
                Iniciar sesión con Microsoft
              </a>
              {marcador === 'no_acceso' && (
                <a className="gt-certificado__otra-cuenta" href="/auth/login?select=1&destino=/certificado">
                  Entrar con otra cuenta
                </a>
              )}
              {/* Aviso de privacidad, ANTES del login: el mismo de /escarapela (que explica
                  por qué ya no menciona el correo de inscripción). */}
              <p className="gt-certificado__registro">
                Tu acceso queda registrado para el control de asistencia del foro.
              </p>
            </>
          )}

          {sesion.estado === 'dentro' &&
            (sesion.certificado === 'disponible' ? <BotonDescarga /> : <BotonRetenido />)}
        </div>
      </div>
    </section>
  )
}

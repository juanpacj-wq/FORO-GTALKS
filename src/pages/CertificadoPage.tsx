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

function VistaPrevia() {
  return (
    <figure className="gt-certificado__pieza">
      <img
        src="/img/certificado-muestra.webp"
        srcSet="/img/certificado-muestra.webp 878w, /img/certificado-muestra@2x.webp 1755w"
        sizes="(min-width: 64rem) 52rem, 100vw"
        width={878}
        height={621}
        alt="Certificado de participación del 1° Foro GECELCA, sin diligenciar: el tuyo lleva tu nombre y tu cédula."
      />
    </figure>
  )
}

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

  useEffect(() => {
    if (!avisando) return
    const t = window.setTimeout(() => setAvisando(false), AVISO_TOQUE_MS)
    return () => clearTimeout(t)
  }, [avisando])

  return (
    <span className={'gt-certificado__gate' + (avisando ? ' gt-certificado__gate--avisando' : '')}>
      <button
        type="button"
        className="gt-boton gt-boton--inactivo gt-certificado__descargar"
        aria-disabled="true"
        aria-describedby="gt-certificado-aviso"
        onClick={() => setAvisando((v) => !v)}
        onKeyDown={(e) => e.key === 'Escape' && setAvisando(false)}
        onBlur={() => setAvisando(false)}
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

        <VistaPrevia />

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
              {/* Aviso de privacidad, ANTES del login: el mismo de /escarapela. */}
              <p className="gt-certificado__registro">
                Tu acceso queda registrado para el control de asistencia del foro. La primera vez
                que entres, te escribimos a tu correo corporativo para confirmar tu inscripción.
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

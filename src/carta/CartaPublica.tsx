import { useEffect, useRef, useState } from 'react'
import { QrDibujo } from './QrTarjeta'
import { REDES, NOMBRE_RED, formatoTelefono, nombreCompleto, srcFoto, type PerfilPublico } from './tipos'
import { iniciales } from '../data/foro'
import './CartaPublica.css'

/**
 * La carta de presentación pública: réplica 1 a 1 del visor de la app COMUNICACIONES anterior
 * (`client-public/src/pages/ProfileCard.tsx`), con su paleta, su tipografía (Inter) y su
 * composición móvil de 420 px. Lo único que cambia es la marca: el logo blanco es el de
 * GECELCA 2026 y la «G» del centro del QR sale de `public/img/marca-g.svg`.
 *
 * Es una pieza APARTE del sistema de diseño del foro, a propósito y por pedido del usuario
 * (2026-09-02): no usa los tokens `--gt-*`, no lleva el chasis del sitio (ni header, ni
 * footer, ni navegación a otras secciones) y su CSS va acotado al bloque `.cp`. Lo que sí
 * comparte es el contrato de datos (`PerfilPublico`), la vCard del servidor y el QR de
 * `qr-arte.ts`, que es el mismo dibujo del panel y de la escarapela.
 *
 * Sobre el diseño original se añaden solo las cosas que el modelo de hoy tiene y aquel no:
 * WhatsApp como tercera acción del héroe y como fila de contacto, el área como fila, las
 * redes sociales en la tarjeta de «Página web» con el mismo estilo de enlace, y unas
 * iniciales cuando la persona todavía no tiene foto (el original exigía foto).
 *
 * `modo="previa"` es la vista previa del panel: mismo dibujo, con los botones flotantes
 * anclados dentro del bloque en vez de a la ventana.
 */
export default function CartaPublica({
  perfil,
  modo = 'pagina',
  nivel: Nivel = 'h1',
}: {
  perfil: PerfilPublico
  modo?: 'pagina' | 'previa'
  nivel?: 'h1' | 'h2' | 'h3'
}) {
  const nombre = perfil.nombre || nombreCompleto(perfil)
  const [qrAbierto, setQrAbierto] = useState(false)
  const [estado, setEstado] = useState<string | null>(null)
  const abrirQr = useRef<HTMLButtonElement>(null)
  const cerrarQr = useRef<HTMLButtonElement>(null)

  // Foco y Escape del modal del QR (WCAG 2.1.1, 2.1.2, 2.4.3), como en el original.
  useEffect(() => {
    if (!qrAbierto) return
    cerrarQr.current?.focus()
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setQrAbierto(false)
    }
    window.addEventListener('keydown', alTeclear)
    return () => {
      window.removeEventListener('keydown', alTeclear)
      abrirQr.current?.focus()
    }
  }, [qrAbierto])

  useEffect(() => {
    if (!estado) return
    const t = window.setTimeout(() => setEstado(null), 4000)
    return () => clearTimeout(t)
  }, [estado])

  async function compartir() {
    const datos = { title: nombre, text: `${nombre} · ${perfil.cargo} · GECELCA`, url: perfil.url }
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share(datos)
        return
      }
    } catch {
      // Cancelado por la persona, o el navegador no pudo: cae al portapapeles.
    }
    try {
      await navigator.clipboard.writeText(perfil.url)
      setEstado('Enlace copiado')
    } catch {
      setEstado('No se pudo copiar el enlace')
    }
  }

  const redes = REDES.filter((r) => r !== 'sitio_web' && perfil.redes[r])
  const sitio = perfil.redes.sitio_web || 'https://www.gecelca.com.co/es/'
  const whatsappDigitos = perfil.whatsapp ? perfil.whatsapp.replace(/\D/g, '') : null

  return (
    <div className={`cp cp--${modo}`}>
      <div className="cp__forma cp__forma--1" aria-hidden="true" />
      <div className="cp__forma cp__forma--2" aria-hidden="true" />
      <div className="cp__forma cp__forma--3" aria-hidden="true" />
      <div className="cp__forma cp__forma--4" aria-hidden="true" />

      <div className="cp__contenedor">
        <section className="cp__heroe" aria-label="Presentación">
          {perfil.foto ? (
            <img className="cp__foto" src={srcFoto(perfil.foto)} alt={`imagen ${nombre}`} />
          ) : (
            <div className="cp__foto cp__foto--iniciales" aria-hidden="true">
              {iniciales(nombre)}
            </div>
          )}
          <div className="cp__velo" aria-hidden="true" />
          <div className="cp__heroe-texto">
            <Nivel className="cp__nombre">{nombre}</Nivel>
            <p className="cp__cargo">{perfil.cargo}</p>
            <img className="cp__logo" src="/img/logo-gecelca-blanco.png" alt="Logo de GECELCA" width="720" height="106" />
            <div className="cp__acciones">
              {perfil.telefono && (
                <a href={`tel:${perfil.telefono}`} className="cp__accion" aria-label={`Llamar a ${nombre}`}>
                  <IconoTelefono />
                </a>
              )}
              <a href={`mailto:${perfil.correo}`} className="cp__accion" aria-label={`Enviar correo a ${nombre}`}>
                <IconoCorreo />
              </a>
              {whatsappDigitos && (
                <a
                  href={`https://wa.me/${whatsappDigitos}`}
                  className="cp__accion"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Escribir por WhatsApp a ${nombre}`}
                >
                  <IconoWhatsapp />
                </a>
              )}
            </div>
          </div>
        </section>

        <section className="cp__ficha" aria-labelledby={`cp-contacto-${perfil.id}`}>
          <div className="cp__ficha-cabecera">
            <IconoContacto />
            <span className="cp__ficha-titulo" id={`cp-contacto-${perfil.id}`}>
              Contacto
            </span>
          </div>
          {perfil.telefono && (
            <div className="cp__fila">
              <span className="cp__etiqueta">Teléfono</span>
              <a href={`tel:${perfil.telefono}`} className="cp__valor">
                {formatoTelefono(perfil.telefono)}
              </a>
            </div>
          )}
          {perfil.whatsapp && whatsappDigitos && (
            <div className="cp__fila">
              <span className="cp__etiqueta">WhatsApp</span>
              <a href={`https://wa.me/${whatsappDigitos}`} className="cp__valor" target="_blank" rel="noopener noreferrer">
                {formatoTelefono(perfil.whatsapp)}
              </a>
            </div>
          )}
          <div className="cp__fila">
            <span className="cp__etiqueta">Email</span>
            <a href={`mailto:${perfil.correo}`} className="cp__valor">
              {perfil.correo}
            </a>
          </div>
          {perfil.area && (
            <div className="cp__fila">
              <span className="cp__etiqueta">Área</span>
              <span className="cp__valor">{perfil.area}</span>
            </div>
          )}
        </section>

        <section className="cp__ficha" aria-labelledby={`cp-web-${perfil.id}`}>
          <p className="cp__web-titulo" id={`cp-web-${perfil.id}`}>
            {redes.length ? 'Página web y redes' : 'Página web'}
          </p>
          <div className="cp__enlaces">
            <a
              href={sitio}
              target="_blank"
              rel="noopener noreferrer"
              className="cp__enlace"
              aria-label={`Abrir ${perfil.redes.sitio_web ? 'el sitio web' : 'el sitio web de GECELCA'} en una nueva pestaña`}
            >
              <IconoEnlace />
              <span>{perfil.redes.sitio_web ? dominioDe(perfil.redes.sitio_web) : 'GECELCA'}</span>
              <IconoChevron />
            </a>
            {redes.map((r) => (
              <a
                key={r}
                href={perfil.redes[r] as string}
                target="_blank"
                rel="noopener noreferrer"
                className="cp__enlace"
                aria-label={`Abrir ${NOMBRE_RED[r]} de ${nombre} en una nueva pestaña`}
              >
                <IconoEnlace />
                <span>{NOMBRE_RED[r]}</span>
                <IconoChevron />
              </a>
            ))}
          </div>
        </section>
      </div>

      <div className="cp__flotante-izq">
        <button
          ref={abrirQr}
          type="button"
          className="cp__flotante cp__qr-abrir"
          onClick={() => setQrAbierto(true)}
          aria-label="Mostrar código QR del perfil"
          aria-haspopup="dialog"
          aria-expanded={qrAbierto}
        >
          <IconoQr />
        </button>
        <button
          type="button"
          className="cp__flotante cp__compartir"
          onClick={compartir}
          aria-label="Compartir enlace del perfil"
        >
          <IconoCompartir />
        </button>
      </div>

      <a
        className="cp__flotante-der"
        href={`/api/carta/perfiles/${perfil.id}/vcard`}
        download
        aria-label={`Guardar contacto de ${nombre}`}
      >
        <IconoGuardar />
        <span className="cp__flotante-der-texto">
          Guardar
          <br />
          contacto
        </span>
      </a>

      <p className="cp__estado" role="status" aria-live="polite">
        {estado}
      </p>

      {qrAbierto && (
        <div className="cp__qr-velo" onClick={() => setQrAbierto(false)}>
          <div
            className="cp__qr-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`cp-qr-titulo-${perfil.id}`}
            onClick={(e) => e.stopPropagation()}
          >
            <button ref={cerrarQr} type="button" className="cp__qr-cerrar" onClick={() => setQrAbierto(false)} aria-label="Cerrar">
              <IconoCerrar />
            </button>
            <h2 className="cp__qr-titulo" id={`cp-qr-titulo-${perfil.id}`}>
              {nombre}
            </h2>
            <div className="cp__qr-marco">
              <QrDibujo url={perfil.url} nombre={nombre} className="cp__qr" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function dominioDe(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

// ── Los iconos del original (trazo de 2 px, esquinas redondas), decorativos ────────────────
const trazo = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

function IconoTelefono() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" {...trazo} aria-hidden="true" focusable="false">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  )
}

function IconoCorreo() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" {...trazo} aria-hidden="true" focusable="false">
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  )
}

function IconoWhatsapp() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" {...trazo} aria-hidden="true" focusable="false">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      <path d="M9.5 8.5c.2 1.6 1 3 2.2 4.2s2.6 2 4.2 2.2l.6-.6a1 1 0 0 0 0-1.4l-1-1a1 1 0 0 0-1.4 0l-.4.4a6 6 0 0 1-2.2-2.2l.4-.4a1 1 0 0 0 0-1.4l-1-1a1 1 0 0 0-1.4 0z" />
    </svg>
  )
}

function IconoContacto() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" {...trazo} className="cp__icono-azul" aria-hidden="true" focusable="false">
      <path d="M17 18a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <circle cx="12" cy="10" r="2" />
      <line x1="8" x2="8" y1="2" y2="4" />
      <line x1="16" x2="16" y1="2" y2="4" />
    </svg>
  )
}

function IconoEnlace() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...trazo} className="cp__icono-azul" aria-hidden="true" focusable="false">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )
}

function IconoChevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" {...trazo} className="cp__chevron" aria-hidden="true" focusable="false">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

function IconoQr() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...trazo} aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="8" height="8" rx="1" />
      <rect x="14" y="2" width="8" height="8" rx="1" />
      <rect x="2" y="14" width="8" height="8" rx="1" />
      <rect x="14" y="14" width="4" height="4" />
      <line x1="22" y1="14" x2="22" y2="14.01" />
      <line x1="22" y1="22" x2="22" y2="22.01" />
      <line x1="18" y1="18" x2="18" y2="18.01" />
    </svg>
  )
}

function IconoCompartir() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...trazo} aria-hidden="true" focusable="false">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  )
}

function IconoGuardar() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...trazo} aria-hidden="true" focusable="false">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" x2="19" y1="8" y2="14" />
      <line x1="22" x2="16" y1="11" y2="11" />
    </svg>
  )
}

function IconoCerrar() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" {...trazo} aria-hidden="true" focusable="false">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

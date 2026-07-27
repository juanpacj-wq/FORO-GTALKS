import { EVENTO } from '../data/foro'
import Icono from './Icono'
import './SiteFooter.css'

/**
 * Cierre del sitio: la marca grande, la ficha del evento y el contacto.
 * Todo el contenido está transcrito de las piezas.
 */
export default function SiteFooter() {
  const { contacto } = EVENTO
  const telefonoPlano = contacto.telefono.replace(/\s/g, '')

  return (
    <footer className="gt-footer gt-grano">
      <div className="gt-contenedor">
        <div className="gt-footer__cima">
          <span className="gt-footer__marca">
            <Icono nombre="icono-burbujas" alto="2.6rem" />
            <Icono nombre="wordmark-g-talks" alto="1.35rem" titulo="G-TALKS" />
          </span>

          <p className="gt-footer__evento">
            {EVENTO.edicion}° Foro GECELCA · {EVENTO.nombre.replace('Foro: ', '')}
            <span className="gt-footer__cuando">
              {EVENTO.fecha.texto} · {EVENTO.lugar}
            </span>
          </p>
        </div>

        <div className="gt-footer__datos">
          <div>
            <p className="gt-dato gt-footer__rotulo">Organiza</p>
            <p className="gt-footer__valor">{EVENTO.organiza}</p>
          </div>

          <div>
            <p className="gt-dato gt-footer__rotulo">Mayor información</p>
            <p className="gt-footer__valor">
              {contacto.nombre} ·{' '}
              <a className="gt-footer__tel" href={`tel:+57${telefonoPlano}`}>
                {contacto.telefono}
              </a>
            </p>
          </div>

          <img
            className="gt-footer__gecelca"
            src="/img/logo-gecelca.svg"
            alt="Gecelca"
            width="180"
          />
        </div>
      </div>
    </footer>
  )
}

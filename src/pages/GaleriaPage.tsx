import { useEffect, useState } from 'react'
import AbanicoFotos from '../components/AbanicoFotos'
import SectionTitle from '../components/SectionTitle'
import VisorFotos from '../components/VisorFotos'
import { GALERIA } from '../design/galeria'
import { DESCARGAS_AVISO, DESCARGAS_INTRO, GALERIA_INTRO } from '../data/foro'
import { pesoLegible, useDescargas, type DescargaRol } from '../data/descargas'
import './PonentesPage.css'
import './GaleriaPage.css'

/**
 * La Memorias del evento del foro, en tres secciones con su riel de anclas en
 * el header (`anclasDe('/galeria')`, el mismo scrollspy de la home):
 *
 *  · «Galería de imágenes»: el abanico una foto protagonista y las demás en
 *    arco para recorrer la jornada de una en una.
 *  · «Descargar contenido»: los dos ZIP que empaquetó la estación. Los botones
 *    siguen la doctrina de la encuesta de satisfacción: solo son enlaces cuando
 *    `GET /api/descargas` confirmó el paquete, y el peso que enseñan es el del
 *    manifiesto, no un copy. Sin confirmación, botón retenido con su aviso.
 *  · «Resumen de jornada»: la rejilla índice, para saltar a un momento.
 *
 * Ninguna vista inventa datos: el orden y las horas los escribió
 * `scripts/build-galeria.py` leyendo el EXIF de cada toma. El visor es uno solo
 * y lo comparten el abanico y la rejilla.
 */

/** Cuántos ms se queda visible el aviso tras un toque (móvil no tiene hover). */
const AVISO_TOQUE_MS = 4000

function BotonDescarga({
  rol,
  accion,
  cosa,
  confirmado,
}: {
  rol: 'imagenes' | 'presentaciones'
  accion: string
  /** El sustantivo de la línea de dato: «fotografías originales», «presentaciones». */
  cosa: string
  confirmado: DescargaRol | null
}) {
  const [avisando, setAvisando] = useState(false)

  useEffect(() => {
    if (!avisando) return
    const t = window.setTimeout(() => setAvisando(false), AVISO_TOQUE_MS)
    return () => clearTimeout(t)
  }, [avisando])

  if (confirmado) {
    return (
      <span className="gt-descarga">
        <a className="gt-boton gt-boton--solido" href={`/descargas/${rol}`} download>
          {accion}
        </a>
        {/* Dato del manifiesto, no copy: el servidor midió el ZIP que va a entregar. */}
        <span className="gt-descarga__meta gt-dato">
          {confirmado.elementos} {cosa} · {pesoLegible(confirmado.bytes)}
        </span>
      </span>
    )
  }

  // El mismo botón retenido de las encuestas y el certificado: recibe foco
  // (aria-disabled), su aviso siempre está en el DOM (aria-describedby) y en
  // táctil se muestra con el toque. Escape lo cierra (WCAG 1.4.13).
  return (
    <span className={'gt-descarga gt-descarga__gate' + (avisando ? ' gt-descarga__gate--avisando' : '')}>
      <button
        type="button"
        className="gt-boton gt-boton--inactivo"
        aria-disabled="true"
        aria-describedby={`gt-descarga-aviso-${rol}`}
        onClick={() => setAvisando((v) => !v)}
        onKeyDown={(e) => e.key === 'Escape' && setAvisando(false)}
        onBlur={() => setAvisando(false)}
      >
        {accion}
      </button>
      <span role="tooltip" id={`gt-descarga-aviso-${rol}`} className="gt-descarga__aviso gt-lamina">
        {DESCARGAS_AVISO}
      </span>
    </span>
  )
}

export default function GaleriaPage() {
  const [visor, setVisor] = useState<number | null>(null)
  const descargas = useDescargas()

  const primera = GALERIA[0]
  const ultima = GALERIA[GALERIA.length - 1]

  return (
    <section className="gt-pagina gt-grano gt-galeria">
      <div className="gt-contenedor" id="galeria-de-imagenes">
        <SectionTitle como="h1" apunte={`${GALERIA.length} fotografías`}>
          Galería de imagenes
        </SectionTitle>
      </div>

      {/* La entradilla vive DENTRO del abanico: comparte fila con el mando,
          que es lo que mantiene los controles en la primera pantalla y le deja
          al mazo todo el alto restante. */}
      <AbanicoFotos fotos={GALERIA} intro={GALERIA_INTRO} alAmpliar={setVisor} />

      <div className="gt-contenedor">
        <section className="gt-galeria__descargas" id="descargar-contenido">
          <SectionTitle>Descargar contenido</SectionTitle>

          <div className="gt-galeria__descargas-cuerpo">
            <p className="gt-galeria__descargas-texto">{DESCARGAS_INTRO}</p>

            <ul className="gt-descargas">
              <li>
                <BotonDescarga
                  rol="imagenes"
                  accion="Descargar imágenes"
                  cosa="fotografías originales"
                  confirmado={descargas.imagenes}
                />
              </li>
              <li>
                <BotonDescarga
                  rol="presentaciones"
                  accion="Descargar presentaciones"
                  cosa="presentaciones"
                  confirmado={descargas.presentaciones}
                />
              </li>
            </ul>
          </div>
        </section>

        <section className="gt-galeria__indice" id="resumen-de-jornada">
          <SectionTitle apunte={`${primera.hora} – ${ultima.hora}`}>
            Resumen de jornada
          </SectionTitle>

          <ul className="gt-galeria__rejilla">
            {GALERIA.map((foto, i) => (
              <li key={foto.id}>
                <button
                  type="button"
                  className="gt-galeria__celda"
                  onClick={() => setVisor(i)}
                  aria-label={`Ampliar la fotografía de las ${foto.hora} (${i + 1} de ${GALERIA.length})`}
                >
                  <img
                    src={foto.srcMedia}
                    width={foto.ancho}
                    height={foto.alto}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {visor !== null && (
        <VisorFotos
          fotos={GALERIA}
          indice={visor}
          alNavegar={setVisor}
          alCerrar={() => setVisor(null)}
        />
      )}
    </section>
  )
}

import { useEffect, useState } from 'react'
import AbanicoFotos from '../components/AbanicoFotos'
import SectionTitle from '../components/SectionTitle'
import VisorFotos from '../components/VisorFotos'
import { GALERIA } from '../design/galeria'
import {
  DESCARGAS_AVISO,
  DESCARGAS_IMAGENES_INTRO,
  DESCARGAS_PRESENTACIONES_INTRO,
  GALERIA_INTRO,
} from '../data/foro'
import { pesoLegible, useDescargas, type DescargaRol } from '../data/descargas'
import './PonentesPage.css'
import './GaleriaPage.css'

/**
 * Las memorias del evento, en cuatro secciones con su riel de anclas en el
 * header (`anclasDe('/galeria')`, el mismo scrollspy de la home):
 *
 *  · «Descarga las presentaciones de tus ponentes»: abre la página, porque es
 *    lo que la gente viene a buscar con una tarea concreta en la cabeza.
 *  · «Galería de imágenes»: el abanico una foto protagonista y las demás en
 *    arco para recorrer la jornada de una en una.
 *  · «Descargar imágenes»: va DESPUÉS del abanico, pegada a lo que se acaba de
 *    ver, que es cuando apetece llevárselo.
 *  · «Resumen de la jornada»: la rejilla índice, para saltar a un momento.
 *
 * Las dos descargas compartieron sección («Descargar contenido») hasta el
 * 2026-08-13; se separaron a petición del usuario. Los botones siguen la
 * doctrina de la encuesta de satisfacción: solo son enlaces cuando
 * `GET /api/descargas` confirmó ESE paquete, y el peso que enseñan es el del
 * manifiesto, no un copy. Sin confirmación, botón retenido con su aviso.
 *
 * El h1 es el título de la PRIMERA sección, como en el resto del chasis: el
 * arnés mide la distancia del header al primer h1 y la exige igual en las cinco
 * páginas, así que el primer título de la página es siempre el h1.
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
      <div className="gt-contenedor">
        {/* El modificador --arranque quita el vano de sección: este h1 tiene que
            quedar a la misma altura del header que el de las otras cuatro
            páginas del chasis, y eso se mide sobre píxeles. */}
        <section
          className="gt-galeria__descargas gt-galeria__descargas--arranque"
          id="descargar-presentaciones"
        >
          <SectionTitle como="h1">Descarga las presentaciones de tus ponentes</SectionTitle>

          <div className="gt-galeria__descargas-cuerpo">
            <p className="gt-galeria__descargas-texto">{DESCARGAS_PRESENTACIONES_INTRO}</p>

            <ul className="gt-descargas">
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

        {/* El título va aquí y el abanico fuera del contenedor: el mazo compone
            a sangre y su ancho no es el de la columna de texto. */}
        <section className="gt-galeria__titulo-abanico" id="galeria-de-imagenes">
          <SectionTitle apunte={`${GALERIA.length} fotografías`}>Galería de imágenes</SectionTitle>
        </section>
      </div>

      {/* La entradilla vive DENTRO del abanico: comparte fila con el mando,
          que es lo que mantiene los controles en la primera pantalla y le deja
          al mazo todo el alto restante. */}
      <AbanicoFotos fotos={GALERIA} intro={GALERIA_INTRO} alAmpliar={setVisor} />

      <div className="gt-contenedor">
        <section className="gt-galeria__descargas" id="descargar-imagenes">
          <SectionTitle>Descargar imágenes</SectionTitle>

          <div className="gt-galeria__descargas-cuerpo">
            <p className="gt-galeria__descargas-texto">{DESCARGAS_IMAGENES_INTRO}</p>

            <ul className="gt-descargas">
              <li>
                <BotonDescarga
                  rol="imagenes"
                  accion="Descargar imágenes"
                  cosa="fotografías originales"
                  confirmado={descargas.imagenes}
                />
              </li>
            </ul>
          </div>
        </section>

        <section className="gt-galeria__indice" id="resumen-de-jornada">
          <SectionTitle apunte={`${primera.hora} – ${ultima.hora}`}>
            Resumen de la jornada
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

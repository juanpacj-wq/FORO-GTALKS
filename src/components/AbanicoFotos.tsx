import { useEffect, useRef, useState } from 'react'
import type { FotoGaleria } from '../design/galeria'
import './AbanicoFotos.css'

/**
 * El abanico de la galería: la jornada como un mazo de fotografías desplegado
 * en arco, con la activa al centro y las demás asomando detrás, cada vez más
 * giradas y más apagadas hacia los extremos.
 *
 * La geometría es UNA rotación sobre un pivote lejano (transform-origin al
 * 230% del alto de la tarjeta), no una traslación más un giro: girar sobre un
 * punto muy por debajo del canto inferior desplaza Y ladea a la vez, que es lo
 * que hace que las tarjetas barran un arco de verdad como un mazo de cartas en
 * la mano en vez de deslizarse en fila con una inclinación pegada. El rotateY
 * añade la fuga en profundidad de las «páginas» y lo demás (escala, brillo) es
 * jerarquía: la del centro manda, las otras esperan.
 *
 * Cuatro decisiones que no son obvias:
 *
 * - **El mazo es CIRCULAR** (pedido del usuario, 2026-08-12): tras la 80 viene
 *   la 1 y antes de la 1 está la 80, en los botones, en las flechas y en el
 *   arrastre, y el abanico se pinta siempre lleno por los dos lados —en la 1,
 *   a la izquierda asoman 80, 79, 78…—. La ventana se calcula por CORRIMIENTO
 *   respecto del centro (`mod(indice + o)`), no partiendo la lista; y como la
 *   `key` de cada tarjeta es su foto, la que sigue en pantalla tras un paso
 *   conserva su nodo y TRANSICIONA a su nueva posición, cruce o no el empalme
 *   80→1. `Home`/`End` siguen siendo el salto directo a los extremos reales.
 * - **Solo se montan ±VENTANA tarjetas.** Con 80 fotos en el DOM el arrastre
 *   repintaría 80 transformaciones por movimiento de puntero; con 11, ninguna
 *   máquina lo nota. Las que salen de la ventana no están, y no pasa nada,
 *   porque más allá de ±5 pasos una tarjeta queda tapada por sus vecinas.
 * - **Las tarjetas laterales van con `tabIndex={-1}` y `aria-hidden`.** Son
 *   atajos de puntero (saltar a esa foto); para teclado y lector ya existen los
 *   botones anterior/siguiente y el anuncio del vivo. Once paradas de tabulador
 *   que repiten lo que hacen dos botones serían ruido, no acceso.
 * - **El arrastre y el clic comparten puntero**, así que soltar tras arrastrar
 *   dispararía el clic de la tarjeta y abriría el visor sin querer: todo
 *   arrastre que pase de unos píxeles deja una marca (`arrastro`) que el clic
 *   siguiente consume en vez de abrir.
 */

/** Tarjetas montadas a cada lado de la activa. */
const VENTANA = 5
/** Grados de giro sobre el pivote lejano por cada paso de distancia. */
const GIRO_PASO = 5.4
/** Fuga en profundidad de las «páginas» (rotateY), en grados por paso. */
const PROFUNDIDAD_PASO = -7
/** Escala que pierde cada paso, acotada para que el extremo no desaparezca. */
const ESCALA_PASO = 0.045
/** Cuánto se apaga cada paso. La activa queda a brillo pleno. */
const BRILLO_PASO = 0.17
/** Píxeles de arrastre que equivalen a un paso del abanico. */
const ARRASTRE_PASO = 110
/** A partir de aquí un gesto es arrastre y ya no puede ser clic. */
const UMBRAL_ARRASTRE = 8

function transformDe(d: number, plegado: boolean): string {
  // Al montar, el mazo espera casi cerrado y se abre a su sitio: la única
  // animación de entrada, y va en transform, nunca ocultando nada.
  const paso = plegado ? d * 0.16 : d
  const escala = Math.max(1 - Math.abs(paso) * ESCALA_PASO, 0.68)
  return (
    `translate(-50%, -50%) rotate(${paso * GIRO_PASO}deg) ` +
    `rotateY(${paso * PROFUNDIDAD_PASO}deg) scale(${escala})`
  )
}

export default function AbanicoFotos({
  fotos,
  intro,
  alAmpliar,
}: {
  fotos: readonly FotoGaleria[]
  /** La entradilla de la sección: comparte fila con el mando, sobre el mazo. */
  intro: string
  /** Abrir el visor sobre esta foto. */
  alAmpliar: (indice: number) => void
}) {
  const [indice, setIndice] = useState(0)
  /** Corrimiento fraccionario mientras dura un arrastre, en pasos. */
  const [corrimiento, setCorrimiento] = useState(0)
  const [arrastrando, setArrastrando] = useState(false)
  const [plegado, setPlegado] = useState(true)

  const puntero = useRef<{ id: number; x: number; origen: number } | null>(null)
  const arrastro = useRef(false)

  useEffect(() => {
    // Dos marcos: el primero pinta el mazo plegado, el segundo lo abre y la
    // transición hace el resto. Con movimiento reducido dura 0 ms.
    const marco = requestAnimationFrame(() => setPlegado(false))
    return () => cancelAnimationFrame(marco)
  }, [])

  const n = fotos.length
  const ultimo = n - 1
  /** Índice envuelto: `mod(-1)` es la última foto, `mod(n)` la primera. */
  const mod = (i: number) => ((i % n) + n) % n
  const irA = (destino: number) => setIndice(mod(destino))

  const alPuntero = {
    onPointerDown: (e: React.PointerEvent) => {
      // Solo el botón principal; un clic derecho no arrastra el mazo.
      if (e.button !== 0) return
      puntero.current = { id: e.pointerId, x: e.clientX, origen: indice }
      arrastro.current = false
    },
    onPointerMove: (e: React.PointerEvent) => {
      const p = puntero.current
      if (p?.id !== e.pointerId) return
      const dx = e.clientX - p.x
      if (!arrastro.current && Math.abs(dx) < UMBRAL_ARRASTRE) return
      if (!arrastro.current) {
        arrastro.current = true
        setArrastrando(true)
        e.currentTarget.setPointerCapture(e.pointerId)
      }
      // Arrastrar a la izquierda avanza, sin tope: el mazo es circular. El
      // centro sigue al medio paso más cercano y el resto queda de corrimiento,
      // así la ventana se re-centra sola y un arrastre largo nunca se sale de
      // las tarjetas montadas. La posición total de cada foto (su ranura menos
      // el corrimiento) es continua, así que el reparto no produce saltos.
      const efectivo = p.origen - dx / ARRASTRE_PASO
      const centro = Math.round(efectivo)
      setIndice(mod(centro))
      setCorrimiento(efectivo - centro)
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (puntero.current?.id !== e.pointerId) return
      puntero.current = null
      // El centro ya siguió al arrastre; soltar solo suelta el corrimiento.
      setCorrimiento(0)
      setArrastrando(false)
    },
    onPointerCancel: () => {
      puntero.current = null
      setCorrimiento(0)
      setArrastrando(false)
    },
  }

  const alTeclado = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') irA(indice - 1)
    else if (e.key === 'ArrowRight') irA(indice + 1)
    else if (e.key === 'Home') irA(0)
    else if (e.key === 'End') irA(ultimo)
    else return
    e.preventDefault()
  }

  // La ventana, por corrimiento respecto del centro. El guardia del mínimo es
  // defensivo: con menos de 11 fotos la vuelta pondría la misma foto en dos
  // ranuras y React no admite la key repetida.
  const ventana = Math.min(VENTANA, Math.floor((n - 1) / 2))
  const ranuras: { foto: FotoGaleria; real: number; o: number }[] = []
  for (let o = -ventana; o <= ventana; o++) {
    const real = mod(indice + o)
    ranuras.push({ foto: fotos[real], real, o })
  }

  return (
    <section
      className="gt-abanico"
      aria-roledescription="carrusel"
      aria-label="Fotografías de la jornada"
      onKeyDown={alTeclado}
    >
      {/* La cabecera comparte fila: la entradilla a la izquierda y el mando a la
          derecha, ANTES del mazo. Así los controles viven en la primera pantalla
          sin cobrarle altura al abanico, que es quien la necesita. */}
      <div className="gt-abanico__cabecera gt-contenedor">
        <p className="gt-abanico__intro">{intro}</p>

        <div className="gt-abanico__mando">
          <p className="gt-abanico__pie">
            <span className="gt-abanico__hora">{fotos[indice].hora}</span>
            <span className="gt-abanico__cuenta" aria-hidden="true">
              {indice + 1} / {fotos.length}
            </span>
          </p>

          {/* Sin `disabled`: el mazo es circular y los dos sentidos siempre
              tienen destino (antes de la 1 está la 80, y tras la 80, la 1). */}
          <button
            type="button"
            className="gt-abanico__paso"
            onClick={() => irA(indice - 1)}
            aria-label="Fotografía anterior"
          >
            <span aria-hidden="true">→</span>
          </button>
          <button
            type="button"
            className="gt-abanico__paso gt-abanico__paso--siguiente"
            onClick={() => irA(indice + 1)}
            aria-label="Siguiente fotografía"
          >
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>

      <div
        className={
          'gt-abanico__escenario' + (arrastrando ? ' gt-abanico__escenario--arrastrando' : '')
        }
        {...alPuntero}
      >
        {ranuras.map(({ foto, real, o }) => {
          const d = o - corrimiento
          const activa = o === 0
          return (
            <button
              key={foto.id}
              type="button"
              className={'gt-abanico__tarjeta' + (activa ? ' gt-abanico__tarjeta--activa' : '')}
              style={{
                transform: transformDe(d, plegado),
                filter: `brightness(${Math.max(1 - Math.abs(d) * BRILLO_PASO, 0.32)})`,
                zIndex: 40 - Math.round(Math.abs(d) * 2),
              }}
              tabIndex={activa ? 0 : -1}
              aria-hidden={activa ? undefined : 'true'}
              aria-label={
                activa ? `Ampliar la fotografía de las ${foto.hora}` : undefined
              }
              onClick={() => {
                // Soltar un arrastre no es un clic: se consume la marca.
                if (arrastro.current) {
                  arrastro.current = false
                  return
                }
                // Por ranura y no por índice real: `indice + o` conserva el
                // sentido del gesto al cruzar el empalme (en la 1, la vecina
                // izquierda es la 80 y el salto va hacia atrás, no 79 adelante).
                if (activa) alAmpliar(real)
                else irA(indice + o)
              }}
            >
              <img
                src={foto.srcMedia}
                srcSet={foto.srcSet}
                sizes="min(54rem, 92vw)"
                width={foto.ancho}
                height={foto.alto}
                alt=""
                loading={Math.abs(o) <= 1 ? 'eager' : 'lazy'}
                decoding="async"
                fetchPriority={activa ? 'high' : undefined}
                draggable={false}
              />
            </button>
          )
        })}
      </div>

      {/* El anuncio para lectores: el contador visual va aria-hidden porque
          esta línea ya dice lo mismo con sus palabras. */}
      <p className="gt-oculto-visual" aria-live="polite">
        Fotografía {indice + 1} de {fotos.length}, tomada a las {fotos[indice].hora}
      </p>
    </section>
  )
}

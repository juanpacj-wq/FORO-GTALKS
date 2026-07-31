import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
// `useState` sigue en uso para el tic del reloj del QR; el del volteo se fue a la página.
import { QrCodeDataType, encode } from 'uqr'
import { EVENTO, iniciales } from '../data/foro'
import type { Usuario } from '../data/sesion'
import { urlAsistencia } from '../data/escarapela'
import Icono from './Icono'
import './Escarapela.css'

/**
 * El carné del asistente: réplica de `Carnet-foro-1.jpg (1).jpeg` (pieza oficial, raíz del
 * repo) con los datos de la sesión, y un dorso con el QR de registro de asistencia.
 *
 * Decisiones que no son obvias mirando el JSX:
 *
 * - **El retrato es un CÍRCULO, no la «hoja» de `Monogram`.** Es la única excepción a la regla
 *   del sistema, y es deliberada: dentro del carné manda la pieza oficial. Que sea círculo se
 *   midió, no se supuso: los dos ejes salen 509 × 508.8 (la pieza anterior sí era una elipse,
 *   479×496, y esa diferencia estaba en el dibujo, no en la medición).
 * - **El QR se pinta como `<svg>` en el DOM** (un solo `<path>` con todos los módulos), no como
 *   imagen: así no toca `img-src` de la CSP ni necesita red. La matriz la genera `uqr` en
 *   memoria a partir del usuario de la sesión y de la jornada en curso (hora de Bogotá).
 * - **El volteo es un `rotateY` real** con las dos caras en el DOM. La cara no activa queda
 *   `visibility: hidden` (con retardo de media vuelta, ver CSS): sin eso, su texto invisible
 *   seguiría en el árbol de accesibilidad y en el auditor de contraste.
 * - **Las medidas internas van en `cqw`** y salen TODAS de medir la pieza con
 *   `scripts/escarapela-medir.py`. Esta pieza va **a sangre**: el carné ES el lienzo, 1080×1648
 *   de borde a borde, y normalizado a 1024 de ancho su proporción es **1024/1563**. 1cqw =
 *   10.24px de ese carné normalizado. Escala entero como una imagen, sin breakpoints propios;
 *   el contenedor de la query es el MARCO, no el carné, porque la contención de
 *   `container-type` aplanaría el `transform-style: preserve-3d` del volteo.
 * - **Los telones son SVG inline** con los `d` medidos: un `border-radius` no puede dibujar una
 *   banda que se ensancha hacia un lado, y las curvas de la pieza no son arcos de nada.
 * - **El pie va en DOS RENGLONES apilados**, no en una fila con separador como la pieza
 *   anterior. Y es una rejilla de dos columnas, no dos filas independientes: los dos iconos
 *   tienen anchos distintos (36 y 30 px) pero comparten eje (145 px) y los dos rótulos
 *   arrancan en la misma x (196 px). Con dos filas sueltas, el rótulo del alfiler entraría
 *   3 px antes que el del calendario.
 */
export default function Escarapela({
  usuario,
  foto,
  girada,
  onGirar,
}: {
  usuario: Usuario
  /** dataURL de la foto elegida, o null para caer a las iniciales. */
  foto: string | null
  /** Qué cara se ve. El estado NO vive aquí: lo lleva la página, porque el aviso del QR
   *  también voltea el carné y los dos controles tienen que decir siempre lo mismo. */
  girada: boolean
  onGirar: () => void
}) {
  // El QR vive en el tiempo: el ID de capacitación es el de la jornada (hora de Bogotá) del
  // momento del ESCANEO, y quien deja el carné abierto sobre el mediodía debe mostrar el ID de
  // la tarde sin recargar. El tic de 30 s re-evalúa la URL; como la jornada solo cambia dos
  // veces al día, la cadena resultante casi siempre es idéntica y el useMemo del encode ni se
  // entera el QR se re-codifica al cruzar la frontera, no cada tic.
  const [ahora, setAhora] = useState(() => new Date())
  useEffect(() => {
    const tic = setInterval(() => setAhora(new Date()), 30_000)
    return () => clearInterval(tic)
  }, [])

  const url = urlAsistencia(usuario.email, ahora)
  // El estilo del QR es réplica MEDIDA de la pieza «Diseño de Código QR.png» (raíz), con
  // scripts de medición sobre sus píxeles (ver docs/SISTEMA-DE-DISENO.md §La escarapela):
  // puntos separados, marcadores redondeados, azul GECELCA y la «G» al centro.
  //
  // ecc 'Q' (25 % de recuperación) porque el claro del logo tapa ~3 % de los módulos. El borde
  // del encode baja a 2 módulos a propósito: la zona de silencio que exige la norma (4) la
  // completa de sobra el padding blanco del panel, y esos 2 módulos menos agrandan todos los
  // demás con una URL de ~330 caracteres cada punto cuenta.
  const qr = useMemo(() => encode(url, { ecc: 'Q', border: 2 }), [url])
  const qrArte = useMemo(() => {
    const s = qr.size
    // Claro del logo: 10 % del lado (medido: el claro de la pieza es ceñido, ~1 módulo más
    // allá de la «G»). Oclusión ≈ 3 % del área, muy por debajo de lo que ecc 'Q' recupera.
    const claro = s * 0.1
    const centro = s / 2
    // Punto: 72 % del módulo. La medición cruda de la pieza da 62 %, pero sobre un PNG de
    // 234 px el antialias muerde ~1 px por borde y sesga a la baja; 72 % reproduce el mismo
    // gesto de puntos separados. Verificado decodificable con ZXing (la familia de lectores
    // de los teléfonos) desde 500 px de captura jsQR, mucho más estricto que un lector
    // real, solo lee este estilo con puntos tangentes, y ese no es el diseño de la pieza.
    const r = 0.36
    let d = ''
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        if (!qr.data[y][x]) continue
        // Los marcadores de posición no van como puntos: se dibujan aparte, redondeados.
        if (qr.types[y][x] === QrCodeDataType.Position) continue
        const cx = x + 0.5
        const cy = y + 0.5
        if (Math.hypot(cx - centro, cy - centro) < claro) continue
        d += `M${(cx + r).toFixed(2)} ${cy} a${r} ${r} 0 1 0 ${-2 * r} 0 a${r} ${r} 0 1 0 ${2 * r} 0 `
      }
    }
    // Esquinas de los tres marcadores (el borde del encode los desplaza).
    const b = (s - qr.version * 4 - 17) / 2
    const marcadores = [
      [b, b],
      [s - b - 7, b],
      [b, s - b - 7],
    ] as const
    return { d, claro, centro, marcadores }
  }, [qr])

  // Línea bajo el nombre: cargo → área → correo, la misma cascada del menú de sesión.
  const segundaLinea = usuario.cargo || usuario.area || usuario.email

  // El cargo tiene 9.46cqw de luz hasta la píldora (top 120.70 − top 111.24): una línea de su
  // cuerpo base (4.79cqw × 1.15) cabe; la segunda invadía la banda de ASISTENTE «Gerente De
  // Tecnologia De Informacion» lo demostró en producción—. El blindaje MIDE el texto pintado en
  // vez de estimar por caracteres (los avances por glifo no son parejos) y encoge el cuerpo
  // hasta asentarlo en una línea, como la pieza. El piso no es de gusto: sale de la geometría —
  // por debajo de 4.0cqw, DOS líneas (2 × 1.15 × 4.0 = 9.2cqw) también caben en la luz—, así
  // que ni el peor cargo imaginable toca la píldora. Se re-mide al resolver `document.fonts`:
  // con las métricas del fallback, la cifra saldría de otra fuente.
  const cargoRef = useRef<HTMLParagraphElement>(null)
  useLayoutEffect(() => {
    const el = cargoRef.current
    if (!el) return
    const ajustar = () => {
      // Con Range y no con scrollWidth: scrollWidth y clientWidth son ENTEROS, y un desborde
      // de medio píxel se esconde en ese redondeo el texto «casi cabe», el ajuste no actúa y
      // la línea parte igual—. El Range da el ancho fraccional del texto pintado. La holgura
      // del 0.5 % y el redondeo hacia ABAJO matan el otro borde: toFixed redondeando hacia
      // arriba devolvía un cuerpo una pizca mayor que el calculado, y volvía a partir.
      el.style.fontSize = ''
      el.style.whiteSpace = 'nowrap'
      const rango = document.createRange()
      rango.selectNodeContents(el)
      const necesario = rango.getBoundingClientRect().width
      const disponible = el.getBoundingClientRect().width
      el.style.whiteSpace = ''
      if (!disponible || !necesario) return
      if (necesario > disponible) {
        const cuerpo = Math.max(Math.floor(((4.79 * disponible) / necesario) * 0.995 * 100) / 100, 4.0)
        el.style.fontSize = `${cuerpo}cqw`
      }
    }
    ajustar()
    document.fonts?.ready.then(ajustar)
  }, [segundaLinea])

  // La pieza asienta «SOFÍA MUNÉVAR» (13 caracteres) en una línea con una versal de 67px, que
  // en Urbanist son 9.35cqw de cuerpo. Un nombre más largo lo reduce en proporción para asentar
  // igual, con un piso legible: sin esto, «María Cristina Giraldo» partía en dos líneas yaun
  // con cada cosa anclada a su cota— se comía la regla celeste de debajo.
  const nombreFs = `${Math.max(5.4, Math.min(9.35, (9.35 * 13) / Math.max(usuario.nombre_completo.length, 1))).toFixed(2)}cqw`

  return (
    <div className="gt-escarapela-marco">
      <div className="gt-escarapela-escena">
        <div className={`gt-carne${girada ? ' gt-carne--girada' : ''}`}>
          {/* ── Cara frontal: la escarapela ─────────────────────────────────── */}
          <div className="gt-carne__cara gt-carne__cara--frontal gt-lamina">
            {/* Los telones, en un solo SVG a tamaño de carné. Los tres `d` están MEDIDOS de la
                pieza columna a columna y ajustados a Béziers con menos de 1px de error; los
                regenera `scripts/escarapela-medir.py` en `design-extract/escarapela/ondas.txt`.
                No se retocan a mano: se vuelven a medir. */}
            <svg className="gt-carne__fondo" viewBox="0 0 1024 1563" preserveAspectRatio="none" aria-hidden="true">
              <path
                className="gt-carne__onda-navy"
                d="M0 0 H1024 V301.2 C1023.0 301.2 1022.0 301.2 1021.0 301.2 C943.0 301.0 865.0 305.1 787.0 314.8 C710.0 324.3 633.0 339.0 556.0 361.6 C483.0 382.9 410.0 410.9 337.0 450.3 C274.0 484.3 211.0 525.7 148.0 584.4 C99.0 630.1 50.0 683.6 1.0 771.5 C0.7 772.1 0.3 772.7 0.0 773.3 Z"
              />
              <path
                className="gt-carne__onda-banda"
                d="M0.0 773.3 C0.3 772.7 0.7 772.1 1.0 771.5 C50.0 683.6 99.0 630.1 148.0 584.4 C211.0 525.7 274.0 484.3 337.0 450.3 C410.0 410.9 483.0 382.9 556.0 361.6 C633.0 339.0 710.0 324.3 787.0 314.8 C865.0 305.1 943.0 301.0 1021.0 301.2 C1022.0 301.2 1023.0 301.2 1024.0 301.2 L1024.0 332.5 C1023.0 332.5 1022.0 332.5 1021.0 332.5 C942.0 332.9 863.0 337.1 784.0 347.8 C706.0 358.4 628.0 374.6 550.0 399.7 C477.0 423.1 404.0 453.4 331.0 496.4 C268.0 533.5 205.0 578.6 142.0 642.9 C95.0 690.9 48.0 746.9 1.0 837.7 C0.7 838.4 0.3 839.0 0.0 839.7 Z"
              />
              <path
                className="gt-carne__onda-banda"
                d="M186.1 1562.5 C201.4 1561.3 216.7 1560.1 232.0 1558.9 C286.0 1554.7 340.0 1550.3 394.0 1545.9 C448.0 1541.6 502.0 1537.3 556.0 1532.8 C610.0 1528.4 664.0 1524.6 718.0 1519.4 C772.0 1514.2 826.0 1514.7 880.0 1500.2 C927.0 1487.6 974.0 1473.5 1021.0 1431.7 C1022.0 1430.8 1023.0 1429.9 1024.0 1429.0 L1024 1563 H186.1 Z"
              />
            </svg>

            <span className="gt-carne__ranura" aria-hidden="true" />

            {/* Los tamaños de los iconos van por el prop `alto`: Icono los fija como estilo
                inline y una regla CSS no puede ganarle. */}
            <Icono nombre="numeral-uno" alto="35.40cqw" className="gt-carne__numeral" />
            <p className="gt-carne__foro">
              Foro:<br />Energía<br /><span className="gt-carne__foro-celeste">en Acción</span>
            </p>
            <span className="gt-carne__lockup-regla" aria-hidden="true" />
            <p className="gt-carne__bajada">{EVENTO.bajada}</p>

            <div className="gt-carne__gtalks">
              <Icono nombre="icono-burbujas" alto="10.55cqw" className="gt-carne__gtalks-burbujas" />
              <Icono
                nombre="wordmark-g-talks"
                alto="6.42cqw"
                className="gt-carne__gtalks-wordmark"
                titulo={EVENTO.marca}
              />
            </div>

            <div className="gt-carne__cuerpo">
              <div className="gt-carne__retrato">
                {foto ? (
                  // alt vacío a propósito: el nombre está justo debajo, en texto.
                  <img className="gt-carne__foto" src={foto} alt="" />
                ) : (
                  <span className="gt-carne__iniciales" aria-hidden="true">
                    {iniciales(usuario.nombre_completo)}
                  </span>
                )}
              </div>

              <p className="gt-carne__nombre" style={{ fontSize: nombreFs }}>
                {usuario.nombre_completo}
              </p>
              <span className="gt-carne__regla" aria-hidden="true" />
              <p className="gt-carne__cargo" ref={cargoRef}>{segundaLinea}</p>

              <p className="gt-carne__pildora">
                <Icono nombre="carne-personas" alto="6.74cqw" className="gt-carne__pildora-icono" />
                <span className="gt-carne__pildora-sep" aria-hidden="true" />
                <span className="gt-carne__pildora-rol">Asistente</span>
              </p>

              {/* Rejilla de dos columnas con cuatro hijos, no dos renglones sueltos: es lo que
                  alinea los dos rótulos en la misma x pese a que los iconos midan distinto.
                  El texto de cada renglón va envuelto en su `span` para que el espacio duro
                  entre el rótulo y su valor sea el único aire entre ambos. */}
              <div className="gt-carne__pie">
                <Icono nombre="carne-calendario" alto="3.42cqw" className="gt-carne__pie-icono" />
                <span className="gt-carne__pie-texto">
                  <strong>Día:</strong>&nbsp;
                  <span className="gt-carne__pie-valor">{EVENTO.fecha.texto}</span>
                </span>
                <Icono
                  nombre="carne-lugar"
                  alto="3.32cqw"
                  className="gt-carne__pie-icono gt-carne__pie-icono--lugar"
                />
                <span className="gt-carne__pie-texto">
                  <strong>Lugar:</strong>&nbsp;
                  <span className="gt-carne__pie-valor">{EVENTO.lugar}</span>
                </span>
              </div>
            </div>
          </div>

          {/* ── Cara trasera: el QR de asistencia ───────────────────────────── */}
          <div className="gt-carne__cara gt-carne__cara--trasera">
            <span className="gt-carne__ranura" aria-hidden="true" />
            <div className="gt-carne__dorso">
              <div className="gt-carne__dorso-marca">
                <Icono nombre="icono-burbujas" alto="12cqw" />
                <Icono nombre="wordmark-g-talks" alto="5cqw" titulo={EVENTO.marca} />
              </div>
              <div className="gt-carne__qr-panel">
                <svg
                  className="gt-carne__qr"
                  viewBox={`0 0 ${qr.size} ${qr.size}`}
                  role="img"
                  aria-label={`Código QR de registro de asistencia de ${usuario.nombre_completo}`}
                  data-contenido={url}
                >
                  <path d={qrArte.d} fill="currentColor" />
                  {/* Marcadores redondeados que respetan el 1:1:3:1:1 canónico del patrón de
                      posición: un decodificador mide esas proporciones en cada línea de barrido
                      y un anillo blanco desigual lo deja ciego. */}
                  {qrArte.marcadores.map(([mx, my]) => (
                    <g key={`${mx}-${my}`}>
                      <rect x={mx} y={my} width={7} height={7} rx={2.1} fill="currentColor" />
                      <rect x={mx + 1} y={my + 1} width={5} height={5} rx={1.5} fill="var(--gt-blanco)" />
                      <rect x={mx + 2} y={my + 2} width={3} height={3} rx={1} fill="currentColor" />
                    </g>
                  ))}
                  {/* La «G» del centro: marca bicolor fija, va como imagen (regla del sistema).
                      Ancho medido en la pieza: 16 % del lado del código. */}
                  <image
                    href="/img/marca-g.svg"
                    x={qrArte.centro - qr.size * 0.08}
                    y={qrArte.centro - qr.size * 0.08 * (46.24 / 51.62)}
                    width={qr.size * 0.16}
                    height={qr.size * 0.16 * (46.24 / 51.62)}
                  />
                </svg>
              </div>
              <p className="gt-carne__dorso-texto">
                Muestra este código en el registro, el día del foro.
              </p>
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        className="gt-boton gt-escarapela-voltear"
        aria-pressed={girada}
        onClick={onGirar}
      >
        {girada ? 'Ver mis datos' : 'Ver código QR'}
      </button>
    </div>
  )
}

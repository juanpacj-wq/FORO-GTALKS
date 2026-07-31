import { useEffect, useState, type CSSProperties } from 'react'
import { AGENDA, EVENTO, JORNADA, anclaDe, formatoHora, minutos, type Bloque } from '../data/foro'
import './LineaDelDia.css'

/**
 * La jornada como línea de tiempo de una sola pista.
 *
 * Antes esto era un gráfico de barras donde el alto codificaba «intensidad»
 *cuánta gente hay en escena—. Era un dato inventado: en la agenda de un día
 * lo único que existe de verdad es **cuándo empieza cada cosa y cuánto dura**.
 * Una segunda dimensión que no corresponde a nada obliga a leer dos veces y
 * miente un poco.
 *
 * Aquí hay una sola pista: el alto es constante y solo el ancho significa algo.
 * El tipo de bloque se distingue por tratamientorelleno, contorno, trama— y
 * no por tamaño, así que la comparación entre duraciones queda limpia: el
 * almuerzo de 2 h 30 ocupa cinco veces lo que una ponencia de 30 min y se ve.
 *
 * Sigue siendo un índice, no un sustituto del programa: cada tramo enlaza a su
 * bloque en la lista de abajo, que es la fuente legible.
 */

/** Marcas de hora en punto, colocadas por su posición real en la jornada. */
const HORAS = Array.from(
  { length: Math.floor(JORNADA.cierra / 60) - Math.ceil(JORNADA.abre / 60) + 1 },
  (_, i) => {
    const h = Math.ceil(JORNADA.abre / 60) + i
    return { h, pos: ((h * 60 - JORNADA.abre) / JORNADA.total) * 100 }
  },
)

/** Nombre corto para dentro del tramo, cuando hay sitio. */
function corto(bloque: Bloque): string {
  if (bloque.tipo === 'logistico') return bloque.titulo
  if (bloque.tipo === 'panel') return 'Panel'
  if (bloque.tipo === 'ponencia') return 'Ponencia'
  return bloque.titulo.startsWith('Registro') ? 'Registro' : bloque.titulo
}

/**
 * Posición del minuto actual dentro de la jornada, en porcentaje, y solo el día
 * del foro. Cualquier otro día devuelve null y no se dibuja nada: un marcador
 * de «ahora» en una fecha que no es la del evento sería ruido.
 */
function useAhora(): number | null {
  const [pos, setPos] = useState<number | null>(null)

  useEffect(() => {
    const calcular = () => {
      const ahora = new Date()
      const hoy = [
        ahora.getFullYear(),
        String(ahora.getMonth() + 1).padStart(2, '0'),
        String(ahora.getDate()).padStart(2, '0'),
      ].join('-')

      if (hoy !== EVENTO.fecha.iso) return setPos(null)

      const m = ahora.getHours() * 60 + ahora.getMinutes()
      if (m < JORNADA.abre || m > JORNADA.cierra) return setPos(null)

      setPos(((m - JORNADA.abre) / JORNADA.total) * 100)
    }

    calcular()
    const id = setInterval(calcular, 60_000)
    return () => clearInterval(id)
  }, [])

  return pos
}

export default function LineaDelDia({
  activo,
  onActivo,
}: {
  /** Ancla del bloque señalado, venga de la línea o de la lista de abajo. */
  activo: string | null
  onActivo: (ancla: string | null) => void
}) {
  const ahora = useAhora()
  const bloque = AGENDA.find((b) => anclaDe(b) === activo) ?? null

  const paneles = AGENDA.filter((b) => b.tipo === 'panel').length
  const ponencias = AGENDA.filter((b) => b.tipo === 'ponencia').length

  return (
    <div className="gt-linea">
      <nav
        className="gt-linea__marco"
        aria-label="Línea de tiempo de la jornada"
        onMouseLeave={() => onActivo(null)}
      >
        <ol
          className="gt-linea__riel"
          style={
            {
              '--gt-pistas': AGENDA.map(
                (b) => `${minutos(b.fin) - minutos(b.inicio)}fr`,
              ).join(' '),
            } as CSSProperties
          }
        >
          {AGENDA.map((b, i) => {
            const ini = formatoHora(b.inicio)
            const fin = formatoHora(b.fin)
            const ancla = anclaDe(b)
            return (
              <li
                key={`${b.inicio}-${b.titulo}`}
                className={`gt-linea__tramo gt-linea__tramo--${b.tipo}`}
                data-activo={activo === ancla ? '' : undefined}
                /* El revelado avanza de izquierda a derecha: cada tramo entra
                   un poco después que el anterior. */
                style={{ animationRange: `cover ${6 + i * 1.6}% cover ${34 + i * 1.6}%` }}
              >
                <a
                  className="gt-linea__enlace"
                  href={`#${ancla}`}
                  onMouseEnter={() => onActivo(ancla)}
                  onFocus={() => onActivo(ancla)}
                  onBlur={() => onActivo(null)}
                >
                  <span className="gt-linea__interior" aria-hidden="true">
                    <span className="gt-linea__hora">{ini.hora}</span>
                    <span className="gt-linea__nombre">{corto(b)}</span>
                  </span>
                  <span className="gt-oculto-visual">
                    De {ini.hora} {ini.meridiano} a {fin.hora} {fin.meridiano}: {b.titulo}
                  </span>
                </a>
              </li>
            )
          })}
        </ol>

        {ahora !== null && (
          <span className="gt-linea__ahora" style={{ left: `${ahora}%` }}>
            <span className="gt-dato">Ahora</span>
          </span>
        )}

        <div className="gt-linea__eje" aria-hidden="true">
          {HORAS.map(({ h, pos }) => (
            <span
              key={h}
              className={`gt-linea__marca ${h % 2 === 0 ? '' : 'gt-linea__marca--impar'}`}
              style={{ left: `${pos}%` }}
            >
              {h > 12 ? h - 12 : h}
            </span>
          ))}
        </div>
      </nav>

      {/* Duplica lo que ya anuncia el enlace enfocado: para lectores de
          pantalla es ruido, así que se oculta del árbol. */}
      <p className="gt-linea__pie" aria-hidden="true">
        {bloque ? (
          <>
            <span className="gt-dato gt-linea__pie-hora">
              {formatoHora(bloque.inicio).hora} {formatoHora(bloque.inicio).meridiano}{' '}
              {formatoHora(bloque.fin).hora} {formatoHora(bloque.fin).meridiano}
            </span>
            <span className="gt-linea__pie-titulo">{bloque.titulo}</span>
          </>
        ) : (
          <>
            <span className="gt-dato gt-linea__pie-hora">La jornada</span>
            <span className="gt-linea__pie-titulo">
              {ponencias} ponencias, {paneles} paneles y {AGENDA.length - ponencias - paneles}{' '}
              bloques de apertura, cierre y descanso. Cada tramo ocupa su duración real.
            </span>
          </>
        )}
      </p>
    </div>
  )
}

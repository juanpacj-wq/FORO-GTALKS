import type { CSSProperties } from 'react'
import { ICONOS, type IconoNombre } from '../design/iconos'
import { ICONOS_EXTRA, type IconoExtraNombre } from '../design/iconos-extra'
import './Icono.css'

/**
 * Pinta un símbolo monocromo del sistema heredando el color del contexto.
 *
 * No sirve cargar el SVG con una etiqueta `img`: así es un documento aparte y
 * su `currentColor` **no** hereda el `color` de la página se resuelve a
 * negro. Por eso el símbolo va como máscara CSS y el color lo pone
 * `background-color: currentColor`.
 *
 * Como una máscara no tiene tamaño intrínseco, el ancho se deduce del alto con
 * la proporción real del `viewBox`, que `src/design/iconos.ts` trae generada.
 *
 * Solo para símbolos de un color. El logo Gecelca, que es bicolor y de marca
 * fija, va como imagen normal.
 */
export default function Icono({
  nombre,
  alto = '1em',
  className = '',
  titulo,
}: {
  nombre: IconoNombre | IconoExtraNombre
  /** Alto del símbolo. El ancho sale de la proporción del SVG. */
  alto?: string
  className?: string
  /** Si se pasa, el símbolo se anuncia con este nombre; si no, es decorativo. */
  titulo?: string
}) {
  // Dos catálogos, un componente: el generado desde los PDF y el manual (iconos-extra).
  const { src, ratio } = nombre in ICONOS ? ICONOS[nombre as IconoNombre] : ICONOS_EXTRA[nombre as IconoExtraNombre]
  const estilo = {
    '--gt-icono-src': `url("${src}")`,
    height: alto,
    width: `calc(${alto} * ${ratio})`,
  } as CSSProperties

  return (
    <span
      className={`gt-icono ${className}`}
      style={estilo}
      role={titulo ? 'img' : undefined}
      aria-label={titulo}
      aria-hidden={titulo ? undefined : true}
    />
  )
}

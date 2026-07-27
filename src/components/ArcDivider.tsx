import './ArcDivider.css'

/**
 * Los arcos que separan bandas en el sistema.
 *
 * En las piezas están dibujados como paths de 633×700 pt con las dos esquinas
 * superiores muy redondeadas (144.7 y 163.8 pt) y el borde inferior recto: no
 * son medias circunferencias ni olas simétricas, son una banda con las puntas
 * de arriba curvadas, y además sangran fuera del ancho de página.
 *
 * El plan preveía resolverlos como SVG parametrizado, pero medida la forma,
 * un `border-radius` la reproduce exacta y sin el problema del SVG estirado:
 * con `preserveAspectRatio="none"` las curvas se deforman al cambiar el ancho,
 * y con radios en porcentaje no. Se conserva el nombre del componente.
 */
export default function ArcDivider({
  color = 'var(--gt-celeste)',
  alto = '4rem',
  invertido = false,
  className = '',
}: {
  /** Color de la banda. */
  color?: string
  /** Alto de la franja curva. */
  alto?: string
  /** Curva las esquinas de abajo en vez de las de arriba. */
  invertido?: boolean
  className?: string
}) {
  return (
    <div
      aria-hidden="true"
      className={`gt-arco ${invertido ? 'gt-arco--invertido' : ''} ${className}`}
      style={{ background: color, height: alto }}
    />
  )
}

import type { ChangeEvent, HTMLInputAutoCompleteAttribute } from 'react'
import './formulario.css'

/**
 * Un control de formulario accesible: etiqueta, control, ayuda y error, atados entre sí.
 *
 * Es la primera primitiva de formulario del sitio (hasta la carta no había ni un `<input>` de
 * texto), así que las reglas van aquí y no repartidas por el panel:
 *
 * - `label htmlFor` con id único: el nombre accesible del control es su etiqueta visible.
 * - `aria-describedby` apunta a la ayuda Y al error, en ese orden: el lector anuncia primero
 *   qué se espera y después qué falló.
 * - `aria-invalid` solo cuando hay error. El error va en TEXTO, con el nombre del campo delante
 *   («Correo: el formato no es válido»), y el borde cambia de grosor y color: nada depende solo
 *   del color (WCAG 1.4.1) ni solo de la posición.
 * - `maxLength` viene del mismo límite que aplica el servidor (`LIMITES`), pero es UX: si el
 *   servidor dice `demasiado_largo`, se pinta igual.
 */
export default function Campo({
  id,
  nombre,
  etiqueta,
  valor,
  onChange,
  tipo = 'text',
  ayuda,
  error,
  obligatorio = false,
  autoComplete,
  inputMode,
  maxLength,
  placeholder,
}: {
  id: string
  nombre: string
  etiqueta: string
  valor: string
  onChange: (nombre: string, valor: string) => void
  tipo?: 'text' | 'email' | 'tel' | 'url'
  ayuda?: string
  /** El texto del error, ya traducido. Sin él, el campo es válido. */
  error?: string
  obligatorio?: boolean
  autoComplete?: HTMLInputAutoCompleteAttribute
  inputMode?: 'text' | 'email' | 'tel' | 'url'
  maxLength?: number
  placeholder?: string
}) {
  const idAyuda = ayuda ? `${id}-ayuda` : undefined
  const idError = error ? `${id}-error` : undefined
  const describedBy = [idAyuda, idError].filter(Boolean).join(' ') || undefined

  return (
    <div className={`gt-campo${error ? ' gt-campo--invalido' : ''}`}>
      <label className="gt-campo__etiqueta" htmlFor={id}>
        {etiqueta}
        {obligatorio && (
          <span className="gt-campo__obligatorio" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      <input
        className="gt-campo__control"
        id={id}
        name={nombre}
        type={tipo}
        value={valor}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(nombre, e.target.value)}
        aria-required={obligatorio || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        placeholder={placeholder}
        spellCheck={false}
      />
      {ayuda && (
        <p className="gt-campo__ayuda" id={idAyuda}>
          {ayuda}
        </p>
      )}
      {error && (
        <p className="gt-campo__error" id={idError}>
          {error}
        </p>
      )}
    </div>
  )
}

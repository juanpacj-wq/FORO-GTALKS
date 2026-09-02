import { useEffect, useId, useRef, useState } from 'react'
import { ErrorApi, buscarDirectorio } from './api'
import type { PersonaDirectorio } from './tipos'
import './formulario.css'

/**
 * Buscar a la persona en el directorio de Entra para PRELLENAR una carta nueva.
 *
 * Se teclea el nombre (o el correo), el servidor pregunta a Microsoft Graph con las credenciales
 * de la aplicación (`server/carta/directorio.js`) y aquí se listan hasta ocho candidatas; al
 * elegir una, `onElegir` la sube a la página y el formulario se rellena con nombres, apellidos,
 * cargo, área, correo y teléfonos. Es una PROPUESTA: todo sigue siendo editable, y lo que se
 * guarda pasa por la misma validación que lo tecleado.
 *
 * Detalles que no son obvios:
 * - La búsqueda espera 350 ms desde la última tecla y cancela la anterior (`AbortController`):
 *   ni una petición por letra ni una respuesta vieja pisando a la nueva.
 * - El listado es un `listbox` real (`role`, `aria-activedescendant`, flechas y Enter), no una
 *   lista de botones sueltos: quien navega con teclado lo recorre sin salir del campo.
 * - Un 503 del directorio (Graph caído, o sin permiso) no bloquea nada: se avisa y la carta se
 *   escribe a mano. Un 404 significa que este servidor no tiene el buscador (sin credenciales
 *   de Graph): entonces el bloque entero desaparece.
 */
const ESPERA_MS = 350
const MINIMO = 2

export default function BuscadorDirectorio({
  elegida,
  onElegir,
  onFallo,
}: {
  elegida: PersonaDirectorio | null
  onElegir: (persona: PersonaDirectorio) => void
  onFallo: (err: ErrorApi) => void
}) {
  const id = useId()
  const [texto, setTexto] = useState('')
  const [personas, setPersonas] = useState<PersonaDirectorio[]>([])
  const [activa, setActiva] = useState(0)
  const [buscando, setBuscando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [existe, setExiste] = useState(true)
  const [abierto, setAbierto] = useState(false)
  const control = useRef<AbortController | null>(null)

  useEffect(() => {
    const q = texto.trim()
    control.current?.abort()
    if (q.length < MINIMO) {
      setPersonas([])
      setBuscando(false)
      setAbierto(false)
      return
    }
    const actual = new AbortController()
    control.current = actual
    const t = window.setTimeout(async () => {
      setBuscando(true)
      setAviso(null)
      try {
        const r = await buscarDirectorio(q, actual.signal)
        if (actual.signal.aborted) return
        setPersonas(r.personas)
        setActiva(0)
        setAbierto(true)
      } catch (err) {
        if (actual.signal.aborted) return
        setPersonas([])
        setAbierto(false)
        if (err instanceof ErrorApi && err.status === 404) setExiste(false)
        else if (err instanceof ErrorApi && err.status === 503) setAviso('El directorio no responde en este momento. Puedes escribir los datos a mano.')
        else if (err instanceof ErrorApi && (err.status === 401 || err.status === 403)) onFallo(err)
        else setAviso('No se pudo consultar el directorio. Puedes escribir los datos a mano.')
      } finally {
        if (!actual.signal.aborted) setBuscando(false)
      }
    }, ESPERA_MS)
    return () => {
      clearTimeout(t)
      actual.abort()
    }
  }, [texto, onFallo])

  if (!existe) return null

  function elegir(p: PersonaDirectorio) {
    onElegir(p)
    setTexto('')
    setPersonas([])
    setAbierto(false)
  }

  function alTeclear(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!abierto || personas.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiva((i) => Math.min(i + 1, personas.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiva((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      elegir(personas[activa])
    } else if (e.key === 'Escape') {
      setAbierto(false)
    }
  }

  const idLista = `${id}-lista`
  const idOpcion = (i: number) => `${id}-opcion-${i}`

  return (
    <section className="gt-directorio" aria-labelledby={`${id}-titulo`}>
      <h3 id={`${id}-titulo`} className="gt-directorio__titulo">
        Rellenar desde el directorio
      </h3>
      <p className="gt-campo__ayuda">
        Busca a la persona en el directorio de GECELCA y sus datos entran al formulario. Después
        puedes corregir lo que haga falta.
      </p>
      <div className="gt-campo gt-directorio__campo">
        <label className="gt-campo__etiqueta" htmlFor={`${id}-buscar`}>
          Nombre o correo
        </label>
        <input
          id={`${id}-buscar`}
          className="gt-campo__control"
          type="search"
          role="combobox"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={alTeclear}
          onFocus={() => personas.length && setAbierto(true)}
          onBlur={() => window.setTimeout(() => setAbierto(false), 150)}
          aria-expanded={abierto}
          aria-controls={idLista}
          aria-autocomplete="list"
          aria-activedescendant={abierto && personas.length ? idOpcion(activa) : undefined}
          aria-busy={buscando || undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="Por ejemplo: Stefany Vides"
        />
        {abierto && personas.length > 0 && (
          <ul className="gt-directorio__lista" id={idLista} role="listbox" aria-label="Personas del directorio">
            {personas.map((p, i) => (
              <li
                key={p.id}
                id={idOpcion(i)}
                role="option"
                aria-selected={i === activa}
                className={`gt-directorio__opcion${i === activa ? ' gt-directorio__opcion--activa' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => elegir(p)}
              >
                <span className="gt-directorio__nombre">{p.nombre}</span>
                <span className="gt-directorio__detalle">
                  {[p.cargo, p.correo].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {abierto && personas.length === 0 && !buscando && texto.trim().length >= MINIMO && (
        <p className="gt-campo__ayuda" role="status">
          Nadie en el directorio empieza por «{texto.trim()}».
        </p>
      )}
      {aviso && (
        <p className="gt-campo__error" role="status">
          {aviso}
        </p>
      )}
      {elegida && (
        <p className="gt-directorio__elegida" role="status">
          Datos tomados del directorio para <strong>{elegida.nombre}</strong>. Revisa y completa lo que falte.
        </p>
      )}
    </section>
  )
}

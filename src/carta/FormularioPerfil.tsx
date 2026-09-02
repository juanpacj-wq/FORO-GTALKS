import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import Campo from './Campo'
import { ErrorApi } from './api'
import {
  CAMPOS_FORMULARIO,
  LIMITES,
  NOMBRE_RED,
  REDES,
  type CampoFormulario,
  type CodigoCampo,
  type PerfilAdmin,
  type PersonaDirectorio,
  type Red,
  type ValoresFormulario,
} from './tipos'
import './formulario.css'

/** Cómo se llama cada campo en la interfaz: el prefijo de cada error y su etiqueta. */
const ETIQUETA: Record<CampoFormulario, string> = {
  nombres: 'Nombres',
  apellidos: 'Apellidos',
  cargo: 'Cargo',
  area: 'Área',
  correo: 'Correo corporativo',
  telefono: 'Teléfono',
  whatsapp: 'WhatsApp',
  ...NOMBRE_RED,
}

/** Los dominios que admite cada red (copia de `REDES` en server/carta/validacion.js). */
const DOMINIO_RED: Record<Red, string> = {
  linkedin: 'linkedin.com',
  instagram: 'instagram.com',
  x: 'x.com',
  facebook: 'facebook.com',
  youtube: 'youtube.com',
  tiktok: 'tiktok.com',
  sitio_web: 'https://',
}

/** Del código del servidor al texto. El nombre del campo va delante: quien navega con lector
 *  de pantalla oye el error sin tener que volver a la etiqueta. */
export function textoError(campo: CampoFormulario, codigo: CodigoCampo): string {
  const nombre = ETIQUETA[campo]
  switch (codigo) {
    case 'obligatorio':
      return `${nombre}: es obligatorio.`
    case 'demasiado_largo':
      return `${nombre}: es demasiado largo (máximo ${LIMITES[campo]} caracteres).`
    case 'caracteres_no_permitidos':
      return `${nombre}: tiene caracteres que no se admiten.`
    case 'dominio_no_permitido':
      return `${nombre}: debe ser un enlace de ${DOMINIO_RED[campo as Red] ?? 'esa red'}.`
    case 'solo_https':
      return `${nombre}: el enlace debe empezar por https://.`
    case 'duplicado':
      return `${nombre}: ya existe una carta con este correo.`
    case 'formato':
    default:
      return `${nombre}: el formato no es válido.`
  }
}

export function valoresDe(perfil: PerfilAdmin | null): ValoresFormulario {
  const v = Object.fromEntries(CAMPOS_FORMULARIO.map((c) => [c, ''])) as ValoresFormulario
  if (!perfil) return v
  v.nombres = perfil.nombres
  v.apellidos = perfil.apellidos
  v.cargo = perfil.cargo
  v.area = perfil.area ?? ''
  v.correo = perfil.correo
  v.telefono = perfil.telefono ?? ''
  v.whatsapp = perfil.whatsapp ?? ''
  for (const r of REDES) v[r] = perfil.redes[r] ?? ''
  return v
}

/**
 * Alta y edición de una carta. La validación REAL es del servidor: aquí el formulario va con
 * `noValidate` (los mensajes nativos del navegador no siguen el sistema ni son consistentes
 * entre motores) y pinta, campo a campo, los códigos que devuelve el 400. Lo único que se
 * comprueba antes de enviar es que los cuatro obligatorios no vayan vacíos, para no gastar un
 * viaje en lo obvio.
 *
 * NUNCA `action`: la CSP del sitio lleva `form-action 'none'`, así que un envío nativo sería
 * bloqueado. Todo va por `fetch` en `onSubmit`.
 *
 * Los errores que no son de datos (401, 403, 503, red) se devuelven a la página por
 * `onFallo`, que decide qué hacer con la sesión; lo escrito se conserva en el estado del
 * formulario en todos los casos.
 */
export default function FormularioPerfil({
  inicial,
  propuesta = null,
  onGuardar,
  onFallo,
  onCancelar,
}: {
  inicial: PerfilAdmin | null
  /** La persona elegida en el directorio de Entra: rellena los campos que trae y deja el resto
   *  como estaba. Es una propuesta: todo sigue siendo editable. */
  propuesta?: PersonaDirectorio | null
  /** Recibe los valores y lanza `ErrorApi` si el servidor los rechaza. */
  onGuardar: (valores: ValoresFormulario) => Promise<void>
  /** Errores que no son de datos: sesión perdida, sin rol, sin servicio. */
  onFallo: (err: ErrorApi) => void
  onCancelar?: () => void
}) {
  const prefijo = useId()
  const [valores, setValores] = useState<ValoresFormulario>(() => valoresDe(inicial))

  // Al elegir a alguien en el directorio, sus datos entran al formulario. Solo los que vienen
  // con valor: un cargo vacío en Entra no borra el que ya se escribió a mano.
  useEffect(() => {
    if (!propuesta) return
    setValores((v) => ({
      ...v,
      nombres: propuesta.nombres || v.nombres,
      apellidos: propuesta.apellidos || v.apellidos,
      cargo: propuesta.cargo || v.cargo,
      area: propuesta.area || v.area,
      correo: propuesta.correo || v.correo,
      telefono: propuesta.telefono || v.telefono,
      whatsapp: propuesta.whatsapp || v.whatsapp,
    }))
    setErrores({})
    setResumen(null)
  }, [propuesta])
  const [errores, setErrores] = useState<Partial<Record<CampoFormulario, string>>>({})
  const [resumen, setResumen] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const formulario = useRef<HTMLFormElement>(null)

  const idDe = (campo: CampoFormulario) => `${prefijo}-${campo}`

  function cambiar(nombre: string, valor: string) {
    setValores((v) => ({ ...v, [nombre]: valor }))
    // Al corregir un campo, su error se retira: el aviso viejo no puede quedarse contradiciendo lo escrito.
    if (errores[nombre as CampoFormulario]) {
      setErrores((e) => {
        const { [nombre as CampoFormulario]: _quitado, ...resto } = e
        return resto
      })
    }
  }

  /** Enfoca el primer control inválido, en el orden del formulario. */
  function enfocarPrimero(invalidos: Partial<Record<CampoFormulario, string>>) {
    const primero = CAMPOS_FORMULARIO.find((c) => invalidos[c])
    if (!primero) return
    window.setTimeout(() => formulario.current?.querySelector<HTMLInputElement>(`#${CSS.escape(idDe(primero))}`)?.focus(), 0)
  }

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (guardando) return
    setResumen(null)

    const vacios: Partial<Record<CampoFormulario, string>> = {}
    for (const c of ['nombres', 'apellidos', 'cargo', 'correo'] as const) {
      if (!valores[c].trim()) vacios[c] = textoError(c, 'obligatorio')
    }
    if (Object.keys(vacios).length) {
      setErrores(vacios)
      setResumen('Faltan datos obligatorios. Revisa los campos marcados.')
      enfocarPrimero(vacios)
      return
    }

    setGuardando(true)
    try {
      await onGuardar(valores)
    } catch (err) {
      if (err instanceof ErrorApi && (err.status === 400 || err.status === 409)) {
        const porCampo: Partial<Record<CampoFormulario, string>> = {}
        for (const [campo, codigo] of Object.entries(err.campos)) {
          if (CAMPOS_FORMULARIO.includes(campo as CampoFormulario) && codigo) {
            porCampo[campo as CampoFormulario] = textoError(campo as CampoFormulario, codigo)
          }
        }
        if (err.status === 409 && !porCampo.correo) porCampo.correo = textoError('correo', 'duplicado')
        setErrores(porCampo)
        setResumen(
          Object.keys(porCampo).length
            ? 'El servidor no aceptó algunos datos. Revisa los campos marcados.'
            : 'El servidor no aceptó los datos enviados.',
        )
        enfocarPrimero(porCampo)
      } else if (err instanceof ErrorApi) {
        onFallo(err)
      } else {
        setResumen('Ocurrió un error inesperado. Intenta de nuevo.')
      }
    } finally {
      setGuardando(false)
    }
  }

  // `key` va siempre: las redes salen de un `map`, y React exige una clave por hijo de lista.
  const campo = (
    nombre: CampoFormulario,
    extra: Partial<Parameters<typeof Campo>[0]> = {},
  ) => (
    <Campo
      key={nombre}
      id={idDe(nombre)}
      nombre={nombre}
      etiqueta={ETIQUETA[nombre]}
      valor={valores[nombre]}
      onChange={cambiar}
      error={errores[nombre]}
      maxLength={LIMITES[nombre]}
      {...extra}
    />
  )

  return (
    <form className="gt-formulario" ref={formulario} noValidate onSubmit={enviar}>
      {resumen && (
        <p className="gt-formulario__alerta" role="alert">
          {resumen}
        </p>
      )}

      <fieldset className="gt-formulario__grupo">
        <legend>Quién</legend>
        <div className="gt-formulario__fila">
          {campo('nombres', { obligatorio: true, autoComplete: 'given-name' })}
          {campo('apellidos', { obligatorio: true, autoComplete: 'family-name' })}
        </div>
        {campo('cargo', { obligatorio: true, autoComplete: 'organization-title' })}
        {campo('area', { ayuda: 'Gerencia, vicepresidencia o dependencia. Opcional.' })}
      </fieldset>

      <fieldset className="gt-formulario__grupo">
        <legend>Contacto</legend>
        {campo('correo', { obligatorio: true, tipo: 'email', inputMode: 'email', autoComplete: 'email' })}
        <div className="gt-formulario__fila">
          {campo('telefono', {
            tipo: 'tel',
            inputMode: 'tel',
            autoComplete: 'tel',
            ayuda: 'Celular o fijo con indicativo, por ejemplo 300 123 4567 o 605 123 4567.',
          })}
          {campo('whatsapp', {
            tipo: 'tel',
            inputMode: 'tel',
            ayuda: 'Si es el mismo número, escríbelo también aquí para que aparezca el botón.',
          })}
        </div>
      </fieldset>

      <fieldset className="gt-formulario__grupo">
        <legend>Redes y sitio web</legend>
        <p className="gt-campo__ayuda">
          Todas opcionales. Pega el enlace completo, con https://; solo se admite el dominio de
          cada red.
        </p>
        <div className="gt-formulario__fila">
          {REDES.map((r) =>
            campo(r, {
              tipo: 'url',
              inputMode: 'url',
              placeholder: r === 'sitio_web' ? 'https://' : `https://${DOMINIO_RED[r]}/`,
            }),
          )}
        </div>
      </fieldset>

      <div className="gt-formulario__acciones">
        <button type="submit" className="gt-boton gt-boton--solido" aria-busy={guardando || undefined} disabled={guardando}>
          {inicial ? 'Guardar cambios' : 'Crear la carta'}
        </button>
        {onCancelar && (
          <button type="button" className="gt-boton" onClick={onCancelar}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  )
}

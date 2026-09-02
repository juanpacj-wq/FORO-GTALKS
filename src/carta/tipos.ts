/**
 * Las formas que devuelve `/api/carta` (ver `server/carta/rutas.js` y `repositorio.js`).
 *
 * Son transcripción del contrato del servidor, no una segunda fuente de verdad: si el servidor
 * cambia una forma, esto se cambia con él. `LIMITES` es una COPIA de `server/carta/validacion.js`
 * y sirve solo para el `maxLength` de los campos (UX); la validación real la hace el servidor y
 * la interfaz solo pinta los códigos que le devuelve.
 */

export const REDES = ['linkedin', 'instagram', 'x', 'facebook', 'youtube', 'tiktok', 'sitio_web'] as const
export type Red = (typeof REDES)[number]

/** Cómo se nombra cada red en la interfaz (botones, etiquetas y mensajes de error). */
export const NOMBRE_RED: Record<Red, string> = {
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  x: 'X',
  facebook: 'Facebook',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  sitio_web: 'Sitio web',
}

export type Redes = Record<Red, string | null>

export interface FotoPublica {
  url: string
  etag: string
}

/** `GET /api/carta/perfiles/:id`: solo lo que la tarjeta pinta. */
export interface PerfilPublico {
  id: string
  nombres: string
  apellidos: string
  nombre: string
  cargo: string
  area: string | null
  correo: string
  telefono: string | null
  whatsapp: string | null
  redes: Redes
  foto: FotoPublica | null
  /** La URL absoluta de la tarjeta: lo que codifica el QR y lo que se comparte. */
  url: string
}

export interface FotoAdmin extends FotoPublica {
  ancho: number
  alto: number
  bytes: number
}

/** `GET /api/carta/admin/perfiles/:id` → `perfil`. Sin `nombre`: se compone aquí. */
export interface PerfilAdmin {
  id: string
  nombres: string
  apellidos: string
  cargo: string
  area: string | null
  correo: string
  telefono: string | null
  whatsapp: string | null
  redes: Redes
  foto: FotoAdmin | null
  activo: boolean
  creado_en: string
  actualizado_en: string
  url: string
}

export interface Auditoria {
  ts: string
  actor: string
  accion: 'crear' | 'editar' | 'activar' | 'desactivar' | 'foto_subir' | 'foto_quitar'
  detalle: { campos?: string[]; activo?: boolean; bytes?: number } | null
}

/**
 * Una persona del directorio de Entra (`GET /api/carta/admin/directorio?q=`), ya en la forma
 * del formulario: es una PROPUESTA para prellenar, y todo queda editable antes de guardar.
 */
export interface PersonaDirectorio {
  id: string
  nombre: string
  nombres: string
  apellidos: string
  cargo: string
  area: string
  correo: string
  telefono: string
  whatsapp: string
}

/** Una fila del listado del panel (`GET /api/carta/admin/perfiles`). */
export interface PerfilResumen {
  id: string
  nombre: string
  cargo: string
  area: string | null
  correo: string
  activo: boolean
  foto: boolean
  actualizado_en: string
}

/** Los campos que viajan en el POST/PUT, todos como texto: el servidor normaliza. */
export const CAMPOS_FORMULARIO = [
  'nombres',
  'apellidos',
  'cargo',
  'area',
  'correo',
  'telefono',
  'whatsapp',
  ...REDES,
] as const
export type CampoFormulario = (typeof CAMPOS_FORMULARIO)[number]
export type ValoresFormulario = Record<CampoFormulario, string>

/** Copia de `LIMITES` de server/carta/validacion.js. Solo para `maxLength`. */
export const LIMITES: Record<CampoFormulario, number> = {
  nombres: 80,
  apellidos: 80,
  cargo: 120,
  area: 120,
  correo: 254,
  telefono: 32,
  whatsapp: 32,
  linkedin: 200,
  instagram: 200,
  x: 200,
  facebook: 200,
  youtube: 200,
  tiktok: 200,
  sitio_web: 200,
}

/** Los códigos por campo que devuelve el 400 (validacion.js) y el 409 (`duplicado`). */
export type CodigoCampo =
  | 'obligatorio'
  | 'demasiado_largo'
  | 'formato'
  | 'caracteres_no_permitidos'
  | 'dominio_no_permitido'
  | 'solo_https'
  | 'duplicado'

/** El id público es un UUID v4 en minúsculas; lo que no case no merece ni un fetch. */
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function nombreCompleto(p: { nombres: string; apellidos: string }): string {
  return `${p.nombres} ${p.apellidos}`.trim()
}

/**
 * Un E.164 colombiano, legible: `+57 300 123 4567` (celular) o `+57 605 370 0000` (fijo). Los
 * demás países se dejan tal cual: agruparlos a ciegas los haría más difíciles de leer, no menos.
 * Solo para el TEXTO; el `href` lleva siempre el E.164 pelado.
 */
export function formatoTelefono(e164: string): string {
  const m = e164.match(/^\+57(\d{3})(\d{3})(\d{4})$/)
  return m ? `+57 ${m[1]} ${m[2]} ${m[3]}` : e164
}

/** La ruta de la foto con el ETag como rompecachés: cambiar la foto cambia la URL. */
export function srcFoto(foto: FotoPublica): string {
  return `${foto.url}?v=${foto.etag.slice(0, 8)}`
}

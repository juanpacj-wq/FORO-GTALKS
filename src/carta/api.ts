/**
 * El cliente de `/api/carta`: un `fetch` tipado por ruta, y un solo tipo de error.
 *
 * Todo va con `credentials: 'same-origin'` (el panel exige la cookie de sesión) y consume el
 * cuerpo SIEMPRE, también en los errores: una respuesta cuyo cuerpo nadie lee deja la petición
 * sin cerrar (así se cayeron las pruebas de Playwright con `networkidle`, ver `sesion.ts`).
 *
 * `ErrorApi` lleva el `status`, el `codigo` del servidor y `campos` cuando es un 400/409: el
 * formulario los traduce a texto junto a cada control. Un fallo de red (fetch que revienta)
 * es un `ErrorApi` con `status: 0`, que la interfaz trata como «sin servicio», igual que un 503.
 */
import type { PerfilAdmin, PerfilPublico, PerfilResumen, Auditoria, CodigoCampo, ValoresFormulario, FotoAdmin } from './tipos'

export class ErrorApi extends Error {
  status: number
  codigo: string
  campos: Partial<Record<string, CodigoCampo>>

  constructor(status: number, codigo: string, campos: Partial<Record<string, CodigoCampo>> = {}) {
    super(`${status} ${codigo}`)
    this.name = 'ErrorApi'
    this.status = status
    this.codigo = codigo
    this.campos = campos
  }

  /** 503 o fetch roto: el servicio no está, no es culpa de lo escrito. */
  get sinServicio(): boolean {
    return this.status === 0 || this.status === 503 || this.status === 502 || this.status === 504
  }
}

async function pedir<T>(ruta: string, init: RequestInit = {}): Promise<T> {
  let r: Response
  try {
    r = await fetch(ruta, {
      credentials: 'same-origin',
      ...init,
      headers: { accept: 'application/json', ...(init.headers ?? {}) },
    })
  } catch {
    throw new ErrorApi(0, 'sin_red')
  }
  const datos = (await r.json().catch(() => null)) as
    | ({ codigo?: string; campos?: Record<string, CodigoCampo> } & T)
    | null
  if (!r.ok) {
    throw new ErrorApi(r.status, datos?.codigo ?? (r.status === 401 ? 'sin_sesion' : 'error'), datos?.campos ?? {})
  }
  if (datos === null) throw new ErrorApi(r.status, 'respuesta_vacia')
  return datos
}

const json = (metodo: 'POST' | 'PUT', cuerpo: unknown): RequestInit => ({
  method: metodo,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(cuerpo),
})

// ── Público ──────────────────────────────────────────────────────────────────

export function obtenerPerfil(id: string): Promise<PerfilPublico> {
  return pedir<PerfilPublico>(`/api/carta/perfiles/${id}`)
}

// ── Admin ────────────────────────────────────────────────────────────────────

export type FiltroEstado = 'activos' | 'inactivos' | 'todos'

export function listar(estado: FiltroEstado): Promise<{ perfiles: PerfilResumen[]; total: number }> {
  return pedir(`/api/carta/admin/perfiles?estado=${estado}`)
}

export function obtenerAdmin(id: string): Promise<{ perfil: PerfilAdmin; auditoria: Auditoria[] }> {
  return pedir(`/api/carta/admin/perfiles/${id}`)
}

export function crear(valores: ValoresFormulario): Promise<{ perfil: PerfilAdmin }> {
  return pedir('/api/carta/admin/perfiles', json('POST', valores))
}

export function actualizar(id: string, valores: ValoresFormulario): Promise<{ perfil: PerfilAdmin }> {
  return pedir(`/api/carta/admin/perfiles/${id}`, json('PUT', valores))
}

export function cambiarEstado(id: string, activo: boolean): Promise<{ id: string; activo: boolean }> {
  return pedir(`/api/carta/admin/perfiles/${id}/estado`, json('PUT', { activo }))
}

export function subirFoto(id: string, archivo: Blob): Promise<{ foto: FotoAdmin }> {
  const cuerpo = new FormData()
  cuerpo.append('foto', archivo, 'foto.jpg')
  return pedir(`/api/carta/admin/perfiles/${id}/foto`, { method: 'PUT', body: cuerpo })
}

export function quitarFoto(id: string): Promise<{ ok: true }> {
  return pedir(`/api/carta/admin/perfiles/${id}/foto`, { method: 'DELETE' })
}

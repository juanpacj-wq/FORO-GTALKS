// Fixtures de la carta de presentación para los arneses de navegador (sesion-test, a11y-test,
// screenshot, interactions-test). Un solo sitio, para que las cuatro pruebas vean la MISMA
// tarjeta y el mismo panel, y para que un cambio de contrato se corrija una vez.
//
// `instalarMocks(page, opciones)` intercepta `/api/me` y `/api/carta/**` con `page.route`. Solo
// atiende lo que pide una página de la carta (`/carta_presentacion/…` o `/cdpadmin`): en las
// demás rutas deja pasar la petición (`fallback`) para no alterar lo que esos arneses ya
// auditan del resto del sitio.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Un UUID v4 válido, fijo. */
export const ID_FIXTURE = '7f3c1a2e-5b4d-4c8e-9a1b-2c3d4e5f6a7b'
export const ID_SEGUNDO = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
/** Otro v4 válido que NUNCA existe: el 404. */
export const ID_INEXISTENTE = '11111111-2222-4333-8444-555555555555'

export const ORIGEN = 'https://cdp.gecelca.com.co'

export const PERFIL_PUBLICO = {
  id: ID_FIXTURE,
  nombres: 'Stefany',
  apellidos: 'Vides Osorio',
  nombre: 'Stefany Vides Osorio',
  cargo: 'Jefa de Comunicaciones y Relacionamiento',
  area: 'Vicepresidencia de Asuntos Corporativos',
  correo: 'svides@gecelca.com.co',
  telefono: '+576053700000',
  whatsapp: '+573001234567',
  redes: {
    linkedin: 'https://www.linkedin.com/company/gecelca/',
    instagram: 'https://www.instagram.com/gecelca/',
    x: null,
    facebook: null,
    youtube: null,
    tiktok: null,
    sitio_web: 'https://www.gecelca.com.co/',
  },
  foto: { url: `/api/carta/perfiles/${ID_FIXTURE}/foto`, etag: 'a'.repeat(64) },
  url: `${ORIGEN}/carta_presentacion/${ID_FIXTURE}`,
}

export const PERFIL_ADMIN = {
  ...PERFIL_PUBLICO,
  nombre: undefined,
  foto: { ...PERFIL_PUBLICO.foto, ancho: 640, alto: 800, bytes: 48210 },
  activo: true,
  creado_en: '2026-09-01T14:00:00.000Z',
  actualizado_en: '2026-09-02T13:30:00.000Z',
}

export const AUDITORIA = [
  { ts: '2026-09-02T13:30:00.000Z', actor: 'svides@gecelca.com.co', accion: 'editar', detalle: { campos: ['cargo'] } },
  { ts: '2026-09-01T14:05:00.000Z', actor: 'svides@gecelca.com.co', accion: 'foto_subir', detalle: { bytes: 48210 } },
  { ts: '2026-09-01T14:00:00.000Z', actor: 'svides@gecelca.com.co', accion: 'crear', detalle: null },
]

export const LISTADO = {
  perfiles: [
    {
      id: ID_FIXTURE,
      nombre: 'Stefany Vides Osorio',
      cargo: PERFIL_PUBLICO.cargo,
      area: PERFIL_PUBLICO.area,
      correo: PERFIL_PUBLICO.correo,
      activo: true,
      foto: true,
      actualizado_en: '2026-09-02T13:30:00.000Z',
    },
    {
      id: ID_SEGUNDO,
      nombre: 'Juan Pablo Céspedes Jiménez',
      cargo: 'Ingeniero de Desarrollo',
      area: 'Tecnología de Información',
      correo: 'jcespedes@gecelca.com.co',
      activo: true,
      foto: false,
      actualizado_en: '2026-08-30T20:00:00.000Z',
    },
  ],
  total: 2,
}

/** La identidad con el rol que administra. `roles` lo lleva por fidelidad; la interfaz mira `carta`. */
export const IDENTIDAD_ADMIN = {
  authenticated: true,
  user: {
    nombre_completo: 'Stefany Vides Osorio',
    cargo: 'Jefa de Comunicaciones y Relacionamiento',
    area: 'Vicepresidencia de Asuntos Corporativos',
    upn: 'svides@gecelca.com.co',
    email: 'svides@gecelca.com.co',
    oid: '00000000-aaaa-bbbb-cccc-dddddddddddd',
    roles: ['LOGIN_JEFA'],
  },
  inscripcion: { estado: 'no_aplica' },
  certificado: 'no_aplica',
  carta: 'admin',
}

/** Un retrato real del repo, en WebP, para la foto de la tarjeta. */
const FOTO_WEBP = readFileSync(path.join(RAIZ, 'public', 'img', 'ponentes', 'alfredo-chamat-barrios.webp'))

const esPaginaCarta = (page) => /\/carta_presentacion\/|\/cdpadmin/.test(page.url())

/**
 * @param page      la página de Playwright
 * @param opciones  { me: objeto para /api/me (por defecto IDENTIDAD_ADMIN) | null para 401,
 *                    perfil: 'ok' | 404 | 503 (qué contesta el público),
 *                    siempre: true para atender también fuera de las páginas de la carta }
 */
export async function instalarMocks(page, { me = IDENTIDAD_ADMIN, perfil = 'ok', siempre = false, alGuardar = null } = {}) {
  const atiende = () => siempre || esPaginaCarta(page)

  await page.route('**/api/me', (ruta) => {
    if (!atiende()) return ruta.fallback()
    if (me === null) return ruta.fulfill({ status: 401, json: { authenticated: false } })
    return ruta.fulfill({ json: me })
  })

  await page.route('**/api/carta/**', async (ruta) => {
    if (!atiende()) return ruta.fallback()
    const req = ruta.request()
    const url = new URL(req.url())
    const metodo = req.method()
    const p = url.pathname

    // Público
    if (p === `/api/carta/perfiles/${ID_FIXTURE}` && metodo === 'GET') {
      if (perfil === 404) return ruta.fulfill({ status: 404, json: { error: 'No encontrado', codigo: 'no_encontrado' } })
      if (perfil === 503) return ruta.fulfill({ status: 503, json: { error: 'Servicio no disponible', codigo: 'bd_no_disponible' } })
      return ruta.fulfill({ json: PERFIL_PUBLICO })
    }
    if (p === `/api/carta/perfiles/${ID_FIXTURE}/foto`) {
      return ruta.fulfill({ status: 200, contentType: 'image/webp', body: FOTO_WEBP, headers: { etag: `"${'a'.repeat(64)}"` } })
    }
    if (p === `/api/carta/perfiles/${ID_FIXTURE}/vcard`) {
      return ruta.fulfill({
        status: 200,
        contentType: 'text/vcard; charset=utf-8',
        headers: { 'content-disposition': 'attachment; filename="Stefany Vides Osorio.vcf"' },
        body: 'BEGIN:VCARD\r\nVERSION:3.0\r\nN:Vides Osorio;Stefany;;;\r\nFN:Stefany Vides Osorio\r\nEND:VCARD\r\n',
      })
    }

    // Admin
    if (me === null) return ruta.fulfill({ status: 401, json: { authenticated: false } })
    if (me.carta !== 'admin') return ruta.fulfill({ status: 403, json: { error: 'Sin permiso', codigo: 'sin_rol' } })

    if (p === '/api/carta/admin/perfiles' && metodo === 'GET') return ruta.fulfill({ json: LISTADO })
    if (p === '/api/carta/admin/perfiles' && metodo === 'POST') {
      if (alGuardar) return ruta.fulfill(alGuardar(req))
      return ruta.fulfill({ status: 201, json: { perfil: { ...PERFIL_ADMIN, ...JSON.parse(req.postData() || '{}') } } })
    }
    if (p === `/api/carta/admin/perfiles/${ID_FIXTURE}` && metodo === 'GET') {
      return ruta.fulfill({ json: { perfil: PERFIL_ADMIN, auditoria: AUDITORIA } })
    }
    if (p === `/api/carta/admin/perfiles/${ID_FIXTURE}` && metodo === 'PUT') {
      if (alGuardar) return ruta.fulfill(alGuardar(req))
      return ruta.fulfill({ json: { perfil: { ...PERFIL_ADMIN, ...JSON.parse(req.postData() || '{}') } } })
    }
    if (p === `/api/carta/admin/perfiles/${ID_FIXTURE}/estado` && metodo === 'PUT') {
      return ruta.fulfill({ json: { id: ID_FIXTURE, activo: JSON.parse(req.postData() || '{}').activo } })
    }
    if (p === `/api/carta/admin/perfiles/${ID_FIXTURE}/foto` && metodo === 'PUT') {
      return ruta.fulfill({ json: { foto: { ...PERFIL_ADMIN.foto, etag: 'b'.repeat(64) } } })
    }
    if (p === `/api/carta/admin/perfiles/${ID_FIXTURE}/foto` && metodo === 'DELETE') {
      return ruta.fulfill({ json: { ok: true } })
    }
    return ruta.fulfill({ status: 404, json: { error: 'No encontrado', codigo: 'no_encontrado' } })
  })
}

/** El 400 del servidor con errores por campo, para simular en el formulario. */
export const RESPUESTA_400 = {
  status: 400,
  json: {
    error: 'Datos inválidos',
    codigo: 'datos_invalidos',
    campos: { correo: 'formato', linkedin: 'dominio_no_permitido' },
  },
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import SectionTitle from '../components/SectionTitle'
import { useSesion } from '../data/sesion'
import { MENSAJES_AUTH } from '../data/escarapela'
import Tarjeta from '../carta/Tarjeta'
import QrTarjeta from '../carta/QrTarjeta'
import FormularioPerfil from '../carta/FormularioPerfil'
import SubidaFoto from '../carta/SubidaFoto'
import { ErrorApi, actualizar, cambiarEstado, crear, listar, obtenerAdmin, type FiltroEstado } from '../carta/api'
import {
  UUID_V4,
  nombreCompleto,
  type Auditoria,
  type FotoAdmin,
  type PerfilAdmin,
  type PerfilPublico,
  type PerfilResumen,
  type ValoresFormulario,
} from '../carta/tipos'
import './PonentesPage.css'
import './CdpAdminPage.css'

/**
 * `/cdpadmin`: el panel de las cartas de presentación.
 *
 * El gate sigue el patrón exacto de /certificado: sin sesión, la invitación a entrar con retorno
 * a esta ruta; con sesión pero sin el rol, el botón RETENIDO con su aviso (`aria-disabled`,
 * `aria-describedby`, Escape lo descarta aunque siga enfocado, con la clase doblada); y con
 * `carta: 'admin'`, el panel. Ese `admin` es lo que el SERVIDOR confirma en /api/me: la interfaz
 * solo decide qué pinta, y cada ruta del panel vuelve a exigir sesión y rol por su cuenta.
 *
 * El detalle vive en `?perfil=<id>` (o `?perfil=nueva`), así que el navegador guarda el sitio
 * y «atrás» vuelve a la lista. Un 401 en cualquier llamada (la revalidación mató la sesión, o
 * caducó) se anuncia con el enlace para volver a entrar y NO borra lo escrito; un 403 (el rol
 * se fue) vuelve al gate retenido; un 503 avisa y conserva todo.
 */

const AVISO_TOQUE_MS = 6000

const AVISO_SIN_ROL =
  'Tu cuenta no tiene el permiso para administrar las cartas. Si te lo acaban de asignar, la ' +
  'sesión lo aprende en unos minutos: puedes cerrar sesión y volver a entrar.'

const ACCION: Record<Auditoria['accion'], string> = {
  crear: 'Creó la carta',
  editar: 'Editó',
  activar: 'Activó',
  desactivar: 'Desactivó',
  foto_subir: 'Subió la foto',
  foto_quitar: 'Quitó la foto',
}

function fecha(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' }).format(d)
}

/** Lo que la tarjeta pública pintaría con este perfil: la previsualización del panel. */
function aPublico(p: PerfilAdmin): PerfilPublico {
  return {
    id: p.id,
    nombres: p.nombres,
    apellidos: p.apellidos,
    nombre: nombreCompleto(p),
    cargo: p.cargo,
    area: p.area,
    correo: p.correo,
    telefono: p.telefono,
    whatsapp: p.whatsapp,
    redes: p.redes,
    foto: p.foto ? { url: p.foto.url, etag: p.foto.etag } : null,
    url: p.url,
  }
}

function BotonRetenido() {
  const [avisando, setAvisando] = useState(false)
  const [suprimido, setSuprimido] = useState(false)

  useEffect(() => {
    if (!avisando) return
    const t = window.setTimeout(() => setAvisando(false), AVISO_TOQUE_MS)
    return () => clearTimeout(t)
  }, [avisando])

  return (
    <span
      className={
        'gt-cdp__gate' +
        (avisando ? ' gt-cdp__gate--avisando' : '') +
        (suprimido ? ' gt-cdp__gate--suprimido' : '')
      }
    >
      <button
        type="button"
        className="gt-boton gt-boton--inactivo gt-cdp__entrar"
        aria-disabled="true"
        aria-describedby="gt-cdp-aviso"
        onClick={() => {
          setSuprimido(false)
          setAvisando((v) => !v)
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          setAvisando(false)
          setSuprimido(true)
        }}
        onBlur={() => {
          setAvisando(false)
          setSuprimido(false)
        }}
      >
        Administrar las cartas
      </button>
      <span role="tooltip" id="gt-cdp-aviso" className="gt-cdp__aviso gt-lamina">
        {AVISO_SIN_ROL}
      </span>
      <a className="gt-cdp__otra-cuenta" href="/auth/login?select=1&destino=/cdpadmin">
        Cerrar sesión y volver a entrar
      </a>
    </span>
  )
}

/** Un fallo que no es de datos, dicho una vez y con la salida que toca. */
function AvisoFallo({ fallo }: { fallo: ErrorApi }) {
  if (fallo.status === 401) {
    return (
      <p className="gt-cdp__alerta" role="alert">
        Tu sesión terminó. Lo que escribiste sigue aquí: {' '}
        <a href="/auth/login?destino=/cdpadmin">vuelve a entrar</a> y repite el envío.
      </p>
    )
  }
  if (fallo.sinServicio) {
    return (
      <p className="gt-cdp__alerta" role="alert">
        El servicio no responde en este momento. Lo que escribiste se conserva: espera unos
        segundos e intenta de nuevo.
      </p>
    )
  }
  return (
    <p className="gt-cdp__alerta" role="alert">
      Ocurrió un error inesperado ({fallo.codigo}). Intenta de nuevo.
    </p>
  )
}

function Panel({ onSinRol }: { onSinRol: () => void }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const seleccion = searchParams.get('perfil')
  const [filtro, setFiltro] = useState<FiltroEstado>('activos')
  const [busqueda, setBusqueda] = useState('')
  const [lista, setLista] = useState<PerfilResumen[] | null>(null)
  const [fallo, setFallo] = useState<ErrorApi | null>(null)

  const tratarFallo = useCallback(
    (err: ErrorApi) => {
      if (err.status === 403) onSinRol()
      else setFallo(err)
    },
    [onSinRol],
  )

  const recargarLista = useCallback(async () => {
    try {
      const r = await listar(filtro)
      setLista(r.perfiles)
      setFallo(null)
    } catch (err) {
      if (err instanceof ErrorApi) tratarFallo(err)
    }
  }, [filtro, tratarFallo])

  useEffect(() => {
    let vivo = true
    listar(filtro).then(
      (r) => vivo && (setLista(r.perfiles), setFallo(null)),
      (err) => vivo && err instanceof ErrorApi && tratarFallo(err),
    )
    return () => {
      vivo = false
    }
  }, [filtro, tratarFallo])

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!lista) return []
    if (!q) return lista
    return lista.filter((p) => `${p.nombre} ${p.cargo} ${p.area ?? ''} ${p.correo}`.toLowerCase().includes(q))
  }, [lista, busqueda])

  const irA = (perfil: string | null) => {
    const siguiente = new URLSearchParams(searchParams)
    if (perfil) siguiente.set('perfil', perfil)
    else siguiente.delete('perfil')
    setSearchParams(siguiente)
  }

  if (seleccion === 'nueva' || (seleccion && UUID_V4.test(seleccion))) {
    return (
      <Detalle
        id={seleccion === 'nueva' ? null : seleccion}
        onVolver={() => {
          irA(null)
          recargarLista()
        }}
        onCreado={(id) => irA(id)}
        onFallo={tratarFallo}
      />
    )
  }

  return (
    <div className="gt-cdp__panel">
      {fallo && <AvisoFallo fallo={fallo} />}

      <div className="gt-cdp__mandos">
        <fieldset className="gt-cdp__filtro">
          <legend className="gt-dato">Mostrar</legend>
          {(['activos', 'inactivos', 'todos'] as const).map((f) => (
            <label key={f} className="gt-cdp__radio">
              <input type="radio" name="filtro" value={f} checked={filtro === f} onChange={() => setFiltro(f)} />
              <span>{f === 'activos' ? 'Activas' : f === 'inactivos' ? 'Inactivas' : 'Todas'}</span>
            </label>
          ))}
        </fieldset>

        <div className="gt-campo gt-cdp__busqueda">
          <label className="gt-campo__etiqueta" htmlFor="gt-cdp-busqueda">
            Buscar
          </label>
          <input
            id="gt-cdp-busqueda"
            className="gt-campo__control"
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Nombre, cargo, área o correo"
            autoComplete="off"
          />
        </div>

        <button type="button" className="gt-boton gt-boton--solido gt-cdp__nueva" onClick={() => irA('nueva')}>
          Nueva carta
        </button>
      </div>

      {lista === null ? (
        <p className="gt-cdp__vacio" aria-busy="true">
          Cargando las cartas…
        </p>
      ) : visibles.length === 0 ? (
        <p className="gt-cdp__vacio">
          {lista.length === 0 ? 'Todavía no hay cartas con este filtro.' : 'Ninguna carta coincide con la búsqueda.'}
        </p>
      ) : (
        <div className="gt-cdp__tabla-marco">
          <table className="gt-cdp__tabla">
            <caption className="gt-oculto-visual">
              Cartas de presentación: {visibles.length} de {lista.length}
            </caption>
            <thead>
              <tr>
                <th scope="col">Nombre</th>
                <th scope="col">Cargo</th>
                <th scope="col">Correo</th>
                <th scope="col">Estado</th>
                <th scope="col">Foto</th>
                <th scope="col">
                  <span className="gt-oculto-visual">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((p) => (
                <tr key={p.id}>
                  <th scope="row">{p.nombre}</th>
                  <td>{p.cargo}</td>
                  <td className="gt-cdp__correo">{p.correo}</td>
                  <td>
                    <span className="gt-chip">{p.activo ? 'Activa' : 'Inactiva'}</span>
                  </td>
                  <td>{p.foto ? 'Sí' : 'No'}</td>
                  <td>
                    <Link className="gt-cdp__editar" to={`/cdpadmin?perfil=${p.id}`}>
                      Editar<span className="gt-oculto-visual"> a {p.nombre}</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Detalle({
  id,
  onVolver,
  onCreado,
  onFallo,
}: {
  id: string | null
  onVolver: () => void
  onCreado: (id: string) => void
  onFallo: (err: ErrorApi) => void
}) {
  const [perfil, setPerfil] = useState<PerfilAdmin | null>(null)
  const [auditoria, setAuditoria] = useState<Auditoria[]>([])
  const [cargando, setCargando] = useState(id !== null)
  const [noExiste, setNoExiste] = useState(false)
  const [fallo, setFallo] = useState<ErrorApi | null>(null)
  const [guardado, setGuardado] = useState<string | null>(null)

  const tratar = useCallback(
    (err: ErrorApi) => {
      if (err.status === 403) onFallo(err)
      else setFallo(err)
    },
    [onFallo],
  )

  useEffect(() => {
    if (!id) return
    let vivo = true
    setCargando(true)
    obtenerAdmin(id).then(
      (r) => {
        if (!vivo) return
        setPerfil(r.perfil)
        setAuditoria(r.auditoria)
        setCargando(false)
      },
      (err) => {
        if (!vivo) return
        setCargando(false)
        if (err instanceof ErrorApi && err.status === 404) setNoExiste(true)
        else if (err instanceof ErrorApi) tratar(err)
      },
    )
    return () => {
      vivo = false
    }
  }, [id, tratar])

  async function guardar(valores: ValoresFormulario) {
    setFallo(null)
    setGuardado(null)
    if (!perfil) {
      const r = await crear(valores)
      setGuardado('Carta creada.')
      onCreado(r.perfil.id)
      return
    }
    const r = await actualizar(perfil.id, valores)
    setPerfil(r.perfil)
    setGuardado('Cambios guardados.')
    obtenerAdmin(perfil.id).then((d) => setAuditoria(d.auditoria)).catch(() => {})
  }

  async function alternarEstado() {
    if (!perfil) return
    setFallo(null)
    try {
      const r = await cambiarEstado(perfil.id, !perfil.activo)
      setPerfil({ ...perfil, activo: r.activo })
      setGuardado(r.activo ? 'Carta activada: ya se puede ver.' : 'Carta desactivada: el enlace y el QR muestran «no disponible».')
      obtenerAdmin(perfil.id).then((d) => setAuditoria(d.auditoria)).catch(() => {})
    } catch (err) {
      if (err instanceof ErrorApi) tratar(err)
    }
  }

  function fotoCambiada(foto: FotoAdmin | null) {
    if (!perfil) return
    setPerfil({ ...perfil, foto })
    obtenerAdmin(perfil.id).then((d) => setAuditoria(d.auditoria)).catch(() => {})
  }

  const nombre = perfil ? nombreCompleto(perfil) : 'Nueva carta'

  return (
    <div className="gt-cdp__detalle">
      <p className="gt-cdp__volver">
        <Link to="/cdpadmin" onClick={(e) => (e.preventDefault(), onVolver())}>
          Volver a la lista
        </Link>
      </p>

      {fallo && <AvisoFallo fallo={fallo} />}

      {noExiste ? (
        <p className="gt-cdp__alerta" role="alert">
          Esa carta no existe. Vuelve a la lista y elige otra.
        </p>
      ) : cargando ? (
        <p className="gt-cdp__vacio" aria-busy="true">
          Cargando la carta…
        </p>
      ) : (
        <div className="gt-cdp__columnas">
          <div className="gt-cdp__editor">
            <h2 className="gt-cdp__nombre">{nombre}</h2>
            {perfil && (
              <p className="gt-cdp__meta">
                <span className="gt-chip">{perfil.activo ? 'Activa' : 'Inactiva'}</span>
                <span className="gt-cdp__meta-texto">Última edición: {fecha(perfil.actualizado_en)}</span>
              </p>
            )}
            {guardado && (
              <p className="gt-cdp__estado" role="status">
                {guardado}
              </p>
            )}

            <FormularioPerfil
              key={perfil?.id ?? 'nueva'}
              inicial={perfil}
              onGuardar={guardar}
              onFallo={tratar}
              onCancelar={perfil ? undefined : onVolver}
            />

            {perfil && (
              <>
                <section className="gt-cdp__bloque" aria-labelledby="gt-cdp-foto">
                  <h3 id="gt-cdp-foto">Foto</h3>
                  <SubidaFoto perfilId={perfil.id} foto={perfil.foto} onCambio={fotoCambiada} onFallo={tratar} />
                </section>

                <section className="gt-cdp__bloque" aria-labelledby="gt-cdp-estado">
                  <h3 id="gt-cdp-estado">Estado</h3>
                  <p className="gt-campo__ayuda">
                    Una carta inactiva no se borra: su enlace y su QR siguen existiendo y muestran
                    «no disponible» hasta que vuelvas a activarla.
                  </p>
                  <button
                    type="button"
                    className={`gt-boton${perfil.activo ? '' : ' gt-boton--solido'}`}
                    aria-pressed={perfil.activo}
                    onClick={alternarEstado}
                  >
                    {perfil.activo ? 'Desactivar la carta' : 'Activar la carta'}
                  </button>
                </section>

                <section className="gt-cdp__bloque" aria-labelledby="gt-cdp-qr">
                  <h3 id="gt-cdp-qr">Código QR</h3>
                  <QrTarjeta url={perfil.url} nombre={nombre} descargas />
                  <p className="gt-cdp__enlaces">
                    <a className="gt-boton gt-boton--externo" href={perfil.url} target="_blank" rel="noopener noreferrer">
                      Ver tarjeta pública
                    </a>
                  </p>
                </section>

                {auditoria.length > 0 && (
                  <section className="gt-cdp__bloque" aria-labelledby="gt-cdp-auditoria">
                    <h3 id="gt-cdp-auditoria">Últimas acciones</h3>
                    <ol className="gt-cdp__auditoria">
                      {auditoria.map((a, i) => (
                        <li key={`${a.ts}-${i}`}>
                          <span className="gt-dato">{fecha(a.ts)}</span>
                          <span>
                            {ACCION[a.accion]}
                            {a.detalle?.campos?.length ? ` (${a.detalle.campos.join(', ')})` : ''} · {a.actor}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </section>
                )}
              </>
            )}
          </div>

          {perfil && (
            <aside className="gt-cdp__previa" aria-labelledby="gt-cdp-previa">
              <h3 id="gt-cdp-previa" className="gt-dato gt-cdp__previa-titulo">
                Así se ve la tarjeta
              </h3>
              <Tarjeta perfil={aPublico(perfil)} nivel="h3" qr={false} />
            </aside>
          )}
        </div>
      )}
    </div>
  )
}

export default function CdpAdminPage() {
  const sesion = useSesion()
  const [searchParams, setSearchParams] = useSearchParams()
  const [marcador, setMarcador] = useState<string | null>(null)
  // El 403 en caliente (el rol se fue mientras se editaba): se vuelve al gate retenido sin
  // esperar a que /api/me lo diga en la próxima visita.
  const [sinRol, setSinRol] = useState(false)

  useEffect(() => {
    const auth = searchParams.get('auth')
    if (!auth) return
    setMarcador(auth)
    const limpios = new URLSearchParams(searchParams)
    limpios.delete('auth')
    setSearchParams(limpios, { replace: true })
  }, [searchParams, setSearchParams])

  const mensaje = marcador ? MENSAJES_AUTH[marcador] : undefined
  const esAdmin = sesion.estado === 'dentro' && sesion.carta === 'admin' && !sinRol

  return (
    <section className="gt-pagina gt-grano">
      <div className="gt-contenedor gt-cdp">
        <SectionTitle como="h1">Cartas de presentación</SectionTitle>

        {!esAdmin && (
          <p className="gt-pagina__intro gt-cdp__texto">
            {sesion.estado === 'dentro'
              ? 'Aquí se crean y se editan las cartas de presentación digitales con su código QR.'
              : 'Inicia sesión con tu cuenta corporativa para administrar las cartas de presentación digitales y sus códigos QR.'}
          </p>
        )}

        {mensaje && (
          <p className="gt-cdp__alerta" role="alert">
            {mensaje}
          </p>
        )}

        <div className="gt-cdp__acciones">
          {sesion.estado === 'sin-sesion' && (
            <>
              <a className="gt-boton gt-boton--solido gt-cdp__entrar" href="/auth/login?destino=/cdpadmin">
                <svg className="gt-cdp__entrar-logo" viewBox="0 0 21 21" aria-hidden="true">
                  <rect x="0" y="0" width="10" height="10" fill="#f25022" />
                  <rect x="11" y="0" width="10" height="10" fill="#7fba00" />
                  <rect x="0" y="11" width="10" height="10" fill="#00a4ef" />
                  <rect x="11" y="11" width="10" height="10" fill="#ffb900" />
                </svg>
                Iniciar sesión con Microsoft
              </a>
              {marcador === 'no_acceso' && (
                <a className="gt-cdp__otra-cuenta" href="/auth/login?select=1&destino=/cdpadmin">
                  Entrar con otra cuenta
                </a>
              )}
              <p className="gt-cdp__registro">
                Tu acceso queda registrado para el control de asistencia del foro.
              </p>
            </>
          )}

          {sesion.estado === 'dentro' && !esAdmin && <BotonRetenido />}
        </div>

        {esAdmin && <Panel onSinRol={() => setSinRol(true)} />}
      </div>
    </section>
  )
}

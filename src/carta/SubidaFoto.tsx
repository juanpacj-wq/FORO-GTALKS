import { useId, useState, type ChangeEvent } from 'react'
import { ErrorApi, quitarFoto, subirFoto } from './api'
import { aDataUrl, reducirFotoParaSubir } from './foto-cliente'
import { srcFoto, type FotoAdmin } from './tipos'
import './formulario.css'

/**
 * La foto de una carta: elegir, pre-reducir, subir; o quitar.
 *
 * El `<input type="file">` va visualmente oculto dentro de un `label` con forma de botón (el
 * mismo gesto de los controles de foto de /escarapela), y el archivo pasa por
 * `reducirFotoParaSubir` antes del `PUT`: un retrato de teléfono llega a un décimo de su peso y
 * sin EXIF. La vista previa es la propia reducción como `data:` URL, así que lo que se ve es
 * lo que se envió, y al confirmar el servidor se cambia por la derivada definitiva (WebP), que
 * es la que verá el público.
 */
export default function SubidaFoto({
  perfilId,
  foto,
  onCambio,
  onFallo,
}: {
  perfilId: string
  foto: FotoAdmin | null
  onCambio: (foto: FotoAdmin | null) => void
  onFallo: (err: ErrorApi) => void
}) {
  const id = useId()
  const [previa, setPrevia] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  async function elegir(e: ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0]
    e.target.value = '' // permite volver a elegir el mismo archivo
    if (!archivo) return
    setAviso(null)
    setOcupado(true)
    try {
      const reducida = await reducirFotoParaSubir(archivo)
      setPrevia(await aDataUrl(reducida))
      const r = await subirFoto(perfilId, reducida)
      onCambio(r.foto)
      setPrevia(null)
      setAviso('Foto guardada.')
    } catch (err) {
      setPrevia(null)
      if (err instanceof ErrorApi) {
        if (err.status === 413) setAviso('La foto pesa demasiado incluso reducida. Prueba con una más pequeña.')
        else if (err.status === 415 || err.codigo === 'foto_invalida') setAviso('Ese archivo no se pudo leer como imagen. Elige una foto en JPG, PNG o WebP.')
        else if (err.codigo === 'foto_pequena') setAviso('La foto es muy pequeña: necesita al menos 200 píxeles por lado.')
        else if (err.status === 400) setAviso('El servidor no aceptó la foto. Intenta con otra.')
        else onFallo(err)
      } else {
        setAviso('Ese archivo no se pudo leer como imagen. Elige una foto en JPG, PNG o WebP.')
      }
    } finally {
      setOcupado(false)
    }
  }

  async function quitar() {
    setAviso(null)
    setOcupado(true)
    try {
      await quitarFoto(perfilId)
      onCambio(null)
      setAviso('Foto retirada.')
    } catch (err) {
      if (err instanceof ErrorApi) onFallo(err)
    } finally {
      setOcupado(false)
    }
  }

  const src = previa ?? (foto ? srcFoto(foto) : null)

  return (
    <div className="gt-subida-foto">
      <div className="gt-subida-foto__vista">
        {src ? (
          <img className="gt-subida-foto__img" src={src} alt="" />
        ) : (
          <span className="gt-subida-foto__vacio" aria-hidden="true" />
        )}
      </div>
      <div className="gt-subida-foto__controles">
        <label className={`gt-boton${ocupado ? ' gt-boton--inactivo' : ''}`} htmlFor={id} aria-busy={ocupado || undefined}>
          {foto ? 'Cambiar foto' : 'Subir foto'}
          <input
            id={id}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={elegir}
            disabled={ocupado}
            className="gt-oculto-visual"
          />
        </label>
        {foto && (
          <button type="button" className="gt-boton" onClick={quitar} disabled={ocupado}>
            Quitar foto
          </button>
        )}
        <p className="gt-campo__ayuda">
          JPG, PNG o WebP. Se guarda reducida a 800 píxeles y sin metadatos; el original no viaja.
        </p>
        {aviso && (
          <p className="gt-subida-foto__aviso" role="status">
            {aviso}
          </p>
        )}
      </div>
    </div>
  )
}

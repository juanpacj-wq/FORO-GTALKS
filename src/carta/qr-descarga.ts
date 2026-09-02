/**
 * Descargar el QR de una tarjeta como PNG o SVG, desde el navegador.
 *
 * No hay ruta de QR en el servidor: el dibujo es `svgQrAutonomo` de `data/qr-arte.ts`, el
 * MISMO que rasteriza el correo del envío masivo, y por eso la marca «G» se le pasa por
 * parámetro (ese módulo no puede leer archivos). Aquí se trae con un `fetch` a
 * `/img/marca-g.svg`, que `connect-src 'self'` permite.
 *
 * Dos detalles que no son obvios:
 * - El PNG se pinta en un canvas del `ladoPx` que `svgQrAutonomo` DEVUELVE, no del que se le
 *   pide: el lado se ajusta al múltiplo del panel en módulos para que cada módulo caiga en un
 *   número entero de píxeles. A 810 px sobre 89.1 módulos ZXing dejaba de leer el código
 *   (medido, no supuesto; ver el comentario de `svgQrAutonomo`).
 * - El SVG se carga en la `<img>` como `data:` URL y no como `blob:`: la CSP del sitio admite
 *   `img-src 'self' data:` y nada más.
 */
import { svgQrAutonomo, LADO_PX_CORREO } from '../data/qr-arte'

let marcaCache: Promise<string> | null = null

async function marcaSvg(): Promise<string> {
  if (!marcaCache) {
    marcaCache = fetch('/img/marca-g.svg', { credentials: 'same-origin' }).then((r) => {
      if (!r.ok) throw new Error('marca_no_disponible')
      return r.text()
    })
    marcaCache.catch(() => {
      marcaCache = null // un fallo de red no se memoriza
    })
  }
  return marcaCache
}

function descargar(blob: Blob, nombreArchivo: string) {
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = nombreArchivo
  document.body.append(a)
  a.click()
  a.remove()
  // El navegador ya tomó el blob: revocar de inmediato rompe la descarga en algunos motores.
  setTimeout(() => URL.revokeObjectURL(href), 10_000)
}

function aPng(svg: string, lado: number): Promise<Blob> {
  return new Promise((resolver, rechazar) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = lado
      canvas.height = lado
      const ctx = canvas.getContext('2d')
      if (!ctx) return rechazar(new Error('sin_canvas'))
      ctx.drawImage(img, 0, 0, lado, lado)
      canvas.toBlob((blob) => (blob ? resolver(blob) : rechazar(new Error('sin_png'))), 'image/png')
    }
    img.onerror = () => rechazar(new Error('svg_invalido'))
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}

/** Nombre de archivo a partir del nombre de la persona: solo ASCII, sin espacios raros. */
export function nombreArchivoQr(nombre: string, formato: 'png' | 'svg'): string {
  const base = nombre
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `qr-${base || 'carta'}.${formato}`
}

/**
 * @param url     lo que codifica el QR: la URL absoluta de la tarjeta
 * @param formato png (rasterizado al lado devuelto) o svg (el archivo autónomo tal cual)
 * @param nombre  el nombre de la persona, para el nombre del archivo
 */
export async function descargarQr(url: string, formato: 'png' | 'svg', nombre: string): Promise<void> {
  const marca = await marcaSvg()
  const { svg, ladoPx } = svgQrAutonomo(url, { marcaSvg: marca, ladoPx: LADO_PX_CORREO })
  if (formato === 'svg') {
    descargar(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), nombreArchivoQr(nombre, 'svg'))
    return
  }
  descargar(await aPng(svg, ladoPx), nombreArchivoQr(nombre, 'png'))
}

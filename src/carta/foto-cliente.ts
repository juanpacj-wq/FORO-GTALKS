/**
 * Pre-reducción de la foto en el navegador, antes de subirla al panel.
 *
 * El servidor produce la derivada definitiva (WebP ≤ 800 px, ver server/carta/foto.js), pero
 * un retrato de teléfono pesa 4 a 12 MB y el borde solo admite 5. Aquí se pasa por un canvas a
 * lo sumo 1600 px de lado mayor y se re-codifica como JPEG: llega a un décimo del peso y, de
 * paso, sin EXIF (GPS, fecha, equipo), igual que `procesarFoto` de `data/escarapela.ts`.
 *
 * `createImageBitmap` con `imageOrientation: 'from-image'` hornea la orientación EXIF antes de
 * pintar, así que el retrato no llega tumbado al servidor. Si el navegador no decodifica el
 * archivo (no es imagen, o es HEIC en un navegador sin códec) se lanza `no_es_imagen` y la
 * interfaz pide otra.
 */

const LADO_MAXIMO = 1600
const CALIDAD_JPEG = 0.88

export async function reducirFotoParaSubir(archivo: File): Promise<Blob> {
  const bitmap = await createImageBitmap(archivo, { imageOrientation: 'from-image' }).catch(() => {
    throw new Error('no_es_imagen')
  })
  try {
    const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height))
    const ancho = Math.max(1, Math.round(bitmap.width * escala))
    const alto = Math.max(1, Math.round(bitmap.height * escala))
    const canvas = document.createElement('canvas')
    canvas.width = ancho
    canvas.height = alto
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no_es_imagen')
    // Un PNG con transparencia se aplana sobre blanco: JPEG no tiene alfa y sin esto el
    // fondo saldría negro.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, ancho, alto)
    ctx.drawImage(bitmap, 0, 0, ancho, alto)
    const blob = await new Promise<Blob | null>((resolver) => canvas.toBlob(resolver, 'image/jpeg', CALIDAD_JPEG))
    if (!blob) throw new Error('no_es_imagen')
    return blob
  } finally {
    bitmap.close()
  }
}

/** La vista previa: un `data:` URL, que `img-src` ya permite (la CSP no admite `blob:`). */
export function aDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader()
    lector.onload = () => resolver(String(lector.result))
    lector.onerror = () => rechazar(new Error('no_es_imagen'))
    lector.readAsDataURL(blob)
  })
}

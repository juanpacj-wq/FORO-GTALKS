/**
 * El dibujo del QR de asistencia. UN archivo, DOS lectores el mismo principio de
 * `evento.json`, porque el QR ya no vive solo en la pantalla:
 *
 * - `src/components/Escarapela.tsx` lo pinta como nodos SVG en el DOM (dorso del carné).
 * - `scripts/envio-qr.mjs` lo rasteriza a PNG en Node para incrustarlo en el correo.
 *
 * Copiar el bucle al script habría garantizado que dentro de un mes los dos QR se PAREZCAN pero
 * no sean iguales. La única forma de que «mismo diseño» sea verdad es que haya un solo dibujo, y
 * `qr-test.mjs` lo exige comparando el `d` del navegador con el que produce Node, carácter a
 * carácter.
 *
 * ── Este módulo no puede tocar el DOM NI el disco ─────────────────────────────
 * Vite lo empaqueta para el navegador (lo importa Escarapela.tsx) y Node lo carga tal cual
 * (v22.6+ lee TypeScript directamente). Un `document` rompería lo segundo y un `node:fs`
 * rompería lo primero. Por eso `svgQrAutonomo` recibe la marca por PARÁMETRO en vez de leerla:
 * quien la tiene a mano es el script, no este archivo.
 *
 * El estilo es réplica MEDIDA de la pieza «Diseño de Código QR.png» (raíz del repo); las cotas y
 * de dónde sale cada una están en `docs/SISTEMA-DE-DISENO.md` §La escarapela.
 */
import { QrCodeDataType, encode, type QrCodeGenerateResult } from 'uqr'

/**
 * Corrección de errores 'Q' (25 %) porque el claro del logo tapa ~3 % de los módulos. El borde
 * baja a 2 módulos a propósito: la zona de silencio que exige la norma (4) la completa de sobra
 * el aire blanco del panel, y esos 2 módulos menos agrandan todos los demás con una URL de
 * 266 caracteres, cada punto cuenta.
 */
export const QR_ECC = 'Q' as const
export const QR_BORDE = 2

/** Punto: 72 % del módulo (radio 0.36). La medición cruda de la pieza da 62 %, pero sobre un PNG
 *  de 234 px el antialias muerde ~1 px por borde y sesga a la baja; 72 % reproduce el mismo gesto
 *  de puntos separados y sigue siendo decodificable por ZXing. */
const RADIO_PUNTO = 0.36

/** Claro del logo: 10 % del lado. Oclusión ≈ 3 % del área, muy por debajo de lo que 'Q' recupera. */
const CLARO_LOGO = 0.1

/** Ancho de la «G» en el centro: 16 % del lado del código (medido en la pieza). */
const ANCHO_MARCA = 0.16

/**
 * Proporción alto/ancho del viewBox de `marca-g.svg`: 896 por 896, la caja de tinta de la «G»
 * de la marca 2026 medida por `scripts/build-marca-gecelca.py` (es un cuadrado exacto). La marca
 * anterior, extraída de los PDF del foro, medía 46.24 / 51.62.
 */
const ASPECTO_MARCA = 896 / 896

/** Aire blanco alrededor del código, y radio del panel, como fracción del lado del código. En la
 *  escarapela el panel mide `padding: 3cqw` con el QR a `60cqw`: 3/60 = 5 % en ambos casos. */
const AIRE_PANEL = 0.05

/**
 * Tinta del código: `--gt-azul-gecelca`, el azul de la marca GECELCA 2026 medido en los raster
 * de Comunicaciones (`scripts/build-marca-gecelca.py`). Hasta agosto de 2026 era `#004a96`, el
 * azul de los PDF del foro (el QR de la pieza «Diseño de Código QR.png» medía `#023F86`, aquel
 * azul con el antialias de un PNG pequeño encima); los correos que ya salieron llevan el viejo y
 * no se retocan.
 *
 * Está escrito aquí porque un correo no tiene `tokens.css` y `var(--…)` no existe en Outlook.
 * Que sea el MISMO azul que pinta la escarapela no se deja a la buena fe: `qr-test.mjs` lee el
 * `color` computado de `.gt-carne__qr` en el navegador y lo compara con esta constante.
 */
export const QR_TINTA = '#0053a3'
/** Papel del panel: `--gt-blanco`. */
export const QR_PAPEL = '#ffffff'

/**
 * Lado por defecto de la captura para el correo: 1080 px sobre un panel de 90 módulos son 12
 * píxeles por módulo, y 1080 se muestra a 270 px en el mensaje  una razón de **4:1 exacta**.
 * Outlook de escritorio remuestrea con el motor de Word, que trata bien las potencias de dos y
 * produce moiré con razones feas; y el moiré, en un QR, es un código que no se lee.
 */
export const LADO_PX_CORREO = 1080

export interface ArteQr {
  /** Un solo `d` con TODOS los módulos como círculos. Miles de puntos, un nodo. */
  d: string
  claro: number
  centro: number
  /** Esquina superior izquierda de cada uno de los tres marcadores de posición. */
  marcadores: ReadonlyArray<readonly [number, number]>
}

/** Codifica la URL con los parámetros del diseño. Centralizado para que nadie los reinvente. */
export function codificarQr(url: string): QrCodeGenerateResult {
  return encode(url, { ecc: QR_ECC, border: QR_BORDE })
}

/**
 * La geometría del código: el `d` de los módulos y las esquinas de los marcadores.
 *
 * Los módulos del patrón de posición se SALTAN aquí y se dibujan aparte, redondeados: un
 * decodificador mide la proporción 1:1:3:1:1 en cada línea de barrido y un anillo desigual lo
 * deja ciego.
 */
export function arteQr(qr: QrCodeGenerateResult): ArteQr {
  const s = qr.size
  const claro = s * CLARO_LOGO
  const centro = s / 2
  const r = RADIO_PUNTO
  let d = ''
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      if (!qr.data[y][x]) continue
      if (qr.types[y][x] === QrCodeDataType.Position) continue
      const cx = x + 0.5
      const cy = y + 0.5
      if (Math.hypot(cx - centro, cy - centro) < claro) continue
      d += `M${(cx + r).toFixed(2)} ${cy} a${r} ${r} 0 1 0 ${-2 * r} 0 a${r} ${r} 0 1 0 ${2 * r} 0 `
    }
  }
  // El borde del encode desplaza los marcadores: esto recupera su offset real.
  const b = (s - qr.version * 4 - 17) / 2
  const marcadores = [
    [b, b],
    [s - b - 7, b],
    [b, s - b - 7],
  ] as const
  return { d, claro, centro, marcadores }
}

/** Geometría de la «G» centrada, en unidades de módulo. La comparten el DOM y el SVG autónomo. */
export function cajaMarca(qr: QrCodeGenerateResult, centro: number) {
  const ancho = qr.size * ANCHO_MARCA
  const alto = ancho * ASPECTO_MARCA
  return { x: centro - ancho / 2, y: centro - alto / 2, ancho, alto }
}

/**
 * Re-encuadra el contenido de `public/img/marca-g.svg` como un `<svg>` anidado en la posición
 * pedida, conservando su `viewBox`. Es lo que en el DOM hace `<image href="/img/marca-g.svg">`,
 * pero sin pedirle al navegador que vaya a buscar un archivo: en un correo no hay servidor.
 *
 * @throws si el archivo recibido no parece el SVG de la marca.
 */
function anidarMarca(
  marcaSvg: string,
  caja: { x: number; y: number; ancho: number; alto: number },
): string {
  const apertura = marcaSvg.match(/<svg\b[^>]*>/i)
  const viewBox = marcaSvg.match(/viewBox="([^"]+)"/i)
  const cierre = marcaSvg.lastIndexOf('</svg>')
  if (!apertura || !viewBox || cierre === -1) {
    throw new Error(
      'anidarMarca: el contenido recibido no es el SVG de `public/img/marca-g.svg` ' +
      '(falta la etiqueta <svg>, su viewBox o su cierre).',
    )
  }
  const dentro = marcaSvg.slice(apertura.index! + apertura[0].length, cierre)
  return (
    `<svg x="${caja.x}" y="${caja.y}" width="${caja.ancho}" height="${caja.alto}" ` +
    `viewBox="${viewBox[1]}" overflow="visible">${dentro}</svg>`
  )
}

/**
 * El código completo como SVG independiente: sin CSS del sitio, sin `currentColor`, sin
 * `var(--…)` y sin referencias a archivos. Listo para que un navegador headless lo rasterice o
 * para escribirlo a disco.
 *
 * Incluye el panel blanco con su aire: en la escarapela esa zona de silencio la pone el `padding`
 * del div, y aquí no hay div. Sin ella el código nace con 2 módulos de margen en vez de los 4 que
 * pide la norma, y algunos lectores lo rechazan.
 *
 * ── El lado va en módulos ENTEROS, y no es un detalle cosmético ───────────────
 * El 5 % de aire sobre 81 módulos da 4.05, y un panel de 89.1 módulos rasterizado a 810 px sale
 * a 9.0909… píxeles por módulo: los puntos caen cada uno en una fracción de píxel distinta, el
 * antialias los muerde de forma desigual y **ZXing deja de leer el código**. Está medido, no
 * supuesto: a 600, 1200, 1620 y 2400 px decodifica, y justo a 810 px no. Redondeando el aire
 * hacia arriba a media unidad, el panel mide 90 módulos exactos y cualquier captura múltiplo de
 * 90 da un número entero de píxeles por módulo. Por eso `ladoPx` se ajusta al múltiplo más
 * cercano en vez de obedecerse a ciegas.
 *
 * @param url       lo que codifica el QR (ver `urlAsistencia` en `escarapela.ts`)
 * @param marcaSvg  el contenido literal de `public/img/marca-g.svg`
 * @param ladoPx    lado deseado de la captura; se ajusta al múltiplo del lado en módulos
 * @returns el SVG y el lado en píxeles YA ajustado, que es el que hay que pedirle al navegador
 */
export function svgQrAutonomo(
  url: string,
  {
    marcaSvg,
    tinta = QR_TINTA,
    papel = QR_PAPEL,
    ladoPx = LADO_PX_CORREO,
  }: { marcaSvg: string; tinta?: string; papel?: string; ladoPx?: number },
): { svg: string; ladoPx: number; ladoModulos: number } {
  const qr = codificarQr(url)
  const arte = arteQr(qr)
  // Aire redondeado ARRIBA a media unidad: nunca encoge la zona de silencio y deja el lado
  // total en un entero (81 + 9 = 90), porque `ceil(size * 0.1)` siempre lo es.
  const aire = Math.ceil(qr.size * AIRE_PANEL * 2) / 2
  const lado = qr.size + aire * 2
  const escala = Math.max(1, Math.round(ladoPx / lado))
  const marcadores = arte.marcadores
    .map(
      ([mx, my]) =>
        `<rect x="${mx}" y="${my}" width="7" height="7" rx="2.1" fill="${tinta}"/>` +
        `<rect x="${mx + 1}" y="${my + 1}" width="5" height="5" rx="1.5" fill="${papel}"/>` +
        `<rect x="${mx + 2}" y="${my + 2}" width="3" height="3" rx="1" fill="${tinta}"/>`,
    )
    .join('')

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" width="${lado}" height="${lado}">` +
    `<rect width="${lado}" height="${lado}" rx="${aire}" fill="${papel}"/>` +
    `<g transform="translate(${aire} ${aire})">` +
    `<path d="${arte.d}" fill="${tinta}"/>` +
    marcadores +
    anidarMarca(marcaSvg, cajaMarca(qr, arte.centro)) +
    `</g></svg>`

  return { svg, ladoPx: lado * escala, ladoModulos: lado }
}

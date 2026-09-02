/**
 * La foto de la tarjeta: de lo que sube el navegador a la ÚNICA derivada que se guarda.
 *
 * Entra un JPEG, PNG o WebP (los bytes lo dicen, no la extensión ni el Content-Type que declare
 * el cliente) y sale un WebP de a lo sumo 800 px de lado mayor, q85, sin metadatos (el EXIF
 * trae GPS, fecha y equipo: a la BD llegan solo píxeles) y con la orientación EXIF horneada
 * (`rotate()` sin argumentos), para que un retrato tomado con el teléfono no se guarde tumbado.
 *
 * Lo que se rechaza, y con qué código: cabecera que no es de una imagen admitida
 * (`tipo_no_admitido`), bytes que no decodifican (`foto_invalida`), lado menor de 200 px
 * (`foto_pequena`), y más de 40 MP (`foto_invalida`: `limitInputPixels` corta la bomba de
 * descompresión antes de reservar memoria).
 *
 * sharp se auto-comprueba al arrancar (ver index.js): si el binario de Linux no cargó, el
 * despliegue aborta y revierte, en vez de descubrirlo la primera vez que alguien sube una foto.
 */
import crypto from 'node:crypto';
import sharp from 'sharp';

export const LADO_MAXIMO = 800;
export const LADO_MINIMO = 200;
export const PIXELES_MAXIMOS = 40_000_000;
export const PESO_MAXIMO_SUBIDA = 5 * 1024 * 1024;

export class FotoInvalida extends Error {
  constructor(codigo, detalle = '') {
    super(`Foto rechazada: ${codigo}${detalle ? ` (${detalle})` : ''}`);
    this.name = 'FotoInvalida';
    this.codigo = codigo;
  }
}

/**
 * ¿Qué imagen dicen ser los primeros bytes? `null` si ninguna de las tres admitidas.
 * WebP: `RIFF????WEBP` (los cuatro del tamaño en medio se ignoran).
 */
export function tipoPorMagia(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/**
 * @returns {Promise<{ bytes: Buffer, ancho: number, alto: number, sha256: string, tipo: 'image/webp' }>}
 * @throws {FotoInvalida}
 */
export async function procesarFoto(buf) {
  if (!tipoPorMagia(buf)) throw new FotoInvalida('tipo_no_admitido');

  let meta;
  try {
    meta = await sharp(buf, { limitInputPixels: PIXELES_MAXIMOS, failOn: 'error' }).metadata();
  } catch (err) {
    throw new FotoInvalida('foto_invalida', err.message);
  }
  if (!meta.width || !meta.height) throw new FotoInvalida('foto_invalida', 'sin dimensiones');
  // Con la orientación EXIF 5..8 el ancho y el alto vienen intercambiados: se mira el menor.
  if (Math.min(meta.width, meta.height) < LADO_MINIMO) throw new FotoInvalida('foto_pequena');
  if (meta.width * meta.height > PIXELES_MAXIMOS) throw new FotoInvalida('foto_invalida', 'demasiados píxeles');

  let bytes;
  let info;
  try {
    ({ data: bytes, info } = await sharp(buf, { limitInputPixels: PIXELES_MAXIMOS, failOn: 'error' })
      .rotate() // hornea la orientación EXIF y, de paso, descarta el EXIF
      .resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85, effort: 4 })
      .toBuffer({ resolveWithObject: true }));
  } catch (err) {
    throw new FotoInvalida('foto_invalida', err.message);
  }
  return {
    bytes,
    ancho: info.width,
    alto: info.height,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    tipo: 'image/webp',
  };
}

/**
 * La auto-comprobación del arranque: codifica un WebP de 2×2. Si el binario nativo de sharp no
 * cargó en esta máquina, esto lanza, y quien lo llama aborta el arranque.
 */
export async function comprobarSharp() {
  const out = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } })
    .webp()
    .toBuffer();
  if (tipoPorMagia(out) !== 'image/webp') throw new Error('sharp no produjo un WebP válido');
  return sharp.versions;
}

// GENERADO por scripts/build-retratos.py no editar a mano.
//
// Manifiesto de los retratos que EXISTEN en public/img/ponentes/. Es la misma
// idea que iconos.ts: en vez de una bandera `foto: true` en los datos que haya
// que acordarse de activar, o de un `onerror` que deje un hueco, el script que
// procesa las fotos escribe aquí exactamente lo que produjo.
//
// Consecuencias, que son el motivo de que exista este archivo:
//   · un ponente sin foto no aparece en el mapa, cae al monograma de iniciales
//     y es imposible servir un 404;
//   · un slug que no exista en PONENTES es un error de tipos en `npm run build`.
//
// Se regenera con:  .venv-design/Scripts/python scripts/build-retratos.py

import type { PonenteSlug } from '../data/foro'

export interface Retrato {
  /** 4:5 vertical, 440×550 y 880×1100. Para la cabecera del perfil. */
  vertical: { src: string; srcSet: string }
  /** 1:1, 96×96 y 192×192. Para las filas del índice y de la agenda. */
  cuadrado: { src: string; srcSet: string }
}

export const RETRATOS: Partial<Record<PonenteSlug, Retrato>> = {
  'alfredo-chamat-barrios': {
    vertical: {
      src: '/img/ponentes/alfredo-chamat-barrios.webp',
      srcSet: '/img/ponentes/alfredo-chamat-barrios.webp 1x, /img/ponentes/alfredo-chamat-barrios@2x.webp 2x',
    },
    cuadrado: {
      src: '/img/ponentes/alfredo-chamat-barrios-sq.webp',
      srcSet: '/img/ponentes/alfredo-chamat-barrios-sq.webp 1x, /img/ponentes/alfredo-chamat-barrios-sq@2x.webp 2x',
    },
  },
  'angel-hernandez-montes': {
    vertical: {
      src: '/img/ponentes/angel-hernandez-montes.webp',
      srcSet: '/img/ponentes/angel-hernandez-montes.webp 1x, /img/ponentes/angel-hernandez-montes@2x.webp 2x',
    },
    cuadrado: {
      src: '/img/ponentes/angel-hernandez-montes-sq.webp',
      srcSet: '/img/ponentes/angel-hernandez-montes-sq.webp 1x, /img/ponentes/angel-hernandez-montes-sq@2x.webp 2x',
    },
  },
  'carlos-naranjo-merino': {
    vertical: {
      src: '/img/ponentes/carlos-naranjo-merino.webp',
      srcSet: '/img/ponentes/carlos-naranjo-merino.webp 1x, /img/ponentes/carlos-naranjo-merino@2x.webp 2x',
    },
    cuadrado: {
      src: '/img/ponentes/carlos-naranjo-merino-sq.webp',
      srcSet: '/img/ponentes/carlos-naranjo-merino-sq.webp 1x, /img/ponentes/carlos-naranjo-merino-sq@2x.webp 2x',
    },
  },
  'carolina-palacio-garcerant': {
    vertical: {
      src: '/img/ponentes/carolina-palacio-garcerant.webp',
      srcSet: '/img/ponentes/carolina-palacio-garcerant.webp 1x, /img/ponentes/carolina-palacio-garcerant@2x.webp 2x',
    },
    cuadrado: {
      src: '/img/ponentes/carolina-palacio-garcerant-sq.webp',
      srcSet: '/img/ponentes/carolina-palacio-garcerant-sq.webp 1x, /img/ponentes/carolina-palacio-garcerant-sq@2x.webp 2x',
    },
  },
  'christian-moreno-rocha': {
    vertical: {
      src: '/img/ponentes/christian-moreno-rocha.webp',
      srcSet: '/img/ponentes/christian-moreno-rocha.webp 1x, /img/ponentes/christian-moreno-rocha@2x.webp 2x',
    },
    cuadrado: {
      src: '/img/ponentes/christian-moreno-rocha-sq.webp',
      srcSet: '/img/ponentes/christian-moreno-rocha-sq.webp 1x, /img/ponentes/christian-moreno-rocha-sq@2x.webp 2x',
    },
  },
  'erick-wehdeking-arcieri': {
    vertical: {
      src: '/img/ponentes/erick-wehdeking-arcieri.webp',
      srcSet: '/img/ponentes/erick-wehdeking-arcieri.webp 1x, /img/ponentes/erick-wehdeking-arcieri@2x.webp 2x',
    },
    cuadrado: {
      src: '/img/ponentes/erick-wehdeking-arcieri-sq.webp',
      srcSet: '/img/ponentes/erick-wehdeking-arcieri-sq.webp 1x, /img/ponentes/erick-wehdeking-arcieri-sq@2x.webp 2x',
    },
  },
  'jorge-sierra-almanza': {
    vertical: {
      src: '/img/ponentes/jorge-sierra-almanza.webp',
      srcSet: '/img/ponentes/jorge-sierra-almanza.webp 1x, /img/ponentes/jorge-sierra-almanza@2x.webp 2x',
    },
    cuadrado: {
      src: '/img/ponentes/jorge-sierra-almanza-sq.webp',
      srcSet: '/img/ponentes/jorge-sierra-almanza-sq.webp 1x, /img/ponentes/jorge-sierra-almanza-sq@2x.webp 2x',
    },
  },
  'jose-fernando-prada': {
    vertical: {
      src: '/img/ponentes/jose-fernando-prada.webp',
      srcSet: '/img/ponentes/jose-fernando-prada.webp 1x, /img/ponentes/jose-fernando-prada@2x.webp 2x',
    },
    cuadrado: {
      src: '/img/ponentes/jose-fernando-prada-sq.webp',
      srcSet: '/img/ponentes/jose-fernando-prada-sq.webp 1x, /img/ponentes/jose-fernando-prada-sq@2x.webp 2x',
    },
  },
  'karen-henriquez-leal': {
    vertical: {
      src: '/img/ponentes/karen-henriquez-leal.webp',
      srcSet: '/img/ponentes/karen-henriquez-leal.webp 1x, /img/ponentes/karen-henriquez-leal@2x.webp 2x',
    },
    cuadrado: {
      src: '/img/ponentes/karen-henriquez-leal-sq.webp',
      srcSet: '/img/ponentes/karen-henriquez-leal-sq.webp 1x, /img/ponentes/karen-henriquez-leal-sq@2x.webp 2x',
    },
  },
  'miguel-prieto-locarno': {
    vertical: {
      src: '/img/ponentes/miguel-prieto-locarno.webp',
      srcSet: '/img/ponentes/miguel-prieto-locarno.webp 1x, /img/ponentes/miguel-prieto-locarno@2x.webp 2x',
    },
    cuadrado: {
      src: '/img/ponentes/miguel-prieto-locarno-sq.webp',
      srcSet: '/img/ponentes/miguel-prieto-locarno-sq.webp 1x, /img/ponentes/miguel-prieto-locarno-sq@2x.webp 2x',
    },
  },
  'nicolas-rincon-diaz': {
    vertical: {
      src: '/img/ponentes/nicolas-rincon-diaz.webp',
      srcSet: '/img/ponentes/nicolas-rincon-diaz.webp 1x, /img/ponentes/nicolas-rincon-diaz@2x.webp 2x',
    },
    cuadrado: {
      src: '/img/ponentes/nicolas-rincon-diaz-sq.webp',
      srcSet: '/img/ponentes/nicolas-rincon-diaz-sq.webp 1x, /img/ponentes/nicolas-rincon-diaz-sq@2x.webp 2x',
    },
  },
}

/**
 * El slug llega de la URL, así que es un `string` cualquiera: esta función es
 * justo el punto donde se estrecha. Devuelve `undefined` mientras la foto no
 * haya llegado.
 */
export function retratoDe(slug: string): Retrato | undefined {
  return RETRATOS[slug as PonenteSlug]
}

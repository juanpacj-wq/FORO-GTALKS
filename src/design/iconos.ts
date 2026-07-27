// GENERADO por scripts/build-assets.py — no editar a mano.
//
// Proporción (ancho/alto) de cada símbolo monocromo, sacada de su viewBox.
// `Icono.tsx` la necesita para deducir el ancho a partir del alto: los
// símbolos se pintan como máscara CSS y una máscara no tiene tamaño propio.
export const ICONOS = {
  'numeral-uno': { src: '/img/numeral-uno.svg', ratio: 0.3190 },
  'wordmark-g-talks': { src: '/img/wordmark-g-talks.svg', ratio: 3.4756 },
  'icono-burbujas': { src: '/img/icono-burbujas.svg', ratio: 1.4679 },
  'icono-calendario': { src: '/img/icono-calendario.svg', ratio: 1.0000 },
  'icono-lugar': { src: '/img/icono-lugar.svg', ratio: 0.8330 },
} as const

export type IconoNombre = keyof typeof ICONOS

// Iconos MANUALES hermano de iconos.ts, que es generado y no se toca a mano.
//
// `iconos.ts` lo produce scripts/build-assets.py extrayendo vectores de los PDF oficiales.
// Lo que está aquí NO tiene vector de origen: existe solo en piezas raster, así que se declara
// aparte, con su procedencia. Enseñarle a build-assets.py a copiarlos sería mentir sobre de
// dónde salen.
//
// Los tres `carne-*` son los iconos SÓLIDOS de `Carnet-foro-1.jpg (1).jpeg`, la pieza oficial
// del carné, y no se dibujaron a ojo: los vectoriza `scripts/escarapela-iconos.py` trazando su
// contorno sobre los píxeles de la pieza (marching squares sobre el campo de cobertura; el
// porqué de cada paso está en el encabezado de ese script). Para regenerarlos:
//
//   .venv-design/Scripts/python scripts/escarapela-iconos.py
//
// El `viewBox` de cada uno es su CAJA DE TINTA, sin aire alrededor. Por eso `ratio` es
// literalmente el ancho y el alto trazados, y el `alto` que les pasa Escarapela.css es el alto
// de tinta medido en la pieza, sin márgenes que descontar el problema que sí tiene el
// wordmark de G-TALKS, que viene de un PDF y trae aire dentro de su viewBox.
//
// Mismo shape que ICONOS: `Icono.tsx` acepta la unión de ambos catálogos.
export const ICONOS_EXTRA = {
  /** Grupo de asistentes de la píldora. Sólido, celeste sobre el navy de la píldora. */
  'carne-personas': { src: '/img/carne-personas.svg', ratio: 104 / 73 },
  /** Calendario del renglón «Día» del pie. Marco sólido, panel blanco y cinco cuadrados. */
  'carne-calendario': { src: '/img/carne-calendario.svg', ratio: 37 / 37 },
  /** Alfiler del renglón «Lugar» del pie. Sólido, con claro circular y peana elíptica. */
  'carne-lugar': { src: '/img/carne-lugar.svg', ratio: 30 / 36 },
} as const

export type IconoExtraNombre = keyof typeof ICONOS_EXTRA

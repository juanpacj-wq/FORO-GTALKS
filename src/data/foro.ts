/**
 * Fuente de verdad única del contenido del foro.
 *
 * Todo sale transcrito de las tres piezas gráficas de la raíz (el texto crudo
 * está en `design-extract/text/`). La agenda alimenta a la vez la sección de
 * agenda y los perfiles de ponente: las intervenciones de cada persona se
 * derivan recorriendo `AGENDA`, no hay una segunda lista que mantener.
 *
 * El copy institucional va literal, aunque mezcle tuteo («Prepárate»,
 * «expertos como tú») y ustedeo («Los invitamos»). Esa mezcla está en la
 * fuente. El microcopy nuevo de la interfaz sí va en es-CO con tuteo.
 */

export const EVENTO = {
  edicion: 1,
  nombre: 'Foro: Energía en Acción',
  bajada: 'Retos y oportunidades',
  marca: 'G-TALKS',
  fecha: { texto: 'Miércoles 5 de agosto de 2026', iso: '2026-08-05' },
  /** ⚠ Pendiente #1: los PDF dicen «G Working», la carpeta dice «Puerta de Oro». */
  lugar: 'G Working',
  organiza: 'Vicepresidencia de Asuntos Corporativos',
  contacto: { nombre: 'María Cristina Giraldo', telefono: '312 866 0424' },
  tagline: 'Juntos construimos conversaciones que impulsan la evolución del sector energético.',
} as const

// --------------------------------------------------------------------- ponentes

export interface Ponente {
  slug: string
  nombre: string
  cargo: string
}

/** Los 11 ponentes, derivados de la agenda sin repetir. */
export const PONENTES = [
  {
    slug: 'erick-wehdeking-arcieri',
    nombre: 'Erick Wehdeking Arcieri',
    cargo: 'Presidente de GECELCA',
  },
  {
    slug: 'jose-fernando-prada',
    nombre: 'José Fernando Prada',
    cargo: 'Especialista y consultor senior en energía',
  },
  {
    slug: 'nicolas-rincon-diaz',
    nombre: 'Nicolás Rincón Díaz',
    cargo: 'Gerente de Proyectos Consultoría y Medio Ambiente S.A.',
  },
  {
    slug: 'carlos-naranjo-merino',
    nombre: 'Carlos Naranjo Merino',
    cargo: 'Consultor senior en sostenibilidad y cambio climático',
  },
  {
    slug: 'jorge-sierra-almanza',
    nombre: 'Jorge Sierra Almanza',
    cargo: 'Gerente de Operaciones Enersinc',
  },
  {
    slug: 'karen-henriquez-leal',
    nombre: 'Karen Henríquez Leal',
    cargo: 'Vicepresidente Financiero de GECELCA',
  },
  {
    slug: 'alfredo-chamat-barrios',
    nombre: 'Alfredo Chamat Barrios',
    cargo: 'Vicepresidente de gas y energía Petromil',
  },
  {
    slug: 'carolina-palacio-garcerant',
    nombre: 'Carolina Palacio Garcerant',
    cargo: 'Gerente de Regulación y Planeación Energética',
  },
  {
    slug: 'miguel-prieto-locarno',
    nombre: 'Miguel Prieto Locarno',
    cargo: 'Gerente de Nuevos Negocios de GECELCA',
  },
  {
    slug: 'christian-moreno-rocha',
    nombre: 'Christian Moreno Rocha',
    cargo: 'Docente y consultor en energías renovables',
  },
  {
    slug: 'angel-hernandez-montes',
    nombre: 'Ángel Hernández Montes',
    cargo: 'Vicepresidente de Comercialización de GECELCA',
  },
] as const satisfies readonly Ponente[]

/** Unión de los slugs reales: si un bloque cita a alguien que no existe, no compila. */
export type PonenteSlug = (typeof PONENTES)[number]['slug']

// ----------------------------------------------------------------------- agenda

interface BloqueBase {
  /** Hora de 24 h, «HH:MM». El formato a.m./p.m. de la pieza lo pone `formatoHora`. */
  inicio: string
  fin: string
  titulo: string
}

/**
 * Cuatro formas distintas de bloque, cada una con su tratamiento visual medido
 * en las piezas:
 *
 * - `logistico`  franja celeste a ancho completo, sin ponente (breaks, almuerzo)
 * - `hito`       sobre la tarjeta, título en azul, sin etiqueta de categoría
 * - `ponencia`   etiqueta «Ponencia» en itálica gris + un ponente
 * - `panel`      etiqueta «Panel» en itálica gris + moderador y panelistas
 */
export type Bloque =
  | (BloqueBase & { tipo: 'logistico' })
  | (BloqueBase & { tipo: 'hito'; ponente?: PonenteSlug })
  | (BloqueBase & { tipo: 'ponencia'; ponente: PonenteSlug })
  | (BloqueBase & { tipo: 'panel'; moderador: PonenteSlug; panelistas: PonenteSlug[] })

export const AGENDA: Bloque[] = [
  { tipo: 'hito', inicio: '08:30', fin: '09:00', titulo: 'Registro 1° Foro GECELCA' },
  {
    tipo: 'hito',
    inicio: '09:00',
    fin: '09:20',
    titulo: 'Apertura',
    ponente: 'erick-wehdeking-arcieri',
  },
  {
    tipo: 'ponencia',
    inicio: '09:20',
    fin: '10:00',
    titulo: 'Sector Energético Colombiano: Situación actual del mercado.',
    ponente: 'jose-fernando-prada',
  },
  { tipo: 'logistico', inicio: '10:00', fin: '10:20', titulo: 'Coffee Break' },
  {
    tipo: 'ponencia',
    inicio: '10:20',
    fin: '10:50',
    titulo: 'Licenciamiento ambiental en Colombia',
    ponente: 'nicolas-rincon-diaz',
  },
  {
    tipo: 'ponencia',
    inicio: '10:50',
    fin: '11:20',
    titulo: 'Carbono como estrategia',
    ponente: 'carlos-naranjo-merino',
  },
  {
    tipo: 'panel',
    inicio: '11:20',
    fin: '12:00',
    titulo: 'Seguridad Energética en Transición',
    moderador: 'karen-henriquez-leal',
    panelistas: [
      'jose-fernando-prada',
      'alfredo-chamat-barrios',
      'nicolas-rincon-diaz',
      'carolina-palacio-garcerant',
    ],
  },
  { tipo: 'logistico', inicio: '12:00', fin: '14:30', titulo: 'Almuerzo Libre' },
  {
    tipo: 'ponencia',
    inicio: '14:30',
    fin: '15:10',
    titulo: 'La tecnología como motor de Transformación Energética',
    ponente: 'jorge-sierra-almanza',
  },
  { tipo: 'logistico', inicio: '15:10', fin: '15:30', titulo: 'Coffee Break' },
  {
    tipo: 'panel',
    inicio: '15:30',
    fin: '16:10',
    titulo: 'Futuro en acción',
    moderador: 'miguel-prieto-locarno',
    panelistas: [
      'christian-moreno-rocha',
      'jorge-sierra-almanza',
      'carlos-naranjo-merino',
      'angel-hernandez-montes',
    ],
  },
  {
    tipo: 'hito',
    inicio: '16:10',
    fin: '16:30',
    titulo: 'Cierre 1° Foro GECELCA',
    ponente: 'erick-wehdeking-arcieri',
  },
]

// ------------------------------------------------------------------------ copys

/** Un párrafo es una lista de fragmentos; `fuerte` es lo que va en negrita en la pieza. */
export type Fragmento = string | { fuerte: string }
export type Parrafo = Fragmento[]

/** `invitacion gtalk 2026.pdf` — el copy neutro. */
export const BIENVENIDA: Parrafo[] = [
  [
    'Un espacio que reúne a líderes, expertos y actores clave del sector energético para ' +
      'conversar sobre los desafíos, oportunidades y tendencias que están definiendo la ' +
      'transformación energética.',
  ],
  [
    'Prepárate para compartir conocimiento, intercambiar experiencias y construir juntos una ' +
      'visión sostenible, innovadora y competitiva para el futuro.',
  ],
]

/** Combinación de `invitación expertos.pdf` y `2 Arte foro gtalk 2026.pdf`. */
export const SOBRE_EL_FORO: Parrafo[] = [
  [
    'En GECELCA creemos que las grandes transformaciones comienzan cuando el conocimiento se ' +
      'comparte. Por eso, reuniremos a expertos, que desde su experiencia y visión, han ' +
      'contribuido al desarrollo del sector energético.',
  ],
  
  [
    'Más que un foro, este encuentro representa una oportunidad para fortalecer nuestra ' +
      'comprensión del entorno, alinear a toda la empresa con la evolución del sector y aportar ' +
      'insumos clave para nuestro ejercicio de ',
    { fuerte: 'Planeación Estratégica 2027-2031' },
    '.',
  ],
]

/** La caja destacada sobre tinte celeste de `2 Arte foro gtalk 2026.pdf`. */
export const LLAMADO: Parrafo = [
  { fuerte: 'Los invitamos a participar activamente' },
  ' enriqueciendo la ' +
    'conversación y fortaleciendo nuestra visión institucional frente a los retos del futuro.',
]

/** Titular de `invitación expertos.pdf`. */
export const TITULAR_EXPERTOS = '¡Queremos que hagas parte de esta conversación!'

// ---------------------------------------------------------------------- helpers

// La clave se declara `string` a propósito: `PONENTES` es `as const`, así que
// el Map inferiría la unión de slugs literales y no aceptaría el slug que llega
// de la URL, que es un string cualquiera. Ese es justo el caso a resolver aquí.
const POR_SLUG: Map<string, Ponente> = new Map(PONENTES.map((p) => [p.slug, p as Ponente]))

export function ponentePorSlug(slug: string): Ponente | undefined {
  return POR_SLUG.get(slug)
}

/** Iniciales para el monograma: primera letra del nombre y del primer apellido. */
export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/)
  return ((partes[0]?.[0] ?? '') + (partes[1]?.[0] ?? '')).toUpperCase()
}

/** «08:30» → { hora: '8:30', meridiano: 'a.m.' }, como el chip de dos líneas de la pieza. */
export function formatoHora(hhmm: string): { hora: string; meridiano: 'a.m.' | 'p.m.' } {
  const [h, m] = hhmm.split(':').map(Number)
  const meridiano = h >= 12 ? 'p.m.' : 'a.m.'
  const hora12 = h % 12 === 0 ? 12 : h % 12
  return { hora: `${hora12}:${String(m).padStart(2, '0')}`, meridiano }
}

/** «08:30» → 510. Minutos desde medianoche, para medir duraciones. */
export function minutos(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Ancla del bloque dentro del programa. La usan la línea del día, la agenda
 *  y los perfiles, así que vive con los datos y no en un componente. */
export function anclaDe(bloque: Bloque): string {
  return `bloque-${bloque.inicio.replace(':', '')}`
}

/** Los extremos de la jornada, derivados de la agenda y no escritos a mano. */
export const JORNADA = {
  abre: minutos(AGENDA[0].inicio),
  cierra: minutos(AGENDA[AGENDA.length - 1].fin),
  get total() {
    return this.cierra - this.abre
  },
}

/** Papel de una persona dentro de un bloque concreto. */
export type Intervencion = {
  bloque: Bloque
  papel: 'ponente' | 'moderador' | 'panelista' | 'a cargo'
}

/**
 * Recorre la agenda y devuelve todo lo que hace una persona.
 * Es la única forma de saberlo: no existe una lista de intervenciones aparte.
 */
export function intervencionesDe(slug: string): Intervencion[] {
  const out: Intervencion[] = []
  for (const bloque of AGENDA) {
    switch (bloque.tipo) {
      case 'ponencia':
        if (bloque.ponente === slug) out.push({ bloque, papel: 'ponente' })
        break
      case 'hito':
        if (bloque.ponente === slug) out.push({ bloque, papel: 'a cargo' })
        break
      case 'panel':
        if (bloque.moderador === slug) out.push({ bloque, papel: 'moderador' })
        else if ((bloque.panelistas as readonly string[]).includes(slug)) {
          out.push({ bloque, papel: 'panelista' })
        }
        break
    }
  }
  return out
}

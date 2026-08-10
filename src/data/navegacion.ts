/** Los 5 destinos del sitio. El primero es la home, que además tiene anclas. */
export const NAV = [
  { etiqueta: 'Bienvenida', ruta: '/' },
  { etiqueta: 'Ponentes', ruta: '/ponentes' },
  { etiqueta: 'Escarapela', ruta: '/escarapela' },
  { etiqueta: 'Encuestas', ruta: '/encuestas' },
  { etiqueta: 'Certificado', ruta: '/certificado' },
] as const

/** Secciones de la home. El scrollspy del header resalta la que esté a la vista. */
export const ANCLAS = [
  { id: 'bienvenida', etiqueta: 'Bienvenida' },
  { id: 'sobre-el-foro', etiqueta: 'Sobre el foro' },
  { id: 'agenda', etiqueta: 'Agenda' },
] as const

export type AnclaId = (typeof ANCLAS)[number]['id']

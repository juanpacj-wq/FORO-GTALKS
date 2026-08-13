/** Los 6 destinos del sitio. El primero es la home, que además tiene anclas. */
export const NAV = [
  { etiqueta: 'Bienvenida', ruta: '/' },
  { etiqueta: 'Ponentes', ruta: '/ponentes' },
  { etiqueta: 'Escarapela', ruta: '/escarapela' },
  { etiqueta: 'Encuestas', ruta: '/encuestas' },
  { etiqueta: 'Certificado', ruta: '/certificado' },
  { etiqueta: 'Memorias del evento', ruta: '/galeria' },
] as const

export interface Ancla {
  id: string
  etiqueta: string
}

/**
 * Los rieles de anclas, por ruta. El scrollspy del header resalta la sección a
 * la vista. El riel nació en la home; /galeria pidió el suyo el 2026-08-12.
 * Una ruta que no esté aquí simplemente no lleva riel.
 */
const ANCLAS_POR_RUTA: Record<string, readonly Ancla[]> = {
  '/': [
    { id: 'bienvenida', etiqueta: 'Bienvenida' },
    { id: 'sobre-el-foro', etiqueta: 'Sobre el foro' },
    { id: 'agenda', etiqueta: 'Agenda' },
  ],
  '/galeria': [
    { id: 'galeria-de-imagenes', etiqueta: 'Galería de imágenes' },
    { id: 'descargar-contenido', etiqueta: 'Descargar contenido' },
    { id: 'resumen-de-jornada', etiqueta: 'Resumen de jornada' },
  ],
}

/** El riel de una ruta, o ninguno. Devuelve siempre la MISMA referencia por
 *  ruta, para que pueda ir de dependencia de un efecto sin redisparos. */
export function anclasDe(pathname: string): readonly Ancla[] {
  return ANCLAS_POR_RUTA[pathname] ?? SIN_ANCLAS
}

const SIN_ANCLAS: readonly Ancla[] = []

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
  // Las dos descargas dejaron de compartir sección el 2026-08-13 (pedido del
  // usuario): las presentaciones abren la página y las fotografías van después
  // del abanico, junto a lo que se acaba de ver. La etiqueta de la primera es
  // más corta que su título («Descarga las presentaciones de tus ponentes»)
  // porque esto es un ÍNDICE, en versalita y en una fila que no debe empujar a
  // las demás fuera del riel; el título completo lo lee quien llega a la
  // sección.
  '/galeria': [
    { id: 'descargar-presentaciones', etiqueta: 'Presentaciones' },
    { id: 'galeria-de-imagenes', etiqueta: 'Galería de imágenes' },
    { id: 'descargar-imagenes', etiqueta: 'Descargar imágenes' },
    { id: 'resumen-de-jornada', etiqueta: 'Resumen de la jornada' },
  ],
}

/** El riel de una ruta, o ninguno. Devuelve siempre la MISMA referencia por
 *  ruta, para que pueda ir de dependencia de un efecto sin redisparos. */
export function anclasDe(pathname: string): readonly Ancla[] {
  return ANCLAS_POR_RUTA[pathname] ?? SIN_ANCLAS
}

const SIN_ANCLAS: readonly Ancla[] = []

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// El flujo OIDC y la identidad (/api/me) viven en el server Express (server/, puerto 3000 por
// defecto). Vite les hace proxy para que todo funcione en el mismo origen (5173), que es el
// registrado como redirect URI en el App Registration. El sitio en sí es público: en dev no hay
// nada que gatear el server solo hace falta levantado (`npm run dev:auth`) para probar el
// login real de /escarapela.
//
// La lista de abajo tiene que cubrir TODAS las rutas de Express, no solo las de identidad, y la
// de ENTREGA es la que más caro cuesta olvidar. `/descargas` faltaba, y el fallo no se parecía a
// un fallo: `/api/descargas` sí iba por el proxy y confirmaba los dos paquetes, así que la página
// pintaba sus botones como enlaces de verdad; el clic en `/descargas/imagenes` se quedaba en Vite,
// que lo atendía con su fallback de SPA. Un clic en `<a download>` viaja como NAVEGACIÓN, así que
// el fallback lo daba por bueno y devolvía index.html con 200; el navegador, sin
// `Content-Disposition` y con `text/html`, lo guardaba con el nombre del rol y la extensión del
// tipo: «imagenes.htm». Un archivo que no abre nada, en vez de 1.3 GB de fotos.
const PUERTO_AUTH = Number(process.env.SERVER_PORT || 3000)
const AUTH_SERVER = `http://localhost:${PUERTO_AUTH}`

export default defineConfig({
  plugins: [react()],
  server: {
    // Si :5173 está ocupado, Vite abortaría a :5174 y el redirect URI registrado dejaría de
    // coincidir con el origen del navegador: AADSTS50011 sin ninguna pista. Mejor fallar aquí,
    // con un error que dice qué puerto liberar.
    strictPort: true,
    proxy: {
      '/auth': AUTH_SERVER,
      '/api': AUTH_SERVER,
      '/health': AUTH_SERVER,
      // Entrega, no identidad: los dos ZIP de /galeria. La clave va como expresión regular (Vite
      // las reconoce por el `^`) para proxiar SOLO `/descargas/<rol>`. Con el prefijo a secas,
      // `/descargas` a pelo también saltaría a Express y en dev devolvería el index.html de
      // `dist/`, que puede ser de otra compilación; así esa URL inventada se comporta igual aquí
      // que en producción, que es la SPA resolviendo su propio no encontrado.
      '^/descargas/': AUTH_SERVER,
    },
  },
})

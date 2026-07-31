import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// El flujo OIDC y la identidad (/api/me) viven en el server Express (server/, puerto 3000 por
// defecto). Vite les hace proxy para que todo funcione en el mismo origen (5173), que es el
// registrado como redirect URI en el App Registration. El sitio en sí es público: en dev no hay
// nada que gatear el server solo hace falta levantado (`npm run dev:auth`) para probar el
// login real de /escarapela.
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
    },
  },
})

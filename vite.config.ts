import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import http from 'node:http'

// El login Entra ID vive en el server Express (server/, puerto 3000 por defecto). Vite le hace
// proxy a /auth y /api para que el flujo OIDC funcione en el mismo origen (5173), que es el
// registrado como redirect URI en el App Registration.
const PUERTO_AUTH = Number(process.env.SERVER_PORT || 3000)
const HOST_AUTH = '127.0.0.1'
const AUTH_SERVER = `http://localhost:${PUERTO_AUTH}`

/** Pide algo al gate reenviando las cabeceras TAL CUAL.
 *
 *  Va con `node:http` y no con `fetch` a propósito: undici trata `Sec-Fetch-*` como cabeceras
 *  prohibidas y las sobrescribe, de modo que el gate clasificaría la petición reenviada como un
 *  subrecurso —no como una navegación— y respondería 401 en vez de mandar al login. */
function pedirAlGate(
  ruta: string,
  metodo: string,
  cabeceras: http.IncomingHttpHeaders,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; cuerpo: Buffer }> {
  return new Promise((resolve, reject) => {
    const peticion = http.request(
      {
        hostname: HOST_AUTH,
        port: PUERTO_AUTH,
        path: ruta,
        method: metodo,
        headers: { ...cabeceras, host: `${HOST_AUTH}:${PUERTO_AUTH}` },
        timeout: 5000,
      },
      (r) => {
        const trozos: Buffer[] = []
        r.on('data', (d) => trozos.push(d))
        r.on('end', () =>
          resolve({ status: r.statusCode ?? 502, headers: r.headers, cuerpo: Buffer.concat(trozos) }),
        )
      },
    )
    peticion.on('timeout', () => peticion.destroy(new Error('timeout')))
    peticion.on('error', reject)
    peticion.end()
  })
}

/**
 * Gate del servidor de desarrollo.
 *
 * Antes, `npm run dev` servía la SPA completa en :5173 SIN autenticación: el gate solo existía al
 * construir y servir con Express. Era una trampa —el sitio se podía abrir entero sin login— y el
 * modo en el que se trabaja a diario no debe comportarse distinto del que se publica.
 *
 * Solo se interceptan NAVEGACIONES; los módulos de Vite, el HMR y las peticiones a /auth y /api
 * pasan intactos.
 *
 * Cuando no hay sesión, la petición se DELEGA en el gate en vez de decidir aquí qué hacer. Esto
 * importa: la primera versión redirigía siempre a `/auth/login?silent=1` e ignoraba el marcador
 * `?auth=` con el que vuelve el callback, así que la pantalla de login nunca llegaba a servirse y
 * el navegador entraba en un bucle infinito de redirecciones. Delegando hay UNA sola política —la
 * de `server/app.js`— y dev se comporta como producción por construcción, no por parecido.
 *
 * Falla CERRADO: si el gate no responde, se muestra qué comando falta en vez de servir el sitio.
 */
function gateDesarrollo(): Plugin {
  return {
    name: 'gtalks-gate-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '/'

        // Lo que el propio Vite necesita para funcionar, y el flujo de login (ya va por proxy).
        if (
          url.startsWith('/auth') || url.startsWith('/api') || url.startsWith('/health') ||
          url.startsWith('/@') || url.startsWith('/node_modules') || url.startsWith('/__vite')
        ) return next()

        const destino = req.headers['sec-fetch-dest']
        const acepta = String(req.headers.accept || '')
        const esNavegacion =
          (req.method === 'GET' || req.method === 'HEAD') &&
          (destino === 'document' || (!destino && acepta.includes('text/html')))
        if (!esNavegacion) return next()

        try {
          const sesion = await pedirAlGate('/api/me', 'GET', { cookie: req.headers.cookie || '' })
          if (sesion.status === 200) return next() // sesión válida: se sirve la SPA de Vite

          const respuesta = await pedirAlGate(url, req.method || 'GET', req.headers)
          res.statusCode = respuesta.status
          for (const [clave, valor] of Object.entries(respuesta.headers)) {
            if (clave === 'content-encoding' || clave === 'content-length' || valor === undefined) continue
            res.setHeader(clave, valor as string | string[])
          }
          res.end(respuesta.cuerpo)
        } catch {
          res.statusCode = 503
          res.setHeader('content-type', 'text/html; charset=utf-8')
          res.end(
            `<!doctype html><html lang="es-CO"><meta charset="utf-8">
             <title>Falta el servidor de autenticación</title>
             <body style="font-family:system-ui;max-width:34rem;margin:14vh auto;padding:0 1.5rem;line-height:1.6;color:#1d1d1b">
               <h1 style="font-size:1.4rem">Falta el servidor de autenticación</h1>
               <p>Este sitio no se sirve sin sesión de Microsoft Entra, tampoco en desarrollo.
                  Levanta el gate en otra terminal:</p>
               <pre style="background:#ededed;padding:1rem;border-radius:8px"><code>npm run dev:auth</code></pre>
               <p style="color:#555;font-size:.95rem">Vite espera el gate en <code>${AUTH_SERVER}</code>.
                  Para trabajar solo el diseño, sin autenticación, usa <code>npm run preview</code>
                  sobre un <code>npm run build</code>.</p>
             </body></html>`,
          )
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), gateDesarrollo()],
  server: {
    proxy: {
      '/auth': AUTH_SERVER,
      '/api': AUTH_SERVER,
      '/health': AUTH_SERVER,
    },
  },
})

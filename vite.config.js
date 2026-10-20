import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Run the Vercel serverless functions in `api/` during local dev.
 *
 * Without this, Vite serves `/api/nowplaying` as a static file (the
 * function's own source code), so the client's `res.json()` throws and
 * the "now playing" song title never renders locally. This mounts the
 * real handler so `npm run dev` behaves like production.
 */
function apiDevServer() {
  return {
    name: 'tradio-api-dev-server',
    configureServer(server) {
      server.middlewares.use('/api', async (req, res, next) => {
        const name = (req.url || '').split('?')[0].replace(/\.js$/, '').replace(/^\/+|\/+$/g, '')
        if (!name) return next()

        try {
          const mod = await server.ssrLoadModule(`/api/${name}.js`)
          const handler = mod.default
          if (typeof handler !== 'function') {
            res.statusCode = 404
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ error: 'not found' }))
            return
          }
          // The handlers read the full path from req.originalUrl.
          req.originalUrl = `/api/${name}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`
          await handler(req, res)
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'api dev server failed', detail: String(err) }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    apiDevServer(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png'],
      manifest: {
        name: 'T-Radio · Nigerian Online Radio',
        short_name: 'T-Radio',
        description: 'Stream Nigerian radio stations live — a PWA powered by the free Radio Browser API.',
        theme_color: '#0b1020',
        background_color: '#0b1020',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      // Keep it lightweight: the default Workbox precache strategy caches the
      // app shell so the PWA loads instantly and works offline.
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
    }),
  ],
})

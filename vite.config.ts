import { defineConfig } from 'vite'
import pkg from './package.json' with { type: 'json' }
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { steamAuthPlugin } from './vite-plugins/steam-auth'

// Steam's JSON endpoints send no CORS headers, so a browser tab cannot call them
// directly. In the Tauri build that is moot — requests go out from Rust (README §2).
// For `pnpm dev` in a browser we proxy through the Vite dev server instead, which
// keeps the web path on REAL data rather than fixtures. See src/platform/steam.web.ts.
const steamProxy = (target: string) => ({
  target,
  changeOrigin: true,
  headers: {
    // Steam 403s requests whose Origin/Referer point at localhost.
    Referer: `${target}/`,
    Origin: target,
    // And it silently strips fields from a non-browser User-Agent
    // (private/STEAM-URL-REFERENCE.md §9). Match the Rust client exactly, or the
    // browser build and the Tauri build see different data.
    'User-Agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  },
})

export default defineConfig({
  plugins: [react(), tailwindcss(), steamAuthPlugin()],
  /*
   * The client version, from the one place it is already declared.
   *
   * ⚠️ Injected rather than imported. The About and Updates pages report what is
   * RUNNING; importing package.json at runtime would report whatever manifest sits
   * beside the bundle, which is the same file in dev and a different one inside a
   * packaged AppImage. `tauri.conf.json` carries its own copy of this number, and the
   * two must be bumped together.
   */
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // Tauri expects a fixed port and fails if it is not available.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: process.env.TAURI_DEV_HOST || '0.0.0.0',
    proxy: {
      '/steam-store': {
        ...steamProxy('https://store.steampowered.com'),
        rewrite: (p) => p.replace(/^\/steam-store/, ''),
      },
      '/steam-community': {
        ...steamProxy('https://steamcommunity.com'),
        rewrite: (p) => p.replace(/^\/steam-community/, ''),
      },
      // ProtonDB sets access-control-allow-origin to its own domain, so a browser
      // tab cannot call it directly at all — it has to be proxied even in dev.
      // Official Web API. Endpoints used here need no key.
      '/steam-api': {
        ...steamProxy('https://api.steampowered.com'),
        rewrite: (p) => p.replace(/^\/steam-api/, ''),
      },
      '/protondb': {
        ...steamProxy('https://www.protondb.com'),
        rewrite: (p) => p.replace(/^\/protondb/, ''),
      },
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: 'es2021',
    minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
})

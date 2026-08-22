import { fileURLToPath } from 'node:url'
import path from 'node:path'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { createCache } from './cache.ts'
import { registerAuth } from './auth.ts'

/**
 * The demo server.
 *
 * Serves the built web app and stands in for the two things the desktop build gets
 * from Rust: a CORS-free path to Steam, and a cache in front of it.
 *
 * `pnpm demo` builds and runs it. It is NOT how the app ships — the product is a Tauri
 * binary on a Bazzite box — so nothing here may become load-bearing for that build.
 * It exists so the thing can be shown to someone without them installing it.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(here, '../dist')

/**
 * ⚠️ These four prefixes and their headers must match `vite.config.ts` exactly.
 *
 * Steam **403s** a request whose `Origin`/`Referer` point somewhere else, and it
 * silently **strips fields** from a response when the `User-Agent` is not a browser
 * (private/STEAM-URL-REFERENCE.md §9) — that failure is the nasty one, because the call
 * succeeds and merely returns less. If dev and demo disagree here they see different
 * data and the difference is invisible until something is missing on screen.
 *
 * ProtonDB is proxied for a different reason: it pins
 * `access-control-allow-origin` to its own domain, so a browser cannot call it at all.
 */
const UPSTREAMS: ReadonlyArray<{ prefix: string; target: string }> = [
  { prefix: '/steam-store', target: 'https://store.steampowered.com' },
  { prefix: '/steam-community', target: 'https://steamcommunity.com' },
  { prefix: '/steam-api', target: 'https://api.steampowered.com' },
  { prefix: '/protondb', target: 'https://www.protondb.com' },
]

const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

/** Fallback when a caller sends no hint. Short, because home rows move. */
const DEFAULT_TTL_SECONDS = 300

const cache = createCache()

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'warn' },
  // Behind a reverse proxy this is what makes `x-forwarded-proto` trustworthy, which
  // the OpenID realm depends on — a demo served over https must not send users back
  // to an http return_to.
  trustProxy: true,
})

for (const { prefix, target } of UPSTREAMS) {
  app.get(`${prefix}/*`, async (request, reply) => {
    const url = new URL(request.url.slice(prefix.length), target)

    /*
     * The TTL is chosen by the CALL SITE, not here — `steamGet` already declares one
     * per endpoint class (home rows 5 min, app facts 6 h, tag names 24 h) and that is
     * the single source of truth. The client forwards it as a hint; the cache clamps
     * it, so a crafted value can neither poison nor bypass the cache.
     */
    const hinted = Number(request.headers['x-steam-ttl'])
    const ttl = Number.isFinite(hinted) && hinted > 0 ? hinted : DEFAULT_TTL_SECONDS

    try {
      const result = await cache.get(url.toString(), ttl, async () => {
        const upstream = await fetch(url, {
          headers: { Referer: `${target}/`, Origin: target, 'User-Agent': BROWSER_UA },
          signal: AbortSignal.timeout(20_000),
        })
        return {
          status: upstream.status,
          contentType: upstream.headers.get('content-type') ?? 'application/json',
          body: Buffer.from(await upstream.arrayBuffer()),
        }
      })

      return reply
        .code(result.status)
        .header('content-type', result.contentType)
        .header('x-demo-cache', result.cache)
        .send(result.body)
    } catch {
      // Rule 3: a dead endpoint must never blank the UI. The client's parsers all
      // degrade on a non-OK response, so this is the shape they already expect.
      return reply.code(502).send({ error: 'upstream unavailable' })
    }
  })
}

registerAuth(app)

await app.register(fastifyStatic, { root: distDir })

/**
 * SPA fallback — every unmatched GET is the app itself.
 *
 * ⚠️ Except the API prefixes. Without this guard a disabled `/auth/steam/login` answers
 * 200 with index.html, so a broken call looks like a working page load; and a typo in a
 * proxy path would return HTML that the client's JSON parsers would then have to fail
 * on, one layer further from the cause.
 */
const API_PREFIXES = ['/auth/', '/_demo/', ...UPSTREAMS.map((u) => `${u.prefix}/`)]

app.setNotFoundHandler((request, reply) => {
  const isApi = API_PREFIXES.some((p) => request.url.startsWith(p))
  if (request.method !== 'GET' || isApi) return reply.code(404).send({ error: 'not found' })
  return reply.sendFile('index.html')
})

/** Enough to see whether the cache is doing its job under real traffic. */
app.get('/_demo/stats', async () => cache.snapshot())

const port = Number(process.env.PORT ?? 8080)
await app.listen({ port, host: '0.0.0.0' })
console.log(`bazzite-native-store demo on :${port}`)

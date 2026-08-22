import { isTauri } from './index'

/**
 * A single generic Steam GET, so adding an endpoint from private/STEAM-ENDPOINTS.md
 * never requires new Rust. Both implementations take the same request and return
 * parsed JSON; only the route to the network differs.
 *
 *   tauri -> invoke('steam_get') -> reqwest + disk cache (no CORS, real caching)
 *   web   -> fetch('/steam-store/...') -> Vite dev-server proxy (see vite.config.ts)
 */
export type SteamHost = 'store' | 'community' | 'protondb' | 'api'

export type SteamRequest = {
  host: SteamHost
  /** Path on the host, e.g. '/api/featuredcategories'. */
  path: string
  query?: Record<string, string | number>
  /**
   * Disk-cache lifetime, honoured by the Tauri backend only. Steam rate-limits to
   * roughly 200 requests / 5 min per IP (private/STEAM-ENDPOINTS.md), so every caller
   * must pick one deliberately.
   */
  ttlSeconds: number
  /** Some Steam routes answer XML, not JSON. Default 'json'. */
  as?: 'json' | 'text'
}

/**
 * The Network page's three levers, held here rather than passed per request.
 *
 * ⚠️ `offline` is the interesting one: it does not disable the cache, it disables the
 * *network*. A cache hit still answers, so the store keeps working on everything you
 * have already looked at, and everything else fails the way a dead endpoint already
 * does — which every caller in this app is written to survive. That is the whole
 * design: offline mode is not a mode the UI has to know about.
 */
const policy = { timeoutMs: 8000, offline: false }

export const setTransportPolicy = (next: { timeoutMs: number; offline: boolean }): void => {
  policy.timeoutMs = next.timeoutMs
  policy.offline = next.offline
}

/** Thrown when offline mode declines a request. Distinguishable in a log; caught
 *  by the same handlers as any other network failure. */
export class OfflineError extends Error {
  constructor(path: string) {
    super(`offline mode: ${path}`)
    this.name = 'OfflineError'
  }
}

const buildQuery = (query: SteamRequest['query']): string => {
  if (!query) return ''
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) qs.set(k, String(v))
  const s = qs.toString()
  return s ? `?${s}` : ''
}

const WEB_PROXY_PREFIX: Record<SteamHost, string> = {
  store: '/steam-store',
  community: '/steam-community',
  protondb: '/protondb',
  api: '/steam-api',
}

const webGet = async (req: SteamRequest): Promise<unknown> => {
  const url = `${WEB_PROXY_PREFIX[req.host]}${req.path}${buildQuery(req.query)}`
  /*
   * The TTL travels with the request so the demo server can cache on the SAME number
   * the Tauri backend uses — one source of truth per endpoint instead of a second
   * table on the server that drifts. The dev proxy ignores the header; the demo server
   * clamps it, so it is a hint and never a lever.
   */
  const res = await fetch(url, {
    headers: { 'x-steam-ttl': String(req.ttlSeconds) },
    /*
     * ⚠️ `ttlSeconds: 0` means "do not answer this from a cache" and the BROWSER's
     * own HTTP cache counts. Without this the Network page's probes were timing a
     * disk read: the Steam store came back in 3 ms, which is not a number any
     * transatlantic request can produce, and the card would have reported a healthy
     * service while the network was down.
     */
    cache: req.ttlSeconds === 0 ? 'no-store' : 'default',
    // ⚠️ `AbortSignal.timeout` rather than a race with a setTimeout: it actually
    // cancels the request, so a Request timeout of 5s does not leave four abandoned
    // sockets open against a rate-limited host.
    signal: AbortSignal.timeout(policy.timeoutMs),
  })
  if (!res.ok) throw new Error(`Steam ${req.path} -> HTTP ${res.status}`)
  return req.as === 'text' ? res.text() : res.json()
}

const tauriGet = async (req: SteamRequest): Promise<unknown> => {
  const { invoke } = await import('@tauri-apps/api/core')
  // Rust returns the raw body as a string; it never interprets Steam's shapes.
  const body = await invoke<string>('steam_get', {
    host: req.host,
    path: req.path,
    query: req.query ?? {},
    ttlSeconds: req.ttlSeconds,
    timeoutMs: policy.timeoutMs,
  })
  return req.as === 'text' ? body : JSON.parse(body)
}

/**
 * In-memory response cache, shared by both platforms.
 *
 * The Rust backend already caches to disk, but the BROWSER build had nothing — every
 * focus change and every page open went straight to Steam, which is exactly what a
 * ~200 request / 5 min per-IP limit punishes. This sits above the transport so both
 * builds benefit: in the browser it is the only cache, and in Tauri it also saves the
 * IPC round-trip on repeat reads.
 *
 * Lives for the session only. Durable caching across restarts is the Rust layer's
 * job (src-tauri/src/steam.rs), which additionally serves stale entries on error.
 */
type CacheEntry = { at: number; body: unknown }

const cache = new Map<string, CacheEntry>()

/** Requests currently in flight, so N callers for the same URL make ONE request. */
const inFlight = new Map<string, Promise<unknown>>()

const cacheKey = (req: SteamRequest): string =>
  `${req.as ?? 'json'}:${req.host}${req.path}${buildQuery(req.query)}`

export const steamGet = (req: SteamRequest): Promise<unknown> => {
  const key = cacheKey(req)

  const hit = cache.get(key)
  if (hit && (Date.now() - hit.at) / 1000 < req.ttlSeconds) return Promise.resolve(hit.body)

  /*
   * ⚠️ Checked AFTER the memory cache and BEFORE the network, deliberately. Offline
   * mode is meant to leave the store usable on what it already has, so a cached
   * answer must still be served; only the request that would leave the machine is
   * refused. In the Tauri build the disk cache sits behind this and is therefore not
   * reachable while offline — a limitation worth knowing, and the reason offline mode
   * is most useful within a session rather than across a restart.
   */
  if (policy.offline) return Promise.reject(new OfflineError(req.path))

  // Deduplicate concurrent callers. Moving focus quickly can ask for the same app
  // several times before the first response lands.
  const pending = inFlight.get(key)
  if (pending) return pending

  const request = (isTauri() ? tauriGet(req) : webGet(req))
    .then((body) => {
      cache.set(key, { at: Date.now(), body })
      return body
    })
    .finally(() => {
      inFlight.delete(key)
    })

  inFlight.set(key, request)
  return request
}

/** Test/debug helper — not used by the app. */
export const clearSteamCache = (): void => {
  cache.clear()
  inFlight.clear()
}

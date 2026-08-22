/**
 * The shared upstream cache — the reason a hosted demo is viable at all.
 *
 * ⚠️ Steam rate-limits to roughly **200 requests per 5 minutes per IP**, and behind a
 * server every visitor shares one IP. The desktop build survives that on its Rust disk
 * cache; the browser build has only an in-memory cache that dies with the tab. So
 * without this, the fourth person to open the demo gets an empty store.
 *
 * Three behaviours, and all three are load-bearing:
 *
 * 1. **TTL cache**, so repeat visitors cost nothing upstream.
 * 2. **In-flight de-duplication**, so ten people opening the page at once produce ONE
 *    upstream request rather than ten. This is the case a plain TTL cache misses
 *    entirely — a cold cache plus a burst of visitors is exactly how a demo gets
 *    rate-limited on launch.
 * 3. **Serve-stale-on-failure.** If the upstream 429s or dies, an expired entry is
 *    returned rather than an error. That is this project's endpoint rule 3 — *never
 *    let a dead endpoint blank the UI* — applied one layer out.
 */

export type CacheStats = {
  entries: number
  hits: number
  misses: number
  coalesced: number
  staleServed: number
  upstream: number
}

type Entry = {
  at: number
  ttlMs: number
  status: number
  contentType: string
  body: Buffer
}

/** Nothing is cached longer than this, whatever a caller asks for. */
const MAX_TTL_MS = 24 * 60 * 60 * 1000
/** Or shorter than this — a zero TTL would defeat the whole point under load. */
const MIN_TTL_MS = 30 * 1000
/**
 * How long a stale entry stays usable as a failure fallback. Well past its TTL: a
 * day-old home row is enormously better than an empty screen.
 */
const STALE_GRACE_MS = 7 * 24 * 60 * 60 * 1000

/** Bounded so a long-running demo cannot grow without limit. */
const MAX_ENTRIES = 2000

export type Fetched = { status: number; contentType: string; body: Buffer }

export const createCache = () => {
  const entries = new Map<string, Entry>()
  const inFlight = new Map<string, Promise<Fetched>>()
  const stats = { hits: 0, misses: 0, coalesced: 0, staleServed: 0, upstream: 0 }

  /** Map insertion order is age order, so the oldest key is simply the first. */
  const evict = () => {
    while (entries.size > MAX_ENTRIES) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
    }
  }

  const get = async (
    key: string,
    ttlSeconds: number,
    load: () => Promise<Fetched>,
  ): Promise<Fetched & { cache: 'hit' | 'miss' | 'coalesced' | 'stale' }> => {
    const ttlMs = Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, ttlSeconds * 1000))
    const hit = entries.get(key)
    const now = Date.now()

    if (hit && now - hit.at < hit.ttlMs) {
      stats.hits++
      return { status: hit.status, contentType: hit.contentType, body: hit.body, cache: 'hit' }
    }

    // Someone is already asking upstream for this exact thing. Wait for their answer
    // instead of making a second identical request.
    const pending = inFlight.get(key)
    if (pending) {
      stats.coalesced++
      return { ...(await pending), cache: 'coalesced' }
    }

    stats.misses++
    const task = (async () => {
      stats.upstream++
      return load()
    })()
    inFlight.set(key, task)

    try {
      const fresh = await task
      // ⚠️ Only successful responses are cached. Caching a 429 or a 503 would turn a
      // momentary rate-limit into a TTL-long outage for everyone.
      if (fresh.status >= 200 && fresh.status < 300) {
        entries.delete(key) // re-insert so eviction order tracks recency
        entries.set(key, { at: now, ttlMs, ...fresh })
        evict()
      } else if (hit && now - hit.at < STALE_GRACE_MS) {
        stats.staleServed++
        return { status: hit.status, contentType: hit.contentType, body: hit.body, cache: 'stale' }
      }
      return { ...fresh, cache: 'miss' as const }
    } catch (error) {
      if (hit && now - hit.at < STALE_GRACE_MS) {
        stats.staleServed++
        return { status: hit.status, contentType: hit.contentType, body: hit.body, cache: 'stale' }
      }
      throw error
    } finally {
      inFlight.delete(key)
    }
  }

  const snapshot = (): CacheStats => ({ entries: entries.size, ...stats })

  return { get, snapshot }
}

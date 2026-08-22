import { steamGet } from './transport'
import type { SteamHost } from './transport'

/**
 * Are the upstreams answering?
 *
 * > Network exists because the store is a stitch of four services, and any one of them
 * > can be the reason a shelf is empty. The page leads with which are answering, so
 * > "the store is broken" becomes "the deal feed is slow" in one glance.
 *
 * ⚠️ The design names Steam's store API, ProtonDB, "the deal feed" and "the Bazzite
 * update server". Three of those are real here and one is not: the deal feed IS the
 * Steam store (`featuredcategories`), and there is no Bazzite update server we talk
 * to. The four probed below are the four hosts this app actually has — the same four
 * `SteamHost` values `transport.ts` routes to — so the page cannot claim a dependency
 * we do not have, and cannot miss one we do.
 */
export type ServiceState = 'ok' | 'slow' | 'down'

export type ServiceHealth = {
  host: SteamHost
  label: string
  state: ServiceState
  /** Round trip in ms. Absent when the probe never came back. */
  latencyMs?: number
}

/** Above this a service is answering but not usefully. The design's own threshold. */
const SLOW_MS = 1000

/**
 * ⚠️ Every probe is a REAL request to an endpoint the app already uses, with a TTL of
 * zero so it cannot be answered from cache.
 *
 * A synthetic ping would measure something the store never does. The point of this
 * card is to explain a screen that is already misbehaving, and a probe that takes a
 * different route from the thing that failed will happily report all-green next to an
 * empty shelf.
 *
 * They are also the CHEAPEST real call on each host — Steam allows roughly 200
 * requests per five minutes and a diagnostics page must not be what exhausts that.
 */
const PROBES: ReadonlyArray<{
  host: SteamHost
  label: string
  path: string
  query?: Record<string, string | number>
  as?: 'json' | 'text'
}> = [
  { host: 'store', label: 'Steam store', path: '/api/featuredcategories', query: { cc: 'US' } },
  {
    host: 'api',
    label: 'Steam API',
    // ⚠️ `GetServerInfo` (71 bytes), not `GetAppList`. GetAppList is the obvious
    // keyless probe and it is a ~10 MB body listing every app on Steam — measured
    // here it simply never came back, so the card reported the Steam API down while
    // the store worked fine. A probe has to be the cheapest real call on the host,
    // not the most convenient one.
    path: '/ISteamWebAPIUtil/GetServerInfo/v1/',
  },
  { host: 'protondb', label: 'ProtonDB', path: '/api/v1/reports/summaries/570.json' },
  {
    host: 'community',
    label: 'Steam community',
    path: '/actions/ajaxresolveusers',
    // ⚠️ Valve's own documented example SteamID (Robin Walker's public profile),
    // not anyone's personal account. Resolving a real, always-present id is what
    // makes this a representative call rather than a synthetic ping.
    query: { steamids: '76561197960435530' },
  },
]

const probe = async (spec: (typeof PROBES)[number]): Promise<ServiceHealth> => {
  const started = performance.now()
  try {
    await steamGet({
      host: spec.host,
      path: spec.path,
      query: spec.query,
      as: spec.as,
      // ⚠️ Zero, so the disk cache cannot answer this. A cached probe measures the
      // filesystem and reports 2 ms while the network is on fire.
      ttlSeconds: 0,
    })
    const latencyMs = Math.round(performance.now() - started)
    return {
      host: spec.host,
      label: spec.label,
      state: latencyMs > SLOW_MS ? 'slow' : 'ok',
      latencyMs,
    }
  } catch {
    // ⚠️ No latency on failure. "Down · 8000 ms" invites reading the timeout as a
    // measurement of the service rather than of our own patience.
    return { host: spec.host, label: spec.label, state: 'down' }
  }
}

/** All four at once — sequential probes would report the last one as slower. */
export const checkServices = async (): Promise<ServiceHealth[]> =>
  Promise.all(PROBES.map(probe))

/** The worst state present, which is what the page's pill says. */
export const worstState = (services: readonly ServiceHealth[]): ServiceState =>
  services.some((s) => s.state === 'down')
    ? 'down'
    : services.some((s) => s.state === 'slow')
      ? 'slow'
      : 'ok'

/**
 * What the pill reads, and what the Up menu's badge says when a service is the reason.
 *
 * ⚠️ Names the service. "Something is wrong" sends someone to a settings page to find
 * out what; "ProtonDB not answering" is the whole answer, delivered where they already
 * were.
 */
export const healthSummary = (services: readonly ServiceHealth[]): string => {
  const down = services.filter((s) => s.state === 'down')
  if (down.length > 1) return `${down.length} services not answering`
  if (down.length === 1) return `${down[0]!.label} not answering`
  const slow = services.filter((s) => s.state === 'slow')
  if (slow.length > 1) return `${slow.length} services slow`
  if (slow.length === 1) return `${slow[0]!.label} slow`
  return 'All services answering'
}

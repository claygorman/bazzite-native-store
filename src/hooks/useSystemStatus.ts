import { useCallback, useEffect, useState } from 'react'
import {
  EMPTY_CACHE,
  loadCacheStats,
  loadHostInfo,
  loadPadInfo,
  readDisplayInfo,
  type CacheStats,
  type DisplayInfo,
  type HostInfo,
  type PadInfo,
} from '../platform/systemInfo'
import { loadSteamUiScale, impliedUiScale, type SteamUiScale } from '../platform/display'
import { checkServices, type ServiceHealth } from '../platform/serviceHealth'

export type SystemStatus = {
  host: HostInfo
  pad?: PadInfo
  cache: CacheStats
  display: DisplayInfo
  steamScale?: SteamUiScale
  ourScale: number
  services?: ServiceHealth[]
  /** True while the four upstreams are being timed. */
  probing: boolean
}

/**
 * Everything the status cards read.
 *
 * ⚠️ Loaded when Settings OPENS, not on app launch, and the service probe is separate
 * from the rest. Reading `/proc` costs nothing, but timing four real HTTP requests
 * costs four requests against a ~200 per five minutes budget, and doing that on every
 * launch would spend part of the store's allowance on a page most sessions never open.
 *
 * ⚠️ Nothing here polls. A card that updates itself while you read it is a card you
 * cannot read at ten feet, and every value is a fact about the machine rather than a
 * live meter. `refresh` is the Re-check row.
 */
export const useSystemStatus = (active: boolean): SystemStatus & { refresh: () => void } => {
  const [status, setStatus] = useState<SystemStatus>({
    host: {},
    cache: EMPTY_CACHE,
    display: readDisplayInfo(),
    ourScale: impliedUiScale(),
    probing: false,
  })

  // The cheap half: local files and one small config read. Re-run on every open so a
  // cache cleared last visit is not still reported as full.
  useEffect(() => {
    if (!active) return
    let cancelled = false
    void Promise.all([loadHostInfo(), loadPadInfo(), loadCacheStats(), loadSteamUiScale()]).then(
      ([host, pad, cache, steamScale]) => {
        if (cancelled) return
        setStatus((prev) => ({
          ...prev,
          host,
          pad,
          cache,
          steamScale,
          display: readDisplayInfo(),
          ourScale: impliedUiScale(),
        }))
      },
    )
    return () => {
      cancelled = true
    }
  }, [active])

  const probe = useCallback(() => {
    setStatus((prev) => ({ ...prev, probing: true }))
    void checkServices().then((services) =>
      setStatus((prev) => ({ ...prev, services, probing: false })),
    )
  }, [])

  /*
   * The expensive half, run once per open.
   *
   * ⚠️ Guarded on `services === undefined` rather than on `active` alone, so paging
   * around the rail with LB/RB does not re-probe — the Network card is one of seven
   * pages and walking past it three times must not cost twelve requests.
   */
  useEffect(() => {
    if (!active) return
    setStatus((prev) => {
      if (prev.services !== undefined || prev.probing) return prev
      void checkServices().then((services) =>
        setStatus((p) => ({ ...p, services, probing: false })),
      )
      return { ...prev, probing: true }
    })
  }, [active])

  // Leaving Settings drops the probe result, so re-opening the page later gives a
  // fresh reading rather than one from an hour ago presented as current.
  useEffect(() => {
    if (active) return
    setStatus((prev) => (prev.services === undefined ? prev : { ...prev, services: undefined }))
  }, [active])

  const refresh = useCallback(() => {
    probe()
    void loadCacheStats().then((cache) => setStatus((prev) => ({ ...prev, cache })))
  }, [probe])

  return { ...status, refresh }
}

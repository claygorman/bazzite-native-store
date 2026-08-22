import { useEffect, useState } from 'react'
import { fetchMicrotrailer, type TrailerPreview } from '../platform/steam'

/**
 * Resolve the focused tile's preview clip, after the focus settles.
 *
 * The delay is doing real work: without it, holding a direction fires an
 * `appdetails` request per tile passed through, and Steam rate-limits to roughly
 * 200 requests / 5 min per IP. Waiting for the user to actually stop on something
 * means one request per game they look at, not one per game they scroll past.
 */
export const useMicrotrailer = (appid: number | undefined, delayMs = 400): TrailerPreview => {
  const [preview, setPreview] = useState<TrailerPreview>({})

  useEffect(() => {
    setPreview({})
    if (appid === undefined) return

    let cancelled = false
    const timer = setTimeout(() => {
      fetchMicrotrailer(appid)
        .then((result) => {
          if (!cancelled) setPreview(result)
        })
        // A missing preview is not an error worth surfacing — the tile keeps its art.
        .catch(() => undefined)
    }, delayMs)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [appid, delayMs])

  return preview
}

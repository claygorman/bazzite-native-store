import { useEffect, useRef, useState } from 'react'
import { fetchProtonRating } from '../platform/protondb'
import type { ProtonState } from './useProtonRating'

/**
 * Compatibility ratings for a whole shelf, fetched lazily as you arrive on it.
 *
 * The 2026-08-21 design put a ProtonDB dot under EVERY tile, not just the focused
 * one. ProtonDB has no batch endpoint, so that is one request per appid — twenty
 * visible tiles against a budget of roughly 200 requests / 5 min is not a burst worth
 * spending on rows nobody looks at.
 *
 * So: fetch only the row that has focus, and only the first time it gets focus. The
 * accumulated map is never cleared, so walking back up a shelf you have already
 * visited costs nothing, and `fetchProtonRating`'s 24h cache covers restarts.
 *
 * Appids absent from the map render a neutral dot rather than a gap — see Tile.
 */
export const useRowProtonRatings = (
  appids: readonly number[],
): ReadonlyMap<number, ProtonState> => {
  const [ratings, setRatings] = useState<ReadonlyMap<number, ProtonState>>(new Map())
  /** Appids already requested, so re-focusing a row does not re-fire it. */
  const requested = useRef(new Set<number>())

  // Appids arrive as a fresh array each render; join them so the effect keys on the
  // CONTENT rather than the identity, otherwise it re-runs on every parent render.
  const key = appids.join(',')

  useEffect(() => {
    const pending = appids.filter((appid) => !requested.current.has(appid))
    if (pending.length === 0) return

    for (const appid of pending) requested.current.add(appid)

    let cancelled = false
    setRatings((prev) => {
      const next = new Map(prev)
      for (const appid of pending) next.set(appid, { status: 'loading' })
      return next
    })

    void Promise.all(
      pending.map(async (appid) => {
        const rating = await fetchProtonRating(appid)
        return [appid, rating] as const
      }),
    ).then((results) => {
      if (cancelled) return
      setRatings((prev) => {
        const next = new Map(prev)
        for (const [appid, rating] of results) {
          next.set(appid, rating ? { status: 'rated', rating } : { status: 'unrated' })
        }
        return next
      })
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return ratings
}

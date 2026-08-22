import { useEffect, useState } from 'react'
import { fetchAppDetails, fetchPlayerCount, fetchReviewSummary } from '../platform/steam'
import type { AppDetails, ReviewSummary } from '../types/steam'

export type DetailsState = {
  details?: AppDetails
  reviews?: ReviewSummary
  /** Concurrent players right now. Needs no API key. */
  players?: number
  loading: boolean
  /** True when Steam answered `success: false` — age-gated or delisted. */
  unavailable: boolean
}

/**
 * Everything the details page needs for one app.
 *
 * The two requests are independent, so they run together rather than in sequence —
 * a game with no reviews should not delay the page.
 */
export const useAppDetails = (appid: number | undefined): DetailsState => {
  const [state, setState] = useState<DetailsState>({ loading: true, unavailable: false })

  useEffect(() => {
    if (appid === undefined) return
    setState({ loading: true, unavailable: false })

    let cancelled = false
    void Promise.all([
      fetchAppDetails(appid).catch(() => undefined),
      fetchReviewSummary(appid).catch(() => undefined),
      fetchPlayerCount(appid).catch(() => undefined),
    ]).then(([details, reviews, players]) => {
      if (cancelled) return
      setState({ details, reviews, players, loading: false, unavailable: details === undefined })
    })

    return () => {
      cancelled = true
    }
  }, [appid])

  return state
}

import { useEffect, useState } from 'react'
import { fetchProtonRating, type ProtonRating } from '../platform/protondb'

/**
 * Compatibility rating for the focused game.
 *
 * Returns a status rather than `ProtonRating | undefined` so the badge can hold its
 * place in the hero while the request is in flight. Without that the badge pops in
 * late and shoves the rest of the row sideways every time focus moves — on a shelf
 * you are scrolling through, that reflow is far more distracting than a placeholder.
 *
 * Debounced like the trailer preview so scrolling a shelf does not fire a request
 * per tile passed through.
 */
export type ProtonState =
  { status: 'loading' } | { status: 'rated'; rating: ProtonRating } | { status: 'unrated' }

export const useProtonRating = (appid: number | undefined, delayMs = 400): ProtonState => {
  const [state, setState] = useState<ProtonState>({ status: 'loading' })

  useEffect(() => {
    setState({ status: 'loading' })
    if (appid === undefined) return

    let cancelled = false
    const timer = setTimeout(() => {
      fetchProtonRating(appid).then((rating) => {
        if (cancelled) return
        setState(rating ? { status: 'rated', rating } : { status: 'unrated' })
      })
    }, delayMs)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [appid, delayMs])

  return state
}

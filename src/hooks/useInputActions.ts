import { useEffect, useRef } from 'react'
import { subscribeInput, type InputAction } from '../platform/input'

/**
 * Turns raw input edges into the actions the UI consumes, applying repeat.
 *
 * This is the ONE place dpad feel is defined, shared by the browser and Tauri
 * builds alike. Tune it here and both change together.
 *
 * `initialDelayMs` is the pause before a held direction starts repeating — too low
 * and single taps double-fire, too high and the list feels stuck. `repeatMs` is the
 * hold-to-scroll rate thereafter.
 */
export type RepeatTuning = {
  initialDelayMs: number
  repeatMs: number
}

export const DEFAULT_REPEAT: RepeatTuning = {
  initialDelayMs: 400,
  repeatMs: 90,
}

/**
 * Directions and the paging triggers repeat. Shoulders deliberately do NOT — a held
 * LB/RB should step one shelf, not fly through every shelf on the screen. And
 * repeating 'accept' or 'wishlist' would fire the action many times over.
 */
const REPEATING: ReadonlySet<InputAction> = new Set<InputAction>([
  'up',
  'down',
  'left',
  'right',
  'pagePrev',
  'pageNext',
])

type Timers = { delay?: ReturnType<typeof setTimeout>; interval?: ReturnType<typeof setInterval> }

export const useInputActions = (
  handler: (action: InputAction) => void,
  tuning: RepeatTuning = DEFAULT_REPEAT,
): void => {
  // Keep the latest handler without re-subscribing (and so without dropping the
  // held-key timers) every time the component re-renders.
  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  })

  const { initialDelayMs, repeatMs } = tuning

  useEffect(() => {
    const timers = new Map<InputAction, Timers>()

    const clear = (action: InputAction) => {
      const t = timers.get(action)
      if (!t) return
      if (t.delay) clearTimeout(t.delay)
      if (t.interval) clearInterval(t.interval)
      timers.delete(action)
    }

    const stop = subscribeInput((event) => {
      if (!event.pressed) {
        clear(event.action)
        return
      }

      handlerRef.current(event.action) // first fire is always immediate
      if (!REPEATING.has(event.action)) return

      clear(event.action) // defensive: never stack timers on a re-press
      const t: Timers = {}
      t.delay = setTimeout(() => {
        t.interval = setInterval(() => handlerRef.current(event.action), repeatMs)
      }, initialDelayMs)
      timers.set(event.action, t)
    })

    return () => {
      stop()
      for (const action of [...timers.keys()]) clear(action)
    }
  }, [initialDelayMs, repeatMs])
}

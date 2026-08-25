import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AMBIENT_FADE_S, AMBIENT_SETTLE_MS } from '../platform/motion'

type Props = {
  /** Art for whatever currently has focus. Undefined clears the wash. */
  src?: string
}

/** Matches the opacity the wash used before it learned to fade. */
const WASH_OPACITY = 0.62

/**
 * The blurred backdrop behind everything.
 *
 * ⚠️ The obvious version — one `<img key={src}>` with `transition-opacity` — cannot
 * fade at all. Changing the key makes React unmount the old element and mount a new
 * one, and a freshly mounted element has no previous opacity to animate FROM, so the
 * browser paints it at its final value immediately. The transition is real; it just
 * never has two states to move between. What you get is a hard cut that reads as the
 * page flickering every time focus moves.
 *
 * `AnimatePresence` is the fix: it keeps the outgoing element mounted until its exit
 * animation finishes, so there are genuinely two images on screen to cross-fade.
 *
 * The settle delay is the other half. Held input retargets focus every 90ms; without
 * it the backdrop would try to swap eleven times a second and spend the whole time
 * decoding large images nobody looks at.
 */
export const AmbientArt = ({ src }: Props) => {
  const [settled, setSettled] = useState<string | undefined>(src)

  useEffect(() => {
    if (src === settled) return
    const timer = window.setTimeout(() => setSettled(src), AMBIENT_SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [src, settled])

  return (
    <AnimatePresence>
      {settled !== undefined && (
        <motion.img
          key={settled}
          src={settled}
          alt=""
          aria-hidden
          decoding="async"
          initial={{ opacity: 0 }}
          animate={{ opacity: WASH_OPACITY }}
          exit={{ opacity: 0 }}
          transition={{ duration: AMBIENT_FADE_S, ease: 'easeInOut' }}
          /*
           * ⚠️ **`transform-gpu` and `will-change` are load-bearing, not decoration.**
           * This is a full-screen `filter: blur(18px)` — expensive to rasterise and, on its
           * own, NOT promoted to a composited layer. The focused tile above it runs
           * `animate-tile-breath`, an infinite 2.8s opacity animation, so without promotion
           * every one of those frames re-blurs the whole screen. Measured on macOS
           * (WKWebView, Retina) 2026-08-25: **4-9% CPU at complete idle** with the wash on,
           * **0.4-2.7%** with it off. Nobody was touching the app in either case.
           *
           * Promoting it rasterises the blur ONCE into a texture that the compositor reuses,
           * so animations above it cost what they should. `will-change` names `opacity`
           * because that is what `motion` animates during the cross-fade — the moment two of
           * these exist at once is the most expensive frame this app draws.
           */
          style={{ willChange: 'opacity' }}
          className="absolute inset-0 h-full w-full scale-114 transform-gpu object-cover blur-wash saturate-125"
        />
      )}
    </AnimatePresence>
  )
}

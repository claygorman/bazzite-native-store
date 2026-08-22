import { motion } from 'motion/react'
import { useSetting } from '../hooks/useSettings'

/*
 * The focused plate's light, in two parts that answer two different questions.
 *
 * The BLOOM says "you are here" — it breathes continuously for as long as the tile holds
 * focus. The WHOOSH says "you just arrived" — one diagonal pass of light, once, on
 * arrival. The design tried a white border doing both jobs at once and dropped it,
 * because a single treatment cannot say "here" and "just now" at the same time.
 */

/**
 * The breathing bloom, painted OUTSIDE the plate.
 *
 * Two layers, each with a static shadow, fading against each other — see the keyframes
 * in index.css for why this is not one animated `box-shadow`.
 *
 * ⚠️ These must not be clipped. They sit inside a plate that no longer sets
 * `overflow-hidden` precisely so their shadows can escape it, and the shelf's own clip
 * region was widened to match. A `box-shadow` is clipped by an ANCESTOR's overflow,
 * never by its own element's.
 */
const Bloom = ({ still }: { still: boolean }) =>
  /*
   * ⚠️ When motion is reduced the bloom STOPS, it does not disappear. This is the
   * focused tile's only focus indicator now that the boxed plate dropped the ring —
   * animating it away would leave someone who asked for less motion with no way to
   * tell where they are. One static layer at full strength, no keyframes.
   */
  still ? (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 rounded-xl"
      style={{ boxShadow: 'var(--shadow-tile-glow-hi)' }}
    />
  ) : (
    <>
      <span
        aria-hidden
        className="animate-tile-breath-lo pointer-events-none absolute inset-0 -z-10 rounded-xl"
        style={{ boxShadow: 'var(--shadow-tile-glow-lo)' }}
      />
      <span
        aria-hidden
        className="animate-tile-breath-hi pointer-events-none absolute inset-0 -z-10 rounded-xl"
        style={{ boxShadow: 'var(--shadow-tile-glow-hi)' }}
      />
    </>
  )

/**
 * One diagonal sweep of light across the plate, on arrival.
 *
 * ⚠️ Motion rather than CSS, and this is the one place in the tile where it earns its
 * keep. Restarting a one-shot CSS animation needs either two identical keyframe rules
 * alternated by name, or remove-attribute / force-reflow / re-add — toggling a class or
 * an opacity does NOT restart it, because the browser has no reason to re-run an
 * animation whose name never changed. Mounting a `motion.span` replays `initial`
 * → `animate` with none of that.
 *
 * ⚠️ No `AnimatePresence`. There is no exit to animate, and under StrictMode it has
 * left this codebase with a permanently-mounted transparent overlay eating clicks once
 * already. The parent renders this only while focused, so React's own mount/unmount is
 * the whole mechanism: focus lands, it mounts and plays; focus leaves, it is gone.
 *
 * `reduceMotion` is honoured globally by the app's `MotionConfig`.
 */
const Whoosh = () => (
  <span
    aria-hidden
    // `isolate` keeps `mix-blend-mode: screen` from reaching past the plate and
    // screening against the page behind it. The clip keeps the sweep on the plate.
    className="pointer-events-none absolute inset-0 isolate overflow-hidden rounded-xl"
  >
    {/*
      Rotated on the OUTSIDE, translated on the inside — the order is load-bearing.
      The sweep has to travel along its own tilted axis to cross corner to corner;
      Motion composes `translateX` before `rotate`, which would slide it flat across
      and then tilt the result.
    */}
    <span className="absolute inset-0 block" style={{ transform: 'rotate(22deg)' }}>
      <motion.span
        className="absolute block"
        style={{
          top: '-70%',
          left: '-60%',
          width: '62%',
          height: '240%',
          mixBlendMode: 'screen',
          filter: 'blur(0.875rem)',
          background:
            'radial-gradient(ellipse 42% 58% at 50% 50%, rgb(255 255 255 / 0.42) 0%, rgb(255 255 255 / 0.2) 38%, rgb(255 255 255 / 0.07) 62%, rgb(255 255 255 / 0) 82%)',
        }}
        initial={{ x: '-150%', opacity: 0 }}
        animate={{ x: '300%', opacity: [0, 0.9, 0.75, 0] }}
        transition={{
          duration: 1.5,
          ease: [0.3, 0.5, 0.25, 1],
          opacity: { duration: 1.5, times: [0, 0.18, 0.7, 1] },
        }}
      />
    </span>
  </span>
)

/**
 * Both halves of the focused plate's light. Render only while the tile is focused —
 * mount/unmount is what replays the whoosh.
 *
 * ⚠️ The reduced-motion gate has to be read HERE rather than left to `MotionConfig`.
 * That config governs Motion components only, so it stops the whoosh and has no opinion
 * whatsoever about the bloom, which is CSS keyframes. Two mechanisms, one setting.
 */
export const TileFocusLight = () => {
  const reduced = useSetting('reduceMotion')
  return (
    <>
      <Bloom still={reduced} />
      {!reduced && <Whoosh />}
    </>
  )
}

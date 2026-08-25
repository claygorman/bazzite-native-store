import type { SpringOptions } from 'motion/react'

/**
 * Shared motion vocabulary, so every surface moves like the same machine.
 *
 * ⚠️ Why springs rather than CSS transitions, since the CSS was already there:
 *
 * A transition is DURATION-based. Focus repeats every 90ms while held
 * (`useInputActions`), and `transition: transform 200ms ease-out` needs 200ms — so
 * each new target throws away the in-flight curve and starts a fresh ease-out from
 * wherever the track happens to be. Ease-out *decelerates into its endpoint*, and
 * those endpoints are not places the user is stopping. Held down, that is fast-slow,
 * fast-slow, eleven times a second — the "klink klink" that reads as stutter on a TV.
 *
 * A spring owns a position AND a velocity, so a target that moves mid-flight keeps the
 * velocity it already had and re-solves. Holding a direction becomes one continuous
 * glide that decelerates only when you actually stop.
 *
 * Motion also writes MotionValues straight to the element's transform rather than
 * through React state. That matters more here than the easing does: re-rendering a
 * shelf and its fifty capsules at 60fps is exactly the reconciliation cost that turns
 * a smooth glide into jank at 4K.
 */

/**
 * Slightly overdamped on purpose. A shelf that overshoots and springs back reads as
 * broken rather than lively, and at 10 feet the overshoot is the only part you notice.
 * Critical damping for mass 1 at this stiffness is 2*sqrt(220) ≈ 29.7.
 */
export const SHELF_SPRING: SpringOptions = {
  stiffness: 220,
  damping: 32,
  mass: 1,
  // Stop sooner than the default: sub-pixel motion on a 4K panel is invisible, and
  // ending the animation early lets the compositor idle on a box that also runs games.
  restDelta: 0.5,
}

/**
 * Rows are a longer throw than tiles — a full shelf height rather than one capsule —
 * so the same stiffness would arrive abruptly. Softer, and it settles just as quickly
 * because the distance does the work.
 */
export const STACK_SPRING: SpringOptions = {
  stiffness: 170,
  damping: 30,
  mass: 1,
  restDelta: 0.5,
}

/** Cross-fade for the blurred backdrop, in seconds. */
export const AMBIENT_FADE_S = 0.42

/**
 * How long focus must rest before the backdrop commits to a new image.
 *
 * Hold a direction and focus moves every 90ms. Without this the wash tries to swap
 * eleven times a second, which strobes and hands the decoder a stream of large images
 * nobody will look at. Slightly longer than the shelf spring takes to settle, so the
 * background changes as you ARRIVE rather than while you are travelling.
 */
export const AMBIENT_SETTLE_MS = 220

/**
 * Screen changes: the incoming page eases in, the outgoing one simply goes.
 *
 * ⚠️ Deliberately enter-only, with no exit animation and no `AnimatePresence`. Every
 * screen paints its own semi-transparent wash over the shared ambient art, so any
 * cross-fade puts two washes on screen at once and the whole frame visibly darkens
 * mid-transition. `AnimatePresence mode="wait"` avoids that by running exit fully
 * before enter — which doubles the wall time and is precisely the "slow" we do not
 * want. Unmounting instantly and easing the new screen in is the fastest thing that
 * still reads as a transition rather than a cut.
 *
 * 170ms is around the floor where movement still registers as movement. The curve is
 * front-loaded (most of the distance covered early) so it feels immediate even though
 * it is not instant.
 */
export const PAGE_ENTER = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.17, ease: [0.16, 1, 0.3, 1] as const },
}

/**
 * A focus glow coming up or going away.
 *
 * ⚠️ **The point of this token is the LAYER it implies, not the curve.** A focus glow is
 * a large blurred `box-shadow`, and blur is the one thing that cannot be handed to the
 * compositor: `transition-shadow` re-rasterises the blur on every frame of the fade, and
 * a blurred shadow paints outside the element, so the ancestor it overlaps repaints too.
 *
 * So a glow is not animated as a shadow. It is painted ONCE on its own always-present
 * layer, and that layer's OPACITY is animated — opacity being free at the compositor.
 * The shape never changes, only how much of it you see.
 *
 * 150ms and ease-out because that is Tailwind's default `transition` and it is what these
 * glows already did; the feel is deliberately unchanged by the move off CSS. Anything that
 * wants to feel different should say so on purpose rather than inherit it from a refactor.
 */
export const FOCUS_FADE = { duration: 0.15, ease: 'easeOut' as const }

/**
 * The offers band travelling between its resting place and the whole page.
 *
 * 200ms ease-out, which is what the CSS `transition-[top]` it replaced already used —
 * the point of that change was to stop animating a LAYOUT property, not to re-time the
 * move, so the curve is carried over deliberately. See `OfferList`'s `BAND`.
 */
export const BAND_SLIDE = { duration: 0.2, ease: 'easeOut' as const }


/**
 * The details pager — Overview · About · ProtonDB · Reviews, moved as a filmstrip.
 *
 * ⚠️ **A slide, and deliberately NOT a cross-fade.** `PAGE_ENTER` above records why a
 * cross-fade was rejected here: every screen paints its own semi-transparent wash over the
 * shared ambient art, so two stacked on screen darkens the whole frame. A strip answers
 * that — the screens are ADJACENT, never on top of one another, so no pixel is ever under
 * two washes, and there is no opacity in this transition at all.
 *
 * ⚠️ The screens are laid out as a real strip (all four mounted, each parked at its own
 * multiple of 100%) and `DetailsPage` translates the strip. An earlier version animated
 * per-screen variants through `AnimatePresence` instead; see the comment there for why
 * mounting on arrival made the animation skip rather than play.
 *
 * ⚠️ **NOT `PAGE_ENTER`'s curve, and the reason is the distance.** This first shipped
 * reusing `[0.16, 1, 0.3, 1]` — correct there, where it is described as "front-loaded so
 * it feels immediate", because that animation travels 14px. Over a whole screen the same
 * curve is a snap rather than a slide. Measured fraction of the travel already covered:
 *
 * | time in          |  6% | 12% | 25% | 50% |
 * |------------------|-----|-----|-----|-----|
 * | `[0.16,1,0.3,1]` | 33% | 56% | 83% | 97% |
 * | this curve       |  1% |  4% | 24% | 78% |
 *
 * A third of the screen crossed in the FIRST FRAME is not something the eye reads as
 * movement — Clay's word for it was "more like a snap then a whoosh". This curve eases in
 * and out, so the strip starts from rest and settles, which is what makes it legible as a
 * strip you are moving along.
 *
 * 320ms because a full screen needs longer to read than 14px does, and still short enough
 * that holding LB/RB through several tabs does not queue a backlog of travel.
 */
export const PAGE_SWIPE = { duration: 0.32, ease: [0.4, 0, 0.2, 1] as const }

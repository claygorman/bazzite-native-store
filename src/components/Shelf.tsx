import { Tile } from './Tile'
import { Prompt } from './ButtonLegend'
import type { StoreRow } from '../types/steam'
import type { InputSource } from '../platform/glyphs'
import type { ProtonState } from '../hooks/useProtonRating'
import { useLayoutEffect, useRef } from 'react'
import { motion, useSpring } from 'motion/react'
import { SHELF_SPRING } from '../platform/motion'

type Props = {
  row: StoreRow
  focusedCol: number | null
  previewUrl?: string
  /** Compatibility ratings for this row's appids, filled in lazily once focused. */
  proton?: ReadonlyMap<number, ProtonState>
  source: InputSource
  padActive?: boolean
  onActivate: (appid: number) => void
  onFocusItem: (col: number) => void
}

/** Distance from the shelf's left edge to the focused tile, in rem. */
const LEAD_IN_REM = 0

/**
 * One shelf.
 *
 * Scrolling is a Motion spring, not scrollLeft/scrollIntoView and not a CSS transition.
 * Hold-to-scroll retargets every ~90ms and both of those restart from scratch on every
 * new target — queued smooth-scrolls fight each other, and a 200ms ease-out decelerates
 * into eleven waypoints a second that nobody is stopping at. A spring carries velocity
 * across retargets instead. See src/platform/motion.ts.
 *
 * Since the 2026-08-21 revision the shelf itself no longer dims — each tile carries
 * its own opacity, so an unfocused row recedes without its title going with it.
 */
export const Shelf = ({
  row,
  focusedCol,
  previewUrl,
  proton,
  source,
  padActive,
  onActivate,
  onFocusItem,
}: Props) => {
  const trackRef = useRef<HTMLDivElement>(null)
  /**
   * The track's position is a MotionValue, NOT React state. Motion writes it straight
   * to the element's transform, so a 60fps glide never re-renders this shelf or the
   * fifty capsules inside it — that reconciliation is what would make it stutter at 4K.
   */
  const x = useSpring(0, SHELF_SPRING)
  /**
   * Shelves unmount whenever you leave home, so on return every spring would start at
   * 0 and slide into place — the whole screen appearing to settle after a back press.
   * The first target is jumped to, not animated.
   */
  const mounted = useRef(false)
  const active = focusedCol !== null

  useLayoutEffect(() => {
    if (focusedCol === null) return
    const track = trackRef.current
    const tile = track?.children[focusedCol] as HTMLElement | undefined
    if (!track || !tile) return

    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
    const maxOffset = Math.max(0, track.scrollWidth - track.clientWidth)
    const offset = Math.min(Math.max(0, tile.offsetLeft - LEAD_IN_REM * rem), maxOffset)
    if (!mounted.current) {
      mounted.current = true
      x.jump(-offset)
      return
    }
    // Retargeting mid-flight is the whole point: the spring keeps the velocity it
    // already has instead of restarting, so holding a direction is one glide.
    x.set(-offset)
  }, [focusedCol, row.items.length, x])

  return (
    // z-10 while focused so this shelf's enlarged clip region (below) paints ABOVE
    // its neighbours. Box-shadow takes no layout space, so without it a later
    // sibling's background quietly covers the focused tile's ring.
    <section className={`flex shrink-0 flex-col gap-3 ${active ? 'relative z-10' : ''}`}>
      <div className="flex items-center gap-3.5">
        <h2 className="text-2xl font-bold tracking-display text-ink">{row.title}</h2>
        {/* "See more" belongs only on the row you are actually in — RT pages the
            focused shelf, so advertising it on every row would name a binding that
            does nothing for four of the five. */}
        {active && (
          <span className="flex items-center gap-2.25 text-sm font-semibold text-ink-3/50">
            <Prompt action="pageNext" source={source} />
            See more
          </span>
        )}
      </div>
      {/*
        A shelf clips HORIZONTALLY in order to scroll. It must not clip vertically at
        all, or the focused tile's glow is shaved into a hard rectangle — a bug now fixed
        four separate times, most recently for turn 12's bloom.

        ⚠️ `overflow-x: clip`, NOT `overflow-hidden`. This is the whole fix and the
        distinction is easy to miss: `overflow: hidden` on one axis forces the other axis
        to become a scroll container (`visible` computes to `auto`), so a horizontally
        clipping shelf clips vertically too whether you asked for it or not. `clip` has
        no such coupling — `overflow-y` genuinely stays `visible`.

        `overflow-clip-margin` then lets the glow bleed past the horizontal clip, so the
        leftmost and rightmost tiles keep theirs. Sized to the bloom's own reach:
        `--shadow-tile-glow-hi` is a 3.375rem blur, and 3.5rem clears it.

        ⚠️ The previous fix here — negative margins plus matching padding to enlarge an
        `overflow-hidden` box — cannot be scaled to this glow, and the reason is worth
        keeping. At the reach turn 12 needs, the vertical pair grew the box until
        ADJACENT SHELVES OVERLAPPED each other by 117px, and the later row painted over
        the earlier row's glow: a horizontal seam right across the page, which is the
        exact artefact the technique existed to prevent. Measured, not theorised.

        ⚠️ WebKitGTK is the renderer that matters (Tauri on Linux) and it is not what
        this was verified in. Both properties are Baseline-era CSS, but if a Bazzite
        build shows a clipped glow, this line is the first place to look.
      */}
      <div className="overflow-x-clip" style={{ overflowClipMargin: '3.5rem' }}>
        <motion.div
          ref={trackRef}
          className="flex items-start gap-5 will-change-transform"
          style={{ x }}
        >
          {row.items.map((item, col) => (
            <Tile
              key={`${item.appid}-${col}`}
              item={item}
              focused={focusedCol === col}
              rowActive={active}
              previewUrl={focusedCol === col ? previewUrl : undefined}
              proton={proton?.get(item.appid)}
              padActive={padActive}
              onActivate={() => {
                onFocusItem(col)
                onActivate(item.appid)
              }}
            />
          ))}
        </motion.div>
      </div>
    </section>
  )
}

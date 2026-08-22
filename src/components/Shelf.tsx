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
        Negative margin + matching padding so the focused tile's ring and drop shadow
        have room inside the clip region. Without it overflow-hidden shaves the focus
        treatment off — which reads as "the ring is broken", or worse as a hard grey
        rectangle, rather than as "the ring is clipped".

        ⚠️ The vertical pair is 2rem, sized against the tile's focus shadow reach
        (~1.9rem). Grow them together or not at all: a shadow larger than this padding
        comes back as a seam, and that bug has now been fixed three separate times.
      */}
      <div className="-mx-6 -my-8 overflow-hidden px-6 py-8">
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

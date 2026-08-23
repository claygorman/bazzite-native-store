import { useLayoutEffect, useRef, useState } from 'react'
import { motion, useSpring } from 'motion/react'
import { SHELF_SPRING } from '../platform/motion'
import { VISIBLE_DAYS, type CalendarDay, type CalendarGame } from '../platform/calendar'

type Props = {
  days: CalendarDay[]
  /** Index of the focused day column, or null when the band is not the focused row. */
  focusedDay: number | null
  /** First visible column — the band shows 5 at a time. */
  windowStart: number
  /**
   * Index of the day currently opened out to full width, or null for the band view.
   * When set, `focusedDay` indexes that day's GAMES rather than the day columns.
   */
  expandedDay: number | null
  /** Mouse parity for A: clicking a collapsed column opens that day out. */
  onOpenDay: (index: number) => void
  onActivate: (appid: number) => void
}

/**
 * Two transitions, because Clay asked for two animations rather than one morph: the
 * box stretches on a spring, and the artwork inside cross-fades on its own clock.
 * The incoming content waits for the box to be most of the way there, so it reads as
 * "the panel opens, then fills" instead of everything happening at once.
 */
const BOX_TRANSITION = { type: 'spring', stiffness: 260, damping: 34 } as const
const CONTENT_OUT = { duration: 0.12, ease: 'easeOut' } as const
const CONTENT_IN = { duration: 0.22, ease: 'easeOut', delay: 0.14 } as const

/** Capsules drawn per column; the rest become the `+N More` badge. */
const CAPSULES_PER_DAY = 3

/**
 * The day columns carry a slow hue ramp across the week — blue on the left, violet on
 * the right — so the band reads as a span of time rather than five identical boxes.
 * The artboard hand-writes five stops; this interpolates the same two ends so the ramp
 * survives paging (a column keeps its place in the ramp, not its colour).
 */
const DAY_TINT_FROM = [40, 72, 120] as const
const DAY_TINT_TO = [104, 52, 124] as const

const dayBackground = (slot: number, slots: number): string => {
  const t = slots > 1 ? slot / (slots - 1) : 0
  const [r, g, b] = DAY_TINT_FROM.map((from, i) => Math.round(from + (DAY_TINT_TO[i] - from) * t))
  return `rgba(${r}, ${g}, ${b}, 0.5)`
}

/** Today is the one column that is not part of the ramp. */
const TODAY_BACKGROUND = 'linear-gradient(160deg, rgba(60,80,150,.7), rgba(128,52,128,.7))'

/**
 * One capsule inside a day column.
 *
 * Store art 404s often enough to matter — delisted apps, art swapped mid-sale — so a
 * failure falls back to the name rather than a broken-image glyph, the same way
 * Tile.tsx does.
 */
const Capsule = ({
  game,
  dimmed,
  badge,
}: {
  game: CalendarGame
  dimmed: boolean
  badge?: string
}) => {
  const [artFailed, setArtFailed] = useState(false)
  // Height comes from the column's fixed height (flex-1 share), NOT from the art's
  // aspect ratio — that is what let a widening column grow taller.
  const artClass = 'block h-full w-full rounded-sm object-cover'
  const opacity = dimmed ? 0.45 : 1

  return (
    <div className="relative min-h-0 w-full flex-1">
      {artFailed ? (
        <div
          className={`${artClass} flex items-center justify-center bg-surface-raised px-2 text-center text-sm leading-tight text-ink-3/50`}
          style={{ opacity }}
        >
          {game.name}
        </div>
      ) : (
        <img
          src={game.capsuleUrl}
          alt={game.name}
          loading="lazy"
          draggable={false}
          onError={() => setArtFailed(true)}
          className={artClass}
          style={{ opacity }}
        />
      )}
      {/* The badge sits at full strength on top of the dimmed capsule — dimming the
          count with the art is what makes it unreadable at couch distance. */}
      {badge !== undefined && (
        <span className="absolute bottom-2.5 left-1/2 -translate-x-1/2 rounded-sm bg-scrim px-3.5 py-1.75 text-base font-semibold text-ink-2">
          {badge}
        </span>
      )}
    </div>
  )
}

/**
 * "Your Personal Calendar" — the fifth shelf (design 5c).
 *
 * Pure: no fetching, no global state, no focus of its own. `focusedDay` and
 * `windowStart` come from whoever owns navigation, which keeps LT/RT paging and the
 * dpad in one place instead of split across a component boundary.
 *
 * ⚠️ Nothing here clips, deliberately. The focused column's ring is a layered
 * box-shadow (`outline-none` sets outline-STYLE to none and the width/colour
 * utilities never bring it back), and a box-shadow takes no layout space — an
 * `overflow-hidden` anywhere up this tree would slice it into the hard grey rectangle
 * described in Shelf.tsx. If this ever needs to clip, bring the
 * negative-margin/padding escape hatch with it.
 */
export const CalendarBand = ({
  days,
  focusedDay,
  windowStart,
  expandedDay,
  onOpenDay,
  onActivate,
}: Props) => {
  const lastStart = Math.max(0, days.length - VISIBLE_DAYS)
  const start = Math.min(Math.max(0, windowStart), lastStart)
  const visible = days.slice(start, start + VISIBLE_DAYS)
  const anyOpen = expandedDay !== null

  const chevron = (enabled: boolean): string =>
    `w-9.5 shrink-0 overflow-hidden self-center text-center text-4xl font-bold leading-none ${
      enabled ? 'text-ink-2/45' : 'text-ink-2/15'
    }`

  return (
    <section className="flex shrink-0 flex-col gap-7">
      {/* px-14 is the page's side margin, carried on the HEADING rather than by an
          ancestor — the same rule `Shelf` follows, and for the same reason: the band
          below deliberately runs edge to edge, so an ancestor with padding would pull
          it back in. Without this the calendar title sat flush against the screen edge
          while every section heading under it was inset, which read as a broken row
          rather than as a hero. */}
      <header className="flex flex-col gap-2.5 px-14">
        <div className="flex items-center gap-3.5">
          <span className="rounded-sm bg-focus-deep px-3 py-1.5 text-sm font-extrabold leading-none tracking-[0.08em] text-ink">
            NEW
          </span>
          <h2 className="text-display font-extrabold leading-none text-ink">
            Your Personal Calendar
          </h2>
        </div>
        <p className="text-xl leading-none text-ink-2/72">
          A personalized-for-you list of new and upcoming games
        </p>
      </header>

      {/*
        ⚠️ The gap and the chevrons must collapse too. Zeroing the other columns'
        flex-grow gets them to 0px wide, but flex GAPS remain between zero-width items
        and a faded chevron still occupies its box — measured 72px dead on the left and
        158px on the right, which is why the panel never reached the edges.
      */}
      <motion.div
        initial={false}
        animate={{ gap: anyOpen ? '0rem' : '1rem' }}
        transition={BOX_TRANSITION}
        className="flex items-stretch"
      >
        <motion.span
          aria-hidden
          initial={false}
          animate={{ opacity: anyOpen ? 0 : 1, width: anyOpen ? '0rem' : '2.375rem' }}
          transition={BOX_TRANSITION}
          className={chevron(start > 0)}
        >
          ‹
        </motion.span>

        {visible.map((day, slot) => {
          const dayIndex = start + slot
          const isOpen = expandedDay === dayIndex
          const shrinking = anyOpen && !isOpen
          const shown = day.games.slice(0, CAPSULES_PER_DAY)
          const overflow = day.games.length - CAPSULES_PER_DAY
          const focused = !anyOpen && focusedDay !== null && focusedDay === dayIndex

          return (
            <motion.div
              key={day.key}
              /*
               * ⚠️ Only the BOX animates — flex-grow, not a transform.
               *
               * The previous version used Motion's shared-layout projection
               * (`layoutId`), which morphs boxes by scaling the element AND everything
               * inside it. That visibly stretched the artwork for the length of the
               * transition before snapping back. Animating flex-grow makes the browser
               * genuinely re-lay-out each frame, so children keep their true
               * proportions and the art never distorts.
               */
              /*
               * `initial={false}` makes Motion paint the animate values on the FIRST
               * render instead of animating into them. Without it the column starts
               * with no flex-grow at all — and since flex-basis is 0, that is a column
               * of zero width until the first frame runs.
               */
              initial={false}
              animate={{
                flexGrow: shrinking ? 0.0001 : 1,
                opacity: shrinking ? 0 : 1,
              }}
              transition={BOX_TRANSITION}
              style={{
                flexBasis: 0,
                minWidth: 0,
                background: day.isToday ? TODAY_BACKGROUND : dayBackground(slot, visible.length),
              }}
              className={[
                'flex flex-col rounded-lg text-left',
                // Clipping is safe ONLY on the columns collapsing away: they cannot
                // hold focus, so there is no ring here to be sliced off.
                shrinking ? 'overflow-hidden' : '',
                focused ? 'relative z-10 ring-tile' : '',
              ].join(' ')}
            >
              <div className="flex min-w-0 flex-col gap-3.5 p-4.5">
                <div
                  className={`flex items-baseline gap-2 whitespace-nowrap text-lg font-bold tracking-widest ${
                    isOpen ? 'justify-start' : 'justify-center'
                  } ${day.isToday ? 'text-ink' : 'text-ink-3/70'}`}
                >
                  <span>{day.label}</span>
                  {/* Today carries the word and no date — the design's one asymmetry. */}
                  {day.date !== '' && <span className="text-xl font-extrabold">{day.date}</span>}
                  {isOpen && (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-base font-semibold tracking-normal text-ink-3/50"
                    >
                      {day.games.length} {day.games.length === 1 ? 'release' : 'releases'}
                    </motion.span>
                  )}
                </div>

                {/*
                Both states occupy the SAME grid cell so they overlap and cross-fade in
                place. This is the second of the two animations: the box stretches, and
                independently the old artwork fades out while the new fades in.
              */}
                {/*
                ⚠️ `grid-rows-[minmax(0,1fr)]` is load-bearing, not decoration. `h-109`
                sets the CONTAINER's height, but the single row is still auto-sized, so
                the poster row's content grew the row to 3349px and the children's
                `h-full` then resolved against THAT — a focus ring 3285px tall trailing
                down the page. Pinning the row to the container's height is what makes
                `h-full` mean 581. Same fix as grid-cols on the horizontal axis.

                Fixed height, so opening a day changes the column's WIDTH and
                nothing else. Without it the cell takes the taller of the two states —
                and the collapsed capsules are aspect-ratio'd, so at full width they
                grow enormous and drag the whole row down with them.

                27.25rem is not arbitrary: it is exactly what three capsules need at
                their true 460:215 ratio. The layout is identical in rem at every
                width (1rem = 0.8333vw, so the viewport is always 120rem), so this
                holds from 1440p to 4K. Pinning it any taller stretches the capsules
                and crops the art; any shorter squashes them.
              */}
                <div className="grid h-109 min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">
                  <motion.button
                    type="button"
                    onClick={() => onOpenDay(dayIndex)}
                    animate={{ opacity: isOpen ? 0 : 1 }}
                    transition={CONTENT_OUT}
                    style={{ pointerEvents: isOpen ? 'none' : 'auto' }}
                    className="col-start-1 row-start-1 flex h-full min-h-0 min-w-0 flex-col gap-3.5 text-left outline-none"
                  >
                    {shown.map((game, index) => {
                      const isLast = index === CAPSULES_PER_DAY - 1
                      return (
                        <Capsule
                          key={game.appid}
                          game={game}
                          dimmed={isLast && overflow > 0}
                          badge={isLast && overflow > 0 ? `+${overflow} More` : undefined}
                        />
                      )
                    })}

                    {/* Not in the artboard, which assumes a full week. Anonymous data
                      leaves real gaps, and an empty column with no explanation reads
                      as a bug rather than as an empty day. */}
                    {shown.length === 0 && (
                      <span className="py-2 text-center text-base text-ink-3/40">No releases</span>
                    )}
                  </motion.button>

                  {isOpen && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={CONTENT_IN}
                      className="col-start-1 row-start-1 h-full min-h-0 min-w-0"
                    >
                      <PosterRow day={day} focusedIndex={focusedDay ?? 0} onActivate={onActivate} />
                    </motion.div>
                  )}
                </div>
              </div>
            </motion.div>
          )
        })}

        <motion.span
          aria-hidden
          initial={false}
          animate={{ opacity: anyOpen ? 0 : 1, width: anyOpen ? '0rem' : '2.375rem' }}
          transition={BOX_TRANSITION}
          className={chevron(start < lastStart)}
        >
          ›
        </motion.span>
      </motion.div>

      {/* Kept in the layout while a day is open, just faded: unmounting them made the
          whole row 47px shorter, and the row is supposed to change width only. */}
      {days.length > VISIBLE_DAYS && (
        <motion.div
          className="flex justify-center gap-2"
          animate={{ opacity: anyOpen ? 0 : 1 }}
          transition={BOX_TRANSITION}
        >
          {Array.from({ length: lastStart + 1 }, (_, page) => (
            <span
              key={page}
              className={`h-1.75 rounded-sm ${
                page === start ? 'w-7.5 bg-ink' : 'w-2.25 bg-ink/30'
              }`}
            />
          ))}
        </motion.div>
      )}
    </section>
  )
}

/**
 * The bottom row of the calendar screen, rendered as its own stack child rather than
 * inside the band.
 *
 * ⚠️ No owned badge here, unlike the shelf and the tag grid. These two cards are
 * hand-rolled rather than `StoreCard`s, so a badge would mean drawing a second copy of
 * it — and the poster row above is a RELEASE calendar, where nothing can be owned yet.
 * The recommendation row is a real if small gap; the fix is porting these to
 * `StoreCard`, not duplicating the badge.
 *
 * ⚠️ Not cosmetic. The home screen scrolls by measuring each stack child's `offsetTop`,
 * so anything nested INSIDE the band shares the band's offset and can never be
 * scrolled to. Nested, these cards sat below the fold with no way to reach them —
 * which is exactly what "I can't arrow down below the personal calendar" was.
 */
export const CalendarRecommended = ({
  games,
  focusedIndex,
  onActivate,
}: {
  games: CalendarGame[]
  /** Index of the focused card, or null when this row does not have focus. */
  focusedIndex: number | null
  onActivate: (appid: number) => void
}) => (
  <section
    className={`flex shrink-0 flex-col gap-3 ${focusedIndex !== null ? 'relative z-10' : ''}`}
  >
    <h3 className="text-2xl font-bold text-ink">Recommended Based on the Games You Play</h3>
    {/* Room for the focus ring inside the clip, same escape hatch as Shelf. */}
    <div className="-mx-6 -my-8 overflow-hidden px-6 py-8">
      <div className="flex gap-4.5">
        {games.map((game, index) => (
          <RecommendedCard
            key={game.appid}
            game={game}
            focused={focusedIndex === index}
            onActivate={onActivate}
          />
        ))}
      </div>
    </div>
  </section>
)

/**
 * A card in the bottom row: art, then name and price on one line.
 *
 * ⚠️ The clip lives on an INNER wrapper, not on the button. An earlier revision put
 * `overflow-hidden` on the button itself, which was safe only while the card could
 * never be focused; now that it can, a ring on a clipping element gets shaved into a
 * hard rectangle. The button rounds nothing and carries the ring; the wrapper inside
 * it does the rounding.
 */
const RecommendedCard = ({
  game,
  focused,
  onActivate,
}: {
  game: CalendarGame
  focused: boolean
  onActivate: (appid: number) => void
}) => {
  const [artFailed, setArtFailed] = useState(false)

  return (
    <button
      type="button"
      onClick={() => onActivate(game.appid)}
      className={[
        'relative min-w-0 flex-1 rounded-lg text-left outline-none transition-opacity duration-200',
        focused ? 'z-10 ring-tile' : 'opacity-70',
      ].join(' ')}
    >
      <div className="overflow-hidden rounded-lg bg-panel">
        {artFailed ? (
          <div className="flex aspect-header w-full items-center justify-center bg-surface-raised px-2 text-center text-sm leading-tight text-ink-3/50">
            {game.name}
          </div>
        ) : (
          <img
            src={game.capsuleUrl}
            alt={game.name}
            loading="lazy"
            draggable={false}
            onError={() => setArtFailed(true)}
            className="block aspect-header h-auto w-full object-cover"
          />
        )}
        <div className="flex items-center gap-2.5 px-3.25 py-2.5">
          <span className="min-w-0 flex-1 truncate text-base font-semibold leading-[1.2] text-ink-2">
            {game.name}
          </span>
          {game.price !== '' && (
            <span className="text-base font-bold tabular-nums text-ink">{game.price}</span>
          )}
        </div>
      </div>
    </button>
  )
}

/**
 * The contents of an opened-out day: one horizontally scrolling row of posters.
 *
 * Posters are Steam's `library_capsule_2x` (600x900). Not every app ships one, so each
 * card falls back to the landscape header rather than showing a gap.
 */
const PosterRow = ({
  day,
  focusedIndex,
  onActivate,
}: {
  day: CalendarDay
  focusedIndex: number
  onActivate: (appid: number) => void
}) => {
  const trackRef = useRef<HTMLDivElement>(null)
  const x = useSpring(0, SHELF_SPRING)

  useLayoutEffect(() => {
    const track = trackRef.current
    const card = track?.children[focusedIndex] as HTMLElement | undefined
    if (!track || !card) return
    const maxOffset = Math.max(0, track.scrollWidth - track.clientWidth)
    x.set(-Math.min(Math.max(0, card.offsetLeft), maxOffset))
  }, [focusedIndex, day.games.length, x])

  return (
    // Escape hatch again: the row clips in order to scroll, and the focused poster's
    // ring would be shaved off at the clip edge without room to breathe.
    // ⚠️ px-9 against -mx-6 is deliberate asymmetry, not a typo. When the two cancel,
    // the first poster sits flush on the column's content edge and its ring all but
    // touches the panel border. The extra 0.75rem insets the CARDS while the negative
    // margin keeps the CLIP boundary outside them, so the ring still has room.
    <div className="-mx-6 -my-6 h-full overflow-hidden px-9 py-6">
      <motion.div ref={trackRef} className="flex h-full gap-4 will-change-transform" style={{ x }}>
        {day.games.map((game, index) => (
          <Poster
            key={`${game.appid}-${index}`}
            game={game}
            focused={focusedIndex === index}
            onActivate={onActivate}
          />
        ))}
      </motion.div>
    </div>
  )
}

/**
 * One release as a portrait poster with an info box beneath — a movie-poster shape,
 * which is what a day of releases reads as at couch distance.
 */
const Poster = ({
  game,
  focused,
  onActivate,
}: {
  game: CalendarGame
  focused: boolean
  onActivate: (appid: number) => void
}) => {
  const [artFailed, setArtFailed] = useState(false)
  const portrait = game.portraitUrl !== undefined && !artFailed

  return (
    <button
      type="button"
      onClick={() => onActivate(game.appid)}
      className={[
        // No width: the card is as wide as its poster, and the poster's width is
        // derived from the row's fixed height. That keeps the movie-poster ratio
        // instead of cropping it to fit a width we picked.
        'relative flex h-full shrink-0 flex-col rounded-lg text-left outline-none transition-opacity duration-200',
        // ⚠️ ONE layer here, unlike the shelf tiles. Their ring is dark-gap-then-blue so
        // the blue never sits on artwork — which works because a tile's art bleeds to
        // its edge. A poster is a light object as often as a dark one, and on light art
        // that dark layer reads as a heavy black picture frame while vanishing entirely
        // on dark art, so the same control looked like two different things.
        focused ? 'z-10 shadow-[0_0_0_0.3125rem_var(--color-focus)]' : 'opacity-65',
      ].join(' ')}
    >
      <div className="flex h-full flex-col overflow-hidden rounded-lg bg-panel">
        <img
          src={portrait ? game.portraitUrl : game.capsuleUrl}
          alt={game.name}
          loading="lazy"
          draggable={false}
          onError={() => setArtFailed(true)}
          // 2:3 when a real poster exists; the landscape fallback keeps its own ratio
          // inside the same box rather than being stretched into portrait.
          // EXPLICIT height, then aspect-ratio derives the width from it. `flex-1`
          // does not work here: a flexed height is resolved too late for
          // aspect-ratio to size the width, and the poster ends up square-ish.
          //
          // ⚠️ 20rem is chosen against the row's fixed height, not picked freely: the
          // card gets ~517px and the info box below needs ~89px for its two lines, so
          // anything taller crushes the caption instead of the poster.
          className={[
            'block h-80 w-auto shrink-0 aspect-poster',
            portrait ? 'object-cover' : 'bg-surface-raised object-contain',
          ].join(' ')}
        />
        <div className="flex flex-col gap-1 px-3 py-2.5">
          <span className="truncate text-base font-semibold leading-tight text-ink-2">
            {game.name}
          </span>
          <span className="text-sm font-bold tabular-nums text-ink">
            {game.price !== '' ? game.price : 'Coming Soon'}
          </span>
        </div>
      </div>
    </button>
  )
}

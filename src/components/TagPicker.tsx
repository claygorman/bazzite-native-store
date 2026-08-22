import { motion } from 'motion/react'
import { Prompt } from './ButtonLegend'
import { formatPrice, DECK_COMPAT_LABEL, type DeckCompat } from '../types/steam'
import type { StoreTagInfo } from '../platform/tagBrowse'
import { PREVIEW_SAMPLE, type TagPreview } from '../hooks/useTagBrowse'
import type { InputSource } from '../platform/glyphs'
import { SHELF_SPRING } from '../platform/motion'

/** 4 x 4 — the design's "16 tags to a group". */
export const TAG_GRID_COLS = 4
export const TAG_GRID_SIZE = 16

/** Which half of the screen holds focus. The tabs are reachable with Up from row 0. */
export type TagZone = 'tabs' | 'grid'

type Props = {
  groups: ReadonlyArray<{ label: string; tags: StoreTagInfo[] }>
  groupIndex: number
  tagIndex: number
  zone: TagZone
  totalTagCount: number
  preview: TagPreview
  source: InputSource
  onActivate: (tag: StoreTagInfo) => void
}

/**
 * Browse by tag — design 7a.
 *
 * ⚠️ Three things the artboard draws that are deliberately absent, all for the same
 * reason: there is no anonymous source and inventing one would be a lie on a television.
 *
 * - "41 pulled from your library" and "18 on your wishlist" — both session-gated. The
 *   tag count beside them IS real and is read from `GetTagList`, never hardcoded; it was
 *   446 the day this was written and the design says 412, which is exactly why.
 * - `Y PIN TAG` in the tray. Y is the global search shortcut everywhere else in this
 *   app, and rebinding it per screen is how a controller UI becomes unlearnable.
 *   Pinning itself is deferred rather than moved.
 */
export const TagPicker = ({
  groups,
  groupIndex,
  tagIndex,
  zone,
  totalTagCount,
  preview,
  source,
  onActivate,
}: Props) => {
  const group = groups[groupIndex]
  const tags = group?.tags ?? []
  const focused = tags[tagIndex]

  /*
   * ⚠️ The tagid comparison is the load-bearing half, not `loading`.
   *
   * Moving focus changes `focused` during render; the effect that flips `loading` runs
   * after that commit. So for one frame the pane would hold the previous tag's count,
   * its Bazzite split and its game list under the new tag's name — every number wrong,
   * and nothing on screen saying so. Requiring the preview to name the tag it belongs
   * to makes that state unrenderable rather than merely unlikely.
   */
  const ready =
    focused !== undefined && preview.tagid === focused.tagid && !preview.loading

  return (
    <div className="absolute inset-x-0 bottom-18.5 top-0 flex flex-col gap-6 px-14 py-11">
      <header className="flex shrink-0 items-baseline gap-4.5">
        <h1 className="text-display font-extrabold tracking-display text-ink">Browse by Tag</h1>
        {totalTagCount > 0 && (
          <span className="text-lg font-medium text-ink-faint">
            {totalTagCount.toLocaleString()} tags
          </span>
        )}
      </header>

      {/* Group tabs. LB/RB from anywhere, or Up out of the grid's top row and then
          left/right — the same two ways the home screen's menu bar is reached. */}
      <div className="flex shrink-0 items-center gap-3.5">
        <Prompt action="shelfPrev" source={source} />
        {/* ⚠️ `p-1.75 -m-1.75` — 0.4375rem, exactly `card-ring`'s outline width plus its
            offset. This row clips (the tab strip can overflow), and an outline is painted
            OUTSIDE the border box, so without the padding the focused pill's ring is cut
            off on three sides and shows as a stray line. Same rule as Shelf.tsx: nothing
            painted on an element may exceed its clip container's padding. */}
        <div className="-m-1.75 flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden p-1.75">
          {groups.map((g, i) => (
            <span
              key={g.label}
              className={[
                'shrink-0 rounded-full px-5 py-2.5 text-lg font-bold whitespace-nowrap transition-colors duration-150',
                i === groupIndex ? 'bg-focus text-ink-on-accent' : 'bg-chip text-ink-mute',
                // Selected and focused are different states: the pill stays blue while
                // you are down in the grid, so the ring is what says "you are here".
                i === groupIndex && zone === 'tabs' ? 'card-ring' : 'card-ring-off',
              ].join(' ')}
            >
              {g.label}
            </span>
          ))}
        </div>
        <Prompt action="shelfNext" source={source} />
      </div>

      <div className="flex min-h-0 flex-1 gap-8.5">
        {/* Tag grid */}
        <div className="grid min-h-0 w-170 shrink-0 grid-cols-4 content-start gap-3">
          {tags.map((tag, i) => (
            <motion.button
              key={tag.tagid}
              type="button"
              onClick={() => onActivate(tag)}
              initial={false}
              animate={{ opacity: i === tagIndex ? 1 : 0.72 }}
              transition={SHELF_SPRING}
              className={[
                'flex h-19 items-center justify-center rounded-lg px-3 text-center',
                'text-lg font-bold leading-tight',
                i === tagIndex ? 'z-10 bg-plate text-ink' : 'bg-chip-soft text-ink-mute',
                // Only one ring on screen at a time. The plate stays lit while focus is
                // up on the tabs, so the way back is still visible without competing.
                i === tagIndex && zone === 'grid' ? 'card-ring' : 'card-ring-off',
              ].join(' ')}
            >
              <span className="line-clamp-2">{tag.name}</span>
            </motion.button>
          ))}
        </div>

        {/* Focused tag preview */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5">
          {focused !== undefined && (
            <>
              <div className="flex flex-col gap-1.5">
                {/* The name is the one thing known instantly, so it never skeletons —
                    the heading changing is what tells you the press registered. */}
                <h2 className="truncate text-3xl font-bold text-ink">{focused.name}</h2>
                <span className="flex h-7 items-center text-lg font-medium leading-7 text-ink-faint">
                  {/*
                    ⚠️ This number and the results screen's header come from the SAME
                    query (see DEFAULT_TAG_SORT). Steam applies each sort as a filter, so
                    asking a different way would promise 13,912 here and deliver 5,214 on
                    press.
                  */}
                  {ready ? `${preview.total.toLocaleString()} games` : <Bar className="h-3.5 w-36" />}
                </span>
              </div>

              <BazziteSplit preview={preview} ready={ready} />

              <div className="flex min-h-0 flex-col gap-3">
                <Heading>Most reviewed in this tag</Heading>
                <div className="flex flex-col gap-2">
                  {ready
                    ? preview.top.map((game) => (
                        <div key={game.appid} className="flex h-7 items-center gap-3.5">
                          <span className="min-w-0 flex-1 truncate text-lg font-semibold leading-7 text-ink-2">
                            {game.name}
                          </span>
                          {game.deckCompat !== undefined && game.deckCompat !== 'unknown' && (
                            <span className="shrink-0 text-base font-semibold leading-7 text-ink-faint">
                              {DECK_COMPAT_LABEL[game.deckCompat]}
                            </span>
                          )}
                          <span className="shrink-0 text-lg font-bold leading-7 tabular-nums text-ink">
                            {/* Coming Soon first: an unreleased free-to-play app is
                                `is_free` AND `is_coming_soon`, and formatPrice(0) would
                                advertise it as playable today. */}
                            {game.comingSoon
                              ? 'Coming Soon'
                              : formatPrice(game.finalPriceCents, game.currency)}
                          </span>
                        </div>
                      ))
                    : NAME_WIDTHS.map((width, i) => (
                        <div key={i} className="flex h-7 items-center gap-3.5">
                          <Bar className={`h-3.5 ${width}`} />
                          <Bar className="ml-auto h-3.5 w-16" />
                        </div>
                      ))}
                </div>
              </div>

              <div className="mt-auto flex h-8 items-center gap-3">
                <Prompt action="accept" source={source} />
                {/*
                  No number until there is one. A skeleton bar mid-sentence reads as a
                  redaction at couch distance, and "Browse this tag" is both shorter and
                  true — A does the same thing either way, so the prompt stays live.
                */}
                <span className="text-xl font-bold leading-8 text-ink">
                  {ready ? `Browse ${preview.total.toLocaleString()} games` : 'Browse this tag'}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * One pulsing placeholder.
 *
 * ⚠️ Always inside a parent with the height of the real thing, never sized to reserve
 * that height itself. A bar the full height of a text line looks like a censored
 * document; a thin bar centred in the line box reads as "a number is coming" and, more
 * importantly, means nothing on the pane moves when it arrives.
 */
const Bar = ({ className }: { className: string }) => (
  <span className={`block animate-pulse rounded bg-chip ${className}`} />
)

/** Varied so six rows read as a list of titles rather than as a barcode. */
const NAME_WIDTHS = ['w-64', 'w-52', 'w-72', 'w-60', 'w-44', 'w-68'] as const

const Heading = ({ children }: { children: string }) => (
  <h3 className="text-sm font-bold uppercase leading-5 tracking-widest text-ink-faint">
    {children}
  </h3>
)

const SPLIT_COLOR: Record<DeckCompat, string> = {
  verified: 'var(--color-rating-up)',
  playable: 'var(--color-rating-dn)',
  unsupported: '#d0685f',
  unknown: 'transparent',
}

/**
 * "Runs on Bazzite" — Valve's Deck verdicts across a sample, said out loud.
 *
 * ⚠️ The caption is the load-bearing part, not the bars. The design draws this as a
 * property of the tag; it cannot be. ProtonDB has no aggregate endpoint — one HTTP
 * request per appid — so a real split over a 13,912-game tag is 13,912 requests against
 * roughly 200 per five minutes. This measures the 100 most-reviewed games in the tag,
 * using the Deck verdicts that arrive free with hydration, and says exactly that
 * underneath. Remove the caption and the chart becomes a claim it cannot support.
 *
 * ⚠️ Holds its full height while loading rather than returning null. Collapsing it
 * would drag the whole game list up and back down again on every tag you pass through,
 * and a pane that jumps twice per keypress is worse than one that waits.
 */
const BazziteSplit = ({ preview, ready }: { preview: TagPreview; ready: boolean }) => {
  if (ready && preview.sampled === 0) return null
  return (
    <div className="flex flex-col gap-2.5">
      <Heading>Runs on Bazzite</Heading>
      <div className={`flex h-3 overflow-hidden rounded-full bg-chip ${ready ? '' : 'animate-pulse'}`}>
        {ready &&
          preview.split.map((bar) => (
            <span
              key={bar.verdict}
              style={{
                width: `${(bar.count / preview.sampled) * 100}%`,
                background: SPLIT_COLOR[bar.verdict],
              }}
            />
          ))}
      </div>
      <div className="flex h-6 flex-wrap items-center gap-x-5 gap-y-1">
        {ready
          ? preview.split.map((bar) => (
              <span
                key={bar.verdict}
                className="flex items-center gap-2 text-base font-semibold leading-6 text-ink-mute"
              >
                <span
                  className="size-3 rounded-full"
                  style={{ background: SPLIT_COLOR[bar.verdict] }}
                />
                {DECK_COMPAT_LABEL[bar.verdict]} {Math.round((bar.count / preview.sampled) * 100)}%
              </span>
            ))
          : ['w-32', 'w-32', 'w-36'].map((width, i) => <Bar key={i} className={`h-3.5 ${width}`} />)}
      </div>
      {/*
        ⚠️ Word this precisely. "of the 90 most-reviewed games" would be wrong: the
        sample is this tag's 100 most-reviewed, and 90 is how many of THOSE Valve has
        given a Deck verdict. The other 10 are unrated, not less popular. Getting that
        backwards states a fact about a set that was never measured.
      */}
      <span className="flex h-5 items-center text-sm font-medium leading-5 text-ink-faint">
        {ready ? (
          `${preview.sampled} of this tag’s ${PREVIEW_SAMPLE} most-reviewed games have a Deck verdict`
        ) : (
          <Bar className="h-3 w-96" />
        )}
      </span>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { searchApps } from '../platform/steam'
import { glyphFor, type InputSource } from '../platform/glyphs'
import { formatPrice, type StoreItem } from '../types/steam'
import { StoreCard } from './StoreCard'
import { useOwned } from '../hooks/useSteamLibrary'

/** Design 5b's keyboard. The final row is actions, not characters. */
const KEY_ROWS = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'] as const
const ACTION_ROW = ['SPACE', '⌫', 'Search'] as const
const ACTION_ROW_INDEX = KEY_ROWS.length

export type SearchFocus = { row: number; col: number }

export const rowLength = (row: number): number =>
  row === ACTION_ROW_INDEX ? ACTION_ROW.length : (KEY_ROWS[row]?.length ?? 0)

/** Character (or action) at a focus position. */
export const keyAt = (focus: SearchFocus): string =>
  focus.row === ACTION_ROW_INDEX
    ? (ACTION_ROW[focus.col] ?? '')
    : (KEY_ROWS[focus.row]?.[focus.col] ?? '')

type Props = {
  query: string
  focus: SearchFocus
  onResults: (items: StoreItem[]) => void
  results: StoreItem[]
  /** Index of the focused result, or null when focus is on the keyboard. */
  resultFocus: number | null
  source: InputSource
}

/**
 * Search with an on-screen keyboard (design 5b).
 *
 * Results update as you type rather than on submit — on a controller, "type then
 * find the Search key and press it" is two extra interactions for something the
 * network can just do. The Search key stays in the layout because the design has it
 * and it gives a deliberate way to re-run a query.
 *
 * The query is debounced: every keystroke is a network request otherwise, and Steam
 * rate-limits to roughly 200 requests / 5 min per IP.
 */
export const SearchView = ({ query, focus, onResults, results, resultFocus, source }: Props) => {
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (query.trim().length === 0) {
      onResults([])
      return
    }

    let cancelled = false
    setSearching(true)
    const timer = setTimeout(() => {
      searchApps(query)
        .then((items) => {
          if (!cancelled) onResults(items)
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 350)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // onResults is stable (useCallback in App); depending on it would re-fire the
    // search on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const cell = (active: boolean, extra = '') =>
    [
      'grid place-items-center rounded-lg transition-[background-color,box-shadow] duration-150',
      active ? 'relative z-10 bg-chip-strong ring-flat' : 'bg-chip',
      extra,
    ].join(' ')

  return (
    <div className="absolute inset-x-0 bottom-18.5 top-0 flex gap-8.5 px-14 py-11">
      {/* Left: query + keyboard */}
      <div className="flex w-190 shrink-0 flex-col justify-between gap-5.5">
        {/*
          Ringed only while the keyboard zone has focus. It used to ring
          unconditionally, so moving into the results left TWO things looking
          focused at once — and "which of these is selected?" is exactly the
          question a focus ring exists to answer.
        */}
        <div
          className={[
            'relative z-10 flex h-22.5 items-center gap-4 rounded-lg',
            'bg-chip px-6.5 transition-shadow',
            resultFocus === null ? 'ring-tile' : '',
          ].join(' ')}
        >
          <span className="truncate text-3xl font-semibold text-ink">{query}</span>
          {resultFocus === null && (
            <span className="h-9 w-0.75 shrink-0 animate-pulse rounded-sm bg-ink" />
          )}
        </div>

        <div className="flex flex-col gap-2.75">
          {KEY_ROWS.map((row, rowIndex) => (
            <div key={row} className="flex gap-2.75">
              {[...row].map((char, colIndex) => (
                <div
                  key={char}
                  className={cell(
                    resultFocus === null && focus.row === rowIndex && focus.col === colIndex,
                    'h-23 flex-1 text-3xl font-semibold text-ink-2',
                  )}
                >
                  {char}
                </div>
              ))}
            </div>
          ))}

          <div className="flex gap-2.75">
            {ACTION_ROW.map((label, colIndex) => {
              const active =
                resultFocus === null && focus.row === ACTION_ROW_INDEX && focus.col === colIndex
              const isSubmit = label === 'Search'
              // ⌫ is a glyph, not a word — at 20px it reads as a smudge from the
              // couch, so the design gives it 24px while the words stay at 20px.
              const isBackspace = label === '⌫'
              return (
                <div
                  key={label}
                  className={[
                    'grid h-23 place-items-center rounded-lg font-semibold transition-[background-color,box-shadow] duration-150',
                    isBackspace ? 'text-2xl' : 'text-xl',
                    colIndex === 0 ? 'flex-[2]' : 'flex-1',
                    isSubmit
                      ? 'bg-gradient-to-br from-focus to-focus-deep font-bold text-ink-on-accent'
                      : 'bg-chip text-ink-2/80',
                    active ? 'relative z-10 ring-flat' : '',
                  ].join(' ')}
                >
                  {label}
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex gap-3 text-base font-semibold text-ink-3/60">
          {(source === 'keyboard'
            ? [
                // With capture active the letter bindings are typing, so advertising
                // "Q / E jump rows" would be a lie on a keyboard.
                'Just type',
                'Backspace deletes',
                `${glyphFor('back', source).label} goes back`,
              ]
            : [
                `${glyphFor('shelfPrev', source).label} / ${glyphFor('shelfNext', source).label} jump rows`,
                `${glyphFor('secondary', source).label} deletes`,
                `${glyphFor('back', source).label} goes back`,
              ]
          ).map((hint) => (
            <span key={hint} className="rounded-full bg-chip px-4 py-2.5">
              {hint}
            </span>
          ))}
        </div>
      </div>

      {/* Right: results */}
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-3.5">
        <div className="flex items-baseline gap-3.5">
          <span className="text-2xl font-bold text-ink-2">
            {query.trim().length === 0
              ? 'Type to search'
              : `${results.length} result${results.length === 1 ? '' : 's'}`}
          </span>
          <span className="text-base font-medium text-ink-3/50">
            {searching ? 'searching…' : 'updating as you type'}
          </span>
        </div>

        {/* -mx/-my + matching padding so a focused row's ring is not shaved off by
            the clip. The ring reaches 0.1875rem; p-2 is 0.5rem and both are rem, so
            they stay in proportion at 4K. */}
        <div className="-mx-2 -my-2 flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-2">
          {results.map((item, index) => (
            <SearchResult key={item.appid} item={item} focused={resultFocus === index} />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * One search result.
 *
 * ⚠️ A component rather than JSX inside the `.map` above, and that is not style: `useOwned`
 * is a hook, and hooks cannot be called in a loop. Every card surface that wants the
 * owned badge needs its own component for exactly this reason.
 */
const SearchResult = ({ item, focused }: { item: StoreItem; focused: boolean }) => {
  const owned = useOwned(item.appid)
  return (
    <StoreCard
      /*
        No width — a result fills the results column, so the card takes its size from
        the list rather than the list from the card.

        ⚠️ 22 x 10.25rem is 2.14:1, Steam's own 460x215 header ratio, and it is chosen
        against the height the caption actually resolves to. §5.5 forbids
        `object-contain`, so a panel of the wrong ratio does not letterbox — it crops,
        and on a header the thing in the middle is the game's logo. At the design's
        272-wide it cut "HADES" in half.
      */
      layout="side"
      surface="boxed"
      emphasis="large"
      artWidth={22}
      artHeight={10.25}
      title={item.name}
      art={item.headerUrl ?? item.capsuleUrl}
      price={item.comingSoon ? 'Coming Soon' : formatPrice(item.finalPriceCents, item.currency)}
      rating={item.comingSoon ? undefined : item.reviewPercent}
      deck={item.deckCompat}
      owned={owned}
      controllerSupport={item.controllerSupport === 'none' ? undefined : item.controllerSupport}
      attention={focused ? 'focused' : 'nearby'}
    />
  )
}

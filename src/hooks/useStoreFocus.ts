import { useCallback, useState } from 'react'
import type { InputAction } from '../platform/input'
import type { StoreRow } from '../types/steam'

export type Focus = { row: number; col: number }

const EMPTY_TRAILING: readonly number[] = []

/** Tiles a trigger press jumps — roughly the number visible at 1920. */
const PAGE_SIZE = 5

/**
 * Focus model for a grid of rows with differing lengths.
 *
 * Two deliberate behaviours:
 *
 * 1. No horizontal wrapping BY DEFAULT. Wrapping while a direction is held sends the
 *    focus ring flying back to the far end mid-scroll, which reads as a glitch on a
 *    TV. It is a setting because the opposite preference is just as reasonable on a
 *    short shelf — see `Wrap at shelf ends` on the Controller page.
 *
 * 2. Changing row RESETS the column to 0. Each shelf is an independent list, so
 *    carrying the column across means arriving at a shelf you have never seen with it
 *    already scrolled sideways — you land in the middle of content you skipped past.
 *    Starting every shelf at its first tile is what the Xbox dashboard does and it is
 *    what Clay asked for after using it.
 */
export const useStoreFocus = (
  rows: StoreRow[],
  /**
   * Column counts for rows that are NOT shelves of tiles — today, the calendar's day
   * band and its recommended row. They cannot be StoreRows, so rather than fake one
   * they are modelled as extra rows past the end, each naming its own width.
   */
  trailingRows: readonly number[] = EMPTY_TRAILING,
  /**
   * Column to land on when focus enters the FIRST trailing row. Rule 2 below resets
   * every shelf to its first tile, but "column 0" of a calendar is three days ago —
   * the natural start of a calendar is today.
   */
  trailingRowHomeColumn = 0,
  /** The Controller page's `Wrap at shelf ends`. Horizontal only; rows never wrap. */
  wrapAtEnds = false,
) => {
  const [focus, setFocus] = useState<Focus>({ row: 0, col: 0 })

  const move = useCallback(
    (action: InputAction): void => {
      if (rows.length === 0) return

      setFocus((current) => {
        const live = trailingRows.filter((n) => n > 0)
        const rowCount = rows.length + live.length
        const colCount = (r: number) =>
          r < rows.length ? (rows[r]?.items.length ?? 0) : (live[r - rows.length] ?? 0)

        switch (action) {
          case 'left':
          case 'right': {
            const width = colCount(current.row)
            if (width <= 0) return current
            const next = current.col + (action === 'left' ? -1 : 1)
            /*
             * ⚠️ Wrapping is horizontal only. Vertical wrap would jump between the
             * first and last shelf, which are visually a screen apart — the ring would
             * appear to teleport, and the stack scroll would fly past everything in
             * between.
             */
            if (wrapAtEnds) return { ...current, col: (next + width) % width }
            return { ...current, col: Math.min(width - 1, Math.max(0, next)) }
          }
          // Shoulders are an explicit shelf jump; the dpad reaches the same place
          // vertically. Both clamp rather than wrap.
          case 'up':
          case 'shelfPrev':
          case 'down':
          case 'shelfNext': {
            const back = action === 'up' || action === 'shelfPrev'
            const next = back ? current.row - 1 : current.row + 1
            if (next < 0 || next >= rowCount) return current
            // Only the FIRST trailing row has a meaningful home column (today);
            // anything past it starts at its first item like a shelf does.
            const landing = next === rows.length ? trailingRowHomeColumn : 0
            return { row: next, col: Math.min(landing, Math.max(0, colCount(next) - 1)) }
          }
          // Triggers page across a long shelf a screenful at a time.
          case 'pagePrev':
          case 'pageNext': {
            const delta = action === 'pageNext' ? PAGE_SIZE : -PAGE_SIZE
            return {
              ...current,
              col: Math.min(
                Math.max(0, current.col + delta),
                Math.max(0, colCount(current.row) - 1),
              ),
            }
          }
          default:
            return current
        }
      })
    },
    [rows, trailingRows, trailingRowHomeColumn, wrapAtEnds],
  )

  const focusItem = useCallback((next: Focus) => setFocus(next), [])

  const focusedItem = rows[focus.row]?.items[focus.col]

  return { focus, move, focusItem, focusedItem }
}

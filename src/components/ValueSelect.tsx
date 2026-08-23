import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * The client's one dropdown — design turn 10's control, shared.
 *
 * Closed it is a pill with a chevron. Open, a panel of every value hangs beneath it
 * with a check on the COMMITTED value and a ring on wherever the dpad currently is.
 *
 * ⚠️ Those two marks are separate on purpose, and it is the whole point of turn 10:
 * "moved to Gold, check stays on Silver". An earlier version applied every value as
 * you arrowed past it, so walking a five-item list fired four changes nobody asked
 * for — and on rows like Region and Request timeout each of those refetches.
 *
 * ⚠️ It lives here rather than inside `SettingsRow` because turn 11a's report filters
 * (Type / CPU / GPU / Distro) are the SAME control: identical open background
 * rgba(77,155,230,.24), identical open border rgba(77,155,230,.65), identical ▾/▴,
 * identical 2px cursor ring, identical check column. Two implementations of one
 * control drift, and this one carries behaviour — the cursor/committed split — that a
 * second copy would quietly lose.
 *
 * ⚠️ Rendered through a PORTAL, and it has to be. Both hosts sit inside scrolling or
 * clipping ancestors — the settings grid is `overflow-y-auto` — so a panel positioned
 * inside them is clipped exactly when it extends past the last row, which is the case
 * that needs it most. Portalling to `body` and positioning from the pill's measured
 * rect sidesteps every ancestor at once. Safe because the panel cannot outlive its
 * row: focus is captured while it is open, so nothing can scroll underneath it.
 */
export const ValueSelect = ({
  options,
  current,
  valueLabel,
  caption,
  focused,
  open,
  cursor,
  isDefault,
}: {
  options: ReadonlyArray<{ value: unknown; label: string }>
  /** The committed value — what the check sits on. */
  current: unknown
  /** Text on the closed pill. */
  valueLabel: string
  /**
   * Small uppercase label ABOVE the pill — 11a's filters have one ("Type", "GPU"),
   * settings rows do not because the row's own label already says what it is.
   */
  caption?: string
  focused: boolean
  open: boolean
  /**
   * Where the dpad sits while open. Absent means "wherever the value already is".
   *
   * ⚠️ NOT zero. Defaulting to the first option opens every list with the ring on the
   * top entry while the check sits somewhere else — two marks disagreeing about where
   * you are.
   */
  cursor?: number
  /**
   * Whether the current value is the neutral default.
   *
   * ⚠️ Only 11a uses this, and it is about a FILTER rather than a setting: a filter at
   * "Any" is doing nothing and should read as quiet, while one that has been set is
   * changing what you are looking at and should say so. A settings row has no such
   * state — it always has a value — so it simply omits this.
   */
  isDefault?: boolean
}) => {
  const at =
    cursor ??
    Math.max(
      0,
      options.findIndex((o) => o.value === current),
    )
  const pillRef = useRef<HTMLSpanElement>(null)
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setAnchor(null)
      return
    }
    const rect = pillRef.current?.getBoundingClientRect()
    if (rect) setAnchor({ left: rect.left, top: rect.bottom, width: rect.width })
  }, [open])

  // `isDefault === false` means a filter that has been SET. `undefined` means the host
  // has no opinion, which is the settings case.
  const set = isDefault === false

  return (
    <span className={caption === undefined ? 'contents' : 'flex flex-none flex-col gap-1.5'}>
      {caption !== undefined && (
        <span className="text-xs font-bold uppercase tracking-[0.12em] text-ink-3/40">
          {caption}
        </span>
      )}

      <span
        ref={pillRef}
        className={[
          'flex flex-none items-center gap-3.5 rounded-full border px-4.5 py-2.75',
          'text-lg font-semibold transition-colors duration-150',
          open
            ? 'border-focus/65 bg-focus/25 text-ink'
            : set
              ? 'border-focus/45 bg-focus/16 text-ink'
              : focused
                ? 'border-hairline bg-chip-strong text-ink'
                : 'border-transparent bg-chip-strong text-ink-2',
        ].join(' ')}
      >
        {valueLabel}
        <span className="text-sm text-ink-faint">{open ? '▴' : '▾'}</span>
      </span>

      {open &&
        anchor !== null &&
        createPortal(
          <div
            // 0.5rem below the pill, per the spec's `top: calc(100% + 8px)`.
            style={{ left: anchor.left, top: anchor.top + 8, minWidth: anchor.width }}
            className="fixed z-50 flex flex-col gap-0.5 rounded-xl border border-focus/40 bg-dropdown p-2 shadow-dropdown"
          >
            {options.map((option, index) => {
              const committed = option.value === current
              return (
                <span
                  key={String(option.value)}
                  className={[
                    'flex items-center gap-3 whitespace-nowrap rounded-md px-3.5 py-2.5',
                    'text-lg font-semibold',
                    index === at ? 'bg-focus/20 text-ink' : 'text-ink-2/72',
                    // ⚠️ Inset, so the ring is drawn inside the option's own box and
                    // cannot be shaved off by the panel's rounded corners.
                    index === at ? 'outline-2 -outline-offset-2 outline-focus' : '',
                  ].join(' ')}
                >
                  {/* The column is always present, so a check appearing does not shift
                      the label sideways. */}
                  <span className={`w-4 text-focus ${committed ? 'opacity-100' : 'opacity-0'}`}>
                    ✓
                  </span>
                  {option.label}
                </span>
              )
            })}
          </div>,
          document.body,
        )}
    </span>
  )
}

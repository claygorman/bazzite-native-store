import { useLayoutEffect, useRef, useState, type Ref } from 'react'
import { createPortal } from 'react-dom'
import type { SettingsRow as Row } from './pages'
import { labelFor, optionsFor, type Settings } from '../../platform/settings'

type Props = {
  row: Row
  settings: Settings
  /** Overrides a button's face where the action's verb depends on state. */
  actionLabel?: string
  focused: boolean
  /** A has opened this stepper's list. Only ever true on the focused row. */
  open?: boolean
  /**
   * Which option the dpad is sitting on while the list is open.
   *
   * ⚠️ Deliberately NOT the committed value. Turn 10 draws them apart — "moved to Gold,
   * check stays on Silver" — so moving the stick previews without changing anything and
   * B can still walk away. `settings[row.key]` remains the truth until A.
   */
  cursor?: number
  /** Set on the focused row so the column can scroll it into view. */
  elementRef?: Ref<HTMLButtonElement>
  onActivate: () => void
}

/**
 * One settings row.
 *
 * > Four controls, no more. Adding a fifth means the model got away from us.
 *
 * Toggle, stepper, button — and `value`, which is read-only and therefore belongs in
 * the status card rather than down here. Three kinds render below; the fourth has no
 * row form on purpose.
 *
 * ⚠️ There are no sliders, and that is a controller decision rather than a taste one:
 * a slider needs pixel aim, a stepper is one dpad press per value and shows where it
 * landed.
 *
 * ⚠️ Focus is a left bar plus a tint plus a glow, NOT the ring every other surface
 * uses. See the comment on the bar below for why the shape of a row changes what the
 * ring means.
 */
export const SettingsRow = ({
  row,
  settings,
  actionLabel,
  focused,
  open = false,
  cursor,
  elementRef,
  onActivate,
}: Props) => (
  <button
    ref={elementRef}
    type="button"
    onClick={onActivate}
    className={[
      // ⚠️ NOT `overflow-hidden`. It used to be, for the focus bar's square corners,
      // and that is what forced the value list to render inside the row. The bar rounds
      // its own left corners now — see DESIGN-PORT.md rule 7: never clip the parent to
      // tidy a child when another child has to paint outside it.
      'relative flex w-full gap-5 rounded-lg py-4.5 pl-6.5 pr-5.5 text-left',
      open ? 'items-start' : 'items-center',
      'transition-colors duration-150',
      focused ? 'bg-focus-wash shadow-focused-bare' : 'bg-plate',
    ].join(' ')}
  >
    {/*
      ⚠️ A left bar, not a ring, and this is a deliberate departure from the ideology
      doc's "same treatment as a focused store tile, so focus reads identically
      everywhere".

      It reads identically on a tile because a tile is a compact card and the ring
      hugs its artwork. A settings row is a 44rem-wide, 6rem-tall band, and the same
      ring around that shape stops being a highlight and becomes a drawn box — four
      long blue edges with nothing inside them to hold. The plate tint and the glow
      are doing the actual work at ten feet; the bar names the edge focus entered
      from, and it is the SAME bar the rail beside it already uses for "you are here",
      so this screen has one vocabulary rather than two.
    */}
    {/* `rounded-l-lg` matches the row's own radius, which is what the row's
        `overflow-hidden` used to do for it. Losing that clip is what lets the value
        list below escape the row and float. */}
    <span
      className={`absolute inset-y-0 left-0 w-1.5 rounded-l-lg bg-focus transition-opacity duration-150 ${
        focused ? 'opacity-100' : 'opacity-0'
      }`}
    />

    <span className="flex min-w-0 flex-1 flex-col gap-1.75">
      <span
        className={`text-xl font-semibold leading-tight ${focused ? 'text-ink' : 'text-ink-soft'}`}
      >
        {row.label}
      </span>
      {/* The description IS the documentation — there is no help page behind it. */}
      <span className="text-base font-medium leading-snug text-ink-faint">{row.desc}</span>
    </span>

    {row.kind === 'toggle' && <Toggle on={settings[row.key]} />}

    {row.kind === 'stepper' && (
      <ValueSelect
        options={optionsFor(row.key)}
        current={settings[row.key]}
        label={labelFor(row.key, settings[row.key] as never)}
        focused={focused}
        open={open}
        cursor={cursor}
      />
    )}

    {row.kind === 'button' && (
      <span className="flex flex-none items-center rounded-full border border-hairline bg-chip-strong px-5 py-3 text-lg font-semibold text-ink">
        {actionLabel ?? row.value}
      </span>
    )}
  </button>
)

/**
 * The stepper's control — design turn 10's dropdown.
 *
 * Closed it is a pill with a chevron. Open, a panel of every value hangs beneath it
 * with a check on the COMMITTED value and a ring on wherever the dpad currently is.
 *
 * ⚠️ Those two marks are separate on purpose, and it is the whole point of the turn:
 * "moved to Gold, check stays on Silver". The previous version applied every value as
 * you arrowed past it, which meant scrolling a five-item list fired four settings
 * changes you did not want, and on the metered/offline rows those have side effects.
 * Now nothing happens until A.
 *
 * ⚠️ Rendered through a PORTAL, and it has to be. The settings grid is
 * `overflow-y-auto`, so a panel positioned inside it is clipped the moment it extends
 * past the bottom row — which is exactly the case that needs it most. Portalling to
 * `body` and positioning from the pill's measured rect sidesteps every ancestor's
 * clipping at once. Safe here because the list cannot outlive its row: focus is
 * captured while it is open, so nothing can scroll underneath and strand it.
 */
const ValueSelect = ({
  options,
  current,
  label,
  focused,
  open,
  cursor,
}: {
  options: ReadonlyArray<{ value: unknown; label: string }>
  current: unknown
  label: string
  focused: boolean
  open: boolean
  cursor?: number
}) => {
  /*
   * ⚠️ An absent cursor means "wherever the value already is", NOT zero. Defaulting to
   * the first option would open every list with the ring on the top entry while the
   * check sat somewhere else — two marks disagreeing about where you are.
   */
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

  return (
    <>
      <span
        ref={pillRef}
        className={[
          'flex flex-none items-center gap-3.5 rounded-full border px-4.5 py-2.75',
          'text-lg font-semibold transition-colors duration-150',
          open
            ? 'border-focus/65 bg-focus/25 text-ink'
            : focused
              ? 'border-hairline bg-chip-strong text-ink'
              : 'border-transparent bg-chip-strong text-ink-2',
        ].join(' ')}
      >
        {label}
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
    </>
  )
}

/**
 * ⚠️ 70x38 with the word beside it, per the design — and the word is the load-bearing
 * half. A blue pill and a grey pill are the same pill at couch distance, especially
 * for anyone who reads blue and grey similarly.
 */
const Toggle = ({ on }: { on: boolean }) => (
  <span className="flex flex-none items-center gap-3.5">
    <span className={`text-base font-semibold ${on ? 'text-focus-ink' : 'text-ink-2/55'}`}>
      {on ? 'On' : 'Off'}
    </span>
    <span
      className={[
        'flex h-9.5 w-17.5 items-center rounded-full p-1 transition-colors duration-150',
        on ? 'justify-end bg-focus' : 'justify-start bg-chip-strong',
      ].join(' ')}
    >
      <span className="size-7.5 rounded-full bg-ink" />
    </span>
  </span>
)

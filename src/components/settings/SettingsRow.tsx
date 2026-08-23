import type { Ref } from 'react'
import { ValueSelect } from '../ValueSelect'
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
        valueLabel={labelFor(row.key, settings[row.key] as never)}
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

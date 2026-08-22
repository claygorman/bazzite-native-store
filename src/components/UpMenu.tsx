import { motion } from 'motion/react'
import { AccountChip } from './AccountChip'
import { ControllerGlyph } from './ControllerGlyph'
import type { InputSource } from '../platform/glyphs'
import type { SessionState } from '../platform/auth'

/**
 * Where the menu can send you. Fixed, in this order, forever.
 *
 * > It is one row, always the same five, always in the same order, so it becomes
 * > muscle memory rather than navigation.
 *
 * ⚠️ That is the whole design of this screen, and it is why the list is a constant
 * rather than being built from what happens to be available. An entry that vanishes
 * when its data is missing would move every entry to its right, and a row whose
 * positions move is a row you have to read every time.
 */
export const UP_MENU = [
  { id: 'home', label: 'Home', hint: 'Featured, deals and your shelves' },
  { id: 'tags', label: 'Browse by Tag', hint: 'Every store tag, and what runs' },
  { id: 'search', label: 'Search', hint: 'Type a name, open its page' },
  { id: 'wishlist', label: 'Wishlist', hint: 'Everything you saved for later' },
  { id: 'settings', label: 'Settings', hint: 'Updates, controller, network' },
] as const

export type UpMenuId = (typeof UP_MENU)[number]['id']

export type UpMenuBadge = {
  /** Which entry it sits on. Only Settings carries one today. */
  on: UpMenuId
  /** Spelled out under the row — "the reason, not just the dot". */
  reason: string
}

type Props = {
  index: number
  /** The destination you are already in; it opens focused, so Up-then-A is a no-op. */
  current: UpMenuId
  /** Entries that cannot do anything right now, and why. */
  disabled?: Partial<Record<UpMenuId, string>>
  badge?: UpMenuBadge
  session: SessionState
  source: InputSource
  onActivate: (id: UpMenuId) => void
}

/**
 * The Up menu — design 9a.
 *
 * The client has no persistent header; that space went back to the shelves. This is
 * the route to everything that is not a shelf, raised over the dimmed page.
 *
 * ⚠️ Two ways in, and they are not redundant. **Up** works only from the top shelf on
 * home — it is the discoverable one, and from any lower shelf Up still moves a shelf,
 * because a direction that sometimes navigates and sometimes opens a menu is a
 * direction nobody trusts. **☰ Menu** works from anywhere at all, which is what makes
 * Settings reachable from a details page or a tag result.
 *
 * ⚠️ The guide button is off limits. It belongs to Bazzite and the Steam overlay, and
 * if a wedged store client could swallow it the machine would be unrecoverable.
 */
export const UpMenu = ({ index, current, disabled, badge, session, source, onActivate }: Props) => (
  <motion.div
    className="absolute inset-0 z-20"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ duration: 0.16 }}
  >
    {/* The page stays legible underneath — you are choosing where to go FROM here,
        and a solid backdrop would lose that. */}
    <div className="scrim-page absolute inset-0" />

    <div className="absolute inset-x-14 top-9.5 flex items-center gap-5">
      <span className="text-base font-extrabold uppercase tracking-[0.26em] text-ink">Store</span>
      <span className="ml-auto flex items-center gap-4.5">
        <span className="flex items-center gap-2.25 rounded-full bg-ok-wash px-3.5 py-1.75 text-sm font-semibold text-pad-ok">
          <span className="h-2.25 w-2.25 rounded-full bg-ok" />
          {source === 'gamepad' ? 'Controller' : 'Keyboard'}
        </span>
      </span>
    </div>

    {/* The two routes, named on screen. This is the only place they are taught. */}
    <div className="absolute inset-x-14 top-33 flex items-center gap-5">
      <span className="flex items-center gap-3.5 text-base font-semibold text-ink-3/50">
        <ControllerGlyph action="up" source={source} />
        from the top shelf
        <span className="h-4.5 w-px bg-hairline" />
        <ControllerGlyph action="menu" source={source} />
        from anywhere
      </span>
      <span className="h-px flex-1 bg-hairline" />
      <AccountChip session={session} focused={false} />
    </div>

    <div className="absolute inset-x-14 top-47 grid grid-cols-5 gap-6">
      {UP_MENU.map((entry, i) => {
        const focused = i === index
        const why = disabled?.[entry.id]
        return (
          <button
            key={entry.id}
            type="button"
            onClick={() => onActivate(entry.id)}
            className="flex min-w-0 flex-col gap-3.5 text-left"
          >
            <span
              className={[
                'relative flex h-26 items-center rounded-xl px-6.5',
                focused ? 'card-ring bg-focus-wash shadow-focused' : 'card-ring-off bg-chip-soft',
              ].join(' ')}
            >
              <span
                className={[
                  'truncate text-3xl font-bold',
                  why !== undefined ? 'text-ink-3/35' : focused ? 'text-ink' : 'text-ink-2/65',
                ].join(' ')}
              >
                {entry.label}
              </span>
              {badge?.on === entry.id && (
                <span className="absolute right-5 top-5 size-3.5 rounded-full bg-focus shadow-badge" />
              )}
            </span>
            {/*
              ⚠️ The hint line is always rendered and only its opacity changes, so the
              row does not change height as focus moves along it. A disabled entry is
              the one exception that shows its text unfocused: "you cannot use this"
              is useless without "because".
            */}
            <span
              className={[
                'px-1 text-base font-medium leading-tight text-ink-3/60 transition-opacity duration-150',
                focused || why !== undefined ? 'opacity-100' : 'opacity-0',
              ].join(' ')}
            >
              {why ?? (badge?.on === entry.id ? badge.reason : entry.hint)}
            </span>
          </button>
        )
      })}
    </div>

    {/* Focus opens on where you already are, so the menu never volunteers a trip. */}
    <span className="sr-only">Currently in {current}</span>
  </motion.div>
)

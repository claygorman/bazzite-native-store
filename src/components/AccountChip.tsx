import { signIn, type SessionState } from '../platform/auth'

const ring = (focused: boolean) => (focused ? 'relative z-10 ring-tile' : '')

/**
 * Account state, top right — the mockup's account chip.
 *
 * Signed out shows an explicit affordance rather than hiding: on a couch you cannot
 * discover a menu you cannot see.
 */
export const AccountChip = ({
  session,
  focused = false,
}: {
  session: SessionState
  focused?: boolean
}) => {
  if (session.status === 'loading') {
    return <span className="h-8 w-24 animate-pulse rounded-full bg-chip" />
  }

  if (session.status === 'unavailable') {
    return (
      <span className="rounded-full bg-chip px-3.5 py-2 text-sm font-semibold text-ink-faint">
        Demo — sign-in off
      </span>
    )
  }

  if (session.status === 'signed-out') {
    return (
      <button
        type="button"
        onClick={() => void signIn()}
        className={`rounded-full bg-chip-strong px-3.5 py-2 text-sm font-semibold text-ink-2 transition-shadow ${ring(focused)}`}
      >
        Sign in with Steam
      </button>
    )
  }

  const label = session.player?.personaname ?? session.steamid

  return (
    <span
      className={`flex items-center gap-2.5 rounded-full bg-chip py-1 pl-1 pr-3.5 text-sm font-semibold text-ink-2 transition-shadow ${ring(focused)}`}
    >
      {session.player?.avatarfull ? (
        <img src={session.player.avatarfull} alt="" className="h-7 w-7 rounded-full object-cover" />
      ) : (
        <span className="h-7 w-7 rounded-full bg-hairline" />
      )}
      <span className="max-w-48 truncate">{label}</span>
      {session.privacy !== undefined && session.privacy !== 'public' && (
        // A private profile returns EMPTY successfully, so library and wishlist will
        // look like zero rather than hidden. Say so instead of showing a silent nothing.
        <span title={`Steam profile is ${session.privacy} — library and wishlist stay hidden`}>
          ⚠
        </span>
      )}
    </span>
  )
}

import { ControllerGlyph } from './ControllerGlyph'
import type { InputSource } from '../platform/glyphs'
import type { InputAction } from '../platform/gamepadMapping'

export type LegendHint = {
  action: InputAction
  label: string
  /** Shown but inert — the control exists, there is just nothing for it to act on. */
  dimmed?: boolean
}

/**
 * A single prompt glyph.
 *
 * ⚠️ On a pad this is the real Xbox art from `Controller Glyphs.dc.html` — coloured
 * face buttons, the dpad cross with one arm lit, bumper silhouettes, the ☰ and ⊟ discs
 * — not a lettered pill. See `ControllerGlyph`. On a keyboard it stays a keycap, which
 * is the honest shape for a key.
 */
export const Prompt = ({ action, source }: { action: InputAction; source: InputSource }) => (
  <ControllerGlyph action={action} source={source} />
)

/**
 * Controls differ per screen, so the legend must too — a legend reading "Prev shelf"
 * on a details page is worse than none, because it teaches the wrong model.
 *
 * Hints are declared as ACTIONS, never as literal button names, so the glyphs follow
 * whichever device the user last touched.
 */
/**
 * ⚠️ Search on a KEYBOARD is a special case. Text capture means q/e/x are typing,
 * so the pad's "Q Prev row / E Next row / X Delete" hints become false the moment a
 * key is pressed. A tray that names bindings the screen has repurposed is worse than
 * an empty one.
 */
const KEYBOARD_SEARCH: LegendHint[] = [
  { action: 'right', label: 'Results' },
  { action: 'left', label: 'Keyboard' },
]

export type LegendScreen =
  | 'home'
  | 'details'
  /** 14b — a bundle's own page. */
  | 'bundle'
  | 'search'
  | 'tags'
  | 'tag-results'
  | 'wishlist'
  | 'settings'
  /** A settings stepper with its list open — the one modal state in the app. */
  | 'settings-picker'

const NAVIGATION: Record<LegendScreen, LegendHint[]> = {
  /*
   * ⚠️ One row of cards, so left/right is the ONLY movement — and saying so is the
   * point. A page that offers up/down hints on a single row invites presses that do
   * nothing, which at ten feet reads as the client having stopped responding.
   */
  bundle: [
    { action: 'left', label: 'Game' },
    { action: 'right', label: 'Game' },
  ],
  home: [
    { action: 'shelfPrev', label: 'Prev shelf' },
    { action: 'shelfNext', label: 'Next shelf' },
    { action: 'pagePrev', label: 'Page' },
    { action: 'pageNext', label: 'Page' },
  ],
  details: [
    { action: 'shelfPrev', label: 'Prev screen' },
    { action: 'shelfNext', label: 'Next screen' },
  ],
  search: [
    { action: 'shelfPrev', label: 'Prev row' },
    { action: 'shelfNext', label: 'Next row' },
    { action: 'secondary', label: 'Delete' },
  ],
  tags: [
    { action: 'shelfPrev', label: 'Prev group' },
    { action: 'shelfNext', label: 'Next group' },
  ],
  'tag-results': [
    { action: 'shelfPrev', label: 'Sort' },
    { action: 'shelfNext', label: 'Sort' },
    { action: 'pagePrev', label: 'Page' },
    { action: 'pageNext', label: 'Page' },
  ],
  wishlist: [
    { action: 'pagePrev', label: 'Page' },
    { action: 'pageNext', label: 'Page' },
  ],
  /*
   * ⚠️ The ideology doc is explicit: "The hint bar says exactly this on every settings
   * page and nothing more." A is CHANGE rather than OPEN because a settings row is not
   * a thing you enter, and Y is the one screen in the app where Y is not search —
   * which is why it has to be named here rather than assumed.
   */
  settings: [
    { action: 'shelfPrev', label: 'Prev page' },
    { action: 'shelfNext', label: 'Next page' },
    // ⚠️ Named, because they are not guessable. Left/right is movement on this screen
    // — it reaches the rail and the other column — so a stepper needs its own pair,
    // and the triggers are the only buttons Settings does not otherwise spend.
    { action: 'pagePrev', label: 'Adjust' },
    { action: 'pageNext', label: 'Adjust' },
  ],
  // ⚠️ The tray reduces to exactly what an open list can do. Every other binding is
  // inert while it is open, and leaving them named would be a menu of dead keys.
  'settings-picker': [
    { action: 'up', label: 'Choose' },
    { action: 'down', label: 'Choose' },
  ],
}

/**
 * ⚠️ Two hints the 7a/7b artboards draw are deliberately absent.
 *
 * `Y PIN TAG` — Y is the global search shortcut on every other screen, and a
 * controller UI where a button means something different per screen is one nobody can
 * learn. Pinning is deferred rather than rebound.
 *
 * `Y WISHLIST` — wishlisting is not reachable anonymously at all
 * (private/AUTH-AND-CART.md). Naming a binding the screen cannot honour is the bug fixed
 * in 3e48ac0. Note this is about WRITING a wishlist: the Wishlist SCREEN reads one
 * from the local Steam client, which is a different capability entirely.
 *
 * ⚠️ Settings is the one screen that reassigns Y, from SEARCH to RESET ROW. The
 * ideology doc asks for it by name, and it is defensible only because Settings has no
 * search to reach — the tray says so on every settings page so the exception is never
 * silent.
 */
const ACTIONS: Record<LegendScreen, LegendHint[]> = {
  /*
   * ⚠️ X is the buy, A is the walk-in. That split is the turn's argument: the bundle
   * lives in this client so its contents can be judged, so the press people make by
   * reflex has to be the one that keeps them here. Y stays the global wishlist verb.
   */
  bundle: [
    { action: 'accept', label: 'OPEN THIS PAGE' },
    { action: 'secondary', label: 'BUY IN STEAM' },
    { action: 'back', label: 'BACK TO OFFERS' },
  ],
  home: [
    { action: 'accept', label: 'SELECT' },
    { action: 'search', label: 'SEARCH' },
    { action: 'back', label: 'BACK' },
  ],
  details: [
    { action: 'accept', label: 'OPEN IN STEAM' },
    { action: 'back', label: 'BACK' },
  ],
  search: [
    { action: 'accept', label: 'PRESS KEY' },
    { action: 'back', label: 'BACK' },
  ],
  tags: [
    { action: 'accept', label: 'BROWSE TAG' },
    { action: 'search', label: 'SEARCH' },
    { action: 'back', label: 'BACK' },
  ],
  'tag-results': [
    { action: 'accept', label: 'OPEN' },
    { action: 'search', label: 'SEARCH' },
    { action: 'back', label: 'BACK' },
  ],
  wishlist: [
    { action: 'accept', label: 'OPEN' },
    { action: 'search', label: 'SEARCH' },
    { action: 'back', label: 'BACK' },
  ],
  settings: [
    { action: 'accept', label: 'CHANGE' },
    { action: 'search', label: 'RESET ROW' },
    { action: 'back', label: 'BACK TO STORE' },
  ],
  'settings-picker': [
    // ⚠️ SELECT, not DONE — design turn 10 made A the commit. Moving the dpad only
    // moves a ring; until A is pressed the setting is untouched, so a tray that said
    // "DONE" would be claiming the work was already finished.
    { action: 'accept', label: 'SELECT' },
    { action: 'search', label: 'RESET ROW' },
    // ⚠️ CANCEL, not BACK. On the two live-preview rows (Interface scale, Safe area)
    // the value really has been moving as you scrolled, so B puts back what was there
    // when the list opened. On every other row there is nothing to undo and B simply
    // closes — one word covers both, and it is the honest one for the destructive case.
    { action: 'back', label: 'CANCEL' },
  ],
}

/**
 * The screen's standing hints, with any contextual ones layered over them.
 *
 * ⚠️ An extra REPLACES a standing hint for the same button rather than joining it. The
 * details page normally offers A as "OPEN IN STEAM"; down in turn 14a's offers block A
 * opens a bundle page instead — and appending left the tray showing two A prompts with
 * two different verbs. One button can only mean one thing at a time, and a tray that
 * says otherwise is worse than one that says nothing, because it is the thing people
 * check when they are not sure what a press will do.
 *
 * Order is preserved: an overridden hint keeps its original position rather than
 * jumping to the end, so the row does not reshuffle as context changes.
 */
const withExtra = (base: LegendHint[], extra: LegendHint[]): LegendHint[] => {
  const overrides = new Map(extra.map((hint) => [hint.action, hint]))
  const merged = base.map((hint) => overrides.get(hint.action) ?? hint)
  const used = new Set(merged.map((hint) => hint.action))
  return [...merged, ...extra.filter((hint) => !used.has(hint.action))]
}

export const ButtonLegend = ({
  screen = 'home',
  source,
  extra = [],
}: {
  screen?: LegendScreen
  source: InputSource
  /** Context hints, e.g. sound only when a clip with audio is focused. */
  extra?: LegendHint[]
}) => (
  <div className="absolute inset-x-0 bottom-0 flex h-18.5 items-center gap-7 bg-gradient-to-b from-transparent to-[rgba(8,13,22,.95)] px-14 text-base font-bold text-ink-3">
    <span className="rounded-full bg-ink px-4 py-2 text-sm font-extrabold tracking-widest text-ink-on-light">
      STORE
    </span>

    <span className="flex items-center gap-6 text-sm font-semibold text-ink-3/75">
      {(screen === 'search' && source === 'keyboard' ? KEYBOARD_SEARCH : NAVIGATION[screen]).map(
        (hint) => (
          <span key={hint.action} className="flex items-center gap-2">
            <Prompt action={hint.action} source={source} />
            {hint.label}
          </span>
        ),
      )}
    </span>

    <span className="ml-auto flex items-center gap-6">
      {withExtra(ACTIONS[screen], extra).map((hint) => (
        <span
          key={`${hint.action}-${hint.label}`}
          className={`flex items-center gap-2.5 ${hint.dimmed ? 'opacity-40' : ''}`}
        >
          <Prompt action={hint.action} source={source} />
          {hint.label}
        </span>
      ))}
    </span>
  </div>
)

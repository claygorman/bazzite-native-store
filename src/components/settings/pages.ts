import type { Settings, SteppableKey } from '../../platform/settings'

/**
 * The seven pages, as data.
 *
 * > Each page is one question. If a page cannot be stated as a question, it should not
 * > be a page.
 *
 * > A setting is a sentence, not a label. Every row carries a name and one line of
 * > plain consequence — "Pull the UI in if your TV crops the edges", not "Overscan
 * > compensation". The description is the actual documentation; there is no help page
 * > behind it.
 *
 * ⚠️ Ordering is by **how often someone opens the page**, not by importance. Updates
 * first because it is the only one people visit without being sent there by a problem;
 * About last because it is where you go when something is already wrong.
 *
 * ⚠️ Roughly a dozen rows the artboards draw are absent, and every one of them is
 * absent for the same reason: the client does not own the thing. `docs/SETTINGS.md`
 * lists them individually. Do not add one back without something behind it — a switch
 * that changes nothing is indistinguishable from a broken one at ten feet.
 */

export type SettingsRow =
  | { kind: 'toggle'; key: BooleanKey; label: string; desc: string }
  | { kind: 'stepper'; key: SteppableKey; label: string; desc: string }
  | { kind: 'button'; action: RowAction; label: string; desc: string; value: string }

/** Only the boolean settings can drive a toggle; the type says so. */
type BooleanKey = {
  [K in keyof Settings]: Settings[K] extends boolean ? K : never
}[keyof Settings]

/**
 * > **Button** — an action, not a state. Present tense verb on the face.
 *
 * ⚠️ And nothing destructive by accident: `Clear`, `Reset` and `Sign out` are buttons,
 * never toggles, and each says in its description what survives it.
 */
export type RowAction =
  /** Check, then install, then restart — whichever the update state allows next. */
  | 'check-updates'
  | 'clear-cache'
  | 'refresh-ratings'
  | 'run-diagnostics'
  | 'proton-download'
  | 'proton-check'
  | 'copy-diagnostics'
  | 'open-docs'
  | 'reset-all'
  | 'sign-out'

export type SettingsPage = {
  id: string
  title: string
  /** The question this page answers. Not rendered — it is the test for whether it
   *  deserves to be a page at all. */
  question: string
  colA: { title: string; rows: SettingsRow[] }
  colB: { title: string; rows: SettingsRow[] }
}

const toggle = (key: BooleanKey, label: string, desc: string): SettingsRow => ({
  kind: 'toggle',
  key,
  label,
  desc,
})
const step = (key: SteppableKey, label: string, desc: string): SettingsRow => ({
  kind: 'stepper',
  key,
  label,
  desc,
})
const button = (action: RowAction, label: string, desc: string, value: string): SettingsRow => ({
  kind: 'button',
  action,
  label,
  desc,
  value,
})

export const SETTINGS_PAGES: readonly SettingsPage[] = [
  {
    id: 'updates',
    title: 'Updates',
    question: 'Am I current, and will I stay current on my own?',
    colA: {
      title: 'Staying current',
      rows: [
        /*
         * ⚠️ First row of the first column, which is where focus lands. The doc asks
         * for focus to land on Check for updates specifically, "because that page's
         * reason to exist is an action" — putting the action here satisfies both rules
         * at once without giving the status card a focusable control of its own.
         */
        button(
          'check-updates',
          'Check for updates',
          'Ask the feed whether there is a newer build',
          'Check',
        ),
        toggle('autoUpdate', 'Automatic updates', 'Check on launch and download in the background'),
        step('updateChannel', 'Update channel', 'Testing gets builds before they are tagged'),
        toggle(
          'notifyBeforeRestart',
          'Notify before restarting',
          'Ask first — an update applies when the client next starts',
        ),
      ],
    },
    colB: {
      title: 'Store data',
      rows: [
        button(
          'refresh-ratings',
          'Refresh compatibility ratings',
          'Drops the cached ProtonDB and Deck verdicts so the next look is live',
          'Refresh',
        ),
        toggle(
          'cacheArtwork',
          'Cache artwork and trailers',
          'Keeps shelves instant on a second visit',
        ),
      ],
    },
  },

  {
    id: 'appearance',
    title: 'Appearance',
    question: 'Does this fit and read on my screen?',
    colA: {
      title: 'Framing & type',
      rows: [
        step('uiScalePercent', 'Interface scale', 'Grows every element for larger rooms'),
        step('safeAreaPercent', 'Safe area inset', 'Pull the UI in if your TV crops the edges'),
        toggle('showClock', 'Show clock', 'Top-right corner of the home screen'),
        toggle('clock24h', '24-hour time', 'Show 16:41 instead of 4:41 PM'),
      ],
    },
    colB: {
      title: 'Motion & art',
      rows: [
        step('trailerAutoplay', 'Microtrailer autoplay', 'Plays on the focused tile after a pause'),
        step('trailerDelayMs', 'Autoplay delay', 'Wait before a trailer starts'),
        toggle('ambientWash', 'Ambient art wash', 'Blurred art glow behind the whole screen'),
        toggle('reduceMotion', 'Reduce motion', 'Cuts the shelf springs and page transitions'),
      ],
    },
  },

  {
    id: 'controller',
    title: 'Controller',
    question: 'Does moving around feel right in my hands?',
    colA: {
      title: 'Focus & movement',
      rows: [
        toggle('stickMovesFocus', 'Left stick moves focus', 'Mirror the dpad on the left stick'),
        step('repeatDelayMs', 'Repeat delay', 'Hold before focus starts repeating'),
        step('repeatRateMs', 'Repeat rate', 'Speed while a direction is held'),
        toggle('wrapAtEnds', 'Wrap at shelf ends', 'Focus loops instead of stopping'),
      ],
    },
    colB: {
      title: 'Glyphs',
      rows: [step('glyphSet', 'Glyph set', 'Which button names the hint bar draws')],
    },
  },

  {
    id: 'compatibility',
    title: 'Compatibility',
    question: 'What is the store allowed to show me?',
    colA: {
      title: 'What the store shows',
      rows: [
        /*
         * ⚠️ Valve's Deck verdict, not ProtonDB's tier, and the artboard asks for the
         * latter. ProtonDB is one request per appid with no batching — a store-wide
         * ProtonDB floor is unaffordable at any catalogue size. The Deck verdict rides
         * along free in the hydration every list already pays for, so this floor
         * applies to everything instantly. Same question, a source we can afford.
         */
        step('deckFloor', 'Minimum verdict shown', "Hide anything below Valve's rating for this"),
        toggle(
          'hideUnrated',
          'Hide unrated games',
          'Most of the catalogue has no verdict at all — this hides all of it',
        ),
        toggle('nativeLinuxFirst', 'Native Linux first', 'Sorts native builds above Proton ones'),
        /*
         * ⚠️ The SAME setting the ProtonDB tab's device dropdown reads — design 11a
         * asks for that by name, so changing it in either place changes it everywhere.
         * Two controls over one value is the only arrangement that cannot drift; two
         * values behind two controls is how a page ends up disagreeing with itself.
         */
        step(
          'deviceProfile',
          'Device profile',
          'Which machine the compatibility answers are about',
        ),
        step(
          'reportDistro',
          'Report distro',
          'Which distribution’s reports to prefer — “This machine” reads it off this one',
        ),
        /*
         * ⚠️ Reopened. docs/SETTINGS.md cut this row for "no endpoint we have carries
         * an anti-cheat signal", which was true of the endpoints and false of the
         * archive: ProtonDB's dump has an `isImpactedByAntiCheat` column, answered in
         * 21,890 reports with 1,707 impacted. It says nothing until the archive is on
         * disk, which is why it ships off.
         */
        toggle(
          'warnKernelAnticheat',
          'Warn on kernel anti-cheat',
          'Flags games reported as blocked by anti-cheat on Linux',
        ),
      ],
    },
    colB: {
      title: 'Data sources',
      rows: [
        /*
         * ⚠️ TWO buttons, not one — design turn 13a, and the separation is the point.
         * Checking costs a few KB; downloading costs 66 MB. A single control whose
         * meaning depends on hidden state is the thing you can least afford at ten
         * feet, because the press that checks and the press that spends your
         * bandwidth would look identical.
         *
         * Their descriptions are overridden per state from App.tsx — see the
         * `actionLabel` map — so the row can explain why it is inert rather than just
         * being inert.
         */
        button(
          'proton-download',
          'Local report archive',
          '326,212 reports over 31,587 games, indexed on this machine. 66 MB once, not per game',
          'Download',
        ),
        button(
          'proton-check',
          'Check for a newer snapshot',
          'Asking which snapshot is current — a few KB, no archive fetched',
          'Check',
        ),
        toggle('protonRatings', 'ProtonDB ratings', 'Community tiers and the coloured dots'),
        toggle(
          'deckVerified',
          'Show Deck verdicts',
          "Valve's badge on every card. The filter above uses it either way",
        ),
        step('refreshCadence', 'Refresh cadence', 'How long a compatibility rating is kept'),
      ],
    },
  },

  {
    id: 'downloads',
    /*
     * ⚠️ "Storage", not the artboard's "Downloads & Storage". The download half of 8e
     * is gone: "Steam library target" and "Ask which drive each time" were dropped
     * because this client never installs a game — it deep-links to Steam and Steam
     * picks the drive. What remains is the media cache and a way to reclaim it, which
     * is storage and nothing else. A page called Downloads that cannot download is a
     * promise the client does not keep.
     */
    title: 'Storage',
    question: 'What bytes does the client own?',
    colA: {
      title: 'Media cache',
      rows: [
        step('cacheLimitMb', 'Cache limit', 'Oldest responses drop out past this'),
        toggle('clearCacheOnQuit', 'Clear cache on quit', 'Start every session with fresh data'),
      ],
    },
    colB: {
      title: 'Reclaim',
      rows: [
        button(
          'clear-cache',
          'Clear store cache',
          'Keeps your settings. Shelves reload on the next visit',
          'Clear',
        ),
      ],
    },
  },

  {
    id: 'network',
    title: 'Network',
    question: 'Is the store actually talking to anything?',
    colA: {
      title: 'Connection',
      rows: [
        step('region', 'Store region', 'Prices, currency and release dates follow this'),
        step('requestTimeoutMs', 'Request timeout', 'Give up on a slow endpoint after this'),
        toggle('meteredConnection', 'Metered connection', 'Stops trailer and artwork prefetch'),
        toggle('offlineMode', 'Offline mode', 'Browse the cache, make no requests at all'),
        /*
         * ⚠️ Here rather than on About, because what it logs is REQUESTS — which host,
         * which path, how long, and what failed. In Game Mode the app is launched by
         * Steam, so stdout goes nowhere readable; this writes a file you can tail over
         * SSH. The About page prints the path.
         */
        toggle(
          'debugLogging',
          'Debug logging',
          'Write every request to a file you can read over SSH — see About for the path',
        ),
      ],
    },
    colB: {
      title: 'Requests',
      rows: [
        toggle('prefetchFocused', 'Prefetch focused tile', 'Loads details before you press A'),
        button(
          'run-diagnostics',
          'Re-check services',
          'Times a real request to each of the four',
          'Run',
        ),
      ],
    },
  },

  {
    id: 'about',
    title: 'About',
    question: 'What am I running, and how do I report a problem?',
    colA: {
      title: 'This install',
      rows: [
        button(
          'copy-diagnostics',
          'Copy diagnostics',
          'Version, hardware and service state, as text',
          'Copy',
        ),
        button('open-docs', 'Bazzite documentation', 'Setup guides and troubleshooting', 'Open'),
      ],
    },
    colB: {
      title: 'Reset',
      rows: [
        /*
         * ⚠️ Reset lives here and nowhere else, at the bottom of the second column —
         * the furthest point on the page from where focus lands. That is the design's
         * instruction and it is the only protection this button gets, since nothing
         * in Settings asks for confirmation.
         */
        button('sign-out', 'Sign out', 'Keeps every setting on these pages', 'Sign out'),
        button(
          'reset-all',
          'Reset all settings',
          'Everything on these pages, back to defaults',
          'Reset',
        ),
      ],
    },
  },
] as const

export const pageIndexById = (id: string): number => {
  const at = SETTINGS_PAGES.findIndex((p) => p.id === id)
  return at === -1 ? 0 : at
}

/**
 * Both columns as one flat list.
 *
 * ⚠️ NOT the order focus walks — up/down stays within a column and left/right crosses
 * between them (see the Settings branch in App.tsx). This is here for anything that
 * needs to reason about a page's rows as a set, such as counting them against the
 * doc's own budget:
 *
 * > Budget is roughly nine rows per page. A page that wants twelve is two pages, or it
 * > is carrying rows that belong to another tab.
 */
export const flatRows = (page: SettingsPage): SettingsRow[] => [
  ...page.colA.rows,
  ...page.colB.rows,
]

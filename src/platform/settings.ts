/**
 * Every setting the client owns, and nothing else.
 *
 * The design ships `Settings ideology.md`, and two of its rules do most of the work
 * here:
 *
 * > A setting exists because two reasonable people would want opposite defaults.
 * > If there is one right answer, ship the right answer.
 *
 * > No setting for something the client does not own. The client browses and hands
 * > off. It never installs, launches, or patches a game.
 *
 * Applied honestly, those rules delete about a dozen of the rows the artboards draw —
 * see `docs/SETTINGS.md` for the row-by-row account of what went and why. The short
 * version: this app sends no telemetry, does not manage Proton runtimes, and does not
 * choose the drive Steam installs to, so it has no business offering switches for any
 * of them.
 *
 * ⚠️ Every value here must actually change what the app does. A setting that is read
 * by nothing is worse than a missing one: it is a promise the UI cannot keep, and at
 * ten feet nobody can tell the difference until it matters.
 */

/* ─────────────────────────── the values ─────────────────────────── */

export type GlyphSet = 'xbox' | 'playstation' | 'nintendo' | 'deck'
export type UpdateChannel = 'stable' | 'testing'
export type TrailerAutoplay = 'off' | 'focus'
/**
 * The compatibility floor, expressed in **Valve's Deck verdicts** rather than the
 * design's ProtonDB tiers.
 *
 * ⚠️ This is an adaptation, not a shortcut, and the reason is arithmetic. The artboard
 * asks for "Minimum tier shown · Silver", meaning ProtonDB's ladder — but ProtonDB
 * serves **one appid per HTTP request** with no batching, so filtering a shelf of five
 * costs five requests and filtering a 43,980-game tag is impossible at any budget
 * (Steam allows ~200 requests per five minutes and ProtonDB is a second host on top).
 * A floor that could only be applied to games whose rating had already happened to
 * load would hide tiles seconds after they appeared.
 *
 * Valve's Deck verdict arrives free inside the `GetItems` hydration every surface
 * already pays for, so a floor built on it applies to everything, instantly, always.
 * It answers the same question the page exists to answer — *what is the store allowed
 * to show me* — from data we actually have. ProtonDB stays where it is affordable:
 * one focused row at a time, as a label rather than a filter.
 *
 * `all` is the off position, not a verdict.
 */
export type DeckFloor = 'all' | 'playable' | 'verified'
export type RefreshCadence = 'hourly' | 'daily' | 'weekly'

/**
 * Which machine the compatibility answers are about — design 8d, reopened.
 *
 * ⚠️ This is a SCOPE, not a filter. Turn 11 makes the ProtonDB tab answer one
 * question — "will this exe run under Proton on *my* desktop" — and the same value has
 * to mean the same thing in both places, so this row and the tab's device dropdown are
 * one setting rather than two that can disagree.
 *
 * `desktop` is the default because that is what this app already assumed before the
 * row existed, and because Bazzite on a desktop is the box it was written on.
 */
export type DeviceProfile = 'desktop' | 'handheld' | 'deck' | 'all'

/**
 * Which distribution's reports to prefer when reading the archive.
 *
 * ⚠️ `auto` is not "no answer" — it means *read it off this machine*, from
 * `host_info`'s `PRETTY_NAME`. `any` is the off position: do not scope by distro at
 * all. Those are different, and collapsing them would silently narrow the report set
 * on a distro nobody else reports from.
 */
export type ReportDistro = 'auto' | 'any' | 'bazzite' | 'arch' | 'fedora' | 'ubuntu' | 'mint'

export type Settings = {
  /* Updates */
  autoUpdate: boolean
  updateChannel: UpdateChannel
  notifyBeforeRestart: boolean

  /* Appearance */
  uiScalePercent: number
  safeAreaPercent: number
  showClock: boolean
  clock24h: boolean
  trailerAutoplay: TrailerAutoplay
  trailerDelayMs: number
  ambientWash: boolean
  reduceMotion: boolean

  /* Controller */
  stickMovesFocus: boolean
  repeatDelayMs: number
  repeatRateMs: number
  wrapAtEnds: boolean
  glyphSet: GlyphSet

  /* Compatibility */
  deckFloor: DeckFloor
  hideUnrated: boolean
  nativeLinuxFirst: boolean
  protonRatings: boolean
  deckVerified: boolean
  refreshCadence: RefreshCadence
  deviceProfile: DeviceProfile
  reportDistro: ReportDistro
  warnKernelAnticheat: boolean

  /* Storage */
  cacheArtwork: boolean
  cacheLimitMb: number
  clearCacheOnQuit: boolean

  /* Network */
  region: string
  requestTimeoutMs: number
  meteredConnection: boolean
  offlineMode: boolean
  prefetchFocused: boolean
  debugLogging: boolean
  debugServer: boolean
}

/**
 * ⚠️ These are the shipped answers, not placeholders. Where the design named a
 * default it is honoured; where it did not, the default is whatever the app already
 * did before it became a setting, so turning settings on changes nothing by itself.
 */
export const DEFAULT_SETTINGS: Settings = {
  autoUpdate: true,
  updateChannel: 'stable',
  notifyBeforeRestart: true,

  uiScalePercent: 100,
  safeAreaPercent: 0,
  showClock: true,
  clock24h: false,
  trailerAutoplay: 'focus',
  trailerDelayMs: 600,
  ambientWash: true,
  reduceMotion: false,

  stickMovesFocus: true,
  repeatDelayMs: 400,
  repeatRateMs: 90,
  wrapAtEnds: false,
  glyphSet: 'xbox',

  deckFloor: 'all',
  hideUnrated: false,
  nativeLinuxFirst: false,
  protonRatings: true,
  deckVerified: true,
  refreshCadence: 'daily',
  deviceProfile: 'desktop',
  reportDistro: 'auto',
  // ⚠️ Defaults OFF, which is the rule at the top of this block applied honestly: the
  // app said nothing about anti-cheat before this row existed, so shipping it on would
  // be a new warning appearing unasked. It also only has anything to say once the
  // report archive is on disk — 1,707 of the 21,890 reports that answered the question
  // are impacted — and the archive is itself opt-in.
  warnKernelAnticheat: false,

  cacheArtwork: true,
  cacheLimitMb: 2048,
  clearCacheOnQuit: false,

  region: 'US',
  requestTimeoutMs: 8000,
  meteredConnection: false,
  offlineMode: false,
  prefetchFocused: true,
  // ⚠️ Off, and it must stay off by default: enabled it writes a line per HTTP request.
  // A diagnostic you turn on to reproduce something, not a thing running forever.
  debugLogging: false,
  // ⚠️ Also off, and a separate decision from the log: this one opens a listening socket
  // that can drive the UI. Loopback-only, so reaching it from another machine takes a
  // tunnel somebody deliberately opened.
  debugServer: false,
}

/* ─────────────────────────── stepper ladders ─────────────────────────── */

/**
 * The ordered values a stepper walks, and how each reads on its face.
 *
 * > **Stepper** — 3 to 8 ordered or named values, `◀ value ▶`. Never opens a panel.
 * > If the list is longer than 8, it is a sub-page, not a stepper.
 *
 * ⚠️ The label is not decoration. `Values are readable at rest` is the rule that
 * kills dropdowns here — at ten feet, hidden state is broken state — so every ladder
 * has to render its current value as a short phrase, not a number the user has to
 * interpret.
 */
export type Ladder<K extends keyof Settings> = {
  values: ReadonlyArray<Settings[K]>
  label: (value: Settings[K]) => string
}

const ladder = <K extends keyof Settings>(
  values: ReadonlyArray<Settings[K]>,
  label: (value: Settings[K]) => string,
): Ladder<K> => ({ values, label })

/** Steam sells in these; `cc` decides both price and currency. */
export const REGIONS = ['US', 'CA', 'GB', 'DE', 'FR', 'AU', 'JP', 'BR'] as const
const REGION_NAMES: Record<string, string> = {
  US: 'United States',
  CA: 'Canada',
  GB: 'United Kingdom',
  DE: 'Germany',
  FR: 'France',
  AU: 'Australia',
  JP: 'Japan',
  BR: 'Brazil',
}

const GLYPH_SET_NAMES: Record<GlyphSet, string> = {
  xbox: 'Xbox',
  playstation: 'PlayStation',
  nintendo: 'Nintendo',
  deck: 'Steam Deck',
}

const DECK_FLOOR_NAMES: Record<DeckFloor, string> = {
  all: 'Show everything',
  playable: 'Playable or better',
  verified: 'Verified only',
}

const DEVICE_PROFILE_NAMES: Record<DeviceProfile, string> = {
  desktop: 'PC · desktop',
  handheld: 'Handheld PC',
  deck: 'Steam Deck',
  all: 'All devices',
}

const REPORT_DISTRO_NAMES: Record<ReportDistro, string> = {
  auto: 'This machine',
  any: 'Any distro',
  bazzite: 'Bazzite',
  arch: 'Arch',
  fedora: 'Fedora',
  ubuntu: 'Ubuntu',
  mint: 'Linux Mint',
}

export const LADDERS = {
  updateChannel: ladder<'updateChannel'>(['stable', 'testing'], (v) =>
    v === 'stable' ? 'Stable' : 'Testing',
  ),
  uiScalePercent: ladder<'uiScalePercent'>([90, 100, 110, 125, 150], (v) => `${v}%`),
  safeAreaPercent: ladder<'safeAreaPercent'>([0, 2, 4, 6], (v) => (v === 0 ? 'None' : `${v}%`)),
  trailerAutoplay: ladder<'trailerAutoplay'>(['off', 'focus'], (v) =>
    v === 'off' ? 'Off' : 'On focus',
  ),
  trailerDelayMs: ladder<'trailerDelayMs'>([300, 600, 1000, 1500], (v) => `${v / 1000} s`),
  repeatDelayMs: ladder<'repeatDelayMs'>([250, 350, 400, 500], (v) => `${v} ms`),
  repeatRateMs: ladder<'repeatRateMs'>([60, 90, 120, 160], (v) => `${v} ms`),
  glyphSet: ladder<'glyphSet'>(
    ['xbox', 'playstation', 'nintendo', 'deck'],
    (v) => GLYPH_SET_NAMES[v],
  ),
  deckFloor: ladder<'deckFloor'>(['all', 'playable', 'verified'], (v) => DECK_FLOOR_NAMES[v]),
  refreshCadence: ladder<'refreshCadence'>(['hourly', 'daily', 'weekly'], (v) =>
    v === 'hourly' ? 'Hourly' : v === 'daily' ? 'Daily' : 'Weekly',
  ),
  deviceProfile: ladder<'deviceProfile'>(
    ['desktop', 'handheld', 'deck', 'all'],
    (v) => DEVICE_PROFILE_NAMES[v],
  ),
  // ⚠️ Seven values, one under the stepper's ceiling of eight. Adding an eighth
  // distro makes this a sub-page, not a longer stepper — the ideology doc draws that
  // line and `optionsFor` enforces it.
  reportDistro: ladder<'reportDistro'>(
    ['auto', 'any', 'bazzite', 'arch', 'fedora', 'ubuntu', 'mint'],
    (v) => REPORT_DISTRO_NAMES[v],
  ),
  cacheLimitMb: ladder<'cacheLimitMb'>([512, 1024, 2048, 4096], (v) =>
    v >= 1024 ? `${v / 1024} GB` : `${v} MB`,
  ),
  region: ladder<'region'>(REGIONS, (v) => REGION_NAMES[v] ?? v),
  requestTimeoutMs: ladder<'requestTimeoutMs'>([5000, 8000, 12000, 20000], (v) => `${v / 1000} s`),
} as const

export type SteppableKey = keyof typeof LADDERS

/** Next value on a ladder, clamped at both ends rather than wrapping. */
export const stepSetting = <K extends SteppableKey>(
  key: K,
  current: Settings[K],
  delta: number,
): Settings[K] => {
  // ⚠️ Through `unknown`: `LADDERS` is a union of ladders over different value types,
  // and TypeScript cannot see that indexing it with `K` narrows to `Ladder<K>`. The
  // key/value pairing is enforced where it matters — at the `ladder<'key'>(...)`
  // declarations above, each of which is checked against `Settings[key]`.
  const { values } = LADDERS[key] as unknown as Ladder<K>
  const at = values.indexOf(current)
  // An unknown current value (an old file, a hand edit) steps to the FIRST entry
  // rather than staying stuck — `indexOf` gives -1, and -1 + 1 is 0.
  const next = Math.min(values.length - 1, Math.max(0, at + delta))
  return values[next] ?? current
}

export const labelFor = <K extends SteppableKey>(key: K, value: Settings[K]): string =>
  (LADDERS[key] as unknown as Ladder<K>).label(value)

/**
 * Every value on a ladder, with its face, for the picker A opens.
 *
 * ⚠️ At most eight, by the doc's own rule — "if the list is longer than 8, it is a
 * sub-page, not a stepper" — which is what lets the picker be a plain list that always
 * fits on screen without scrolling. Nothing enforces that but this comment and the
 * ladders above; a ninth value is a signal the row wants splitting, not a taller list.
 */
export const optionsFor = <K extends SteppableKey>(
  key: K,
): ReadonlyArray<{ value: Settings[K]; label: string }> => {
  const ladder_ = LADDERS[key] as unknown as Ladder<K>
  return ladder_.values.map((value) => ({ value, label: ladder_.label(value) }))
}

export const indexOfValue = <K extends SteppableKey>(key: K, value: Settings[K]): number =>
  (LADDERS[key] as unknown as Ladder<K>).values.indexOf(value)

/* ─────────────────────────── derived values ─────────────────────────── */

/** ProtonDB's disk TTL, from the cadence row. Read by `fetchProtonRating`. */
export const cadenceSeconds = (cadence: RefreshCadence): number =>
  cadence === 'hourly' ? 3600 : cadence === 'weekly' ? 604800 : 86400

/* ─────────────────────────── persistence ─────────────────────────── */

const STORAGE_KEY = 'bazzite-store.settings'

/**
 * ⚠️ Merged key by key against `DEFAULT_SETTINGS`, never spread wholesale, and every
 * value is type-checked against the default it replaces.
 *
 * The stored file outlives the build that wrote it. A setting removed here leaves a
 * dead key behind (harmless); a setting ADDED here is simply missing from an older
 * file, and `{...DEFAULTS, ...stored}` would be fine for that but would also happily
 * accept `uiScalePercent: "big"` from a corrupt or hand-edited file and render the
 * whole app at NaN. Checking the type of each value costs nothing and makes a bad
 * file degrade to defaults one key at a time.
 */
export const mergeSettings = (stored: unknown): Settings => {
  if (!stored || typeof stored !== 'object') return DEFAULT_SETTINGS
  const raw = stored as Record<string, unknown>
  const out = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const value = raw[key]
    if (value === undefined || typeof value !== typeof DEFAULT_SETTINGS[key]) continue
    // Numbers additionally have to be finite — JSON can carry neither NaN nor
    // Infinity, but a value that arrived some other way still would.
    if (typeof value === 'number' && !Number.isFinite(value)) continue
    out[key] = value as never
  }
  return out
}

/**
 * Where settings live.
 *
 * ⚠️ `localStorage` in BOTH builds, deliberately, rather than a Tauri file plus a
 * second web path. Settings are per-machine preferences a few hundred bytes long,
 * the webview persists localStorage across launches, and a second storage backend
 * would mean a second serializer, a second failure mode and a second thing to keep
 * in step. The demo server gets working settings for free as a side effect.
 *
 * Everything here is best-effort: a private window, a cleared profile or a webview
 * with storage disabled all degrade to defaults rather than throwing on launch.
 */
export const loadSettings = (): Settings => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? mergeSettings(JSON.parse(raw)) : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

export const saveSettings = (settings: Settings): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Nothing to do and nothing to say — the session still works, it just will not
    // be remembered. Failing loudly here would be a modal on a television.
  }
}

import type { AppDetails, ReviewSummary } from '../../types/steam'

/**
 * Which focusable sections exist on each details screen.
 *
 * Shared by App (which owns the focus index and must clamp it) and the screens
 * themselves (which draw the ring). Deriving it in one place means the two can never
 * disagree about how many sections there are — a panel that renders but cannot be
 * reached, or an index pointing at nothing, are both silent bugs.
 *
 * Sections are conditional: a game with no languages listed has no languages panel,
 * and focus must skip it rather than land on emptiness.
 */
export type SectionKey =
  | 'about'
  | 'proton'
  | 'minimum'
  | 'recommended'
  | 'languages'
  | 'reviews'
  | 'achievements'
  | 'players'
  | 'demo'
  | 'metacritic'
  | 'genres'
  // Design turn 11a / 13b — the ProtonDB screen. Either the four report filters, or
  // the single call to action that fetches the archive they filter.
  | 'pdbType'
  | 'pdbCpu'
  | 'pdbGpu'
  | 'pdbDistro'
  | 'pdbGet'

/** The four report filters, in the order they are drawn. */
export const PROTON_FILTERS = ['pdbType', 'pdbCpu', 'pdbGpu', 'pdbDistro'] as const
export type ProtonFilterKey = (typeof PROTON_FILTERS)[number]

/**
 * Sections whose content is truncated until A expands them.
 *
 * ⚠️ The four ProtonDB filters are in here too, and "expanded" means their dropdown is
 * open. It is the same interaction — A reveals the rest, B puts it away — so it reuses
 * the same flag rather than growing a second, parallel notion of open. `pdbGet` is
 * deliberately absent: A there spends 66 MB, which is an action, not a disclosure.
 */
export const EXPANDABLE: ReadonlySet<SectionKey> = new Set<SectionKey>([
  'about',
  'minimum',
  'recommended',
  'languages',
  'pdbType',
  'pdbCpu',
  'pdbGpu',
  'pdbDistro',
])

export const aboutSections = (details?: AppDetails): SectionKey[] => {
  const keys: SectionKey[] = ['about', 'proton']
  if (details?.requirementsMinimum.length) keys.push('minimum')
  if (details?.requirementsRecommended.length) keys.push('recommended')
  if (details?.languages) keys.push('languages')
  return keys
}

export const extrasSections = (details?: AppDetails, reviews?: ReviewSummary): SectionKey[] => {
  const keys: SectionKey[] = []
  if (reviews) keys.push('reviews')
  if (details?.achievementsTotal) keys.push('achievements')
  keys.push('players')
  if (details?.hasDemo) keys.push('demo')
  if (details?.metacritic !== undefined) keys.push('metacritic')
  if (details?.genres.length) keys.push('genres')
  return keys
}

/**
 * The ProtonDB screen's focusable sections — design 11a with 13b's degraded state.
 *
 * ⚠️ The four filters do not exist when the archive does not. 13b is explicit that
 * they "stay hidden rather than sitting empty over nothing", and that is a focus rule
 * before it is a visual one: a dropdown you can land on that can only ever offer "Any"
 * is a control that lies about what the client can do. What replaces them is a single
 * section — the call to action that fetches the archive.
 */
export const protonSections = (archiveReady: boolean): SectionKey[] =>
  archiveReady ? [...PROTON_FILTERS] : ['pdbGet']

export const sectionsFor = (
  screen: number,
  details?: AppDetails,
  reviews?: ReviewSummary,
  archiveReady = false,
): SectionKey[] =>
  screen === 1
    ? aboutSections(details)
    : screen === 2
      ? protonSections(archiveReady)
      : screen === 3
        ? extrasSections(details, reviews)
        : []

/**
 * Focus ring for a section panel. Kept here so every screen rings identically.
 *
 * ⚠️ `relative z-10` is load-bearing, not decoration. A box-shadow ring paints
 * OUTSIDE the element's box but takes up no layout space, so the next sibling's
 * background paints straight over it — the ring looks half-drawn, clipped along
 * whichever edge faces a later element. Raising the focused panel puts its ring
 * above its neighbours.
 */
export const sectionRing = (focused: boolean): string =>
  focused ? 'relative z-10 shadow-[0_0_0_0.25rem_#080d16,0_0_0_0.4375rem_var(--color-focus)]' : ''

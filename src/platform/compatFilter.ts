import type { Settings } from './settings'
import type { DeckCompat, StoreItem } from '../types/steam'

/**
 * The Compatibility page, applied.
 *
 * > This page decides what the store is even allowed to show you.
 *
 * ⚠️ One function, called from every surface that produces a list, rather than a
 * filter written into each of them. Four surfaces disagreeing about what "hidden"
 * means is how a game ends up on the home shelves and missing from a tag it belongs
 * to — and the user has no way to tell that from a Steam ranking quirk.
 *
 * ⚠️ Applied at hydration, never at render. A tile that appears and then vanishes when
 * its rating arrives is worse than one that was never there: focus can already be on
 * it, and the row silently renumbers underneath the cursor.
 */

const RANK: Record<DeckCompat, number> = {
  unsupported: 1,
  playable: 2,
  verified: 3,
  unknown: 0,
}

const FLOOR: Record<Settings['deckFloor'], number> = {
  all: 0,
  playable: 2,
  verified: 3,
}

/**
 * ⚠️ `unknown` is NOT below the floor. Valve has rated a small fraction of the
 * catalogue, so treating "no verdict" as "fails the bar" would empty most tags —
 * a floor of Verified would hide almost every indie game on Steam, including ones
 * that run perfectly. Absence of a verdict is absence of information, and the
 * `Hide unrated` row is where someone says they want it treated as a failure.
 */
const passes = (item: StoreItem, settings: Settings): boolean => {
  const verdict = item.deckCompat ?? 'unknown'
  if (verdict === 'unknown') return !settings.hideUnrated
  return RANK[verdict] >= FLOOR[settings.deckFloor]
}

/**
 * Filter, then partition.
 *
 * ⚠️ The sort is **stable and partition-only** — native builds move ahead of Proton
 * ones and nothing else changes. Steam's own ordering inside each group is the answer
 * to whatever question produced the list (top sellers, most reviewed, release date),
 * and re-sorting across it would quietly replace that answer with ours.
 */
export const applyCompatFilter = (items: readonly StoreItem[], settings: Settings): StoreItem[] => {
  const kept = items.filter((item) => passes(item, settings))
  if (!settings.nativeLinuxFirst) return kept
  return [
    ...kept.filter((item) => item.linuxAvailable),
    ...kept.filter((item) => !item.linuxAvailable),
  ]
}

/**
 * Whether the filter is doing anything, so a screen can say why it is short.
 *
 * ⚠️ An empty shelf with no explanation reads as a broken store. This is what lets
 * "Nothing to show for this tag" become "Nothing at Verified or better".
 */
export const compatFilterActive = (settings: Settings): boolean =>
  settings.deckFloor !== 'all' || settings.hideUnrated

import type { ControllerSupport, DeckCompat } from '../types/steam.ts'

/**
 * Compatibility facts hiding in the `GetItems` response.
 *
 * ⭐ Both of these were already arriving in the batched hydration request and being
 * thrown away — `src/platform/steam.ts` has sent `include_platforms: true` since it was
 * written, and `categories` comes back unasked. Reading them costs **no extra request**.
 *
 * That matters twice over. `controllerSupport` is what fills the design's "Full
 * controller support" badge, which had no source. And `deckCompat` closes the gap the
 * design's own notes record as *"Deck compatibility status ... has no verified endpoint
 * yet"* — it was in a response we already had.
 *
 * ⚠️ A leaf module on purpose. The test runner is plain `node --experimental-strip-types`
 * (see package.json), which cannot load `steam.ts` — that file's relative imports carry
 * no `.ts` extensions and it pulls in the Tauri transport. Keeping these two pure
 * functions dependency-free is what makes them testable at all, the same reason
 * `contentFilter.ts` stands alone.
 */

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined

/** Steam's store category for Full Controller Support. */
const CATEGORY_FULL_CONTROLLER = 28
/** ...and for Partial. */
const CATEGORY_PARTIAL_CONTROLLER = 18

/**
 * Gamepad support, from `categories.controller_categoryids`.
 *
 * Verified against 18 apps, 2026-08-21:
 *
 * ```
 * Stardew Valley [28] · Cyberpunk 2077 [28,55,57,58] · Half-Life 2 [28,55,56,57,58,59]
 * Factorio [55,56,57,58,18] · RimWorld [18]
 * Counter-Strike 2, Dota 2, Civ VI, EU4, Stellaris, Hearts of Iron IV → key ABSENT
 * ```
 *
 * Two things that array will mislead you about:
 *
 * 1. **The ids are not ordered or exclusive.** Factorio's `18` arrives last, after four
 *    unrelated entries. Reading `ids[0]`, or assuming a single-element array, gets both
 *    of the partial-support titles wrong.
 * 2. **55-59 are input-configuration metadata, not support claims.** They travel
 *    alongside real support often enough to look like it, but a game carrying only
 *    those has no gamepad support.
 *
 * ⚠️ Steam **omits the key** rather than sending `[]`, so an absent key is a real
 * "none". The "not hydrated yet" case is `undefined` at the call site and is
 * deliberately not represented here — see `StoreItem.controllerSupport`.
 */
export const controllerSupportFrom = (categories: unknown): ControllerSupport => {
  const ids = asRecord(categories)?.controller_categoryids
  if (!Array.isArray(ids)) return 'none'
  if (ids.includes(CATEGORY_FULL_CONTROLLER)) return 'full'
  return ids.includes(CATEGORY_PARTIAL_CONTROLLER) ? 'partial' : 'none'
}

/**
 * Valve's Deck verdict, from `platforms.steam_deck_compat_category`.
 *
 * Verified 2026-08-21 against Valve's published ratings, ten for ten: Stardew Valley,
 * Cyberpunk 2077, Terraria, Slay the Spire, Hades, Fallout 4, Half-Life 2 and Factorio
 * all report `3`; Counter-Strike 2, Dota 2 and Space Marine II all report `2`.
 *
 * ⚠️ Three near-identical siblings sit in the same object and disagree —
 * `steam_os_compat_category`, `steam_frame_compat_category`,
 * `steam_machine_compat_category`. Stardew Valley is Deck `3` but SteamOS `2`. Reading
 * the wrong one is a silent downgrade, not an error.
 *
 * An unrecognised number degrades to `unknown` rather than throwing: Valve has grown
 * this enum before (two of those siblings are newer than the Deck one), and a store
 * that crashes on an unfamiliar integer is worse than one that stays quiet about
 * compatibility.
 */
/**
 * Whether the app ships a native Linux build.
 *
 * ⚠️ The key is `steamos_linux`, not `linux` — verified 2026-08-22 against
 * `GetItems` with `include_platforms`: Stardew Valley (413150) returns
 * `{windows: true, mac: true, steamos_linux: true, ...}` and ELDEN RING (1245620)
 * returns `{windows: true, ...}` with the key simply absent. `appdetails` calls the
 * same fact `platforms.linux`, so the two are NOT interchangeable, and reading the
 * wrong one gives a silent `false` for every game on earth.
 */
export const linuxNativeFrom = (platforms: unknown): boolean =>
  asRecord(platforms)?.steamos_linux === true

export const deckCompatFrom = (platforms: unknown): DeckCompat => {
  const category = asRecord(platforms)?.steam_deck_compat_category
  switch (category) {
    case 1:
      return 'unsupported'
    case 2:
      return 'playable'
    case 3:
      return 'verified'
    default:
      return 'unknown'
  }
}

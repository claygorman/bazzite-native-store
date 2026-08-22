import { steamSessionGet } from './steamSession'

/**
 * What the local Steam client knows about this account.
 *
 * ⚠️ Parsed HERE, not in Rust. The Rust side is a fetcher and deliberately does not
 * know Steam's shapes — one parser, not two (src/types/steam.ts). That rule is why the
 * session primitive returns a raw body.
 */
export type SteamLibrary = {
  owned: number[]
  /** Read because it is free in the same call. No UI yet. */
  wishlist: number[]
}

const appids = (value: unknown): number[] =>
  Array.isArray(value)
    ? value
        // Steam is inconsistent about the type across this payload's id arrays, so
        // accept both rather than silently returning an empty library.
        .map((v) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN))
        .filter((n) => Number.isInteger(n) && n > 0)
    : []

export const loadSteamLibrary = async (): Promise<SteamLibrary | undefined> => {
  const json = await steamSessionGet('/dynamicstore/userdata/')
  const root = json as { rgOwnedApps?: unknown; rgWishlist?: unknown } | undefined
  if (!root || typeof root !== 'object') return undefined

  const owned = appids(root.rgOwnedApps)
  /*
   * ⚠️ An EMPTY owned list is treated as "we did not really get an answer".
   *
   * A genuinely empty Steam library is possible but vanishingly rare, whereas an empty
   * array is what every one of the silent-failure modes produces — the personalization
   * trap this project has now hit four times (private/STEAM-ENDPOINTS.md). Given a choice
   * between showing no badges and confidently telling someone they own nothing, no
   * badges is the honest one.
   */
  if (owned.length === 0) return undefined

  return { owned, wishlist: appids(root.rgWishlist) }
}

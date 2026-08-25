/**
 * The two decisions read-through makes, extracted so they can be tested.
 *
 * ⚠️ **Why a module and not two `filter` calls inline.** Both rules are one line and both
 * are load-bearing in a way a one-liner does not advertise, and this codebase has twice
 * watched exactly that shape rot — `compatGetsOwnRow` and `priceGoesTo` were each an
 * obvious inline condition whose premise quietly stopped holding, with no failure until
 * someone looked at a television. The dangerous one here is `writeBack`: getting it wrong
 * produces a cache that works perfectly and never expires, which no amount of staring at
 * the shelf will reveal.
 */

/**
 * The appids that still have to be fetched.
 *
 * ⚠️ Order and duplicates both matter to the caller: the result feeds a `GetItems` batch,
 * and asking for the same id twice wastes nothing but reads as a bug in the log.
 */
export const stillToFetch = (
  appids: readonly number[],
  known: ReadonlyMap<number, unknown>,
): number[] => [...new Set(appids)].filter((appid) => !known.has(appid))

/**
 * The entries that may be written back to the index — the ones that came off the network.
 *
 * ⚠️⚠️ **A cache hit must NEVER be written back.** The write stamps a fresh timestamp, so a
 * row read on every shelf load would keep renewing its own freshness and never expire. The
 * TTL would still be there, still be checked, and mean nothing: whatever the row said the
 * first time it was fetched is what it would say forever. That failure is invisible — the
 * shelf renders, the numbers look plausible, and prices simply stop moving.
 */
export const writeBack = <T>(
  all: ReadonlyMap<number, T>,
  known: ReadonlyMap<number, unknown>,
): [number, T][] => [...all.entries()].filter(([appid]) => !known.has(appid))

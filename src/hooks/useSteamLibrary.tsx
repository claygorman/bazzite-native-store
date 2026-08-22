import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { loadSteamLibrary } from '../platform/steamLibrary'

type Library = {
  /**
   * Whether we managed to read one at all.
   *
   * ⚠️ Added because an empty set could not say why it was empty, and three very
   * different situations produced one: the read has not finished, there is no Steam
   * client to read from, or the account genuinely wishlists nothing. The Up menu has
   * to dim its Wishlist entry for the second and open it for the third, and the
   * Wishlist screen has to say "needs the Steam client" rather than "nothing here".
   */
  status: 'loading' | 'unavailable' | 'ready'
  /** Appids the account owns. Empty until the read resolves, or forever off Bazzite. */
  owned: ReadonlySet<number>
  wishlist: ReadonlySet<number>
}

const EMPTY: Library = { status: 'loading', owned: new Set(), wishlist: new Set() }

const LibraryContext = createContext<Library>(EMPTY)

/**
 * Owned games and wishlist, loaded once and shared.
 *
 * ⚠️ Deliberately NOT threaded through the data layer. `owned` is not a property of a
 * store listing — it is a property of *this machine's account* — and stamping it during
 * hydration would mean passing the set into six `fetchStoreItems` call sites across five
 * files. Worse, hydration runs before this read resolves, so those items would be
 * normalized with `owned: undefined` and never re-render when the library arrived.
 *
 * A context read at the card boundary is one line per surface and is naturally
 * reactive: badges appear the moment the library lands, with no refetch and no
 * invalidation scheme.
 *
 * Loaded once per launch. A library changes when someone buys something, which is not
 * a thing to poll for on a store screen — and every failure mode already degrades to
 * "no badges".
 */
export const SteamLibraryProvider = ({ children }: { children: ReactNode }) => {
  const [library, setLibrary] = useState<Library>(EMPTY)

  useEffect(() => {
    let cancelled = false
    void loadSteamLibrary().then((result) => {
      if (cancelled) return
      setLibrary(
        result
          ? { status: 'ready', owned: new Set(result.owned), wishlist: new Set(result.wishlist) }
          : { ...EMPTY, status: 'unavailable' },
      )
    })
    return () => {
      cancelled = true
    }
  }, [])

  return <LibraryContext.Provider value={library}>{children}</LibraryContext.Provider>
}

export const useSteamLibrary = (): Library => useContext(LibraryContext)

/**
 * Whether this account owns a game.
 *
 * ⚠️ Returns `true` or `undefined`, never `false`. An absent library and a game you do
 * not own look identical from here, and `StoreCard` renders the badge only on `true` —
 * so "we have no library" can never be mistaken for "you do not own this". That
 * distinction is the whole reason this route was chosen over a Web API key.
 */
export const useOwned = (appid: number): true | undefined => {
  const { owned } = useSteamLibrary()
  return owned.has(appid) ? true : undefined
}

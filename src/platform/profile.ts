import { steamGet } from './transport'

/**
 * Steam profile — persona name and avatar, **with no Web API key**.
 *
 * `steamcommunity.com/profiles/<steamid64>?xml=1` serves the public profile as XML
 * and requires no authentication at all. That matters: it means the account chip
 * works the moment someone signs in, with nothing to register and no secret to keep.
 *
 * `GetPlayerSummaries` returns the same fields but needs a key, so it is not worth
 * it for this. The key is still required for owned games and wishlist, which this
 * route does not carry.
 *
 * Verified 2026-08-20: 200, ~5.9 KB, carrying steamID, avatarFull and privacyState.
 */
export type SteamProfile = {
  steamid: string
  personaname?: string
  avatarfull?: string
  /** 'public' | 'private' | … — Steam's own wording. */
  privacy?: string
}

const textOf = (doc: Document, tag: string): string | undefined => {
  const value = doc.querySelector(tag)?.textContent?.trim()
  return value && value.length > 0 ? value : undefined
}

/**
 * Remembered profiles, so the chip survives a throttled request.
 *
 * ⚠️ This exists because of a real failure, not as an optimisation. Steam answered
 * `HTTP 429` for this endpoint after an afternoon of testing, and with nothing
 * remembered the account chip fell back to the raw SteamID64 — on every launch, for as
 * long as the throttle lasted, because a FAILURE is not cached and so every launch
 * tried again and failed again.
 *
 * ⚠️ A persona name and an avatar change perhaps twice a year. A week is not a
 * compromise here; re-asking Steam every launch for a value that stable is what earned
 * the 429 in the first place.
 */
const REMEMBER_KEY = 'steam-profile'
const REMEMBER_MS = 7 * 24 * 3_600_000

type Remembered = { at: number; profile: SteamProfile }

/** ⚠️ Never throws. localStorage is absent or refuses in more contexts than you expect. */
const remembered = (steamid: string): Remembered | undefined => {
  try {
    const raw = localStorage.getItem(`${REMEMBER_KEY}:${steamid}`)
    if (raw === null) return undefined
    const parsed = JSON.parse(raw) as Partial<Remembered>
    return typeof parsed?.at === 'number' && parsed.profile ? (parsed as Remembered) : undefined
  } catch {
    return undefined
  }
}

const remember = (steamid: string, profile: SteamProfile): void => {
  try {
    localStorage.setItem(
      `${REMEMBER_KEY}:${steamid}`,
      JSON.stringify({ at: Date.now(), profile } satisfies Remembered),
    )
  } catch {
    // A chip that cannot be cached is not a reason to fail the sign-in.
  }
}

export const fetchSteamProfile = async (steamid: string): Promise<SteamProfile | undefined> => {
  const known = remembered(steamid)
  // Fresh enough: do not ask at all. This is the request that was being made on every
  // single launch, for a value that changes twice a year.
  if (known !== undefined && Date.now() - known.at < REMEMBER_MS) return known.profile

  try {
    const xml = await steamGet({
      host: 'community',
      path: `/profiles/${steamid}`,
      query: { xml: 1 },
      as: 'text',
      ttlSeconds: 3_600,
    })
    if (typeof xml !== 'string') return undefined

    const doc = new DOMParser().parseFromString(xml, 'text/xml')
    // A private or unconfigured profile still returns 200 with a sparse document,
    // so treat missing fields as "not shared", never as an error.
    const profile: SteamProfile = {
      steamid,
      personaname: textOf(doc, 'steamID'),
      avatarfull: textOf(doc, 'avatarFull'),
      privacy: textOf(doc, 'privacyState'),
    }
    // ⚠️ Only remember an answer that carries a name. A sparse document is a valid
    // response and a useless thing to cache for a week — it would pin the chip to
    // "Signed in" long after the real cause had cleared.
    if (profile.personaname !== undefined) remember(steamid, profile)
    return profile
  } catch {
    /*
     * ⚠️ The STALE profile, not `undefined`. This is the 429 path, and a name from last
     * week is enormously better than falling back to no name at all — Steam throttling
     * us is not a reason to stop knowing who the user is.
     */
    return known?.profile
  }
}

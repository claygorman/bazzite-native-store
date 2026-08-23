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

export const fetchSteamProfile = async (steamid: string): Promise<SteamProfile | undefined> => {
  try {
    const xml = await steamGet({
      host: 'community',
      path: `/profiles/${steamid}`,
      query: { xml: 1 },
      as: 'text',
      /*
       * ⚠️ A WEEK, and the hour it replaced is what earned an HTTP 429.
       *
       * A persona name and an avatar change perhaps twice a year, and this was being
       * re-asked on every launch. Steam throttled it — the chip then fell back to the
       * raw SteamID64 because there was nothing cached to fall back to: until the
       * borrowed Steam-client identity started working, this request had never once
       * been made, so its very first call was the one that got refused.
       *
       * ⚠️ Deliberately the EXISTING cache rather than a second one in the frontend.
       * `steam.rs` already serves stale-if-error — on a 429 or a 500 it returns any
       * cached entry regardless of age — so one success here makes the chip permanently
       * resilient to throttling. A parallel localStorage cache would duplicate that and
       * give two answers to age the same fact.
       */
      ttlSeconds: 7 * 24 * 3_600,
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
    return profile
  } catch {
    // The transport already tried the stale cache before throwing; reaching here means
    // there is genuinely nothing. The chip says "Signed in" rather than inventing a name.
    return undefined
  }
}

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
      ttlSeconds: 3_600,
    })
    if (typeof xml !== 'string') return undefined

    const doc = new DOMParser().parseFromString(xml, 'text/xml')
    // A private or unconfigured profile still returns 200 with a sparse document,
    // so treat missing fields as "not shared", never as an error.
    return {
      steamid,
      personaname: textOf(doc, 'steamID'),
      avatarfull: textOf(doc, 'avatarFull'),
      privacy: textOf(doc, 'privacyState'),
    }
  } catch {
    return undefined
  }
}

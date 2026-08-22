/**
 * Adult-content filtering.
 *
 * ⚠️ This is not optional polish. The store endpoints are an API, not the storefront:
 * `featuredcategories` returns whatever is selling, with **no content filtering at all**,
 * because the filtering users see on store.steampowered.com is applied by the web
 * frontend from account preferences we do not have. Rendering the raw response puts
 * adult titles on a living-room television.
 *
 * Steam labels items with `content_descriptorids`. Verified against the live home rows
 * 2026-08-21 — 18 of 54 items carried at least one:
 *
 * | id | meaning                          |
 * |----|----------------------------------|
 * | 1  | Some Nudity or Sexual Content    |
 * | 2  | Frequent Violence or Gore        |
 * | 3  | **Adult Only Sexual Content**    |
 * | 4  | **Frequent Nudity or Sexual Content** |
 * | 5  | General Mature Content           |
 *
 * The split has to be exactly 3-and-4, and the observed data shows why:
 *
 * ```
 * [1,3,4,5]  Big Tiddy Goth Baddie, TOYS 18+, Sky Yacht - Waves of Desire   ← hide
 * [1,2,3,4,5] My Sexy Fairies                                              ← hide
 * [1,5]      Persona 3 Reload, Persona 5 Royal                             ← KEEP
 * [2,5]      Call of Duty, S.T.A.L.K.E.R. 2, Black Myth: Wukong            ← KEEP
 * ```
 *
 * Filtering on descriptor 1 as well would remove Persona; filtering only on 3 would miss
 * nothing today but leaves no margin. 3-or-4 matches what Steam itself hides from an
 * account that has not opted in.
 *
 * ⚠️ Absence of descriptors is NOT proof an item is safe — it means Steam has not
 * labelled it. 36 of those 54 items carried none at all. This filter removes what is
 * labelled adult; it is not a guarantee, and it should never be described as one.
 */
export const CONTENT_DESCRIPTOR = {
  someNudityOrSexual: 1,
  frequentViolenceOrGore: 2,
  adultOnlySexual: 3,
  frequentNudityOrSexual: 4,
  generalMature: 5,
} as const

/** Hidden unless the user has explicitly opted in — which we have no way to ask. */
const HIDDEN_DESCRIPTORS: readonly number[] = [
  CONTENT_DESCRIPTOR.adultOnlySexual,
  CONTENT_DESCRIPTOR.frequentNudityOrSexual,
]

/**
 * True when an item is labelled adult and should not be shown.
 *
 * `undefined` descriptors mean "not hydrated yet", which is deliberately treated as NOT
 * excluded — the caller's job is to avoid painting unhydrated items at all, rather than
 * to guess here. See `useHydratedRows`.
 */
export const isAdultContent = (descriptors: readonly number[] | undefined): boolean =>
  descriptors !== undefined && descriptors.some((id) => HIDDEN_DESCRIPTORS.includes(id))

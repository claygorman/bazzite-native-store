import { isTauri } from './index'

/**
 * A read performed inside the Steam client's own logged-in browser.
 *
 * ⭐ The only route to Steam's personalized endpoints that needs **no Web API key and
 * no public-profile requirement**. See `src-tauri/src/steamclient.rs` for how, and
 * private/AUTH-AND-CART.md for why it is a legitimate thing to do.
 *
 * ⚠️ The Rust side enforces an **allowlist of read-only paths**. A path that is not on
 * it never reaches the network — because "we promise not to POST to the cart" is a
 * weaker guarantee than "it cannot". Adding a path means editing `ALLOWED_PATHS`.
 *
 * ⚠️ Enhancement layer, exactly like `display.ts`: `undefined` in the browser, off
 * Bazzite, without Steam running, and on any failure. Every caller must have a path
 * that works without it.
 */
export const steamSessionGet = async (
  path: string,
  query: Record<string, string | number> = {},
): Promise<unknown> => {
  if (!isTauri()) return undefined
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const body = await invoke<string | null>('steam_session_get', {
      path,
      query: Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])),
    })
    if (body === null || body === undefined) return undefined
    return JSON.parse(body)
  } catch {
    // Includes a body that is not JSON, which is what an interstitial or an error page
    // looks like from in there.
    return undefined
  }
}

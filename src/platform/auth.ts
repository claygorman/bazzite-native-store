import { isTauri } from './index'
import { fetchSteamProfile } from './profile'

/**
 * Steam sign-in.
 *
 * OpenID 2.0 — the only account integration Valve sanctions. The user authenticates
 * on Steam's own page; we never see a password and never store one.
 *
 * ⚠️ What comes back is a SteamID64 and nothing more. This is authentication, not
 * authorization. It cannot add to a cart or a wishlist — SteamDB, signed in with
 * this exact flow, still has its Wishlist button disabled for the same reason. Those
 * actions are handed to the already-signed-in Steam client via `steam://`.
 * See private/AUTH-AND-CART.md.
 *
 *   tauri -> Rust spawns a throwaway 127.0.0.1 listener and opens the system browser
 *   web   -> the Vite dev server handles the redirect (vite-plugins/steam-auth.ts)
 *
 * Both verify the assertion with `openid.mode=check_authentication` before trusting
 * it. Without that step a sign-in is trivially forgeable.
 */

export type SteamPlayer = {
  steamid: string
  personaname?: string
  avatarfull?: string
  profileurl?: string
}

export type SessionState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  /**
   * The server is not offering sign-in at all — the public demo, which keeps it off by
   * default. Distinct from `signed-out` on purpose: signed-out shows a button, and a
   * button that cannot work is worse than a sentence saying so.
   */
  | { status: 'unavailable' }
  | {
      status: 'signed-in'
      steamid: string
      player?: SteamPlayer
      /** Steam's own wording, e.g. 'public'. Private profiles hide library/wishlist. */
      privacy?: string
    }

export const signIn = async (): Promise<string | undefined> => {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<string>('steam_login')
  }
  // Full-page redirect: Steam will not render inside an iframe or a popup we own,
  // and the user should see the real steamcommunity.com in their address bar.
  window.location.href = '/auth/steam/login'
  return undefined
}

export const signOut = async (): Promise<void> => {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('steam_logout')
    return
  }
  window.location.href = '/auth/steam/logout'
}

const steamidOf = async (): Promise<string | typeof DISABLED | undefined> => {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    return (await invoke<string | null>('steam_session')) ?? undefined
  }
  const session = (await (await fetch('/auth/steam/session')).json()) as {
    steamid: string | null
    loginDisabled?: boolean
  }
  if (session.loginDisabled === true) return DISABLED
  return session.steamid ?? undefined
}

/** Sentinel so `steamidOf` can report "not offered" through a string-or-undefined return. */
const DISABLED = Symbol('login-disabled')

export const loadSession = async (): Promise<SessionState> => {
  const steamid = await steamidOf()
  if (steamid === DISABLED) return { status: 'unavailable' }
  if (!steamid) return { status: 'signed-out' }

  // Name and avatar come from the KEYLESS community profile XML, so the chip is
  // complete the moment someone signs in — nothing to register. A Web API key is
  // still needed for owned games and wishlist, which that route does not carry.
  const profile = await fetchSteamProfile(steamid)

  return {
    status: 'signed-in',
    steamid,
    player: profile
      ? {
          steamid,
          personaname: profile.personaname,
          avatarfull: profile.avatarfull,
        }
      : undefined,
    privacy: profile?.privacy,
  }
}

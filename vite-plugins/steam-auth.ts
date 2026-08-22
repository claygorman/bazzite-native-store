import type { Connect, Plugin } from 'vite'
import type { ServerResponse } from 'node:http'

/**
 * Steam OpenID 2.0 sign-in for the BROWSER dev build.
 *
 * The Tauri build does this in Rust (src-tauri/src/auth.rs); this plugin gives the
 * `pnpm dev` build the same capability so the account UI can be developed without
 * building the desktop app.
 *
 * Why a server-side middleware at all: the final verification step is a POST to
 * Steam that a browser cannot make (no CORS), and must not be trusted to the client
 * anyway. Confirmed against the live endpoint — replaying an assertion with a forged
 * signature answers `is_valid:false`, which is the whole point of the step.
 *
 * ⚠️ There is no `/auth/steam/player` route. There was one, using `STEAM_API_KEY` to
 * enrich the account chip, and nothing ever called it — the chip's name and avatar come
 * from the KEYLESS community profile XML (`platform/profile.ts`). Removed 2026-08-21
 * rather than left as the repo's only reason to hold a Web API key.
 *
 * ⚠️ This is a DEV-SERVER session, not a security boundary. The cookie holds a plain
 * SteamID64 the user could edit themselves; the only thing it would let them do is
 * view their own app as someone else. Nothing here handles credentials or money —
 * purchase and cart are never reimplemented (private/AUTH-AND-CART.md).
 */

const OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login'
const OPENID_NS = 'http://specs.openid.net/auth/2.0'
const IDENTIFIER_SELECT = 'http://specs.openid.net/auth/2.0/identifier_select'

export const SESSION_COOKIE = 'bzstore_steamid'

/** Steam only ever returns this shape; anything else is not a Steam identity. */
const CLAIMED_ID_RE = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/

/**
 * Origin the user is actually on.
 *
 * ⚠️ MUST be derived from the request, never hardcoded to localhost. Steam requires
 * `return_to` to sit under `realm`, and this dev server is reached both as
 * `localhost:1420` and as a LAN address from another machine — a hardcoded origin
 * sends the user back to a host their browser cannot reach.
 */
const originOf = (req: Connect.IncomingMessage): string => {
  const host = req.headers.host ?? 'localhost:1420'
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http'
  return `${proto}://${host}`
}

const redirect = (res: ServerResponse, location: string) => {
  res.statusCode = 302
  res.setHeader('Location', location)
  res.end()
}

const readCookie = (req: Connect.IncomingMessage, name: string): string | undefined =>
  req.headers.cookie
    ?.split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === name)?.[1]

export const steamAuthPlugin = (): Plugin => ({
  name: 'steam-auth-dev',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url ?? '/', originOf(req))

      // --- Begin sign-in: hand the user to Steam's own page. ---
      if (url.pathname === '/auth/steam/login') {
        const origin = originOf(req)
        const params = new URLSearchParams({
          'openid.ns': OPENID_NS,
          'openid.mode': 'checkid_setup',
          'openid.return_to': `${origin}/auth/steam/return`,
          'openid.realm': origin,
          'openid.identity': IDENTIFIER_SELECT,
          'openid.claimed_id': IDENTIFIER_SELECT,
        })
        return redirect(res, `${OPENID_ENDPOINT}?${params}`)
      }

      // --- Steam redirects back here. Verify before believing anything. ---
      if (url.pathname === '/auth/steam/return') {
        const claimedId = url.searchParams.get('openid.claimed_id') ?? ''
        const match = CLAIMED_ID_RE.exec(claimedId)

        // Echo every openid.* parameter back with mode=check_authentication. Skipping
        // this makes login trivially forgeable — a client could simply assert any
        // SteamID it liked.
        const verification = new URLSearchParams()
        for (const [key, value] of url.searchParams) {
          if (key.startsWith('openid.')) verification.set(key, value)
        }
        verification.set('openid.mode', 'check_authentication')

        let valid = false
        try {
          const response = await fetch(OPENID_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: verification,
          })
          valid = /is_valid\s*:\s*true/.test(await response.text())
        } catch {
          valid = false
        }

        // Also confirm the assertion was addressed to THIS app, so a response
        // captured elsewhere cannot be replayed here.
        const returnTo = url.searchParams.get('openid.return_to') ?? ''
        const addressedHere = returnTo.startsWith(originOf(req))

        if (!valid || !match || !addressedHere) {
          return redirect(res, '/?auth=failed')
        }

        res.setHeader(
          'Set-Cookie',
          `${SESSION_COOKIE}=${match[1]}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
        )
        return redirect(res, '/?auth=ok')
      }

      // --- Who am I? ---
      if (url.pathname === '/auth/steam/session') {
        const steamid = readCookie(req, SESSION_COOKIE)
        res.setHeader('Content-Type', 'application/json')
        return res.end(JSON.stringify({ steamid: steamid ?? null }))
      }

      if (url.pathname === '/auth/steam/logout') {
        res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`)
        return redirect(res, '/')
      }

      next()
    })
  },
})

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

/**
 * Steam OpenID for the demo server — the same flow as `vite-plugins/steam-auth.ts`,
 * which is the dev-server copy, and `src-tauri/src/auth.rs`, which is the real one.
 *
 * ⚠️ **Off by default.** Set `DEMO_ALLOW_LOGIN=1` to enable it. A public demo that
 * invites strangers to sign in collects real SteamID64s in a cookie on someone else's
 * server, and it buys them almost nothing — a session only unlocks owned/wishlist
 * enhancement (private/AUTH-AND-CART.md), and every screen is built to work without one.
 *
 * When it is off the routes are not merely absent: `/auth/steam/session` reports
 * `loginDisabled`, so the account chip can say sign-in is unavailable rather than
 * offering a button that goes nowhere. A control that does nothing is the bug fixed in
 * 3e48ac0, and a 404 behind a visible button is the same bug wearing a hat.
 */

const OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login'
const OPENID_NS = 'http://specs.openid.net/auth/2.0'
const IDENTIFIER_SELECT = 'http://specs.openid.net/auth/2.0/identifier_select'

export const SESSION_COOKIE = 'bzstore_steamid'

/** Steam only ever returns this shape; anything else is not a Steam identity. */
const CLAIMED_ID_RE = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/

/**
 * ⚠️ Derived from the request, never hardcoded. Steam requires `return_to` to sit under
 * `realm`, so a demo reached at its public hostname must not send users to localhost.
 * `trustProxy` is what makes `request.protocol` honest behind a TLS terminator.
 */
const originOf = (request: FastifyRequest): string =>
  `${request.protocol}://${request.headers.host ?? 'localhost:8080'}`

const readCookie = (request: FastifyRequest, name: string): string | undefined =>
  request.headers.cookie
    ?.split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === name)?.[1]

export const registerAuth = (app: FastifyInstance): void => {
  const enabled = process.env.DEMO_ALLOW_LOGIN === '1'

  app.get('/auth/steam/session', async (request, reply: FastifyReply) => {
    if (!enabled) return reply.send({ steamid: null, loginDisabled: true })
    return reply.send({ steamid: readCookie(request, SESSION_COOKIE) ?? null })
  })

  if (!enabled) return

  app.get('/auth/steam/login', async (request, reply) => {
    const origin = originOf(request)
    const params = new URLSearchParams({
      'openid.ns': OPENID_NS,
      'openid.mode': 'checkid_setup',
      'openid.return_to': `${origin}/auth/steam/return`,
      'openid.realm': origin,
      'openid.identity': IDENTIFIER_SELECT,
      'openid.claimed_id': IDENTIFIER_SELECT,
    })
    return reply.redirect(`${OPENID_ENDPOINT}?${params}`)
  })

  app.get('/auth/steam/return', async (request, reply) => {
    const url = new URL(request.url, originOf(request))
    const match = CLAIMED_ID_RE.exec(url.searchParams.get('openid.claimed_id') ?? '')

    /*
     * ⚠️ Echo every openid.* parameter back with mode=check_authentication and believe
     * nothing until Steam says `is_valid:true`. Skipping this makes sign-in trivially
     * forgeable — a client could assert any SteamID it liked. Verified against the live
     * endpoint: a replayed assertion with a forged signature answers `is_valid:false`.
     */
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
        signal: AbortSignal.timeout(15_000),
      })
      valid = /is_valid\s*:\s*true/.test(await response.text())
    } catch {
      valid = false
    }

    // And that the assertion was addressed to THIS host, so one captured elsewhere
    // cannot be replayed here.
    const addressedHere = (url.searchParams.get('openid.return_to') ?? '').startsWith(
      originOf(request),
    )

    if (!valid || !match || !addressedHere) return reply.redirect('/?auth=failed')

    return reply
      .header(
        'set-cookie',
        `${SESSION_COOKIE}=${match[1]}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=2592000`,
      )
      .redirect('/?auth=ok')
  })

  app.get('/auth/steam/logout', async (_request, reply) =>
    reply.header('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`).redirect('/'),
  )
}

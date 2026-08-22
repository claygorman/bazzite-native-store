# Hosting the demo

The product is a Tauri binary on a Bazzite box. This is the other thing: a small
Fastify server that serves the web build so the app can be shown to someone without
them installing anything.

```sh
pnpm demo              # build + run on :8080
PORT=8099 pnpm demo    # or pick a port
docker build -t bazzite-store-demo . && docker run -p 8080:8080 bazzite-store-demo
```

⚠️ **Nothing in the desktop build may come to depend on this.** The web path exists
because it makes development fast and the demo possible; the shipping target is
`pnpm tauri build`.

## What the server does that the browser cannot

**Proxies four upstreams.** `/steam-store`, `/steam-community`, `/steam-api`,
`/protondb` — the same prefixes `vite.config.ts` proxies in dev, so dev and demo see
identical data.

⚠️ **The headers are load-bearing and must match `vite.config.ts` exactly.** Steam
**403s** a request whose `Origin`/`Referer` point elsewhere, and it silently **strips
fields** when the `User-Agent` is not a browser (`private/STEAM-URL-REFERENCE.md` §9). That
second failure is the dangerous one: the call succeeds and merely returns less, so the
symptom is a missing price rather than an error. ProtonDB is proxied for a different
reason — it pins `access-control-allow-origin` to its own domain, so a browser tab
cannot call it at all.

**Caches, which is what makes a public demo viable.**

## ⚠️ The rate limit is the whole problem

Steam allows roughly **200 requests per 5 minutes per IP**, and behind a server every
visitor shares one IP. The desktop build survives this on its Rust disk cache. The
browser build has only an in-memory cache that dies with the tab — so without a cache
here, the fourth person to open the demo gets an empty store.

`server/cache.ts` does three things, and the second is the one a plain cache misses:

|                              |                                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **TTL cache**                | keyed on the full upstream URL. Repeat visitors cost nothing.                                                                                                      |
| **In-flight de-duplication** | ten people opening the page at once produce **one** upstream request. A cold cache plus a launch burst is exactly how a demo gets rate-limited.                    |
| **Serve-stale-on-failure**   | if the upstream 429s or dies, an expired entry is returned instead of an error — endpoint rule 3 (_never let a dead endpoint blank the UI_) applied one layer out. |

Measured on a cold cache, 12 simultaneous identical requests:

```
{ entries: 1, hits: 0, misses: 1, coalesced: 11, staleServed: 0, upstream: 1 }
```

`GET /_demo/stats` returns that live, and every proxied response carries
`x-demo-cache: hit | miss | coalesced | stale`.

**TTLs come from the call sites, not from the server.** `steamGet` already declares one
per endpoint class (home rows 5 min, app facts 6 h, tag names 24 h); the browser
forwards it as `x-steam-ttl` and the server clamps it to 30s–24h. One source of truth,
and a crafted header can neither poison nor bypass the cache. Only 2xx responses are
cached — storing a 429 would turn a momentary rate-limit into a TTL-long outage.

## Sign-in is off by default

`DEMO_ALLOW_LOGIN=1` enables the Steam OpenID routes. Leave it off for anything public:
a demo that invites strangers to sign in collects real SteamID64s in a cookie on your
server, and buys them almost nothing — a session only unlocks owned/wishlist
enhancement (`private/AUTH-AND-CART.md`), and every screen is built to work without one.

When it is off, `/auth/steam/session` reports `loginDisabled` and the account chip says
**"Demo — sign-in off"** rather than offering a button that goes nowhere.

⚠️ With it on, run behind TLS. The session cookie is `Secure`, and the OpenID `realm`
is derived from the request — `trustProxy` is set so `x-forwarded-proto` is honoured,
or a demo served over https would send users back to an http `return_to`.

## What a visitor gets

Everything except the desktop-only paths. Home shelves, search, browse-by-tag, details,
the calendar, microtrailers — all real live Steam data.

- **Controllers work.** The web build polls the browser Gamepad API
  (`subscribeGamepadWeb`); the desktop build uses `gilrs` in Rust and never starts that
  poll. A visitor with a pad in Chrome gets the real thing. Keyboard mirrors it.
- **"Open in Steam" deep-links** still emit `steam://store/<appid>`, which works if the
  visitor has Steam installed and is otherwise ignored.
- **Nothing owned, wishlisted, or personalized** — that is true of the desktop build
  signed out too, and every one of those affordances is deliberately unrendered rather
  than shown dead.

## Sizing

The build is ~1 MB. The server holds at most 2000 cached responses in memory and writes
nothing to disk — a restart simply re-warms. One small replica is plenty; **more
replicas make the rate limit worse, not better**, since each has its own cold cache and
they share the egress IP. If you need resilience, prefer restarts over horizontal scale.

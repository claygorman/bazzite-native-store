# bazzite-native-store

A controller-first, Xbox-style Steam **store** client for Bazzite / SteamOS Game Mode.

Big Picture's store tab is literally the Steam website rendered in CEF. It's a desktop web page
with a controller bolted on: tiny hit targets, hover states that mean nothing on a dpad, and a
layout designed for a mouse three feet closer than a couch. This replaces that browsing experience
with a real TV UI.

**Status:** working. Home shelves, search, browse-by-tag, game details with trailers, a personal
release calendar, a wishlist read from the local Steam client, and a full settings screen — all on
live Steam data, driven entirely by a controller. Not yet run on the target television.

---

## 1. The constraint that shapes everything

> **You cannot add an item to Big Picture's left nav from an external app.**

That sidebar (`Store` / `Library` / `Community` …) is Steam's own React frontend — SteamUI, running
inside Steam's embedded Chromium. It is not a system menu, not a `.desktop` file, and there is no
plugin API. The only supported way to inject UI into it is **Decky Loader**, which patches Steam's
frontend at runtime. (You already run Decky — `decky-proton-launch`.)

That gives two viable shapes, and they are genuinely different projects:

### Path A — Decky plugin (_inside_ Steam's UI)

- React + TypeScript against `@decky/ui`, Python backend, loaded by Decky Loader.
- `routerHook.addRoute()` registers a full-screen route; menu entries come from patching Steam's
  nav components.
- ✅ Actually lives in Game Mode. No app switching, inherits Steam's focus/input model.
- ❌ **Fragile.** You are patching an undocumented, minified React tree that Valve rewrites without
  warning. Bazzite 44 renaming the session `steam` → `ogui-steam` is a mild taste of this.
- ❌ Styling is constrained by Steam's CSS. The mockup's full-bleed hero and custom nav rail fight
  the host UI the whole way.

### Path B — Standalone app, added as a non-Steam shortcut ✅ **recommended**

- Own window, own render loop, full-screen in gamescope like any game.
- ✅ **Total design freedom** — the Claude Design output ports over essentially 1:1.
- ✅ Robust. Steam frontend updates cannot break it.
- ✅ Testable on a desktop without Game Mode.
- ❌ Appears as a **library tile**, not a sidebar entry.

**Recommendation: build Path B first.** The mockup is a full-screen store with its own nav rail —
that is a standalone app design, not a panel inside someone else's UI. Ship something good, then
optionally add a ~50-line Decky plugin later whose only job is launching it from the QAM. Doing
sidebar integration first means fighting Steam's React internals before you have an app worth
launching.

---

## 2. Stack

| Layer      | Choice                                   | Why                                                           |
| ---------- | ---------------------------------------- | ------------------------------------------------------------- |
| Shell      | **Tauri v2** (Rust)                      | ~10 MB vs Electron's ~150 MB; native HTTP; no bundled browser |
| UI         | **React + TypeScript + Vite + Tailwind** | Claude Design output ports directly                           |
| Input      | **`gilrs` in Rust**, events → webview    | See the warning below                                         |
| HTTP/cache | **Rust `reqwest`** in the Tauri backend  | No CORS, real caching, keeps keys off the frontend            |

### ⚠️ Do not rely on the browser Gamepad API here

Tauri on Linux renders with **WebKitGTK**, whose Gamepad API support is inconsistent — exactly the
thing this app cannot get wrong. Read controllers **in Rust** with [`gilrs`](https://docs.rs/gilrs)
and emit events to the frontend via Tauri's event channel.

This also buys correct behavior for free: `gilrs` sees Xbox/DualSense/8BitDo pads through evdev the
same way Steam does, including the 8BitDo dongle. Budget real time for **input feel** — dpad repeat
rate, focus wrapping, hold-to-scroll. On a couch that matters more than any pixel.

### On Electron: not the fallback, and we shouldn't want it to be

Reading pads in Rust **removes the only strong argument for Electron** — you no longer depend on the
webview's Gamepad API at all, so Chromium's advantage there evaporates.

That matters beyond engineering taste. Electron is poorly regarded in exactly this audience: an
immutable, Flatpak-first gaming distro where a ~150 MB bundled browser and its RAM footprint sit
next to a game that wants every megabyte. Shipping an Electron store client to Bazzite users invites
the criticism before anyone looks at the UI.

**Video was the other argument for Electron, and it's answered — better than expected.**
⚠️ **Corrected 2026-08-21:** this section used to say WebKitGTK's MSE could not be trusted, so
full trailers needed libmpv. That was measured on the box and is **wrong** — WebKitGTK 2.52.5
plays Steam's full 1080p HLS trailer through **hls.js** with no errors, and audio goes to
PipeWire like any other app. No libmpv, no compositing, no bundled player. The webview handles
video too. `microtrailer.webm` (VP9, silent, ~6 s) remains the right thing for tile-focus
previews, because it is tiny and needs no player. See `private/VIDEO-TRAILERS.md`.

That leaves the webview doing only what it's good at — UI layout and styling — with both risky
subsystems on mature native libraries. **Tauri stands on its own.**

---

## 3. Data — use the JSON endpoints, do not scrape

Steam's storefront exposes JSON directly, so the instinct to load a page and dig data out of the
markup is not needed. Everything the shelves, search, tag browsing and the detail pages render comes
from documented-by-observation JSON endpoints, fetched in Rust (or through the dev proxy in the
browser build) and cached on disk.

⚠️ **The endpoint catalog is not in this repository.** It names undocumented Valve APIs, records
verified request shapes and sample responses, and is maintained as a personal reference across more
than one project. What matters for reading this code is the policy it enforces, which is restated
here and in the comments at every call site.

**Three rules the code is built around:**

1. **Never scrape the website.** JSON endpoints exist for everything the UI needs. The single
   exception is `search/results?infinite=1`, used strictly as a pagination API for tag browsing —
   it returns markup inside JSON and there is no alternative for that one job.

2. **Anonymous means anonymous.** No cart, no purchase, no recommendations. Owned games and the
   wishlist _are_ reachable, but only by reading the local Steam client's own logged-in session on
   the machine — never by an API key, and never by handling a credential. Everything else is
   deep-linked out with `steam://store/<appid>`.

3. **Purchase is never reimplemented.** Hand off to Steam. This is a hard architectural line, not a
   v1 shortcut.

⚠️ They are undocumented, unversioned and rate-limited to roughly **200 requests per 5 minutes per
IP**, so caching is a correctness requirement rather than an optimisation. They also fail _quietly_
— several return HTTP 200 with empty arrays or silently stripped fields rather than an error — so
every reader in this codebase is written to tell "no data" apart from "we could not ask", and to
degrade rather than blank the UI.

---

## 4. Shipping to Bazzite

Bazzite is **immutable (ostree)** — no `rpm -i`. Two workable routes:

- **Flatpak** — the native idiom, sandboxed, survives OS rebases untouched.
- **Binary in `~/.local/bin`** + a non-Steam shortcut. Simpler for development; `/var/home` survives
  image rebases, so it persists.

Add the tile with a URL-encoded path:

```sh
rm -f /tmp/addnonsteamgamefile && touch /tmp/addnonsteamgamefile   # one-shot marker, re-touch EVERY time
XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=gamescope-0 \
  steam "steam://addnonsteamgame/%2Fvar%2Fhome%2F<user>%2F.local%2Fbin%2Fbazzite-store"
```

Both boxes now run **stock signed Bazzite 44** (kernel 7.2.0-ogc4.1) at 4K100 + VRR — so target
4K and design for a 10-foot viewing distance, not a 1080p monitor.

---

## 5. Suggested first milestone

Resist building the whole store. One vertical slice proves every risky assumption at once:

1. Tauri window, full-screen, 4K-aware
2. `gilrs` → dpad moves a focus ring between tiles, A activates, B backs out
3. Rust command fetching `featuredcategories`, cached to disk with a TTL
4. One row of real capsule art from the live API, controller-navigable
5. A → `steam://store/<appid>` deep-link

If that feels good on the couch, the rest is layout work. If input feels wrong, you learn it in
week one, while switching to Electron is still cheap.

---

## 6. Repo layout (planned)

```
src/                  React + Tailwind frontend
src-tauri/            Rust: HTTP client, cache, gilrs input bridge
docs/                 design-port notes, settings rationale, demo hosting
design/               the Claude Design export the UI is ported from
server/               Fastify server for the web demo build
private/              gitignored — personal notes and the endpoint catalogs
```

Tasks live in **`private/TASKS.md`** (gitignored) — not GitHub issues.

## 7. Further reading

`docs/` carries the notes that are about _this codebase_:

- **`docs/DESIGN-PORT.md`** — where the design spec has to be converted rather than copied, and the
  Xbox glyph kit's own rules.
- **`docs/SETTINGS.md`** — what counts as a setting, which rows from the artboards were dropped and
  why, and the two things the updater still needs configuring.
- **`docs/DEMO-HOSTING.md`** — the web demo server. Read before touching `server/`.

⚠️ Several comments cite `private/…` documents — the Steam endpoint catalogs, the platform notes for
the author's own hardware, and a saved reference page. Those are **deliberately not published**: they
document undocumented third-party APIs, name specific machines, and in one case contain other
people's Steam profiles. Every fact the code actually depends on is restated at its call site, so
nothing here needs them to be readable.

---

## 8. AI disclosure

This project was built collaboratively with **Claude Code** (Anthropic). The design comes from
Claude Design; the implementation, the endpoint verification, and the unusually dense comments were
produced in that collaboration and reviewed by a human. Treat the comments as the reasoning record
they are — where one says a thing was measured on a given date, it was.

---

## 9. Licence

MIT — see [LICENSE](LICENSE).

Not affiliated with or endorsed by Valve. "Steam" and "Steam Deck" are trademarks of Valve
Corporation; this client talks to Steam's public storefront endpoints and hands every purchase back
to Steam itself.

---

## 10. Releasing

`semantic-release` on **`main`**, tags without a `v` prefix (`0.2.0`), triggered manually from the
**Actions → Release** tab — cutting a release publishes an update that every installed client will
offer to install, so it is a decision rather than a consequence of merging.

Two jobs. The first computes the version from the commits since the last tag, syncs it into
`package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, commits, tags and creates the
GitHub Release. The second checks out that tag, builds the AppImage on `ubuntu-22.04`, signs it, and
attaches the bundle plus `latest.json` — which _is_ the update feed the client polls.

Commit messages drive the version, so they are Conventional Commits: `feat:` is a minor and `fix:`
a patch.

⚠️ **This project is deliberately held below 1.0.0.** A `BREAKING CHANGE:` footer would normally
bump the major, which from `0.x` means jumping straight to `1.0.0` — one footer in one commit
message declaring the project stable by accident. `release.config.js` maps breaking changes to a
minor instead, which is also what semver says about `0.x` ("anything MAY change at any time"). The
changelog still gets its BREAKING CHANGES section; only the number differs. Shipping 1.0.0 is then
a deliberate act: remove that rule.

⚠️ **Two repository secrets are required** before a release can produce a usable artifact:
`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, from
`pnpm tauri signer generate`. Without them the bundler still emits an AppImage but no signature, and
clients silently reject unsigned artifacts — see `docs/SETTINGS.md` §4.

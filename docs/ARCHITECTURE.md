# Architecture — why it is built this way

Moved out of the README, which is now a front door rather than a design brief. Nothing here is
current-state documentation; it is the reasoning that produced the current state, kept because the
alternatives are the first things anyone will suggest changing.

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

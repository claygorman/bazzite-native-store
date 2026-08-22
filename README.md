<div align="center">

# Bazzite Store

**A controller-first Steam store for Bazzite Game Mode.**

Big Picture's store tab is the Steam website in a browser — tiny hit targets, hover states that mean
nothing on a dpad, and a layout designed for a mouse three feet closer than a couch.
This replaces it with a real TV interface.

[![CI](https://github.com/claygorman/bazzite-native-store/actions/workflows/ci.yml/badge.svg)](https://github.com/claygorman/bazzite-native-store/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/claygorman/bazzite-native-store?sort=semver&label=release)](https://github.com/claygorman/bazzite-native-store/releases)
[![License](https://img.shields.io/github/license/claygorman/bazzite-native-store)](LICENSE)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%20v2-24C8DB)](https://tauri.app)

<img src="docs/screenshots/home.jpg" alt="The home screen: shelves of games with prices, review scores and Deck compatibility, driven entirely by a controller" width="100%">

</div>

---

## What it does

- **Home shelves** — featured, specials, new releases and under-$10, with price, discount, review
  score, controller support and Deck compatibility read straight off each tile
- **Browse by tag** — every Steam tag, grouped, with a live preview of how much of each one actually
  runs on this hardware
- **Search** — an on-screen keyboard a dpad can actually drive
- **Game pages** — trailers that play in place, screenshots, reviews, requirements, DLC
- **A release calendar** — what is coming, day by day, personalised when Steam is running locally
- **Your wishlist and owned badges** — read from the Steam client already signed in on the machine
- **Settings** — scale, safe area, controller feel, glyph set, compatibility filters, cache, and a
  live view of whether Steam is actually answering

Everything is live Steam data. Nothing is mocked.

> [!NOTE]
> **Alpha, and honest about it.** It works end to end, but it has never been run on the television
> it is designed for — every screenshot so far is a desktop browser at 2560×1296, not 4K at ten
> feet. Expect the type sizes to move.

## Install

Grab the `.AppImage` from [Releases](https://github.com/claygorman/bazzite-native-store/releases),
then add it to Steam as a non-Steam game:

```sh
mkdir -p ~/.local/bin
# download + extract the .AppImage into ~/.local/bin, then:
chmod +x ~/.local/bin/bazzite-store.AppImage

rm -f /tmp/addnonsteamgamefile && touch /tmp/addnonsteamgamefile   # one-shot marker
XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=gamescope-0 \
  steam "steam://addnonsteamgame/%2Fvar%2Fhome%2F<user>%2F.local%2Fbin%2Fbazzite-store.AppImage"
```

> [!IMPORTANT]
> Point the shortcut at the **`.AppImage` itself**, not an extracted binary. The updater replaces
> the file at `$APPIMAGE`, which only the AppImage runtime sets — from an extracted binary, updates
> silently do nothing.

Bazzite is immutable (ostree), so there is no `rpm -i`; `~/.local/bin` is under `/var/home` and
survives image rebases.

## Development

```sh
pnpm install
pnpm dev          # browser, live Steam data through a proxy — no Linux needed
pnpm tauri:dev    # the real desktop app (Linux)
```

```sh
pnpm typecheck && pnpm test && pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
```

The browser build is a faithful preview — same components, same data, and a gamepad works through
the browser Gamepad API. Only the desktop-only paths differ.

## How it works

**Tauri v2 + React + TypeScript + Tailwind v4.** A ~10 MB binary instead of a bundled browser, on a
distro whose whole point is leaving RAM for the game.

Three rules the code does not break:

|                                           |                                                                                                                                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Never reimplement purchase**            | Buying deep-links to Steam (`steam://store/<appid>`). An architectural line, not a shortcut                                                                                             |
| **Never scrape the website**              | JSON endpoints exist for everything the UI needs                                                                                                                                        |
| **Never claim what the data cannot back** | Several Steam endpoints answer `200` with empty arrays rather than an error, so every reader tells "no data" apart from "we could not ask", and degrades instead of blanking the screen |

Two decisions that look odd until they don't:

- **The gamepad is read in Rust via `gilrs`**, not the browser Gamepad API — Tauri renders with
  WebKitGTK on Linux, whose Gamepad API is unreliable, and input is the one thing this app cannot
  get wrong.
- **HTTP lives in Rust too**, to dodge CORS and cache to disk. Steam rate-limits to roughly 200
  requests per five minutes, so caching is a correctness requirement rather than an optimisation.

## Docs

|                                                |                                                            |
| ---------------------------------------------- | ---------------------------------------------------------- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Why Tauri, why not a Decky plugin, why not Electron        |
| [`docs/SETTINGS.md`](docs/SETTINGS.md)         | What counts as a setting, and what got cut from the design |
| [`docs/DESIGN-PORT.md`](docs/DESIGN-PORT.md)   | Where the design spec is converted rather than copied      |
| [`docs/DEMO-HOSTING.md`](docs/DEMO-HOSTING.md) | The web demo server                                        |

Some comments cite `private/…` documents — Steam endpoint catalogs and notes naming specific
hardware. Those are deliberately unpublished; every fact the code depends on is restated at its call
site.

## Releasing

`semantic-release` on `main`, triggered manually from **Actions → Release**. Conventional Commits
drive the version: `feat:` is a minor, `fix:` a patch. The project is held below `1.0.0` on purpose,
so a `BREAKING CHANGE:` footer also maps to a minor.

The release builds the AppImage, signs it, and attaches `latest.json` — which is the update feed the
installed client polls.

## AI disclosure

Built collaboratively with **Claude Code** (Anthropic). The design comes from Claude Design; the
implementation, the endpoint verification and the unusually dense comments were produced in that
collaboration and reviewed by a human. Treat the comments as the reasoning record they are — where
one says a thing was measured on a given date, it was.

## Licence

[MIT](LICENSE). Not affiliated with or endorsed by Valve. "Steam" and "Steam Deck" are trademarks of
Valve Corporation; this client talks to Steam's public storefront endpoints and hands every purchase
back to Steam itself.

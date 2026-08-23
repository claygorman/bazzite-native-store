# Settings — what shipped, and what did not

Design turns **8** (`8a`–`8g`) and **9** (`9a`) of `Native Store Client.dc.html`, with the
project's own `Settings ideology.md` as the specification. This file is the ledger: every row
the artboards draw that is **not** on screen, and the reason.

Read the ideology doc first — it is the argument. This is the accounting.

---

## 1 · The two rules that did the work

> A setting exists because two reasonable people would want opposite defaults. If there is one
> right answer, ship the right answer.

> No setting for something the client does not own. The client browses and hands off. It never
> installs, launches, or patches a game.

Applied honestly they delete about a dozen rows. Nothing below was dropped for effort.

⚠️ **The standing rule for anyone adding a row back:** a switch that changes nothing is
indistinguishable from a broken one at ten feet. Every setting in `platform/settings.ts` is read
by something; if you add one, wire it in the same commit.

---

## 2 · Rows that are not here

| Row                                                                                       | Why not                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Include pre-release Proton builds**                                                     | Proton runtimes belong to Steam. We never launch a game, so we never choose one.                                                                                                        |
| **Rumble on focus**                                                                       | `gilrs` force-feedback is not wired. A switch for a feature that does not exist.                                                                                                        |
| **Y button** (stepper: Wishlist / …)                                                      | Y is the global search shortcut. Rebinding it per screen is what `7b` already refused, and Settings is the _one_ exception (Y = reset row) precisely because it has no search to reach. |
| **Keyboard mirrors controller**                                                           | One right answer — it is always true, in both builds.                                                                                                                                   |
| **Bazzite community reports**                                                             | No such source exists.                                                                                                                                                                  |
| **Steam library target** · **Ask which drive each time** · **Queue install after buying** | We deep-link `steam://store/<appid>` and Steam picks the drive. Not ours to set — README §3.                                                                                            |
| **Share compatibility reports** · **Anonymous usage reports**                             | This app sends nothing anywhere. Offering the switch implies it does, which is worse than not having it.                                                                                |
| **Changelog** · **Session log** · **Report an issue**                                     | No release notes yet, no log file, and tasks go in `private/TASKS.md` — never GitHub issues.                                                                                            |
| **Third-party licenses**                                                                  | Deferred, not refused. It needs a real dependency manifest, not a hand-written list that goes stale.                                                                                    |

---

## 2b · Rows that came back

### **Warn on kernel anti-cheat** — reopened 2026-08-22

Dropped above for "no endpoint we have carries an anti-cheat signal. `categories` does not include
one." That was true of the **endpoints** and false of the **archive**. ProtonDB's open dump carries
`isImpactedByAntiCheat` on every report: **21,890 reports answered it, 1,707 said impacted**. Turn
13a put that archive on disk, so the row now has a source and is on the Compatibility page.

⚠️ It ships **off**, and the standing rule in §1 is why: before this row existed the app said
nothing about anti-cheat, so the default has to be the behaviour it is replacing. It is also silent
until the archive is downloaded, which is itself opt-in — a warning switch that can only ever fire
for people who took a second, separate action.

### **Device profile** and **Report distro** — added 2026-08-22

Neither was ever refused; they were simply never built. Design `11a` requires the first by name:
the ProtonDB tab's device dropdown and this row are **one setting**, so changing it in either place
changes it everywhere. `Report distro` defaults to `This machine`, which reads the distribution off
`host_info` rather than guessing — distinct from `Any distro`, which is the off position. Collapsing
those two would silently narrow the report set on a distro nobody else reports from.

---

## 3 · Rows that changed shape

### Minimum tier shown → **Minimum verdict shown**

The artboard asks for a store-wide **ProtonDB tier** floor ("Silver"). It cannot be built.

ProtonDB serves **one appid per HTTP request** with no batching. Filtering a shelf of five costs
five requests; filtering a 43,980-game tag is impossible at any budget, against ~200 requests per
five minutes shared with Steam itself. A floor that could only apply to games whose rating had
already happened to load would hide tiles seconds after they appeared — the worst possible
behaviour on a focused grid.

Valve's **Deck verdict** arrives free inside the `GetItems` hydration every surface already pays
for. So the floor is built on that: _Show everything · Playable or better · Verified only_. Same
question, a source we can afford, applied to every list instantly.

⚠️ **Unrated is not below the floor.** Valve has rated a small fraction of the catalogue; treating
"no verdict" as "fails the bar" would hide almost every indie game on Steam. `Hide unrated games`
is the separate row for anyone who wants that, and it says in its own description that most of the
catalogue has no verdict.

ProtonDB stays where it is affordable: one focused row at a time, as a **label**, plus an on/off
row and a cache-cadence row that both really change what gets requested.

### The status card holds no controls

The doc puts an action inside each card ("Check for updates", "Run diagnostics") and lands focus on
it. Focus already has two homes here — the rail and the rows — and a third focusable region floating
above both would need its own rule for how you leave it in each direction. So each card's action is
the **first row of the first column**, which is where focus lands anyway. The Updates page still
opens focused on `Check for updates`.

### The rail is focusable, and left/right is movement only

The doc gives left/right two jobs — "crosses to the other column **or** steps a stepper when the
focused row has one" — and says "the rail is never focused directly; it is a position indicator
that LB/RB drives". Both had to go.

Land on a stepper and left/right is spent, so a column of nothing but steppers could never be left.
And with the rail unreachable, LB/RB is the _only_ way to change page — which on a keyboard means Q
and E, keys nobody reaches for before they have reached for an arrow.

|                         |                                                                          |
| ----------------------- | ------------------------------------------------------------------------ |
| **Left / Right**        | Movement, and only movement: rail ↔ column A ↔ column B                  |
| **Up / Down**           | Rows within the focused column; in the rail, the page list               |
| **A**                   | Toggles, fires a button, or **opens a stepper's list** (then commits it) |
| **Y**                   | Resets that one row                                                      |
| **LT / RT** (`1` / `3`) | Adjusts the focused stepper in place, without opening it                 |
| **LB / RB** (`Q` / `E`) | Still prev/next page, from anywhere on the screen                        |

The triggers are the only buttons Settings does not otherwise spend, so nothing was taken from
anything else. ⚠️ They are **named in the tray** (`1 Adjust · 3 Adjust`) because they are not
guessable; without that hint a stepper looks like a control with no way back, since A only ever
steps forward and deliberately does not wrap — wrapping reads as one press undoing four.

Crossing columns **clamps the row rather than carrying it**: the columns differ in length (Updates
is 4 and 2), so row 3 of column A has no counterpart, and landing on nothing is how a press appears
to do nothing.

### A stepper opens its list

> **Stepper** — 3 to 8 ordered or named values, `◀ value ▶`. Never opens a panel.

The doc was right about the _reason_ — "at ten feet, hidden state is broken state" — and wrong
about the remedy. A stepper that only steps forward on A dead-ends at the last value and then does
nothing at all; the control dies under your thumb. Wrapping instead reads as one press undoing
four.

So **A opens the list, up/down chooses, A commits and B cancels** — but the list is shown **in
place**, not in a panel: the row grows and every value is on screen at once with the current one
lit. Nothing is hidden, which is the rule the doc was actually defending.

⚠️ The value applies **as you move**, not on commit. That is the screen's own rule ("nothing needs
a Save; every change applies on press") and it is what makes Interface scale and Safe area usable —
you are choosing by looking at the result. B therefore has to restore what was there when the list
opened, or live preview would be a one-way door, and the tray says CANCEL rather than BACK.

⚠️ An open row can push the rows below it past the fold, so the focused row **scrolls itself into
view** (`block: 'nearest'`, no smooth behaviour). Without that, a controller has no way to reach a
row that has gone under the button tray.

### A focused row gets a bar, not a ring

> The focused row gets the client's standard declaration: 3px #4d9be6 ring inset, plate lifted to a
> blue tint, blue glow. Same treatment as a focused store tile, so focus reads identically
> everywhere in the app.

The tint and the glow shipped. The ring did not, and the reason is shape: it reads identically on a
tile because a tile is a compact card and the ring hugs its artwork. A settings row is a 44rem-wide,
6rem-tall band, and the same ring around that stops being a highlight and becomes a drawn box —
four long blue edges with nothing inside them to hold.

So focus is a **left bar** plus the tint plus the glow. The bar is the same one the rail beside it
already uses for "you are here", which gives the screen one vocabulary instead of two.

---

## 4 · The updater is real, and needs two things from you

Shipping route is an **AppImage in `~/.local/bin`** (README §4). That is the one Linux format
`tauri-plugin-updater` can replace in place without elevation — exactly right on an immutable
ostree, where a `.deb`/`.rpm` updater would need root and be undone by the next image rebase.

Wired: the plugin, `createUpdaterArtifacts`, `bundle.targets: ["appimage"]`, the check/install/
relaunch state machine, the channel, automatic checking, and notify-before-restart.

**The feed is GitHub Releases**, and `.github/workflows/release.yml` publishes it:
`semantic-release` cuts the tag and the release, then a second job builds the AppImage on
`ubuntu-24.04`, signs it, writes `latest.json` and attaches all three to that release. The endpoint
in `tauri.conf.json` is `releases/latest/download/latest.json`, which GitHub always resolves to the
newest release — so publishing a release _is_ publishing the update.

⚠️ **One thing is still missing, and it cannot live in this repo: the signing keypair.**

```sh
pnpm tauri signer generate -w ~/.tauri/bazzite-store.key
```

- the **public** half goes in `tauri.conf.json` → `plugins.updater.pubkey`
- the **private** half and its password become the repository secrets
  `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

Until both exist, `updater_configured` (Rust, reads the live config) returns false because `pubkey`
is empty, and the page says **"Update feed not configured"**.

⚠️ Without the secrets in CI the bundler still produces an AppImage but **no `.sig`**, and a client
silently rejects every unsigned artifact — it reads as "no update available", not as an error. That
is why `scripts/write-latest-json.mjs` refuses to emit a manifest when the signature is missing
rather than shipping an empty one.

Until both exist, `updater_configured` (Rust, reads the live config) returns false and the page
reads **"Update feed not configured"**. It does **not** read "Up to date" — a client that has never
asked cannot know, and that is the exact lie this page exists to avoid.

⚠️ **The channel travels as a request header**, `x-update-channel: stable | testing`, not as a
second endpoint. Tauri walks its endpoint list on _failure_, which is a fallback mechanism rather
than a switch — a testing feed in slot two would only ever be reached when the stable feed was
down. Your feed must read the header.

⚠️ **The version lives in three files** — `package.json` (which the UI reports via
`__APP_VERSION__`), `src-tauri/tauri.conf.json` (which the bundler stamps into the AppImage
filename) and `src-tauri/Cargo.toml` (which the updater compares against the feed).
`scripts/sync-version.mjs` keeps them together and semantic-release runs it in `prepare`, so they
land in the release commit. If they ever drift the failure is quiet and specific: a freshly
installed build offers itself as an update, forever.

---

## 5 · The Up menu

`9a`. One row of five over the dimmed page: **Home · Browse by Tag · Search · Wishlist ·
Settings**, account at the right end. It replaces the old two-item header bar, which was reachable
only from the top shelf on home and could therefore never reach Settings from anywhere else.

- **Up** works from the top shelf on home _only_. From any lower shelf Up still moves a shelf — a
  direction that sometimes navigates and sometimes opens a menu is one nobody trusts.
- **☰ Menu** works from anywhere, including the search screen, whose own handler otherwise
  swallows every key. It is handled first in `onAction` for that reason.
- **Focus opens on where you already are**, and activating that entry is a no-op, so a stray
  Up-then-A costs nothing.
- **Wishlist dims** with "Needs the Steam client running" when the CEF session is unreachable. It
  is dimmed rather than hidden: the row is always the same five in the same order, and an entry
  that vanished would shift every entry to its right.
- **The badge on Settings** carries a waiting update, or a degraded service, and lands you on the
  page it came from — Updates or Network — not on the last page you visited.

### Button changes this forced

| Action                  | Was                                       | Now                |
| ----------------------- | ----------------------------------------- | ------------------ |
| `menu` (☰ / **M**)     | Start / `Tab`, toggled the controller HUD | Raises the Up menu |
| `hud` (⊟ View / **F2**) | —                                         | The controller HUD |

⚠️ `glyphs.ts` claimed `menu` was `F1` while `input.ts` bound `Tab` — a disagreement that survived
because the tray never drew it on a screen where anyone pressed it. Both are `M` now, which is the
design's own keyboard map, and `settings.test.ts` asserts they stay together.

The **guide button is off limits**, as the doc insists: it belongs to Bazzite and the Steam
overlay, and a store client that could swallow it would make a wedged machine unrecoverable.

---

## 6 · Where each setting lands

Every row changes something. If you touch one of these, keep this table honest.

| Setting                                     | Read by                                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| Interface scale, safe area                  | `--ui-scale` multiplying `index.css`'s root `clamp()`; padding on `<main>`              |
| Show clock, 24-hour time                    | `Clock` in `App.tsx`                                                                    |
| Microtrailer autoplay, delay                | `useMicrotrailer` — **off stops the request**, not just the video                       |
| Ambient art wash, reduce motion             | `AmbientArt`, `MotionConfig`                                                            |
| Left stick moves focus                      | `resolveGamepadState` via `setStickMovesFocus`                                          |
| Repeat delay / rate                         | `useInputActions` tuning                                                                |
| Wrap at shelf ends                          | `useStoreFocus` (horizontal only)                                                       |
| Glyph set                                   | `glyphs.ts` — gamepad face buttons only, swapped by **position**                        |
| Minimum verdict, hide unrated, native first | `platform/compatFilter.ts`, applied in `useHydratedRows`, `useTagBrowse`, `useWishlist` |
| ProtonDB ratings, refresh cadence           | `setProtonPolicy` — off stops the requests                                              |
| Show Deck verdicts                          | `useSetting('deckVerified')` at each card wrapper                                       |
| Store region                                | `STORE_LOCALE.cc` via `setStoreRegion`                                                  |
| Request timeout, offline mode               | `setTransportPolicy` (and the Rust client's own timeout)                                |
| Cache limit, clear on quit, clear cache     | the Rust disk cache (`steam.rs`)                                                        |
| Update channel, automatic, notify           | `platform/updates.ts`                                                                   |

⚠️ Five of these are **module-level state** written by `useSettings`, not props: `glyphFor` is
called from ~30 places, `STORE_LOCALE` from ~12, and the gamepad poll loop runs outside React and
must not be rebuilt when a setting changes — restarting it mid-hold leaves a direction latched
down forever.

⚠️ Settings live in **`localStorage` in both builds**, not a Tauri file. A few hundred bytes, the
webview persists it across launches, and a second backend would mean a second serializer and a
second failure mode. `mergeSettings` validates the stored file **key by key**, so a corrupt or
hand-edited value falls back alone instead of taking the app with it.

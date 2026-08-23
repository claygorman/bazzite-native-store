# Packaging and code signing

What each platform actually ships, what is signed and what is not, and what turning on
the missing signatures would cost. The short version: **Linux is signed and updates
itself; macOS and Windows are deliberately unsigned and the README says so.**

## What a release produces

`.github/workflows/release.yml` fans out over three runners. Each builds, signs its own
bundle with the Tauri updater key, and writes one fragment of the update manifest.

| Target                          | Runner           | Updater artifact | Human download |
| ------------------------------- | ---------------- | ---------------- | -------------- |
| `linux-x86_64`                  | `ubuntu-24.04`   | `*.AppImage`     | the same file  |
| `darwin-aarch64`+`darwin-x86_64` | `macos-latest`  | `*.app.tar.gz`   | `*.dmg`        |
| `windows-x86_64`                | `windows-latest` | `*-setup.exe`    | the same file  |

> [!WARNING]
> **The Linux runner version is load-bearing, and not for the reason you would guess.**
> Tauri's AppImage bundler ships **WebKitGTK from the runner** — 165 libraries, including
> its own GStreamer and GLib. Release `0.3.1` was built on `ubuntu-22.04` and launched on
> Bazzite 44 as a **solid white window**: the process ran, `gilrs` enumerated both
> controllers, and the 2022 WebKit could not create an EGL display against Mesa 26.2 on
> RDNA 4 — `Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...`
>
> There is **no runtime workaround**. `WEBKIT_DISABLE_DMABUF_RENDERER`,
> `WEBKIT_DISABLE_COMPOSITING_MODE` and `LIBGL_ALWAYS_SOFTWARE` all still abort, and
> removing the bundled WebKit so the host's is used cascades into undefined symbols
> (`gst_pad_probe_info_set_buffer`, then `g_once_init_leave_pointer`). It is fixable only
> at packaging time.
>
> ⚠️ **Moving the runner did NOT fix this, and the reasoning above is why it could not.**
> Verified on the box with `0.4.1`, which ships the correct binary and still aborts with
> `EGL_BAD_PARAMETER` and a white window. The bundle carries a 94 MB
> `libwebkit2gtk-4.1.so.0` marked `Ubuntu`; Ubuntu 24.04's WebKit is roughly 2.44/2.46-era
> against Fedora 44's 2.52.5, so it is newer than 22.04's and still far too old.
>
> **Generalise it: no AppImage built on any Ubuntu runner can fix this.** The bundle always
> carries that runner's WebKit and Ubuntu's will always trail Fedora's, so 22.04 → 24.04 →
> 26.04 is chasing an asymptote. Either the format changes (Flatpak, RPM) or the build
> environment matches the target distro (build the AppImage inside a `fedora:44` container).
>
> ⚠️ **A correction worth keeping, because the mistake is easy to repeat.** `0.4.0` was
> read as evidence that the runner bump worked, on the grounds that it logged zero
> `EGL_BAD_PARAMETER`. It was not evidence of anything: `0.4.0` was running the wrong
> binary and exiting before it ever opened a webview, so the error had no opportunity to
> appear. **An absence caused by one bug was read as a result about another.** When two
> bugs are in flight, a negative result only counts if the code path that would produce
> the symptom actually ran.
>
> Moving to `ubuntu-24.04` raises the glibc floor, which is acceptable **here specifically**
> because the target is Bazzite 44 (Fedora 44) rather than general-purpose Linux. The
> `.github/workflows/ci.yml` Rust job is pinned to the same image on purpose — CI that
> builds on a different runner than the release validates the wrong artifact.
>
> ⚠️ **CI cannot catch a recurrence.** The bad artifact builds, signs and runs; it just
> does not paint. Only launching it on the box finds this.
>
> [!WARNING]
> **The crate has more than one binary target, and the bundler will guess wrong.** Cargo
> auto-discovers everything under `src-tauri/src/bin/` as an extra binary. `0.4.0` shipped
> `usr/bin/protondb-index` with `Exec=protondb-index` in the desktop entry and **no
> `bazzite-store` binary in the image at all** — launching it printed a usage string and
> exited. Three guards now hold it, and all three should stay:
>
> - `mainBinaryName` in `tauri.conf.json` — names the app for the bundler.
> - `default-run` + `autobins = false` + explicit `[[bin]]` in `Cargo.toml` — stops a new
>   file under `src/bin/` re-creating the ambiguity silently.
> - `required-features = ["tooling"]` on the indexer, off by default, so a release build
>   never produces that target. Build it with
>   `cargo run --features tooling --bin protondb-index`.
>
> ⚠️ `mainBinaryName` alone is not enough: the app then launches correctly and the image
> still carries 9.3 MB of build-time tooling.
>
> ⚠️ **Do not put comment keys in `tauri.conf.json`.** It rejects unknown fields outright —
> a `_comment_*` key fails the build script with "unknown field", which reads like a
> version mismatch between the CLI and `tauri-build`.

## ⚠️ Every build job must check out the release TAG

`semantic-release` commits the version bump as part of the release. A job that runs a bare
`actions/checkout@v7` therefore builds `main` as it was *before* that commit.

The `flatpak` job did exactly that until 2026-08-23, so the Flatpak of release N was built
from a different tree than its own AppImage and reported N−1 — the box showed **0.5.2 while
running 0.6.0 code**, because `__APP_VERSION__` comes from `package.json` at Vite build
time.

Every build job needs `ref: ${{ needs.release.outputs.version }}`. It is easy to miss when
adding a job, and the symptom is a wrong version string rather than a failure.

---

## Debugging the box from somewhere else

Two independent toggles, both off by default, both on **Settings → Network**.

**Debug logging** writes a file. ⚠️ A file rather than stdout because in Game Mode the app
is launched by Steam as a non-Steam shortcut, so `println!` and `console.log` go somewhere
nobody is watching — invisible exactly when the box is the only place a bug reproduces.
It records every request that actually left the machine (host, path, ms, error) plus every
view/focus transition. The path is on Settings → About; capped at 4 MB.

**Debug control channel** binds `127.0.0.1:8555`:

```sh
ssh -N -L 8555:127.0.0.1:8555 <user>@<box>
curl -s localhost:8555/state | jq     # what the app believes right now
curl -s localhost:8555/log            # the tail of the log file
curl -s -X POST localhost:8555/action -d '{"action":"down"}'
```

⚠️ `/action` is why it exists. Reading state says what went wrong; injecting input lets a
script REPRODUCE it — otherwise confirming something like "the dpad moves twice" costs a
human pressing buttons and describing the result, one round trip per hypothesis.

Rules that file must keep, and they are in its header too: **loopback only** (never
0.0.0.0 — reaching it from another machine takes a tunnel someone deliberately opened),
**off unless asked**, **nothing that spends money** (`/action` drives the UI; A on a store
page is a `steam://` handoff and Steam still asks), and **no new dependency** — three fixed
routes over `tokio::net` rather than a web framework in a client whose pitch is a small
binary.

⚠️ `/action` always sends press AND release. A press with no release latches the repeat
timer and the UI runs away on its own; that has bitten this project before with synthetic
keyboard events.

⚠️ Port 8555, not 8080 — Steam's own CEF debugger holds 8080 on Bazzite and colliding with
it would break the owned/wishlist reader for a debugging convenience.

---

## The Flatpak — the Linux route that actually paints

`flatpak/com.claygorman.bazzite-store.yml`, built by the `flatpak` job in `release.yml`,
attached to the release as `bazzite-store_<version>_linux-x86_64.flatpak`.

It fixes the white window **by mechanism, not by version chasing**: the app links the
runtime's WebKitGTK and the GL stack comes from a host-matched
`org.freedesktop.Platform.GL` extension — the combination those pieces are built and
tested against. `org.gnome.Platform` **50** is pinned because it is Flathub's current
default and a Tauri v2 app shipping there today pins the same; GNOME 48 went EOL in
March 2026.

| Decision | Why |
| --- | --- |
| Runs **beside** the AppImage job | `merge-latest-json.mjs` refuses a feed with no `linux-x86_64`, and the in-app updater stays meaningful off Flatpak. Dropping the AppImage is a separate decision. |
| Network allowed during the build | `flatpak-node-generator` supports npm and yarn, **not pnpm**. Vendoring would cost a pnpm workaround plus regeneration on every lockfile change and buys nothing while we self-distribute. Revisit for Flathub. |
| **Ostree repo on GitHub Pages**, bundle kept alongside | Done 2026-08-23, once the repo went public. The repo is what gives a deployment an *origin*, which is what `flatpak update` and the in-app updater both need. The bundle stays as the fallback for a box that cannot reach the remote. |
| App id keeps its hyphen | `com.claygorman.bazzite-store` also drives `app_cache_dir()`. Renaming to the Flathub-preferred `com.claygorman.BazziteStore` silently orphans every user's cache, so it waits for a migration. |

### ⚠️ Two sandbox facts that are invisible until someone looks at the box

- **`--device=input`.** `gilrs` reads `/dev/input/event*`, denied by default. Without it
  there are **no gamepads at all**, and it looks exactly like the input layer being
  broken rather than a missing permission.
- **`/run/host/os-release`.** Inside the sandbox `/etc/os-release` describes the GNOME
  runtime, not Bazzite. `sysinfo.rs` reads the host copy first — otherwise the
  diagnostics card confidently reports the wrong operating system, which is the one
  thing that card exists not to do.

### Installing

`install.sh` prefers the `.flatpak` whenever `flatpak` is present and falls back to the
AppImage otherwise. ⚠️ `steam://addnonsteamgame/` takes a **path** and cannot be handed
`flatpak run`, so the installer writes a three-line shim to `~/.local/bin/bazzite-store`
and points the shortcut at that — the stable, version-free path the script has always
relied on.

⚠️ **That path changed**: it used to be `bazzite-store.AppImage`. The installer deletes
the old file and says so, because the Steam shortcut created before this change points at
it and has to be re-added.

### Updates

`tauri-plugin-updater` cannot work here — `/app` is read-only, so there is no file to
swap however well signed the download is. That is not fixable with a key or a feed URL,
which is what `docs/SETTINGS.md` §4 asks for; those two things are for the AppImage.

**What works instead is an ostree repo plus the Flatpak portal**, and the two halves need
each other.

**The remote.** The release job already built an ostree repo and threw it away after
making the bundle. It now builds into the *previously published* repo, indexes it with
`build-update-repo --generate-static-deltas`, and force-pushes it to `gh-pages`:

    https://claygorman.github.io/bazzite-native-store/repo/

⚠️ **Build into the previous repo, not a fresh one.** ostree is content-addressed, so
reusing it lets deltas be computed between releases and an update downloads only what
changed. A fresh repo each time still produces a working remote — which is exactly why
this is easy to get wrong — but every client re-downloads the whole app every time.

⚠️ **The git history is squashed to one orphan commit per publish.** The ostree history
that matters lives inside the files; keeping git history too would add ~20 MB of binary
objects per release to a branch nobody reads. `--prune-depth=3` bounds the ostree side
against Pages' 1 GB limit.

**The in-app button.** `org.freedesktop.portal.Flatpak.CreateUpdateMonitor`
(`src-tauri/src/flatpakupdate.rs`), *not* `flatpak-spawn --host flatpak update`.

⚠️ Spawning needs `--talk-name=org.freedesktop.Flatpak`, which lets the sandbox run
**any** host command — "we only update ourselves" would then be a property of our code.
The portal's monitor is bound to the caller's own ref, so touching anything else is not
expressible, and it needs no `finish-args` at all. Same rule as `ALLOWED_PATHS` in
`steamclient.rs`.

⚠️ **The monitor is a watcher, not a request.** There is no "check now" method and no
"you are up to date" signal — it announces updates and is otherwise silent. So a check
that hears nothing yields `unannounced`, never `current`: silence covers both "there is
nothing" and "it has not polled yet", and only `current` may claim currency.

⚠️ **None of it works for an app installed from a bundle.** A bundle has no origin to
pull from, so both `flatpak update` and the portal find nothing, forever, and it looks
exactly like being up to date. `scripts/install.sh` therefore installs from the remote
and keeps the bundle only as a fallback. **One reinstall from the remote is required
once**, on any box that was installed from a bundle.

### ⚠️ Nothing on the target box runs updates on a schedule

Verified 2026-08-23 on `bazzite-clay`: `uupd` is installed but **`uupd.timer` is
`disabled` and inactive**, there is no `ublue-update`, and KDE Discover is not installed.
So publishing a remote does not by itself mean the box updates. What consumes it:

| route | works |
|---|---|
| the app's own Updates page | yes, via the portal |
| `flatpak update` over SSH | yes |
| `uupd`, Game Mode's system update | yes, when run |
| automatically, unattended | only if `uupd.timer` is enabled — it is not |

---

> The real fix is a **Flatpak**, which uses the runtime's WebKit and bundles no browser at
> all. That is tracked separately. ⚠️ The runner bump does **not** unblock the AppImage —
> see the correction above; it remains a necessary-but-insufficient step.

> [!IMPORTANT]
> **Only macOS ships a separate updater archive.** Tauri **v1** wrapped the Linux and
> Windows artifacts before signing them; **v2 signs the AppImage and the NSIS installer
> directly**, so there is no `.AppImage.tar.gz` and no `.nsis.zip`. Release 0.2.0 died on exactly this — the
> bundle directory held `bazzite-store_0.2.0_amd64.AppImage` and its `.sig` and nothing
> else, while both the manifest writer and `install.sh` were looking for the v1 name.
> Fixing Linux alone was not enough — 0.3.0 then failed on Windows for the identical
> reason, having produced `bazzite-store_0.3.0_x64-setup.exe` and its `.sig` and no zip.
> Every pre-v2 guide on the internet still shows the wrapped names.
>
> Setting `bundle.createUpdaterArtifacts: "v1Compatible"` brings the tarball back, and
> is only correct if you already have v1 clients in the field. This project does not.

### Why the manifest is written in two passes

`latest.json` needs every platform's signature in one file, but each signature only
exists on the runner that produced it, and **no runner can see any other runner's
output**. So each build job writes `latest-<target>.json` (`scripts/write-latest-json.mjs`)
and uploads it as a workflow artifact; a final job merges the fragments
(`scripts/merge-latest-json.mjs`) and attaches the result to the release.

> [!WARNING]
> **Both macOS runners name their archive `bazzite-store.app.tar.gz`, with no
> architecture in it.** Uploaded as-is with `--clobber`, whichever finishes second
> overwrites the first — and the manifest then points _both_ `darwin` entries at one
> file whose signature matches only one of them. An Apple silicon client would fetch an
> Intel binary, or fail verification, depending on which runner won the race.
>
> So the workflow stamps the target into every updater artifact before uploading:
> `bazzite-store_<version>_<target><suffix>`. The `.dmg` and `-setup.exe` already carry
> their own architecture and are left alone.

Two guards, because both failure modes are silent:

- **A missing `.sig` fails the build.** Without the signing secrets the bundler still
  produces the archive — just unsigned — and clients reject unsigned artifacts by
  reporting _no update available_. That is indistinguishable from having nothing to
  release. Verified against a local macOS build with no key: `.app.tar.gz` present,
  no `.sig` beside it.
- **A manifest with no `linux-x86_64` fails the release.** macOS and Windows build with
  `fail-fast: false`, so a flaky runner there must not cost a Linux release — but a
  manifest quietly missing Linux would stop updating the machines this exists for.

This is not hypothetical: 0.3.0 shipped with Windows failed and the Intel Mac cancelled,
and published a perfectly valid two-platform manifest covering Linux and Apple silicon.
Clients on those two updated; the other two were simply offered nothing.

## Signing, per platform

### Linux — done, and it is the one that matters

The AppImage is signed with the Tauri updater keypair
(`TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, repository
secrets). That is minisign, and it is what the in-app updater verifies — it is **not**
OS-level code signing, which Linux does not ask for. Nothing warns the user, and
self-update works.

> [!WARNING]
> The private key is never handled by tooling in this repo and must not be committed.
> Losing it means no installed client will ever accept an update again, because the
> public half is baked into `tauri.conf.json` of every build already in the field.

### macOS — unsigned, on purpose

The `.dmg` opens to _"cannot be opened because the developer cannot be verified"_.
The workaround is one command, and it is in the README:

```sh
xattr -dr com.apple.quarantine /Applications/bazzite-store.app
```

Fixing it properly is **two steps, and doing only the first buys nothing a user would
notice**:

|                                                                                                       |                                                      |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Sign** with a Developer ID certificate                                                              | Not sufficient alone — the warning still appears     |
| **Notarize**: upload the signed app to Apple, who scan it and issue a ticket you staple to the bundle | This is the step that actually makes it open cleanly |

Both are covered by the **Apple Developer Program at $99/year**. Tauri supports the whole
path through environment variables (`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
`APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_PASSWORD` — an
app-specific password, not the account password), so it is configuration rather than new
code. Notarization adds minutes of wall clock to the release, since Apple's service is a
queue.

### Windows — unsigned, and the more expensive one

SmartScreen warns once on `*-setup.exe`; the user clicks through _More info → Run
anyway_. Reputation accrues with installs, so the warning fades on its own over time
without anyone paying for anything.

An OV certificate runs roughly **$200–400/year**, and since June 2023 the private key
must live on a **hardware token or an approved HSM** — so it is not something a CI
runner can simply hold as a repository secret. Cloud signing services exist for exactly
this, at additional cost. EV certificates skip the reputation wait but cost more again.

## The decision, and when to revisit it

**Neither is worth buying yet.** The audience is two Linux boxes; a Mac or Windows user
of an alpha build is a developer, and a documented one-line `xattr` costs them seconds.

Revisit when people are actually downloading the `.dmg` or the `.exe` — at that point
$99 for macOS is easy to justify and should come first, because its warning is harder to
click through and never fades. Windows can stay unsigned longer: the cost is higher, the
key handling is genuinely awkward in CI, and SmartScreen solves itself.

## Related

- `README.md` — the user-facing install, update and platform-caveat sections
- `scripts/install.sh` — Linux installer and the CLI update path (`--check` exits 10)
- `scripts/{write,merge}-latest-json.mjs` — the two-pass update manifest

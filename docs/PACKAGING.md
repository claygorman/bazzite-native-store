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
> Moving to `ubuntu-24.04` raises the glibc floor, which is acceptable **here specifically**
> because the target is Bazzite 44 (Fedora 44) rather than general-purpose Linux. The
> `.github/workflows/ci.yml` Rust job is pinned to the same image on purpose — CI that
> builds on a different runner than the release validates the wrong artifact.
>
> ⚠️ **CI cannot catch a recurrence.** The bad artifact builds, signs and runs; it just
> does not paint. Only launching it on the box finds this.
>
> The real fix is a **Flatpak**, which uses the runtime's WebKit and bundles no browser at
> all. That is tracked separately; the runner bump unblocks the AppImage without making the
> AppImage the right shape.

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

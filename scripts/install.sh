#!/usr/bin/env bash
#
# Install OR update Bazzite Store, and optionally add it to Steam.
#
#   curl -fsSL https://raw.githubusercontent.com/claygorman/bazzite-native-store/main/scripts/install.sh | bash
#
# Installing and updating are the same operation — it replaces the binary in place.
# That makes this the CLI update path too, which matters over SSH and in `ujust`
# recipes, where the in-app updater cannot be reached because there is no UI.
#
# Options:
#   --check    print installed vs latest and exit; 0 = current, 10 = update available
#   --yes, -y  no prompts; add the Steam shortcut without asking
#   --help, -h print this and exit
#
# Environment:
#   ADD_TO_STEAM=1   add the Steam shortcut without asking. Needed when piping from
#                    curl, because then stdin is the SCRIPT and there is no terminal
#                    left to read an answer from. Set it to 0 to skip the step
#                    silently. Unset = ask, when run interactively.
#   BIN_DIR=<path>   where the AppImage lands. Default ~/.local/bin. Must be a path
#                    that survives an ostree rebase — anywhere under $HOME does.
#   REPO=<o/r>       the GitHub repo to install from. For forks and testing.
#
# ⚠️ No sudo, anywhere. Bazzite is an immutable ostree image — there is nothing to
# install into system paths, and a script that asked for root on a gaming handheld
# would deserve the suspicion. Everything lands under $HOME.
#
# Safe to re-run: it replaces the binary in place and will not add a second Steam
# shortcut for a name that already exists.
set -euo pipefail

REPO="${REPO:-claygorman/bazzite-native-store}"
APP_NAME="bazzite-store"
# Must match `identifier` in src-tauri/tauri.conf.json and the Flatpak manifest id.
APP_ID="com.claygorman.bazzite-store"

# The ostree repo the release workflow publishes to GitHub Pages. Installing from here
# rather than from a bundle is what gives the deployment an origin, and therefore what
# makes `flatpak update` and the in-app updater work at all.
REMOTE_NAME="bazzite-store"
REMOTE_URL="https://claygorman.github.io/bazzite-native-store/repo/"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
# ⚠️ No `.AppImage` suffix any more: this path holds the AppImage on a plain Linux box
# and a three-line `flatpak run` shim on Bazzite. It stays version-free either way, so
# the Steam shortcut registered once keeps working through every later update.
APP_PATH="$BIN_DIR/$APP_NAME"
# ⚠️ A marker file, because the installed version is otherwise unknowable: the archive
# carries the version in its FILENAME and we deliberately rename to a stable path so
# the Steam shortcut never breaks. Without this, `--check` would have to download the
# release to find out whether it needed to.
VERSION_FILE="$BIN_DIR/.$APP_NAME.version"

MODE="install"
for arg in "$@"; do
  case "$arg" in
    --check) MODE="check" ;;
    --yes|-y) ADD_TO_STEAM=1 ;;
    --help|-h) MODE="help" ;;
    *) printf 'unknown option: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
info() { printf '  %s\n' "$1"; }
die()  { printf '\033[31merror:\033[0m %s\n' "$1" >&2; exit 1; }

if [ "$MODE" = "help" ]; then
  # Print the header comment block — everything from line 2 up to the first line
  # that is not a comment. A hardcoded line range goes stale the moment the header
  # grows, and silently starts printing shell code as though it were documentation.
  awk 'NR==1 { next } !/^#/ { exit } { sub(/^# ?/, ""); print }' "$0"
  exit 0
fi

[ "$MODE" = "check" ] || bold "Bazzite Store"

# ── Preconditions ────────────────────────────────────────────────────────────
case "$(uname -s)" in
  Linux) ;;
  *) die "This installs a Linux AppImage. macOS and Windows builds are published
  as a .dmg and a -setup.exe on the releases page:
    https://github.com/$REPO/releases/latest" ;;
esac

[ "$(uname -m)" = "x86_64" ] || die "Only x86_64 is published right now (found $(uname -m))."

for cmd in curl; do
  command -v "$cmd" >/dev/null || die "\`$cmd\` is required but not installed."
done

# ── Find the newest release ──────────────────────────────────────────────────
# ⚠️ Reads the API rather than /releases/latest/download/<file>, because the
# artifact filename contains the version — there is no stable name to guess.
#
# ⚠️ Matches `.AppImage`, not `.AppImage.tar.gz`. Tauri v1 tarballed the AppImage for
# the updater; v2 signs the AppImage itself, so there is exactly one Linux asset and
# it is directly runnable. Confirmed against the 0.2.0 build, which produced
# `bazzite-store_0.2.0_amd64.AppImage` and its `.sig` and nothing else.
info "Looking up the latest release…"
API="https://api.github.com/repos/$REPO/releases/latest"
RELEASE=$(curl -fsSL "$API") || die "Could not reach the GitHub releases API."

asset_matching() {
  printf '%s' "$RELEASE" \
    | grep -o "\"browser_download_url\": *\"[^\"]*$1\"" \
    | head -1 | cut -d'"' -f4
}

# ── Which format? ────────────────────────────────────────────────────────────
#
# ⚠️ Flatpak first, and this is not a preference — it is the only format that WORKS on
# Bazzite. The AppImage bundles WebKitGTK from the CI runner, and no Ubuntu runner's
# WebKit can create an EGL display against Fedora 44 / Mesa 26.2 / RDNA 4: releases
# 0.3.1 and 0.4.1 both launched, ran, and painted a solid white window. The Flatpak
# links the runtime's WebKit instead. See docs/PACKAGING.md.
#
# The AppImage stays as the fallback for a Linux box with no flatpak, where it is
# untested but at least plausible.
FORMAT=appimage
if command -v flatpak >/dev/null 2>&1; then
  FLATPAK_URL=$(asset_matching '\.flatpak')
  [ -n "${FLATPAK_URL:-}" ] && { FORMAT=flatpak; ASSET_URL="$FLATPAK_URL"; }
fi
if [ "$FORMAT" = "appimage" ]; then
  ASSET_URL=$(asset_matching '\.AppImage')
  if command -v flatpak >/dev/null 2>&1; then
    info "note: no .flatpak in this release; falling back to the AppImage."
    info "      on Bazzite that build is known to open a white window."
  fi
fi

[ -n "${ASSET_URL:-}" ] || die "No installable Linux asset in the latest release.
  Either none has been published yet, or the release is still building:
    https://github.com/$REPO/releases"

VERSION=$(basename "$(dirname "$ASSET_URL")")
INSTALLED=$(cat "$VERSION_FILE" 2>/dev/null || echo "none")

# ── --check: report and exit, for cron and `ujust` ───────────────────────────
if [ "$MODE" = "check" ]; then
  printf 'installed: %s\nlatest:    %s\n' "$INSTALLED" "$VERSION"
  if [ "$INSTALLED" = "$VERSION" ]; then
    echo "up to date"; exit 0
  fi
  echo "update available"; exit 10
fi

if [ "$INSTALLED" = "$VERSION" ]; then
  info "Already on $VERSION — reinstalling anyway."
else
  info "Found $VERSION (installed: $INSTALLED)"
fi

# ── Download and unpack ──────────────────────────────────────────────────────
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

info "Downloading…"
mkdir -p "$BIN_DIR"

# ⚠️ Installs from 0.4.1 and earlier live at `$BIN_DIR/bazzite-store.AppImage`. That file
# has to go eventually — left behind it is a stale binary that still launches, never
# updates again, and on Bazzite opens a white window.
#
# ⚠️ But NOT YET, and this is the whole lesson of 0.5.1: the first version of this script
# deleted it here, BEFORE the flatpak install ran. The install then timed out and the box
# was left with no app at all and a Steam shortcut pointing at a deleted path. A failed
# install must be a no-op, never an uninstall. The removal now happens only after the new
# install is verified — see `retire_legacy` at the end.
LEGACY="$BIN_DIR/$APP_NAME.AppImage"

retire_legacy() {
  [ -e "$LEGACY" ] || return 0
  rm -f "$LEGACY"
  info "Removed the old $LEGACY"
  info "⚠️  Your previous Steam shortcut pointed at that path and will no longer work."
  info "    Delete that entry in Steam and let this script re-add it."
}

if [ "$FORMAT" = "flatpak" ]; then
  # ⚠️ The REMOTE first, and this is not just tidiness — it is what makes the app
  # updatable at all.
  #
  # An app installed from a single-file bundle has no origin to pull from, so
  # `flatpak update` has nothing to check and the in-app updater's portal monitor
  # never announces anything. Both look identical to "there are no updates", forever.
  # Installing from the ostree repo instead gives the deployment a real origin, and
  # after that `flatpak update`, uupd, Game Mode's system update and the app's own
  # Updates page all work without this script ever running again.
  #
  # The bundle stays as the fallback below, for a box that cannot reach the remote.
  if flatpak remote-add --user --if-not-exists "$REMOTE_NAME" "$REMOTE_URL" >/dev/null 2>&1 \
     && flatpak install --user -y --noninteractive "$REMOTE_NAME" "$APP_ID" >/dev/null 2>&1; then
    info "Installed from the update remote — future updates need no script."
    FROM_REMOTE=1
  else
    info "Remote unavailable; falling back to the release bundle (no auto-update)."
    FROM_REMOTE=0
  fi
fi

if [ "$FORMAT" = "flatpak" ] && [ "${FROM_REMOTE:-0}" = "0" ]; then
  BUNDLE="$TMP/app.flatpak"
  curl -fsSL --proto '=https' --tlsv1.2 -o "$BUNDLE" "$ASSET_URL" \
    || die "Download failed: $ASSET_URL"

  # A flatpak bundle is an ostree static delta, not an ELF — the magic check below
  # applies only to the AppImage. `flatpak install` validates it properly anyway and
  # refuses a truncated file.

  # ⚠️ A bundle still has to RESOLVE its runtime, and a --user install consults the
  # user's remotes. On a box whose flathub remote is only registered system-wide, that
  # lookup goes hunting and hangs — 0.5.1 died here with "Timeout was reached" while
  # installing a purely local file, on a machine that already had org.gnome.Platform//50.
  flatpak remote-add --user --if-not-exists flathub \
    https://dl.flathub.org/repo/flathub.flatpakrepo >/dev/null 2>&1 || true

  if ! flatpak install --user -y --noninteractive --bundle "$BUNDLE"; then
    # ⚠️ Second attempt with --no-deps, which skips runtime verification entirely. Only
    # reached when the first try failed, and only useful because the runtime is normally
    # already present — Bazzite ships flathub configured. If this also fails, the runtime
    # genuinely is missing and the message says how to get it.
    info "First attempt failed; retrying without dependency resolution…"
    flatpak install --user -y --noninteractive --no-deps --bundle "$BUNDLE" || die \
"flatpak install failed.

  Nothing was changed — your previous install is untouched.

  If the runtime is missing, fetch it once and re-run this script:
    flatpak install --user -y flathub org.gnome.Platform//50"
  fi

fi

if [ "$FORMAT" = "flatpak" ]; then
  # ⚠️ Verify before anything destructive happens. `flatpak install` exiting 0 is not by
  # itself proof the app is deployed and runnable. Runs for BOTH routes — the remote
  # install is no more trustworthy than the bundle one.
  flatpak info "$APP_ID" >/dev/null 2>&1 \
    || die "flatpak reported success but $APP_ID is not installed. Nothing was changed."

  # ⚠️ A launcher shim, because `steam://addnonsteamgame/` takes a PATH and cannot be
  # handed `flatpak run com.claygorman.bazzite-store`. Writing the shim to the same
  # stable path the AppImage used keeps the existing Steam shortcut working across
  # every future update — which is the whole reason that path never carries a version.
  cat > "$APP_PATH" <<SHIM
#!/usr/bin/env sh
exec flatpak run $APP_ID "\$@"
SHIM
  chmod 755 "$APP_PATH"
  printf '%s\n' "$VERSION" > "$VERSION_FILE"
  # Safe now: the flatpak is installed and verified, and the shim exists.
  retire_legacy
  info "Installed $VERSION as a Flatpak ($APP_ID)"
  info "Launcher: $APP_PATH"
else
  EXTRACTED="$TMP/app.AppImage"
  curl -fsSL --proto '=https' --tlsv1.2 -o "$EXTRACTED" "$ASSET_URL" \
    || die "Download failed: $ASSET_URL"

  # ⚠️ Check it really is a binary before making it executable. A truncated download or
  # an HTML error page saved to disk would otherwise be chmod +x'd and handed to Steam.
  head -c 4 "$EXTRACTED" | grep -q $'\x7fELF' || die "That file is not a Linux binary."

  install -m 755 "$EXTRACTED" "$APP_PATH"
  printf '%s\n' "$VERSION" > "$VERSION_FILE"
  retire_legacy
  info "Installed $VERSION to $APP_PATH"
fi

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) info "note: $BIN_DIR is not on your PATH" ;;
esac

# ── Offer to add it to Steam ─────────────────────────────────────────────────
# Only meaningful with Steam running, and only worth doing once.
add_to_steam() {
  command -v steam >/dev/null || { info "Steam not found; skipping the shortcut."; return; }

  # ⚠️ `/tmp/addnonsteamgamefile` is a ONE-SHOT marker. Steam consumes it, so it has
  # to be re-created immediately before every steam://addnonsteamgame call — without
  # this, only the first one in a session registers and the rest fail silently.
  rm -f /tmp/addnonsteamgamefile && touch /tmp/addnonsteamgamefile

  # Percent-encode the path; the URL handler needs it escaped.
  local encoded
  encoded=$(printf '%s' "$APP_PATH" | sed -e 's|/|%2F|g' -e 's| |%20|g')

  # ⚠️ Game Mode's compositor needs both of these to accept a steam:// from a shell.
  XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}" \
  WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-gamescope-0}" \
    steam "steam://addnonsteamgame/$encoded" >/dev/null 2>&1 || true

  info "Asked Steam to add it — confirm the dialog, then find it under Non-Steam."
}

if [ -t 0 ] && [ "${ADD_TO_STEAM:-ask}" = "ask" ]; then
  printf '  Add it to Steam as a non-Steam game? [Y/n] '
  read -r reply </dev/tty || reply="n"
  case "$reply" in [nN]*) ;; *) add_to_steam ;; esac
elif [ "${ADD_TO_STEAM:-}" = "1" ]; then
  # Piped from curl, so stdin is the script. Opt in explicitly:
  #   curl -fsSL … | ADD_TO_STEAM=1 bash
  add_to_steam
else
  info "To add it to Steam later, re-run this interactively, or:"
  info "  ADD_TO_STEAM=1 bash <(curl -fsSL https://raw.githubusercontent.com/$REPO/main/scripts/install.sh)"
fi

echo
bold "Done — $VERSION"
info "Run it: $APP_PATH"
info "Updates install themselves from inside the app (Settings → Updates)."

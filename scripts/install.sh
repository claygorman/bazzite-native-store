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
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
APP_PATH="$BIN_DIR/$APP_NAME.AppImage"
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
ASSET_URL=$(
  curl -fsSL "$API" \
    | grep -o '"browser_download_url": *"[^"]*\.AppImage"' \
    | head -1 | cut -d'"' -f4
) || true

[ -n "${ASSET_URL:-}" ] || die "No AppImage found in the latest release.
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
EXTRACTED="$TMP/app.AppImage"
curl -fsSL --proto '=https' --tlsv1.2 -o "$EXTRACTED" "$ASSET_URL" \
  || die "Download failed: $ASSET_URL"

# ⚠️ Check it really is a binary before making it executable. A truncated download or
# an HTML error page saved to disk would otherwise be chmod +x'd and handed to Steam.
head -c 4 "$EXTRACTED" | grep -q $'\x7fELF' || die "That file is not a Linux binary."

mkdir -p "$BIN_DIR"
install -m 755 "$EXTRACTED" "$APP_PATH"
printf '%s\n' "$VERSION" > "$VERSION_FILE"
info "Installed $VERSION to $APP_PATH"

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

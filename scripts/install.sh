#!/usr/bin/env bash
#
# Install Bazzite Store, and optionally add it to Steam.
#
#   curl -fsSL https://raw.githubusercontent.com/claygorman/bazzite-native-store/main/scripts/install.sh | bash
#
# ⚠️ No sudo, anywhere. Bazzite is an immutable ostree image — there is nothing to
# install into system paths, and a script that asked for root on a gaming handheld
# would deserve the suspicion. Everything lands under $HOME.
#
# Safe to re-run: it replaces the binary in place and will not add a second Steam
# shortcut for a name that already exists.
set -euo pipefail

REPO="claygorman/bazzite-native-store"
APP_NAME="bazzite-store"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
APP_PATH="$BIN_DIR/$APP_NAME.AppImage"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
info() { printf '  %s\n' "$1"; }
die()  { printf '\033[31merror:\033[0m %s\n' "$1" >&2; exit 1; }

bold "Bazzite Store"

# ── Preconditions ────────────────────────────────────────────────────────────
case "$(uname -s)" in
  Linux) ;;
  *) die "This installs a Linux AppImage. On macOS or Windows, build from source:
    git clone https://github.com/$REPO && cd bazzite-native-store
    pnpm install && pnpm tauri:dev" ;;
esac

[ "$(uname -m)" = "x86_64" ] || die "Only x86_64 is published right now (found $(uname -m))."

for cmd in curl tar; do
  command -v "$cmd" >/dev/null || die "\`$cmd\` is required but not installed."
done

# ── Find the newest release ──────────────────────────────────────────────────
# ⚠️ Reads the API rather than /releases/latest/download/<file>, because the
# artifact filename contains the version — there is no stable name to guess.
info "Looking up the latest release…"
API="https://api.github.com/repos/$REPO/releases/latest"
ASSET_URL=$(
  curl -fsSL "$API" \
    | grep -o '"browser_download_url": *"[^"]*\.AppImage\.tar\.gz"' \
    | head -1 | cut -d'"' -f4
) || true

[ -n "${ASSET_URL:-}" ] || die "No AppImage found in the latest release.
  Either none has been published yet, or the release is still building:
    https://github.com/$REPO/releases"

VERSION=$(basename "$(dirname "$ASSET_URL")")
info "Found $VERSION"

# ── Download and unpack ──────────────────────────────────────────────────────
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

info "Downloading…"
curl -fsSL --proto '=https' --tlsv1.2 -o "$TMP/app.tar.gz" "$ASSET_URL" \
  || die "Download failed: $ASSET_URL"

tar -xzf "$TMP/app.tar.gz" -C "$TMP" || die "The download is not a valid archive."
EXTRACTED=$(find "$TMP" -name '*.AppImage' -type f | head -1)
[ -n "$EXTRACTED" ] || die "No .AppImage inside the archive."

# ⚠️ Check it really is one before making it executable. A truncated download or an
# HTML error page saved to disk would otherwise be chmod +x'd and handed to Steam.
head -c 4 "$EXTRACTED" | grep -q $'\x7fELF' || die "That file is not a Linux binary."

mkdir -p "$BIN_DIR"
install -m 755 "$EXTRACTED" "$APP_PATH"
info "Installed to $APP_PATH"

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

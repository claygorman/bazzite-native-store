#!/usr/bin/env bash
#
# Install OR update Bazzite Store on macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/claygorman/bazzite-native-store/main/scripts/install-macos.sh | bash
#
# This exists because the .dmg cannot be relied on. Its window layout is set by
# driving Finder over AppleScript, and the release runner is headless — so the
# image ships with no `.DS_Store`, opens as a bare unarranged list, and gives the
# reader no drop target to aim at. The `Applications` symlink IS inside it; there
# is just nothing on screen that says so. Add a locked-down `/Applications` on a
# managed Mac and "drag it to Applications" stops being an instruction at all.
#
# So: same artifact, no Finder. Mount, copy, de-quarantine, unmount.
#
# Options:
#   --check    print installed vs latest and exit; 0 = current, 10 = update available
#   --help, -h print this and exit
#
# Environment:
#   DEST_DIR=<path>  where the .app lands. Default /Applications when it is
#                    writable, ~/Applications when it is not. Set it explicitly to
#                    override either choice.
#   REPO=<o/r>       the GitHub repo to install from. For forks and testing.
#
# ⚠️ No sudo, anywhere — same rule as the Linux installer. A managed Mac will not
# grant it, and an install script that asks for root to copy one app bundle has
# earned every bit of the suspicion it gets. If /Applications is not writable this
# falls back to ~/Applications, which needs no admin rights and which Spotlight and
# Launchpad both index.
#
# ⚠️ The app is UNSIGNED — ad-hoc, linker-signed only, no Developer ID and no
# notarization. macOS quarantines anything downloaded and then reports the block as
# "bazzite-store is damaged and can't be opened", which is a lie: nothing is damaged.
# Clearing the quarantine flag is what makes it open, and that is the `xattr` line
# below. See docs/PACKAGING.md for why signing is off.
#
# Safe to re-run: it replaces the bundle in place, which is also the update path.
set -euo pipefail

REPO="${REPO:-claygorman/bazzite-native-store}"
APP_NAME="bazzite-store"
BUNDLE="$APP_NAME.app"

MODE="install"
for arg in "$@"; do
  case "$arg" in
    --check) MODE="check" ;;
    --help|-h) MODE="help" ;;
    *) printf 'unknown option: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
info() { printf '  %s\n' "$1"; }
die()  { printf '\033[31merror:\033[0m %s\n' "$1" >&2; exit 1; }

if [ "$MODE" = "help" ]; then
  # Same trick as install.sh: print the header block by reading it, so a hardcoded
  # line range cannot go stale and start printing shell code as documentation.
  awk 'NR==1 { next } !/^#/ { exit } { sub(/^# ?/, ""); print }' "$0"
  exit 0
fi

# ── Preconditions ────────────────────────────────────────────────────────────
case "$(uname -s)" in
  Darwin) ;;
  Linux) die "This is the macOS installer. On Linux use:
    curl -fsSL https://raw.githubusercontent.com/$REPO/main/scripts/install.sh | bash" ;;
  *) die "Unsupported platform: $(uname -s)." ;;
esac

for cmd in curl hdiutil xattr; do
  command -v "$cmd" >/dev/null || die "\`$cmd\` is required but not installed."
done

# ── Where does it go? ────────────────────────────────────────────────────────
# ⚠️ Test writability by actually writing. `-w` consults the permission bits, which
# on a managed Mac can say yes while an MDM profile or SIP says no — and the failure
# then lands halfway through the copy, with a half-written bundle in /Applications.
FELL_BACK=0
if [ -z "${DEST_DIR:-}" ]; then
  if touch /Applications/.bazzite-store-writetest 2>/dev/null; then
    rm -f /Applications/.bazzite-store-writetest
    DEST_DIR="/Applications"
  else
    DEST_DIR="$HOME/Applications"
    FELL_BACK=1
  fi
fi
DEST="$DEST_DIR/$BUNDLE"

installed_version() {
  [ -d "$DEST" ] || return 1
  /usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" \
    "$DEST/Contents/Info.plist" 2>/dev/null
}

# ── Find the newest release ──────────────────────────────────────────────────
# ⚠️ Reads the API rather than /releases/latest/download/<file>: the artifact
# filename carries the version, so there is no stable name to guess.
[ "$MODE" = "check" ] || bold "Bazzite Store"
[ "$MODE" = "check" ] || info "Looking up the latest release…"

API="https://api.github.com/repos/$REPO/releases/latest"
RELEASE=$(curl -fsSL "$API") || die "Could not reach the GitHub releases API."

LATEST=$(printf '%s' "$RELEASE" | grep -o '"tag_name": *"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$LATEST" ] || die "Could not read the latest version from the API response."

# ⚠️ Matches `_universal.dmg`. One image carries both slices (Tauri lipos the arm64
# and x86_64 builds on the arm runner), so there is no architecture to select here —
# and matching a bare `.dmg` would be a latent bug the day a second image ships.
ASSET_URL=$(printf '%s' "$RELEASE" \
  | grep -o '"browser_download_url": *"[^"]*_universal\.dmg"' \
  | head -1 | cut -d'"' -f4)
[ -n "$ASSET_URL" ] || die "No universal .dmg in release $LATEST."

CURRENT=$(installed_version || true)

if [ "$MODE" = "check" ]; then
  printf 'installed: %s\n' "${CURRENT:-none}"
  printf 'latest:    %s\n' "$LATEST"
  [ "${CURRENT:-none}" = "$LATEST" ] && exit 0
  exit 10
fi

if [ -n "$CURRENT" ]; then
  info "Installed: $CURRENT  →  latest: $LATEST"
else
  info "Installing $LATEST into $DEST_DIR"
fi

# ── Download, mount, copy ────────────────────────────────────────────────────
WORK=$(mktemp -d)
MOUNT=""
# ⚠️ Detach before removing the workdir. A still-attached image holds the .dmg open,
# and `rm -rf` then leaves a phantom volume mounted for the rest of the session.
cleanup() {
  [ -n "$MOUNT" ] && hdiutil detach "$MOUNT" -quiet 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

IMG="$WORK/$APP_NAME.dmg"
info "Downloading…"
curl -fsSL --proto '=https' --tlsv1.2 -o "$IMG" "$ASSET_URL" \
  || die "Download failed: $ASSET_URL"

# ⚠️ -nobrowse keeps Finder from opening a window over whatever the user is doing.
# ⚠️ -mountrandom puts the volume under our own temp dir instead of /Volumes. Two
# reasons: a stale mount of the same name makes macOS append a digit and hand back
# `/Volumes/bazzite-store 1`, so the well-known path is a guess; and mounting inside
# $WORK means the mountpoint is simply the only DIRECTORY there — the .dmg beside it
# is a file. That is a more reliable answer than parsing hdiutil's tab-separated
# device table, where the mountpoint is the last field only on the line that has one.
info "Mounting…"
hdiutil attach "$IMG" -nobrowse -readonly -mountrandom "$WORK" -quiet \
  || die "Could not mount the disk image."
MOUNT=$(find "$WORK" -maxdepth 1 -mindepth 1 -type d | head -1)
[ -n "$MOUNT" ] || die "The disk image mounted but produced no volume."
[ -d "$MOUNT/$BUNDLE" ] || die "No $BUNDLE inside the disk image."

mkdir -p "$DEST_DIR"

# ⚠️ Remove the old bundle rather than copying over it. `cp -R` onto an existing
# .app MERGES, so a file dropped between releases would survive forever and the
# install would drift from a clean one in ways nothing reports.
if [ -d "$DEST" ]; then
  info "Removing the previous install…"
  rm -rf "$DEST" || die "Could not remove $DEST — is the app running?"
fi

info "Copying to ${DEST_DIR}…"
cp -R "$MOUNT/$BUNDLE" "$DEST_DIR/" || die "Copy to $DEST_DIR failed."

# ── Make it openable ─────────────────────────────────────────────────────────
# Without this the app is quarantined and macOS refuses it as "damaged".
info "Clearing the quarantine flag…"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

printf '\n'
bold "Installed $LATEST"
info "$DEST"
printf '\n'
info "Open it:  open -a \"$DEST\""
if [ "$FELL_BACK" = "1" ]; then
  printf '\n'
  info "⚠️ /Applications was not writable, so this went to ${DEST_DIR} instead."
  info "   Spotlight and Launchpad both index it there just the same."
fi
info "It updates itself from here: Settings → Updates."

#!/bin/sh
# The Flatpak entrypoint: choose between the binary this Flatpak shipped and a newer,
# already-verified payload the app installed for itself.
#
# ⚠️ THIS SCRIPT VERIFIES NOTHING. It cannot: it has no key and no business having one.
# The signature was checked in `src-tauri/src/payload.rs` BEFORE the payload was renamed
# into place, so by the time a file exists at $BIN it has already been proven. Anything
# that can write $BIN can already write this script, so a check here would buy nothing.
#
# ⚠️ Kept in POSIX sh with no dependencies. It runs before the app on every single
# launch, so a bug here is a store that will not open — which is the one failure mode
# this feature is supposed to remove, not create.
set -eu

APP_ID=com.claygorman.bazzite-store
SHELL_BIN=/app/bin/bazzite-store
SHELL_VERSION_FILE=/app/share/bazzite-store/VERSION

# ⚠️ Must match Tauri's `app_data_dir()` EXACTLY, which is `data_dir()/<identifier>` —
# note the identifier subdirectory. Inside the sandbox `XDG_DATA_HOME` is
# ~/.var/app/<id>/data, so this resolves to ~/.var/app/<id>/data/<id>/payload. Get this
# wrong and the app installs payloads somewhere the launcher never looks, which presents
# as "the update succeeded and nothing changed".
PAYLOAD_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/$APP_ID/payload"
BIN="$PAYLOAD_DIR/bazzite-store"
VERSION_FILE="$PAYLOAD_DIR/VERSION"
MARKER="$PAYLOAD_DIR/LAUNCHING"

run_shell() {
  exec "$SHELL_BIN" "$@"
}

# Nothing staged: the ordinary case, and the case on a fresh install.
[ -x "$BIN" ] && [ -r "$VERSION_FILE" ] || run_shell "$@"

# ⚠️ THE SAFETY NET. The marker is written just below, immediately before handing over,
# and the app deletes it once it has actually started. Finding it still here means the
# previous handover never came back — so this payload is broken and we must not run it
# again. Removing it as well as skipping it means the next launch is a clean shell
# start rather than a permanent limp.
if [ -e "$MARKER" ]; then
  echo "launch: payload did not start last time; falling back to /app" >&2
  rm -f "$MARKER" "$BIN" "$VERSION_FILE"
  run_shell "$@"
fi

payload_version=$(cat "$VERSION_FILE" 2>/dev/null || echo 0.0.0)
shell_version=$(cat "$SHELL_VERSION_FILE" 2>/dev/null || echo 0.0.0)

# ⚠️ `sort -V` picks the newer of the two, and the payload only wins when it is STRICTLY
# newer. A `flatpak update` that overtakes a stale payload must not be undone by it —
# otherwise updating through Flatpak would silently reinstall an older client.
#
# ⚠️ EVERY step from here on falls back to the shell binary rather than failing. This
# script runs before the app on every launch under `set -e`, so an absent `sort`, a
# read-only directory or an empty string would otherwise mean a store that does not
# open at all — trading a missed update for a dead app. The bias is always toward
# running something.
newest=$(printf '%s\n%s\n' "$payload_version" "$shell_version" | sort -V 2>/dev/null | tail -1) \
  || run_shell "$@"
[ -n "$newest" ] || run_shell "$@"
if [ "$newest" = "$shell_version" ] || [ "$payload_version" = "$shell_version" ]; then
  run_shell "$@"
fi

# If the marker cannot be written the safety net does not exist, so do not take the
# risk this launch — an unverifiable fallback is worse than an old version.
touch "$MARKER" 2>/dev/null || run_shell "$@"
exec "$BIN" "$@"

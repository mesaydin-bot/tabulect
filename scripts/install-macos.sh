#!/usr/bin/env bash
# Install Tabulect.app into /Applications on Apple Silicon.
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "install-macos.sh copies the .app to /Applications and must run on macOS." >&2
  exit 1
fi

APP_NAME="Tabulect.app"
DEST="/Applications/${APP_NAME}"
CANDIDATES=(
  "$root/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/${APP_NAME}"
  "$root/src-tauri/target/release/bundle/macos/${APP_NAME}"
)

SRC=""
for cand in "${CANDIDATES[@]}"; do
  if [ -d "$cand" ]; then
    SRC="$cand"
    break
  fi
done

if [ -z "$SRC" ] || { [ -f "$root/dist/index.html" ] && [ "$root/dist/index.html" -nt "$SRC/Contents/MacOS/tabulect" ]; }; then
  echo "Building fresh ${APP_NAME}…"
  "$root/scripts/build-macos-arm64.sh"
  SRC="$root/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/${APP_NAME}"
fi

if [ ! -d "$SRC" ]; then
  echo "Build finished but ${APP_NAME} is missing." >&2
  exit 1
fi

echo "Installing to ${DEST}"
rm -rf "$DEST"
ditto "$SRC" "$DEST"
xattr -cr "$DEST" 2>/dev/null || true
echo "Installed. Open with: open -a 'Tabulect'"
echo "Needs Node on PATH (Homebrew /usr/local or /opt/homebrew) plus poppler + ocrmypdf/tesseract for PDF OCR."

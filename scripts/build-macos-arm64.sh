#!/usr/bin/env bash
# Build Tabulect.app for Apple Silicon. Must run on macOS arm64.
set -euo pipefail

export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "The macOS arm64 build must run on an Apple Silicon Mac:" >&2
  echo "  git clone <this repository> && cd tabulect && ./scripts/build-macos-arm64.sh" >&2
  exit 1
fi

if [ "$(uname -m)" != "arm64" ]; then
  echo "This script targets aarch64-apple-darwin (Apple Silicon)." >&2
  exit 1
fi

command -v rustup >/dev/null 2>&1 && rustup target add aarch64-apple-darwin
npm install
chmod +x sidecar/launch.sh sidecar/server.mjs
cp sidecar/launch.sh src-tauri/binaries/tabulect-backend-aarch64-apple-darwin
chmod +x src-tauri/binaries/tabulect-backend-aarch64-apple-darwin

npm run tauri:build -- --target aarch64-apple-darwin --bundles app,dmg

# Release guard: refuse to ship any AI CLI login, token or credential file.
node scripts/check-no-credentials.mjs "$root/src-tauri/target/aarch64-apple-darwin/release/bundle"

echo "Built:"
echo "  $root/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Tabulect.app"
echo "  $root/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/"

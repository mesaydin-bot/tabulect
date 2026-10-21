#!/usr/bin/env bash
set -euo pipefail
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
chmod +x "$root/sidecar/launch.sh" "$root/sidecar/server.mjs"
for triple in \
  aarch64-apple-darwin \
  x86_64-apple-darwin \
  aarch64-unknown-linux-gnu \
  x86_64-unknown-linux-gnu
do
  dest="$root/src-tauri/binaries/tabulect-backend-${triple}"
  cp "$root/sidecar/launch.sh" "$dest"
  chmod +x "$dest"
done
echo "synced sidecar launchers"

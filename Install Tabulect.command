#!/usr/bin/env bash
# Build Tabulect from source and install it into /Applications (Apple Silicon macOS).
# Tabulect'i kaynaktan derleyip /Applications klasörüne kurar (Apple Silicon macOS).
set -euo pipefail

export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$root"

echo "=== Tabulect: building and installing to /Applications / derleniyor ve kuruluyor ==="
"$root/scripts/install-macos.sh"

echo ""
echo "=== Done / Tamamlandı: /Applications/Tabulect.app ==="
echo "Connect your own AI subscription in Tabulect → Subscriptions. / Kendi aboneliğinizi Tabulect → Abonelikler'den bağlayın."
open -R "/Applications/Tabulect.app" || true

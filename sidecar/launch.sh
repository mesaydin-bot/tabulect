#!/bin/sh
# Tauri sidecar launcher for Tabulect. Exec the Node loopback server.
# TABULECT_MAX_CHUNKS is optional: unset/empty/0 = full book.
set -eu

SERVER="${TABULECT_SERVER:-}"
NODE="${TABULECT_NODE:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --server)
      SERVER="${2:-}"
      shift 2
      ;;
    --node)
      NODE="${2:-}"
      shift 2
      ;;
    *)
      break
      ;;
  esac
done

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/opt/node/bin:${HOME:+$HOME/.local/bin}:${PATH:-/usr/bin:/bin}"
export PATH

if [ -z "$SERVER" ]; then
  for cand in \
    "$here/server.mjs" \
    "$here/../server.mjs" \
    "$here/../../sidecar/server.mjs" \
    "$here/../sidecar/server.mjs" \
    "$here/sidecar/server.mjs" \
    "$here/../Resources/sidecar/server.mjs" \
        "$here/../Resources/_up_/sidecar/server.mjs"     "$here/../Resources/resources/sidecar/server.mjs"
  do
    if [ -f "$cand" ]; then
      SERVER="$cand"
      break
    fi
  done
fi

if [ -z "$SERVER" ] || [ ! -f "$SERVER" ]; then
  echo "tabulect-backend: server.mjs not found" >&2
  exit 1
fi

if [ -z "$NODE" ]; then
  if command -v node >/dev/null 2>&1; then
    NODE=$(command -v node)
  else
    for cand in \
      /usr/local/bin/node \
      /opt/homebrew/bin/node \
      /usr/bin/node
    do
      if [ -x "$cand" ]; then
        NODE="$cand"
        break
      fi
    done
  fi
fi

if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
  echo "tabulect-backend: node not in PATH" >&2
  exit 1
fi

export TABULECT_HOST="${TABULECT_HOST:-127.0.0.1}"
export TABULECT_PORT="${TABULECT_PORT:-8755}"
exec "$NODE" "$SERVER" "$@"

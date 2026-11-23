#!/usr/bin/env bash
# Instalador para Mac (tambien sirve en Linux). Solo se asegura de que haya Node.js 20+ y lanza instalar.mjs,
# que hace todo lo demas. Uso:  bash instalar/instalar.sh
set -euo pipefail
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HERR="$HOME/.isams-sync"
NODE_VERSION="22.11.0"

node_ok() {
  command -v "$1" >/dev/null 2>&1 || [ -x "$1" ] || return 1
  [ "$("$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 20 ]
}

if node_ok node; then
  NODE="$(command -v node)"
elif node_ok "$HERR/node/bin/node"; then
  NODE="$HERR/node/bin/node"
else
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) PLAT=darwin-arm64 ;;
    Darwin-x86_64) PLAT=darwin-x64 ;;
    Linux-x86_64) PLAT=linux-x64 ;;
    Linux-aarch64 | Linux-arm64) PLAT=linux-arm64 ;;
    *) echo "No reconozco tu sistema ($(uname -s) $(uname -m)). Instala Node.js 20+ de https://nodejs.org y vuelve a correr esto."; exit 1 ;;
  esac
  echo "Descargando Node.js $NODE_VERSION en $HERR (una sola vez, ~45 MB)..."
  mkdir -p "$HERR"
  rm -rf "$HERR/node" "$HERR/node.tar.gz"
  curl -fL --progress-bar -o "$HERR/node.tar.gz" "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-$PLAT.tar.gz"
  mkdir -p "$HERR/node"
  tar -xzf "$HERR/node.tar.gz" -C "$HERR/node" --strip-components 1
  rm -f "$HERR/node.tar.gz"
  NODE="$HERR/node/bin/node"
fi

export PATH="$(dirname "$NODE"):$PATH"
exec "$NODE" "$AQUI/instalar.mjs" "$@"

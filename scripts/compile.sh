#!/usr/bin/env bash
# Compile the Private Payroll Compact contract.
#
# The Compact compiler publishes Linux/macOS binaries only (no native
# Windows build), so on Windows this script transparently runs the
# compiler inside WSL against a native-filesystem working copy (fast)
# and copies the generated artifacts back into contracts/managed/.
#
# Usage: npm run compile
set -euo pipefail
cd "$(dirname "$0")/.."

COMPACT_SRC="contracts/payroll.compact"
MANAGED_DIR="contracts/managed/payroll"

is_windows() {
  [[ "${OS:-}" == "Windows_NT" ]]
}

if ! is_windows; then
  # Linux / macOS: run the compiler directly.
  export PATH="$HOME/.local/bin:$PATH"
  rm -rf "$MANAGED_DIR"
  compact compile "$COMPACT_SRC" "$MANAGED_DIR"
  echo "✅ Compiled $COMPACT_SRC -> $MANAGED_DIR"
  exit 0
fi

# ── Windows: delegate to WSL ────────────────────────────────────────────────
if ! command -v wsl.exe >/dev/null 2>&1; then
  echo "❌ The Compact compiler has no native Windows build." >&2
  echo "   Install WSL (wsl --install) and the compiler inside it:" >&2
  echo "     curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh" >&2
  exit 1
fi

WSL_WORKDIR="\$HOME/payroll-build"
ROOT_WIN="$(pwd -W 2>/dev/null || pwd)"
ROOT_WSL="$(wsl -e bash -lc "wslpath -a '$ROOT_WIN'" | tr -d '\r')"

wsl -e bash -lc "
  set -e
  mkdir -p $WSL_WORKDIR
  cp '$ROOT_WSL/$COMPACT_SRC' $WSL_WORKDIR/payroll.compact
  cd $WSL_WORKDIR
  rm -rf managed
  export PATH=\$HOME/.local/bin:\$PATH
  compact compile payroll.compact managed/payroll
  rm -rf '$ROOT_WSL/contracts/managed'
  cp -r managed '$ROOT_WSL/contracts/'
"
echo "✅ Compiled $COMPACT_SRC -> $MANAGED_DIR (via WSL)"

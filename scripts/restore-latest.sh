#!/usr/bin/env sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BDIR="$ROOT/backups"
if [ ! -d "$BDIR" ]; then
  echo "Cartella backups non trovata: $BDIR" >&2
  exit 1
fi

LATEST="$(ls -1 "$BDIR" | sort -r | head -n1 || true)"
if [ -z "$LATEST" ]; then
  echo "Nessun backup trovato in $BDIR" >&2
  exit 1
fi

echo "[restore-latest] Userò il backup: $BDIR/$LATEST"
"$(dirname "$0")/restore.sh" "$BDIR/$LATEST"


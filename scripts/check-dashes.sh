#!/usr/bin/env bash
# Fails if any tracked file contains an em dash (U+2014) or en dash (U+2013).
# Prose uses commas, colons, parentheses or a new sentence instead.
set -euo pipefail

# UTF-8 bytes, so this file stays ASCII and doesn't match itself.
em_dash=$(printf '\342\200\224')
en_dash=$(printf '\342\200\223')

if git grep -n -e "$em_dash" -e "$en_dash" -- ':!pnpm-lock.yaml'; then
  echo "check-dashes: replace the em/en dashes above with a comma, colon, parentheses or a new sentence." >&2
  exit 1
fi

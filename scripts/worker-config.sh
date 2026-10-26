#!/usr/bin/env bash
# Writes apps/email-worker/wrangler.local.jsonc: the committed wrangler.jsonc
# with this deployment's KV namespace id in place of the placeholder. The local
# file is ignored by git, so a deployment's ids never land in the repo
# (ADR 0004). Every Worker deploy runs this, so the copy can't drift.
#
# The id comes from KV_NAMESPACE_ID in the environment, else from
# deploy/admin.env, where scripts/setup-cloudflare.sh saves it.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
template=apps/email-worker/wrangler.jsonc
out=apps/email-worker/wrangler.local.jsonc
placeholder=REPLACE_WITH_KV_NAMESPACE_ID

id="${KV_NAMESPACE_ID:-}"
if [[ -z "$id" && -f deploy/admin.env ]]; then
  id=$(sed -n 's/^KV_NAMESPACE_ID=//p' deploy/admin.env | tail -n 1)
fi
if [[ ! "$id" =~ ^[0-9a-f]{32}$ ]]; then
  echo "worker-config: set KV_NAMESPACE_ID in deploy/admin.env (32 lowercase hex characters); docs/provisioning.md step 4." >&2
  exit 1
fi
if ! grep -q "\"$placeholder\"" "$template"; then
  echo "worker-config: $template no longer has the $placeholder placeholder." >&2
  exit 1
fi

sed "s/\"$placeholder\"/\"$id\"/" "$template" >"$out"
echo "Wrote $out"

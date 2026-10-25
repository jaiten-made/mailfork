#!/usr/bin/env bash
# Deploys a release to the Pi: checks out `main` (or a release tag) in the
# Pi's checkout, rebuilds the admin image with Compose and checks the admin
# app came back. See docs/pi-deployment.md.
#
#   scripts/deploy-pi.sh              # latest main
#   scripts/deploy-pi.sh 2026.10.2    # a release tag
#
# PI_HOST (default user@server) and PI_DIR (default
# ~/private-profile) point it somewhere else.
set -euo pipefail

ref="${1:-main}"
host="${PI_HOST:-user@server}"
dir="${PI_DIR:-~/private-profile}"

# main only takes releases, so only main or a CalVer release tag is deployed.
if [[ "$ref" == main ]]; then
  git ls-remote --exit-code --heads origin main >/dev/null
elif [[ "$ref" =~ ^[0-9]{4}\.[0-9]{2}\.[0-9]+$ ]]; then
  if ! git ls-remote --exit-code --tags origin "refs/tags/$ref" >/dev/null; then
    echo "deploy-pi: no tag $ref on origin." >&2
    exit 1
  fi
else
  echo "deploy-pi: deploy main or a release tag such as 2026.10.2, not $ref." >&2
  exit 1
fi

echo "Deploying $ref to $host:$dir"

# The Pi reads the whole script before running it: fed line by line on
# stdin, `docker compose` would swallow the rest and skip the checks. PI_DIR
# reaches the Pi as text, and a leading ~ is expanded there.
ssh "$host" 'bash -c "$(cat)" deploy-pi' "$(printf '%q' "$ref")" "$(printf '%q' "$dir")" <<'REMOTE'
set -euo pipefail
ref="$1"
cd "${2/#\~/$HOME}"

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "deploy-pi: the Pi's checkout has local changes; commit or discard them first." >&2
  git status --short --untracked-files=no >&2
  exit 1
fi

before=$(git rev-parse --short HEAD)
git fetch --quiet --tags --prune origin
if [[ "$ref" == main ]]; then
  if git show-ref --verify --quiet refs/heads/main; then
    git switch --quiet main
  else
    git switch --quiet --track -c main origin/main
  fi
  git merge --quiet --ff-only origin/main
else
  git switch --quiet --detach "refs/tags/$ref"
fi
after=$(git rev-parse --short HEAD)
echo "Checkout: $before -> $after ($(git log -1 --format=%s))"

# A release can add a secret (the Backup ones came with #9). Compose only
# notices a missing secret file mid-`up`, so check them all before touching
# the running containers.
missing=$(docker compose config |
  awk '/^secrets:/ { s = 1; next } /^[^ ]/ { s = 0 } s && $1 == "file:" { print $2 }' |
  while read -r file; do [[ -f "$file" ]] || echo "$file"; done)
if [[ -n "$missing" ]]; then
  echo "deploy-pi: these secret files are missing on the Pi (docs/pi-deployment.md):" >&2
  echo "$missing" >&2
  echo "The containers are untouched. Add the files, then deploy again." >&2
  exit 1
fi

docker compose up -d --build

# Compose only recreates the container when the image changed, so wait for
# an answer rather than a start-up log line. Without an Access JWT the admin
# app must refuse every request.
status=""
for _ in $(seq 30); do
  status=$(docker compose exec -T admin node -e \
    'fetch("http://localhost:8080/").then(r => console.log(r.status), () => console.log("down"))' \
    2>/dev/null || echo down)
  [[ "$status" != down ]] && break
  sleep 2
done
if [[ "$status" == down ]]; then
  echo "deploy-pi: the admin app didn't answer within a minute. Recent logs:" >&2
  docker compose logs --tail 30 admin >&2
  exit 1
fi
if [[ "$status" != 401 ]]; then
  echo "deploy-pi: expected 401 without an Access JWT, got $status. Recent logs:" >&2
  docker compose logs --tail 30 admin >&2
  exit 1
fi

docker compose ps --format '{{.Service}}: {{.Status}}'
echo "Deployed $after. The admin app answers and refuses requests without Access."
REMOTE

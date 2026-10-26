#!/usr/bin/env bash
# Deploys a release to the server: checks out `main` (or a release tag) in
# the server's checkout, rebuilds the admin image with Compose and checks the
# admin app came back. docs/deployment.md sets one up.
#
#   DEPLOY_HOST=user@server scripts/deploy.sh              # latest main
#   DEPLOY_HOST=user@server scripts/deploy.sh 2026.10.2    # a release tag
#
# DEPLOY_HOST is the SSH destination and is required. DEPLOY_DIR is the
# checkout on the server (default ~/mailfork).
set -euo pipefail

ref="${1:-main}"
if [[ -z "${DEPLOY_HOST:-}" ]]; then
  echo "deploy: set DEPLOY_HOST to the server's SSH destination, such as user@server." >&2
  exit 1
fi
host="$DEPLOY_HOST"
dir="${DEPLOY_DIR:-~/mailfork}"

# main only takes releases, so only main or a CalVer release tag is deployed.
if [[ "$ref" == main ]]; then
  git ls-remote --exit-code --heads origin main >/dev/null
elif [[ "$ref" =~ ^[0-9]{4}\.[0-9]{2}\.[0-9]+$ ]]; then
  if ! git ls-remote --exit-code --tags origin "refs/tags/$ref" >/dev/null; then
    echo "deploy: no tag $ref on origin." >&2
    exit 1
  fi
else
  echo "deploy: deploy main or a release tag such as 2026.10.2, not $ref." >&2
  exit 1
fi

echo "Deploying $ref to $host:$dir"

# The server reads the whole script before running it: fed line by line on
# stdin, `docker compose` would swallow the rest and skip the checks.
# DEPLOY_DIR reaches the server as text, and a leading ~ is expanded there.
ssh "$host" 'bash -c "$(cat)" deploy' "$(printf '%q' "$ref")" "$(printf '%q' "$dir")" <<'REMOTE'
set -euo pipefail
ref="$1"
cd "${2/#\~/$HOME}"

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "deploy: the server's checkout has local changes; commit or discard them first." >&2
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
  echo "deploy: these secret files are missing on the server (docs/deployment.md):" >&2
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
  echo "deploy: the admin app didn't answer within a minute. Recent logs:" >&2
  docker compose logs --tail 30 admin >&2
  exit 1
fi
if [[ "$status" != 401 ]]; then
  echo "deploy: expected 401 without an Access JWT, got $status. Recent logs:" >&2
  docker compose logs --tail 30 admin >&2
  exit 1
fi

docker compose ps --format '{{.Service}}: {{.Status}}'
echo "Deployed $after. The admin app answers and refuses requests without Access."
REMOTE

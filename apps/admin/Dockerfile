# The admin app for a home server (linux/arm64 or linux/amd64). Build from
# the repo root so the shared package is in the context:
#   docker build -f apps/admin/Dockerfile .
# compose.yaml at the repo root does this for you.

# The official restic release for the image's architecture, checked against
# the SHA-256 in its SHA256SUMS. Keep the version in step with
# .github/workflows/ci.yml.
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS restic
ARG TARGETARCH
ARG RESTIC_VERSION=0.19.1
ARG RESTIC_SHA256_ARM64=a5f64aaab53d51e311fa3829124c5b703f2d14cf187d8640b6be3b2b49376465
ARG RESTIC_SHA256_AMD64=f415415624dcc452f2a02b8c33641791a8c6d6d3b65bbb3543fcf9a25151585c
RUN apt-get update \
  && apt-get install --yes --no-install-recommends bzip2 ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
RUN case "$TARGETARCH" in \
      arm64) sha256="$RESTIC_SHA256_ARM64" ;; \
      amd64) sha256="$RESTIC_SHA256_AMD64" ;; \
      *) echo "No restic checksum for $TARGETARCH" >&2; exit 1 ;; \
    esac \
  && curl --fail --silent --show-error --location --output /tmp/restic.bz2 \
    "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_${TARGETARCH}.bz2" \
  && echo "${sha256}  /tmp/restic.bz2" | sha256sum --check --strict - \
  && bunzip2 --stdout /tmp/restic.bz2 > /usr/local/bin/restic \
  && chmod 0755 /usr/local/bin/restic

FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN npm install --global pnpm@10.29.3
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/admin/package.json apps/admin/
# Scripts are off: the root `prepare` needs git, and the admin app's
# dependencies have no build step.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter @private-profile/admin...

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app ./
COPY packages/shared/src packages/shared/src
COPY apps/admin/src apps/admin/src
COPY apps/admin/public apps/admin/public
COPY --from=restic /usr/local/bin/restic /usr/local/bin/restic
# restic reaches R2 over HTTPS, and the slim image has no CA bundle.
COPY --from=restic /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
# A named volume mounted here takes this ownership, so the app can write
# the Profile database without running as root.
RUN mkdir /data && chown node:node /data
USER node
WORKDIR /app/apps/admin
# Node runs the TypeScript directly by stripping types.
CMD ["node", "src/index.ts"]

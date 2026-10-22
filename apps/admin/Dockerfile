# The admin app for the Raspberry Pi 4 (linux/arm64). Build from the repo
# root so the shared package is in the context:
#   docker build -f apps/admin/Dockerfile .
# compose.yaml at the repo root does this for you.

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
# A named volume mounted here takes this ownership, so the app can write
# the Profile database without running as root.
RUN mkdir /data && chown node:node /data
USER node
WORKDIR /app/apps/admin
# Node runs the TypeScript directly by stripping types.
CMD ["node", "src/index.ts"]

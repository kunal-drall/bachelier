# Shared Dockerfile for the TS services (indexer / api / keeper).
# Runs the TS source directly with tsx; the workspace is installed once.
FROM node:22-alpine AS base
ARG SERVICE
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY db/package.json db/
COPY indexer/package.json indexer/
COPY api/package.json api/
COPY keeper/package.json keeper/
RUN pnpm install --frozen-lockfile --filter "@bachelier/${SERVICE}..."

COPY packages/shared packages/shared
COPY db db
COPY indexer indexer
COPY api api
COPY keeper keeper

ENV NODE_ENV=production
ENV SERVICE=${SERVICE}
WORKDIR /app/${SERVICE}
CMD ["pnpm", "start"]

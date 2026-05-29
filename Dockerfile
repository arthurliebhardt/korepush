# syntax=docker/dockerfile:1
#
# Monorepo build for the kubepush control plane (apps/web).
# Build context is the repo root.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# ---- build: install workspace deps, build the app, bundle the migrator ----
FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
# Next standalone output -> apps/web/.next/standalone/apps/web/server.js
RUN pnpm build
# Self-contained migrator (postgres + drizzle-orm inlined) -> packages/db/dist/migrate.mjs
RUN pnpm --filter @kubepush/db run build:migrator

# ---- runner: minimal image, no node_modules install ----
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup -S kubepush && adduser -S kubepush -G kubepush

# Standalone server bundle (includes traced node_modules + compiled workspace pkgs).
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

# Migrations: bundled migrator + SQL files, run before the server starts.
COPY --from=build /app/packages/db/dist/migrate.mjs ./migrate.mjs
COPY --from=build /app/packages/db/drizzle ./drizzle
COPY --from=build /app/scripts/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER kubepush
EXPOSE 3000
CMD ["./entrypoint.sh"]

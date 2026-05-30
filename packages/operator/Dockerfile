# syntax=docker/dockerfile:1
#
# korepush operator. The operator is an esbuild single-file bundle
# (self-contained — client-node + db deps inlined), so the runtime image is just
# Node + the bundle. Build context is the repo root (pnpm workspace).

FROM node:22-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

# ---- build: install workspace deps, bundle the operator ----
FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
# Self-contained operator -> packages/operator/dist/operator.mjs
RUN pnpm --filter @korepush/operator build

# ---- runner: minimal image, no node_modules install ----
FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app/packages/operator/dist/operator.mjs ./operator.mjs
USER node
CMD ["node", "operator.mjs"]

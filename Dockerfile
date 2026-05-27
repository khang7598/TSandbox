FROM node:22-slim AS base
RUN npm i -g pnpm

# ── Build stage ──────────────────────────────────────────────────────
FROM base AS builder
# isolated-vm is a native addon — needs Python + C++ toolchain for node-gyp
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/sdk/package.json        packages/sdk/
COPY packages/backend/package.json    packages/backend/
COPY packages/frontend/package.json   packages/frontend/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
# Prune to production-only deps — strips devDeps (typescript, vite, tsx, etc.)
RUN pnpm --filter @tsandbox/backend deploy --prod /prod

# ── Runtime stage ────────────────────────────────────────────────────
FROM node:22-slim
# curl is only needed for the HEALTHCHECK
RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Production deps only (no pnpm needed at runtime)
COPY --from=builder /prod/node_modules          ./node_modules
# Compiled backend
COPY --from=builder /app/packages/backend/dist  ./dist
# Frontend static files — served by Fastify at /
COPY --from=builder /app/packages/frontend/dist ./public

EXPOSE 3001
VOLUME ["/data"]

ENV NODE_ENV=production
ENV PORT=3001
ENV DB_PATH=/data/tsandbox.db
ENV SANDBOXES_DIR=/data/sandboxes
ENV LOG_DIR=/data/logs

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3001/_api/health || exit 1

CMD ["node", "dist/index.js"]

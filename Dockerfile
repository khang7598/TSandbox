FROM node:20-slim AS base
RUN npm i -g pnpm

# ── Build stage ──────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/sdk/package.json        packages/sdk/
COPY packages/backend/package.json    packages/backend/
COPY packages/frontend/package.json   packages/frontend/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ── Runtime stage ────────────────────────────────────────────────────
FROM node:20-slim
RUN npm i -g pnpm
WORKDIR /app

COPY --from=builder /app/packages/backend/dist        packages/backend/dist
COPY --from=builder /app/packages/backend/package.json packages/backend/
COPY --from=builder /app/packages/frontend/dist       packages/frontend/dist
COPY --from=builder /app/node_modules                 node_modules
COPY --from=builder /app/packages/backend/node_modules packages/backend/node_modules
COPY package.json ./

EXPOSE 3001
VOLUME ["/data"]

ENV NODE_ENV=production
ENV PORT=3001
ENV DB_PATH=/data/tsandbox.db
ENV SANDBOXES_DIR=/data/sandboxes

CMD ["node", "packages/backend/dist/index.js"]

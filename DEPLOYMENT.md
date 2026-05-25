# Deploying TSandbox

## Containerize with Docker

TSandbox uses native Node.js addons (`isolated-vm`, `better-sqlite3`) that must compile against a specific Node.js version. Use `node:20-slim` — avoid Alpine (musl libc breaks native addons).

A [`Dockerfile`](./Dockerfile) and [`docker-compose.yml`](./docker-compose.yml) are included at the repo root.

```bash
docker compose up -d
```

---

## Serving the Frontend

The backend serves only the API. In production, either:

**Option A — nginx reverse proxy (recommended)**

```nginx
server {
  listen 80;

  # Frontend static files
  location / {
    root /app/packages/frontend/dist;
    try_files $uri $uri/ /index.html;
  }

  # Backend API + mock sandbox + WebSocket
  location ~ ^/(_api|_sandbox|_ws) {
    proxy_pass http://localhost:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

**Option B — serve frontend from Fastify**

Add to `packages/backend/src/server.ts` before the proxy plugin:

```typescript
import fastifyStatic from '@fastify/static'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

await app.register(fastifyStatic, {
  root: path.resolve(__dirname, '../../../frontend/dist'),
  prefix: '/',
  decorateReply: false,
})
```

---

## Persistent Storage

**Always mount a volume for `/data`.** Without it, all sandboxes and history are lost on every redeploy.

| Path | Contains |
|---|---|
| `/data/tsandbox.db` | SQLite database (sandboxes, routes, history) |
| `/data/sandboxes/` | Mock `.ts` source files, one directory per sandbox |

Back these up before upgrading.

---

## Scaling

TSandbox is designed as a **single-instance** service:

- SQLite is not safe for concurrent writes across multiple processes
- The route registry lives in memory — instances don't share it

Run **one container, one replica**. If you need high availability, put a load balancer in front with sticky sessions, or migrate the storage layer to Postgres + Redis (a future roadmap item).

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | HTTP listen port |
| `SANDBOXES_DIR` | `~/.tsandbox/sandboxes` | Root directory for sandbox files |
| `DB_PATH` | `~/.tsandbox/tsandbox.db` | SQLite database path |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed origins |
| `SANDBOX_MEMORY_MB` | `128` | Memory cap per sandbox isolate |
| `SANDBOX_TIMEOUT_MS` | `10000` | Max handler execution time (ms) |
| `HOT_RELOAD_DEBOUNCE_MS` | `200` | File-change debounce (ms) |

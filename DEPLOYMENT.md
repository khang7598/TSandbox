# Deploying TSandbox

## Option A — Pull from GHCR (recommended)

Pre-built images are published to GitHub Container Registry on every release.

```bash
docker pull ghcr.io/khang7598/tsandbox:latest
```

Run with a persistent volume:

```bash
docker run -d \
  --name tsandbox \
  --restart unless-stopped \
  -p 3001:3001 \
  -v tsandbox_data:/data \
  ghcr.io/khang7598/tsandbox:latest
```

Or with docker compose — create a `docker-compose.yml`:

```yaml
services:
  tsandbox:
    image: ghcr.io/khang7598/tsandbox:latest
    ports:
      - "3001:3001"
    volumes:
      - tsandbox_data:/data
    environment:
      CORS_ORIGINS: "https://your-frontend.example.com"
    restart: unless-stopped

volumes:
  tsandbox_data:
```

```bash
docker compose up -d
```

To pin to a specific release instead of `latest`:

```yaml
image: ghcr.io/khang7598/tsandbox:1.0.0
```

Available tags: `latest`, `1.0.0`, `1.0` — see all at [ghcr.io/khang7598/tsandbox](https://github.com/khang7598/TSandbox/pkgs/container/tsandbox).

---

## Option B — Build from source

Use this if you want to customise the image or test local changes.

A [`Dockerfile`](./Dockerfile) and [`docker-compose.yml`](./docker-compose.yml) are included at the repo root. The `docker-compose.yml` builds the image locally:

```bash
docker compose up -d --build
```

> **Note:** TSandbox uses native Node.js addons (`isolated-vm`, `better-sqlite3`).
> The Dockerfile requires `node:22-slim` — avoid Alpine (musl libc breaks native addons).

---

## Serving the Frontend

The Docker image serves the built frontend as static files from Fastify on port `3001` — no separate web server is needed.

For custom routing or TLS termination, add an nginx reverse proxy in front:

```nginx
server {
  listen 80;

  location / {
    proxy_pass http://localhost:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }
}
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

## Upgrading

```bash
# Pull the new image
docker compose pull

# Recreate the container (data volume is preserved)
docker compose up -d
```

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
| `SANDBOXES_DIR` | `/data/sandboxes` | Root directory for sandbox files |
| `DB_PATH` | `/data/tsandbox.db` | SQLite database path |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed origins |
| `SANDBOX_MEMORY_MB` | `128` | Memory cap per sandbox isolate |
| `SANDBOX_TIMEOUT_MS` | `10000` | Max handler execution time (ms) |
| `HOT_RELOAD_DEBOUNCE_MS` | `200` | File-change debounce (ms) |

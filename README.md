# TSandbox — Team Guide

TSandbox is a programmable API sandbox platform. Instead of static JSON fixtures, you write TypeScript handlers that run live in isolated sandboxes — with hot reload, request history, runtime logs, and shared state.

---

## Getting Started

```bash
pnpm install
pnpm dev
```

Open **http://localhost:5173** in your browser.

1. Click **+** in the sidebar to create a sandbox (e.g. `payments-service`)
2. Two example files are seeded automatically: `data.ts` (shared data) and `users.ts` (a route that imports from it)
3. Edit files in the Monaco editor — changes hot-reload in under a second
4. Use the **API** tab on the right to send test requests: try `GET /users` or `GET /users/1`

---

## Sandbox Concepts

| Concept | Description |
|---|---|
| **Sandbox** | An isolated environment with its own routes, state, and history. Create one per service you want to mock. |
| **Route** | A single `.ts` file that handles one URL pattern. One file = one route. |
| **State** | A plain object that persists across requests within a sandbox. Survives hot reloads, resets on sandbox state clear. |
| **History** | Every request/response is recorded in the History tab with headers, body, and duration. |

---

## Writing a Mock

Every mock file must export a `defineMock()` result as its default export:

```typescript
import { defineMock, ok } from '@tsandbox/sdk'

export default defineMock({
  method: 'GET',
  path: '/users/:id',

  async handler({ params, query, body, headers, state, logger }) {
    logger.info('fetching user', { id: params.id })
    return ok({ id: params.id })
  },
})
```

### File naming

Organize files however your team prefers. Suggested conventions:

```
data.ts                   # shared data / fixtures
routes/users.ts           # grouped by resource
routes/payments/charge.ts # nested
```

### Importing shared files

Files without a `defineMock()` export are treated as plain helpers — they won't appear as routes. Import them freely from your mock handlers:

```typescript
// data.ts
export const products = [
  { id: '1', name: 'Widget', price: 9.99 },
  { id: '2', name: 'Gadget', price: 24.99 },
]
```

```typescript
// routes/products.ts
import { defineMock, ok, notFound } from '@tsandbox/sdk'
import { products } from '../data'

export default defineMock({
  method: 'GET',
  path: '/products/:id?',

  async handler({ params, logger }) {
    logger.info('products request', { id: params.id })
    if (params.id) {
      const product = products.find((p) => p.id === params.id)
      return product ? ok(product) : notFound()
    }
    return ok(products)
  },
})
```

esbuild bundles local imports automatically — no build step or configuration needed.

---

## Methods

```typescript
method: 'GET'
method: 'POST'
method: ['GET', 'POST']   // multiple methods in one handler
method: 'ALL'             // match any method
```

---

## Path Patterns

Uses Express-style patterns:

```typescript
path: '/users'            // exact match
path: '/users/:id'        // named param  → params.id
path: '/orgs/:org/repos/:repo'  // multiple params
path: '/files/*'          // wildcard
path: '/v:version/api'    // partial segment → params.version
```

---

## Handler Context

```typescript
async handler({ method, params, query, body, headers, cookies, state, logger }) {
  // method   — 'GET' | 'POST' | ...
  // params   — path parameters from the URL pattern
  // query    — query string as key→value or key→string[]
  // body     — parsed request body (JSON by default)
  // headers  — request headers (lowercased keys)
  // cookies  — parsed cookies
  // state    — persistent sandbox state (see below)
  // logger   — logger.info / .warn / .error / .debug → Runtime Logs panel
}
```

---

## Response Helpers

All helpers are imported from `@tsandbox/sdk`.

### Status shortcuts

```typescript
return ok({ data: 'value' })           // 200
return ok('plain string')              // 200 text
return noContent()                     // 204
return notFound()                      // 404
return unauthorized()                  // 401
return forbidden()                     // 403
return serverError()                   // 500
```

### Custom status + headers

```typescript
return json({ created: true }, 201)

return ok({ data: 'value' }, {
  headers: { 'x-request-id': 'abc123' },
})
```

### Error with message

```typescript
return error('Validation failed', 422)
```

### Redirect

```typescript
return redirect('https://example.com/new-url', 301)
```

### XML / SOAP

```typescript
import { xml, soapResponse, soapFault } from '@tsandbox/sdk'

return xml('<users><user id="1"/></users>')
return soapResponse('<ns:Result>ok</ns:Result>')
return soapFault('Client', 'Invalid input')
```

---

## Simulating Latency

```typescript
import { defineMock, ok, delay } from '@tsandbox/sdk'

export default defineMock({
  method: 'GET',
  path: '/slow-endpoint',

  async handler() {
    await delay(800)   // 800ms artificial delay
    return ok({ message: 'finally' })
  },
})
```

---

## Simulating Flaky APIs

```typescript
import { defineMock, ok, serverError, randomFailure } from '@tsandbox/sdk'

export default defineMock({
  method: 'POST',
  path: '/payments/charge',

  async handler({ body }) {
    // Fail 20% of the time
    return randomFailure(0.2, serverError('Payment gateway timeout'))
      ?? ok({ charged: true, amount: (body as { amount: number }).amount })
  },
})
```

---

## Persistent State

`state` is a plain object that survives across requests for the lifetime of the sandbox. Use it to build stateful simulations without any external database.

### Counter

```typescript
async handler({ state, logger }) {
  state.calls = ((state.calls as number) ?? 0) + 1
  logger.info('call count', { total: state.calls })
  return ok({ callCount: state.calls })
}
```

### In-memory CRUD store

```typescript
import { defineMock, ok, notFound, noContent } from '@tsandbox/sdk'

type Item = { id: string; name: string }

export default defineMock({
  method: ['GET', 'POST', 'PUT', 'DELETE'],
  path: '/items/:id?',

  async handler({ method, params, body, state, logger }) {
    const store = (state.items as Record<string, Item>) ?? {}
    logger.info('items request', { method, id: params.id })

    if (method === 'GET' && params.id) {
      return store[params.id] ? ok(store[params.id]) : notFound()
    }

    if (method === 'GET') {
      return ok(Object.values(store))
    }

    if (method === 'POST') {
      const item = body as Item
      store[item.id] = item
      state.items = store
      logger.info('item created', { id: item.id })
      return ok(item, { status: 201 })
    }

    if (method === 'PUT') {
      if (!store[params.id]) return notFound()
      store[params.id] = { ...store[params.id], ...(body as Partial<Item>) }
      state.items = store
      logger.info('item updated', { id: params.id })
      return ok(store[params.id])
    }

    if (method === 'DELETE') {
      delete store[params.id]
      state.items = store
      logger.info('item deleted', { id: params.id })
      return noContent()
    }
  },
})
```

### Toggle behavior after N calls

```typescript
async handler({ state }) {
  state.count = ((state.count as number) ?? 0) + 1

  // First 3 calls succeed, then start failing
  if ((state.count as number) > 3) {
    return serverError('Rate limit exceeded')
  }
  return ok({ remaining: 3 - (state.count as number) })
}
```

---

## Logging

`logger` writes to the **Runtime Logs** tab in the UI. Useful for debugging without changing the response body.

```typescript
async handler({ params, body, logger }) {
  logger.info('request received', { id: params.id })
  logger.warn('missing optional field', { field: 'description' })
  logger.error('unexpected value', { body })
  return ok({})
}
```

Log levels: `logger.info`, `logger.warn`, `logger.error`, `logger.debug`

---

## Calling the Mock from Your App

The base URL for any sandbox is:

```
http://localhost:3001/_sandbox/{sandboxId}/{your-path}
```

Find your sandbox ID in the browser URL or by hovering over the sandbox name in the sidebar.

You can also use the `X-Sandbox-Id` header if you don't want to change base URLs:

```bash
curl -H "X-Sandbox-Id: your-sandbox-id" http://localhost:3001/users/123
```

### Example with curl

```bash
# GET
curl http://localhost:3001/_sandbox/abc123/users/42

# POST with JSON body
curl -X POST http://localhost:3001/_sandbox/abc123/users \
  -H "Content-Type: application/json" \
  -d '{"id": "1", "name": "Alice"}'
```

The **API** tab in the UI also has a **Copy as cURL** button on every response.

---

## State Inspector

The **State** tab shows the current value of `state` for the active sandbox in real time. You can also:

- **Edit** state directly as JSON (useful for seeding initial data)
- **Reset** state to `{}` to start fresh

---

## Resetting / Clearing

| Action | How |
|---|---|
| Clear request history | History tab → **Clear** button |
| Reset sandbox state | State tab → **Reset** button |
| Delete a file | Right-click file in sidebar → **Delete file** |
| Delete a folder | Right-click folder → **Delete folder** |
| Rename a file or folder | Right-click → **Rename**, or press **F2** |
| Delete a sandbox | Hover sandbox name → trash icon |

---

## Constraints

These are intentional security boundaries of the sandbox runtime:

- No outbound network calls (`fetch`, `axios`, etc. are not available)
- No Node.js built-ins (`fs`, `path`, `crypto`, etc.)
- No `require()` other than `@tsandbox/sdk`
- `delay()` is the only async operation supported
- Maximum execution time: 10 seconds per request
- Maximum memory: 128 MB per sandbox isolate

If you need data from an external source, seed it into `state` via the State Inspector before your test run.

---

## Deploying

### Containerize with Docker

TSandbox uses native Node.js addons (`isolated-vm`, `better-sqlite3`) that must compile against a specific Node.js version. Use `node:20-slim` — avoid Alpine (musl libc breaks native addons).

A [`Dockerfile`](./Dockerfile) and [`docker-compose.yml`](./docker-compose.yml) are included at the repo root.

```bash
docker compose up -d
```

### Serving the frontend

The backend currently serves only the API. In production, either:

**Option A — nginx reverse proxy (recommended)**

```nginx
server {
  listen 80;

  # Frontend static files
  location / {
    root /app/packages/frontend/dist;
    try_files $uri $uri/ /index.html;
  }

  # Backend API + mock sandbox
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

### Persistent storage

**Always mount a volume for `/data`.** Without it, all sandboxes and history are lost on every redeploy.

| Path | Contains |
|---|---|
| `/data/tsandbox.db` | SQLite database (sandboxes, routes, history) |
| `/data/sandboxes/` | Mock `.ts` source files, one directory per sandbox |

Back these up like any other database before upgrading.

### Scaling

TSandbox is designed as a **single-instance** service:

- SQLite is not safe for concurrent writes across multiple processes
- The route registry lives in memory — instances don't share it

Run **one container, one replica**. If you need high availability, put a load balancer in front and use sticky sessions, or migrate the storage layer to Postgres + Redis (a future roadmap item).

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | HTTP listen port |
| `SANDBOXES_DIR` | `~/.tsandbox/sandboxes` | Root directory for sandbox files |
| `DB_PATH` | `~/.tsandbox/tsandbox.db` | SQLite database path |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed origins |
| `SANDBOX_MEMORY_MB` | `128` | Memory cap per sandbox isolate |
| `SANDBOX_TIMEOUT_MS` | `10000` | Max handler execution time (ms) |
| `HOT_RELOAD_DEBOUNCE_MS` | `200` | File-change debounce (ms) |

---

## Tips

- **One sandbox per service** — keeps routes, state, and history isolated between teams
- **Use `logger` not `console.log`** — output appears in the Runtime Logs panel, not the terminal
- **State survives hot reload** — you can edit a handler mid-test without losing accumulated state
- **History tab is your friend** — every request records full headers, body, and duration; no need to add extra logging for debugging
- **F2 to rename** — works on files and folders in the sidebar

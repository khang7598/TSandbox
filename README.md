# TSandbox — Team Guide

TSandbox is a programmable API sandbox platform. Instead of static JSON fixtures, you write TypeScript handlers that run live in isolated sandboxes — with hot reload, request history, runtime logs, and shared state.

![TSandbox UI](./docs/screenshot.png)

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

## Importing from an OpenAPI Spec

Click the **↑** icon in the **Files** section header to import an OpenAPI 3.x spec. Paste JSON or YAML — one `defineMock()` file is generated per operation, grouped by tag or first path segment.

Generated handlers include:

- **Response shapes** inferred from the `200`/`201` response schema (with example values where provided)
- **Body validation** for operations with `required` request body fields — returns a `400` automatically if fields are missing
- **Multi-response simulation** via `?__status=<code>` — trigger any error branch defined in the spec without touching code:

```bash
curl "http://localhost:3001/orders?__status=422"   # triggers 422 branch
curl "http://localhost:3001/users/99?__status=404" # triggers 404 branch
```

- **SSE stubs** for `text/event-stream` endpoints — returns a well-formed SSE payload using `sse()`

After import, each generated file is fully editable — treat it as a starting point, not a locked artifact.

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

### Custom status

```typescript
return json({ created: true }, 201)
return error('Validation failed', 422)
return error('Rate limit exceeded', 429, { retryAfter: 60 })
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

### Server-Sent Events

Returns a well-formed SSE body with the correct `text/event-stream` headers. All events are delivered in a single response — suitable for mocking clients that consume SSE streams.

```typescript
import { defineMock, sse } from '@tsandbox/sdk'

export default defineMock({
  method: 'GET',
  path: '/events',

  async handler() {
    return sse([
      { event: 'connected', data: { sessionId: 'abc123' } },
      { event: 'message',   data: { type: 'update', id: '1' } },
      { event: 'message',   data: { type: 'update', id: '2' } },
    ])
  },
})
```

Each event accepts `data` (required), `event` (event name), and `id` (event id). Objects are JSON-serialised automatically.

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
    const success = ok({ charged: true })
    return randomFailure(success, 0.2, serverError('Payment gateway timeout'))
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
      return ok(item, 201)
    }

    if (method === 'PUT') {
      if (!store[params.id]) return notFound()
      store[params.id] = { ...store[params.id], ...(body as Partial<Item>) }
      state.items = store
      return ok(store[params.id])
    }

    if (method === 'DELETE') {
      delete store[params.id]
      state.items = store
      return noContent()
    }
  },
})
```

### Toggle behavior after N calls

```typescript
async handler({ state }) {
  state.count = ((state.count as number) ?? 0) + 1

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
- SSE responses deliver all events in a single payload — true long-lived streaming is not supported
- Maximum execution time: 10 seconds per request
- Maximum memory: 128 MB per sandbox isolate

If you need data from an external source, seed it into `state` via the State Inspector before your test run.

---

## Tips

- **One sandbox per service** — keeps routes, state, and history isolated between teams
- **Use `logger` not `console.log`** — output appears in the Runtime Logs panel, not the terminal
- **State survives hot reload** — you can edit a handler mid-test without losing accumulated state
- **History tab is your friend** — every request records full headers, body, and duration; no need to add extra logging for debugging
- **F2 to rename** — works on files and folders in the sidebar
- **`?__status=<code>` on any request** — triggers the matching error branch in OpenAPI-imported handlers without editing code

---

## Deploying

See [DEPLOYMENT.md](./DEPLOYMENT.md) for Docker setup, nginx configuration, persistent storage, scaling notes, and all environment variables.

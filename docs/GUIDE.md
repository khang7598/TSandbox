# Writing Mocks — SDK Guide

This guide covers everything you need to write, organise, and test mock handlers in TSandbox.

**Contents**

- [Mock file format](#mock-file-format)
- [File naming](#file-naming)
- [Importing shared files](#importing-shared-files)
- [Methods](#methods)
- [Path patterns](#path-patterns)
- [Handler context](#handler-context)
- [Response helpers](#response-helpers)
- [Simulating latency](#simulating-latency)
- [Simulating flaky APIs](#simulating-flaky-apis)
- [Persistent state](#persistent-state)
- [Logging](#logging)
- [Calling the mock from your app](#calling-the-mock-from-your-app)
- [State inspector](#state-inspector)
- [Resetting and clearing](#resetting-and-clearing)

---

## Mock file format

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

---

## File naming

Organise files however your team prefers. Suggested conventions:

```
data.ts                   # shared data / fixtures
routes/users.ts           # grouped by resource
routes/payments/charge.ts # nested
```

---

## Importing shared files

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

## Path patterns

Uses Express-style patterns:

```typescript
path: '/users'                   // exact match
path: '/users/:id'               // named param  → params.id
path: '/orgs/:org/repos/:repo'   // multiple params
path: '/files/*'                 // wildcard
path: '/v:version/api'           // partial segment → params.version
```

---

## Handler context

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

## Response helpers

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

## Simulating latency

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

## Simulating flaky APIs

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

## Persistent state

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

### Toggle behaviour after N calls

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

## Calling the mock from your app

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

## State inspector

The **State** tab shows the current value of `state` for the active sandbox in real time. You can also:

- **Edit** state directly as JSON (useful for seeding initial data)
- **Reset** state to `{}` to start fresh

---

## Resetting and clearing

| Action | How |
|---|---|
| Clear request history | History tab → **Clear** button |
| Reset sandbox state | State tab → **Reset** button |
| Delete a file | Right-click file in sidebar → **Delete file** |
| Delete a folder | Right-click folder → **Delete folder** |
| Rename a file or folder | Right-click → **Rename**, or press **F2** |
| Delete a sandbox | Hover sandbox name → trash icon |

---

## Tips

- **`logger` not `console.log`** — output goes to the Runtime Logs panel, visible to your team
- **State survives hot reload** — edit a handler mid-test without losing accumulated state
- **`?__status=<code>` on any request** — triggers error branches in OpenAPI-imported handlers
- **F2 to rename** — works on files and folders in the sidebar
- **History tab** — every request records full headers, body, timing, and response
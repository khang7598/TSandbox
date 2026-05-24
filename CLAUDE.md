# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**TSandbox** — a programmable API sandbox platform. Developers write TypeScript mock handlers that execute live in isolated sandboxes, with hot reload, a Monaco editor UI, and request history. Philosophy: *Mock APIs as code*, not static JSON.

## Commands

```bash
# Install all workspace dependencies
pnpm install

# Run everything (backend + frontend) concurrently
pnpm dev

# Run only backend
pnpm --filter @mocktool/backend dev

# Run only frontend
pnpm --filter @mocktool/frontend dev

# Build all packages
pnpm build

# Type-check all packages
pnpm typecheck

# Build a single package
pnpm --filter @tsandbox/sdk build

# Run backend in production mode
pnpm --filter @mocktool/backend start
```

No test runner is configured yet — add Vitest when needed.

## Monorepo Layout

```
packages/
  sdk/       @tsandbox/sdk      — defineMock() helpers & TypeScript types (zero deps)
  backend/   @mocktool/backend  — Fastify server, runtime engine, SQLite DB
  frontend/  @mocktool/frontend — React + Vite + Monaco editor UI
```

## Architecture

### Request flow

```
HTTP request
  → Fastify catch-all (proxy.ts)
    → RouteRegistry.find(method, pathname)   ← O(n) scan, Map-backed
      → executeHandler() in isolated-vm      ← fresh Context per request
        → response serialised back to host
          → SQLite history recorded
            → WebSocket log broadcast to UI
```

The server **never restarts** and **never re-registers routes** on edits. Only the in-memory `CompiledHandler` reference inside the `RegistryEntry` is swapped.

### Hot-reload pipeline

```
File write (editor UI or disk)
  → chokidar detects change (watcher.ts)
    → debounce (default 200ms)
      → esbuild compiles TS → CJS bundle  (compiler.ts)
        → on success: registry.register() atomically replaces handler
          → ivm Script cache invalidated   (sandbox.ts)
            → WebSocket broadcast `route_updated`
        → on failure: broadcast `compile_error`, keep old handler alive
```

### Route registry (`registry/index.ts`)

- `Map<sandboxId, RegistryEntry[]>` — entries are stable object references
- Path matching uses `path-to-regexp` (same as Express)
- Key: `registry.register(entry)` swaps a single entry reference — atomic, no router rebuild
- Routes are also persisted to SQLite (`routes` table) for reload on restart

### Sandbox execution (`runtime/sandbox.ts`)

- One `ivm.Isolate` per `(sandboxId, routeId)` pair, cached in `scriptCache`
- Fresh `ivm.Context` per request (cheap to create)
- CJS shim injected at the top of every compiled bundle so `require()` throws
- Async support: `delay()` bridged via `ivm.Reference` callback to host `setTimeout`
- State is kept **on the host** (`sandboxStates` Map), serialised into the isolate per request, mutated state written back after execution
- Isolate disposed and cache entry evicted on every hot reload

### Compiler (`runtime/compiler.ts`)

- `esbuild.build()` with `bundle: true`, `format: 'cjs'`, `platform: 'neutral'`
- `@tsandbox/sdk` imports intercepted by an esbuild plugin and replaced with an inline shim so the SDK works inside isolated-vm without Node.js
- The `SDK_SHIM` constant is prepended to every compiled bundle

### SDK (`packages/sdk`)

Simple, zero-dependency helpers. Must stay dependency-free — it gets inlined into every sandboxed bundle.

Key exports: `defineMock`, `defineSoapMock`, `ok`, `json`, `error`, `xml`, `soapResponse`, `soapFault`, `redirect`, `delay`, `notFound`, `unauthorized`, `forbidden`, `serverError`, `noContent`, `randomFailure`.

### Database (`db/index.ts`)

SQLite via `better-sqlite3` (synchronous). Tables:
- `sandboxes` — sandbox metadata
- `routes` — persisted route registry (for restart recovery)
- `request_history` — rolling window of requests/responses (capped by `historyLimit`)
- `compile_errors` — latest compile error per route

### WebSocket (`ws/index.ts`)

Single `/_ws` endpoint. Server pushes events to all connected clients. Message types:
- `route_updated` / `route_deleted` — triggers frontend query invalidation
- `compile_error` — displays inline errors in Monaco
- `runtime_logs` — console output from sandbox handlers
- `runtime_error` — uncaught handler exceptions

### Management API (`routes/management.ts`)

All endpoints are prefixed `/_api`. File operations use `safePath()` to prevent path traversal. Saving a file via `PUT /_api/sandboxes/:id/files/*` also triggers the hot-reload pipeline directly (same as if the file was written to disk).

### Frontend (`packages/frontend`)

VSCode-inspired 3-panel layout:
- **Left**: sandbox list + file tree
- **Center**: Monaco editor (tabs per open file)
- **Right**: API Explorer / Request History / Runtime Logs / State Inspector

State: Zustand store for UI state (active sandbox, open files, logs, notifications). Server state: React Query (TanStack Query v5).

## Environment Variables (backend)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | HTTP port |
| `SANDBOXES_DIR` | `~/.tsandbox/sandboxes` | Root dir for sandbox files |
| `DB_PATH` | `~/.tsandbox/tsandbox.db` | SQLite DB path |
| `SANDBOX_MEMORY_MB` | `128` | isolated-vm memory cap |
| `SANDBOX_TIMEOUT_MS` | `10000` | Max handler execution time |
| `HOT_RELOAD_DEBOUNCE_MS` | `200` | File-change debounce |
| `CORS_ORIGINS` | `http://localhost:5173,...` | Allowed CORS origins |

## Security Model

- **isolated-vm** is mandatory — never use `vm`, `eval`, or `Function` for user code
- `require()` throws inside sandboxes (enforced in the CJS shim wrapper)
- `delay()` is the only bridge to host APIs; all other Node.js globals are absent
- Path traversal on file operations blocked by `safePath()` in management.ts
- CORS restricted to configured origins

## Mock File Format

Every mock file must export a `defineMock()` result as default:

```typescript
import { defineMock, ok, error, delay } from '@tsandbox/sdk'

export default defineMock({
  method: 'GET',           // or ['GET','POST'] or 'ALL'
  path: '/users/:id',      // Express-style path pattern
  description: 'optional',

  async handler({ params, query, body, headers, cookies, state, env, logger }) {
    logger.info('handling request', params)
    await delay(100)       // artificial latency
    state.count = (state.count as number ?? 0) + 1
    return ok({ id: params.id, count: state.count })
  },
})
```

## Phase Roadmap

- **Phase 1** (current): REST mocks, hot reload, Monaco editor, isolated-vm, request history
- **Phase 2**: SOAP mocks, OpenAPI/WSDL import, Yjs collaborative editing (y-monaco + y-websocket)
- **Phase 3**: Multi-tenant SaaS, Playwright integration, runtime pools, AI mock generation

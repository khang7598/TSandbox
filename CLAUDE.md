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
pnpm --filter @tsandbox/backend dev

# Run only frontend
pnpm --filter @tsandbox/frontend dev

# Build all packages
pnpm build

# Type-check all packages
pnpm typecheck

# Build a single package
pnpm --filter @tsandbox/sdk build

# Run backend in production mode
pnpm --filter @tsandbox/backend start
```

No test runner is configured yet — add Vitest when needed.

## Monorepo Layout

```
packages/
  sdk/       @tsandbox/sdk      — defineMock() helpers & TypeScript types (zero deps)
  backend/   @tsandbox/backend  — Fastify server, runtime engine, SQLite DB
  frontend/  @tsandbox/frontend — React + Vite + Monaco editor UI
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
        → on success:
            if file has defineMock:
              registry.register() atomically replaces handler
              ivm Script cache invalidated (sandbox.ts)
              WebSocket broadcast `route_updated`
            else (shared/helper file):
              registry.listForSandbox() → recompile every registered mock
              (cascade uses registry file paths directly — no fs scan)
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
- `@tsandbox/sdk` is marked `external` — esbuild leaves `require('@tsandbox/sdk')` in the output
- At execution time, `sandbox.ts`'s CJS shim intercepts that `require()` and returns the inline SDK object; no Node.js module resolution involved

### SDK (`packages/sdk`)

Simple, zero-dependency helpers. Must stay dependency-free — it gets inlined into every sandboxed bundle.

Key exports: `defineMock`, `defineSoapMock`, `ok`, `json`, `error`, `xml`, `soapResponse`, `soapFault`, `redirect`, `delay`, `notFound`, `unauthorized`, `forbidden`, `serverError`, `noContent`, `randomFailure`, `sse`.

`sse()` delivers all events as a single `text/event-stream` body — suitable for mock clients, not true long-lived streaming.

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
- `request_logged` — fired after every request; replaces polling for the History tab

### Management API (`routes/management.ts`)

All endpoints are prefixed `/_api`. File operations use `safePath()` to prevent path traversal. Saving a file via `PUT /_api/sandboxes/:id/files/*` also triggers the hot-reload pipeline directly (same as if the file was written to disk).

Additional endpoints added beyond the core CRUD:
- `POST /_api/sandboxes/:id/import/openapi` — parses a JSON/YAML OpenAPI 3.x spec, resolves `$ref`s, and generates one `defineMock()` file per operation (see `openapi/generator.ts`)
- `GET /_api/sandboxes/:id/export` — streams a ZIP archive of all sandbox source files + `sandbox.json` manifest
- `POST /_api/sandboxes/import` — accepts a multipart ZIP upload, creates a new sandbox with a fresh UUID, writes files, and hot-reloads routes (see `sandbox/transfer.ts`); ZIP paths are sanitised to prevent traversal attacks

### Frontend serving in production (`routes/proxy.ts` + `server.ts`)

In the Docker image, `@fastify/static` is registered with `wildcard: false` (decorates `reply.sendFile()` without adding a competing `GET /*` route). The proxy plugin accepts `{ publicDir?: string }` — when set, the no-match branch serves static files or falls back to `index.html` for SPA routing. Only plain GET requests that are not sandbox-targeted (no `/_sandbox` prefix, no `X-Sandbox-Id` header) are served this way; sandbox 404s still return JSON.

### Frontend (`packages/frontend`)

VSCode-inspired 3-panel layout:
- **Left**: sandbox list + file tree
- **Center**: Monaco editor (tabs per open file)
- **Right**: API Explorer / Request History / Runtime Logs / State Inspector

State: Zustand store for UI state (active sandbox, open files, logs, notifications). Server state: React Query (TanStack Query v5).

All four right-panel tabs are always mounted (hidden via CSS when inactive) so API Explorer preserves method, path, headers, body, and last response across tab switches.

## Docker / Production Layout

The runtime image uses a flat structure under `/app/`:

```
dist/          ← compiled backend (entry: dist/index.js)
public/        ← frontend static files (served by Fastify)
node_modules/  ← production deps only (pruned via pnpm deploy --prod)
```

Build requires Node.js 22+ (`node:22-slim`). `isolated-vm@6.x` uses `v8::SourceLocation` (V8 12+, shipped in Node 22). The builder stage installs `python3 make g++` for `node-gyp`. The `.dockerignore` excludes `node_modules` and `dist` from the build context.

Two manual GitHub Actions workflows (`.github/workflows/`):
- `docker-build.yml` — builds and pushes `:latest` + `:sha-xxx`
- `docker-release.yml` — takes a `version` input, creates git tag, publishes semver images to GHCR

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
| `LOG_DIR` | `~/.tsandbox/logs` | Root dir for per-sandbox NDJSON request log files |
| `LOG_RETENTION_DAYS` | `30` | Days to retain log files before deletion |

## Security Model

- **isolated-vm** is mandatory — never use `vm`, `eval`, or `Function` for user code
- `require()` throws inside sandboxes (enforced in the CJS shim wrapper)
- `delay()` is the only bridge to host APIs; all other Node.js globals are absent
- Path traversal on file operations blocked by `safePath()` in management.ts
- ZIP path traversal on sandbox import blocked by stripping `..` segments in `sandbox/transfer.ts`
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

## Reference Docs

- `docs/GUIDE.md` — SDK and mock-writing reference (for users)
- `docs/ARCHITECTURE.md` — deep-dive study guide (subsystems, design decisions)
- `DEPLOYMENT.md` — Docker, GHCR, nginx, env vars
- `RELEASE.md` — semver release process and hotfix workflow
- `CHANGELOG.md` — version history

## Phase Roadmap

- **Phase 1** (shipped): REST mocks, hot reload, Monaco editor, isolated-vm, request history, OpenAPI 3.x import (with body validation, multi-response simulation, SSE stubs), sandbox export/import as ZIP
- **Phase 2**: SOAP/WSDL import, Yjs collaborative editing (y-monaco + y-websocket)
- **Phase 3**: Multi-tenant SaaS, Playwright integration, runtime pools, AI mock generation

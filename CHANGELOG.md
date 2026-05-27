# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

> Docs: [README](./README.md) · [Writing Mocks](./docs/GUIDE.md) · [Deployment](./DEPLOYMENT.md)

## [1.3.0] - 2026-05-28

> Docs: [README](./README.md) · [Writing Mocks](./docs/GUIDE.md) · [Deployment](./DEPLOYMENT.md)

### Added
- Request/event logging system — every incoming request is now tracked with IP, user-agent, source client (Postman, curl, Browser, Python, …), matched endpoint, and duration
- Append-only NDJSON log files per sandbox at `LOG_DIR/{sandboxId}/{date}.ndjson` — Docker-volume-mountable, greppable, compatible with log shippers
- Daily log retention cleanup — files older than `LOG_RETENTION_DAYS` (default 30) are automatically deleted on startup and once per day
- `GET /_api/sandboxes/:id/stats` — aggregate endpoint returning totals, error rates (2xx/4xx/5xx), average duration, top endpoints, and top client sources
- Filter params on `GET /_api/sandboxes/:id/history` — `status=2xx|3xx|4xx|5xx`, `method=GET|POST|…`, `q=keyword`
- Live history via WebSocket — `request_logged` event replaces 3 s polling; new requests appear instantly in the UI
- Enhanced History tab — stats bar, filter bar, source icons, IP/UA in expanded view, source breakdown footer, live indicator

### Changed
- Status bar version link — `TSandbox vX.Y.Z` is now a clickable link to the GitHub releases page

### Environment variables added
| Variable | Default | Description |
|---|---|---|
| `LOG_DIR` | `~/.tsandbox/logs` | Root directory for per-sandbox NDJSON log files |
| `LOG_RETENTION_DAYS` | `30` | Days to retain log files before deletion |

---

## [1.2.0] - 2026-05-27

> Docs: [README](./README.md) · [Writing Mocks](./docs/GUIDE.md) · [Deployment](./DEPLOYMENT.md)

### Added
- Monaco IntelliSense for `@tsandbox/sdk` — full type declarations registered as a virtual lib so `import { ok } from '@tsandbox/sdk'` resolves with completions, parameter hints, and JSDoc tooltips
- Cross-file import resolution — all sandbox files are loaded as background Monaco models on editor mount, enabling `import { users } from './data'` to resolve correctly
- Search across files (`Ctrl+Shift+F` / `Cmd+Shift+F`) — overlay with match highlighting, results grouped by file, click to jump to line
- SQLite WAL mode (`PRAGMA journal_mode = WAL`) — better concurrent read performance under load
- `HEALTHCHECK` in Dockerfile — Docker Compose and orchestrators can now track container readiness via `/_api/health`
- CI workflow (`ci.yml`) — runs `pnpm typecheck && pnpm build` on every push and PR to `main`

### Fixed
- Suppress `Cannot find module` (TS2307) squiggles for relative imports — resolved at runtime by esbuild, noise in Monaco

### Changed
- Graceful shutdown — `SIGTERM` / `SIGINT` now call `app.close()` to drain in-flight requests before the process exits

---

## [1.1.0] - 2026-05-27

> Docs: [README](./README.md) · [Writing Mocks](./docs/GUIDE.md) · [Deployment](./DEPLOYMENT.md)

### Added
- `docs/GUIDE.md` — full SDK and mock-writing reference extracted from README
- `docs/ARCHITECTURE.md` — deep-dive study guide covering all subsystems

### Changed
- Docker image now serves the frontend directly from Fastify — no separate web server needed
- Docker image size reduced from ~600 MB to ~447 MB by pruning devDependencies via `pnpm deploy --prod`
- GitHub Actions workflows split into two manual triggers:
  - **Build Docker Image** — pushes `:latest` + `:sha-xxx` snapshot
  - **Release Docker Image** — creates git tag and publishes semver-tagged images to GHCR
- `DEPLOYMENT.md` restructured: GHCR pull is now the primary (recommended) deployment option

### Fixed
- Dockerfile base image changed from `node:20-slim` to `node:22-slim` — `isolated-vm@6.x` requires V8 12+ (Node 22)
- Added Python + C++ build tools to builder stage so `node-gyp` can compile native addons
- Added `.dockerignore` — `COPY . .` was overwriting Linux-compiled native binaries with macOS Mach-O binaries

---

## [1.0.0] - 2026-05-26

> Docs: [README](./README.md) · [Writing Mocks](./docs/GUIDE.md) · [Deployment](./DEPLOYMENT.md)

### Added
- Core sandbox runtime: TypeScript mock handlers executed in isolated V8 isolates via `isolated-vm`
- Hot reload pipeline: file changes compile and swap handlers in under 1 second with no server restart
- Monaco editor UI with multi-tab support and inline compile error display
- Request history: every request/response recorded with headers, body, status, and duration
- Runtime logs panel: `logger.info/warn/error/debug` from handlers streamed via WebSocket
- State inspector: view and edit persistent sandbox state as JSON in real time
- API explorer: send test requests directly from the UI with method, path, headers, and body
- OpenAPI 3.x import: generates one `defineMock()` file per operation, grouped by tag
  - Response shapes inferred from `200`/`201` schema
  - Request body validation for required fields (auto-returns `400`)
  - Multi-response simulation via `?__status=<code>` query parameter
  - SSE stubs for `text/event-stream` endpoints using `sse()`
- Sandbox export as `.zip` archive (source files + `sandbox.json` manifest)
- Sandbox import from `.zip` — creates a new sandbox with a fresh ID on any instance
- `@tsandbox/sdk` helpers: `ok`, `json`, `error`, `notFound`, `unauthorized`, `forbidden`,
  `serverError`, `noContent`, `redirect`, `xml`, `soapResponse`, `soapFault`, `sse`,
  `delay`, `randomFailure`, `defineMock`, `defineSoapMock`
- Docker support: `Dockerfile` and `docker-compose.yml` for self-hosted deployment
- GitHub Actions workflow: builds and publishes image to GHCR on push to `main` and version tags

### Security
- `isolated-vm` sandbox: no `fetch`, no Node.js built-ins, no `require()` outside `@tsandbox/sdk`
- Path traversal protection on all file operations (`safePath()`)
- ZIP path traversal protection on sandbox import

[Unreleased]: https://github.com/khang7598/TSandbox/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/khang7598/TSandbox/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/khang7598/TSandbox/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/khang7598/TSandbox/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/khang7598/TSandbox/releases/tag/v1.0.0

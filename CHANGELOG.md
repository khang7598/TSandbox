# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

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

[Unreleased]: https://github.com/khang7598/TSandbox/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/khang7598/TSandbox/releases/tag/v1.0.0

import type { Monaco } from '@monaco-editor/react'

// Full type declaration for @tsandbox/sdk, mirroring packages/sdk/src/types.ts + index.ts.
// Injected into Monaco's virtual file system so `import { ok } from '@tsandbox/sdk'`
// resolves with full IntelliSense inside the editor.
const SDK_DTS = `
export interface MockLogger {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
  debug(...args: unknown[]): void
}

export interface MockContext {
  /** HTTP method of the incoming request */
  method: string
  /** Full request URL */
  url: string
  /** Path parameters extracted from the URL pattern — e.g. /users/:id → { id: '123' } */
  params: Record<string, string>
  /** Query string parameters */
  query: Record<string, string | string[]>
  /** Parsed request body (JSON by default) */
  body: unknown
  /** Request headers (lower-cased keys) */
  headers: Record<string, string>
  /** Parsed cookies */
  cookies: Record<string, string>
  /** Per-sandbox shared state — persists across requests, survives hot reloads */
  state: Record<string, unknown>
  /** Environment variables passed to the sandbox */
  env: Record<string, string>
  /** Structured logger — output appears in the Runtime Logs panel */
  logger: MockLogger
}

export interface SoapContext extends Omit<MockContext, 'body'> {
  /** Parsed SOAP envelope as a plain JS object */
  xml: Record<string, unknown>
  /** XPath helper */
  xpath: (doc: Record<string, unknown>, expression: string) => unknown
  /** Raw XML string */
  rawXml: string
}

export interface MockResponse {
  /** HTTP status code (default: 200) */
  status?: number
  /** Response body — objects are serialised to JSON, strings returned as-is */
  body?: unknown
  /** Additional response headers */
  headers?: Record<string, string>
  /** Artificial delay in milliseconds applied before the response is sent */
  delay?: number
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'ALL'

export interface MockDefinition {
  /** HTTP method — use 'ALL' to match any */
  method: HttpMethod | HttpMethod[]
  /** Express-style path pattern, e.g. /users/:id */
  path: string
  /** Optional human-readable description shown in the UI */
  description?: string
  /** Request handler */
  handler: (ctx: MockContext) => MockResponse | Promise<MockResponse>
}

export interface SoapMockDefinition {
  /** SOAP operation name */
  operation: string
  /** SOAP version (default: '1.1') */
  version?: '1.1' | '1.2'
  /** Optional description */
  description?: string
  /** SOAP request handler */
  handler: (ctx: SoapContext) => MockResponse | Promise<MockResponse>
}

export interface SseEvent {
  /** Event payload — objects are JSON-serialised automatically */
  data: unknown
  /** SSE event name */
  event?: string
  /** SSE event id */
  id?: string
}

/** Define a REST mock endpoint */
export function defineMock(definition: MockDefinition): MockDefinition

/** Define a SOAP mock endpoint */
export function defineSoapMock(definition: SoapMockDefinition): SoapMockDefinition

/** 200 JSON response */
export function ok(body: unknown, status?: number): MockResponse

/** Alias for ok() */
export function json(body: unknown, status?: number): MockResponse

/** Error response (default 400) */
export function error(message: string, status?: number, extra?: Record<string, unknown>): MockResponse

/** XML response */
export function xml(content: string, status?: number): MockResponse

/** Wrap a SOAP body fragment in a full SOAP envelope */
export function soapResponse(bodyXml: string, version?: '1.1' | '1.2'): MockResponse

/** Return a SOAP fault */
export function soapFault(code: string, message: string, version?: '1.1' | '1.2'): MockResponse

/** Redirect response */
export function redirect(url: string, status?: 301 | 302 | 307 | 308): MockResponse

/** Introduce an artificial delay (milliseconds) */
export function delay(ms: number): Promise<void>

/** 404 Not Found */
export function notFound(message?: string): MockResponse

/** 401 Unauthorized */
export function unauthorized(message?: string): MockResponse

/** 403 Forbidden */
export function forbidden(message?: string): MockResponse

/** 500 Internal Server Error */
export function serverError(message?: string): MockResponse

/** 204 No Content */
export function noContent(): MockResponse

/** Server-Sent Events response — all events delivered in a single body */
export function sse(events: SseEvent[]): MockResponse

/** Randomly return a failure response at the given rate (0–1) */
export function randomFailure(
  normalResponse: MockResponse,
  failureRate?: number,
  failureResponse?: MockResponse,
): MockResponse
`

export function configureMonaco(monaco: Monaco): void {
  monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ES2020,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    strict: false,
    allowNonTsExtensions: true,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
  })

  // Suppress "Cannot find module" (2307) — relative imports resolve at runtime
  // via esbuild but Monaco's virtual FS doesn't have all sandbox files loaded.
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    diagnosticCodesToIgnore: [2307],
  })

  monaco.languages.typescript.typescriptDefaults.addExtraLib(
    SDK_DTS,
    'file:///node_modules/@tsandbox/sdk/index.d.ts',
  )
}

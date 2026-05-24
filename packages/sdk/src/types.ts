// ─── Core request/response types ──────────────────────────────────────────────

export interface MockLogger {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
  debug(...args: unknown[]): void
}

export interface MockContext {
  /** Raw request (serialised for sandbox transfer) */
  method: string
  url: string
  /** Path parameters: /users/:id → { id: '123' } */
  params: Record<string, string>
  /** Query string parameters */
  query: Record<string, string | string[]>
  /** Parsed request body */
  body: unknown
  /** Request headers (lower-cased) */
  headers: Record<string, string>
  /** Cookies */
  cookies: Record<string, string>
  /** Per-sandbox shared state (persists across requests) */
  state: Record<string, unknown>
  /** Environment variables passed to sandbox */
  env: Record<string, string>
  /** Structured logger (captured and forwarded to runtime logs panel) */
  logger: MockLogger
}

export interface SoapContext extends Omit<MockContext, 'body'> {
  /** Parsed SOAP envelope as a plain JS object */
  xml: Record<string, unknown>
  /** XPath helper – xpath(doc, expression) */
  xpath: (doc: Record<string, unknown>, expression: string) => unknown
  /** Raw XML string */
  rawXml: string
}

export interface MockResponse {
  /** HTTP status code (default: 200) */
  status?: number
  /** Response body – object serialised to JSON, string returned as-is */
  body?: unknown
  /** Additional response headers */
  headers?: Record<string, string>
  /** Artificial delay in milliseconds (applied before sending response) */
  delay?: number
}

// ─── Mock definition types ─────────────────────────────────────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'ALL'

export interface MockDefinition {
  /** HTTP method – use 'ALL' to match any method */
  method: HttpMethod | HttpMethod[]
  /** Express-style path pattern, e.g. /users/:id */
  path: string
  /** Human readable description shown in the UI */
  description?: string
  /** The request handler */
  handler: (ctx: MockContext) => MockResponse | Promise<MockResponse>
}

export interface SoapMockDefinition {
  /** SOAP operation name */
  operation: string
  /** SOAP version: 1.1 | 1.2 (default 1.1) */
  version?: '1.1' | '1.2'
  /** Human readable description */
  description?: string
  /** The SOAP request handler */
  handler: (ctx: SoapContext) => MockResponse | Promise<MockResponse>
}

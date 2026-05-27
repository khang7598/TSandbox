/**
 * Catch-all proxy route.
 *
 * Every request that doesn't match a /_api/* or /_ws prefix is dispatched here.
 * We look up the route in the in-memory registry, execute it in an isolated-vm
 * sandbox, record it in request history, and return the response.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { registry } from '../registry/index.js'
import { executeHandler } from '../runtime/sandbox.js'
import { db, queries } from '../db/index.js'
import { broadcast } from '../ws/index.js'
import { config } from '../config.js'
import { writeLogEvent } from '../logs/writer.js'
import crypto from 'node:crypto'

interface ProxyOptions {
  publicDir?: string
}

// ─── Source detection ──────────────────────────────────────────────────────────

function detectSource(ua: string | undefined): string {
  if (!ua) return 'Unknown'
  const u = ua.toLowerCase()
  if (u.includes('postmanruntime')) return 'Postman'
  if (u.includes('insomnia')) return 'Insomnia'
  if (u.includes('curl')) return 'curl'
  if (u.includes('python-httpx') || u.includes('python-requests')) return 'Python'
  if (u.includes('axios')) return 'Axios'
  if (u.includes('got/') || u.includes('node-fetch') || u.includes('undici')) return 'Node.js'
  if (u.includes('okhttp')) return 'Android'
  if (u.includes('dart') || u.includes('flutter')) return 'Flutter'
  if (/mozilla|chrome|safari|firefox|edge/.test(u)) return 'Browser'
  return 'Unknown'
}

// ─── Proxy handler ────────────────────────────────────────────────────────────

export async function proxyPlugin(app: FastifyInstance, opts: ProxyOptions): Promise<void> {
  const { publicDir } = opts
  // Register a catch-all for the standard HTTP methods.
  // OPTIONS is intentionally excluded — @fastify/cors handles it.
  app.route({
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'],
    url: '/*',
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
    const { method, url } = request
    const [rawPathname, queryString] = url.split('?') as [string, string | undefined]

    // ── Sandbox resolution ────────────────────────────────────────────────────
    // Priority:
    //   1. Path prefix  /_sandbox/{sandboxId}/actual/path
    //   2. Header       X-Sandbox-Id: {sandboxId}
    //   3. Default      'default'

    let sandboxId: string
    let pathname: string

    const sandboxPrefixMatch = rawPathname.match(/^\/_sandbox\/([^/]+)(\/.*)?$/)
    if (sandboxPrefixMatch) {
      sandboxId = sandboxPrefixMatch[1]!
      pathname = sandboxPrefixMatch[2] ?? '/'
    } else {
      sandboxId = (request.headers['x-sandbox-id'] as string | undefined) ?? 'default'
      pathname = rawPathname
    }

    const match = registry.findInSandbox(sandboxId, method, pathname)
      ?? registry.find(method, pathname)

    const requestId = crypto.randomUUID()
    const requestedAt = Date.now()

    const requestHeaders = Object.fromEntries(
      Object.entries(request.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v ?? '']),
    )

    // ── Client metadata ───────────────────────────────────────────────────────
    const ip = (request.headers['x-forwarded-for'] as string | undefined)
      ?.split(',')[0]?.trim() ?? request.ip ?? null
    const userAgent = (request.headers['user-agent'] as string | undefined) ?? null
    const source = detectSource(userAgent ?? undefined)

    if (!match) {
      // Frontend static file serving — only for plain GET requests that are
      // not explicitly targeting a sandbox (prefix or header). This lets the
      // React SPA load in Docker without a separate web server.
      const isSandboxTargeted = !!sandboxPrefixMatch || !!request.headers['x-sandbox-id']
      if (method === 'GET' && !isSandboxTargeted && publicDir) {
        const relPath = pathname === '/' ? 'index.html' : pathname.slice(1)
        const candidate = join(publicDir, relPath)
        const isFile = existsSync(candidate) && statSync(candidate).isFile()
        return reply.sendFile(isFile ? relPath : 'index.html')
      }

      const notFoundResponse = {
        error: 'No mock found',
        method,
        path: pathname,
        message: 'Create a mock for this route in your sandbox.',
      }

      const durationMs = Date.now() - requestedAt

      recordAndBroadcast({
        id: requestId,
        sandboxId,
        routeId: null,
        method,
        url,
        pathname,
        queryString: queryString ?? null,
        requestHeaders,
        requestBody: null,
        responseStatus: 404,
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: JSON.stringify(notFoundResponse),
        durationMs,
        timestamp: requestedAt,
        logs: [],
        ip,
        userAgent,
        source,
        matchedEndpoint: null,
      })

      return reply.status(404).send(notFoundResponse)
    }

    const { entry, params } = match

    // Parse query string
    const queryParams: Record<string, string | string[]> = {}
    if (queryString) {
      for (const [k, v] of new URLSearchParams(queryString)) {
        const existing = queryParams[k]
        if (existing === undefined) {
          queryParams[k] = v
        } else if (Array.isArray(existing)) {
          existing.push(v)
        } else {
          queryParams[k] = [existing, v]
        }
      }
    }

    // Parse cookies
    const cookies: Record<string, string> = {}
    const cookieHeader = request.headers['cookie']
    if (cookieHeader) {
      for (const part of cookieHeader.split(';')) {
        const [k, ...rest] = part.trim().split('=')
        if (k) cookies[k.trim()] = rest.join('=').trim()
      }
    }

    const requestBodyStr = request.body ? JSON.stringify(request.body) : null
    const matchedEndpoint = entry.pattern

    try {
      const result = await executeHandler({
        sandboxId,
        routeId: entry.id,
        compiledSource: entry.handler.compiledSource,
        context: {
          method,
          url,
          params,
          query: queryParams,
          body: request.body,
          headers: requestHeaders,
          cookies,
          state: {},
          env: {},
        },
      })

      const { response, logs, durationMs } = result

      // Apply artificial delay if specified
      if (response.delay && response.delay > 0) {
        await new Promise((r) => setTimeout(r, Math.min(response.delay!, 30_000)))
      }

      // Set response headers
      const responseHeaders: Record<string, string> = {
        'content-type': 'application/json',
        'x-tsandbox-sandbox': sandboxId,
        'x-tsandbox-route': entry.id,
        'x-tsandbox-duration': String(durationMs),
        ...(response.headers ?? {}),
      }

      for (const [k, v] of Object.entries(responseHeaders)) {
        reply.header(k, v)
      }

      const status = response.status ?? 200
      const body = response.body

      // Determine serialisation strategy
      const contentType = responseHeaders['content-type'] ?? ''
      let rawBody: string

      if (typeof body === 'string') {
        rawBody = body
      } else if (body === null || body === undefined) {
        rawBody = ''
      } else {
        rawBody = JSON.stringify(body)
      }

      // Broadcast log events to connected UI clients
      if (logs.length > 0) {
        broadcast({
          type: 'runtime_logs',
          sandboxId,
          routeId: entry.id,
          requestId,
          logs,
        })
      }

      recordAndBroadcast({
        id: requestId,
        sandboxId,
        routeId: entry.id,
        method,
        url,
        pathname,
        queryString: queryString ?? null,
        requestHeaders,
        requestBody: requestBodyStr,
        responseStatus: status,
        responseHeaders,
        responseBody: rawBody,
        durationMs,
        timestamp: requestedAt,
        logs,
        ip,
        userAgent,
        source,
        matchedEndpoint,
      })

      return reply
        .status(status)
        .send(
          contentType.includes('json') && typeof body !== 'string'
            ? body
            : rawBody,
        )
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      const durationMs = Date.now() - requestedAt

      broadcast({
        type: 'runtime_error',
        sandboxId,
        routeId: entry.id,
        requestId,
        error: message,
      })

      recordAndBroadcast({
        id: requestId,
        sandboxId,
        routeId: entry.id,
        method,
        url,
        pathname,
        queryString: queryString ?? null,
        requestHeaders,
        requestBody: requestBodyStr,
        responseStatus: 500,
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: JSON.stringify({ error: message }),
        durationMs,
        timestamp: requestedAt,
        logs: [],
        ip,
        userAgent,
        source,
        matchedEndpoint,
      })

      return reply.status(500).send({ error: message })
    }
  },
  })
}

// ─── History recording + WS push + file log ───────────────────────────────────

interface HistoryRecord {
  id: string
  sandboxId: string
  routeId: string | null
  method: string
  url: string
  pathname: string
  queryString: string | null
  requestHeaders: Record<string, string>
  requestBody: string | null
  responseStatus: number
  responseHeaders: Record<string, string>
  responseBody: string | null
  durationMs: number
  timestamp: number
  logs: unknown[]
  ip: string | null
  userAgent: string | null
  source: string
  matchedEndpoint: string | null
}

function recordAndBroadcast(rec: HistoryRecord): void {
  try {
    queries.insertHistory.run(
      rec.id,
      rec.sandboxId,
      rec.routeId,
      rec.method,
      rec.url,
      JSON.stringify(rec.requestHeaders),
      rec.requestBody,
      rec.responseStatus,
      JSON.stringify(rec.responseHeaders),
      rec.responseBody,
      rec.durationMs,
      rec.timestamp,
      JSON.stringify(rec.logs),
      rec.ip,
      rec.userAgent,
      rec.source,
      rec.matchedEndpoint,
    )

    queries.pruneHistory.run(rec.sandboxId, rec.sandboxId, config.historyLimit)
  } catch (e) {
    console.error('[history] write error', e)
  }

  // Push compact event to UI over WebSocket (no body to keep payload light)
  broadcast({
    type: 'request_logged',
    sandboxId: rec.sandboxId,
    event: {
      id: rec.id,
      sandbox_id: rec.sandboxId,
      route_id: rec.routeId,
      method: rec.method,
      url: rec.url,
      request_headers: rec.requestHeaders,
      request_body: rec.requestBody,
      response_status: rec.responseStatus,
      response_headers: rec.responseHeaders,
      response_body: rec.responseBody,
      duration_ms: rec.durationMs,
      timestamp: rec.timestamp,
      logs: rec.logs,
      ip: rec.ip,
      user_agent: rec.userAgent,
      source: rec.source,
      matched_endpoint: rec.matchedEndpoint,
    },
  })

  // Append to NDJSON log file (fire-and-forget)
  writeLogEvent({
    timestamp: new Date(rec.timestamp).toISOString(),
    sandboxId: rec.sandboxId,
    requestId: rec.id,
    method: rec.method,
    path: rec.pathname,
    query: rec.queryString,
    status: rec.responseStatus,
    durationMs: rec.durationMs,
    ip: rec.ip,
    userAgent: rec.userAgent,
    source: rec.source,
    matchedEndpoint: rec.matchedEndpoint,
  })
}

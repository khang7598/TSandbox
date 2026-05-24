/**
 * Catch-all proxy route.
 *
 * Every request that doesn't match a /_api/* or /_ws prefix is dispatched here.
 * We look up the route in the in-memory registry, execute it in an isolated-vm
 * sandbox, record it in request history, and return the response.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { registry } from '../registry/index.js'
import { executeHandler } from '../runtime/sandbox.js'
import { db, queries } from '../db/index.js'
import { broadcast } from '../ws/index.js'
import { config } from '../config.js'
import crypto from 'node:crypto'

export async function proxyPlugin(app: FastifyInstance): Promise<void> {
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

    if (!match) {
      const notFoundResponse = {
        error: 'No mock found',
        method,
        path: pathname,
        message: 'Create a mock for this route in your sandbox.',
      }

      // Record 404 in history
      recordHistory({
        id: requestId,
        sandboxId,
        routeId: null,
        method,
        url,
        requestHeaders,
        requestBody: null,
        responseStatus: 404,
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: JSON.stringify(notFoundResponse),
        durationMs: Date.now() - requestedAt,
        timestamp: requestedAt,
        logs: [],
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

      // Record in history
      recordHistory({
        id: requestId,
        sandboxId,
        routeId: entry.id,
        method,
        url,
        requestHeaders,
        requestBody: requestBodyStr,
        responseStatus: status,
        responseHeaders,
        responseBody: rawBody,
        durationMs,
        timestamp: requestedAt,
        logs,
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

      recordHistory({
        id: requestId,
        sandboxId,
        routeId: entry.id,
        method,
        url,
        requestHeaders,
        requestBody: requestBodyStr,
        responseStatus: 500,
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: JSON.stringify({ error: message }),
        durationMs,
        timestamp: requestedAt,
        logs: [],
      })

      return reply.status(500).send({ error: message })
    }
  },
  })
}

// ─── History recording ─────────────────────────────────────────────────────────

interface HistoryRecord {
  id: string
  sandboxId: string
  routeId: string | null
  method: string
  url: string
  requestHeaders: Record<string, string>
  requestBody: string | null
  responseStatus: number
  responseHeaders: Record<string, string>
  responseBody: string | null
  durationMs: number
  timestamp: number
  logs: unknown[]
}

function recordHistory(rec: HistoryRecord): void {
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
    )

    // Prune to keep table bounded
    db.prepare(
      `DELETE FROM request_history WHERE sandbox_id = ? AND id NOT IN (
         SELECT id FROM request_history WHERE sandbox_id = ? ORDER BY timestamp DESC LIMIT ?
       )`,
    ).run(rec.sandboxId, rec.sandboxId, config.historyLimit)
  } catch (e) {
    console.error('[history] write error', e)
  }
}

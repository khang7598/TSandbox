/**
 * Isolated execution sandbox using isolated-vm v6.
 *
 * isolated-vm v6 introduces `Callback` — plain functions that, when transferred
 * to an isolate, become callable JS functions inside it. This removes the need
 * for `.applySync()` / `.apply()` boilerplate from v4.
 *
 * Security guarantees:
 *  - Memory capped at config.sandboxMemoryMb
 *  - Execution timeout via config.sandboxTimeoutMs
 *  - No filesystem, network, or process access
 *  - Console output captured and forwarded to logs
 */

import ivm from 'isolated-vm'
import type { MockContext, MockResponse } from '@tsandbox/sdk'
import { config } from '../config.js'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SandboxLog {
  level: 'log' | 'warn' | 'error' | 'debug'
  args: unknown[]
  timestamp: number
}

export interface ExecutionResult {
  response: MockResponse
  logs: SandboxLog[]
  durationMs: number
}

// ─── Per-sandbox state store (host-side) ──────────────────────────────────────

const sandboxStates = new Map<string, Record<string, unknown>>()

export function getSandboxState(sandboxId: string): Record<string, unknown> {
  if (!sandboxStates.has(sandboxId)) sandboxStates.set(sandboxId, {})
  return sandboxStates.get(sandboxId)!
}

export function setSandboxState(sandboxId: string, state: Record<string, unknown>): void {
  sandboxStates.set(sandboxId, state)
}

export function resetSandboxState(sandboxId: string): void {
  sandboxStates.set(sandboxId, {})
}

// ─── Script cache ──────────────────────────────────────────────────────────────
// We cache compiled ivm.Script objects per (sandboxId, routeId) to avoid
// recompiling on every request.

interface CachedScript {
  isolate: ivm.Isolate
  script: ivm.Script
  compiledSource: string
}

const scriptCache = new Map<string, CachedScript>()

function cacheKey(sandboxId: string, routeId: string): string {
  return `${sandboxId}:${routeId}`
}

export function invalidateCache(sandboxId: string, routeId?: string): void {
  if (routeId) {
    const key = cacheKey(sandboxId, routeId)
    const entry = scriptCache.get(key)
    if (entry) {
      try { entry.isolate.dispose() } catch {}
      scriptCache.delete(key)
    }
  } else {
    for (const [key, entry] of scriptCache) {
      if (key.startsWith(`${sandboxId}:`)) {
        try { entry.isolate.dispose() } catch {}
        scriptCache.delete(key)
      }
    }
  }
}

// ─── Main execution function ───────────────────────────────────────────────────

export async function executeHandler(opts: {
  sandboxId: string
  routeId: string
  compiledSource: string
  context: Omit<MockContext, 'logger'>
}): Promise<ExecutionResult> {
  const { sandboxId, routeId, compiledSource, context } = opts
  const start = Date.now()
  const logs: SandboxLog[] = []

  // ── Get or create isolate + script ──────────────────────────────────────────
  const key = cacheKey(sandboxId, routeId)
  let cached = scriptCache.get(key)

  if (!cached || cached.compiledSource !== compiledSource) {
    if (cached) try { cached.isolate.dispose() } catch {}

    const isolate = new ivm.Isolate({ memoryLimit: config.sandboxMemoryMb })
    const script = await isolate.compileScript(buildExecutionScript(compiledSource))
    cached = { isolate, script, compiledSource }
    scriptCache.set(key, cached)
  }

  const { isolate, script } = cached

  // ── Fresh context per request ────────────────────────────────────────────────
  const ctx = await isolate.createContext()
  const jail = ctx.global

  // `global` → deref so sandbox code can write `global.x = ...`
  jail.setSync('global', jail.derefInto())

  // ── Callbacks (ivm.Callback turns into a plain function inside the isolate) ──

  // Log: fire-and-forget — isolate doesn't wait
  const logCb = new ivm.Callback(
    (level: string, argsJson: string) => {
      try {
        logs.push({ level: level as SandboxLog['level'], args: JSON.parse(argsJson), timestamp: Date.now() })
      } catch {}
    },
    { ignored: true },
  )
  jail.setSync('$__log', logCb)

  // Delay: async — returns a Promise in the isolate that resolves after ms
  const delayCb = new ivm.Callback(
    (ms: number): Promise<void> =>
      new Promise((r) => setTimeout(r, Math.min(ms, config.sandboxTimeoutMs))),
    { async: true },
  )
  jail.setSync('$__delay', delayCb)

  // ── Inject request context ───────────────────────────────────────────────────
  const state = getSandboxState(sandboxId)
  const ctxCopy = new ivm.ExternalCopy({
    method: context.method,
    url: context.url,
    params: context.params,
    query: context.query,
    body: context.body ?? null,
    headers: context.headers,
    cookies: context.cookies,
    env: context.env ?? {},
    state,
  }).copyInto()
  jail.setSync('$__ctx', ctxCopy)

  // ── Execute handler ──────────────────────────────────────────────────────────
  const response = await new Promise<MockResponse>((resolve, reject) => {
    // Resolve / reject: sync callbacks — isolate blocks until they return
    const resolveCb = new ivm.Callback(
      (jsonResult: string) => {
        try {
          const r = JSON.parse(jsonResult) as { response: MockResponse; __state: Record<string, unknown> }
          if (r.__state) setSandboxState(sandboxId, r.__state)
          resolve(r.response)
        } catch (e) {
          reject(e)
        }
      },
      { sync: true },
    )
    const rejectCb = new ivm.Callback(
      (message: string) => reject(new Error(message)),
      { sync: true },
    )

    jail.setSync('$__resolve', resolveCb)
    jail.setSync('$__reject', rejectCb)

    script
      .run(ctx, { timeout: config.sandboxTimeoutMs })
      .catch((e: unknown) => reject(e instanceof Error ? e : new Error(String(e))))
  })

  ctx.release()

  return {
    response: normaliseResponse(response),
    logs,
    durationMs: Date.now() - start,
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function normaliseResponse(r: MockResponse): MockResponse {
  return {
    status: r.status ?? 200,
    body: r.body ?? null,
    headers: r.headers ?? {},
    delay: r.delay,
  }
}

/**
 * Builds the full execution script injected into every fresh Context.
 *
 * Structure:
 *  1. Safe console (calls $__log, which is fire-and-forget)
 *  2. delay() bridged to $__delay (returns an isolate-side Promise)
 *  3. SDK shim returned by require('@tsandbox/sdk')
 *  4. CJS shim (exports / module / require)
 *  5. Compiled user code
 *  6. __execute() IIFE — gets mock def, calls handler, calls $__resolve/$__reject
 */
function buildExecutionScript(compiledSource: string): string {
  return `
'use strict';

// ── Safe console ────────────────────────────────────────────────────
var console = {
  log:   function() { try { $__log('log',   JSON.stringify(Array.prototype.slice.call(arguments))); } catch(_){} },
  info:  function() { try { $__log('log',   JSON.stringify(Array.prototype.slice.call(arguments))); } catch(_){} },
  warn:  function() { try { $__log('warn',  JSON.stringify(Array.prototype.slice.call(arguments))); } catch(_){} },
  error: function() { try { $__log('error', JSON.stringify(Array.prototype.slice.call(arguments))); } catch(_){} },
  debug: function() { try { $__log('debug', JSON.stringify(Array.prototype.slice.call(arguments))); } catch(_){} },
};

// ── delay() helper ──────────────────────────────────────────────────
// $__delay is an async Callback — calling it returns an isolate-side Promise
function delay(ms) { return $__delay(ms); }

// ── @tsandbox/sdk shim (returned by require('@tsandbox/sdk')) ────────
var __sdk = {
  defineMock:     function(def)             { return def; },
  defineSoapMock: function(def)             { return def; },
  ok:             function(body, status)    { return { status: status != null ? status : 200, body: body }; },
  json:           function(body, status)    { return { status: status != null ? status : 200, body: body }; },
  error:          function(msg, status, ex) { return { status: status != null ? status : 400, body: Object.assign({ error: msg }, ex || {}) }; },
  xml:            function(content, status) { return { status: status != null ? status : 200, body: content, headers: { 'content-type': 'application/xml; charset=utf-8' } }; },
  soapResponse:   function(bodyXml, ver)    {
    var ct = (ver === '1.2') ? 'application/soap+xml; charset=utf-8' : 'text/xml; charset=utf-8';
    var env = (ver === '1.2')
      ? '<?xml version="1.0"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>' + bodyXml + '</soap12:Body></soap12:Envelope>'
      : '<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' + bodyXml + '</soap:Body></soap:Envelope>';
    return { status: 200, body: env, headers: { 'content-type': ct } };
  },
  soapFault:      function(code, msg, v)   {
    var body = (v === '1.2')
      ? '<soap12:Fault><soap12:Code><soap12:Value>' + code + '</soap12:Value></soap12:Code><soap12:Reason><soap12:Text>' + msg + '</soap12:Text></soap12:Reason></soap12:Fault>'
      : '<soap:Fault><faultcode>' + code + '</faultcode><faultstring>' + msg + '</faultstring></soap:Fault>';
    return __sdk.soapResponse(body, v);
  },
  redirect:       function(url, status)    { return { status: status || 302, body: '', headers: { location: url } }; },
  notFound:       function(msg)            { return __sdk.error(msg || 'Not found', 404); },
  unauthorized:   function(msg)            { return __sdk.error(msg || 'Unauthorized', 401); },
  forbidden:      function(msg)            { return __sdk.error(msg || 'Forbidden', 403); },
  serverError:    function(msg)            { return __sdk.error(msg || 'Internal server error', 500); },
  noContent:      function()               { return { status: 204, body: '' }; },
  randomFailure:  function(normal, rate, f){ return Math.random() < (rate != null ? rate : 0.1) ? (f || __sdk.error('Simulated failure', 500)) : normal; },
  sse:            function(events) {
    var body = events.map(function(e) {
      var lines = [];
      if (e.id !== undefined) lines.push('id: ' + e.id);
      if (e.event) lines.push('event: ' + e.event);
      lines.push('data: ' + (typeof e.data === 'string' ? e.data : JSON.stringify(e.data)));
      return lines.join('\\n');
    }).join('\\n\\n') + '\\n\\n';
    return { status: 200, body: body, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'connection': 'keep-alive' } };
  },
  delay:          delay,
};

// ── CJS shim ────────────────────────────────────────────────────────
var exports = {};
var module = { exports: exports };
function require(id) {
  if (id === '@tsandbox/sdk') return __sdk;
  throw new Error('require() is not allowed in mock sandbox: ' + id);
}

// ── User compiled code ───────────────────────────────────────────────
${compiledSource}

// ── Handler execution ────────────────────────────────────────────────
(function __execute() {
  try {
    var def = exports['default'] || module.exports['default'] || module.exports;

    if (!def || typeof def.handler !== 'function') {
      $__reject('No valid mock definition found. Make sure your file uses: export default defineMock({...})');
      return;
    }

    var rawCtx = $__ctx;
    var handlerCtx = {
      method:  rawCtx.method,
      url:     rawCtx.url,
      params:  rawCtx.params  || {},
      query:   rawCtx.query   || {},
      body:    rawCtx.body,
      headers: rawCtx.headers || {},
      cookies: rawCtx.cookies || {},
      state:   rawCtx.state   || {},
      env:     rawCtx.env     || {},
      logger:  console,
    };

    Promise.resolve()
      .then(function() { return def.handler(handlerCtx); })
      .then(function(result) {
        $__resolve(JSON.stringify({
          response: result || {},
          __state: handlerCtx.state,
        }));
      })
      .catch(function(err) {
        $__reject(err && err.message ? err.message : String(err));
      });
  } catch(e) {
    $__reject(e && e.message ? e.message : String(e));
  }
})();
`
}

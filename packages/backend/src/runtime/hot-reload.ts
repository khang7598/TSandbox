/**
 * Hot-reload pipeline.
 *
 * Flow:
 *   file change (chokidar)
 *     → compileFile (esbuild)
 *       → validate syntax
 *         → atomically update registry entry
 *           → invalidate ivm script cache
 *             → broadcast WebSocket notification
 *
 * Guarantees:
 *   - Never crashes the server if user code is invalid
 *   - Old handler keeps serving requests until the new one is ready
 *   - Atomic: registry.register() replaces the entry in a single Map.set
 */

import path from 'node:path'
import fs from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { fileWatcher, type FileChangeEvent } from './watcher.js'
import { compileFile } from './compiler.js'
import { registry } from '../registry/index.js'
import { invalidateCache } from './sandbox.js'
import { broadcast } from '../ws/index.js'
import { db } from '../db/index.js'
import crypto from 'node:crypto'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface HotReloadResult {
  ok: boolean
  filePath: string
  sandboxId: string
  routeId?: string
  errors?: string[]
}

// ─── Pipeline ──────────────────────────────────────────────────────────────────

export async function processFileChange(event: FileChangeEvent): Promise<HotReloadResult> {
  const { type, filePath, sandboxId } = event

  if (type === 'unlink') {
    return handleUnlink(filePath, sandboxId)
  }

  return handleAddOrChange(filePath, sandboxId)
}

async function handleAddOrChange(filePath: string, sandboxId: string): Promise<HotReloadResult> {
  const routeId = filePathToRouteId(filePath)

  // Compile TypeScript → JS
  const outcome = await compileFile(filePath)

  if (!outcome.ok) {
    // Keep previous handler alive, notify frontend of error
    broadcast({
      type: 'compile_error',
      sandboxId,
      routeId,
      filePath,
      errors: outcome.errors,
    })

    // Persist compile error to DB
    db.prepare(
      `INSERT OR REPLACE INTO compile_errors (route_id, sandbox_id, file_path, errors, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(routeId, sandboxId, filePath, JSON.stringify(outcome.errors), Date.now())

    return { ok: false, filePath, sandboxId, routeId, errors: outcome.errors }
  }

  // Clear any previous compile error
  db.prepare('DELETE FROM compile_errors WHERE route_id = ?').run(routeId)

  // Skip files that aren't mock definitions (e.g. shared data/helper files).
  // A mock file must call defineMock() — without it there's no route to register.
  if (!outcome.source.includes('defineMock')) {
    console.log(`[hot-reload] skipping non-mock file ${path.basename(filePath)} (no defineMock)`)
    return { ok: true, filePath, sandboxId, routeId }
  }

  // Extract mock definition metadata from compiled source
  // We do a quick static scan rather than executing the code here
  const meta = extractMockMeta(outcome.source)

  // Atomically register in route registry
  registry.register({
    id: routeId,
    sandboxId,
    method: meta.method ?? 'ALL',
    pattern: meta.path ?? `/__unresolved__/${routeId}`,
    enabled: true,
    handler: {
      compiledSource: outcome.compiledSource,
      source: outcome.source,
      filePath,
      compiledAt: Date.now(),
    },
  })

  // Invalidate cached ivm Script so next request gets fresh code
  invalidateCache(sandboxId, routeId)

  // Persist route metadata
  db.prepare(
    `INSERT OR REPLACE INTO routes (id, sandbox_id, file_path, method, pattern, source, compiled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    routeId,
    sandboxId,
    filePath,
    meta.method ?? 'ALL',
    meta.path ?? `/__unresolved__/${routeId}`,
    outcome.source,
    Date.now(),
  )

  // Notify connected clients
  broadcast({
    type: 'route_updated',
    sandboxId,
    routeId,
    filePath,
    method: meta.method,
    pattern: meta.path,
    compiledAt: Date.now(),
  })

  console.log(
    `[hot-reload] ✓ ${sandboxId}/${path.basename(filePath)} → ${meta.method ?? 'ALL'} ${meta.path ?? '(path TBD)'}`,
  )

  return { ok: true, filePath, sandboxId, routeId }
}

async function handleUnlink(filePath: string, sandboxId: string): Promise<HotReloadResult> {
  const routeId = filePathToRouteId(filePath)
  registry.unregister(routeId)
  invalidateCache(sandboxId, routeId)

  db.prepare('DELETE FROM routes WHERE id = ?').run(routeId)
  db.prepare('DELETE FROM compile_errors WHERE route_id = ?').run(routeId)

  broadcast({
    type: 'route_deleted',
    sandboxId,
    routeId,
    filePath,
  })

  console.log(`[hot-reload] ✗ removed ${sandboxId}/${path.basename(filePath)}`)

  return { ok: true, filePath, sandboxId, routeId }
}

// ─── Startup: scan existing sandbox directories ────────────────────────────────

export async function loadExistingSandboxes(sandboxesDir: string): Promise<void> {
  try {
    const entries = await fs.readdir(sandboxesDir, { withFileTypes: true })
    const dirs = entries.filter((e) => e.isDirectory())
    console.log(`[startup] loading ${dirs.length} sandbox(es) from ${sandboxesDir}`)

    for (const entry of dirs) {
      const sandboxId = entry.name
      const sandboxPath = path.join(sandboxesDir, sandboxId)
      await loadSandboxFiles(sandboxPath, sandboxId)
    }
  } catch {
    // sandboxes dir may not exist yet — that's fine
  }
}

export async function loadSandboxFiles(dir: string, sandboxId: string): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true, recursive: true } as Parameters<typeof fs.readdir>[1]) as unknown as Dirent[]
  } catch (e) {
    console.error(`[startup] failed to read sandbox dir ${dir}:`, e)
    return
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!/\.(ts|js|tsx)$/.test(entry.name)) continue

    // In Node 20+, entry.parentPath; in Node 18, entry.path gives the parent dir
    const parentPath = (entry as unknown as { parentPath?: string; path?: string }).parentPath
      ?? (entry as unknown as { parentPath?: string; path?: string }).path
      ?? dir
    const filePath = path.join(parentPath, entry.name)

    console.log(`[startup] loading ${sandboxId}/${path.relative(dir, filePath)}`)
    const result = await processFileChange({ type: 'add', filePath, sandboxId })
    if (!result.ok) {
      console.warn(`[startup] compile error in ${filePath}:`, result.errors)
    }
  }
}

// ─── Start watching ────────────────────────────────────────────────────────────

export function startWatcher(sandboxesDir: string): void {
  fileWatcher.on('change', (event: FileChangeEvent) => {
    processFileChange(event).catch((e) =>
      console.error('[hot-reload] unexpected error', e),
    )
  })

  fileWatcher.start(sandboxesDir)
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function filePathToRouteId(filePath: string): string {
  return crypto.createHash('sha256').update(filePath).digest('hex').slice(0, 16)
}

/**
 * Quick regex-based scan of the TypeScript source to extract
 * method and path without executing the code.
 */
function extractMockMeta(source: string): { method?: string; path?: string } {
  // Match: method: 'GET' or method: "GET"
  const methodMatch = source.match(/method\s*:\s*['"`]([A-Z]+)['"`]/)
  // Match: path: '/users/:id' or path: "/users/:id"
  const pathMatch = source.match(/path\s*:\s*['"`]([^'"`]+)['"`]/)

  return {
    method: methodMatch?.[1],
    path: pathMatch?.[1],
  }
}

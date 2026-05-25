/**
 * Management REST API — mounted at /_api
 *
 * Endpoints:
 *   Sandboxes:
 *     GET  /_api/sandboxes
 *     POST /_api/sandboxes
 *     GET  /_api/sandboxes/:id
 *     PUT  /_api/sandboxes/:id
 *     DELETE /_api/sandboxes/:id
 *
 *   Files (mock source):
 *     GET  /_api/sandboxes/:id/files
 *     GET  /_api/sandboxes/:id/files/*
 *     PUT  /_api/sandboxes/:id/files/*  (create / update)
 *     DELETE /_api/sandboxes/:id/files/*
 *
 *   Routes:
 *     GET  /_api/sandboxes/:id/routes
 *     PATCH /_api/sandboxes/:id/routes/:routeId  (toggle enabled)
 *
 *   History:
 *     GET  /_api/sandboxes/:id/history
 *     DELETE /_api/sandboxes/:id/history
 *
 *   State:
 *     GET  /_api/sandboxes/:id/state
 *     PUT  /_api/sandboxes/:id/state
 *     DELETE /_api/sandboxes/:id/state  (reset)
 *
 *   Compile errors:
 *     GET  /_api/sandboxes/:id/errors
 *
 *   WebSocket:
 *     GET  /_ws  (handled by server.ts)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import path from 'node:path'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import { db, queries, type SandboxRow } from '../db/index.js'
import { registry } from '../registry/index.js'
import { getSandboxState, resetSandboxState, setSandboxState } from '../runtime/sandbox.js'
import { processFileChange, loadSandboxFiles } from '../runtime/hot-reload.js'
import { config } from '../config.js'
import { compileSource } from '../runtime/compiler.js'
import { parseSpec, generateMocks } from '../openapi/generator.js'

export async function managementPlugin(app: FastifyInstance): Promise<void> {
  // ── Sandboxes ────────────────────────────────────────────────────────────────

  app.get('/_api/sandboxes', async (_req, reply) => {
    const rows = queries.listSandboxes.all() as SandboxRow[]
    return reply.send(rows)
  })

  app.post('/_api/sandboxes', async (request, reply) => {
    const { name, description } = request.body as { name: string; description?: string }
    if (!name) return reply.status(400).send({ error: 'name is required' })

    const id = crypto.randomUUID()
    const now = Date.now()
    queries.createSandbox.run(id, name, description ?? null, now, now)

    // Create sandbox directory
    const dir = sandboxDir(id)
    await fs.mkdir(dir, { recursive: true })

    // Seed with example files and immediately register the mock
    const dataPath = path.join(dir, 'data.ts')
    const usersPath = path.join(dir, 'users.ts')
    await fs.writeFile(dataPath, exampleData(), 'utf8')
    await fs.writeFile(usersPath, exampleMock(), 'utf8')
    await processFileChange({ type: 'add', filePath: usersPath, sandboxId: id })

    const row = queries.getSandbox.get(id) as SandboxRow
    return reply.status(201).send(row)
  })

  app.get('/_api/sandboxes/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const row = queries.getSandbox.get(id) as SandboxRow | undefined
    if (!row) return reply.status(404).send({ error: 'Sandbox not found' })
    return reply.send(row)
  })

  app.put('/_api/sandboxes/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { name, description } = request.body as { name?: string; description?: string }
    const row = queries.getSandbox.get(id) as SandboxRow | undefined
    if (!row) return reply.status(404).send({ error: 'Sandbox not found' })

    queries.updateSandbox.run(name ?? row.name, description ?? row.description, Date.now(), id)
    return reply.send(queries.getSandbox.get(id))
  })

  app.delete('/_api/sandboxes/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    registry.unregisterSandbox(id)
    db.prepare('DELETE FROM compile_errors WHERE sandbox_id = ?').run(id)
    queries.deleteSandbox.run(id)

    // Remove sandbox directory
    try {
      await fs.rm(sandboxDir(id), { recursive: true, force: true })
    } catch {}

    return reply.status(204).send()
  })

  // ── Files ────────────────────────────────────────────────────────────────────

  app.get('/_api/sandboxes/:id/files', async (request, reply) => {
    const { id } = request.params as { id: string }
    const dir = sandboxDir(id)

    try {
      const tree = await buildFileTree(dir, dir)
      return reply.send(tree)
    } catch {
      return reply.send([])
    }
  })

  // Read a file
  app.get('/_api/sandboxes/:id/files/*', async (request, reply) => {
    const { id } = request.params as { id: string }
    const filePath = safePath(id, (request.params as Record<string, string>)['*'])

    try {
      const content = await fs.readFile(filePath, 'utf8')
      return reply.send({ path: filePath, content })
    } catch {
      return reply.status(404).send({ error: 'File not found' })
    }
  })

  // Create / update a file
  app.put('/_api/sandboxes/:id/files/*', async (request, reply) => {
    const { id } = request.params as { id: string }
    const relativePath = (request.params as Record<string, string>)['*']
    const filePath = safePath(id, relativePath)
    const { content } = request.body as { content: string }

    if (typeof content !== 'string') {
      return reply.status(400).send({ error: 'content must be a string' })
    }

    // Pre-compile to surface errors before saving
    const outcome = await compileSource(content, filePath)

    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content, 'utf8')

    // Trigger hot reload
    await processFileChange({ type: 'change', filePath, sandboxId: id })

    return reply.send({
      path: filePath,
      content,
      compileOk: outcome.ok,
      errors: outcome.ok ? [] : outcome.errors,
    })
  })

  // Rename / move a file OR folder
  app.patch('/_api/sandboxes/:id/files/*', async (request, reply) => {
    const { id } = request.params as { id: string }
    const oldRelative = (request.params as Record<string, string>)['*']
    const oldPath = safePath(id, oldRelative)
    const { newPath: newRelative } = request.body as { newPath: string }

    if (typeof newRelative !== 'string' || !newRelative) {
      return reply.status(400).send({ error: 'newPath is required' })
    }

    const newPath = safePath(id, newRelative)

    try {
      const stat = await fs.stat(oldPath)

      if (stat.isDirectory()) {
        // Collect old files before the move
        const oldFiles = await collectFiles(oldPath)
        await fs.mkdir(path.dirname(newPath), { recursive: true })
        await fs.rename(oldPath, newPath)
        // Unlink old routes
        for (const f of oldFiles) {
          await processFileChange({ type: 'unlink', filePath: f, sandboxId: id })
        }
        // Register new routes from moved files
        const newFiles = await collectFiles(newPath)
        for (const f of newFiles) {
          await processFileChange({ type: 'add', filePath: f, sandboxId: id })
        }
      } else {
        await fs.mkdir(path.dirname(newPath), { recursive: true })
        await fs.rename(oldPath, newPath)
        await processFileChange({ type: 'unlink', filePath: oldPath, sandboxId: id })
        await processFileChange({ type: 'add', filePath: newPath, sandboxId: id })
      }
    } catch (e) {
      return reply.status(400).send({ error: String(e) })
    }

    return reply.send({ ok: true, newPath: newRelative })
  })

  // Delete a file OR folder
  app.delete('/_api/sandboxes/:id/files/*', async (request, reply) => {
    const { id } = request.params as { id: string }
    const targetPath = safePath(id, (request.params as Record<string, string>)['*'])

    try {
      const stat = await fs.stat(targetPath)

      if (stat.isDirectory()) {
        // Collect all .ts/.js files inside so we can unregister their routes
        const allFiles = await collectFiles(targetPath)
        await fs.rm(targetPath, { recursive: true, force: true })
        for (const filePath of allFiles) {
          await processFileChange({ type: 'unlink', filePath, sandboxId: id })
        }
      } else {
        await fs.unlink(targetPath)
        await processFileChange({ type: 'unlink', filePath: targetPath, sandboxId: id })
      }
    } catch {}

    return reply.status(204).send()
  })

  // ── Routes ────────────────────────────────────────────────────────────────────

  app.get('/_api/sandboxes/:id/routes', async (request, reply) => {
    const { id } = request.params as { id: string }
    const routes = registry.listForSandbox(id).map((e) => ({
      id: e.id,
      sandboxId: e.sandboxId,
      method: e.method,
      pattern: e.pattern,
      enabled: e.enabled,
      filePath: e.handler.filePath,
      compiledAt: e.handler.compiledAt,
    }))
    return reply.send(routes)
  })

  app.patch('/_api/sandboxes/:id/routes/:routeId', async (request, reply) => {
    const { routeId } = request.params as { id: string; routeId: string }
    const { enabled } = request.body as { enabled: boolean }
    registry.toggleEnabled(routeId, enabled)
    queries.toggleRoute.run(enabled ? 1 : 0, routeId)
    return reply.send({ ok: true })
  })

  // ── History ───────────────────────────────────────────────────────────────────

  app.get('/_api/sandboxes/:id/history', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { limit = '50' } = request.query as { limit?: string }

    const rows = queries.getHistory.all(id, parseInt(limit, 10))
    return reply.send(
      rows.map((r: unknown) => {
        const row = r as Record<string, unknown>
        return {
          ...row,
          request_headers: JSON.parse(row['request_headers'] as string),
          response_headers: JSON.parse(row['response_headers'] as string),
          logs: JSON.parse(row['logs'] as string),
        }
      }),
    )
  })

  app.delete('/_api/sandboxes/:id/history', async (request, reply) => {
    const { id } = request.params as { id: string }
    queries.clearHistory.run(id)
    return reply.status(204).send()
  })

  // ── State ─────────────────────────────────────────────────────────────────────

  app.get('/_api/sandboxes/:id/state', async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(getSandboxState(id))
  })

  app.put('/_api/sandboxes/:id/state', async (request, reply) => {
    const { id } = request.params as { id: string }
    setSandboxState(id, request.body as Record<string, unknown>)
    return reply.send(getSandboxState(id))
  })

  app.delete('/_api/sandboxes/:id/state', async (request, reply) => {
    const { id } = request.params as { id: string }
    resetSandboxState(id)
    return reply.status(204).send()
  })

  // ── OpenAPI import ────────────────────────────────────────────────────────────

  app.post('/_api/sandboxes/:id/import/openapi', async (request, reply) => {
    const { id } = request.params as { id: string }
    const row = queries.getSandbox.get(id) as SandboxRow | undefined
    if (!row) return reply.status(404).send({ error: 'Sandbox not found' })

    const { spec } = request.body as { spec?: string }
    if (!spec || typeof spec !== 'string') {
      return reply.status(400).send({ error: 'spec is required (JSON or YAML string)' })
    }

    let parsed: unknown
    try {
      parsed = parseSpec(spec)
    } catch (e) {
      return reply.status(400).send({ error: `Failed to parse spec: ${e}` })
    }

    let result: ReturnType<typeof generateMocks>
    try {
      result = generateMocks(parsed)
    } catch (e) {
      return reply.status(400).send({ error: `Failed to generate mocks: ${e}` })
    }

    const created: string[] = []
    for (const file of result.files) {
      const filePath = safePath(id, file.relativePath)
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, file.content, 'utf8')
      await processFileChange({ type: 'add', filePath, sandboxId: id })
      created.push(file.relativePath)
    }

    return reply.send({ files: created, count: created.length, warnings: result.warnings })
  })

  // ── Reload ─────────────────────────────────────────────────────────────────────

  // Force-reload all routes for a sandbox from disk (useful after backend restart)
  app.post('/_api/sandboxes/:id/reload', async (request, reply) => {
    const { id } = request.params as { id: string }
    const row = queries.getSandbox.get(id) as SandboxRow | undefined
    if (!row) return reply.status(404).send({ error: 'Sandbox not found' })

    await loadSandboxFiles(sandboxDir(id), id)
    return reply.send({ ok: true })
  })

  // ── Compile errors ─────────────────────────────────────────────────────────────

  app.get('/_api/sandboxes/:id/errors', async (request, reply) => {
    const { id } = request.params as { id: string }
    const rows = queries.getCompileErrors.all(id)
    return reply.send(
      rows.map((r: unknown) => {
        const row = r as Record<string, unknown>
        return { ...row, errors: JSON.parse(row['errors'] as string) }
      }),
    )
  })
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function sandboxDir(sandboxId: string): string {
  return path.join(config.sandboxesDir, sandboxId)
}

function safePath(sandboxId: string, relativePath: string): string {
  const base = sandboxDir(sandboxId)
  const resolved = path.resolve(base, relativePath.replace(/^\/+/, ''))
  // Prevent path traversal
  if (!resolved.startsWith(base)) throw new Error('Path traversal detected')
  return resolved
}

interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

async function buildFileTree(dir: string, rootDir: string): Promise<FileNode[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const nodes: FileNode[] = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    const relativePath = path.relative(rootDir, fullPath)

    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: 'directory',
        children: await buildFileTree(fullPath, rootDir),
      })
    } else {
      nodes.push({ name: entry.name, path: relativePath, type: 'file' })
    }
  }

  return nodes.sort((a, b) => {
    // Directories first, then files, both alphabetical
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

async function collectFiles(dir: string): Promise<string[]> {
  const results: string[] = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...(await collectFiles(fullPath)))
    } else if (/\.(ts|tsx|js)$/.test(entry.name)) {
      results.push(fullPath)
    }
  }
  return results
}

function exampleData(): string {
  return `// Shared data file — import this from any mock in the same sandbox.
// esbuild bundles local imports automatically, no configuration needed.

export interface User {
  id: string
  name: string
  email: string
  role: 'admin' | 'user'
}

export const users: User[] = [
  { id: '1', name: 'Alice Smith', email: 'alice@example.com', role: 'admin' },
  { id: '2', name: 'Bob Jones',   email: 'bob@example.com',   role: 'user'  },
  { id: '3', name: 'Carol White', email: 'carol@example.com', role: 'user'  },
]
`
}

function exampleMock(): string {
  return `import { defineMock, ok, notFound } from '@tsandbox/sdk'
import { users } from './data'

// GET /users        — list all users
// GET /users/:id    — get one user by id
export default defineMock({
  method: 'GET',
  path: '/users/:id?',
  description: 'List users or fetch one by ID',

  async handler({ params, state, logger }) {
    // State persists across requests within this sandbox
    state.calls = ((state.calls as number) ?? 0) + 1
    logger.info('users request', { id: params.id, totalCalls: state.calls })

    if (params.id) {
      const user = users.find((u) => u.id === params.id)
      return user ? ok(user) : notFound()
    }

    return ok({ users, totalCalls: state.calls })
  },
})
`
}

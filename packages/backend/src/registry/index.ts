import { match, type MatchFunction } from 'path-to-regexp'
import type { HttpMethod } from '@tsandbox/sdk'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface CompiledHandler {
  /** The compiled (esbuild) JS source stored in memory */
  compiledSource: string
  /** Original TypeScript source */
  source: string
  /** Absolute file path */
  filePath: string
  /** Last successful compile timestamp */
  compiledAt: number
}

export interface RegistryEntry {
  id: string
  sandboxId: string
  method: string  // 'GET' | 'POST' | ... | 'ALL'
  /** Original path pattern like /users/:id */
  pattern: string
  /** path-to-regexp match function */
  matcher: MatchFunction<Record<string, string>>
  handler: CompiledHandler
  /** Whether this route is enabled */
  enabled: boolean
}

export interface RouteMatch {
  entry: RegistryEntry
  params: Record<string, string>
}

// ─── Registry ──────────────────────────────────────────────────────────────────

export class RouteRegistry {
  // sandboxId → list of entries (ordered, first match wins)
  private entriesBySandbox = new Map<string, RegistryEntry[]>()

  /** Register or replace a handler for a given route */
  register(entry: Omit<RegistryEntry, 'matcher'>): void {
    const full: RegistryEntry = {
      ...entry,
      matcher: match<Record<string, string>>(entry.pattern, {
        decode: decodeURIComponent,
        strict: false,
      }),
    }

    const list = this.entriesBySandbox.get(entry.sandboxId) ?? []
    const idx = list.findIndex((e) => e.id === entry.id)

    if (idx >= 0) {
      list[idx] = full
    } else {
      list.push(full)
    }

    this.entriesBySandbox.set(entry.sandboxId, list)
  }

  /** Remove a route by id */
  unregister(id: string): void {
    for (const [sandboxId, list] of this.entriesBySandbox) {
      const filtered = list.filter((e) => e.id !== id)
      this.entriesBySandbox.set(sandboxId, filtered)
    }
  }

  /** Remove all routes for a sandbox */
  unregisterSandbox(sandboxId: string): void {
    this.entriesBySandbox.delete(sandboxId)
  }

  /**
   * Find the best matching route for a given method + path.
   * Searches all sandboxes in registration order.
   * Returns the first match.
   */
  find(method: string, pathname: string): RouteMatch | null {
    const upper = method.toUpperCase()

    for (const list of this.entriesBySandbox.values()) {
      for (const entry of list) {
        if (!entry.enabled) continue

        const methodMatch =
          entry.method === 'ALL' ||
          entry.method === upper ||
          (Array.isArray(entry.method) && (entry.method as string[]).includes(upper))

        if (!methodMatch) continue

        const result = entry.matcher(pathname)
        if (!result) continue

        return {
          entry,
          params: result.params as Record<string, string>,
        }
      }
    }

    return null
  }

  /** Find a route match within a specific sandbox */
  findInSandbox(sandboxId: string, method: string, pathname: string): RouteMatch | null {
    const upper = method.toUpperCase()
    const list = this.entriesBySandbox.get(sandboxId) ?? []

    for (const entry of list) {
      if (!entry.enabled) continue

      const methodMatch =
        entry.method === 'ALL' ||
        entry.method === upper ||
        (Array.isArray(entry.method) && (entry.method as string[]).includes(upper))

      if (!methodMatch) continue

      const result = entry.matcher(pathname)
      if (!result) continue

      return { entry, params: result.params as Record<string, string> }
    }

    return null
  }

  /** List all routes across all sandboxes */
  listAll(): RegistryEntry[] {
    const result: RegistryEntry[] = []
    for (const list of this.entriesBySandbox.values()) {
      result.push(...list)
    }
    return result
  }

  /** List routes for a specific sandbox */
  listForSandbox(sandboxId: string): RegistryEntry[] {
    return this.entriesBySandbox.get(sandboxId) ?? []
  }

  toggleEnabled(id: string, enabled: boolean): void {
    for (const list of this.entriesBySandbox.values()) {
      const entry = list.find((e) => e.id === id)
      if (entry) entry.enabled = enabled
    }
  }
}

export const registry = new RouteRegistry()

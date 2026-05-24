/**
 * File system watcher built on chokidar.
 * Emits debounced 'change' events for .ts and .js files inside sandbox directories.
 */

import chokidar, { type FSWatcher } from 'chokidar'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { config } from '../config.js'

export interface FileChangeEvent {
  type: 'add' | 'change' | 'unlink'
  filePath: string
  sandboxId: string
}

class MockFileWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

  start(watchDir: string): void {
    if (this.watcher) return

    this.watcher = chokidar.watch(watchDir, {
      ignored: /(^|[/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    })

    this.watcher
      .on('add', (filePath) => this.handle('add', filePath, watchDir))
      .on('change', (filePath) => this.handle('change', filePath, watchDir))
      .on('unlink', (filePath) => this.handle('unlink', filePath, watchDir))
      .on('error', (err) => console.error('[watcher] error', err))
  }

  async stop(): Promise<void> {
    for (const t of this.debounceTimers.values()) clearTimeout(t)
    this.debounceTimers.clear()
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
  }

  private handle(type: 'add' | 'change' | 'unlink', filePath: string, watchDir: string): void {
    // Only watch TypeScript / JavaScript mock files
    if (!/\.(ts|js|tsx)$/.test(filePath)) return

    // Derive sandboxId from the top-level directory under watchDir
    const rel = path.relative(watchDir, filePath)
    const parts = rel.split(path.sep)
    const sandboxId = parts[0] ?? 'default'

    const key = filePath
    if (this.debounceTimers.has(key)) clearTimeout(this.debounceTimers.get(key)!)

    const timer = setTimeout(() => {
      this.debounceTimers.delete(key)
      const event: FileChangeEvent = { type, filePath, sandboxId }
      this.emit('change', event)
    }, config.hotReloadDebounceMs)

    this.debounceTimers.set(key, timer)
  }
}

export const fileWatcher = new MockFileWatcher()

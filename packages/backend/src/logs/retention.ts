import { readdir, stat, unlink, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { config } from '../config.js'

async function cleanup(): Promise<void> {
  if (!existsSync(config.logDir)) return
  const cutoffMs = Date.now() - config.logRetentionDays * 86_400_000

  let sandboxDirs: string[]
  try {
    sandboxDirs = await readdir(config.logDir)
  } catch {
    return
  }

  for (const sandboxId of sandboxDirs) {
    const dir = join(config.logDir, sandboxId)
    try {
      const files = await readdir(dir)
      for (const file of files) {
        if (!file.endsWith('.ndjson')) continue
        const filePath = join(dir, file)
        try {
          const st = await stat(filePath)
          if (st.mtimeMs < cutoffMs) await unlink(filePath)
        } catch {}
      }
      const remaining = await readdir(dir)
      if (remaining.length === 0) await rmdir(dir)
    } catch {}
  }
}

export function scheduleRetention(): void {
  cleanup().catch(() => {})
  // Re-run once a day
  setInterval(() => cleanup().catch(() => {}), 86_400_000)
}

import path from 'node:path'
import os from 'node:os'

export interface Config {
  port: number
  host: string
  /** Root directory where sandbox mock files live */
  sandboxesDir: string
  /** Where SQLite DB is stored */
  dbPath: string
  /** How many request history rows to keep */
  historyLimit: number
  /** Maximum memory (MB) for each isolated-vm sandbox */
  sandboxMemoryMb: number
  /** Maximum execution time (ms) for a single request handler */
  sandboxTimeoutMs: number
  /** Debounce delay (ms) before hot-reloading after a file change */
  hotReloadDebounceMs: number
  /** Origins allowed for CORS */
  corsOrigins: string[]
  nodeEnv: string
  /** Root directory for per-sandbox NDJSON request logs */
  logDir: string
  /** Number of days to retain log files before deletion */
  logRetentionDays: number
}

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key]
  return v ? parseInt(v, 10) : fallback
}

const workDir = env('TSANDBOX_WORK_DIR', path.join(os.homedir(), '.tsandbox'))

export const config: Config = {
  port: envInt('PORT', 3001),
  host: env('HOST', '0.0.0.0'),
  sandboxesDir: env('SANDBOXES_DIR', path.join(workDir, 'sandboxes')),
  dbPath: env('DB_PATH', path.join(workDir, 'tsandbox.db')),
  historyLimit: envInt('HISTORY_LIMIT', 1000),
  sandboxMemoryMb: envInt('SANDBOX_MEMORY_MB', 128),
  sandboxTimeoutMs: envInt('SANDBOX_TIMEOUT_MS', 10_000),
  hotReloadDebounceMs: envInt('HOT_RELOAD_DEBOUNCE_MS', 200),
  corsOrigins: env('CORS_ORIGINS', 'http://localhost:5173,http://localhost:3000').split(','),
  nodeEnv: env('NODE_ENV', 'development'),
  logDir: env('LOG_DIR', path.join(workDir, 'logs')),
  logRetentionDays: envInt('LOG_RETENTION_DAYS', 30),
}

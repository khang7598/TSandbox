import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '../config.js'

export interface RequestLogEvent {
  timestamp: string
  sandboxId: string
  requestId: string
  method: string
  path: string
  query: string | null
  status: number
  durationMs: number
  ip: string | null
  userAgent: string | null
  source: string
  matchedEndpoint: string | null
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

// Fire-and-forget — never blocks the request path
export function writeLogEvent(event: RequestLogEvent): void {
  const dir = join(config.logDir, event.sandboxId)
  const file = join(dir, `${todayDate()}.ndjson`)
  mkdir(dir, { recursive: true })
    .then(() => appendFile(file, JSON.stringify(event) + '\n', 'utf8'))
    .catch(() => {})
}

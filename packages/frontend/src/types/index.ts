export interface Sandbox {
  id: string
  name: string
  description: string | null
  created_at: number
  updated_at: number
}

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

export interface Route {
  id: string
  sandboxId: string
  method: string
  pattern: string
  enabled: boolean
  filePath: string
  compiledAt: number
}

export interface HistoryEntry {
  id: string
  sandbox_id: string
  route_id: string | null
  method: string
  url: string
  request_headers: Record<string, string>
  request_body: string | null
  response_status: number
  response_headers: Record<string, string>
  response_body: string | null
  duration_ms: number
  timestamp: number
  logs: LogEntry[]
}

export interface LogEntry {
  level: string
  args: unknown[]
  timestamp: number
}

export interface CompileError {
  route_id: string
  sandbox_id: string
  file_path: string
  errors: string[]
  updated_at: number
}

export interface WSMessage {
  type: string
  sandboxId?: string
  routeId?: string
  filePath?: string
  errors?: string[]
  logs?: LogEntry[]
  method?: string
  pattern?: string
  compiledAt?: number
  error?: string
}

export interface Notification {
  id: string
  type: 'info' | 'success' | 'warning' | 'error'
  title: string
  message?: string
  timestamp: number
}

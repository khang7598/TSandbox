import Database, { type Database as DatabaseType, type Statement } from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { config } from '../config.js'

// Ensure the parent directory exists before opening
fs.mkdirSync(path.dirname(config.dbPath), { recursive: true })

export const db: DatabaseType = new Database(config.dbPath)

// Enable WAL for better concurrent read performance
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// ─── Schema ────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS sandboxes (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );

  CREATE TABLE IF NOT EXISTS routes (
    id          TEXT PRIMARY KEY,
    sandbox_id  TEXT NOT NULL,
    file_path   TEXT NOT NULL,
    method      TEXT NOT NULL DEFAULT 'ALL',
    pattern     TEXT NOT NULL,
    source      TEXT NOT NULL DEFAULT '',
    compiled_at INTEGER NOT NULL DEFAULT 0,
    enabled     INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (sandbox_id) REFERENCES sandboxes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS request_history (
    id            TEXT PRIMARY KEY,
    sandbox_id    TEXT NOT NULL,
    route_id      TEXT,
    method        TEXT NOT NULL,
    url           TEXT NOT NULL,
    request_headers  TEXT NOT NULL DEFAULT '{}',
    request_body     TEXT,
    response_status  INTEGER,
    response_headers TEXT NOT NULL DEFAULT '{}',
    response_body    TEXT,
    duration_ms   INTEGER NOT NULL DEFAULT 0,
    timestamp     INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    logs          TEXT NOT NULL DEFAULT '[]'
  );

  CREATE INDEX IF NOT EXISTS idx_history_sandbox ON request_history (sandbox_id, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_history_timestamp ON request_history (timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_history_status ON request_history (sandbox_id, response_status);
`)

// Safe column migrations — SQLite has no IF NOT EXISTS on ALTER TABLE
{
  const existingCols = new Set(
    (db.prepare("PRAGMA table_info(request_history)").all() as { name: string }[]).map((r) => r.name),
  )
  const additions: [string, string][] = [
    ['ip', 'TEXT'],
    ['user_agent', 'TEXT'],
    ['source', 'TEXT'],
    ['matched_endpoint', 'TEXT'],
  ]
  for (const [col, type] of additions) {
    if (!existingCols.has(col)) db.exec(`ALTER TABLE request_history ADD COLUMN ${col} ${type}`)
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS compile_errors (
    route_id    TEXT PRIMARY KEY,
    sandbox_id  TEXT NOT NULL,
    file_path   TEXT NOT NULL,
    errors      TEXT NOT NULL DEFAULT '[]',
    updated_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
`)

// Remove compile errors whose source file no longer exists on disk.
// Runs on every startup so stale errors from deleted files never linger.
{
  const stale = db
    .prepare('SELECT route_id, file_path FROM compile_errors')
    .all() as { route_id: string; file_path: string }[]

  const del = db.prepare('DELETE FROM compile_errors WHERE route_id = ?')
  for (const row of stale) {
    try {
      fs.accessSync(row.file_path)
    } catch {
      // file gone — purge the error row
      del.run(row.route_id)
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

export interface SandboxRow {
  id: string
  name: string
  description: string | null
  created_at: number
  updated_at: number
}

export interface RouteRow {
  id: string
  sandbox_id: string
  file_path: string
  method: string
  pattern: string
  source: string
  compiled_at: number
  enabled: number
}

export interface HistoryRow {
  id: string
  sandbox_id: string
  route_id: string | null
  method: string
  url: string
  request_headers: string
  request_body: string | null
  response_status: number | null
  response_headers: string
  response_body: string | null
  duration_ms: number
  timestamp: number
  logs: string
  ip: string | null
  user_agent: string | null
  source: string | null
  matched_endpoint: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const queries: Record<string, Statement<any[], any>> = {
  getSandbox: db.prepare<[string]>('SELECT * FROM sandboxes WHERE id = ?'),
  listSandboxes: db.prepare('SELECT * FROM sandboxes ORDER BY created_at DESC'),
  createSandbox: db.prepare(
    'INSERT INTO sandboxes (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ),
  updateSandbox: db.prepare(
    'UPDATE sandboxes SET name = ?, description = ?, updated_at = ? WHERE id = ?',
  ),
  deleteSandbox: db.prepare('DELETE FROM sandboxes WHERE id = ?'),

  listRoutes: db.prepare<[string]>('SELECT * FROM routes WHERE sandbox_id = ?'),
  getRoute: db.prepare<[string]>('SELECT * FROM routes WHERE id = ?'),
  deleteRoute: db.prepare<[string]>('DELETE FROM routes WHERE id = ?'),
  toggleRoute: db.prepare<[number, string]>('UPDATE routes SET enabled = ? WHERE id = ?'),

  getHistory: db.prepare<[string, number]>(
    'SELECT * FROM request_history WHERE sandbox_id = ? ORDER BY timestamp DESC LIMIT ?',
  ),
  insertHistory: db.prepare(`
    INSERT INTO request_history
      (id, sandbox_id, route_id, method, url, request_headers, request_body,
       response_status, response_headers, response_body, duration_ms, timestamp, logs,
       ip, user_agent, source, matched_endpoint)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  pruneHistory: db.prepare<[string, string, number]>(
    `DELETE FROM request_history WHERE sandbox_id = ? AND id NOT IN (
       SELECT id FROM request_history WHERE sandbox_id = ? ORDER BY timestamp DESC LIMIT ?
     )`,
  ),
  clearHistory: db.prepare<[string]>('DELETE FROM request_history WHERE sandbox_id = ?'),

  getCompileErrors: db.prepare<[string]>(
    'SELECT * FROM compile_errors WHERE sandbox_id = ?',
  ),
}

import { useState, useMemo } from 'react'
import { Trash2, ChevronDown, ChevronRight, Search, X, Wifi } from 'lucide-react'
import clsx from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import { useHistory, useClearHistory, useStats } from '@/api/mocks'
import { useAppStore } from '@/store'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import type { HistoryEntry } from '@/types'

interface Props {
  sandboxId: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(status: number) {
  if (status >= 500) return 'text-red-400'
  if (status >= 400) return 'text-orange-400'
  if (status >= 300) return 'text-yellow-400'
  if (status >= 200) return 'text-green-400'
  return 'text-slate-400'
}

function statusBg(status: number) {
  if (status >= 500) return 'bg-red-500/10 text-red-400'
  if (status >= 400) return 'bg-orange-500/10 text-orange-400'
  if (status >= 200) return 'bg-green-500/10 text-green-400'
  return 'bg-slate-500/10 text-slate-400'
}

function prettyJson(str: string | null) {
  if (!str) return ''
  try {
    return JSON.stringify(JSON.parse(str), null, 2)
  } catch {
    return str
  }
}

function sourceIcon(source: string | null): string {
  switch (source) {
    case 'Postman': return '📮'
    case 'curl': return '⌨'
    case 'Browser': return '🌐'
    case 'Python': return '🐍'
    case 'Axios': return '⚡'
    case 'Insomnia': return '😴'
    case 'Node.js': return '🟩'
    case 'Android': return '🤖'
    case 'Flutter': return '🦋'
    default: return '❓'
  }
}

// ─── Entry row ────────────────────────────────────────────────────────────────

function EntryRow({ entry }: { entry: HistoryEntry }) {
  const [expanded, setExpanded] = useState(false)

  const urlPath = (() => {
    try {
      return new URL(entry.url, 'http://x').pathname
    } catch {
      return entry.url
    }
  })()

  const source = entry.source ?? 'Unknown'

  return (
    <div className="border-b border-slate-800">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-slate-800/50 transition-colors"
      >
        <span className="flex-shrink-0 text-slate-500">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <Badge method={entry.method} />
        <span className="flex-1 truncate text-xs text-slate-300 font-mono min-w-0">{urlPath}</span>
        <span className={clsx('text-xs font-mono font-semibold flex-shrink-0', statusColor(entry.response_status))}>
          {entry.response_status}
        </span>
        <span className="text-xs text-slate-500 flex-shrink-0 w-12 text-right">{entry.duration_ms}ms</span>
        <span className="text-xs text-slate-500 flex-shrink-0 w-16 text-right truncate" title={source}>
          {sourceIcon(entry.source)} {source}
        </span>
        <span className="text-xs text-slate-600 flex-shrink-0 w-16 text-right">
          {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 bg-slate-900/50">
          <div className="text-xs text-slate-400 font-mono break-all">{entry.url}</div>

          {/* Origin info */}
          <div className="flex items-center gap-3 text-xs text-slate-500">
            {entry.ip && (
              <span>
                <span className="text-slate-600">IP</span>{' '}
                <span className="font-mono text-slate-400">{entry.ip}</span>
              </span>
            )}
            {entry.matched_endpoint && (
              <span>
                <span className="text-slate-600">endpoint</span>{' '}
                <span className="font-mono text-slate-400">{entry.matched_endpoint}</span>
              </span>
            )}
            {entry.user_agent && (
              <span className="truncate" title={entry.user_agent}>
                <span className="text-slate-600">ua</span>{' '}
                <span className="font-mono text-slate-500 truncate">{entry.user_agent}</span>
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-xs font-medium text-slate-500 mb-1">Request Headers</div>
              <pre className="text-xs bg-slate-800 rounded p-2 overflow-auto max-h-24 text-slate-300 font-mono">
                {JSON.stringify(entry.request_headers, null, 2)}
              </pre>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500 mb-1">Response Headers</div>
              <pre className="text-xs bg-slate-800 rounded p-2 overflow-auto max-h-24 text-slate-300 font-mono">
                {JSON.stringify(entry.response_headers, null, 2)}
              </pre>
            </div>
          </div>

          {entry.request_body && (
            <div>
              <div className="text-xs font-medium text-slate-500 mb-1">Request Body</div>
              <pre className="text-xs bg-slate-800 rounded p-2 overflow-auto max-h-24 text-slate-300 font-mono">
                {prettyJson(entry.request_body)}
              </pre>
            </div>
          )}

          <div>
            <div className="text-xs font-medium text-slate-500 mb-1">Response Body</div>
            <pre className="text-xs bg-slate-800 rounded p-2 overflow-auto max-h-32 text-slate-300 font-mono">
              {prettyJson(entry.response_body)}
            </pre>
          </div>

          {entry.logs && entry.logs.length > 0 && (
            <div>
              <div className="text-xs font-medium text-slate-500 mb-1">Logs ({entry.logs.length})</div>
              <div className="bg-slate-800 rounded p-2 space-y-0.5 max-h-24 overflow-auto">
                {entry.logs.map((log, i) => (
                  <div key={i} className={clsx('text-xs font-mono',
                    log.level === 'error' ? 'text-red-400' :
                    log.level === 'warn' ? 'text-yellow-400' : 'text-slate-300'
                  )}>
                    [{log.level}] {log.args.map((a) => JSON.stringify(a)).join(' ')}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Stats bar ────────────────────────────────────────────────────────────────

function StatsBar({ sandboxId }: { sandboxId: string }) {
  const { data: stats } = useStats(sandboxId)
  if (!stats || stats.total === 0) return null

  const errorRate = stats.total > 0
    ? Math.round(((stats.errors_4xx + stats.errors_5xx) / stats.total) * 100)
    : 0

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 bg-slate-800/40 border-b border-slate-800 text-xs text-slate-500 flex-shrink-0 flex-wrap">
      <span className="text-slate-400 font-medium">{stats.total.toLocaleString()} total</span>
      <span className="text-green-500">{stats.success_2xx} 2xx</span>
      {stats.errors_4xx > 0 && <span className="text-orange-400">{stats.errors_4xx} 4xx</span>}
      {stats.errors_5xx > 0 && <span className="text-red-400">{stats.errors_5xx} 5xx</span>}
      <span>·</span>
      <span>avg {stats.avg_duration_ms}ms</span>
      {errorRate > 0 && <span>· {errorRate}% errors</span>}
      {stats.topSources.length > 0 && (
        <>
          <span>·</span>
          <span>{stats.topSources.map((s) => s.source).join(', ')}</span>
        </>
      )}
    </div>
  )
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

const METHODS = ['ALL', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const STATUS_OPTIONS = [
  { value: '', label: 'All status' },
  { value: '2xx', label: '2xx OK' },
  { value: '3xx', label: '3xx Redirect' },
  { value: '4xx', label: '4xx Client' },
  { value: '5xx', label: '5xx Server' },
]

interface Filters {
  q: string
  method: string
  status: string
}

function FilterBar({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-slate-800 bg-slate-900 flex-shrink-0">
      <div className="flex-1 flex items-center gap-1 bg-slate-800 rounded px-2 py-1">
        <Search size={11} className="text-slate-500 flex-shrink-0" />
        <input
          type="text"
          value={filters.q}
          onChange={(e) => onChange({ ...filters, q: e.target.value })}
          placeholder="Filter by path..."
          className="flex-1 bg-transparent text-xs text-slate-300 placeholder-slate-600 outline-none min-w-0"
        />
        {filters.q && (
          <button onClick={() => onChange({ ...filters, q: '' })} className="text-slate-600 hover:text-slate-400">
            <X size={10} />
          </button>
        )}
      </div>
      <select
        value={filters.method}
        onChange={(e) => onChange({ ...filters, method: e.target.value })}
        className="bg-slate-800 text-xs text-slate-400 rounded px-2 py-1 outline-none border-0"
      >
        {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <select
        value={filters.status}
        onChange={(e) => onChange({ ...filters, status: e.target.value })}
        className="bg-slate-800 text-xs text-slate-400 rounded px-2 py-1 outline-none border-0"
      >
        {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function RequestHistory({ sandboxId }: Props) {
  const [filters, setFilters] = useState<Filters>({ q: '', method: 'ALL', status: '' })

  const { data: initialHistory, isLoading } = useHistory(sandboxId, 500)
  const clearHistory = useClearHistory()
  const wsConnected = useAppStore((s) => s.wsConnected)
  const liveEvents = useAppStore((s) => sandboxId ? (s.liveEvents[sandboxId] ?? []) : [])

  // Merge: live events prepended to initial load, deduped by id
  const merged = useMemo(() => {
    const seenIds = new Set(liveEvents.map((e) => e.id))
    return [...liveEvents, ...(initialHistory ?? []).filter((e) => !seenIds.has(e.id))]
  }, [liveEvents, initialHistory])

  // Client-side filtering
  const filtered = useMemo(() => {
    return merged.filter((e) => {
      if (filters.method !== 'ALL' && e.method !== filters.method) return false
      if (filters.status === '2xx' && (e.response_status < 200 || e.response_status >= 300)) return false
      if (filters.status === '3xx' && (e.response_status < 300 || e.response_status >= 400)) return false
      if (filters.status === '4xx' && (e.response_status < 400 || e.response_status >= 500)) return false
      if (filters.status === '5xx' && e.response_status < 500) return false
      if (filters.q) {
        const q = filters.q.toLowerCase()
        if (!e.url.toLowerCase().includes(q) &&
            !(e.source ?? '').toLowerCase().includes(q) &&
            !(e.matched_endpoint ?? '').toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [merged, filters])

  const hasFilters = filters.q || filters.method !== 'ALL' || filters.status

  async function handleClear() {
    if (!sandboxId) return
    await clearHistory.mutateAsync(sandboxId)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">
            {hasFilters ? `${filtered.length} / ${merged.length}` : merged.length} requests
          </span>
          {wsConnected && (
            <span className="flex items-center gap-1 text-[10px] text-green-500">
              <Wifi size={9} />
              live
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClear}
          disabled={!sandboxId || merged.length === 0}
          className="text-slate-500 hover:text-red-400"
        >
          <Trash2 size={12} /> Clear
        </Button>
      </div>

      {/* Stats */}
      {sandboxId && <StatsBar sandboxId={sandboxId} />}

      {/* Filters */}
      <FilterBar filters={filters} onChange={setFilters} />

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="px-3 py-4 text-xs text-slate-500">Loading...</div>
        )}
        {!isLoading && filtered.length === 0 && merged.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-slate-600">
            No requests yet. Send a request via the API Explorer.
          </div>
        )}
        {!isLoading && filtered.length === 0 && merged.length > 0 && (
          <div className="px-3 py-8 text-center text-xs text-slate-600">
            No requests match the current filters.
          </div>
        )}
        {filtered.map((entry) => (
          <EntryRow key={entry.id} entry={entry} />
        ))}
      </div>

      {/* Status bar: source breakdown */}
      {sandboxId && filtered.length > 0 && (() => {
        const sources = filtered.reduce<Record<string, number>>((acc, e) => {
          const s = e.source ?? 'Unknown'
          acc[s] = (acc[s] ?? 0) + 1
          return acc
        }, {})
        const sorted = Object.entries(sources).sort((a, b) => b[1] - a[1]).slice(0, 3)
        return (
          <div className="flex items-center gap-2 px-3 py-1 border-t border-slate-800 text-[10px] text-slate-600 flex-shrink-0 flex-wrap">
            {sorted.map(([src, count]) => (
              <span key={src}>{sourceIcon(src)} {src} {count}</span>
            ))}
          </div>
        )
      })()}
    </div>
  )
}

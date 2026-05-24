import { useState } from 'react'
import { Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import { useHistory, useClearHistory } from '@/api/mocks'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import type { HistoryEntry } from '@/types'

interface Props {
  sandboxId: string | null
}

interface EntryRowProps {
  entry: HistoryEntry
}

function statusColor(status: number) {
  if (status >= 500) return 'text-red-400'
  if (status >= 400) return 'text-orange-400'
  if (status >= 300) return 'text-yellow-400'
  if (status >= 200) return 'text-green-400'
  return 'text-slate-400'
}

function prettyJson(str: string | null) {
  if (!str) return ''
  try {
    return JSON.stringify(JSON.parse(str), null, 2)
  } catch {
    return str
  }
}

function EntryRow({ entry }: EntryRowProps) {
  const [expanded, setExpanded] = useState(false)

  const urlPath = (() => {
    try {
      return new URL(entry.url, 'http://x').pathname
    } catch {
      return entry.url
    }
  })()

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
        <span className="flex-1 truncate text-xs text-slate-300 font-mono">{urlPath}</span>
        <span className={clsx('text-xs font-mono font-semibold flex-shrink-0', statusColor(entry.response_status))}>
          {entry.response_status}
        </span>
        <span className="text-xs text-slate-500 flex-shrink-0">{entry.duration_ms}ms</span>
        <span className="text-xs text-slate-600 flex-shrink-0">
          {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 bg-slate-900/50">
          <div className="text-xs text-slate-400 font-mono break-all">{entry.url}</div>

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

export default function RequestHistory({ sandboxId }: Props) {
  const { data: history, isLoading } = useHistory(sandboxId, 50)
  const clearHistory = useClearHistory()

  async function handleClear() {
    if (!sandboxId) return
    await clearHistory.mutateAsync(sandboxId)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700 flex-shrink-0">
        <span className="text-xs text-slate-400">
          {history?.length ?? 0} requests
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClear}
          disabled={!sandboxId || !history?.length}
          className="text-slate-500 hover:text-red-400"
        >
          <Trash2 size={12} /> Clear
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="px-3 py-4 text-xs text-slate-500">Loading...</div>
        )}
        {!isLoading && !history?.length && (
          <div className="px-3 py-8 text-center text-xs text-slate-600">
            No requests yet. Send a request via the API Explorer.
          </div>
        )}
        {history?.map((entry) => (
          <EntryRow key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  )
}

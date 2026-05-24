import { useEffect, useRef } from 'react'
import { Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { useAppStore } from '@/store'
import Button from '../ui/Button'
import type { LogEntry } from '@/types'

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')
}

function levelStyle(level: string) {
  switch (level) {
    case 'error':
      return 'text-red-400 bg-red-900/10'
    case 'warn':
      return 'text-yellow-400 bg-yellow-900/10'
    case 'info':
      return 'text-blue-400'
    default:
      return 'text-slate-300'
  }
}

function levelBadge(level: string) {
  switch (level) {
    case 'error':
      return 'text-red-500'
    case 'warn':
      return 'text-yellow-500'
    case 'info':
      return 'text-blue-500'
    default:
      return 'text-slate-500'
  }
}

interface LogLineProps {
  log: LogEntry
}

function LogLine({ log }: LogLineProps) {
  const time = new Date(log.timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  return (
    <div className={clsx('flex gap-2 px-3 py-0.5 font-mono text-xs hover:bg-slate-800/30', levelStyle(log.level))}>
      <span className="text-slate-600 flex-shrink-0">{time}</span>
      <span className={clsx('uppercase flex-shrink-0 font-semibold', levelBadge(log.level))}>
        {log.level.slice(0, 3)}
      </span>
      <span className="break-all whitespace-pre-wrap">{formatArgs(log.args)}</span>
    </div>
  )
}

export default function RuntimeLogs() {
  const logs = useAppStore((s) => s.runtimeLogs)
  const clearLogs = useAppStore((s) => s.clearLogs)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700 flex-shrink-0">
        <span className="text-xs text-slate-400">{logs.length} log entries</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={clearLogs}
          disabled={logs.length === 0}
          className="text-slate-500 hover:text-red-400"
        >
          <Trash2 size={12} /> Clear
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto bg-slate-950">
        {logs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-slate-600">
            No logs yet. Logs from sandbox handlers will appear here.
          </div>
        ) : (
          <>
            {logs.map((log, i) => (
              <LogLine key={i} log={log} />
            ))}
            <div ref={bottomRef} />
          </>
        )}
      </div>
    </div>
  )
}

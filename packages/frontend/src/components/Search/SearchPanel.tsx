import { useState, useEffect, useRef, useMemo } from 'react'
import { X, Search, CaseSensitive, ChevronRight, ChevronDown, FileCode } from 'lucide-react'
import { useQueries } from '@tanstack/react-query'
import clsx from 'clsx'
import { useFileTree } from '@/api/mocks'
import { useAppStore } from '@/store'
import client from '@/api/client'
import type { FileNode } from '@/types'

interface Match {
  line: number
  text: string
  from: number
  to: number
}

interface FileResult {
  filePath: string
  matches: Match[]
}

function flattenTree(nodes: FileNode[]): string[] {
  const out: string[] = []
  for (const n of nodes) {
    if (n.type === 'file') out.push(n.path)
    if (n.children) out.push(...flattenTree(n.children))
  }
  return out
}

function findMatches(content: string, query: string, caseSensitive: boolean): Match[] {
  const lines = content.split('\n')
  const needle = caseSensitive ? query : query.toLowerCase()
  const matches: Match[] = []
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]
    const haystack = caseSensitive ? text : text.toLowerCase()
    let pos = 0
    while (true) {
      const idx = haystack.indexOf(needle, pos)
      if (idx === -1) break
      matches.push({ line: i + 1, text, from: idx, to: idx + needle.length })
      pos = idx + needle.length
    }
  }
  return matches
}

interface SearchPanelProps {
  sandboxId: string | null
}

export default function SearchPanel({ sandboxId }: SearchPanelProps) {
  const isOpen = useAppStore((s) => s.searchOpen)
  const setOpen = useAppStore((s) => s.setSearchOpen)
  const openFile = useAppStore((s) => s.openFile)
  const setPendingNavigation = useAppStore((s) => s.setPendingNavigation)

  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: fileTree } = useFileTree(sandboxId)
  const filePaths = useMemo(() => flattenTree(fileTree ?? []), [fileTree])

  const fileQueries = useQueries({
    queries: filePaths.map((path) => ({
      queryKey: ['fileContent', sandboxId, path],
      queryFn: async () => {
        const res = await client.get<{ path: string; content: string }>(
          `/sandboxes/${sandboxId}/files/${path}`,
        )
        return res.data.content
      },
      enabled: !!sandboxId && isOpen,
      staleTime: 30_000,
    })),
  })

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 30)
    } else {
      setQuery('')
      setCollapsed(new Set())
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, setOpen])

  const results = useMemo<FileResult[]>(() => {
    const trimmed = query.trim()
    if (!trimmed) return []
    return filePaths
      .map((filePath, i) => {
        const content = fileQueries[i]?.data
        if (!content) return null
        const matches = findMatches(content, trimmed, caseSensitive)
        return matches.length ? { filePath, matches } : null
      })
      .filter((r): r is FileResult => r !== null)
  }, [query, caseSensitive, filePaths, fileQueries])

  const totalMatches = results.reduce((n, r) => n + r.matches.length, 0)
  const isLoading = isOpen && fileQueries.some((q) => q.isFetching)

  function handleResultClick(filePath: string, line: number) {
    openFile(filePath)
    setPendingNavigation({ file: filePath, line })
    setOpen(false)
  }

  function toggleCollapse(filePath: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(filePath)) next.delete(filePath)
      else next.add(filePath)
      return next
    })
  }

  if (!isOpen) return null

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setOpen(false)} />
      <div
        className="fixed z-50 top-10 left-1/2 -translate-x-1/2 w-full max-w-2xl bg-slate-800 border border-slate-600 rounded-lg shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: 'calc(100vh - 80px)' }}
      >
        {/* Input row */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-700">
          <Search size={14} className="text-slate-400 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search across files..."
            className="flex-1 bg-transparent text-sm text-slate-100 placeholder-slate-500 outline-none"
          />
          <button
            onClick={() => setCaseSensitive((v) => !v)}
            title="Case sensitive (Alt+C)"
            className={clsx(
              'flex-shrink-0 p-1 rounded transition-colors',
              caseSensitive
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700',
            )}
          >
            <CaseSensitive size={14} />
          </button>
          <button
            onClick={() => setOpen(false)}
            className="flex-shrink-0 text-slate-400 hover:text-slate-200 p-1 rounded hover:bg-slate-700"
          >
            <X size={14} />
          </button>
        </div>

        {/* Results */}
        <div className="overflow-y-auto flex-1 min-h-0">
          {!query.trim() && (
            <div className="py-10 text-center text-xs text-slate-500">
              Type to search across all files in this sandbox
            </div>
          )}

          {query.trim() && isLoading && !results.length && (
            <div className="py-10 text-center text-xs text-slate-500">Searching…</div>
          )}

          {query.trim() && !isLoading && !results.length && (
            <div className="py-10 text-center text-xs text-slate-500">No results for "{query}"</div>
          )}

          {results.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-xs text-slate-500 border-b border-slate-700/50 sticky top-0 bg-slate-800">
                {totalMatches} result{totalMatches !== 1 ? 's' : ''} in {results.length} file{results.length !== 1 ? 's' : ''}
              </div>

              {results.map(({ filePath, matches }) => {
                const isCollapsed = collapsed.has(filePath)
                const fileName = filePath.split('/').pop() ?? filePath
                const dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : ''

                return (
                  <div key={filePath} className="border-b border-slate-700/30 last:border-0">
                    <button
                      onClick={() => toggleCollapse(filePath)}
                      className="w-full flex items-center gap-1.5 px-3 py-1.5 hover:bg-slate-700/40 text-left"
                    >
                      {isCollapsed
                        ? <ChevronRight size={12} className="text-slate-500 flex-shrink-0" />
                        : <ChevronDown size={12} className="text-slate-500 flex-shrink-0" />}
                      <FileCode size={12} className="text-blue-400 flex-shrink-0" />
                      <span className="text-xs font-medium text-slate-200">{fileName}</span>
                      {dir && <span className="text-xs text-slate-500 truncate">{dir}</span>}
                      <span className="ml-auto text-xs bg-slate-700 text-slate-300 rounded px-1.5 py-0.5 flex-shrink-0">
                        {matches.length}
                      </span>
                    </button>

                    {!isCollapsed && matches.map((match, mi) => (
                      <button
                        key={`${match.line}-${mi}`}
                        onClick={() => handleResultClick(filePath, match.line)}
                        className="w-full flex items-start gap-2 px-3 py-0.5 hover:bg-blue-600/20 text-left group"
                      >
                        <span className="w-8 text-right flex-shrink-0 text-xs text-slate-500 font-mono pt-0.5 group-hover:text-slate-400">
                          {match.line}
                        </span>
                        <span className="flex-1 min-w-0 text-xs text-slate-300 font-mono truncate py-0.5">
                          {match.text.slice(0, match.from)}
                          <mark className="bg-yellow-400/30 text-yellow-200 rounded-sm not-italic">
                            {match.text.slice(match.from, match.to)}
                          </mark>
                          {match.text.slice(match.to)}
                        </span>
                      </button>
                    ))}
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>
    </>
  )
}

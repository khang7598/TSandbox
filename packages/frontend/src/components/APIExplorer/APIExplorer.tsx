import { useState, useEffect } from 'react'
import { Send, Copy, Plus, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import axios from 'axios'
import Button from '../ui/Button'
import { useSandboxes } from '@/api/mocks'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
type Method = (typeof METHODS)[number]

interface Header {
  key: string
  value: string
}

interface ResponseData {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  duration: number
}

interface Props {
  sandboxId: string | null
}

export default function APIExplorer({ sandboxId }: Props) {
  const { data: sandboxes } = useSandboxes()
  const [selectedSandboxId, setSelectedSandboxId] = useState<string | null>(sandboxId)
  const [method, setMethod] = useState<Method>('GET')

  // Always follow sidebar clicks; dropdown overrides only until next sidebar click
  useEffect(() => {
    setSelectedSandboxId(sandboxId)
  }, [sandboxId])
  const [path, setPath] = useState('/')
  const [headers, setHeaders] = useState<Header[]>([{ key: 'Content-Type', value: 'application/json' }])
  const [body, setBody] = useState('')
  const [response, setResponse] = useState<ResponseData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function addHeader() {
    setHeaders((h) => [...h, { key: '', value: '' }])
  }

  function updateHeader(i: number, field: 'key' | 'value', value: string) {
    setHeaders((h) => h.map((header, idx) => (idx === i ? { ...header, [field]: value } : header)))
  }

  function removeHeader(i: number) {
    setHeaders((h) => h.filter((_, idx) => idx !== i))
  }

  async function sendRequest() {
    if (!selectedSandboxId) return
    setLoading(true)
    setError(null)
    setResponse(null)

    const url = `/_sandbox/${selectedSandboxId}${path.startsWith('/') ? path : `/${path}`}`
    const reqHeaders: Record<string, string> = {}
    for (const h of headers) {
      if (h.key.trim()) reqHeaders[h.key.trim()] = h.value
    }

    const start = Date.now()
    try {
      const res = await axios({
        method,
        url,
        headers: reqHeaders,
        data: body && method !== 'GET' && method !== 'DELETE' ? body : undefined,
        validateStatus: () => true,
        transformResponse: [(d) => d],
      })

      const duration = Date.now() - start
      const resHeaders: Record<string, string> = {}
      for (const [k, v] of Object.entries(res.headers)) {
        resHeaders[k] = String(v)
      }

      setResponse({
        status: res.status,
        statusText: res.statusText,
        headers: resHeaders,
        body: String(res.data),
        duration,
      })
    } catch (err: unknown) {
      const duration = Date.now() - start
      if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Request failed')
      }
      setResponse({ status: 0, statusText: 'Error', headers: {}, body: '', duration })
    } finally {
      setLoading(false)
    }
  }

  function buildCurl() {
    const url = `http://localhost:3001/_sandbox/${selectedSandboxId}${path}`
    const headerArgs = headers
      .filter((h) => h.key.trim())
      .map((h) => `-H '${h.key}: ${h.value}'`)
      .join(' ')
    const bodyArg =
      body && method !== 'GET' && method !== 'DELETE' ? `-d '${body}'` : ''
    return `curl -X ${method} '${url}' ${headerArgs} ${bodyArg}`.trim()
  }

  function copyAsCurl() {
    navigator.clipboard.writeText(buildCurl())
  }

  function statusColor(status: number) {
    if (status >= 500) return 'text-red-400'
    if (status >= 400) return 'text-orange-400'
    if (status >= 300) return 'text-yellow-400'
    if (status >= 200) return 'text-green-400'
    return 'text-slate-400'
  }

  function prettyJson(str: string) {
    try {
      return JSON.stringify(JSON.parse(str), null, 2)
    } catch {
      return str
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Request section */}
      <div className="flex-shrink-0 p-3 space-y-2 border-b border-slate-700">
        {/* Sandbox selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 whitespace-nowrap">Sandbox</span>
          <select
            value={selectedSandboxId ?? ''}
            onChange={(e) => setSelectedSandboxId(e.target.value || null)}
            className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
          >
            <option value="">— none —</option>
            {sandboxes?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {/* Method + URL */}
        <div className="flex gap-2">
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as Method)}
            className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <div className="flex-1 flex items-center bg-slate-800 border border-slate-600 rounded overflow-hidden">
            {selectedSandboxId && (
              <span className="px-2 text-xs text-slate-500 border-r border-slate-600 whitespace-nowrap">
                /{selectedSandboxId.slice(0, 8)}
              </span>
            )}
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/users"
              className="flex-1 bg-transparent px-2 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none"
            />
          </div>
          <Button
            variant="default"
            size="sm"
            onClick={sendRequest}
            disabled={loading || !selectedSandboxId}
          >
            <Send size={12} />
            {loading ? 'Sending...' : 'Send'}
          </Button>
        </div>

        {/* Headers */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-slate-400">Headers</span>
            <button
              onClick={addHeader}
              className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
            >
              <Plus size={11} /> Add
            </button>
          </div>
          <div className="space-y-1">
            {headers.map((h, i) => (
              <div key={i} className="flex gap-1">
                <input
                  type="text"
                  value={h.key}
                  onChange={(e) => updateHeader(i, 'key', e.target.value)}
                  placeholder="Key"
                  className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
                <input
                  type="text"
                  value={h.value}
                  onChange={(e) => updateHeader(i, 'value', e.target.value)}
                  placeholder="Value"
                  className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={() => removeHeader(i)}
                  className="text-slate-500 hover:text-red-400 px-1"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        {method !== 'GET' && method !== 'DELETE' && (
          <div>
            <span className="text-xs font-medium text-slate-400 block mb-1">Body (JSON)</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder='{"key": "value"}'
              rows={4}
              className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 font-mono focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>
        )}
      </div>

      {/* Response section */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {error && !response && (
          <div className="text-xs text-red-400 bg-red-900/20 border border-red-800 rounded p-2">
            {error}
          </div>
        )}
        {response && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={clsx('text-sm font-mono font-bold', statusColor(response.status))}>
                  {response.status}
                </span>
                <span className="text-xs text-slate-400">{response.statusText}</span>
                <span className="text-xs text-slate-500">{response.duration}ms</span>
              </div>
              <button
                onClick={copyAsCurl}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
              >
                <Copy size={11} /> cURL
              </button>
            </div>

            {/* Response headers */}
            <details className="text-xs">
              <summary className="text-slate-400 cursor-pointer hover:text-slate-200 select-none">
                Response Headers ({Object.keys(response.headers).length})
              </summary>
              <div className="mt-1 space-y-0.5 pl-2">
                {Object.entries(response.headers).map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <span className="text-slate-400 font-mono">{k}:</span>
                    <span className="text-slate-300 break-all">{v}</span>
                  </div>
                ))}
              </div>
            </details>

            {/* Response body */}
            {response.body && (
              <div>
                <div className="text-xs text-slate-400 mb-1">Body</div>
                <pre className="text-xs bg-slate-800 border border-slate-700 rounded p-2 overflow-auto max-h-64 text-slate-200 font-mono whitespace-pre-wrap break-words">
                  {prettyJson(response.body)}
                </pre>
              </div>
            )}
          </div>
        )}
        {!response && !error && !loading && (
          <div className="flex items-center justify-center h-full text-slate-600 text-xs">
            Send a request to see the response
          </div>
        )}
      </div>
    </div>
  )
}

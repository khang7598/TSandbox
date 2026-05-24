import { useState, useEffect } from 'react'
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels'
import clsx from 'clsx'
import { X, Terminal, History, Globe, Database, AlertTriangle } from 'lucide-react'
import { useAppStore } from '@/store'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useCompileErrors } from '@/api/mocks'

import SandboxSidebar from '@/components/Sidebar/SandboxSidebar'
import MonacoEditorPanel from '@/components/Editor/MonacoEditor'
import APIExplorer from '@/components/APIExplorer/APIExplorer'
import RequestHistory from '@/components/RequestHistory/RequestHistory'
import RuntimeLogs from '@/components/RuntimeLogs/RuntimeLogs'
import StateInspector from '@/components/StateInspector/StateInspector'
import StatusBar from '@/components/Layout/StatusBar'

type RightTab = 'explorer' | 'history' | 'logs' | 'state'

const RIGHT_TABS: { id: RightTab; label: string; icon: React.ReactNode }[] = [
  { id: 'explorer', label: 'API', icon: <Globe size={13} /> },
  { id: 'history', label: 'History', icon: <History size={13} /> },
  { id: 'logs', label: 'Logs', icon: <Terminal size={13} /> },
  { id: 'state', label: 'State', icon: <Database size={13} /> },
]

function Notifications() {
  const notifications = useAppStore((s) => s.notifications)
  const dismiss = useAppStore((s) => s.dismissNotification)

  useEffect(() => {
    const timers = notifications.map((n) =>
      setTimeout(() => dismiss(n.id), 5000),
    )
    return () => timers.forEach(clearTimeout)
  }, [notifications, dismiss])

  if (!notifications.length) return null

  return (
    <div className="fixed bottom-8 right-4 z-50 space-y-2 max-w-sm">
      {notifications.map((n) => (
        <div
          key={n.id}
          className={clsx(
            'flex items-start gap-2 p-3 rounded-lg border shadow-xl text-xs',
            n.type === 'error' && 'bg-red-900/90 border-red-700 text-red-100',
            n.type === 'warning' && 'bg-yellow-900/90 border-yellow-700 text-yellow-100',
            n.type === 'success' && 'bg-green-900/90 border-green-700 text-green-100',
            n.type === 'info' && 'bg-blue-900/90 border-blue-700 text-blue-100',
          )}
        >
          {n.type === 'error' && <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />}
          <div className="flex-1 min-w-0">
            <div className="font-semibold">{n.title}</div>
            {n.message && <div className="mt-0.5 opacity-80 break-words">{n.message}</div>}
          </div>
          <button onClick={() => dismiss(n.id)} className="flex-shrink-0 opacity-60 hover:opacity-100">
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

function CompileErrorBanner({ sandboxId }: { sandboxId: string | null }) {
  const { data: errors } = useCompileErrors(sandboxId)
  if (!errors?.length) return null

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-red-900/40 border-b border-red-800 text-xs text-red-300 flex-shrink-0">
      <AlertTriangle size={12} />
      <span className="font-medium">{errors.length} compile error{errors.length !== 1 ? 's' : ''}</span>
      <span className="text-red-400">—</span>
      <span className="truncate">{errors[0].errors[0]}</span>
    </div>
  )
}

export default function App() {
  const [rightTab, setRightTab] = useState<RightTab>('explorer')
  const activeSandboxId = useAppStore((s) => s.activeSandboxId)
  const logs = useAppStore((s) => s.runtimeLogs)

  // Initialize WebSocket connection
  useWebSocket()

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-900 overflow-hidden">
      {/* Main content area */}
      <div className="flex-1 min-h-0">
        <PanelGroup direction="horizontal" className="h-full">
          {/* Left sidebar */}
          <Panel defaultSize={18} minSize={14} maxSize={30}>
            <SandboxSidebar />
          </Panel>

          <PanelResizeHandle className="w-px bg-slate-700 hover:bg-blue-500 transition-colors cursor-col-resize" />

          {/* Center editor */}
          <Panel defaultSize={52} minSize={30}>
            <div className="flex flex-col h-full">
              <CompileErrorBanner sandboxId={activeSandboxId} />
              <MonacoEditorPanel sandboxId={activeSandboxId} />
            </div>
          </Panel>

          <PanelResizeHandle className="w-px bg-slate-700 hover:bg-blue-500 transition-colors cursor-col-resize" />

          {/* Right panel */}
          <Panel defaultSize={30} minSize={20} maxSize={45}>
            <div className="flex flex-col h-full bg-slate-900">
              {/* Tab bar */}
              <div className="flex items-center border-b border-slate-700 bg-slate-900 flex-shrink-0">
                {RIGHT_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setRightTab(tab.id)}
                    className={clsx(
                      'flex items-center gap-1.5 px-3 py-2 text-xs transition-colors relative',
                      rightTab === tab.id
                        ? 'text-slate-100 bg-slate-800'
                        : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50',
                    )}
                  >
                    {tab.icon}
                    {tab.label}
                    {tab.id === 'logs' && logs.length > 0 && (
                      <span className="ml-1 bg-blue-600 text-white text-[10px] rounded-full px-1 min-w-4 text-center">
                        {logs.length > 99 ? '99+' : logs.length}
                      </span>
                    )}
                    {rightTab === tab.id && (
                      <span className="absolute bottom-0 left-0 right-0 h-px bg-blue-500" />
                    )}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="flex-1 min-h-0">
                {rightTab === 'explorer' && <APIExplorer sandboxId={activeSandboxId} />}
                {rightTab === 'history' && <RequestHistory sandboxId={activeSandboxId} />}
                {rightTab === 'logs' && <RuntimeLogs />}
                {rightTab === 'state' && <StateInspector sandboxId={activeSandboxId} />}
              </div>
            </div>
          </Panel>
        </PanelGroup>
      </div>

      {/* Status bar */}
      <StatusBar />

      {/* Notifications */}
      <Notifications />
    </div>
  )
}

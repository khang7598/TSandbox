import { Wifi, WifiOff, Box, Route } from 'lucide-react'
import clsx from 'clsx'
import { useSandbox, useRoutes } from '@/api/mocks'
import { useAppStore } from '@/store'

export default function StatusBar() {
  const activeSandboxId = useAppStore((s) => s.activeSandboxId)
  const wsConnected = useAppStore((s) => s.wsConnected)
  const { data: sandbox } = useSandbox(activeSandboxId)
  const { data: routes } = useRoutes(activeSandboxId)

  return (
    <div className="flex items-center justify-between h-6 px-3 bg-slate-950 border-t border-slate-800 flex-shrink-0">
      <div className="flex items-center gap-3 text-xs">
        {/* Sandbox name */}
        <div className="flex items-center gap-1 text-slate-400">
          <Box size={11} />
          {sandbox ? (
            <span className="text-blue-400 font-medium">{sandbox.name}</span>
          ) : (
            <span className="text-slate-600">No sandbox selected</span>
          )}
        </div>

        {/* Route count */}
        {routes && (
          <div className="flex items-center gap-1 text-slate-500">
            <Route size={11} />
            <span>{routes.length} route{routes.length !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs">
        {/* WS status */}
        <div
          className={clsx(
            'flex items-center gap-1',
            wsConnected ? 'text-green-500' : 'text-slate-600',
          )}
        >
          {wsConnected ? <Wifi size={11} /> : <WifiOff size={11} />}
          <span>{wsConnected ? 'Live' : 'Disconnected'}</span>
        </div>

        {/* Brand */}
        <a
          href="https://github.com/khang7598/TSandbox/releases"
          target="_blank"
          rel="noreferrer"
          className="text-slate-600 hover:text-slate-400 transition-colors"
        >
          TSandbox v1.3.0
        </a>
      </div>
    </div>
  )
}

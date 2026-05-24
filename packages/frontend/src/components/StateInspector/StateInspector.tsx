import { RotateCcw, RefreshCw } from 'lucide-react'
import { useSandboxState, useResetState } from '@/api/mocks'
import { useAppStore } from '@/store'
import Button from '../ui/Button'

interface Props {
  sandboxId: string | null
}

export default function StateInspector({ sandboxId }: Props) {
  const { data: state, isLoading, refetch } = useSandboxState(sandboxId)
  const resetState = useResetState()
  const addNotification = useAppStore((s) => s.addNotification)

  async function handleReset() {
    if (!sandboxId) return
    try {
      await resetState.mutateAsync(sandboxId)
      addNotification({ type: 'success', title: 'State reset' })
    } catch {
      addNotification({ type: 'error', title: 'Failed to reset state' })
    }
  }

  const formattedState = state ? JSON.stringify(state, null, 2) : ''

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700 flex-shrink-0">
        <span className="text-xs text-slate-400">Runtime State</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            className="text-slate-500 hover:text-slate-200"
          >
            <RefreshCw size={12} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={!sandboxId || resetState.isPending}
            className="text-slate-500 hover:text-red-400"
          >
            <RotateCcw size={12} /> Reset
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-3">
        {isLoading && (
          <div className="text-xs text-slate-500">Loading state...</div>
        )}
        {!isLoading && !state && (
          <div className="text-xs text-slate-600 text-center py-8">
            No state data available
          </div>
        )}
        {!isLoading && state && (
          <>
            {Object.keys(state).length === 0 ? (
              <div className="text-xs text-slate-600 text-center py-8">
                State is empty. Use <code className="text-slate-500">ctx.state</code> in your handlers.
              </div>
            ) : (
              <pre className="text-xs bg-slate-800 rounded p-3 overflow-auto text-slate-200 font-mono whitespace-pre-wrap break-words">
                {formattedState}
              </pre>
            )}
          </>
        )}
      </div>
    </div>
  )
}

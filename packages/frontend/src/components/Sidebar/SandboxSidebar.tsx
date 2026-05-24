import { useState, useRef, useEffect } from 'react'
import { Plus, Box, ChevronRight, Pencil, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { useSandboxes, useFileTree, useDeleteSandbox, useUpdateSandbox } from '@/api/mocks'
import { useAppStore } from '@/store'
import CreateSandboxModal from '../CreateSandboxModal'
import FileTree from '../FileTree/FileTree'
import Button from '../ui/Button'

export default function SandboxSidebar() {
  const [createOpen, setCreateOpen] = useState(false)
  const { data: sandboxes, isLoading } = useSandboxes()
  const activeSandboxId = useAppStore((s) => s.activeSandboxId)
  const setActiveSandboxId = useAppStore((s) => s.setActiveSandboxId)
  const { data: fileTree } = useFileTree(activeSandboxId)
  const deleteSandbox = useDeleteSandbox()
  const updateSandbox = useUpdateSandbox()
  const addNotification = useAppStore((s) => s.addNotification)

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  function startRename(id: string, currentName: string, e: React.MouseEvent) {
    e.stopPropagation()
    setRenamingId(id)
    setRenameValue(currentName)
  }

  async function commitRename() {
    if (!renamingId || !renameValue.trim()) {
      setRenamingId(null)
      return
    }
    const sandbox = sandboxes?.find((s) => s.id === renamingId)
    if (sandbox && renameValue.trim() !== sandbox.name) {
      try {
        await updateSandbox.mutateAsync({ id: renamingId, name: renameValue.trim() })
      } catch {
        addNotification({ type: 'error', title: 'Failed to rename sandbox' })
      }
    }
    setRenamingId(null)
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    try {
      await deleteSandbox.mutateAsync(id)
      if (activeSandboxId === id) setActiveSandboxId(null)
      addNotification({ type: 'success', title: 'Sandbox deleted' })
    } catch {
      addNotification({ type: 'error', title: 'Failed to delete sandbox' })
    }
  }

  return (
    <div className="flex flex-col h-full bg-slate-900 border-r border-slate-700">
      {/* Sandboxes header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Sandboxes
        </span>
        <Button variant="ghost" size="sm" onClick={() => setCreateOpen(true)} className="p-1">
          <Plus size={13} />
        </Button>
      </div>

      {/* Sandbox list */}
      <div className="flex-shrink-0 max-h-48 overflow-y-auto">
        {isLoading && (
          <div className="px-3 py-2 text-xs text-slate-500">Loading...</div>
        )}
        {!isLoading && (!sandboxes || sandboxes.length === 0) && (
          <div className="px-3 py-3 text-center text-xs text-slate-500">
            <p>No sandboxes yet.</p>
            <button
              onClick={() => setCreateOpen(true)}
              className="mt-1 text-blue-400 hover:text-blue-300"
            >
              Create one
            </button>
          </div>
        )}
        {sandboxes?.map((sandbox) => (
          <div
            key={sandbox.id}
            className={clsx(
              'group flex items-center gap-2 w-full px-3 py-2 text-xs transition-colors cursor-pointer',
              activeSandboxId === sandbox.id
                ? 'bg-blue-600/20 text-blue-300 border-l-2 border-blue-500'
                : 'text-slate-300 hover:bg-slate-800 border-l-2 border-transparent',
            )}
            onClick={() => renamingId !== sandbox.id && setActiveSandboxId(sandbox.id)}
          >
            <Box size={12} className="flex-shrink-0" />

            {renamingId === sandbox.id ? (
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') setRenamingId(null)
                }}
                className="flex-1 min-w-0 bg-slate-700 border border-blue-500 rounded px-1 py-0 text-xs text-slate-100 outline-none"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="truncate flex-1">{sandbox.name}</span>
            )}

            {activeSandboxId === sandbox.id && renamingId !== sandbox.id && (
              <ChevronRight size={12} className="flex-shrink-0 text-blue-400" />
            )}

            {renamingId !== sandbox.id && (
              <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  title="Rename"
                  onClick={(e) => startRename(sandbox.id, sandbox.name, e)}
                  className="p-0.5 rounded hover:bg-slate-600 text-slate-400 hover:text-slate-200"
                >
                  <Pencil size={11} />
                </button>
                <button
                  title="Delete"
                  onClick={(e) => handleDelete(sandbox.id, e)}
                  className="p-0.5 rounded hover:bg-slate-600 text-slate-400 hover:text-red-400"
                >
                  <Trash2 size={11} />
                </button>
              </span>
            )}
          </div>
        ))}
      </div>

      {/* File tree for active sandbox */}
      {activeSandboxId && (
        <div className="flex-1 min-h-0 border-t border-slate-700">
          <FileTree nodes={fileTree ?? []} sandboxId={activeSandboxId} />
        </div>
      )}

      {!activeSandboxId && (
        <div className="flex-1 flex items-center justify-center px-3">
          <p className="text-xs text-slate-600 text-center">
            Select a sandbox to view files
          </p>
        </div>
      )}

      <CreateSandboxModal isOpen={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  )
}

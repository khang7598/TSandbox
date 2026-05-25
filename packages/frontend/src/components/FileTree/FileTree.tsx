import { useState, useCallback, useRef, useEffect } from 'react'
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileCode,
  File,
  Plus,
  FileJson,
  Trash2,
  Pencil,
} from 'lucide-react'
import clsx from 'clsx'
import type { FileNode } from '@/types'
import { useAppStore } from '@/store'
import { useDeleteFile, useSaveFile, useRenameFile } from '@/api/mocks'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import ImportOpenAPIModal from '../ImportOpenAPIModal'

interface FileTreeNodeProps {
  node: FileNode
  sandboxId: string
  depth?: number
}

function FileTreeNode({ node, sandboxId, depth = 0 }: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(true)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  const openFile = useAppStore((s) => s.openFile)
  const activeFile = useAppStore((s) => s.activeFile)
  const deleteFile = useDeleteFile()
  const renameFile = useRenameFile()
  const addNotification = useAppStore((s) => s.addNotification)

  const isFile = node.type === 'file'
  const isTs = node.name.endsWith('.ts') || node.name.endsWith('.tsx')
  const isActive = activeFile === node.path

  useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renaming])

  function handleClick() {
    if (renaming) return
    if (isFile) {
      openFile(node.path)
    } else {
      setExpanded((v) => !v)
    }
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  function startRename() {
    setContextMenu(null)
    setRenameValue(node.name)
    setRenaming(true)
  }

  async function commitRename() {
    if (!renameValue.trim() || renameValue.trim() === node.name) {
      setRenaming(false)
      return
    }
    // Build new path: replace the last segment with the new name
    const parts = node.path.split('/')
    parts[parts.length - 1] = renameValue.trim()
    const newPath = parts.join('/')
    setRenaming(false)
    try {
      await renameFile.mutateAsync({ sandboxId, oldPath: node.path, newPath })
      addNotification({ type: 'success', title: 'Renamed', message: `→ ${newPath}` })
    } catch {
      addNotification({ type: 'error', title: 'Failed to rename' })
    }
  }

  async function handleDelete() {
    setContextMenu(null)
    const label = isFile ? 'File' : 'Folder'
    try {
      await deleteFile.mutateAsync({ sandboxId, filePath: node.path })
      addNotification({ type: 'success', title: `${label} deleted`, message: node.path })
    } catch {
      addNotification({ type: 'error', title: `Failed to delete ${label.toLowerCase()}` })
    }
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !renaming) handleClick()
          if (e.key === 'F2') startRename()
        }}
        onContextMenu={handleContextMenu}
        className={clsx(
          'flex items-center gap-1 py-0.5 pr-2 rounded cursor-pointer text-xs select-none',
          'hover:bg-slate-700/50',
          isActive && 'bg-slate-700 text-white',
          !isActive && 'text-slate-300',
        )}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        {!isFile && (
          <span className="text-slate-500 flex-shrink-0">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        )}
        <span className="flex-shrink-0">
          {isFile ? (
            isTs ? (
              <FileCode size={13} className="text-blue-400" />
            ) : (
              <File size={13} className="text-slate-400" />
            )
          ) : expanded ? (
            <FolderOpen size={13} className="text-yellow-400" />
          ) : (
            <Folder size={13} className="text-yellow-400" />
          )}
        </span>

        {renaming ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename() }
              if (e.key === 'Escape') setRenaming(false)
              e.stopPropagation()
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-slate-700 border border-blue-500 rounded px-1 py-0 text-xs text-slate-100 outline-none"
          />
        ) : (
          <span className="truncate">{node.name}</span>
        )}
      </div>

      {!isFile && expanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeNode key={child.path} node={child} sandboxId={sandboxId} depth={depth + 1} />
          ))}
        </div>
      )}

      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setContextMenu(null)}
          />
          <div
            className="fixed z-50 bg-slate-800 border border-slate-600 rounded shadow-xl py-1 min-w-36"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={startRename}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
            >
              <Pencil size={12} /> Rename
            </button>
            <button
              onClick={handleDelete}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red-400 hover:bg-slate-700"
            >
              <Trash2 size={12} /> {isFile ? 'Delete file' : 'Delete folder'}
            </button>
          </div>
        </>
      )}
    </>
  )
}

interface NewFileModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (name: string) => void
}

function NewFileModal({ isOpen, onClose, onConfirm }: NewFileModalProps) {
  const [name, setName] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (name.trim()) {
      onConfirm(name.trim())
      setName('')
      onClose()
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="New File"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="default" size="sm" onClick={handleSubmit} disabled={!name.trim()}>
            Create
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        <label className="block text-xs font-medium text-slate-400 mb-1">File name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="routes/users.ts"
          autoFocus
          className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
        />
        <p className="mt-2 text-xs text-slate-500">
          Use paths like <code className="text-slate-400">routes/users.ts</code> for route files.
        </p>
      </form>
    </Modal>
  )
}

function getDefaultContent(filePath: string): string {
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
    const basename = filePath.split('/').pop()?.replace(/\.tsx?$/, '') ?? 'handler'
    const routePath = '/' + basename.replace(/[_\s]+/g, '-').toLowerCase()
    return `import { defineMock, ok } from '@tsandbox/sdk'

export default defineMock({
  method: 'GET',
  path: '${routePath}',

  async handler({ params, query, body, state, logger }) {
    return ok({ message: 'Hello from ${routePath}' })
  },
})
`
  }
  return ''
}

interface FileTreeProps {
  nodes: FileNode[]
  sandboxId: string
}

export default function FileTree({ nodes, sandboxId }: FileTreeProps) {
  const [newFileOpen, setNewFileOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const openFile = useAppStore((s) => s.openFile)
  const saveFile = useSaveFile()
  const addNotification = useAppStore((s) => s.addNotification)

  const handleNewFile = useCallback(
    async (name: string) => {
      const filePath = name.startsWith('/') ? name.slice(1) : name
      try {
        await saveFile.mutateAsync({
          sandboxId,
          filePath,
          content: getDefaultContent(filePath),
        })
        openFile(filePath)
        addNotification({ type: 'success', title: 'File created', message: filePath })
      } catch {
        addNotification({ type: 'error', title: 'Failed to create file' })
      }
    },
    [sandboxId, saveFile, openFile, addNotification],
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-slate-700">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Files</span>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="sm" onClick={() => setImportOpen(true)} className="p-1" title="Import OpenAPI spec">
            <FileJson size={13} />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setNewFileOpen(true)} className="p-1" title="New file">
            <Plus size={13} />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {nodes.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-slate-500">
            <p>No files yet.</p>
            <button
              onClick={() => setNewFileOpen(true)}
              className="mt-1 text-blue-400 hover:text-blue-300"
            >
              Create a file
            </button>
          </div>
        ) : (
          nodes.map((node) => (
            <FileTreeNode key={node.path} node={node} sandboxId={sandboxId} />
          ))
        )}
      </div>
      <NewFileModal
        isOpen={newFileOpen}
        onClose={() => setNewFileOpen(false)}
        onConfirm={handleNewFile}
      />
      <ImportOpenAPIModal
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        sandboxId={sandboxId}
      />
    </div>
  )
}

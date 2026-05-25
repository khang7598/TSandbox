import { useState, useRef } from 'react'
import { UploadCloud, FileArchive, X } from 'lucide-react'
import Modal from './ui/Modal'
import Button from './ui/Button'
import { useImportSandbox } from '@/api/mocks'
import { useAppStore } from '@/store'

interface Props {
  isOpen: boolean
  onClose: () => void
}

export default function ImportSandboxModal({ isOpen, onClose }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const importSandbox = useImportSandbox()
  const setActiveSandboxId = useAppStore((s) => s.setActiveSandboxId)
  const addNotification = useAppStore((s) => s.addNotification)

  function handleFileChange(f: File | null) {
    if (f && f.name.endsWith('.zip')) setFile(f)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    handleFileChange(e.dataTransfer.files[0] ?? null)
  }

  async function handleImport() {
    if (!file) return
    try {
      const sandbox = await importSandbox.mutateAsync(file)
      setActiveSandboxId(sandbox.id)
      addNotification({ type: 'success', title: 'Sandbox imported', message: sandbox.name })
      setFile(null)
      onClose()
    } catch {
      addNotification({ type: 'error', title: 'Import failed', message: 'Make sure the file is a valid sandbox export.' })
    }
  }

  function handleClose() {
    setFile(null)
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Import Sandbox"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleImport}
            disabled={!file || importSandbox.isPending}
          >
            {importSandbox.isPending ? 'Importing...' : 'Import'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-slate-400">
          Select a <code className="text-slate-300">.zip</code> file exported from another TSandbox instance.
          A new sandbox will be created with all its routes and files.
        </p>

        {/* Drop zone */}
        <div
          onClick={() => inputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          className={`
            flex flex-col items-center justify-center gap-2 h-32 rounded border-2 border-dashed cursor-pointer transition-colors
            ${dragOver
              ? 'border-blue-400 bg-blue-500/10'
              : file
              ? 'border-slate-500 bg-slate-800/50'
              : 'border-slate-600 hover:border-slate-500 hover:bg-slate-800/30'
            }
          `}
        >
          {file ? (
            <>
              <FileArchive size={24} className="text-blue-400" />
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-200 truncate max-w-48">{file.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); setFile(null) }}
                  className="text-slate-500 hover:text-slate-300"
                >
                  <X size={13} />
                </button>
              </div>
              <span className="text-xs text-slate-500">{(file.size / 1024).toFixed(1)} KB</span>
            </>
          ) : (
            <>
              <UploadCloud size={24} className="text-slate-500" />
              <span className="text-xs text-slate-400">Drop a .zip file here or click to browse</span>
            </>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".zip"
          className="hidden"
          onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
        />
      </div>
    </Modal>
  )
}

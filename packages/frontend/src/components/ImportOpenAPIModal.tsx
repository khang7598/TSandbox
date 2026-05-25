import { useState } from 'react'
import Modal from './ui/Modal'
import Button from './ui/Button'
import { useImportOpenApi } from '@/api/mocks'
import { useAppStore } from '@/store'

interface Props {
  isOpen: boolean
  onClose: () => void
  sandboxId: string
}

const PLACEHOLDER = `# Paste your OpenAPI spec here (JSON or YAML)
openapi: 3.0.0
info:
  title: My API
  version: 1.0.0
paths:
  /users:
    get:
      summary: List users
      responses:
        '200':
          content:
            application/json:
              schema:
                type: array
                items:
                  type: object
                  properties:
                    id:
                      type: string
                    name:
                      type: string`

export default function ImportOpenAPIModal({ isOpen, onClose, sandboxId }: Props) {
  const [spec, setSpec] = useState('')
  const importOpenApi = useImportOpenApi()
  const addNotification = useAppStore((s) => s.addNotification)

  async function handleImport() {
    if (!spec.trim()) return
    try {
      const result = await importOpenApi.mutateAsync({ sandboxId, spec })
      addNotification({
        type: 'success',
        title: `Imported ${result.count} route${result.count !== 1 ? 's' : ''}`,
        message: result.files.slice(0, 3).join(', ') + (result.files.length > 3 ? ` +${result.files.length - 3} more` : ''),
      })
      if (result.warnings.length) {
        addNotification({ type: 'error', title: 'Import warnings', message: result.warnings.join(' ') })
      }
      setSpec('')
      onClose()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Import failed'
      addNotification({ type: 'error', title: 'Import failed', message: msg })
    }
  }

  function handleClose() {
    setSpec('')
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Import OpenAPI Spec"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleImport}
            disabled={!spec.trim() || importOpenApi.isPending}
          >
            {importOpenApi.isPending ? 'Importing...' : 'Import'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-slate-400">
          Paste an OpenAPI 3.x spec (JSON or YAML). One mock file will be generated per operation,
          grouped by tag or path segment.
        </p>
        <textarea
          value={spec}
          onChange={(e) => setSpec(e.target.value)}
          placeholder={PLACEHOLDER}
          rows={14}
          spellCheck={false}
          className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500 resize-none font-mono"
        />
      </div>
    </Modal>
  )
}

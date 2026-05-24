import { useState } from 'react'
import Modal from './ui/Modal'
import Button from './ui/Button'
import { useCreateSandbox } from '@/api/mocks'
import { useAppStore } from '@/store'

interface Props {
  isOpen: boolean
  onClose: () => void
}

export default function CreateSandboxModal({ isOpen, onClose }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const createSandbox = useCreateSandbox()
  const setActiveSandboxId = useAppStore((s) => s.setActiveSandboxId)
  const addNotification = useAppStore((s) => s.addNotification)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return

    try {
      const sandbox = await createSandbox.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
      })
      setActiveSandboxId(sandbox.id)
      addNotification({ type: 'success', title: 'Sandbox created', message: sandbox.name })
      setName('')
      setDescription('')
      onClose()
    } catch {
      addNotification({ type: 'error', title: 'Failed to create sandbox' })
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="New Sandbox"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleSubmit}
            disabled={!name.trim() || createSandbox.isPending}
          >
            {createSandbox.isPending ? 'Creating...' : 'Create'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">
            Name <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-api-sandbox"
            autoFocus
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description..."
            rows={3}
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none"
          />
        </div>
      </form>
    </Modal>
  )
}

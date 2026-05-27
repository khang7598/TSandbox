import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import client from './client'
import type { Sandbox, FileNode, Route, HistoryEntry, CompileError, SandboxStats } from '@/types'

// --- Sandboxes ---

export function useSandboxes() {
  return useQuery<Sandbox[]>({
    queryKey: ['sandboxes'],
    queryFn: async () => {
      const res = await client.get('/sandboxes')
      return res.data
    },
  })
}

export function useSandbox(id: string | null) {
  return useQuery<Sandbox>({
    queryKey: ['sandboxes', id],
    queryFn: async () => {
      const res = await client.get(`/sandboxes/${id}`)
      return res.data
    },
    enabled: !!id,
  })
}

export function useCreateSandbox() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data: { name: string; description?: string }) => {
      const res = await client.post('/sandboxes', data)
      return res.data as Sandbox
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sandboxes'] })
    },
  })
}

export function useUpdateSandbox() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, name, description }: { id: string; name: string; description?: string }) => {
      const res = await client.put(`/sandboxes/${id}`, { name, description })
      return res.data as Sandbox
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sandboxes'] })
    },
  })
}

export function useDeleteSandbox() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await client.delete(`/sandboxes/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sandboxes'] })
    },
  })
}

// --- Files ---

export function useFileTree(sandboxId: string | null) {
  return useQuery<FileNode[]>({
    queryKey: ['fileTree', sandboxId],
    queryFn: async () => {
      const res = await client.get(`/sandboxes/${sandboxId}/files`)
      return res.data
    },
    enabled: !!sandboxId,
  })
}

export function useFileContent(sandboxId: string | null, filePath: string | null) {
  return useQuery<string>({
    queryKey: ['fileContent', sandboxId, filePath],
    queryFn: async () => {
      const res = await client.get<{ path: string; content: string }>(
        `/sandboxes/${sandboxId}/files/${filePath}`,
      )
      return res.data.content
    },
    enabled: !!sandboxId && !!filePath,
  })
}

export function useSaveFile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      sandboxId,
      filePath,
      content,
    }: {
      sandboxId: string
      filePath: string
      content: string
    }) => {
      const res = await client.put(`/sandboxes/${sandboxId}/files/${filePath}`, { content })
      return res.data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['fileContent', variables.sandboxId, variables.filePath] })
      queryClient.invalidateQueries({ queryKey: ['fileTree', variables.sandboxId] })
      queryClient.invalidateQueries({ queryKey: ['routes', variables.sandboxId] })
    },
  })
}

export function useDeleteFile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ sandboxId, filePath }: { sandboxId: string; filePath: string }) => {
      const res = await client.delete(`/sandboxes/${sandboxId}/files/${filePath}`)
      return res.data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['fileTree', variables.sandboxId] })
      queryClient.invalidateQueries({ queryKey: ['routes', variables.sandboxId] })
    },
  })
}

export function useRenameFile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      sandboxId,
      oldPath,
      newPath,
    }: {
      sandboxId: string
      oldPath: string
      newPath: string
    }) => {
      const res = await client.patch(`/sandboxes/${sandboxId}/files/${oldPath}`, { newPath })
      return res.data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['fileTree', variables.sandboxId] })
      queryClient.invalidateQueries({ queryKey: ['routes', variables.sandboxId] })
      queryClient.invalidateQueries({ queryKey: ['errors', variables.sandboxId] })
    },
  })
}

// --- Routes ---

export function useRoutes(sandboxId: string | null) {
  return useQuery<Route[]>({
    queryKey: ['routes', sandboxId],
    queryFn: async () => {
      const res = await client.get(`/sandboxes/${sandboxId}/routes`)
      return res.data
    },
    enabled: !!sandboxId,
  })
}

// --- History ---

export function useHistory(sandboxId: string | null, limit = 500) {
  return useQuery<HistoryEntry[]>({
    queryKey: ['history', sandboxId, limit],
    queryFn: async () => {
      const res = await client.get(`/sandboxes/${sandboxId}/history`, { params: { limit } })
      return res.data
    },
    enabled: !!sandboxId,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
}

export function useStats(sandboxId: string | null) {
  return useQuery<SandboxStats>({
    queryKey: ['stats', sandboxId],
    queryFn: async () => {
      const res = await client.get(`/sandboxes/${sandboxId}/stats`)
      return res.data
    },
    enabled: !!sandboxId,
    refetchInterval: 15_000,
  })
}

export function useClearHistory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (sandboxId: string) => {
      const res = await client.delete(`/sandboxes/${sandboxId}/history`)
      return res.data
    },
    onSuccess: (_data, sandboxId) => {
      queryClient.invalidateQueries({ queryKey: ['history', sandboxId] })
    },
  })
}

// --- State ---

export function useSandboxState(sandboxId: string | null) {
  return useQuery<Record<string, unknown>>({
    queryKey: ['state', sandboxId],
    queryFn: async () => {
      const res = await client.get(`/sandboxes/${sandboxId}/state`)
      return res.data
    },
    enabled: !!sandboxId,
    refetchInterval: 5000,
  })
}

export function useResetState() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (sandboxId: string) => {
      const res = await client.delete(`/sandboxes/${sandboxId}/state`)
      return res.data
    },
    onSuccess: (_data, sandboxId) => {
      queryClient.invalidateQueries({ queryKey: ['state', sandboxId] })
    },
  })
}

// --- Sandbox export / import ---

export function useImportSandbox() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      const res = await client.post('/sandboxes/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return res.data as Sandbox
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sandboxes'] })
    },
  })
}

// --- OpenAPI import ---

export function useImportOpenApi() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ sandboxId, spec }: { sandboxId: string; spec: string }) => {
      const res = await client.post(`/sandboxes/${sandboxId}/import/openapi`, { spec })
      return res.data as { files: string[]; count: number; warnings: string[] }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['fileTree', variables.sandboxId] })
      queryClient.invalidateQueries({ queryKey: ['routes', variables.sandboxId] })
    },
  })
}

// --- Errors ---

export function useCompileErrors(sandboxId: string | null) {
  return useQuery<CompileError[]>({
    queryKey: ['errors', sandboxId],
    queryFn: async () => {
      const res = await client.get(`/sandboxes/${sandboxId}/errors`)
      return res.data
    },
    enabled: !!sandboxId,
  })
}

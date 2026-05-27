import { create } from 'zustand'
import type { LogEntry, Notification } from '@/types'

interface AppStore {
  activeSandboxId: string | null
  setActiveSandboxId: (id: string | null) => void

  openFiles: string[]
  activeFile: string | null
  openFile: (path: string) => void
  closeFile: (path: string) => void
  setActiveFile: (path: string) => void

  runtimeLogs: LogEntry[]
  addLog: (log: LogEntry) => void
  clearLogs: () => void

  notifications: Notification[]
  addNotification: (n: Omit<Notification, 'id' | 'timestamp'>) => void
  dismissNotification: (id: string) => void

  wsConnected: boolean
  setWsConnected: (connected: boolean) => void

  searchOpen: boolean
  setSearchOpen: (open: boolean) => void

  pendingNavigation: { file: string; line: number } | null
  setPendingNavigation: (nav: { file: string; line: number } | null) => void
}

export const useAppStore = create<AppStore>((set) => ({
  activeSandboxId: null,
  setActiveSandboxId: (id) => set({ activeSandboxId: id ?? null }),

  openFiles: [],
  activeFile: null,
  openFile: (path) =>
    set((state) => {
      if (state.openFiles.includes(path)) {
        return { activeFile: path }
      }
      return { openFiles: [...state.openFiles, path], activeFile: path }
    }),
  closeFile: (path) =>
    set((state) => {
      const newOpenFiles = state.openFiles.filter((f) => f !== path)
      const newActiveFile =
        state.activeFile === path
          ? newOpenFiles[newOpenFiles.length - 1] ?? null
          : state.activeFile
      return { openFiles: newOpenFiles, activeFile: newActiveFile }
    }),
  setActiveFile: (path) => set({ activeFile: path }),

  runtimeLogs: [],
  addLog: (log) =>
    set((state) => ({
      runtimeLogs: [...state.runtimeLogs.slice(-499), log],
    })),
  clearLogs: () => set({ runtimeLogs: [] }),

  notifications: [],
  addNotification: (n) =>
    set((state) => ({
      notifications: [
        ...state.notifications,
        { ...n, id: Math.random().toString(36).slice(2), timestamp: Date.now() },
      ],
    })),
  dismissNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),

  wsConnected: false,
  setWsConnected: (connected) => set({ wsConnected: connected }),

  searchOpen: false,
  setSearchOpen: (open) => set({ searchOpen: open }),

  pendingNavigation: null,
  setPendingNavigation: (nav) => set({ pendingNavigation: nav }),
}))

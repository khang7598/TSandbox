import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '@/store'
import type { WSMessage } from '@/types'

export function useWebSocket() {
  const queryClient = useQueryClient()
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const addLog = useAppStore((s) => s.addLog)
  const addNotification = useAppStore((s) => s.addNotification)
  const setWsConnected = useAppStore((s) => s.setWsConnected)
  const appendLiveEvent = useAppStore((s) => s.appendLiveEvent)

  useEffect(() => {
    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const host = window.location.host
      const wsUrl = `${protocol}//${host}/_ws`

      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        setWsConnected(true)
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current)
          reconnectTimerRef.current = null
        }
      }

      ws.onmessage = (event) => {
        let msg: WSMessage
        try {
          msg = JSON.parse(event.data as string)
        } catch {
          return
        }

        const { type, sandboxId } = msg

        switch (type) {
          case 'connected':
            break

          case 'route_updated':
            if (sandboxId) {
              queryClient.invalidateQueries({ queryKey: ['routes', sandboxId] })
              queryClient.invalidateQueries({ queryKey: ['fileTree', sandboxId] })
              queryClient.invalidateQueries({ queryKey: ['errors', sandboxId] })
            }
            break

          case 'route_deleted':
            if (sandboxId) {
              queryClient.invalidateQueries({ queryKey: ['routes', sandboxId] })
              queryClient.invalidateQueries({ queryKey: ['fileTree', sandboxId] })
              queryClient.invalidateQueries({ queryKey: ['errors', sandboxId] })
            }
            break

          case 'compile_error':
            if (sandboxId) {
              queryClient.invalidateQueries({ queryKey: ['errors', sandboxId] })
            }
            addNotification({
              type: 'error',
              title: 'Compile Error',
              message: msg.errors?.join('\n') ?? msg.error ?? 'Unknown compile error',
            })
            break

          case 'runtime_logs':
            if (msg.logs) {
              for (const log of msg.logs) {
                addLog(log)
              }
            }
            break

          case 'runtime_error':
            addLog({
              level: 'error',
              args: [msg.error ?? 'Runtime error'],
              timestamp: Date.now(),
            })
            addNotification({
              type: 'error',
              title: 'Runtime Error',
              message: msg.error ?? 'Unknown runtime error',
            })
            break

          case 'request_logged':
            if (sandboxId && msg.event) {
              appendLiveEvent(sandboxId, msg.event)
            }
            break
        }
      }

      ws.onclose = () => {
        setWsConnected(false)
        reconnectTimerRef.current = setTimeout(connect, 3000)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
      }
      wsRef.current?.close()
    }
  }, [queryClient, addLog, addNotification, setWsConnected, appendLiveEvent])
}

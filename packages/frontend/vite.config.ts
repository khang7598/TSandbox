import { defineConfig, createLogger } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Suppress harmless WS proxy errors that fire whenever the backend restarts
// (tsx watch). The frontend hook auto-reconnects within 3 s.
const logger = createLogger()
const _error = logger.error.bind(logger)
logger.error = (msg, opts) => {
  if (
    typeof msg === 'string' &&
    (msg.includes('EPIPE') || msg.includes('ECONNRESET'))
  ) return
  _error(msg, opts)
}

export default defineConfig({
  customLogger: logger,
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    port: 5173,
    proxy: {
      '/_api': 'http://localhost:3001',
      '/_sandbox': 'http://localhost:3001',
      '/_ws': { target: 'ws://localhost:3001', ws: true },
    },
  },
})

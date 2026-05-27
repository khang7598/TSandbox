import { buildServer } from './server.js'
import { config } from './config.js'
import { loadExistingSandboxes, startWatcher } from './runtime/hot-reload.js'
import { scheduleRetention } from './logs/retention.js'
import fs from 'node:fs'

async function main() {
  // Ensure sandboxes directory exists
  fs.mkdirSync(config.sandboxesDir, { recursive: true })

  const app = await buildServer()

  // Load existing sandbox files into the registry on startup
  await loadExistingSandboxes(config.sandboxesDir)

  // Start file watcher for live hot reload
  startWatcher(config.sandboxesDir)

  // Schedule log retention cleanup (runs now + daily)
  scheduleRetention()

  // Start server
  await app.listen({ port: config.port, host: config.host })

  console.log(`
╔══════════════════════════════════════════════════════╗
║             TSandbox API Sandbox Platform            ║
╠══════════════════════════════════════════════════════╣
║  Mock server  →  http://localhost:${config.port}             ║
║  Management   →  http://localhost:${config.port}/_api        ║
║  WebSocket    →  ws://localhost:${config.port}/_ws           ║
║  Sandboxes    →  ${config.sandboxesDir.padEnd(36)} ║
╚══════════════════════════════════════════════════════╝
  `)

  // Drain in-flight requests before exiting — important in Docker / k8s
  // where SIGTERM is sent before the container is stopped.
  const shutdown = async (signal: string) => {
    app.log.info(`received ${signal}, shutting down gracefully`)
    await app.close()
    process.exit(0)
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch((err) => {
  console.error('[fatal]', err)
  process.exit(1)
})

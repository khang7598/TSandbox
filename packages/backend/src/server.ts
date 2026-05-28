import Fastify from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyWebSocket from '@fastify/websocket'
import fastifyMultipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'
import { managementPlugin } from './routes/management.js'
import { proxyPlugin } from './routes/proxy.js'
import { addClient } from './ws/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
// In Docker the frontend dist is copied to /app/public (one level up from /app/dist)
const publicDir = resolve(__dirname, '../public')
const hasPublicDir = existsSync(publicDir)

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: config.nodeEnv === 'development' ? 'info' : 'warn',
      transport:
        config.nodeEnv === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
    // Allow large request bodies for file uploads
    bodyLimit: 10 * 1024 * 1024, // 10 MB
  })

  // ── Plugins ──────────────────────────────────────────────────────────────────

  await app.register(fastifyCors, {
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Sandbox-Id'],
    exposedHeaders: [
      'X-Tsandbox-Sandbox',
      'X-Tsandbox-Route',
      'X-Tsandbox-Duration',
    ],
  })

  await app.register(fastifyWebSocket)
  await app.register(fastifyMultipart)

  // ── Frontend static files (production Docker only) ─────────────────────────
  // wildcard: false — decorates reply.sendFile() without registering a GET /*
  // route that would conflict with the mock proxy catch-all.
  if (hasPublicDir) {
    await app.register(fastifyStatic, {
      root: publicDir,
      prefix: '/',
      wildcard: false,
      decorateReply: true,
    })
  }

  // ── WebSocket endpoint ────────────────────────────────────────────────────────

  app.get('/_ws', { websocket: true }, (connection) => {
    const socket = connection.socket
    addClient(socket)
    socket.send(JSON.stringify({ type: 'connected', message: 'MockTool runtime connected' }))
  })

  // ── Health check ──────────────────────────────────────────────────────────────

  app.get('/_api/health', async () => ({
    status: 'ok',
    version: '1.4.0',
    uptime: process.uptime(),
  }))

  // ── Management API ────────────────────────────────────────────────────────────

  await app.register(managementPlugin)

  // ── Mock proxy (catch-all – must be last) ─────────────────────────────────────

  await app.register(proxyPlugin, { publicDir: hasPublicDir ? publicDir : undefined })

  return app
}

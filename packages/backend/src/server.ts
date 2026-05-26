import Fastify from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyWebSocket from '@fastify/websocket'
import fastifyMultipart from '@fastify/multipart'
import { config } from './config.js'
import { managementPlugin } from './routes/management.js'
import { proxyPlugin } from './routes/proxy.js'
import { addClient } from './ws/index.js'

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

  // ── WebSocket endpoint ────────────────────────────────────────────────────────

  app.get('/_ws', { websocket: true }, (connection) => {
    const socket = connection.socket
    addClient(socket)
    socket.send(JSON.stringify({ type: 'connected', message: 'MockTool runtime connected' }))
  })

  // ── Health check ──────────────────────────────────────────────────────────────

  app.get('/_api/health', async () => ({
    status: 'ok',
    version: '1.0.0',
    uptime: process.uptime(),
  }))

  // ── Management API ────────────────────────────────────────────────────────────

  await app.register(managementPlugin)

  // ── Mock proxy (catch-all – must be last) ─────────────────────────────────────

  await app.register(proxyPlugin)

  return app
}

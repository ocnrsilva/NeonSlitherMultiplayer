import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server as SocketIOServer } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import { GameServer } from './server/GameServer';
import { isPrismaHealthy, disconnectPrisma } from './server/db/prisma';
import { isRedisHealthy, disconnectRedis } from './server/redis/redisClient';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = http.createServer(app);

  // Validate and bind application port (Default: 3010)
  const PORT = Number(process.env.APP_PORT ?? 3010);
  if (isNaN(PORT) || PORT <= 0 || PORT > 65535) {
    throw new Error(`[Config] Invalid APP_PORT: '${process.env.APP_PORT}'. Must be a valid port number between 1 and 65535.`);
  }

  // Phase 17: CORS and Origin Security
  const isProduction = process.env.NODE_ENV === 'production';
  const rawAllowedOrigins = process.env.ALLOWED_ORIGINS;
  const allowedOrigins = rawAllowedOrigins
    ? rawAllowedOrigins.split(',').map((o) => o.trim()).filter(Boolean)
    : [];

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      const isAllowed = !isProduction || allowedOrigins.includes(origin) || allowedOrigins.includes('*');
      if (isAllowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
    }
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // Setup Socket.IO with strict CORS in production
  const io = new SocketIOServer(server, {
    cors: {
      origin: isProduction
        ? (allowedOrigins.length > 0 ? allowedOrigins : false)
        : (rawAllowedOrigins ? allowedOrigins : '*'),
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Initialize GameServer
  const gameServer = new GameServer(io);
  gameServer.start();

  // Phase 12: Liveness probe (checks if Node process is responsive)
  app.get('/api/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'neon-slither-server',
      port: PORT,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // Phase 12: Readiness probe (checks critical PostgreSQL and Redis connectivity)
  app.get('/api/ready', async (req, res) => {
    const dbOk = await isPrismaHealthy();
    const redisOk = await isRedisHealthy();

    const isReady = isProduction ? (dbOk && redisOk) : true;
    const statusCode = isReady ? 200 : 503;

    res.status(statusCode).json({
      ready: isReady,
      dependencies: {
        database: dbOk ? 'healthy' : (isProduction ? 'unavailable' : 'offline-dev'),
        redis: redisOk ? 'healthy' : (isProduction ? 'unavailable' : 'offline-dev'),
      },
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
    });
  });

  // App info endpoint
  app.get('/api/info', (req, res) => {
    res.json({
      name: 'NEON SLITHER Multiplayer',
      version: '1.6-multiplayer',
      port: PORT,
      tickRate: 20,
      snapshotRate: 15,
    });
  });

  // Vite development middleware or static production serving
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // Express 5 catch-all syntax: '*all'
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Listen on standard application port
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[NeonSlither] Primary server listening on http://0.0.0.0:${PORT} (Node ENV: ${process.env.NODE_ENV || 'development'})`);
  });

  // In development environments, also provide secondary listener on port 3000 for internal proxy compatibility
  let devServer3000: http.Server | null = null;
  if (!isProduction && PORT !== 3000) {
    try {
      devServer3000 = http.createServer(app);
      io.attach(devServer3000);
      devServer3000.listen(3000, '0.0.0.0', () => {
        console.log(`[NeonSlither] Dev environment compatibility listener active on http://0.0.0.0:3000`);
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[NeonSlither] Dev listener on 3000 not started:', msg);
    }
  }

  // Graceful shutdown
  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log('[NeonSlither] Shutting down gracefully...');
    gameServer.stop();

    if (devServer3000) {
      devServer3000.close();
    }

    await disconnectPrisma();
    await disconnectRedis();

    server.close(() => {
      console.log('[NeonSlither] HTTP/WebSocket server closed.');
      process.exit(0);
    });

    setTimeout(() => {
      console.error('[NeonSlither] Forcefully exiting after shutdown timeout.');
      process.exit(1);
    }, 5000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch((err) => {
  console.error('[NeonSlither] Fatal server startup error:', err);
  process.exit(1);
});

import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server as SocketIOServer } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import { GameServer } from './server/GameServer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = http.createServer(app);

  // Always bind strictly to port 3000 on 0.0.0.0 as required by the container reverse proxy
  const PORT = 3000;

  // Setup Socket.IO
  const io = new SocketIOServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });

  // Initialize GameServer
  const gameServer = new GameServer(io);
  gameServer.start();

  // Healthcheck endpoint for Docker and monitoring
  app.get('/api/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'neon-slither-server',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // App info endpoint
  app.get('/api/info', (req, res) => {
    res.json({
      name: 'NEON SLITHER Multiplayer',
      version: '1.6-multiplayer',
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

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[NeonSlither] Server listening on http://0.0.0.0:${PORT} (Node ENV: ${process.env.NODE_ENV || 'development'})`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('[NeonSlither] Shutting down gracefully...');
    gameServer.stop();
    server.close(() => {
      console.log('[NeonSlither] HTTP/WebSocket server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch((err) => {
  console.error('[NeonSlither] Fatal server startup error:', err);
  process.exit(1);
});

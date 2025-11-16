import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';

// PrismaClient singleton to avoid multiple instances in dev (hot-reload)
if (!globalThis.__prismaClient) {
  globalThis.__prismaClient = new PrismaClient();
}
export const prisma = globalThis.__prismaClient;

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Mount routers (auth)
import authRouter from './controllers/auth.js';
app.use('/api/auth', authRouter);
import casesRouter from './controllers/cases.js';
app.use('/api/cases', casesRouter);

// Health endpoint - checks basic server + DB connectivity
app.get('/health', async (req, res) => {
  try {
    // Simple DB call to ensure connection works
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    console.error('Health check DB error:', err);
    res.status(500).json({ status: 'error', db: 'unreachable', error: String(err) });
  }
});

// Example error route for testing
app.get('/error', (req, res, next) => {
  next(new Error('Test error'));
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Centralized error handler
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal Server Error' });
});

// Start server and ensure DB connection on startup
const PORT = process.env.PORT || 5000;

async function start() {
  try {
    // Ensure DB connection before starting
    await prisma.$connect();
    app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server due to DB connection error:', err);
    process.exit(1);
  }
}

start();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.info('SIGINT received: closing Prisma client');
  try {
    await prisma.$disconnect();
  } finally {
    process.exit(0);
  }
});

process.on('SIGTERM', async () => {
  console.info('SIGTERM received: closing Prisma client');
  try {
    await prisma.$disconnect();
  } finally {
    process.exit(0);
  }
});

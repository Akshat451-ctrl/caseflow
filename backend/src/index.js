import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';

// PrismaClient singleton
if (!globalThis.__prismaClient) {
  globalThis.__prismaClient = new PrismaClient();
}
export const prisma = globalThis.__prismaClient;

const app = express();

// === CORS FIX - IMPORTANT! ===
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://localhost:5173',  // Development frontend
      'https://caseflow-skyclaudr.vercel.app',  // Replace with your actual Vercel frontend URL
    ];
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,             
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

// Mount routers
import authRouter from './controllers/auth.js';
app.use('/api/auth', authRouter);

import casesRouter from './controllers/cases.js';
app.use('/api/cases', casesRouter);

import importLogsRouter from './controllers/importLogs.js';
app.use('/api/import-logs', importLogsRouter);

// Health endpoint
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    console.error('Health check DB error:', err);
    res.status(500).json({ status: 'error', db: 'unreachable', error: String(err) });
  }
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

// Start server
const PORT = process.env.PORT || 5000;

async function start() {
  try {
    await prisma.$connect();
    app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
      console.log(`Health check: https://caseflow-1-i13x.onrender.com/health`);
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
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.info('SIGTERM received: closing Prisma client');
  await prisma.$disconnect();
  process.exit(0);
});
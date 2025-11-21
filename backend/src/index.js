import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";

// Prisma Singleton
if (!globalThis.__prismaClient) {
  globalThis.__prismaClient = new PrismaClient();
}
export const prisma = globalThis.__prismaClient;

const app = express();

// ======================================
// Robust, production-ready CORS (uses 'cors' package)
// ======================================

const allowedOrigins = [
  'https://caseflow-1-i13x.onrender.com',
  // add any explicit production host(s) here
];

// safe check for localhost / 127.0.0.1 and Vercel preview domains
const isLocalOrVercel = (origin) => {
  if (!origin) return false;
  // origin can include protocol + host, e.g. "http://localhost:3000"
  try {
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
    if (/^https?:\/\/[A-Za-z0-9-]+\.vercel\.app$/.test(origin)) return true;
  } catch (e) {
    // defensive: never throw from origin checks
    return false;
  }
  return false;
};

const corsOptions = {
  origin: (origin, callback) => {
    // allow non-browser clients (no origin header)
    if (!origin) return callback(null, true);

    // explicit list match or localhost/vercel patterns
    if (allowedOrigins.includes(origin) || isLocalOrVercel(origin)) {
      // allow this origin
      return callback(null, true);
    }

    // do NOT throw an error here — caller will simply not get CORS headers
    // returning false prevents the cors middleware from setting CORS headers
    return callback(null, false);
  },
  credentials: true, // Access-Control-Allow-Credentials: true
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
};

// apply CORS to all routes
app.use(cors(corsOptions));

// handle preflight requests explicitly (valid route pattern)
// app.options('/*', cors(corsOptions));

// keep a simple origin log for debugging (does not affect behavior)
app.use((req, res, next) => {
  console.log('[CORS] incoming origin:', req.headers.origin);
  next();
});

// ======================================
// Body Parser
// ======================================
app.use(express.json());

// Log POST /api/auth/login bodies to help debug the 500
app.use((req, res, next) => {
  if (req.path === '/api/auth/login' && req.method === 'POST') {
    console.log('[LOGIN] incoming body:', req.body);
  }
  next();
});

// --- NEW: request logger for /api/auth to correlate requests with errors ---
app.use('/api/auth', (req, res, next) => {
  const requestId = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  req.requestId = requestId;
  console.log(`[REQ ${requestId}] ${req.method} ${req.originalUrl} - body:`, req.body || {});
  res.on('finish', () => {
    console.log(`[REQ ${requestId}] ${req.method} ${req.originalUrl} => ${res.statusCode}`);
  });
  next();
});
// --- end new ---

// ======================================
// Routes
// ======================================
import authRouter from "./controllers/auth.js";
app.use("/api/auth", authRouter);

import casesRouter from "./controllers/cases.js";
app.use("/api/cases", casesRouter);

import importLogsRouter from "./controllers/importLogs.js";
app.use("/api/import-logs", importLogsRouter);

// Health endpoint
app.get("/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", db: "connected" });
  } catch (err) {
    console.error("Health check DB error:", err);
    res
      .status(500)
      .json({ status: "error", db: "unreachable", error: String(err) });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not Found" });
});

// Error handler - improved logging and conditional stack in response
app.use((err, req, res, next) => {
  // ensure we have requestId if available
  const rid = req?.requestId ? ` [REQ ${req.requestId}]` : '';
  console.error(`${rid} [SERVER ERROR]`, err);
  const status = err.status || 500;
  const payload = {
    error: err.message || 'Internal Server Error'
  };
  // expose stack in non-production to speed debugging
  if (process.env.NODE_ENV !== 'production') {
    payload.stack = err.stack;
    // include any additional error details if present
    if (err?.meta) payload.meta = err.meta;
  }
  res.status(status).json(payload);
});

// Add global process-level error logging to capture uncaught/unhandled errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION] reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
  // note: in production you may want to exit process after logging
});

// ======================================
// Start Server
// ======================================
const PORT = process.env.PORT || 5000;

async function start() {
  try {
    await prisma.$connect();
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(
        `💚 Health: https://caseflow-1-i13x.onrender.com/health`
      );
    });
  } catch (err) {
    console.error("❌ Server failed:", err);
    process.exit(1);
  }
}

start();

// Graceful Shutdown
process.on("SIGINT", async () => {
  console.info("SIGINT received: closing Prisma client");
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.info("SIGTERM received: closing Prisma client");
  await prisma.$disconnect();
  process.exit(0);
});

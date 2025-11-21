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
// 🚀 FINAL CORS FIX (100% WORKING)
// ======================================
const allowedOrigins = [
  "http://localhost:5173",
  "https://caseflow-skyclaudr.vercel.app",
  "https://caseflow-1-i13x.onrender.com",
];

// Log every incoming origin
app.use((req, res, next) => {
  console.log("[CORS] Incoming Origin:", req.headers.origin);
  next();
});

// Main CORS Handling
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow postman/mobile where origin = undefined
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.warn("[CORS] BLOCKED Origin:", origin);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Preflight (OPTIONS) handler — handle via middleware to avoid route parsing
app.use((req, res, next) => {
  if (req.method !== 'OPTIONS') return next();

  const origin = req.headers.origin;

  if (!origin || allowedOrigins.includes(origin)) {
    // If no origin (non-browser clients) allow. If origin is allowed, echo it.
    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.sendStatus(204);
  }

  console.warn('[CORS] BLOCKED Preflight:', origin);
  return res.status(403).send('Not allowed by CORS');
});

// ======================================
// Body Parser
// ======================================
app.use(express.json());

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

// Error handler
app.use((err, req, res, next) => {
  console.error("[SERVER ERROR]", err);
  res.status(err.status || 500).json({ error: err.message });
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

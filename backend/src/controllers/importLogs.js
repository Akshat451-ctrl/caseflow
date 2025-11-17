import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../index.js';

const router = Router();

// Simple auth middleware (same logic as in cases)
const authMiddleware = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = auth.split(' ')[1];
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT secret not configured');
    const payload = jwt.verify(token, secret);
    req.user = payload; // { userId, role }
    return next();
  } catch (err) {
    console.error('Auth error:', err);
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// GET /api/import-logs/:id
// Returns the import log and any failed rows (cases with errorMessage) that share the same importedAt timestamp
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const log = await prisma.importLog.findUnique({ where: { id } });
    if (!log) return res.status(404).json({ error: 'ImportLog not found' });

    // Find failed cases with the same importedAt timestamp and errorMessage not null
    const failedRows = await prisma.case.findMany({
      where: {
        importedAt: log.createdAt,
        errorMessage: { not: null },
      },
      orderBy: { importedAt: 'asc' },
    });

    return res.json({ importLog: log, failedRows });
  } catch (err) {
    console.error('Failed to fetch import log:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

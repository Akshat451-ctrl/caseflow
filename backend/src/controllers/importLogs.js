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

// GET /api/import-logs
// Returns import logs visible to requester (owner) — ADMIN sees all
router.get('/', authMiddleware, async (req, res) => {
  try {
    // Resolve requester id and role
    const requesterId = String(req.user?.userId ?? req.user?.id ?? '');
    const requesterRole = String(req.user?.role ?? '').toUpperCase();

    // Owners see their logs; ADMIN sees all
    const where = {};
    if (requesterRole !== 'ADMIN') {
      where.userId = requesterId;
    }

    const logs = await prisma.importLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, email: true } } },
    });
    return res.json({ importLogs: logs });
  } catch (err) {
    console.error('Failed to fetch import logs:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/import-logs/:id
// Returns the import log and any failed rows (cases with errorMessage) that share the same importedAt timestamp
// Access: only owner or ADMIN can view this report
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const log = await prisma.importLog.findUnique({ where: { id }, include: { user: { select: { id: true, email: true } } } });
    if (!log) return res.status(404).json({ error: 'ImportLog not found' });

    // Allow access only to owner or ADMIN
    const requesterId = String(req.user?.userId ?? req.user?.id ?? '');
    const requesterRole = String(req.user?.role ?? '').toUpperCase();
    if (requesterRole !== 'ADMIN' && requesterId !== String(log.userId)) {
      return res.status(403).json({ error: 'Forbidden', message: 'Only the import owner or an ADMIN can view this report' });
    }

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

// --- UPDATED: delete an import log and its failed rows (notes -> cases -> importLog) ---
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const log = await prisma.importLog.findUnique({ where: { id } });
    if (!log) return res.status(404).json({ error: 'ImportLog not found' });

    // Resolve requester id from token payload (support userId or id)
    const rawRequesterId = req.user?.userId ?? req.user?.id;
    const requesterId = rawRequesterId ? String(rawRequesterId) : null;
    const requesterRole = String(req.user?.role || '').toUpperCase();

    // Debug: log requester vs owner
    console.log(`[IMPORT-DELETE] requester=${requesterId} role=${requesterRole} log.userId=${String(log.userId)}`);

    // only allow owner or ADMIN to delete (compare as strings)
    if (!requesterId || (String(requesterId) !== String(log.userId) && requesterRole !== 'ADMIN')) {
      // give a clearer message for clients to show
      console.warn('[IMPORT-DELETE] Forbidden: requester does not own this import and is not ADMIN', { requesterId, requesterRole, owner: log.userId });
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only the user who created this import or an ADMIN can delete it.',
        requesterId,
        ownerId: String(log.userId)
      });
    }

    // Use a safe time window around the import log timestamp to find failed rows.
    // This avoids issues where timestamps may differ by a few milliseconds or DB precision.
    const createdAt = log.createdAt ? new Date(log.createdAt) : null;
    const timeWindowMs = 5000; // 5 seconds tolerance
    let failedCaseIds = [];

    if (createdAt && !isNaN(createdAt.getTime())) {
      const start = new Date(createdAt.getTime() - timeWindowMs);
      const end = new Date(createdAt.getTime() + timeWindowMs);

      const failedCases = await prisma.case.findMany({
        where: {
          AND: [
            { importedAt: { gte: start, lte: end } },
            {
              OR: [
                { errorMessage: { not: null } },
                { status: 'FAILED' }
              ]
            }
          ]
        },
        select: { id: true },
      });
      failedCaseIds = failedCases.map((c) => c.id);
    } else {
      // Fallback: if log.createdAt missing/unparseable, find by userId + FAILED status + recent rows
      const fallbackCases = await prisma.case.findMany({
        where: {
          importedById: log.userId,
          status: 'FAILED'
        },
        orderBy: { importedAt: 'desc' },
        take: 1000,
        select: { id: true },
      });
      failedCaseIds = fallbackCases.map((c) => c.id);
    }

    // Transaction: delete notes referencing the failed cases, delete failed cases, delete importLog
    await prisma.$transaction(async (tx) => {
      if (failedCaseIds.length > 0) {
        await tx.note.deleteMany({ where: { caseId: { in: failedCaseIds } } });
        await tx.case.deleteMany({ where: { id: { in: failedCaseIds } } });
      }
      await tx.importLog.delete({ where: { id } });
    });

    console.log(`ImportLog ${id} deleted by ${requesterId || 'unknown'}; removed ${failedCaseIds.length} failed cases.`);
    return res.json({ ok: true, deletedCases: failedCaseIds.length, deletedImportLogId: id });
  } catch (err) {
    console.error('Failed to delete import log:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
// --- end updated ---

export default router;

import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../index.js';

const router = Router();

// Auth middleware
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

// Zod schema for a single case row
const caseSchema = z.object({
  case_id: z.string(),
  applicant_name: z.string().optional().nullable(),
  dob: z.string().optional().nullable(), // expect ISO date string or empty
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  priority: z.preprocess((v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isNaN(n) ? v : n;
  }, z.number().int().optional().nullable()),
  status: z.string().optional().nullable(),
});

// Helper to chunk an array
function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

// POST /api/cases/batch
// Body: either an array of cases or { cases: [...] }
router.post('/batch', authMiddleware, async (req, res) => {
  try {
    const raw = Array.isArray(req.body) ? req.body : req.body.cases;
    if (!Array.isArray(raw)) return res.status(400).json({ error: 'Expected an array of cases or { cases: [...] }' });

    const totalRows = raw.length;
    let successCount = 0;
    let failCount = 0;
    const errors = [];

    const chunks = chunkArray(raw, 100);

    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];

      // Process each row sequentially within the chunk to capture per-row errors.
      for (let i = 0; i < chunk.length; i++) {
        const rowIndex = ci * 100 + i;
        const row = chunk[i];

        // Validate with Zod
        const parsed = caseSchema.safeParse(row);
        if (!parsed.success) {
          failCount++;
          errors.push({ index: rowIndex, case_id: row?.case_id ?? null, error: parsed.error.errors.map(e => e.message).join('; ') });
          continue;
        }

        const data = parsed.data;

        // Parse dob to Date if provided
        let dob = null;
        if (data.dob) {
          const d = new Date(data.dob);
          if (!isNaN(d.getTime())) dob = d;
        }

        try {
          await prisma.case.create({
            data: {
              case_id: data.case_id,
              applicant_name: data.applicant_name ?? null,
              dob: dob,
              email: data.email ?? null,
              phone: data.phone ?? null,
              category: data.category ?? null,
              priority: data.priority ?? null,
              status: data.status ?? undefined, // allow DB default if undefined
              importedById: req.user?.userId ?? null,
              importedAt: new Date(),
            },
          });
          successCount++;
        } catch (err) {
          failCount++;
          // capture constraint and other errors
          const message = err?.message ?? String(err);
          errors.push({ index: rowIndex, case_id: data.case_id, error: message });
        }
      }
    }

    // Create ImportLog
    try {
      await prisma.importLog.create({
        data: {
          userId: req.user?.userId ?? 'unknown',
          totalRows,
          successCount,
          failCount,
        },
      });
    } catch (err) {
      console.error('Failed to create ImportLog:', err);
      // don't fail the whole request; just warn
    }

    return res.json({ totalRows, successCount, failCount, errors });
  } catch (err) {
    console.error('Batch import error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

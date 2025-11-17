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

    // Use a single timestamp for this import to link failed Case rows to the ImportLog
    const importTimestamp = new Date();

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
          const msg = parsed.error.errors.map(e => e.message).join('; ');
          errors.push({ index: rowIndex, case_id: row?.case_id ?? null, error: msg });

          // Persist failed row as a Case with errorMessage for reporting
          try {
            const fallbackId = `FAILED-${importTimestamp.getTime()}-${ci}-${i}`;
            const createData = {
              case_id: row?.case_id ?? fallbackId,
              applicant_name: row?.applicant_name ?? null,
              dob: row?.dob ? new Date(row.dob) : null,
              email: row?.email ?? null,
              phone: row?.phone ?? null,
              category: row?.category ?? null,
              priority: row?.priority ?? null,
              status: 'FAILED',
              importedById: req.user?.userId ?? null,
              importedAt: importTimestamp,
              errorMessage: msg,
            };
            try {
              await prisma.case.create({ data: createData });
            } catch (createErr) {
              // if case_id unique constraint or other DB errors, retry with fallback id
              createData.case_id = `${fallbackId}-${Math.random().toString(36).slice(2, 8)}`;
              await prisma.case.create({ data: createData });
            }
          } catch (persistErr) {
            console.error('Failed to persist failed case row:', persistErr);
          }

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
              importedAt: importTimestamp,
            },
          });
          successCount++;
        } catch (err) {
          failCount++;
          // capture constraint and other errors
          const message = err?.message ?? String(err);
          errors.push({ index: rowIndex, case_id: data.case_id, error: message });

          // Persist as failed Case with errorMessage
          try {
            const fallbackId = `FAILED-${importTimestamp.getTime()}-${ci}-${i}`;
            const createData = {
              case_id: data.case_id ?? fallbackId,
              applicant_name: data.applicant_name ?? null,
              dob: dob,
              email: data.email ?? null,
              phone: data.phone ?? null,
              category: data.category ?? null,
              priority: data.priority ?? null,
              status: 'FAILED',
              importedById: req.user?.userId ?? null,
              importedAt: importTimestamp,
              errorMessage: message,
            };
            try {
              await prisma.case.create({ data: createData });
            } catch (createErr) {
              createData.case_id = `${fallbackId}-${Math.random().toString(36).slice(2, 8)}`;
              await prisma.case.create({ data: createData });
            }
          } catch (persistErr) {
            console.error('Failed to persist failed case row after DB error:', persistErr);
          }
        }
      }
    }

    // Create ImportLog with explicit createdAt = importTimestamp so we can link failed Case rows
    let importLog;
    try {
      importLog = await prisma.importLog.create({
        data: {
          userId: req.user?.userId ?? 'unknown',
          totalRows,
          successCount,
          failCount,
          createdAt: importTimestamp,
        },
      });
    } catch (err) {
      console.error('Failed to create ImportLog:', err);
      // don't fail the whole request; just warn
    }

    return res.json({ totalRows, successCount, failCount, errors, importLogId: importLog?.id });
  } catch (err) {
    console.error('Batch import error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/cases
// Query params:
// - limit (number, default 25, max 100)
// - cursor (id string)
// - status, category, priority
// - dateFrom, dateTo (ISO date strings, filter importedAt)
// - search (matches case_id or applicant_name, case-insensitive)
// - sortDir (asc|desc) default desc on importedAt
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { limit: limitRaw, cursor, status, category, priority, dateFrom, dateTo, search, sortDir } = req.query;

    const limit = Math.min(Number(limitRaw) || 25, 100);
    const take = limit + 1; // fetch one extra to detect nextCursor
    const dir = sortDir && String(sortDir).toLowerCase() === 'asc' ? 'asc' : 'desc';

    const where = {};
    if (status) where.status = String(status);
    if (category) where.category = String(category);
    if (priority !== undefined && priority !== null && priority !== '') {
      const p = Number(priority);
      if (!Number.isNaN(p)) where.priority = p;
    }

    if (dateFrom || dateTo) {
      where.importedAt = {};
      if (dateFrom) {
        const d = new Date(String(dateFrom));
        if (!isNaN(d.getTime())) where.importedAt.gte = d;
      }
      if (dateTo) {
        const d = new Date(String(dateTo));
        if (!isNaN(d.getTime())) where.importedAt.lte = d;
      }
    }

    if (search) {
      const s = String(search);
      where.OR = [
        { case_id: { contains: s, mode: 'insensitive' } },
        { applicant_name: { contains: s, mode: 'insensitive' } },
      ];
    }

    const findOptions = {
      where,
      orderBy: [
        { importedAt: dir },
        { id: dir },
      ],
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: String(cursor) } : undefined,
    };

    const items = await prisma.case.findMany(findOptions);

    let nextCursor = null;
    if (items.length > limit) {
      const nextItem = items[items.length - 1];
      nextCursor = nextItem.id;
      items.pop(); // remove the extra item
    }

  return res.json({ items: items, nextCursor, limit });
  } catch (err) {
    console.error('GET /api/cases error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/cases/:caseId -> case detail including notes and import metadata
router.get('/:caseId', authMiddleware, async (req, res) => {
  try {
    const { caseId } = req.params;
    if (!caseId) return res.status(400).json({ error: 'Missing caseId' });

    const caseItem = await prisma.case.findUnique({
      where: { id: String(caseId) },
      include: {
        importedBy: { select: { id: true, email: true } },
        notes: { include: { author: { select: { id: true, email: true } } }, orderBy: { createdAt: 'desc' } },
      },
    });

    if (!caseItem) return res.status(404).json({ error: 'Case not found' });

    // Try to find the ImportLog that matches the importedAt timestamp and user
    let importLog = null;
    try {
      if (caseItem.importedAt) {
        importLog = await prisma.importLog.findFirst({ where: { createdAt: caseItem.importedAt, userId: caseItem.importedById } });
      }
    } catch (e) {
      // ignore
    }

    // Build a simple timeline: imported event + status snapshot + notes as events
    const timeline = [];
    if (caseItem.importedAt) {
      timeline.push({ type: 'imported', date: caseItem.importedAt, by: caseItem.importedBy ? { id: caseItem.importedBy.id, email: caseItem.importedBy.email } : null });
    }
    timeline.push({ type: 'status', date: caseItem.importedAt ?? null, status: caseItem.status });

    // notes are already included; map them into timeline entries
    if (caseItem.notes && caseItem.notes.length) {
      for (const n of caseItem.notes) {
        timeline.push({ type: 'note', date: n.createdAt, author: n.author ? { id: n.author.id, email: n.author.email } : null, content: n.content, noteId: n.id });
      }
    }

    // sort timeline by date desc (nulls last)
    timeline.sort((a, b) => {
      const ad = a.date ? new Date(a.date).getTime() : 0;
      const bd = b.date ? new Date(b.date).getTime() : 0;
      return bd - ad;
    });

    return res.json({ case: caseItem, importLogId: importLog?.id ?? null, timeline, notes: caseItem.notes || [] });
  } catch (err) {
    console.error('GET /api/cases/:caseId error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cases/:caseId/notes -> add a note to a case
router.post('/:caseId/notes', authMiddleware, async (req, res) => {
  try {
    const { caseId } = req.params;
    const body = req.body || {};
    const noteSchema = z.object({ content: z.string().min(1).max(2000) });
    const parsed = noteSchema.safeParse(body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid note content' });

    // Ensure case exists
    const c = await prisma.case.findUnique({ where: { id: String(caseId) } });
    if (!c) return res.status(404).json({ error: 'Case not found' });

    const created = await prisma.note.create({
      data: {
        caseId: String(caseId),
        content: parsed.data.content,
        authorId: req.user?.userId ?? null,
      },
      include: { author: { select: { id: true, email: true } } },
    });

    return res.status(201).json({ note: created });
  } catch (err) {
    console.error('POST /api/cases/:caseId/notes error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;


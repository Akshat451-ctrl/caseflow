import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../index.js';

const router = Router();

// helper: coerce priority values to int or null
function parsePriorityValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isNaN(v) ? null : v;
  const s = String(v).trim();
  if (s === '') return null;
  // numeric string
  if (!Number.isNaN(Number(s))) return Number(s);
  // map common labels to numbers (configurable mapping if needed)
  const up = s.toUpperCase();
  if (up === 'HIGH') return 3;
  if (up === 'MEDIUM') return 2;
  if (up === 'LOW') return 1;
  return null;
}

function safeDateFrom(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}


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

    // Sort rows by business case_id ascending before processing.
    // Use localeCompare with numeric option so mixed numeric ids sort naturally (e.g. "C2" < "C10").
    // Coerce missing case_id to empty string so they sort first.
    const rows = raw.slice().sort((a, b) => {
      const aId = String(a?.case_id ?? '');
      const bId = String(b?.case_id ?? '');
      return aId.localeCompare(bId, undefined, { numeric: true, sensitivity: 'base' });
    });

    // From this point use `rows` instead of `raw` for duplicate detection and processing.
    const totalRows = rows.length;
    let successCount = 0;
    let failCount = 0;
    const errors = [];

    // Precompute last occurrence index per case_id so we use the last row on duplicates
    const lastIndexForCase = {};
    rows.forEach((r, idx) => {
      const cid = r?.case_id;
      if (cid) lastIndexForCase[String(cid)] = idx;
    });

    // Track duplicates: case_id => number of earlier occurrences skipped
    const duplicatesMap = {};

    const chunks = chunkArray(rows, 100);

    // Use a single timestamp for this import to link failed Case rows to the ImportLog
    const importTimestamp = new Date();

    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];

      // Process each row sequentially within the chunk to capture per-row errors.
      for (let i = 0; i < chunk.length; i++) {
        const rowIndex = ci * 100 + i;
        const row = chunk[i];

        const caseIdValue = row?.case_id ? String(row.case_id) : undefined;

        // If this case_id appears later in the file, skip this earlier occurrence and warn (non-fatal)
        if (caseIdValue && lastIndexForCase[caseIdValue] !== rowIndex) {
          errors.push({ index: rowIndex, case_id: caseIdValue, error: 'Duplicate case_id in file — later row will be used' });
          // increment duplicates map so we can persist an audit note later
          duplicatesMap[caseIdValue] = (duplicatesMap[caseIdValue] || 0) + 1;
          // do not count as fail; continue to next row
          continue;
        }

        // Validate with Zod
        const parsed = caseSchema.safeParse(row);
        if (!parsed.success) {
          failCount++;
          // defensive: parsed.error.errors should be an array, but guard against unexpected shapes
          let msg;
          if (parsed && parsed.error && Array.isArray(parsed.error.errors)) {
            msg = parsed.error.errors.map((e) => e.message).join('; ');
          } else if (parsed && parsed.error) {
            msg = String(parsed.error);
          } else {
            msg = 'Validation failed';
          }
          errors.push({ index: rowIndex, case_id: row?.case_id ?? null, error: msg });

          // Persist failed row as a Case with fallback FAILED id (do NOT use original case_id)
          try {
            const fallbackId = `FAILED-${importTimestamp.getTime()}-${ci}-${i}`;
            const originalCaseId = row?.case_id ? String(row.case_id) : null;
            const createData = {
              // use fallback id so we don't overwrite the business case_id
              case_id: fallbackId,
              applicant_name: row?.applicant_name ? String(row.applicant_name).trim() : null,
              dob: safeDateFrom(row?.dob),
              email: row?.email ? String(row.email).trim() : null,
              phone: row?.phone ? String(row.phone).trim() : null,
              category: row?.category ? String(row.category).trim() : null,
              priority: parsePriorityValue(row?.priority),
              status: 'FAILED',
              importedById: req.user?.userId ?? null,
              importedAt: importTimestamp,
              // include original case_id for traceability
              errorMessage: `Original case_id: ${originalCaseId ?? '<none>'} — ${msg}`,
            };
            try {
              await prisma.case.create({ data: createData });
            } catch (createErr) {
              // if fallback somehow conflicts, append random suffix and retry
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

        // Use upsert so existing case_id rows are updated (prevents unique constraint errors)
        try {
          await prisma.case.upsert({
            where: { case_id: data.case_id },
            update: {
              applicant_name: data.applicant_name ?? null,
              dob: dob,
              email: data.email ?? null,
              phone: data.phone ?? null,
              category: data.category ?? null,
              priority: data.priority ?? null,
              // mark re-imported/updated rows as successful so previous FAILED states are cleared
              status: data.status ?? 'COMPLETED',
              importedById: req.user?.userId ?? null,
              importedAt: importTimestamp,
              errorMessage: null,
            },
            create: {
              case_id: data.case_id,
              applicant_name: data.applicant_name ?? null,
              dob: dob,
              email: data.email ?? null,
              phone: data.phone ?? null,
              category: data.category ?? null,
              priority: data.priority ?? null,
              // new records from a successful import should be marked as COMPLETED
              status: data.status ?? 'COMPLETED',
              importedById: req.user?.userId ?? null,
              importedAt: importTimestamp,
            },
          });
          successCount++;
        } catch (err) {
          // on unexpected DB error, record and persist as FAILED row (fallback)
          failCount++;
          const message = err?.message ?? String(err);
          errors.push({ index: rowIndex, case_id: data.case_id, error: message });

          try {
            const fallbackId = `FAILED-${importTimestamp.getTime()}-${ci}-${i}`;
            const createData = {
              // always use fallback id for failed persistence
              case_id: fallbackId,
              applicant_name: data.applicant_name ? String(data.applicant_name).trim() : null,
              dob: safeDateFrom(data.dob),
              email: data.email ? String(data.email).trim() : null,
              phone: data.phone ? String(data.phone).trim() : null,
              category: data.category ? String(data.category).trim() : null,
              priority: parsePriorityValue(data.priority),
              status: 'FAILED',
              importedById: req.user?.userId ?? null,
              importedAt: importTimestamp,
              // include original case_id for debugging
              errorMessage: `Original case_id: ${data.case_id ?? '<none>'} — ${message}`,
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

    // After processing rows, persist a Note on each case that had duplicates so UI can surface it.
    // We create a short human-friendly note like: "Duplicate rows in import: N earlier occurrence(s) ignored"
    try {
      const dupCaseIds = Object.keys(duplicatesMap);
      for (const cid of dupCaseIds) {
        // find the canonical case (the upserted final row should exist)
        const theCase = await prisma.case.findUnique({ where: { case_id: cid }, select: { id: true } });
        if (theCase) {
          const noteContent = `Duplicate rows in import: ${duplicatesMap[cid]} earlier occurrence(s) ignored`;
          await prisma.note.create({
            data: {
              caseId: theCase.id,
              content: noteContent,
              authorId: req.user?.userId ?? null,
            },
          });
        }
      }
    } catch (noteErr) {
      console.error('Failed to persist duplicate notes:', noteErr);
    }

    // Create ImportLog with explicit createdAt = importTimestamp so we can link failed Case rows
    let importLog;
    try {
      // only create importLog if we have a valid authenticated user id to satisfy FK
      if (req.user && req.user.userId) {
        importLog = await prisma.importLog.create({
          data: {
            userId: req.user.userId,
            totalRows,
            successCount,
            failCount,
            createdAt: importTimestamp,
          },
        });
      } else {
        console.warn('Skipping ImportLog creation: no authenticated user id available');
      }
    } catch (err) {
      console.error('Failed to create ImportLog:', err);
      // don't fail the whole request; just warn
    }

    return res.json({ totalRows, successCount, failCount, errors, importLogId: importLog?.id });
  } catch (err) {
    console.error('Batch import error:', err);
    // include message to help debugging in dev
    return res.status(500).json({ error: 'Internal server error', message: err?.message ?? String(err) });
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

    // Build where clause progressively.
    // IMPORTANT: restrict results to the importer for non-admin users.
    const where = {};
    const requesterId = String(req.user?.userId ?? req.user?.id ?? '');
    const requesterRole = String(req.user?.role ?? '').toUpperCase();
    if (requesterRole !== 'ADMIN') {
      // Only show cases imported by the current user
      where.importedById = requesterId;
    }

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

    // Determine if caseId is a UUID (dashed or simple 32-hex)
    const isUuid = typeof caseId === 'string' && /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$/i.test(caseId);

    let caseItem = null;

    if (isUuid) {
      // Safe to query primary id as UUID
      caseItem = await prisma.case.findUnique({
        where: { id: String(caseId) },
        include: {
          importedBy: { select: { id: true, email: true } },
          notes: { include: { author: { select: { id: true, email: true } } }, orderBy: { createdAt: 'desc' } },
        },
      });
    }

    if (!caseItem) {
      // Fallback: search by business case_id (safe for non-UUID identifiers)
      caseItem = await prisma.case.findUnique({
        where: { case_id: String(caseId) },
        include: {
          importedBy: { select: { id: true, email: true } },
          notes: { include: { author: { select: { id: true, email: true } } }, orderBy: { createdAt: 'desc' } },
        },
      });
    }

    if (!caseItem) return res.status(404).json({ error: 'Case not found' });

    // Access control: non-admins can only view cases they imported
    const requesterId = String(req.user?.userId ?? req.user?.id ?? '');
    const requesterRole = String(req.user?.role ?? '').toUpperCase();
    if (requesterRole !== 'ADMIN' && String(caseItem.importedById) !== requesterId) {
      return res.status(403).json({ error: 'Forbidden', message: 'You can only view cases you imported' });
    }

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

// PUT /api/cases/:caseId -> partial update by business case_id or by primary id if UUID
// Body: { applicant_name?, dob?, email?, phone?, category?, priority?, status? }
router.put('/:caseId', authMiddleware, async (req, res) => {
  try {
    const { caseId } = req.params;
    if (!caseId) return res.status(400).json({ error: 'Missing caseId' });

    // determine lookup mode (UUID primary id or business case_id)
    const isUuid = typeof caseId === 'string' && /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$/i.test(caseId);
    const payload = req.body || {};

    // find existing case
    let existing = null;
    if (isUuid) {
      existing = await prisma.case.findUnique({ where: { id: String(caseId) } });
    }
    if (!existing) {
      existing = await prisma.case.findUnique({ where: { case_id: String(caseId) } });
    }
    if (!existing) return res.status(404).json({ error: 'Case not found' });

    // permission: only importer or ADMIN can update
    const requesterId = String(req.user?.userId ?? req.user?.id ?? '');
    const requesterRole = String(req.user?.role ?? '').toUpperCase();
    if (requesterRole !== 'ADMIN' && String(existing.importedById) !== requesterId) {
      return res.status(403).json({ error: 'Forbidden', message: 'Only the importer or an ADMIN can edit this case' });
    }

    // Build update payload defensively
    const updateData = {};
    if (payload.applicant_name !== undefined) updateData.applicant_name = payload.applicant_name ?? null;
    if (payload.email !== undefined) updateData.email = payload.email ?? null;
    if (payload.phone !== undefined) updateData.phone = payload.phone ?? null;
    if (payload.category !== undefined) updateData.category = payload.category ?? null;
    if (payload.status !== undefined) updateData.status = payload.status ?? null;
    if (payload.dob !== undefined) updateData.dob = safeDateFrom(payload.dob);
    if (payload.priority !== undefined) {
      // coerce/parse priority using existing helper
      updateData.priority = parsePriorityValue(payload.priority);
    }

    // perform update using primary id to be safe
    const updated = await prisma.case.update({
      where: { id: existing.id },
      data: {
        ...updateData,
        // mark who made this update (keep importedById as original importer)
        // optionally you could track lastModifiedById, but keep current schema unchanged
      },
    });

    return res.json({ case: updated });
  } catch (err) {
    console.error('PUT /api/cases/:caseId error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;


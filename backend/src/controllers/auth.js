import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../index.js';
import axios from 'axios';
import nodemailer from 'nodemailer';

const router = Router();

// Zod schemas
const registerSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string(),
});

const magicSchema = z.object({ email: z.string().email('Invalid email') });

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password } = registerSchema.parse(req.body);
    //return res.status(200).json({email: email, password: password});
    // Check if user exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }
    //return res.status(200).json({status: 'ok'});
    // Hash password (defensive: coerce to string and catch errors)
    let passwordHash;
    try {
      const pwd = String(password);
      passwordHash = await bcrypt.hash(pwd, 10);
    } catch (hashErr) {
      console.error('bcrypt.hash error (register):', hashErr);
      return res.status(500).json({ error: 'Failed to process password' });
    }

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: 'OPERATOR',
      },
      select: { id: true, email: true, role: true },
    });

    // Generate JWT
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error('JWT_SECRET not set in environment');
      return res.status(500).json({ error: 'Authentication not configured' });
    }

    const authExpires = process.env.JWT_EXPIRES || '1h';
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      jwtSecret,
      { expiresIn: authExpires }
    );

    res.status(201).json({ token, user });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Register error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const requestId = req.requestId || `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  try {
    console.log(`[AUTH][${requestId}] START /api/auth/login`);

    // Validate input using existing loginSchema
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      console.warn(`[AUTH][${requestId}] Validation failed:`, parsed.error?.errors);
      return res.status(400).json({ error: parsed.error.errors[0].message, requestId });
    }
    const { email, password } = parsed.data;
    console.log(`[AUTH][${requestId}] Payload validated for email=${email}`);

    // Quick DB ping to detect connectivity problems early
    try {
      await prisma.$queryRaw`SELECT 1`;
      console.log(`[AUTH][${requestId}] DB ping OK`);
    } catch (dbErr) {
      console.error(`[AUTH][${requestId}] DB ping failed:`, dbErr);
      return res.status(500).json({ error: 'Database unreachable', requestId, details: String(dbErr?.message || dbErr) });
    }

    // Fetch user (select only required fields)
    console.log(`[AUTH][${requestId}] Prisma: findUnique user where email="${email}"`);
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true, role: true }
    });

    if (!user) {
      console.warn(`[AUTH][${requestId}] User not found for email=${email}`);
      return res.status(401).json({ error: 'Invalid email or password', requestId });
    }
    console.log(`[AUTH][${requestId}] Prisma returned user id=${user.id} (passwordHash present? ${!!user.passwordHash})`);

    if (!user.passwordHash) {
      console.error(`[AUTH][${requestId}] Missing passwordHash for user id=${user.id}`);
      return res.status(500).json({ error: 'Account misconfigured', requestId });
    }

    // Compare password
    console.log(`[AUTH][${requestId}] bcrypt.compare start`);
    // Defensive compare: coerce both values to string before comparing
    let passwordMatch = false;
    try {
      const plain = String(password);
      const hash = String(user.passwordHash);
      passwordMatch = await bcrypt.compare(plain, hash);
    } catch (bcryptErr) {
      console.error(`[AUTH][${requestId}] bcrypt.compare error:`, bcryptErr);
      return res.status(500).json({ error: 'Internal server error', requestId, details: 'Password verification failed' });
    }
    console.log(`[AUTH][${requestId}] bcrypt.compare result: ${passwordMatch}`);

    if (!passwordMatch) {
      console.warn(`[AUTH][${requestId}] Invalid credentials for user id=${user.id}`);
      return res.status(401).json({ error: 'Invalid email or password', requestId });
    }

    // Issue JWT
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) console.warn(`[AUTH][${requestId}] JWT_SECRET not set - using development fallback`);
    let token;
    try {
      token = jwt.sign({ userId: user.id, role: user.role }, jwtSecret || 'dev_secret', { expiresIn: process.env.JWT_EXPIRES || '7d' });
    } catch (jwtErr) {
      console.error(`[AUTH][${requestId}] jwt.sign error:`, jwtErr);
      return res.status(500).json({ error: 'Internal server error', requestId, details: 'Token generation failed' });
    }
    console.log(`[AUTH][${requestId}] Issued JWT for user id=${user.id}`);

    // Success: return minimal user + token
    return res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role },
      requestId
    });
  } catch (err) {
    // Log full error server-side
    console.error(`[AUTH][${requestId}] UNEXPECTED ERROR during /login:`, err);

    // Build debug-friendly payload. In production you may want to hide stack.
    const payload = {
      error: 'Internal server error',
      requestId,
      // include message + stack to surface useful debugging info to the frontend.
      // Remove or restrict this in production.
      message: err?.message,
      stack: process.env.NODE_ENV === 'production' ? undefined : err?.stack,
    };

    // send the structured payload (do not call next(err) so response reaches client with requestId)
    return res.status(500).json(payload);
  }
});

// POST /api/auth/magic-login
// Body: { email }
router.post('/magic-login', async (req, res) => {
  try {
    const { email } = magicSchema.parse(req.body);

    // ensure user exists (create a lightweight account if missing)
    let user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, role: true } });
    if (!user) {
      // create a user with random passwordHash (not used)
      const randomPass = Math.random().toString(36).slice(2, 12);
      let passwordHash;
      try {
        passwordHash = await bcrypt.hash(String(randomPass), 10);
      } catch (hashErr) {
        console.error('bcrypt.hash error (magic-login create):', hashErr);
        return res.status(500).json({ error: 'Failed to create user' });
      }
      user = await prisma.user.create({ data: { email, passwordHash, role: 'OPERATOR' }, select: { id: true, email: true, role: true } });
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) return res.status(500).json({ error: 'JWT not configured' });

    // magic token short lived
  const magicExpires = process.env.MAGIC_TOKEN_EXPIRES || '15m';
  const magicToken = jwt.sign({ email, type: 'magic_login' }, jwtSecret, { expiresIn: magicExpires });

    // build link
    const frontend = process.env.FRONTEND_URL || 'http://localhost:3000';
    const link = `${frontend}/login?magic=${encodeURIComponent(magicToken)}`;

    // send email via Resend (if RESEND_API_KEY) or SMTP fallback
    const fromEmail = process.env.FROM_EMAIL || `no-reply@${new URL(frontend).hostname}`;

    const subject = 'Your magic sign-in link for CaseFlow';
    const html = `<p>Click the link below to sign in to CaseFlow (valid for 15 minutes):</p><p><a href="${link}">Sign in to CaseFlow</a></p>`;

    try {
      if (process.env.RESEND_API_KEY) {
        // use Resend API
        await axios.post('https://api.resend.com/emails', {
          from: fromEmail,
          to: [email],
          subject,
          html,
        }, {
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }
        });
      } else if (process.env.SMTP_HOST) {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT) || 587,
          secure: process.env.SMTP_SECURE === 'true',
          auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
        });
        await transporter.sendMail({ from: fromEmail, to: email, subject, html });
      } else {
        console.warn('No email provider configured: set RESEND_API_KEY or SMTP_* env vars');
        // For dev, log the link to stdout so developer can copy it
        console.log('Magic link for', email, link);
      }
    } catch (sendErr) {
      console.error('Failed to send magic link email:', sendErr);
      return res.status(500).json({ error: 'Failed to send email' });
    }

    return res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    console.error('magic-login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST or GET /api/auth/verify-magic
router.post('/verify-magic', async (req, res) => {
  try {
    const token = req.body?.token || req.query?.token;
    if (!token) return res.status(400).json({ error: 'Missing token' });

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) return res.status(500).json({ error: 'JWT not configured' });

    let payload;
    try {
      payload = jwt.verify(token, jwtSecret);
    } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    if (!payload || payload.type !== 'magic_login' || !payload.email) return res.status(400).json({ error: 'Invalid token payload' });

    const email = payload.email;

    // find or create user
    let user = await prisma.user.findUnique({ where: { email }, select: { id: true, email, role: true } });
    if (!user) {
      const randomPass = Math.random().toString(36).slice(2, 12);
      let passwordHash;
      try {
        passwordHash = await bcrypt.hash(String(randomPass), 10);
      } catch (hashErr) {
        console.error('bcrypt.hash error (verify-magic create):', hashErr);
        return res.status(500).json({ error: 'Failed to create user' });
      }
      user = await prisma.user.create({ data: { email, passwordHash, role: 'OPERATOR' }, select: { id: true, email: true, role: true } });
    }

  // Issue regular auth JWT (configurable via JWT_EXPIRES env var)
  const authExpires = process.env.JWT_EXPIRES || '1h';
  const authToken = jwt.sign({ userId: user.id, role: user.role }, jwtSecret, { expiresIn: authExpires });

    res.json({ token: authToken, user });
  } catch (err) {
    console.error('verify-magic error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

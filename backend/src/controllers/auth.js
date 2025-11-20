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

    // Check if user exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

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
  try {
    const { email, password } = loginSchema.parse(req.body);

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, role: true, passwordHash: true },
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Compare password
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

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

    // Remove passwordHash from response
    const { passwordHash, ...userWithoutPassword } = user;

    res.json({ token, user: userWithoutPassword });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
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
      const passwordHash = await bcrypt.hash(randomPass, 10);
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
    let user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, role: true } });
    if (!user) {
      const randomPass = Math.random().toString(36).slice(2, 12);
      const passwordHash = await bcrypt.hash(randomPass, 10);
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

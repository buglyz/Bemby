import { Router } from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import svgCaptcha from 'svg-captcha';
import { db } from '../db/database';
import { getJwtSecret, requireAuth } from '../middleware/auth';
import {
  legacyHashPassword,
  hashPassword,
  isArgon2Hash,
  verifyPassword,
  timingSafeCompare as credTimingSafeCompare,
  getStoredCredentials as getStoredCreds,
} from '../auth/credentials';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});

const router = Router();

// Hash at module load so the env var is never compared as plaintext during a request
const ADMIN_PASSWORD_HASH_FALLBACK: string | null = (() => {
  const p = process.env.ADMIN_PASSWORD;
  return p ? legacyHashPassword(p) : null;
})();

router.get('/captcha', (_req, res) => {
  const captcha = svgCaptcha.create({ noise: 2, color: true, size: 5, ignoreChars: '0oO1lI' });
  // Store the answer (lowercase) in a short-lived signed token — no session needed
  const captchaToken = jwt.sign({ cap: captcha.text.toLowerCase(), typ: 'captcha' }, getJwtSecret(), { expiresIn: '5m' });
  res.json({ svg: captcha.data, captchaToken });
});

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password, captchaToken, captchaAnswer } = req.body as {
    username?: string;
    password?: string;
    captchaToken?: string;
    captchaAnswer?: string;
  };

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  if (!captchaToken || !captchaAnswer) {
    res.status(400).json({ error: 'Captcha is required' });
    return;
  }

  let captchaPayload: { cap?: string };
  try {
    captchaPayload = jwt.verify(captchaToken, getJwtSecret()) as { cap?: string };
  } catch {
    res.status(400).json({ error: 'Captcha expired, please refresh' });
    return;
  }

  if (captchaPayload.cap !== captchaAnswer.toLowerCase().trim()) {
    res.status(400).json({ error: 'Incorrect captcha' });
    return;
  }

  const stored = getStoredCreds();
  let valid: boolean;

  if (stored.passwordHash) {
    valid = username === stored.username && await verifyPassword(password, stored.passwordHash);
  } else {
    if (!ADMIN_PASSWORD_HASH_FALLBACK) {
      res.status(500).json({ error: 'ADMIN_PASSWORD env var is not set' });
      return;
    }
    valid = username === stored.username && credTimingSafeCompare(legacyHashPassword(password), ADMIN_PASSWORD_HASH_FALLBACK);
  }

  if (!valid) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  // Silently upgrade legacy HMAC hash to argon2id on next successful login
  if (stored.passwordHash && !isArgon2Hash(stored.passwordHash)) {
    const upgraded = await hashPassword(password);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('admin_password_hash', ?)").run(upgraded);
  }

  const defaultPwd = process.env.ADMIN_DEFAULT_PASSWORD ?? 'changeme';
  const requirePasswordChange = password === defaultPwd;
  const payload = requirePasswordChange
    ? { sub: username, typ: 'auth', requirePasswordChange: true }
    : { sub: username, typ: 'auth' };
  const token = jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' });
  res.json(requirePasswordChange ? { token, requirePasswordChange: true } : { token });
});

router.put('/credentials', requireAuth, async (req, res) => {
  const { username, currentPassword, newPassword } = req.body as {
    username?: string;
    currentPassword?: string;
    newPassword?: string;
  };

  if (!currentPassword) {
    res.status(400).json({ error: 'Current password is required' });
    return;
  }

  const stored = getStoredCreds();
  const validCurrent = stored.passwordHash
    ? await verifyPassword(currentPassword, stored.passwordHash)
    : ADMIN_PASSWORD_HASH_FALLBACK
      ? credTimingSafeCompare(legacyHashPassword(currentPassword), ADMIN_PASSWORD_HASH_FALLBACK)
      : false;

  if (!validCurrent) {
    res.status(401).json({ error: 'Current password is incorrect' });
    return;
  }

  if (!username && !newPassword) {
    res.status(400).json({ error: 'Provide a new username or password' });
    return;
  }

  const newHash = newPassword ? await hashPassword(newPassword) : null;
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  db.transaction(() => {
    if (username) stmt.run('admin_username', username);
    if (newHash) stmt.run('admin_password_hash', newHash);
  })();

  // Issue a fresh token so any requirePasswordChange claim is cleared
  const newUsername = username || stored.username;
  const freshToken = jwt.sign({ sub: newUsername, typ: 'auth' }, getJwtSecret(), { expiresIn: '7d' });
  res.json({ message: 'Credentials updated', token: freshToken });
});

export default router;

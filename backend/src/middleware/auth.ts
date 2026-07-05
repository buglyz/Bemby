import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('FATAL: JWT_SECRET env var is not set. Set it before starting Bemby.');
    process.exit(1);
  }
  return secret;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // Accept token from Authorization header OR ?token= query param (needed for EventSource/SSE)
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : (req.query.token as string | undefined);

  if (!token) {
    res.status(401).json({ error: 'Unauthorised' });
    return;
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as {
      sub?: string;
      typ?: string;
      cap?: string;
      requirePasswordChange?: boolean;
    };
    // Only session tokens grant API access. Other tokens signed with the same
    // secret (e.g. the public captcha token, which carries `cap` and no `sub`)
    // must never authenticate a request.
    if (!decoded.sub || decoded.cap !== undefined || (decoded.typ !== undefined && decoded.typ !== 'auth')) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
    // Restrict access until the default password is changed
    if (decoded.requirePasswordChange) {
      const path = req.originalUrl.split('?')[0];
      if (!(req.method === 'PUT' && path === '/api/auth/credentials')) {
        res.status(403).json({ error: 'Password change required', requirePasswordChange: true });
        return;
      }
    }
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

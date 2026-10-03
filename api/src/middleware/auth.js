// Demo authentication: username/password login issues a JWT naming the
// user's Fabric identity (docs/design/application.md#authentication).
// Demo passwords are "<username>pw", matching enrollUsers.sh (spec X9).
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { JWT_TTL, ORGS, USERS } from '../config.js';
import { ApiError } from '../errors.js';
import { logger } from '../logger.js';

const BEARER = /^Bearer (.+)$/;

// MEDLEDGER_JWT_SECRET keeps tokens valid across restarts; otherwise a random
// per-process secret is used (tokens expire when the API restarts).
export function jwtSecret() {
  const configured = process.env.MEDLEDGER_JWT_SECRET;
  if (configured) return new TextEncoder().encode(configured);
  logger.warn('MEDLEDGER_JWT_SECRET not set; using a random secret for this process');
  return randomBytes(32);
}

function demoPassword(username) {
  return `${username}pw`;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

export function loginHandler(secret) {
  return async (req, res) => {
    const { username, password } = req.body ?? {};
    const user = USERS[username];
    if (!user || !safeEqual(password ?? '', demoPassword(username))) {
      throw new ApiError(401, 'UNAUTHENTICATED', 'invalid username or password');
    }
    const msp = ORGS[user.org].msp;
    const token = await new SignJWT({ role: user.role, msp, org: user.org })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(username)
      .setIssuedAt()
      .setExpirationTime(JWT_TTL)
      .sign(secret);
    logger.info('login', { user: username, role: user.role });
    res.json({ token, user: { username, role: user.role, msp, org: user.org } });
  };
}

export function requireAuth(secret) {
  return async (req, _res, next) => {
    const match = BEARER.exec(req.get('authorization') ?? '');
    if (!match) throw new ApiError(401, 'UNAUTHENTICATED', 'missing bearer token');
    try {
      const { payload } = await jwtVerify(match[1], secret, { algorithms: ['HS256'] });
      if (!USERS[payload.sub]) throw new Error('unknown user');
      req.user = { username: payload.sub, role: payload.role, msp: payload.msp, org: payload.org };
    } catch {
      throw new ApiError(401, 'UNAUTHENTICATED', 'invalid or expired token');
    }
    next();
  };
}

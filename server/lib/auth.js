'use strict';
// Admin passcode auth. The passcode comes ONLY from the ADMIN_PASSCODE
// environment variable — it is never hardcoded and never stored in the
// database. A successful login issues a random token whose SHA-256 hash is
// stored in the admin_tokens table (never the raw token), set as an
// httpOnly cookie. Tokens live in the database, so a deploy or restart no
// longer logs Admin out; they still expire 12 hours after issue.
const crypto = require('crypto');
const { pool } = require('../db');

const TOKEN_TTL_MS = 12 * 3600 * 1000;

function passcodeConfigured() {
  return Boolean(process.env.ADMIN_PASSCODE);
}

function checkPasscode(candidate) {
  const expected = process.env.ADMIN_PASSCODE;
  if (!expected || !candidate) return false;
  const a = Buffer.from(String(candidate));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// ---- Admin sign-in lockout: 5 wrong passcodes locks sign-in for 15 minutes.
// Attempts live in the admin_login_attempts table (migration 009), so a
// deploy or restart does not clear them. A correct passcode clears the
// failures for that client.
const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCK_MINUTES = 15;
const LOGIN_FAILURE_WINDOW_MINUTES = 15;

function clientIp(req) {
  // Render terminates TLS and forwards the client address as the last entry
  // of X-Forwarded-For (it appends its own entry, so a client cannot spoof
  // the last one). req.ip is NOT used: without `trust proxy` set, it is the
  // Render proxy's address — one shared bucket for every visitor, so one
  // person's guessing would lock Alan out too.
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const parts = String(xff).split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1].slice(0, 45);
  }
  return String((req.ip || (req.socket && req.socket.remoteAddress) || 'unknown')).slice(0, 45);
}

async function loginLockStatus(ip) {
  const { rows } = await pool.query(
    'SELECT failed_count, locked_until FROM admin_login_attempts WHERE ip = $1',
    [ip]
  );
  if (!rows.length) return { locked: false, failedCount: 0 };
  const lockedUntil = rows[0].locked_until ? new Date(rows[0].locked_until) : null;
  if (lockedUntil && lockedUntil.getTime() > Date.now()) {
    return { locked: true, lockedUntil, failedCount: rows[0].failed_count };
  }
  return { locked: false, failedCount: rows[0].failed_count };
}

async function recordLoginFailure(ip) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT failed_count, last_failed_at FROM admin_login_attempts WHERE ip = $1 FOR UPDATE',
      [ip]
    );
    const prev = rows[0];
    // Failures only accumulate inside a 15-minute window; older failures
    // fall away, so one bad afternoon does not lock anyone out forever.
    const inWindow = Boolean(
      prev && prev.last_failed_at &&
      Date.now() - new Date(prev.last_failed_at).getTime() < LOGIN_FAILURE_WINDOW_MINUTES * 60 * 1000
    );
    const failedCount = inWindow ? prev.failed_count + 1 : 1;
    const lockedUntil = failedCount >= MAX_LOGIN_FAILURES
      ? new Date(Date.now() + LOGIN_LOCK_MINUTES * 60 * 1000)
      : null;
    await client.query(
      `INSERT INTO admin_login_attempts (ip, failed_count, last_failed_at, locked_until)
       VALUES ($1, $2, now(), $3)
       ON CONFLICT (ip) DO UPDATE SET failed_count = $2, last_failed_at = now(), locked_until = $3`,
      [ip, failedCount, lockedUntil]
    );
    await client.query('COMMIT');
    return { failedCount, lockedUntil };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function clearLoginFailures(ip) {
  await pool.query('DELETE FROM admin_login_attempts WHERE ip = $1', [ip]);
}

async function issueToken() {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await pool.query(
    'INSERT INTO admin_tokens (token_hash, expires_at) VALUES ($1, $2)',
    [hashToken(token), expiresAt]
  );
  return token;
}

async function revokeToken(token) {
  if (!token) return;
  await pool.query('DELETE FROM admin_tokens WHERE token_hash = $1', [hashToken(token)]);
}

async function isValidToken(token) {
  if (!token) return false;
  const { rows } = await pool.query(
    'SELECT expires_at FROM admin_tokens WHERE token_hash = $1',
    [hashToken(token)]
  );
  if (!rows.length) return false;
  if (new Date(rows[0].expires_at).getTime() <= Date.now()) {
    await pool.query('DELETE FROM admin_tokens WHERE token_hash = $1', [hashToken(token)]);
    return false;
  }
  // Opportunistic cleanup of expired tokens.
  await pool.query('DELETE FROM admin_tokens WHERE expires_at <= now()').catch(() => {});
  return true;
}

function tokenFromReq(req) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)mpa_admin=([^;]+)/);
  if (m) return decodeURIComponent(m[1]);
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

async function requireAdmin(req, res, next) {
  if (!passcodeConfigured()) {
    return res.status(503).json({ error: 'Admin passcode is not configured on this server.' });
  }
  if (!(await isValidToken(tokenFromReq(req)))) {
    return res.status(401).json({ error: 'Admin sign-in required.' });
  }
  return next();
}

// Optional: true when the request carries a valid admin token (used to let
// an organizer save any score, while players are limited to their court).
async function isAdmin(req) {
  return passcodeConfigured() && (await isValidToken(tokenFromReq(req)));
}

module.exports = {
  passcodeConfigured,
  checkPasscode,
  issueToken,
  revokeToken,
  isValidToken,
  tokenFromReq,
  requireAdmin,
  isAdmin,
  clientIp,
  loginLockStatus,
  recordLoginFailure,
  clearLoginFailures,
};

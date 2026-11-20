'use strict';
// Admin passcode auth. The MASTER passcode comes ONLY from the ADMIN_PASSCODE
// environment variable — it is never hardcoded and never stored in the
// database. It belongs to Alan (person_id 1) and always works for him. Each
// other flagged admin can have their OWN passcode: only its SHA-256 hash is
// stored, in the admin_passcodes table (never the plain passcode).
// A successful login issues a random token whose SHA-256 hash is stored in
// the admin_tokens table (never the raw token), set as an httpOnly cookie.
// Tokens live in the database, so a deploy or restart no longer logs Admin
// out; they still expire 12 hours after issue. The token row records WHICH
// admin signed in (admin_tokens.person_id).
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

// ---- Per-admin passcodes (migration 011) ----
// Alan Cortez is the first member (person_id 1); the ADMIN_PASSCODE env var
// is his master passcode and always works for him. Every other flagged admin
// signs in with their own passcode, stored as a SHA-256 hash only.
const MASTER_PERSON_ID = 1;

function hashPasscode(candidate) {
  return crypto.createHash('sha256').update(String(candidate)).digest('hex');
}

function verifyPasscodeHash(candidate, hash) {
  if (!candidate || !hash) return false;
  const a = Buffer.from(hashPasscode(candidate));
  const b = Buffer.from(String(hash));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// The sign-in credential check, shared by the login route and the tests.
// Returns 'ok', 'not-set' (this admin has no personal passcode yet), or
// 'wrong'. A personal passcode wins; for Alan, the master passcode works
// too, whether or not he has a personal one set.
function checkAdminPasscode({ candidate, storedHash, isMasterPerson }) {
  if (storedHash && verifyPasscodeHash(candidate, storedHash)) return 'ok';
  if (isMasterPerson && checkPasscode(candidate)) return 'ok';
  // 'not-set' only when this admin has NO way in at all. Alan always has
  // the master passcode, so a wrong guess for him must count as a failure
  // (otherwise his master passcode could be guessed with no lockout).
  if (!storedHash && !isMasterPerson) return 'not-set';
  return 'wrong';
}

// ---- Admin sign-in lockout: 5 wrong passcodes locks THAT admin for 15
// minutes. Attempts live in the admin_passcode_attempts table (migration
// 011), keyed by person, so a deploy or restart does not clear them — and
// one admin's guessing never locks another admin out (the old per-IP table
// locked a whole network, e.g. everyone on the YMCA wifi). A correct
// passcode clears the failures for that admin.
const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCK_MINUTES = 15;
const LOGIN_FAILURE_WINDOW_MINUTES = 15;

async function loginLockStatus(personId) {
  const { rows } = await pool.query(
    'SELECT failed_count, locked_until FROM admin_passcode_attempts WHERE person_id = $1',
    [personId]
  );
  if (!rows.length) return { locked: false, failedCount: 0 };
  const lockedUntil = rows[0].locked_until ? new Date(rows[0].locked_until) : null;
  if (lockedUntil && lockedUntil.getTime() > Date.now()) {
    return { locked: true, lockedUntil, failedCount: rows[0].failed_count };
  }
  return { locked: false, failedCount: rows[0].failed_count };
}

async function recordLoginFailure(personId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT failed_count, last_failed_at FROM admin_passcode_attempts WHERE person_id = $1 FOR UPDATE',
      [personId]
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
      `INSERT INTO admin_passcode_attempts (person_id, failed_count, last_failed_at, locked_until)
       VALUES ($1, $2, now(), $3)
       ON CONFLICT (person_id) DO UPDATE SET failed_count = $2, last_failed_at = now(), locked_until = $3`,
      [personId, failedCount, lockedUntil]
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

async function clearLoginFailures(personId) {
  await pool.query('DELETE FROM admin_passcode_attempts WHERE person_id = $1', [personId]);
}

async function issueToken(personId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await pool.query(
    'INSERT INTO admin_tokens (token_hash, expires_at, person_id) VALUES ($1, $2, $3)',
    [hashToken(token), expiresAt, personId || null]
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

// Who is signed in with this request (from the token row), or null.
// Returns { personId, name } — name is null for legacy tokens issued before
// person_id was recorded on the token.
async function adminIdentity(req) {
  const token = tokenFromReq(req);
  if (!token) return null;
  if (!(await isValidToken(token))) return null;
  const { rows } = await pool.query(
    `SELECT t.person_id, p.name FROM admin_tokens t
      LEFT JOIN people p ON p.id = t.person_id
     WHERE t.token_hash = $1`,
    [hashToken(token)]
  );
  if (!rows.length) return null;
  return { personId: rows[0].person_id, name: rows[0].name || null };
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
  MASTER_PERSON_ID,
  hashPasscode,
  verifyPasscodeHash,
  checkAdminPasscode,
  issueToken,
  revokeToken,
  isValidToken,
  tokenFromReq,
  adminIdentity,
  requireAdmin,
  isAdmin,
  loginLockStatus,
  recordLoginFailure,
  clearLoginFailures,
};

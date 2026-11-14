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
};

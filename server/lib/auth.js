'use strict';
// Admin passcode auth. The passcode comes ONLY from the ADMIN_PASSCODE
// environment variable — it is never hardcoded and never stored in the
// database. A successful login issues a random token kept in memory
// (single-instance service) and set as an httpOnly cookie.
const crypto = require('crypto');

const tokens = new Map(); // token -> { createdAt }
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

function issueToken() {
  const token = crypto.randomBytes(32).toString('hex');
  tokens.set(token, { createdAt: Date.now() });
  return token;
}

function revokeToken(token) {
  tokens.delete(token);
}

function isValidToken(token) {
  if (!token) return false;
  const rec = tokens.get(token);
  if (!rec) return false;
  if (Date.now() - rec.createdAt > TOKEN_TTL_MS) {
    tokens.delete(token);
    return false;
  }
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

function requireAdmin(req, res, next) {
  if (!passcodeConfigured()) {
    return res.status(503).json({ error: 'Admin passcode is not configured on this server.' });
  }
  if (!isValidToken(tokenFromReq(req))) {
    return res.status(401).json({ error: 'Admin sign-in required.' });
  }
  return next();
}

// Optional: true when the request carries a valid admin token (used to let
// an organizer save any score, while players are limited to their court).
function isAdmin(req) {
  return passcodeConfigured() && isValidToken(tokenFromReq(req));
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

-- Admin sign-in lockout state (5 wrong passcodes -> 15-minute lock).
-- One row per client IP. A correct passcode deletes the row; failures only
-- accumulate inside a 15-minute window (see server/lib/auth.js).
CREATE TABLE IF NOT EXISTS admin_login_attempts (
  ip TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0,
  last_failed_at TIMESTAMPTZ,
  locked_until TIMESTAMPTZ
);

-- 011_admin_passcodes.sql — Per-admin passcodes (display-neutral: the
-- is_admin flag from 010 is unchanged; this only adds sign-in credentials).
-- Each flagged admin can have their OWN passcode. Only the SHA-256 hash is
-- stored, never the plain passcode. Alan's ADMIN_PASSCODE env var stays as
-- the master passcode and always works for Alan (person_id 1).
CREATE TABLE IF NOT EXISTS admin_passcodes (
  person_id INTEGER PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  passcode_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- admin_tokens records WHICH admin signed in (NULL = a legacy token issued
-- before this migration, or a token whose person is gone).
ALTER TABLE admin_tokens ADD COLUMN IF NOT EXISTS person_id INTEGER REFERENCES people(id) ON DELETE SET NULL;

-- Sign-in lockout moves from per-IP (migration 009) to per-admin: 5 wrong
-- passcodes for one admin locks THAT admin for 15 minutes; other admins are
-- unaffected. The old per-IP table is no longer used by any code.
CREATE TABLE IF NOT EXISTS admin_passcode_attempts (
  person_id INTEGER PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  failed_count INTEGER NOT NULL DEFAULT 0,
  last_failed_at TIMESTAMPTZ,
  locked_until TIMESTAMPTZ
);
DROP TABLE IF EXISTS admin_login_attempts;

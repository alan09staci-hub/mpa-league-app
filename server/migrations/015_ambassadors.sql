-- 015_ambassadors.sql — Ambassadors: members flagged is_ambassador sign
-- in on the Ambassadors tab with their OWN passcode, mirroring the
-- per-admin passcodes (migration 011) and the admin token table
-- (migration 004). There is NO master passcode for ambassadors — an
-- ambassador signs in only with their own passcode. Ambassador tokens
-- live in their own table with their own cookie, so an ambassador token
-- never grants Admin access (and vice versa). Lockout is per ambassador:
-- 5 wrong passcodes locks THAT ambassador for 15 minutes. Nobody is
-- pre-marked — Admin flags ambassadors in Admin → Members → Edit.
ALTER TABLE members ADD COLUMN IF NOT EXISTS is_ambassador BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS ambassador_passcodes (
  person_id INTEGER PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  passcode_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ambassador_passcode_attempts (
  person_id INTEGER PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  failed_count INTEGER NOT NULL DEFAULT 0,
  last_failed_at TIMESTAMPTZ,
  locked_until TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ambassador_tokens (
  token_hash TEXT PRIMARY KEY,
  person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ambassador_tokens_expires_idx ON ambassador_tokens (expires_at);

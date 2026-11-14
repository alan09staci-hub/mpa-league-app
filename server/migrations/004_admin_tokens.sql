-- 004_admin_tokens.sql — Admin sign-in tokens live in the database so a
-- deploy/restart no longer logs Admin out. Only a SHA-256 hash of each
-- token is stored, never the raw token. Tokens still expire after 12h.
CREATE TABLE IF NOT EXISTS admin_tokens (
  token_hash TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_tokens_expires_idx ON admin_tokens (expires_at);

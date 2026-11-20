-- 012_admin_activity.sql — Admin activity log (sign-ins for now; the `action`
-- column is a plain label so the same table can later hold admin actions too).
-- Sign-ins only in this build; failed sign-in attempts are NOT logged here
-- (they are already rate-limited by the per-admin lockout, migration 011).
CREATE TABLE IF NOT EXISTS admin_activity (
  id SERIAL PRIMARY KEY,
  person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 013_member_rating_history.sql — Rating history: every rating change is
-- recorded with the old and new value, the rating type, when it changed,
-- and who changed it ('member' for a My Profile save, 'admin' for an
-- Admin edit, 'system' for the go-live baseline). Past changes are not
-- recoverable — history starts from this migration.
CREATE TABLE IF NOT EXISTS member_rating_history (
  id SERIAL PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  rating_type TEXT NOT NULL CHECK (rating_type IN ('doubles', 'singles', 'skinny')),
  old_rating NUMERIC,
  new_rating NUMERIC,
  changed_by TEXT NOT NULL CHECK (changed_by IN ('member', 'admin', 'system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rating_history_person ON member_rating_history (person_id, created_at DESC);

-- Go-live baseline: one row per rating a member currently has, so the
-- timeline has a starting point. Old value is NULL (no earlier record).
-- Guarded so a re-run never duplicates the baseline.
INSERT INTO member_rating_history (person_id, rating_type, old_rating, new_rating, changed_by)
SELECT person_id, 'doubles', NULL, dupr_rating, 'system' FROM members WHERE dupr_rating IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM member_rating_history);
INSERT INTO member_rating_history (person_id, rating_type, old_rating, new_rating, changed_by)
SELECT person_id, 'singles', NULL, singles_rating, 'system' FROM members WHERE singles_rating IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM member_rating_history WHERE rating_type = 'singles');
INSERT INTO member_rating_history (person_id, rating_type, old_rating, new_rating, changed_by)
SELECT person_id, 'skinny', NULL, skinny_rating, 'system' FROM members WHERE skinny_rating IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM member_rating_history WHERE rating_type = 'skinny');

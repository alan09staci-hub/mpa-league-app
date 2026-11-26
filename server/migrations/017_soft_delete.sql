-- 017_soft_delete.sql — Soft delete for nights and leagues: Delete sets
-- deleted_at instead of destroying rows. A deleted item leaves the
-- players' view (lists, details, "Your nights") but stays in the
-- database, where the Admin-only Finished tab shows it: Restore clears
-- deleted_at (the undo for an accidental delete), Delete forever — from
-- inside the archive only — destroys the rows with the old cascade.
-- Nothing is destroyed by Delete anymore.
ALTER TABLE rr_events ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE br_events ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS rr_events_deleted_idx ON rr_events (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS br_events_deleted_idx ON br_events (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS leagues_deleted_idx ON leagues (deleted_at) WHERE deleted_at IS NOT NULL;

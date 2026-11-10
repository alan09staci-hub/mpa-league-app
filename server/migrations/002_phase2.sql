-- 002_phase2.sql — Phase 2 additions.
-- Registrations collect contact details on the join form (name, phone,
-- email), so Admin can see them on the registration row. The Phase 1
-- table had no email/phone columns.
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS phone TEXT;

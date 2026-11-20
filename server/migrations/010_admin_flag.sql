-- Admin badge flag (display only): marks members who are Admins on the
-- Admin Members list. It does not grant or remove Admin access — sign-in
-- is still the shared Admin passcode.
ALTER TABLE members ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE members SET is_admin = TRUE WHERE person_id = 1;

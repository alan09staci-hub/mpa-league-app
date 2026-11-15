-- 005_self_rated.sql — Self-rating fallback: a member or registration whose
-- rating is self-entered (no DUPR account yet) is marked self_rated, so the
-- app can label it honestly instead of showing it as a DUPR rating. DUPR
-- stays the standard path; the flag clears when a real DUPR ID is added.
ALTER TABLE members ADD COLUMN IF NOT EXISTS self_rated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS self_rated BOOLEAN NOT NULL DEFAULT FALSE;

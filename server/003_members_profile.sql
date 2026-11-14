-- Member profile fields: optional details shown on the public member
-- profile page (tapped from the Members directory). Ratings use the same
-- NUMERIC(4,3) type as members.dupr_rating. Nothing here is required: a
-- DUPR ID and doubles rating stay the only required member fields.
ALTER TABLE members ADD COLUMN IF NOT EXISTS nickname TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS height TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS handed TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS singles_rating NUMERIC(4,3);
ALTER TABLE members ADD COLUMN IF NOT EXISTS skinny_rating NUMERIC(4,3);

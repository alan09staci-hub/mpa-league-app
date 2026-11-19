-- 008_rr_create_fields.sql — Round Robin create card (Admin page): the
-- fields the create form collects, so a night carries its start time, its
-- own team cap, and how sign-ups close.
-- start_time: the night starts at this time in the league zone
-- (America/New_York); the old create form never stored one.
-- max_teams: the night's own cap (default 6, the preview's default);
-- the global ceiling stays 24, enforced at create/patch.
-- signup_close: 'day-3h' closes sign-ups 3 hours before the night starts
-- (the league opt-in deadline pattern); 'fill' closes only when full.
ALTER TABLE rr_events ADD COLUMN IF NOT EXISTS start_time TIME NOT NULL DEFAULT '18:30';
ALTER TABLE rr_events ADD COLUMN IF NOT EXISTS max_teams INTEGER NOT NULL DEFAULT 6 CHECK (max_teams >= 2 AND max_teams <= 24);
ALTER TABLE rr_events ADD COLUMN IF NOT EXISTS signup_close TEXT NOT NULL DEFAULT 'day-3h' CHECK (signup_close IN ('fill', 'day-3h'));

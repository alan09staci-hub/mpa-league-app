-- 016_rotating_nights.sql — Rotating-partners round robin nights: partners
-- change every round and each player carries their own points into a
-- personal bank, ranked by the night's winner rule. Charity/free only —
-- money ball stays fixed-team (the server rejects kind=money on a
-- rotating night). Fixed-team nights are untouched: format defaults to
-- 'fixed' and the new tables are only used when format = 'rotating'.
--
-- rr_events.format: 'fixed' (teams stay together all night) or
-- 'rotating' (partners rotate every round).
-- rr_events.winner_rule: how a rotating night ranks players — 'ep'
-- (E/P Diff%, the default), 'points' (most total points), 'wins'
-- (most game wins first). Only read for rotating nights.
-- rr_events.max_players: the rotating night's player cap (default 12);
-- fixed nights keep using max_teams.
-- rr_rot_players: one row per individual player on a rotating night.
-- person_id links a joined member (NULL for hand-added names); is_main
-- marks the main player, rotator_order (1..5) the order the rotators
-- cycle through as the main's partner (NULL = not a rotator).
-- rr_rot_matches: one row per game, with the four player ids on each
-- side (p1/p2 vs p3/p4). Byes are derived on read (players with no match
-- in a round), like the fixed-team path.
ALTER TABLE rr_events ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'fixed' CHECK (format IN ('fixed','rotating'));
ALTER TABLE rr_events ADD COLUMN IF NOT EXISTS winner_rule TEXT NOT NULL DEFAULT 'ep' CHECK (winner_rule IN ('ep','points','wins'));
ALTER TABLE rr_events ADD COLUMN IF NOT EXISTS max_players INTEGER NOT NULL DEFAULT 12 CHECK (max_players >= 2 AND max_players <= 24);

CREATE TABLE IF NOT EXISTS rr_rot_players (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES rr_events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  is_main BOOLEAN NOT NULL DEFAULT FALSE,
  rotator_order INTEGER CHECK (rotator_order IS NULL OR (rotator_order >= 1 AND rotator_order <= 5)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id, person_id)
);
CREATE INDEX IF NOT EXISTS rr_rot_players_event_idx ON rr_rot_players (event_id);
CREATE UNIQUE INDEX IF NOT EXISTS rr_rot_players_one_main_idx ON rr_rot_players (event_id) WHERE is_main;

CREATE TABLE IF NOT EXISTS rr_rot_matches (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES rr_events(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  court INTEGER NOT NULL,
  p1_id INTEGER NOT NULL REFERENCES rr_rot_players(id) ON DELETE CASCADE,
  p2_id INTEGER NOT NULL REFERENCES rr_rot_players(id) ON DELETE CASCADE,
  p3_id INTEGER NOT NULL REFERENCES rr_rot_players(id) ON DELETE CASCADE,
  p4_id INTEGER NOT NULL REFERENCES rr_rot_players(id) ON DELETE CASCADE,
  target_score INTEGER NOT NULL DEFAULT 11,
  score1 INTEGER,
  score2 INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rr_rot_matches_event_idx ON rr_rot_matches (event_id);

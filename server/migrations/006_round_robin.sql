-- 006_round_robin.sql — Round Robin events: one-off nights, separate from
-- leagues. Fixed doubles teams stay together all night; every team plays
-- every other team once. Free charity games have no fee and no payouts;
-- money-ball events have a per-person entry fee and a payout structure.
-- Standings and payouts are computed from the matches, never stored.
CREATE TABLE IF NOT EXISTS rr_events (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  event_date DATE NOT NULL,
  kind TEXT NOT NULL DEFAULT 'charity' CHECK (kind IN ('charity','money')),
  fee_cents INTEGER NOT NULL DEFAULT 1000 CHECK (fee_cents >= 0),
  payout TEXT NOT NULL DEFAULT 'house'
    CHECK (payout IN ('house','winner-take-all','top-two-60-40','top-two-66-33','top-three-50-30-20','top-four-40-30-20-10')),
  status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup','playing','completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rr_teams (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES rr_events(id) ON DELETE CASCADE,
  player1 TEXT NOT NULL,
  player2 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rr_teams_event_idx ON rr_teams (event_id);

CREATE TABLE IF NOT EXISTS rr_matches (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES rr_events(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  court INTEGER NOT NULL,
  team1_id INTEGER NOT NULL REFERENCES rr_teams(id) ON DELETE CASCADE,
  team2_id INTEGER NOT NULL REFERENCES rr_teams(id) ON DELETE CASCADE,
  target_score INTEGER NOT NULL DEFAULT 15,
  score1 INTEGER,
  score2 INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rr_matches_event_idx ON rr_matches (event_id);

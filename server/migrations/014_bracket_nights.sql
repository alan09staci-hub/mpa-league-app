-- 014_bracket_nights.sql — Double-elimination bracket nights, mirroring
-- the round robin tables (006/007/008): one-off nights, separate from
-- leagues. Fixed doubles teams stay together all night; teams are seeded
-- by combined doubles rating, losers drop to a second bracket, lose twice
-- and you're out. The winners-bracket champion meets the losers-bracket
-- champion in the grand final, with a reset game if the losers champion
-- wins the first final.
--
-- br_matches carries slot references instead of resolved team ids, because
-- who plays a later match depends on earlier results:
--   slot1_type/slot2_type: 'seed' (ref = seed number 1..N),
--   'winner' (ref = br_matches.id of the match whose winner advances),
--   'loser'  (ref = br_matches.id of the match whose loser drops down).
-- Slot refs point at matches created earlier in the same night (creation
-- order), so they are logical references, not foreign keys — the bracket
-- engine (server/lib/bracket.js) is the authority on their shape. A match
-- with no score yet has no teams resolved; the server resolves slots on
-- read, in creation order. target_score is always 11 (games to 11, win by
-- 1, no deuce — the same rule as round robin).
--
-- br_teams.seed is NULL until the night is built (seeding happens at
-- build time, from the teams that actually signed up).
--
-- max_teams is the night's bracket size and must be one of 4/6/8/10/12/16
-- (the only sizes the bracket engine builds); the create form offers
-- exactly those, default 12.
CREATE TABLE IF NOT EXISTS br_events (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  event_date DATE NOT NULL,
  kind TEXT NOT NULL DEFAULT 'money' CHECK (kind IN ('charity','money')),
  fee_cents INTEGER NOT NULL DEFAULT 1000 CHECK (fee_cents >= 0),
  payout TEXT NOT NULL DEFAULT 'house'
    CHECK (payout IN ('house','winner-take-all','top-two-60-40','top-two-66-33','top-three-50-30-20','top-four-40-30-20-10')),
  status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup','playing','completed')),
  start_time TIME NOT NULL DEFAULT '18:30',
  max_teams INTEGER NOT NULL DEFAULT 12 CHECK (max_teams IN (4,6,8,10,12,16)),
  signup_close TEXT NOT NULL DEFAULT 'day-3h' CHECK (signup_close IN ('fill', 'day-3h')),
  published BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS br_teams (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES br_events(id) ON DELETE CASCADE,
  player1 TEXT NOT NULL,
  player2 TEXT NOT NULL,
  person1_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  person2_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  seed INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS br_teams_event_idx ON br_teams (event_id);

CREATE TABLE IF NOT EXISTS br_matches (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES br_events(id) ON DELETE CASCADE,
  bracket TEXT NOT NULL CHECK (bracket IN ('W','L','G')),
  round INTEGER NOT NULL,
  game_no INTEGER NOT NULL,
  slot1_type TEXT NOT NULL CHECK (slot1_type IN ('seed','winner','loser')),
  slot1_ref INTEGER NOT NULL,
  slot2_type TEXT NOT NULL CHECK (slot2_type IN ('seed','winner','loser')),
  slot2_ref INTEGER NOT NULL,
  target_score INTEGER NOT NULL DEFAULT 11,
  score1 INTEGER,
  score2 INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS br_matches_event_idx ON br_matches (event_id);

CREATE TABLE IF NOT EXISTS br_solos (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES br_events(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id, person_id)
);
CREATE INDEX IF NOT EXISTS br_solos_event_idx ON br_solos (event_id);

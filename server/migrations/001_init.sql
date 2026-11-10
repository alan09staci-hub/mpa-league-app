-- 001_init.sql — full data model (Phase 1 + Phase 2 tables).
-- People are never duplicated: one record per person, rosters link via
-- player_leagues. Members/registrations reference people where possible.
-- Game times are stored as timestamptz (starts_at) in the league timezone.

CREATE TABLE IF NOT EXISTS people (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  dupr_id TEXT,
  dupr_rating NUMERIC(4,3),
  dupr_profile_url TEXT,
  photo_url TEXT,
  resides TEXT,
  age INTEGER,
  country TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One person, one record: names are unique case-insensitively.
CREATE UNIQUE INDEX IF NOT EXISTS people_name_ci ON people (lower(name));

CREATE TABLE IF NOT EXISTS members (
  id SERIAL PRIMARY KEY,
  person_id INTEGER REFERENCES people(id),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  dupr_id TEXT,
  dupr_rating NUMERIC(4,3),
  dupr_profile_url TEXT,
  photo_url TEXT,
  resides TEXT,
  age INTEGER,
  country TEXT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS members_person_idx ON members (person_id);
CREATE INDEX IF NOT EXISTS members_name_ci ON members (lower(name));

CREATE TABLE IF NOT EXISTS leagues (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Intermediate','Intermediate/Advanced','Advanced','Elite','Women''s')),
  skill TEXT NOT NULL CHECK (skill IN ('2.5-2.99','3.0-3.49','3.5-4.49','5.0-ABOVE','50+')),
  format TEXT NOT NULL DEFAULT 'Coed Doubles',
  day TEXT NOT NULL,
  time TIME NOT NULL,
  season TEXT NOT NULL DEFAULT '',
  start_date DATE NOT NULL,
  stop_date DATE NOT NULL,
  -- The 8 weekly game-day dates, each individually editable. Stored as an
  -- array of ISO dates; sessions are generated from these at creation.
  game_dates DATE[] NOT NULL DEFAULT '{}',
  location TEXT NOT NULL DEFAULT 'YMCA, 601 26th Ave SE, Moultrie, GA 31768',
  max_players INTEGER NOT NULL DEFAULT 36,
  logo_color TEXT NOT NULL DEFAULT 'black-yellow',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS league_settings (
  league_id INTEGER PRIMARY KEY REFERENCES leagues(id) ON DELETE CASCADE,
  registration_open BOOLEAN NOT NULL DEFAULT TRUE
);

-- One person can be on the roster of several leagues. Each league keeps its
-- own Admin penalty and fee-waiver state. Removing a person removes them
-- from that league only.
CREATE TABLE IF NOT EXISTS player_leagues (
  id SERIAL PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES people(id),
  league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  admin_penalty NUMERIC(5,2) NOT NULL DEFAULT 0,
  fee_waived BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (person_id, league_id)
);
CREATE INDEX IF NOT EXISTS player_leagues_league_idx ON player_leagues (league_id);
CREATE INDEX IF NOT EXISTS player_leagues_person_idx ON player_leagues (person_id);

CREATE TABLE IF NOT EXISTS registrations (
  id SERIAL PRIMARY KEY,
  person_id INTEGER REFERENCES people(id),
  name TEXT NOT NULL,
  league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  dupr_id TEXT,
  dupr_rating NUMERIC(4,3),
  membership_type TEXT NOT NULL DEFAULT 'member' CHECK (membership_type IN ('member','non-member')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','added')),
  fee_waived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS registrations_league_idx ON registrations (league_id);

-- One row per game day per league.
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  session_number INTEGER NOT NULL,
  date DATE NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','in_progress','completed')),
  label TEXT NOT NULL DEFAULT '',
  schedule_generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, session_number)
);
CREATE INDEX IF NOT EXISTS sessions_league_idx ON sessions (league_id, date);

-- Opt-in state per player per session. Opting in IS checking in.
CREATE TABLE IF NOT EXISTS session_players (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id),
  opted_in BOOLEAN NOT NULL DEFAULT TRUE,
  opted_in_at TIMESTAMPTZ,
  checked_in BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (session_id, person_id)
);
CREATE INDEX IF NOT EXISTS session_players_session_idx ON session_players (session_id);

-- Matches. kind='bye' rows record who sits out a round (bye_person_id);
-- kind='match' rows are 2v2 with a target score (20/15/10 by court size).
CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  court INTEGER NOT NULL,
  round INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'match' CHECK (kind IN ('match','bye')),
  team1_p1 INTEGER REFERENCES people(id),
  team1_p2 INTEGER REFERENCES people(id),
  team2_p1 INTEGER REFERENCES people(id),
  team2_p2 INTEGER REFERENCES people(id),
  bye_person_id INTEGER REFERENCES people(id),
  target_score INTEGER NOT NULL,
  score1 INTEGER,
  score2 INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS matches_session_idx ON matches (session_id, court, round);

-- Rank per player saved when a session is completed (drives Previous and
-- Max Mvmt). Reopening a session removes its snapshot.
CREATE TABLE IF NOT EXISTS rank_snapshots (
  id SERIAL PRIMARY KEY,
  league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id),
  rank INTEGER NOT NULL,
  ep_diff NUMERIC(6,3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, session_id, person_id)
);
CREATE INDEX IF NOT EXISTS rank_snapshots_league_idx ON rank_snapshots (league_id, session_id);

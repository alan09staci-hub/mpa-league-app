-- 007_rr_self_join.sql — Round Robin self-join: publish a night so members
-- can join it themselves, link teams to people, and solo sign-ups that the
-- admin pairs into teams.
-- published: only a published night in setup takes sign-ups; joining closes
-- automatically once the night is built (status playing).
-- person1_id/person2_id: hand-added teams keep NULL here (names only);
-- teams joined through the app carry the people they belong to, so the
-- server can tell who is already on a night.
-- rr_solos: one row per solo sign-up; the UNIQUE backstop stops the same
-- person signing up solo twice for one night.
ALTER TABLE rr_events ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE rr_teams ADD COLUMN IF NOT EXISTS person1_id INTEGER REFERENCES people(id) ON DELETE SET NULL;
ALTER TABLE rr_teams ADD COLUMN IF NOT EXISTS person2_id INTEGER REFERENCES people(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS rr_solos (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES rr_events(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id, person_id)
);
CREATE INDEX IF NOT EXISTS rr_solos_event_idx ON rr_solos (event_id);

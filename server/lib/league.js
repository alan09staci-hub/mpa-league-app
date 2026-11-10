'use strict';
// Shared helpers for leagues / sessions / standings / schedules.
const { pool } = require('../db');
const { addHours, zonedToUtc } = require('./time');
const { generateSchedule, matchKey } = require('./schedule');
const { computeStandings } = require('./standings');

function effectiveStatus(session, now = new Date()) {
  if (session.status === 'completed') return 'completed';
  return now >= new Date(session.starts_at) ? 'in_progress' : 'upcoming';
}

// Opt-in opens 1 hour after the previous session starts. For the first
// session of a league there is no previous game, so it opens when the
// league is created. Deadline is 3 hours before game time.
function optInWindow(session, prevSession, league) {
  const startsAt = new Date(session.starts_at);
  const opensAt = prevSession
    ? addHours(new Date(prevSession.starts_at), 1)
    : new Date(league.created_at);
  const deadlineAt = addHours(startsAt, -3);
  return { opensAt, deadlineAt, startsAt };
}

async function getLeague(client, leagueId) {
  const { rows } = await client.query('SELECT * FROM leagues WHERE id = $1', [leagueId]);
  return rows[0] || null;
}

async function getSessions(client, leagueId) {
  const { rows } = await client.query(
    'SELECT * FROM sessions WHERE league_id = $1 ORDER BY date ASC, session_number ASC',
    [leagueId]
  );
  return rows;
}

async function getSession(client, leagueId, sessionId) {
  const { rows } = await client.query(
    'SELECT * FROM sessions WHERE id = $1 AND league_id = $2',
    [sessionId, leagueId]
  );
  return rows[0] || null;
}

async function getAttendees(client, sessionId) {
  const { rows } = await client.query(
    `SELECT sp.person_id, sp.opted_in_at, p.name, p.dupr_id, p.dupr_rating
       FROM session_players sp JOIN people p ON p.id = sp.person_id
      WHERE sp.session_id = $1 AND sp.opted_in = TRUE
      ORDER BY p.name ASC`,
    [sessionId]
  );
  return rows;
}

async function getMatches(client, sessionId) {
  const { rows } = await client.query(
    'SELECT * FROM matches WHERE session_id = $1 ORDER BY court ASC, round ASC, id ASC',
    [sessionId]
  );
  return rows;
}

async function getRoster(client, leagueId) {
  const { rows } = await client.query(
    `SELECT pl.person_id, pl.joined_at, pl.admin_penalty, pl.fee_waived,
            p.name, p.dupr_id, p.dupr_rating, p.dupr_profile_url
       FROM player_leagues pl JOIN people p ON p.id = pl.person_id
      WHERE pl.league_id = $1 ORDER BY p.name ASC`,
    [leagueId]
  );
  return rows;
}

// Load everything computeStandings needs, plus the current game day.
async function loadStandingsData(client, leagueId, now = new Date()) {
  const league = await getLeague(client, leagueId);
  if (!league) return null;
  const roster = await getRoster(client, leagueId);
  const sessions = await getSessions(client, leagueId);

  const included = [];
  for (const s of sessions) {
    const eff = effectiveStatus(s, now);
    if (eff !== 'completed' && eff !== 'in_progress') continue;
    const attendees = new Set((await getAttendees(client, s.id)).map((a) => a.person_id));
    const matches = await getMatches(client, s.id);
    included.push({
      id: s.id,
      session_number: s.session_number,
      date: s.date instanceof Date ? s.date.toISOString().slice(0, 10) : String(s.date).slice(0, 10),
      status: eff,
      attendees,
      matches,
    });
  }

  // The latest week reflected in the standings, and the snapshot that is
  // "Previous": the rank after the last completed week before it.
  let latestIncluded = included.length ? included[included.length - 1] : null;
  let prevSnapshot = new Map();
  if (latestIncluded) {
    const prevCompleted = included
      .filter((s) => s.status === 'completed' && s.id !== latestIncluded.id)
      .pop();
    if (prevCompleted) {
      const { rows } = await client.query(
        'SELECT person_id, rank FROM rank_snapshots WHERE session_id = $1',
        [prevCompleted.id]
      );
      prevSnapshot = new Map(rows.map((r) => [r.person_id, r.rank]));
    }
  }

  const currentSession =
    sessions.find((s) => effectiveStatus(s, now) !== 'completed') || null;
  let currentAttendees = null;
  if (currentSession) {
    currentAttendees = new Set(
      (await getAttendees(client, currentSession.id)).map((a) => a.person_id)
    );
  }

  const rows = computeStandings({
    league,
    roster: roster.map((r) => ({
      person_id: r.person_id,
      name: r.name,
      dupr_id: r.dupr_id,
      dupr_rating: r.dupr_rating,
      joined_at: r.joined_at,
      admin_penalty: r.admin_penalty,
    })),
    sessions: included,
    prevSnapshot,
    latestCompleted: latestIncluded,
    currentAttendees,
  });

  return { league, roster, sessions, rows, currentSession, included };
}

// Order players for court assignment / RSVP rank: current standings order
// (DUPR seeding when nothing is completed yet).
async function insertMatches(client, sessionId, generated) {
  for (const m of generated) {
    if (m.kind === 'bye') {
      await client.query(
        `INSERT INTO matches (session_id, court, round, kind, bye_person_id, target_score)
         VALUES ($1,$2,$3,'bye',$4,$5)`,
        [sessionId, m.court, m.round, m.bye, m.target]
      );
    } else {
      await client.query(
        `INSERT INTO matches (session_id, court, round, kind, team1_p1, team1_p2, team2_p1, team2_p2, target_score)
         VALUES ($1,$2,$3,'match',$4,$5,$6,$7,$8)`,
        [sessionId, m.court, m.round, m.team1[0], m.team1[1], m.team2[0], m.team2[1], m.target]
      );
    }
  }
}

// Generate the schedule for a session from its opted-in players.
// preserveScores: when rebuilding, carry scores over to any new match
// with the same court and same four players.
async function generateForSession(client, session, opts = {}) {
  const attendees = await getAttendees(client, session.id);
  const data = await loadStandingsData(client, session.league_id);
  const order = data.rows.map((r) => r.person_id);
  // Only opted-in players, in standings order.
  const optedIn = new Set(attendees.map((a) => a.person_id));
  const playersInOrder = order.filter((id) => optedIn.has(id));
  const { matches, warnings } = generateSchedule(playersInOrder);

  let oldByKey = new Map();
  if (opts.preserveScores) {
    const old = await getMatches(client, session.id);
    for (const m of old) {
      if (m.kind === 'match' && m.score1 != null) {
        oldByKey.set(matchKey(m), { score1: m.score1, score2: m.score2 });
      }
    }
  }
  await client.query('DELETE FROM matches WHERE session_id = $1', [session.id]);
  await insertMatches(client, session.id, matches);
  if (opts.preserveScores && oldByKey.size) {
    const fresh = await getMatches(client, session.id);
    for (const m of fresh) {
      if (m.kind !== 'match') continue;
      const prev = oldByKey.get(matchKey(m));
      if (prev) {
        await client.query(
          'UPDATE matches SET score1 = $1, score2 = $2 WHERE id = $3',
          [prev.score1, prev.score2, m.id]
        );
      }
    }
  }
  await client.query(
    'UPDATE sessions SET schedule_generated_at = now() WHERE id = $1',
    [session.id]
  );
  const persisted = await getMatches(client, session.id);
  return { matches: persisted, warnings, playerCount: playersInOrder.length };
}

// Rebuild in place after a walk-in / no-show (admin). Keeps scores where
// the same four players stay together.
async function rebuildInPlace(client, session) {
  const { rows } = await client.query(
    'SELECT schedule_generated_at FROM sessions WHERE id = $1',
    [session.id]
  );
  if (!rows[0] || !rows[0].schedule_generated_at) return null;
  return generateForSession(client, session, { preserveScores: true });
}

async function findOrCreatePerson(client, { name, duprId, duprRating, duprProfileUrl }) {
  const clean = String(name).trim();
  if (!clean) throw new Error('Name is required.');
  const existing = await client.query(
    'SELECT * FROM people WHERE lower(name) = lower($1)',
    [clean]
  );
  if (existing.rows[0]) {
    const p = existing.rows[0];
    // Fill in DUPR details if the existing record lacks them.
    await client.query(
      `UPDATE people SET dupr_id = COALESCE(dupr_id, $2), dupr_rating = COALESCE(dupr_rating, $3),
         dupr_profile_url = COALESCE(dupr_profile_url, $4), updated_at = now() WHERE id = $1`,
      [p.id, duprId || null, duprRating || null, duprProfileUrl || null]
    );
    return p;
  }
  const { rows } = await client.query(
    `INSERT INTO people (name, dupr_id, dupr_rating, dupr_profile_url)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [clean, duprId || null, duprRating || null, duprProfileUrl || null]
  );
  return rows[0];
}

// pg returns DATE columns as Date objects (midnight UTC), which JSON
// serializes as full timestamps — and those shift a day in US timezones.
// Leagues carry plain calendar dates, so normalize them to YYYY-MM-DD.
function dateOnly(v) {
  if (v == null) return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}
function normalizeLeague(l) {
  if (!l) return l;
  return {
    ...l,
    start_date: dateOnly(l.start_date),
    stop_date: dateOnly(l.stop_date),
    game_dates: Array.isArray(l.game_dates) ? l.game_dates.map(dateOnly) : l.game_dates,
  };
}
function weeklyDates(startDateStr, count = 8) {
  const out = [];
  const d = new Date(startDateStr + 'T12:00:00Z');
  for (let i = 0; i < count; i++) {
    const cur = new Date(d.getTime() + i * 7 * 24 * 3600 * 1000);
    out.push(cur.toISOString().slice(0, 10));
  }
  return out;
}

async function createLeagueWithSessions(client, fields) {
  const {
    name, type, skill, format, day, time, season = '',
    startDate, stopDate, gameDates, location, maxPlayers = 36, logoColor = 'black-yellow',
  } = fields;
  if (!name || !type || !skill || !day || !time || !startDate || !stopDate) {
    const e = new Error('League name, type, skill, day, time, start and stop dates are required.');
    e.status = 400;
    throw e;
  }
  const dates = gameDates && gameDates.length ? gameDates : weeklyDates(startDate, 8);
  if (gameDates && gameDates.length && gameDates.length !== 8) {
    const e = new Error('A season needs exactly 8 weekly game-day dates.');
    e.status = 400;
    throw e;
  }
  const { rows } = await client.query(
    `INSERT INTO leagues (name, type, skill, format, day, time, season, start_date, stop_date, game_dates, location, max_players, logo_color)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [name, type, skill, format || 'Coed Doubles', day, time, season, startDate, stopDate, dates, location || 'YMCA, 601 26th Ave SE, Moultrie, GA 31768', maxPlayers, logoColor]
  );
  const league = rows[0];
  await client.query(
    'INSERT INTO league_settings (league_id, registration_open) VALUES ($1, TRUE)',
    [league.id]
  );
  const label = `${day} Night`;
  for (let i = 0; i < dates.length; i++) {
    const startsAt = zonedToUtc(dates[i], time);
    await client.query(
      `INSERT INTO sessions (league_id, session_number, date, starts_at, label)
       VALUES ($1,$2,$3,$4,$5)`,
      [league.id, i + 1, dates[i], startsAt, label]
    );
  }
  return league;
}

module.exports = {
  pool,
  effectiveStatus,
  optInWindow,
  getLeague,
  getSessions,
  getSession,
  getAttendees,
  getMatches,
  getRoster,
  loadStandingsData,
  generateForSession,
  rebuildInPlace,
  findOrCreatePerson,
  weeklyDates,
  createLeagueWithSessions,
  dateOnly,
  normalizeLeague,
};

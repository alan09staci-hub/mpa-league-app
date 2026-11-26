'use strict';
// "Your nights" — the nights one player is part of, and who may open the
// play of a night once it is running. Player identity here is the app's
// device-local tap-your-name identity (a personId supplied by the client),
// so this is a view-level restriction like the existing player view — not
// a sign-in lock. Anyone who taps another player's name can see that
// player's nights; real locking would need sign-in. Admin (passcode
// token) always sees everything.
const { pool } = require('../db');
const { computeStandings } = require('./roundrobin');
const { computePlayerStandings } = require('./rotation');
const { resolveBracket, computeBracketPlaces } = require('./bracket');

function asInt(v) {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function teamLabel(t) {
  const p1 = t.guest1 ? `${t.player1} (Guest)` : t.player1;
  const p2 = t.guest2 ? `${t.player2} (Guest)` : t.player2;
  return `${p1} & ${p2}`;
}

// Lowercase names of every MPA member — the set a hand-added or guest
// name is checked against.
async function memberNameSet() {
  const { rows } = await pool.query('SELECT LOWER(name) AS name FROM members');
  return new Set(rows.map((r) => r.name));
}

// A team player is a guest when the row carries no person id and the
// name is not a member's name. Legacy hand-added member teams match by
// name and are not guests.
function markTeamGuests(t, memberNames) {
  t.guest1 = t.person1_id == null && !memberNames.has(String(t.player1).toLowerCase());
  t.guest2 = t.person2_id == null && !memberNames.has(String(t.player2).toLowerCase());
  return t;
}

// Display name for a rotating-night player: guests get the marker.
function markPlayerGuest(p, memberNames) {
  return p.person_id == null && !memberNames.has(String(p.name).toLowerCase())
    ? `${p.name} (Guest)` : p.name;
}

// A stored br_matches row as a lib-style match (mirrors the mapping in
// server/routes/bracket.js).
function toLibMatch(m) {
  return {
    key: m.id,
    bracket: m.bracket,
    round: m.round,
    gameNo: m.game_no,
    slot1: { type: m.slot1_type, ref: m.slot1_ref },
    slot2: { type: m.slot2_type, ref: m.slot2_ref },
    score1: m.score1,
    score2: m.score2,
    target: m.target_score,
  };
}

// The event ids this person is part of: a fixed-team member, a solo
// waiting to be paired, or a rotating-night player. Teams Alan adds by
// hand carry names only — person1_id/person2_id are NULL (migration
// 007) — so those rows are matched by the person's name from the people
// table too. Names are unique in the app (the member form guards
// duplicates), so a name match is the same player.
async function myNightIds(kind, personId) {
  if (personId == null) return new Set();
  const { rows: prow } = await pool.query('SELECT name FROM people WHERE id = $1', [personId]);
  const name = prow.length ? prow[0].name : null;
  const sql =
    kind === 'bracket'
      ? `SELECT event_id FROM br_teams WHERE person1_id = $1 OR person2_id = $1 OR ($2::text IS NOT NULL AND (player1 = $2 OR player2 = $2)) UNION SELECT event_id FROM br_solos WHERE person_id = $1`
      : `SELECT event_id FROM rr_teams WHERE person1_id = $1 OR person2_id = $1 OR ($2::text IS NOT NULL AND (player1 = $2 OR player2 = $2)) UNION SELECT event_id FROM rr_solos WHERE person_id = $1 UNION SELECT event_id FROM rr_rot_players WHERE person_id = $1`;
  const { rows } = await pool.query(sql, [personId, name]);
  return new Set(rows.map((r) => r.event_id));
}

async function isNightParticipant(kind, eventId, personId) {
  if (personId == null) return false;
  return (await myNightIds(kind, personId)).has(eventId);
}

// Headline for one fixed-team round robin night the person is in: the
// leader while playing, the winner once finished — only once anyone has
// played a game. Returns { headline, top }: the top 3 played teams, for
// the archive list's mini-medals.
async function rrFixedHeadline(event) {
  const [teams, matches, memberNames] = await Promise.all([
    pool
      .query('SELECT * FROM rr_teams WHERE event_id = $1 ORDER BY id', [event.id])
      .then((r) => r.rows),
    pool
      .query('SELECT * FROM rr_matches WHERE event_id = $1 ORDER BY round, court', [event.id])
      .then((r) => r.rows),
    memberNameSet(),
  ]);
  teams.forEach((t) => markTeamGuests(t, memberNames));
  const standings = computeStandings(teams, matches);
  const played = standings.filter((s) => s.played > 0);
  if (!played.length) return { headline: null, top: [] };
  const label = teamLabel(played[0].team);
  return {
    headline: event.status === 'completed' ? `Winners: ${label}` : `Leading: ${label}`,
    top: played.slice(0, 3).map((s) => teamLabel(s.team)),
  };
}

// Headline for one rotating-partners night: the top player by the
// night's winner rule. Returns { headline, top }: the top 3 played
// players, for the archive list's mini-medals.
async function rrRotHeadline(event) {
  const [players, matches, memberNames] = await Promise.all([
    pool
      .query('SELECT * FROM rr_rot_players WHERE event_id = $1 ORDER BY id', [event.id])
      .then((r) => r.rows),
    pool
      .query('SELECT * FROM rr_rot_matches WHERE event_id = $1 ORDER BY round, court', [event.id])
      .then((r) => r.rows),
    memberNameSet(),
  ]);
  const standings = computePlayerStandings(
    players.map((p) => ({ id: p.id, name: markPlayerGuest(p, memberNames) })),
    matches,
    event.winner_rule || 'ep'
  );
  const played = standings.filter((s) => s.played > 0);
  if (!played.length) return { headline: null, top: [] };
  return {
    headline: event.status === 'completed'
      ? `Winners: ${played[0].player.name}`
      : `Leading: ${played[0].player.name}`,
    top: played.slice(0, 3).map((s) => s.player.name),
  };
}

// Headline for one bracket night: the champion, once decided. Returns
// { headline, top }: the podium labels (champion, runner-up, third) for
// the archive list's mini-medals.
async function bracketHeadline(event) {
  const [teams, matches, memberNames] = await Promise.all([
    pool
      .query('SELECT * FROM br_teams WHERE event_id = $1 ORDER BY id', [event.id])
      .then((r) => r.rows),
    pool
      .query('SELECT * FROM br_matches WHERE event_id = $1 ORDER BY id', [event.id])
      .then((r) => r.rows),
    memberNameSet(),
  ]);
  teams.forEach((t) => markTeamGuests(t, memberNames));
  if (!matches.length) return { headline: null, top: [] };
  const libMatches = matches.map(toLibMatch);
  const seedToTeamId = new Map(
    teams.filter((t) => t.seed != null).map((t) => [t.seed, t.id])
  );
  const resolved = resolveBracket(libMatches, seedToTeamId);
  const podium = computeBracketPlaces(libMatches, resolved);
  if (podium.champion == null) return { headline: null, top: [] };
  const labelOf = (id) => {
    const t = teams.find((x) => x.id === id);
    return t ? teamLabel(t) : null;
  };
  return {
    headline: `Champions: ${labelOf(podium.champion)}`,
    top: [podium.champion, podium.runnerUp, podium.third].map(labelOf).filter(Boolean),
  };
}

// Every night this person is part of, newest first, with the fields the
// landing page's "Your nights" section needs.
async function myNights(personId) {
  if (personId == null) return [];
  const [rrIds, brIds] = await Promise.all([
    myNightIds('rr', personId),
    myNightIds('bracket', personId),
  ]);
  const out = [];
  for (const id of rrIds) {
    const { rows } = await pool.query('SELECT * FROM rr_events WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!rows.length) continue;
    const event = rows[0];
    out.push({
      id: event.id,
      kind: 'rr',
      name: event.name,
      event_date: event.event_date,
      start_time: event.start_time,
      status: event.status,
      format: event.format,
      headline: (event.format === 'rotating'
        ? await rrRotHeadline(event)
        : await rrFixedHeadline(event)).headline,
    });
  }
  for (const id of brIds) {
    const { rows } = await pool.query('SELECT * FROM br_events WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!rows.length) continue;
    const event = rows[0];
    out.push({
      id: event.id,
      kind: 'bracket',
      name: event.name,
      event_date: event.event_date,
      start_time: event.start_time,
      status: event.status,
      format: null,
      headline: (await bracketHeadline(event)).headline,
    });
  }
  out.sort((a, b) => {
    const da = String(a.event_date || '');
    const db = String(b.event_date || '');
    return da < db ? 1 : da > db ? -1 : b.id - a.id;
  });
  return out;
}

module.exports = { asInt, myNightIds, isNightParticipant, myNights, teamLabel, memberNameSet, markTeamGuests, markPlayerGuest, rrFixedHeadline, rrRotHeadline, bracketHeadline };

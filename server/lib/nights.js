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
  return `${t.player1} & ${t.player2}`;
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
// waiting to be paired, or a rotating-night player. Hand-added teams
// carry NULL person ids and never match.
async function myNightIds(kind, personId) {
  if (personId == null) return new Set();
  const sql =
    kind === 'bracket'
      ? `SELECT event_id FROM br_teams WHERE person1_id = $1 OR person2_id = $1
         UNION SELECT event_id FROM br_solos WHERE person_id = $1`
      : `SELECT event_id FROM rr_teams WHERE person1_id = $1 OR person2_id = $1
         UNION SELECT event_id FROM rr_solos WHERE person_id = $1
         UNION SELECT event_id FROM rr_rot_players WHERE person_id = $1`;
  const { rows } = await pool.query(sql, [personId]);
  return new Set(rows.map((r) => r.event_id));
}

async function isNightParticipant(kind, eventId, personId) {
  if (personId == null) return false;
  return (await myNightIds(kind, personId)).has(eventId);
}

// Headline for one fixed-team round robin night the person is in: the
// leader while playing, the winner once finished — only once anyone has
// played a game.
async function rrFixedHeadline(event) {
  const [teams, matches] = await Promise.all([
    pool
      .query('SELECT * FROM rr_teams WHERE event_id = $1 ORDER BY id', [event.id])
      .then((r) => r.rows),
    pool
      .query('SELECT * FROM rr_matches WHERE event_id = $1 ORDER BY round, court', [event.id])
      .then((r) => r.rows),
  ]);
  const standings = computeStandings(teams, matches);
  const top = standings[0];
  if (!top || top.played === 0) return null;
  const label = teamLabel(top.team);
  return event.status === 'completed' ? `Winners: ${label}` : `Leading: ${label}`;
}

// Headline for one rotating-partners night: the top player by the
// night's winner rule.
async function rrRotHeadline(event) {
  const [players, matches] = await Promise.all([
    pool
      .query('SELECT * FROM rr_rot_players WHERE event_id = $1 ORDER BY id', [event.id])
      .then((r) => r.rows),
    pool
      .query('SELECT * FROM rr_rot_matches WHERE event_id = $1 ORDER BY round, court', [event.id])
      .then((r) => r.rows),
  ]);
  const standings = computePlayerStandings(
    players.map((p) => ({ id: p.id, name: p.name })),
    matches,
    event.winner_rule || 'ep'
  );
  const top = standings[0];
  if (!top || top.played === 0) return null;
  return event.status === 'completed'
    ? `Winners: ${top.player.name}`
    : `Leading: ${top.player.name}`;
}

// Headline for one bracket night: the champion, once decided.
async function bracketHeadline(event) {
  const [teams, matches] = await Promise.all([
    pool
      .query('SELECT * FROM br_teams WHERE event_id = $1 ORDER BY id', [event.id])
      .then((r) => r.rows),
    pool
      .query('SELECT * FROM br_matches WHERE event_id = $1 ORDER BY id', [event.id])
      .then((r) => r.rows),
  ]);
  if (!matches.length) return null;
  const libMatches = matches.map(toLibMatch);
  const seedToTeamId = new Map(
    teams.filter((t) => t.seed != null).map((t) => [t.seed, t.id])
  );
  const resolved = resolveBracket(libMatches, seedToTeamId);
  const podium = computeBracketPlaces(libMatches, resolved);
  if (podium.champion == null) return null;
  const champ = teams.find((t) => t.id === podium.champion);
  return champ ? `Champions: ${teamLabel(champ)}` : null;
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
    const { rows } = await pool.query('SELECT * FROM rr_events WHERE id = $1', [id]);
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
      headline:
        event.format === 'rotating'
          ? await rrRotHeadline(event)
          : await rrFixedHeadline(event),
    });
  }
  for (const id of brIds) {
    const { rows } = await pool.query('SELECT * FROM br_events WHERE id = $1', [id]);
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
      headline: await bracketHeadline(event),
    });
  }
  out.sort((a, b) => {
    const da = String(a.event_date || '');
    const db = String(b.event_date || '');
    return da < db ? 1 : da > db ? -1 : b.id - a.id;
  });
  return out;
}

module.exports = { asInt, myNightIds, isNightParticipant, myNights };

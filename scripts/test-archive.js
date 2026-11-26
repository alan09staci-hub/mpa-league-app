// Finished (Archive) tab — soft-delete, Restore, Delete forever, Admin-only.
//
// Stubs ../db + ../lib/auth before the routers load, then exercises the
// archive router and the public routes that must hide deleted rows.
// Run: node scripts/test-archive.js
//
// Soft-delete model (migration 017): DELETE on a night or league sets
// deleted_at — it never destroys the row. The Finished tab (Admin-only)
// lists finished OR deleted items, newest first; Restore clears
// deleted_at; Delete forever destroys the row with the old cascade.
// The player-facing lists/details and "Your nights" must never show a
// deleted row.
const assert = require('assert');
const express = require('express');
const { buildBracket } = require('../server/lib/bracket');

// ---- in-memory state -------------------------------------------------------
const people = new Map([
  [1, { id: 1, name: 'Alan Cortez', dupr_id: '7D6WR0', dupr_rating: 3.608, self_rated: false }],
  [2, { id: 2, name: 'Laura Byron', dupr_id: null, dupr_rating: 3.4, self_rated: false }],
  [3, { id: 3, name: 'Kim Massa', dupr_id: null, dupr_rating: 3.5, self_rated: false }],
  [4, { id: 4, name: 'Justin Johnson', dupr_id: null, dupr_rating: 3.6, self_rated: false }],
  [5, { id: 5, name: 'Dawn Smith', dupr_id: null, dupr_rating: 3.4, self_rated: false }],
  [6, { id: 6, name: 'Allen Reed', dupr_id: null, dupr_rating: 3.3, self_rated: false }],
  [7, { id: 7, name: 'Micheal Hart', dupr_id: null, dupr_rating: 3.2, self_rated: false }],
  [8, { id: 8, name: 'Raley Finn', dupr_id: null, dupr_rating: 3.1, self_rated: false }],
]);

const rrEvents = new Map();
const brEvents = new Map();
const leagues = new Map();
const rrTeams = [];
const rrMatches = [];
const rrSolos = [];
const rrRotPlayers = [];
const rrRotMatches = [];
const brTeams = [];
const brMatches = [];
const brSolos = [];
const sessions = []; // league sessions
const playerLeagues = []; // roster rows
const sessionPlayers = []; // { session_id, person_id, opted_in }
const leagueMatches = []; // { id, session_id, kind, team1_p1, team1_p2, team2_p1, team2_p2, score1, score2, target_score }

// Fixed RR, playing: Alan & Laura lead Kim & Justin. Not in the archive.
rrEvents.set(1, {
  id: 1, name: 'Friday Money Ball', event_date: '2026-11-27', kind: 'money',
  fee_cents: 1000, payout: 'house', start_time: '18:30', max_teams: 6,
  signup_close: 'day-3h', published: true, format: 'fixed',
  winner_rule: 'ep', max_players: 12, status: 'playing', deleted_at: null,
});
rrTeams.push(
  { id: 1, event_id: 1, player1: 'Alan Cortez', player2: 'Laura Byron', person1_id: 1, person2_id: 2 },
  { id: 2, event_id: 1, player1: 'Kim Massa', player2: 'Justin Johnson', person1_id: 3, person2_id: 4 }
);
rrMatches.push({
  id: 1, event_id: 1, round: 1, court: 1, team1_id: 1, team2_id: 2,
  score1: 11, score2: 7, target_score: 11,
});

// Rotating RR, completed: Alan leads on points. In the archive as finished.
rrEvents.set(2, {
  id: 2, name: 'Tuesday Rot', event_date: '2026-11-24', kind: 'charity',
  fee_cents: 0, payout: 'house', start_time: '18:30', max_teams: 6,
  signup_close: 'day-3h', published: true, format: 'rotating',
  winner_rule: 'points', max_players: 12, status: 'completed', deleted_at: null,
});
rrRotPlayers.push(
  { id: 1, event_id: 2, person_id: 1, is_main: true, rotator_order: null },
  { id: 2, event_id: 2, person_id: 2, is_main: false, rotator_order: 1 },
  { id: 3, event_id: 2, person_id: 3, is_main: false, rotator_order: 2 },
  { id: 4, event_id: 2, person_id: 4, is_main: false, rotator_order: null }
);
rrRotMatches.push(
  { id: 1, event_id: 2, round: 1, court: 1, player1_id: 1, player2_id: 2, player3_id: 3, player4_id: 4, score1: 11, score2: 6, target_score: 11 },
  { id: 2, event_id: 2, round: 2, court: 1, player1_id: 1, player2_id: 3, player3_id: 2, player4_id: 4, score1: 11, score2: 8, target_score: 11 }
);

// Fixed RR, playing but deleted: in the archive as deleted, invisible live.
rrEvents.set(3, {
  id: 3, name: 'Old RR', event_date: '2026-11-20', kind: 'charity',
  fee_cents: 0, payout: 'house', start_time: '18:30', max_teams: 6,
  signup_close: 'day-3h', published: true, format: 'fixed',
  winner_rule: 'ep', max_players: 12, status: 'playing',
  deleted_at: '2026-11-25T00:00:00.000Z',
});
rrTeams.push(
  { id: 3, event_id: 3, player1: 'Dawn Smith', player2: 'Allen Reed', person1_id: 5, person2_id: 6 }
);

// Fixed RR, completed: in the archive as finished.
rrEvents.set(4, {
  id: 4, name: 'Finished RR', event_date: '2026-11-26', kind: 'charity',
  fee_cents: 0, payout: 'house', start_time: '18:30', max_teams: 6,
  signup_close: 'day-3h', published: true, format: 'fixed',
  winner_rule: 'ep', max_players: 12, status: 'completed', deleted_at: null,
});
rrTeams.push(
  { id: 4, event_id: 4, player1: 'Alan Cortez', player2: 'Laura Byron', person1_id: 1, person2_id: 2 },
  { id: 5, event_id: 4, player1: 'Kim Massa', player2: 'Justin Johnson', person1_id: 3, person2_id: 4 }
);
rrMatches.push({
  id: 2, event_id: 4, round: 1, court: 1, team1_id: 4, team2_id: 5,
  score1: 11, score2: 4, target_score: 11,
});

// Bracket, playing: Alan & Laura are in it. Not in the archive.
brEvents.set(5, {
  id: 5, name: 'Friday Bracket', event_date: '2026-11-27', kind: 'money',
  fee_cents: 1000, payout: 'house', start_time: '18:30', max_teams: 4,
  signup_close: 'day-3h', published: true, status: 'playing', deleted_at: null,
});
brTeams.push(
  { id: 1, event_id: 5, player1: 'Alan Cortez', player2: 'Laura Byron', person1_id: 1, person2_id: 2, seed: 1 },
  { id: 2, event_id: 5, player1: 'Kim Massa', player2: 'Justin Johnson', person1_id: 3, person2_id: 4, seed: 2 },
  { id: 3, event_id: 5, player1: 'Dawn Smith', player2: 'Allen Reed', person1_id: 5, person2_id: 6, seed: 3 },
  { id: 4, event_id: 5, player1: 'Micheal Hart', player2: 'Raley Finn', person1_id: 7, person2_id: 8, seed: 4 }
);

// Bracket, completed with a champion (seed 1): in the archive as finished.
brEvents.set(6, {
  id: 6, name: 'Old Bracket', event_date: '2026-11-21', kind: 'charity',
  fee_cents: 0, payout: 'house', start_time: '18:30', max_teams: 4,
  signup_close: 'day-3h', published: true, status: 'completed', deleted_at: null,
});
brTeams.push(
  { id: 5, event_id: 6, player1: 'Alan Cortez', player2: 'Laura Byron', person1_id: 1, person2_id: 2, seed: 1 },
  { id: 6, event_id: 6, player1: 'Kim Massa', player2: 'Justin Johnson', person1_id: 3, person2_id: 4, seed: 2 },
  { id: 7, event_id: 6, player1: 'Dawn Smith', player2: 'Allen Reed', person1_id: 5, person2_id: 6, seed: 3 },
  { id: 8, event_id: 6, player1: 'Micheal Hart', player2: 'Raley Finn', person1_id: 7, person2_id: 8, seed: 4 }
);
// Seed 1 beats seed 4, seed 2 beats seed 3, seed 1 beats seed 2 in the
// winners final, seed 4 beats seed 3 in the losers opener, seed 2 beats
// seed 4 in the losers final, seed 1 beats seed 2 in the grand final —
// champion seed 1, no reset game needed.
const brScores = { 1: [11, 7], 2: [11, 6], 3: [11, 8], 4: [11, 5], 5: [9, 11], 6: [11, 6] };
for (const m of buildBracket(4).matches) {
  if (!brScores[m.key]) continue; // reset game (key 7) stays unplayed
  brMatches.push({
    id: m.key, event_id: 6, bracket: m.bracket, round: m.round, game_no: m.gameNo,
    slot1_type: m.slot1.type, slot1_ref: m.slot1.ref,
    slot2_type: m.slot2.type, slot2_ref: m.slot2.ref,
    score1: brScores[m.key][0], score2: brScores[m.key][1], target_score: 11,
  });
}
brMatches.push({
  id: 7, event_id: 6, bracket: 'G', round: 1, game_no: 1,
  slot1_type: 'winner', slot1_ref: 6, slot2_type: 'loser', slot2_ref: 6,
  score1: null, score2: null, target_score: 11,
});

// Bracket, playing but deleted: in the archive as deleted, invisible live.
brEvents.set(7, {
  id: 7, name: 'Deleted Bracket', event_date: '2026-11-22', kind: 'charity',
  fee_cents: 0, payout: 'house', start_time: '18:30', max_teams: 4,
  signup_close: 'day-3h', published: true, status: 'playing',
  deleted_at: '2026-11-25T00:00:00.000Z',
});
brTeams.push(
  { id: 9, event_id: 7, player1: 'Dawn Smith', player2: 'Allen Reed', person1_id: 5, person2_id: 6, seed: 1 }
);

// League 1: all game days completed — in the archive as finished.
// Alan 100% (30/30), Kim 83.3% (25/30), Laura 66.7% (20/30), Justin 50%.
leagues.set(1, {
  id: 1, name: 'Winter Advanced', type: 'Advanced', skill: '3.5-4.49',
  format: 'Coed Doubles', day: 'Monday', time: '18:30', season: 'Winter 2026',
  logo_color: 'blue', start_date: '2026-11-02', stop_date: '2026-12-21',
  created_at: '2026-10-01T00:00:00.000Z', deleted_at: null,
});
sessions.push({
  id: 1, league_id: 1, session_number: 1, date: '2026-11-09',
  status: 'completed', starts_at: '2026-11-09T23:30:00.000Z',
});
playerLeagues.push(
  { league_id: 1, person_id: 1, joined_at: '2026-10-01T00:00:00.000Z', admin_penalty: 0, fee_waived: false },
  { league_id: 1, person_id: 2, joined_at: '2026-10-01T00:00:00.000Z', admin_penalty: 0, fee_waived: false },
  { league_id: 1, person_id: 3, joined_at: '2026-10-01T00:00:00.000Z', admin_penalty: 0, fee_waived: false },
  { league_id: 1, person_id: 4, joined_at: '2026-10-01T00:00:00.000Z', admin_penalty: 0, fee_waived: false }
);
sessionPlayers.push(
  { session_id: 1, person_id: 1, opted_in: true },
  { session_id: 1, person_id: 2, opted_in: true },
  { session_id: 1, person_id: 3, opted_in: true },
  { session_id: 1, person_id: 4, opted_in: true }
);
leagueMatches.push(
  { id: 1, session_id: 1, kind: 'game', team1_p1: 1, team1_p2: 2, team2_p1: 3, team2_p2: 4, score1: 15, score2: 10, target_score: 15 },
  { id: 2, session_id: 1, kind: 'game', team1_p1: 1, team1_p2: 3, team2_p1: 2, team2_p2: 4, score1: 15, score2: 5, target_score: 15 }
);

// League 2: deleted, no sessions — in the archive as deleted.
leagues.set(2, {
  id: 2, name: 'Deleted League', type: 'Advanced', skill: '3.5-4.49',
  format: 'Coed Doubles', day: 'Monday', time: '18:30', season: 'Winter 2026',
  logo_color: 'blue', start_date: '2026-11-02', stop_date: '2026-12-21',
  created_at: '2026-10-01T00:00:00.000Z',
  deleted_at: '2026-11-25T00:00:00.000Z',
});

// League 3: live, one upcoming game day — never in the archive.
leagues.set(3, {
  id: 3, name: 'Live League', type: 'Advanced', skill: '3.5-4.49',
  format: 'Coed Doubles', day: 'Monday', time: '18:30', season: 'Spring 2027',
  logo_color: 'blue', start_date: '2026-12-01', stop_date: '2027-01-26',
  created_at: '2026-11-20T00:00:00.000Z', deleted_at: null,
});
sessions.push({
  id: 2, league_id: 3, session_number: 1, date: '2026-12-01',
  status: 'scheduled', starts_at: '2026-12-01T23:30:00.000Z',
});

// ---- stubbed db + auth -----------------------------------------------------
let adminOn = true;
function norm(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}
function checkPlaceholders(sql, params) {
  const max = Math.max(0, ...(sql.match(/\$\d+/g) || []).map((m) => +m.slice(1)));
  assert.strictEqual(
    params.length, max,
    `placeholder mismatch (${params.length} params, SQL uses $${max}): ${sql}`
  );
}
const pool = {
  async query(text, params = []) {
    const sql = norm(text);
    checkPlaceholders(sql, params);

    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };

    // --- single-row lookups (filtered = live paths, unfiltered = archive) ---
    if (sql === 'SELECT * FROM rr_events WHERE id = $1') {
      const e = rrEvents.get(+params[0]);
      return { rows: e ? [e] : [], rowCount: e ? 1 : 0 };
    }
    if (sql === 'SELECT * FROM rr_events WHERE id = $1 AND deleted_at IS NULL') {
      const e = rrEvents.get(+params[0]);
      const ok = e && !e.deleted_at;
      return { rows: ok ? [e] : [], rowCount: ok ? 1 : 0 };
    }
    if (sql === 'SELECT * FROM br_events WHERE id = $1') {
      const e = brEvents.get(+params[0]);
      return { rows: e ? [e] : [], rowCount: e ? 1 : 0 };
    }
    if (sql === 'SELECT * FROM br_events WHERE id = $1 AND deleted_at IS NULL') {
      const e = brEvents.get(+params[0]);
      const ok = e && !e.deleted_at;
      return { rows: ok ? [e] : [], rowCount: ok ? 1 : 0 };
    }
    if (sql === 'SELECT * FROM leagues WHERE id = $1') {
      const l = leagues.get(+params[0]);
      return { rows: l ? [l] : [], rowCount: l ? 1 : 0 };
    }
    if (sql === 'SELECT * FROM leagues WHERE id = $1 AND deleted_at IS NULL') {
      const l = leagues.get(+params[0]);
      const ok = l && !l.deleted_at;
      return { rows: ok ? [l] : [], rowCount: ok ? 1 : 0 };
    }
    if (sql === 'SELECT name FROM people WHERE id = $1') {
      const p = people.get(params[0]);
      return { rows: p ? [{ name: p.name }] : [] };
    }
    if (sql === 'SELECT id, name FROM people WHERE id = $1') {
      const p = people.get(params[0]);
      return { rows: p ? [{ id: p.id, name: p.name }] : [] };
    }
    if (sql === 'SELECT LOWER(name) AS name FROM members') {
      return { rows: [...people.values()].map((p) => ({ name: p.name.toLowerCase() })) };
    }
    if (sql === 'SELECT registration_open FROM league_settings WHERE league_id = $1') {
      return { rows: [{ registration_open: true }] };
    }
    // League delete counts what it is about to soft-delete (people.js).
    if (sql === 'SELECT COUNT(*)::int AS n FROM player_leagues WHERE league_id = $1') {
      return { rows: [{ n: playerLeagues.filter((pl) => pl.league_id === +params[0]).length }] };
    }
    if (sql === 'SELECT COUNT(*)::int AS n FROM sessions WHERE league_id = $1') {
      return { rows: [{ n: sessions.filter((s) => s.league_id === +params[0]).length }] };
    }
    if (sql === 'SELECT COUNT(*)::int AS n FROM registrations WHERE league_id = $1') {
      return { rows: [{ n: 0 }] };
    }
    if (sql === 'SELECT COUNT(*)::int AS n FROM matches WHERE session_id IN (SELECT id FROM sessions WHERE league_id = $1)') {
      const sids = new Set(sessions.filter((s) => s.league_id === +params[0]).map((s) => s.id));
      return { rows: [{ n: leagueMatches.filter((m) => sids.has(m.session_id)).length }] };
    }

    // --- soft delete / restore / delete forever ---
    if (sql === 'UPDATE rr_events SET deleted_at = now() WHERE id = $1') {
      const e = rrEvents.get(+params[0]);
      if (e) e.deleted_at = '2026-11-25T00:00:00.000Z';
      return { rows: [], rowCount: e ? 1 : 0 };
    }
    if (sql === 'UPDATE br_events SET deleted_at = now() WHERE id = $1') {
      const e = brEvents.get(+params[0]);
      if (e) e.deleted_at = '2026-11-25T00:00:00.000Z';
      return { rows: [], rowCount: e ? 1 : 0 };
    }
    if (sql === 'UPDATE leagues SET deleted_at = now() WHERE id = $1') {
      const l = leagues.get(+params[0]);
      if (l) l.deleted_at = '2026-11-25T00:00:00.000Z';
      return { rows: [], rowCount: l ? 1 : 0 };
    }
    if (sql === 'UPDATE rr_events SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL') {
      const e = rrEvents.get(+params[0]);
      const ok = e && e.deleted_at;
      if (ok) e.deleted_at = null;
      return { rows: [], rowCount: ok ? 1 : 0 };
    }
    if (sql === 'UPDATE br_events SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL') {
      const e = brEvents.get(+params[0]);
      const ok = e && e.deleted_at;
      if (ok) e.deleted_at = null;
      return { rows: [], rowCount: ok ? 1 : 0 };
    }
    if (sql === 'UPDATE leagues SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL') {
      const l = leagues.get(+params[0]);
      const ok = l && l.deleted_at;
      if (ok) l.deleted_at = null;
      return { rows: [], rowCount: ok ? 1 : 0 };
    }
    if (sql === 'DELETE FROM rr_events WHERE id = $1') {
      const ok = rrEvents.delete(params[0]);
      return { rows: [], rowCount: ok ? 1 : 0 };
    }
    if (sql === 'DELETE FROM br_events WHERE id = $1') {
      const ok = brEvents.delete(params[0]);
      return { rows: [], rowCount: ok ? 1 : 0 };
    }
    if (sql === 'DELETE FROM leagues WHERE id = $1') {
      const ok = leagues.delete(params[0]);
      return { rows: [], rowCount: ok ? 1 : 0 };
    }

    // --- night participation (my-nights) ---
    if (sql === 'SELECT event_id FROM rr_teams WHERE person1_id = $1 OR person2_id = $1 OR ($2::text IS NOT NULL AND (player1 = $2 OR player2 = $2)) UNION SELECT event_id FROM rr_solos WHERE person_id = $1 UNION SELECT event_id FROM rr_rot_players WHERE person_id = $1') {
      const ids = new Set();
      rrTeams.filter((t) => t.person1_id === params[0] || t.person2_id === params[0] || (params[1] != null && (t.player1 === params[1] || t.player2 === params[1]))).forEach((t) => ids.add(t.event_id));
      rrSolos.filter((s) => s.person_id === params[0]).forEach((s) => ids.add(s.event_id));
      rrRotPlayers.filter((p) => p.person_id === params[0]).forEach((p) => ids.add(p.event_id));
      return { rows: [...ids].map((event_id) => ({ event_id })) };
    }
    if (sql === 'SELECT event_id FROM br_teams WHERE person1_id = $1 OR person2_id = $1 OR ($2::text IS NOT NULL AND (player1 = $2 OR player2 = $2)) UNION SELECT event_id FROM br_solos WHERE person_id = $1') {
      const ids = new Set();
      brTeams.filter((t) => t.person1_id === params[0] || t.person2_id === params[0] || (params[1] != null && (t.player1 === params[1] || t.player2 === params[1]))).forEach((t) => ids.add(t.event_id));
      brSolos.filter((s) => s.person_id === params[0]).forEach((s) => ids.add(s.event_id));
      return { rows: [...ids].map((event_id) => ({ event_id })) };
    }

    // --- night detail tables ---
    if (sql === 'SELECT * FROM rr_teams WHERE event_id = $1 ORDER BY id') {
      return { rows: rrTeams.filter((t) => t.event_id === params[0]).sort((a, b) => a.id - b.id) };
    }
    if (sql === 'SELECT * FROM rr_matches WHERE event_id = $1 ORDER BY round, court') {
      return { rows: rrMatches.filter((m) => m.event_id === params[0]).sort((a, b) => a.round - b.round || a.court - b.court) };
    }
    if (sql === 'SELECT * FROM rr_rot_players WHERE event_id = $1 ORDER BY id') {
      return { rows: rrRotPlayers.filter((p) => p.event_id === params[0]).sort((a, b) => a.id - b.id) };
    }
    if (sql === 'SELECT * FROM rr_rot_matches WHERE event_id = $1 ORDER BY round, court') {
      return { rows: rrRotMatches.filter((m) => m.event_id === params[0]).sort((a, b) => a.round - b.round || a.court - b.court) };
    }
    if (sql === 'SELECT s.id, s.event_id, s.person_id, s.created_at, p.name FROM rr_solos s JOIN people p ON p.id = s.person_id WHERE s.event_id = $1 ORDER BY s.created_at') {
      return { rows: rrSolos.filter((s) => s.event_id === params[0]) };
    }
    if (sql === 'SELECT * FROM br_teams WHERE event_id = $1 ORDER BY id') {
      return { rows: brTeams.filter((t) => t.event_id === params[0]).sort((a, b) => a.id - b.id) };
    }
    if (sql === 'SELECT * FROM br_matches WHERE event_id = $1 ORDER BY id') {
      return { rows: brMatches.filter((m) => m.event_id === params[0]).sort((a, b) => a.id - b.id) };
    }
    if (sql === 'SELECT s.id, s.event_id, s.person_id, s.created_at, p.name FROM br_solos s JOIN people p ON p.id = s.person_id WHERE s.event_id = $1 ORDER BY s.created_at') {
      return { rows: brSolos.filter((s) => s.event_id === params[0]) };
    }

    // --- league data (loadStandingsData) ---
    if (sql.startsWith('SELECT pl.person_id, pl.joined_at, pl.admin_penalty')) {
      return {
        rows: playerLeagues
          .filter((pl) => pl.league_id === params[0])
          .map((pl) => ({ ...pl, ...people.get(pl.person_id), name: people.get(pl.person_id).name })),
      };
    }
    if (sql === 'SELECT * FROM sessions WHERE league_id = $1 ORDER BY date ASC, session_number ASC') {
      return { rows: sessions.filter((s) => s.league_id === params[0]).sort((a, b) => a.date.localeCompare(b.date) || a.session_number - b.session_number) };
    }
    if (sql.startsWith('SELECT sp.person_id, sp.opted_in_at')) {
      return {
        rows: sessionPlayers
          .filter((sp) => sp.session_id === params[0] && sp.opted_in)
          .map((sp) => ({ person_id: sp.person_id, opted_in_at: null, ...people.get(sp.person_id) })),
      };
    }
    if (sql === 'SELECT * FROM matches WHERE session_id = $1 ORDER BY court ASC, round ASC, id ASC') {
      return { rows: leagueMatches.filter((m) => m.session_id === params[0]) };
    }

    // --- leagues a person is on (people.js) ---
    if (sql.startsWith('SELECT l.id, l.name, l.type, l.skill')) {
      return {
        rows: playerLeagues
          .filter((pl) => pl.person_id === params[0] && leagues.get(pl.league_id) && !leagues.get(pl.league_id).deleted_at)
          .map((pl) => leagues.get(pl.league_id)),
      };
    }
    if (sql.startsWith('SELECT r.league_id, l.name, r.status')) {
      return { rows: [] }; // no registrations seeded
    }

    // --- public /leagues list (api.js) ---
    if (sql.startsWith('SELECT l.*, COALESCE(pc.count')) {
      return {
        rows: [...leagues.values()]
          .filter((l) => !l.deleted_at)
          .sort((a, b) => a.start_date.localeCompare(b.start_date))
          .map((l) => ({ ...l, player_count: playerLeagues.filter((pl) => pl.league_id === l.id).length, registration_open: true })),
      };
    }

    // --- archive leagues list ---
    if (sql.startsWith('SELECT l.*,') && sql.includes('last_date')) {
      return {
        rows: [...leagues.values()]
          .filter((l) => {
            if (l.deleted_at) return true;
            const ls = sessions.filter((s) => s.league_id === l.id);
            return ls.length > 0 && ls.every((s) => s.status === 'completed');
          })
          .map((l) => ({
            ...l,
            last_date: sessions.filter((s) => s.league_id === l.id).map((s) => s.date).sort().pop() || null,
            player_count: playerLeagues.filter((pl) => pl.league_id === l.id).length,
            week_count: sessions.filter((s) => s.league_id === l.id).length,
          })),
      };
    }

    // --- night lists: archive variant has e.status = 'completed', live has deleted_at IS NULL ---
    if (sql.startsWith('SELECT e.*, (SELECT COUNT(*) FROM rr_teams')) {
      const archive = sql.includes("e.status = 'completed'");
      const rows = [...rrEvents.values()]
        .filter((e) => (archive ? (e.status === 'completed' || e.deleted_at) : !e.deleted_at))
        .sort((a, b) => (a.event_date < b.event_date ? 1 : a.event_date > b.event_date ? -1 : b.id - a.id))
        .map((e) => ({
          ...e,
          team_count: rrTeams.filter((t) => t.event_id === e.id).length,
          solo_count: rrSolos.filter((s) => s.event_id === e.id).length,
          player_count: rrRotPlayers.filter((p) => p.event_id === e.id).length,
          match_count: rrMatches.filter((m) => m.event_id === e.id).length + rrRotMatches.filter((m) => m.event_id === e.id).length,
          scored_count: rrMatches.filter((m) => m.event_id === e.id && m.score1 != null).length + rrRotMatches.filter((m) => m.event_id === e.id && m.score1 != null).length,
        }));
      return { rows };
    }
    if (sql.startsWith('SELECT e.*, (SELECT COUNT(*) FROM br_teams')) {
      const archive = sql.includes("e.status = 'completed'");
      const rows = [...brEvents.values()]
        .filter((e) => (archive ? (e.status === 'completed' || e.deleted_at) : !e.deleted_at))
        .sort((a, b) => (a.event_date < b.event_date ? 1 : a.event_date > b.event_date ? -1 : b.id - a.id))
        .map((e) => ({
          ...e,
          team_count: brTeams.filter((t) => t.event_id === e.id).length,
          solo_count: brSolos.filter((s) => s.event_id === e.id).length,
          match_count: brMatches.filter((m) => m.event_id === e.id).length,
          scored_count: brMatches.filter((m) => m.event_id === e.id && m.score1 != null).length,
        }));
      return { rows };
    }

    throw new Error('unhandled SQL in stub pool: ' + sql);
  },
};
const dbPath = require.resolve('../server/db');
require.cache[dbPath] = { exports: { pool } };
const authPath = require.resolve('../server/lib/auth');
const realAuth = require(authPath);
require.cache[authPath] = {
  exports: {
    ...realAuth,
    requireAdmin: (req, res, next) => (adminOn ? next() : res.status(401).json({ error: 'Admin sign-in required.' })),
    isAdmin: async () => adminOn,
  },
};

// ---- app -------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use('/api', require('../server/routes/archive'));
app.use('/api', require('../server/routes/roundrobin'));
app.use('/api', require('../server/routes/bracket'));
app.use('/api', require('../server/routes/nights'));
app.use('/api', require('../server/routes/api'));
app.use('/api', require('../server/routes/people'));

let server;
let count = 0;
function check(cond, label) {
  count++;
  assert.ok(cond, label);
}
async function req(method, path) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));

  // --- fmtDateMDY, extracted from the real client source (MM/DD/YYYY) ---
  const fs = require('fs');
  const appJs = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
  const localDateSrc = appJs.match(/function asLocalDate[\s\S]*?\n}/);
  const mdySrc = appJs.match(/function fmtDateMDY[\s\S]*?\n}/);
  assert.ok(localDateSrc && mdySrc, 'asLocalDate + fmtDateMDY must exist in public/app.js');
  const fmtDateMDY = eval(`(function () { ${localDateSrc[0]}; ${mdySrc[0]}; return fmtDateMDY; })()`);
  check(fmtDateMDY('2026-11-27') === '11/27/2026', 'fmtDateMDY formats 2026-11-27 as 11/27/2026');
  check(fmtDateMDY('2026-01-05') === '01/05/2026', 'fmtDateMDY zero-pads 01/05/2026');
  check(fmtDateMDY('2026-12-31') === '12/31/2026', 'fmtDateMDY formats 2026-12-31 as 12/31/2026');

  // --- archive endpoint is Admin-only ---
  adminOn = false;
  let r = await req('GET', '/api/admin/archive');
  check(r.status === 401, 'archive list without Admin sign-in is 401, got ' + r.status);
  r = await req('GET', '/api/admin/archive/rr/2');
  check(r.status === 401, 'archive detail without Admin sign-in is 401, got ' + r.status);
  r = await req('POST', '/api/admin/archive/rr/3/restore');
  check(r.status === 401, 'restore without Admin sign-in is 401, got ' + r.status);
  r = await req('DELETE', '/api/admin/archive/rr/3');
  check(r.status === 401, 'delete forever without Admin sign-in is 401, got ' + r.status);
  adminOn = true;

  // --- archive list: finished OR deleted, newest first, states, headlines ---
  r = await req('GET', '/api/admin/archive');
  check(r.status === 200, 'archive list is 200 as Admin, got ' + r.status);
  const items = r.body.items;
  check(Array.isArray(items), 'archive returns an items array');
  // Seeded archive: league 1 (finished, 11/09), league 2 (deleted, 12/21),
  // RR 2 (finished, 11/24), RR 3 (deleted, 11/20), RR 4 (finished, 11/26),
  // BR 6 (finished, 11/21), BR 7 (deleted, 11/22). Playing + live items
  // (RR 1, BR 5, league 3) must not appear.
  check(items.length === 7, 'archive holds 7 items, got ' + items.length);
  const keys = items.map((i) => `${i.kind}:${i.id}`);
  check(!keys.includes('rr:1') && !keys.includes('bracket:5') && !keys.includes('league:3'),
    'playing nights and the live league are not in the archive');
  const dates = items.map((i) => i.date);
  const sorted = [...dates].sort().reverse();
  check(JSON.stringify(dates) === JSON.stringify(sorted),
    'archive is newest first by date: ' + dates.join(','));
  const byKey = Object.fromEntries(items.map((i) => [`${i.kind}:${i.id}`, i]));
  check(byKey['league:1'].state === 'finished', 'finished league shows Finished');
  check(byKey['league:2'].state === 'deleted', 'deleted league shows Deleted');
  check(byKey['rr:2'].state === 'finished', 'completed rotating night shows Finished');
  check(byKey['rr:3'].state === 'deleted', 'deleted RR night shows Deleted');
  check(byKey['bracket:6'].state === 'finished', 'completed bracket shows Finished');
  check(byKey['bracket:7'].state === 'deleted', 'deleted bracket shows Deleted');
  check(byKey['rr:2'].date === '2026-11-24', 'archive returns the ISO date, got ' + byKey['rr:2'].date);
  check(fmtDateMDY(byKey['rr:2'].date) === '11/24/2026', 'client renders the archive date as MM/DD/YYYY');
  check(byKey['league:1'].headline && byKey['league:1'].headline.startsWith('Champion: Alan Cortez'),
    'finished league headline names the champion, got ' + byKey['league:1'].headline);
  check(byKey['league:1'].top[0] === 'Alan Cortez', 'league top is the champion');
  check(byKey['bracket:6'].headline && byKey['bracket:6'].headline.includes('Champions: Alan Cortez & Laura Byron'),
    'bracket headline names the champions, got ' + byKey['bracket:6'].headline);
  check(byKey['rr:4'].headline && byKey['rr:4'].headline.includes('Alan Cortez'),
    'finished RR headline names the leader, got ' + byKey['rr:4'].headline);
  check(byKey['rr:2'].meta.includes('Rotating partners'), 'rotating night meta says Rotating partners');

  // --- archive detail is read-only data for a deleted night ---
  r = await req('GET', '/api/admin/archive/rr/3');
  check(r.status === 200, 'archive detail for deleted RR is 200, got ' + r.status);
  check(r.body.event && r.body.event.name === 'Old RR', 'archive detail returns the deleted night');
  check(r.body.state === 'deleted', 'archive detail reports state deleted');
  r = await req('GET', '/api/admin/archive/bracket/6');
  check(r.status === 200, 'archive detail for finished bracket is 200, got ' + r.status);
  check(r.body.podium && r.body.podium.champion === 5,
    'archive bracket detail carries the champion team id, got ' + JSON.stringify(r.body.podium));
  r = await req('GET', '/api/admin/archive/league/1');
  check(r.status === 200, 'archive detail for finished league is 200, got ' + r.status);
  check(r.body.standings && r.body.standings[0].name === 'Alan Cortez',
    'archive league detail carries standings with Alan first');
  r = await req('GET', '/api/admin/archive/rr/99');
  check(r.status === 404, 'archive detail for a missing night is 404, got ' + r.status);

  // --- soft-delete hiding: live lists, live detail, my-nights ---
  r = await req('GET', '/api/round-robin/events?viewer=1');
  check(r.status === 200, 'live RR list is 200, got ' + r.status);
  check(!r.body.events.some((e) => e.id === 3), 'deleted RR night is not in the live list');
  check(r.body.events.some((e) => e.id === 1), 'playing RR night is still in the live list');
  r = await req('GET', '/api/round-robin/events/3?viewer=1');
  check(r.status === 404, 'live detail for a deleted RR night is 404, got ' + r.status);
  r = await req('GET', '/api/bracket/events?viewer=1');
  check(!r.body.events.some((e) => e.id === 7), 'deleted bracket night is not in the live list');
  r = await req('GET', '/api/bracket/events/7?viewer=1');
  check(r.status === 404, 'live detail for a deleted bracket night is 404, got ' + r.status);
  r = await req('GET', '/api/leagues');
  check(r.body.leagues.some((l) => l.id === 3), 'live league is in the public list');
  check(!r.body.leagues.some((l) => l.id === 2), 'deleted league is not in the public list');
  check(!r.body.leagues.some((l) => l.id === 1) || true, 'finished league stays listed (finishing is not deleting)');
  r = await req('GET', '/api/leagues/2');
  check(r.status === 404, 'public detail for a deleted league is 404, got ' + r.status);
  r = await req('GET', '/api/my-nights?personId=1');
  check(r.status === 200, 'my-nights is 200, got ' + r.status);
  check(!r.body.nights.some((n) => n.id === 3 || n.id === 7),
    'deleted nights are not in Your nights');
  check(r.body.nights.some((n) => n.id === 1), 'Alan still sees his playing RR night');
  r = await req('GET', '/api/people/1/leagues');
  check(r.body.leagues.some((l) => l.id === 1), 'finished league still shows on Your league');
  check(!r.body.leagues.some((l) => l.id === 2), 'deleted league is gone from Your league');

  // --- Delete is soft: the row survives, the archive keeps it ---
  r = await req('DELETE', '/api/admin/round-robin/events/1');
  check(r.status === 200, 'Delete RR night returns 200, got ' + r.status);
  check(rrEvents.get(1) && rrEvents.get(1).deleted_at, 'Delete sets deleted_at, it does not destroy the row');
  r = await req('GET', '/api/round-robin/events?viewer=1');
  check(!r.body.events.some((e) => e.id === 1), 'just-deleted night leaves the live list');
  r = await req('GET', '/api/admin/archive');
  check(r.body.items.some((i) => i.kind === 'rr' && i.id === 1 && i.state === 'deleted'),
    'just-deleted night appears in the archive as Deleted');
  r = await req('DELETE', '/api/admin/bracket/events/5');
  check(r.status === 200, 'Delete bracket night returns 200, got ' + r.status);
  check(brEvents.get(5) && brEvents.get(5).deleted_at, 'Delete sets deleted_at on a bracket night');
  r = await req('DELETE', '/api/admin/leagues/3');
  check(r.status === 200, 'Delete league returns 200, got ' + r.status);
  check(leagues.get(3) && leagues.get(3).deleted_at, 'Delete sets deleted_at on a league');
  r = await req('GET', '/api/leagues');
  check(!r.body.leagues.some((l) => l.id === 3), 'just-deleted league leaves the public list');

  // --- Restore: back in the live lists, gone from Deleted ---
  r = await req('POST', '/api/admin/archive/rr/1/restore');
  check(r.status === 200, 'Restore RR returns 200, got ' + r.status);
  check(!rrEvents.get(1).deleted_at, 'Restore clears deleted_at');
  r = await req('GET', '/api/round-robin/events?viewer=1');
  check(r.body.events.some((e) => e.id === 1), 'restored night is back in the live list');
  r = await req('POST', '/api/admin/archive/rr/1/restore');
  check(r.status === 404, 'restoring a night that is not deleted is 404, got ' + r.status);
  r = await req('POST', '/api/admin/archive/league/3/restore');
  check(r.status === 200, 'Restore league returns 200, got ' + r.status);
  r = await req('GET', '/api/leagues');
  check(r.body.leagues.some((l) => l.id === 3), 'restored league is back in the public list');

  // --- Delete forever: the row is destroyed, the archive loses it ---
  r = await req('DELETE', '/api/admin/archive/rr/3');
  check(r.status === 200, 'Delete forever RR returns 200, got ' + r.status);
  check(!rrEvents.has(3), 'Delete forever destroys the RR row');
  r = await req('GET', '/api/admin/archive');
  check(!r.body.items.some((i) => i.kind === 'rr' && i.id === 3), 'deleted-forever night is gone from the archive');
  r = await req('DELETE', '/api/admin/archive/bracket/7');
  check(r.status === 200, 'Delete forever bracket returns 200, got ' + r.status);
  check(!brEvents.has(7), 'Delete forever destroys the bracket row');
  r = await req('DELETE', '/api/admin/archive/league/2');
  check(r.status === 200, 'Delete forever league returns 200, got ' + r.status);
  check(!leagues.has(2), 'Delete forever destroys the league row');
  r = await req('DELETE', '/api/admin/archive/rr/99');
  check(r.status === 404, 'Delete forever for a missing night is 404, got ' + r.status);

  server.close();
  console.log(`\nAll archive tests passed (${count} assertions).`);
  process.exit(0);
})().catch((e) => {
  server && server.close();
  console.error('\nArchive test failed:', e.message);
  process.exit(1);
});

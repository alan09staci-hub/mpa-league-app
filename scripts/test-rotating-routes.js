'use strict';
// Rotating-partners round robin — HTTP test for the new routes in
// server/routes/roundrobin.js, with a stubbed pool and stubbed auth.
// No database: the fake pool answers the exact SQL the rotating paths
// issue from in-memory state, and asserts $N placeholder/params alignment
// on every call. Run: node scripts/test-rotating-routes.js
const path = require('path');
const express = require('express');

// ---- stub ../db (pool) and ../lib/auth BEFORE the router loads ----
const dbPath = require.resolve('../server/db');
const authPath = require.resolve('../server/lib/auth');

// In-memory state standing in for Postgres.
const events = new Map();
const rotPlayers = [];
const rotMatches = [];
const people = new Map();
for (let i = 1; i <= 30; i++) people.set(i, { id: i, name: `Person ${i}` });
let nextEventId = 1;
let nextPlayerId = 1;
let nextMatchId = 1;

const norm = (sql) => String(sql).replace(/\s+/g, ' ').trim();

function checkPlaceholders(sql, params) {
  const nums = [...sql.matchAll(/\$(\d+)/g)].map((m) => +m[1]);
  const max = nums.length ? Math.max(...nums) : 0;
  const n = params ? params.length : 0;
  if (max !== n) {
    throw new Error(`placeholder/params mismatch: SQL has $${max} but ${n} params — ${norm(sql)}`);
  }
}

const pool = {
  async query(text, params = []) {
    checkPlaceholders(text, params);
    // Postgres coerces a numeric string param to an integer column; the
    // routes pass req.params.* raw in places (e.g. the score route's mid),
    // so the stub does the same coercion instead of failing on ===.
    params = params.map((p) => (typeof p === 'string' && /^\d+$/.test(p) ? +p : p));
    const sql = norm(text);
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
    if (sql === 'SELECT * FROM rr_events WHERE id = $1') {
      const e = events.get(params[0]);
      return { rows: e ? [e] : [], rowCount: e ? 1 : 0 };
    }
    if (sql === 'SELECT * FROM rr_rot_players WHERE event_id = $1 ORDER BY id') {
      return { rows: rotPlayers.filter((p) => p.event_id === params[0]).sort((a, b) => a.id - b.id) };
    }
    // Night-participation lookup (server/lib/nights.js): which events this
    // person is on. This stub never creates fixed teams or solos, so only
    // the rotating players can match.
    if (sql === 'SELECT name FROM people WHERE id = $1') {
      const p = people.get(params[0]);
      return { rows: p ? [{ name: p.name }] : [] };
    }
    if (sql === 'SELECT 1 FROM members WHERE person_id = $1 LIMIT 1') {
      // Every person in this stub is a member.
      return { rows: people.has(params[0]) ? [{}] : [] };
    }
    if (sql === 'SELECT LOWER(name) AS name FROM members') {
      // Every person in this stub is a member.
      return { rows: [...people.values()].map((p) => ({ name: p.name.toLowerCase() })) };
    }
    if (sql === 'SELECT 1 FROM members WHERE LOWER(name) = LOWER($1) LIMIT 1') {
      const hit = [...people.values()].some((p) => p.name.toLowerCase() === String(params[0]).toLowerCase());
      return { rows: hit ? [{}] : [] };
    }
    if (sql === 'SELECT event_id FROM rr_teams WHERE person1_id = $1 OR person2_id = $1 OR ($2::text IS NOT NULL AND (player1 = $2 OR player2 = $2)) UNION SELECT event_id FROM rr_solos WHERE person_id = $1 UNION SELECT event_id FROM rr_rot_players WHERE person_id = $1') {
      const ids = [...new Set(rotPlayers.filter((p) => p.person_id === params[0]).map((p) => p.event_id))];
      return { rows: ids.map((event_id) => ({ event_id })) };
    }
    if (sql === 'SELECT * FROM rr_rot_matches WHERE event_id = $1 ORDER BY round, court') {
      return {
        rows: rotMatches
          .filter((m) => m.event_id === params[0])
          .sort((a, b) => a.round - b.round || a.court - b.court),
      };
    }
    if (sql === 'SELECT * FROM rr_rot_matches WHERE id = $1 AND event_id = $2') {
      const m = rotMatches.find((x) => x.id === params[0] && x.event_id === params[1]);
      return { rows: m ? [m] : [] };
    }
    if (sql === 'SELECT id, name FROM people WHERE id = $1') {
      const p = people.get(params[0]);
      return { rows: p ? [p] : [] };
    }
    if (sql.startsWith('SELECT e.*, (SELECT COUNT(*) FROM rr_teams')) {
      const rows = [...events.values()]
        .sort((a, b) => (a.event_date < b.event_date ? 1 : a.event_date > b.event_date ? -1 : b.id - a.id))
        .map((e) => ({
          ...e,
          team_count: 0,
          solo_count: 0,
          player_count: rotPlayers.filter((p) => p.event_id === e.id).length,
          match_count: rotMatches.filter((m) => m.event_id === e.id).length,
          scored_count: rotMatches.filter((m) => m.event_id === e.id && m.score1 != null).length,
        }));
      return { rows };
    }
    if (sql.startsWith('INSERT INTO rr_events')) {
      const [name, event_date, kind, fee_cents, payout, start_time, max_teams, signup_close, published, format, winner_rule, max_players] = params;
      const e = {
        id: nextEventId++, name, event_date, kind, fee_cents, payout, start_time,
        max_teams, signup_close, published, format, winner_rule, max_players, status: 'setup',
      };
      events.set(e.id, e);
      return { rows: [e] };
    }
    if (sql.startsWith('UPDATE rr_events SET name = $1')) {
      const [name, event_date, kind, fee_cents, payout, published, start_time, max_teams, signup_close, winner_rule, max_players, id] = params;
      const e = events.get(id);
      if (!e) return { rows: [] };
      Object.assign(e, { name, event_date, kind, fee_cents, payout, published, start_time, max_teams, signup_close, winner_rule, max_players });
      return { rows: [e] };
    }
    if (sql === "UPDATE rr_events SET status = 'playing' WHERE id = $1") {
      const e = events.get(params[0]);
      if (e) e.status = 'playing';
      return { rows: [], rowCount: e ? 1 : 0 };
    }
    if (sql === "UPDATE rr_events SET status = 'completed' WHERE id = $1") {
      const e = events.get(params[0]);
      if (e) e.status = 'completed';
      return { rows: [], rowCount: e ? 1 : 0 };
    }
    if (sql === 'DELETE FROM rr_events WHERE id = $1') {
      const ok = events.delete(params[0]);
      return { rows: [], rowCount: ok ? 1 : 0 };
    }
    if (sql === 'INSERT INTO rr_rot_players (event_id, name, person_id) VALUES ($1, $2, $3) RETURNING *') {
      const [event_id, name, person_id] = params;
      if (person_id != null && rotPlayers.some((p) => p.event_id === event_id && p.person_id === person_id)) {
        const err = new Error('duplicate key value violates unique constraint "rr_rot_players_event_person"');
        err.code = '23505';
        throw err;
      }
      const p = { id: nextPlayerId++, event_id, name, person_id, is_main: false, rotator_order: null };
      rotPlayers.push(p);
      return { rows: [p] };
    }
    if (sql === 'DELETE FROM rr_rot_players WHERE id = $1 AND event_id = $2') {
      const i = rotPlayers.findIndex((p) => p.id === params[0] && p.event_id === params[1]);
      if (i < 0) return { rows: [], rowCount: 0 };
      rotPlayers.splice(i, 1);
      return { rows: [], rowCount: 1 };
    }
    if (sql === 'DELETE FROM rr_rot_players WHERE event_id = $1 AND person_id = $2') {
      const i = rotPlayers.findIndex((p) => p.event_id === params[0] && p.person_id === params[1]);
      if (i < 0) return { rows: [], rowCount: 0 };
      rotPlayers.splice(i, 1);
      return { rows: [], rowCount: 1 };
    }
    if (sql === 'UPDATE rr_rot_players SET is_main = FALSE, rotator_order = NULL WHERE event_id = $1') {
      rotPlayers.filter((p) => p.event_id === params[0]).forEach((p) => { p.is_main = false; p.rotator_order = null; });
      return { rows: [], rowCount: 0 };
    }
    if (sql === 'UPDATE rr_rot_players SET is_main = TRUE WHERE id = $1') {
      const p = rotPlayers.find((x) => x.id === params[0]);
      if (p) p.is_main = true;
      return { rows: [], rowCount: p ? 1 : 0 };
    }
    if (sql === 'UPDATE rr_rot_players SET rotator_order = $1 WHERE id = $2') {
      const p = rotPlayers.find((x) => x.id === params[1]);
      if (p) p.rotator_order = params[0];
      return { rows: [], rowCount: p ? 1 : 0 };
    }
    if (sql === 'DELETE FROM rr_rot_matches WHERE event_id = $1') {
      const before = rotMatches.length;
      for (let i = rotMatches.length - 1; i >= 0; i--) {
        if (rotMatches[i].event_id === params[0]) rotMatches.splice(i, 1);
      }
      return { rows: [], rowCount: before - rotMatches.length };
    }
    if (sql.startsWith('INSERT INTO rr_rot_matches')) {
      const [event_id, round, court, p1_id, p2_id, p3_id, p4_id, target_score] = params;
      const m = { id: nextMatchId++, event_id, round, court, p1_id, p2_id, p3_id, p4_id, target_score, score1: null, score2: null };
      rotMatches.push(m);
      return { rows: [m] };
    }
    if (sql === 'UPDATE rr_rot_matches SET score1 = NULL, score2 = NULL WHERE id = $1') {
      const m = rotMatches.find((x) => x.id === params[0]);
      if (m) { m.score1 = null; m.score2 = null; }
      return { rows: [], rowCount: m ? 1 : 0 };
    }
    if (sql === 'UPDATE rr_rot_matches SET score1 = $1, score2 = $2 WHERE id = $3') {
      const m = rotMatches.find((x) => x.id === params[2]);
      if (m) { m.score1 = params[0]; m.score2 = params[1]; }
      return { rows: [], rowCount: m ? 1 : 0 };
    }
    throw new Error(`unhandled SQL in stub pool: ${sql}`);
  },
};
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool } };
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    requireAdmin: (req, res, next) => next(),
    isAdmin: async () => false,
  },
};

const router = require('../server/routes/roundrobin');
const app = express();
app.use(express.json());
app.use('/api', router);
const server = app.listen(0);

// ---- tiny test harness ----
let passed = 0;
function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  passed++;
}
async function req(method, url, body) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, text };
}

async function main() {
  // 1. Create a rotating night.
  let r = await req('POST', '/api/admin/round-robin/events', {
    name: 'Test Rotating', event_date: '2026-12-05', kind: 'charity', format: 'rotating',
    winner_rule: 'ep', max_players: 12, start_time: '18:30', max_teams: 6,
    signup_close: 'day-3h', published: true,
  });
  assert(r.status === 200, `create rotating should be 200, got ${r.status}: ${r.text}`);
  assert(r.json.event.format === 'rotating', 'created event format is rotating');
  assert(r.json.event.winner_rule === 'ep', 'created event winner_rule is ep');
  assert(r.json.event.max_players === 12, 'created event max_players is 12');
  const ev = r.json.event.id;

  // 2. Rotating + money is rejected; bad caps are rejected.
  r = await req('POST', '/api/admin/round-robin/events', {
    name: 'Bad Money', event_date: '2026-12-05', kind: 'money', format: 'rotating',
    fee_cents: 1000, start_time: '18:30', max_teams: 6, signup_close: 'day-3h', published: true,
  });
  assert(r.status === 400, `rotating money should be 400, got ${r.status}`);
  r = await req('POST', '/api/admin/round-robin/events', {
    name: 'Bad Cap', event_date: '2026-12-05', kind: 'charity', format: 'rotating',
    max_players: 1, start_time: '18:30', max_teams: 6, signup_close: 'day-3h', published: true,
  });
  assert(r.status === 400, `max_players 1 should be 400, got ${r.status}`);

  // 3. Team/solo join is refused on a rotating night.
  r = await req('POST', `/api/round-robin/events/${ev}/join-team`, { personId: 1, partnerPersonId: 2 });
  assert(r.status === 400, `join-team on rotating should be 400, got ${r.status}`);
  r = await req('POST', `/api/round-robin/events/${ev}/join-solo`, { personId: 1 });
  assert(r.status === 400, `join-solo on rotating should be 400, got ${r.status}`);

  // 4. Admin adds 12 players by person id (picked from the member list —
  // the name comes from the member record); 13th hits the cap; a duplicate
  // person is refused; a name with no pick is refused.
  const pids = [];
  for (let i = 1; i <= 12; i++) {
    r = await req('POST', `/api/admin/round-robin/events/${ev}/players`, { personId: i });
    assert(r.status === 200, `add player ${i} should be 200, got ${r.status}: ${r.text}`);
    pids.push(r.json.player.id);
  }
  r = await req('POST', `/api/admin/round-robin/events/${ev}/players`, { personId: 13 });
  assert(r.status === 400, `13th player should hit the cap (400), got ${r.status}`);
  r = await req('POST', `/api/admin/round-robin/events/${ev}/players`, { personId: 5 });
  assert(r.status === 409, `duplicate person should be 409, got ${r.status}`);
  r = await req('POST', `/api/admin/round-robin/events/${ev}/players`, { name: 'No Pick' });
  assert(r.status === 400, `name with no pick should be 400, got ${r.status}`);

  // 5. Rotation config: main + rotators; guards on bad input.
  r = await req('POST', `/api/admin/round-robin/events/${ev}/rotation`, {
    mainPlayerId: pids[0], rotatorPlayerIds: [pids[1], pids[2]],
  });
  assert(r.status === 200, `set rotation should be 200, got ${r.status}: ${r.text}`);
  r = await req('POST', `/api/admin/round-robin/events/${ev}/rotation`, {
    mainPlayerId: pids[0], rotatorPlayerIds: pids.slice(1, 7),
  });
  assert(r.status === 400, `6 rotators should be 400, got ${r.status}`);
  r = await req('POST', `/api/admin/round-robin/events/${ev}/rotation`, {
    mainPlayerId: pids[0], rotatorPlayerIds: [pids[0]],
  });
  assert(r.status === 400, `rotator == main should be 400, got ${r.status}`);
  r = await req('POST', `/api/admin/round-robin/events/${ev}/rotation`, {
    mainPlayerId: 9999, rotatorPlayerIds: [],
  });
  assert(r.status === 404, `main not on night should be 404, got ${r.status}`);

  // 6. Event detail shows the rotation.
  r = await req('GET', `/api/round-robin/events/${ev}`);
  assert(r.status === 200, `detail should be 200, got ${r.status}`);
  assert(r.json.mainPlayerId === pids[0], 'detail mainPlayerId matches');
  assert(JSON.stringify(r.json.rotatorIds) === JSON.stringify([pids[1], pids[2]]), 'detail rotatorIds match');
  assert(r.json.players.length === 12, 'detail has 12 players');

  // 7. PATCH while still in setup: winner rule changes; money and bad
  //    values are rejected.
  r = await req('PATCH', `/api/admin/round-robin/events/${ev}`, { winner_rule: 'points' });
  assert(r.status === 200 && r.json.event.winner_rule === 'points', `PATCH winner_rule should stick, got ${r.status}: ${r.text}`);
  r = await req('PATCH', `/api/admin/round-robin/events/${ev}`, { kind: 'money' });
  assert(r.status === 400, `PATCH to money on rotating should be 400, got ${r.status}`);
  r = await req('PATCH', `/api/admin/round-robin/events/${ev}`, { winner_rule: 'bogus' });
  assert(r.status === 400, `PATCH bogus winner_rule should be 400, got ${r.status}`);
  r = await req('PATCH', `/api/admin/round-robin/events/${ev}`, { max_players: 30 });
  assert(r.status === 400, `PATCH max_players 30 should be 400, got ${r.status}`);
  r = await req('PATCH', `/api/admin/round-robin/events/${ev}`, { winner_rule: 'ep' });
  assert(r.status === 200 && r.json.event.winner_rule === 'ep', `PATCH winner_rule back to ep, got ${r.status}: ${r.text}`);

  // 8. Build: 15 matches over 5 rounds, all 12 players in every round.
  r = await req('POST', `/api/admin/round-robin/events/${ev}/build`, {});
  assert(r.status === 200, `build should be 200, got ${r.status}: ${r.text}`);
  assert(r.json.matches === 15, `build should insert 15 matches, got ${r.json.matches}`);
  assert(r.json.rounds === 5, `build should be 5 rounds, got ${r.json.rounds}`);
  // Once built, the night is playing: only its players (or Admin) may
  // open the play, so the detail fetch carries a participant viewer.
  r = await req('GET', `/api/round-robin/events/${ev}?viewer=5`);
  assert(r.json.matches.length === 15, 'detail has 15 matches after build');
  assert(r.json.byes.length === 0, 'no byes with 12 players');
  for (let round = 1; round <= 5; round++) {
    const roundMatches = r.json.matches.filter((m) => m.round === round);
    assert(roundMatches.length === 3, `round ${round} has 3 matches`);
    const seen = roundMatches.flatMap((m) => [m.p1_id, m.p2_id, m.p3_id, m.p4_id]).sort((a, b) => a - b);
    assert(JSON.stringify(seen) === JSON.stringify([...pids].sort((a, b) => a - b)), `round ${round} has all 12 players exactly once`);
  }
  // The main player's partner cycles the rotators: p1 partners p2 in
  // round 1, p3 in round 2.
  const mainRound1 = r.json.matches.find((m) => m.round === 1 && [m.p1_id, m.p2_id, m.p3_id, m.p4_id].includes(pids[0]));
  const mainRound2 = r.json.matches.find((m) => m.round === 2 && [m.p1_id, m.p2_id, m.p3_id, m.p4_id].includes(pids[0]));
  const partnerOf = (m, id) => {
    const ids = [m.p1_id, m.p2_id, m.p3_id, m.p4_id];
    const side = ids.indexOf(id) < 2 ? ids.slice(0, 2) : ids.slice(2, 4);
    return side.find((x) => x !== id);
  };
  assert(partnerOf(mainRound1, pids[0]) === pids[1], 'main partners rotator 1 in round 1');
  assert(partnerOf(mainRound2, pids[0]) === pids[2], 'main partners rotator 2 in round 2');

  // 9. Score entry: valid, then the win-by-1 guards, then clear.
  const mid = r.json.matches[0].id;
  r = await req('POST', `/api/round-robin/events/${ev}/matches/${mid}/score`, { score1: 11, score2: 7 });
  assert(r.status === 200, `score 11-7 should be 200, got ${r.status}: ${r.text}`);
  r = await req('POST', `/api/round-robin/events/${ev}/matches/${mid}/score`, { score1: 12, score2: 10 });
  assert(r.status === 400, `score 12-10 should be 400, got ${r.status}`);
  r = await req('POST', `/api/round-robin/events/${ev}/matches/${mid}/score`, { score1: 11, score2: 11 });
  assert(r.status === 400, `score 11-11 tie should be 400, got ${r.status}`);
  r = await req('POST', `/api/round-robin/events/${ev}/matches/${mid}/score`, { score1: null, score2: null });
  assert(r.status === 200 && r.json.cleared === true, `clear should be 200 cleared, got ${r.status}: ${r.text}`);
  r = await req('POST', `/api/round-robin/events/${ev}/matches/${mid}/score`, { score1: 11, score2: 7 });
  assert(r.status === 200, `re-score 11-7 should be 200, got ${r.status}`);
  r = await req('GET', `/api/round-robin/events/${ev}?viewer=5`);
  const winners = r.json.standings.filter((s) => s.w === 1);
  assert(winners.length === 2, 'two players have a win after one scored match');
  assert(winners.every((s) => s.earned === 11), 'winners banked 11 points each');

  // 10. Events list counts players and rotating matches.
  r = await req('GET', '/api/round-robin/events');
  assert(r.status === 200, `list should be 200, got ${r.status}`);
  const listed = r.json.events.find((e) => e.id === ev);
  assert(listed.player_count === 12, `list player_count is 12, got ${listed.player_count}`);
  assert(listed.match_count === 15, `list match_count is 15, got ${listed.match_count}`);
  assert(listed.scored_count === 1, `list scored_count is 1, got ${listed.scored_count}`);

  // 11. Individual self-join on a second night: join, duplicate, full, leave.
  r = await req('POST', '/api/admin/round-robin/events', {
    name: 'Join Test', event_date: '2026-12-06', kind: 'charity', format: 'rotating',
    winner_rule: 'wins', max_players: 12, start_time: '18:30', max_teams: 6,
    signup_close: 'day-3h', published: true,
  });
  const ev2 = r.json.event.id;
  r = await req('POST', `/api/round-robin/events/${ev2}/join`, { personId: 1 });
  assert(r.status === 200, `join should be 200, got ${r.status}: ${r.text}`);
  assert(r.json.player.person_id === 1, 'joined player links the person');
  r = await req('POST', `/api/round-robin/events/${ev2}/join`, { personId: 1 });
  assert(r.status === 409, `second join should be 409, got ${r.status}`);
  for (let i = 2; i <= 12; i++) {
    r = await req('POST', `/api/admin/round-robin/events/${ev2}/players`, { name: `P${i}`, personId: i });
    assert(r.status === 200, `fill player ${i} should be 200, got ${r.status}`);
  }
  r = await req('POST', `/api/round-robin/events/${ev2}/join`, { personId: 13 });
  assert(r.status === 400, `join a full night should be 400, got ${r.status}`);
  r = await req('POST', `/api/round-robin/events/${ev2}/leave`, { personId: 1 });
  assert(r.status === 200, `leave should be 200, got ${r.status}: ${r.text}`);
  r = await req('POST', `/api/round-robin/events/${ev2}/leave`, { personId: 1 });
  assert(r.status === 404, `leave again should be 404, got ${r.status}`);

  // 12. Join is closed when the night is unpublished.
  r = await req('POST', '/api/admin/round-robin/events', {
    name: 'Closed Test', event_date: '2026-12-07', kind: 'charity', format: 'rotating',
    start_time: '18:30', max_teams: 6, signup_close: 'day-3h', published: false,
  });
  const ev3 = r.json.event.id;
  r = await req('POST', `/api/round-robin/events/${ev3}/join`, { personId: 2 });
  assert(r.status === 409, `join unpublished should be 409, got ${r.status}`);

  // 13. Finish: unscored games block without force, then force finishes;
  //     scores are refused after finishing.
  r = await req('POST', `/api/admin/round-robin/events/${ev}/finish`, {});
  assert(r.status === 409, `finish with unscored games should be 409, got ${r.status}`);
  r = await req('POST', `/api/admin/round-robin/events/${ev}/finish`, { force: true });
  assert(r.status === 200, `finish with force should be 200, got ${r.status}: ${r.text}`);
  r = await req('POST', `/api/round-robin/events/${ev}/matches/${mid}/score`, { score1: 11, score2: 5 });
  assert(r.status === 409, `score after finish should be 409, got ${r.status}`);
  r = await req('POST', `/api/admin/round-robin/events/${ev}/finish`, {});
  assert(r.status === 409, `finish a finished night should be 409, got ${r.status}`);

  // 14. Guests: a guest typed by name stores a NULL person id and shows
  // as a guest; a guest name that is a member's full name is rejected.
  r = await req('POST', '/api/admin/round-robin/events', {
    name: 'Guest Test', event_date: '2026-12-08', kind: 'charity', format: 'rotating',
    start_time: '18:30', max_teams: 6, signup_close: 'day-3h', published: true,
  });
  const ev4 = r.json.event.id;
  r = await req('POST', `/api/admin/round-robin/events/${ev4}/players`, { guest: 'Sam Guest' });
  assert(r.status === 200, `add guest player should be 200, got ${r.status}: ${r.text}`);
  assert(r.json.player.person_id === null, `guest stores a NULL person id, got ${JSON.stringify(r.json.player)}`);
  assert(r.json.player.name === 'Sam Guest', `guest name is kept, got ${JSON.stringify(r.json.player)}`);
  r = await req('GET', `/api/round-robin/events/${ev4}`);
  assert(r.status === 200, `guest night detail should be 200, got ${r.status}`);
  assert(r.json.players.some((p) => p.name === 'Sam Guest (Guest)'), `guest shows as a guest in the players list, got ${JSON.stringify(r.json.players.map((p) => p.name))}`);
  r = await req('POST', `/api/admin/round-robin/events/${ev4}/players`, { guest: 'Person 5' });
  assert(r.status === 400, `guest name matching a member should be 400, got ${r.status}`);
  r = await req('POST', `/api/admin/round-robin/events/${ev4}/players`, { personId: 5 });
  assert(r.status === 200, `add member player should be 200, got ${r.status}: ${r.text}`);
  assert(r.json.player.person_id === 5, `member player links the person, got ${JSON.stringify(r.json.player)}`);

  console.log(`\nAll rotating route tests passed (${passed} assertions).`);
}

main()
  .then(() => server.close(() => process.exit(0)))
  .catch((e) => {
    console.error(`\nFAILED: ${e.message}`);
    server.close(() => process.exit(1));
  });

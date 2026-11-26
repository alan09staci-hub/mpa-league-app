'use strict';
// "Your nights" — HTTP test for GET /api/my-nights and for the
// players-only visibility of playing/finished nights, with a stubbed
// pool and stubbed auth. No database: the fake pool answers the exact
// SQL the nights code issues from in-memory state, and asserts $N
// placeholder/params alignment on every call. Run:
//   node scripts/test-my-nights.js
const path = require('path');
const express = require('express');
const { buildBracket } = require('../server/lib/bracket');

// ---- stub ../db (pool) and ../lib/auth BEFORE the routers load ----
const dbPath = require.resolve('../server/db');
const authPath = require.resolve('../server/lib/auth');

// In-memory state standing in for Postgres.
const people = new Map();
for (let i = 1; i <= 30; i++) people.set(i, { id: i, name: `Person ${i}` });
// Real full names, for the hand-added-teams case below: those teams carry
// names only (NULL person ids), so the match is by name.
people.set(11, { id: 11, name: 'Alan Cortez' });
people.set(12, { id: 12, name: 'Laura Byron' });
people.set(31, { id: 31, name: 'Not A Member' });
// Person 31 exists as a person but is not an MPA member.
const memberIds = new Set([...people.keys()].filter((id) => id !== 31));
let adminOn = false;

const rrEvents = new Map();
const brEvents = new Map();
const rrTeams = [];
const rrSolos = [];
const rrMatches = [];
const rrRotPlayers = [];
const rrRotMatches = [];
const brTeams = [];
const brSolos = [];
const brMatches = [];

// Fixed round robin, playing: Alan & Laura (person 1) lead Kim & Justin.
rrEvents.set(1, {
  id: 1, name: 'Friday RR', event_date: '2026-11-27', kind: 'charity',
  fee_cents: 0, payout: 'house', start_time: '18:30', max_teams: 6,
  signup_close: 'day-3h', published: true, format: 'fixed',
  winner_rule: 'ep', max_players: 12, status: 'playing',
});
rrTeams.push(
  { id: 1, event_id: 1, player1: 'Alan', player2: 'Laura', person1_id: 1, person2_id: 2 },
  { id: 2, event_id: 1, player1: 'Kim', player2: 'Justin', person1_id: 3, person2_id: 4 }
);
rrMatches.push({
  id: 1, event_id: 1, round: 1, court: 1, team1_id: 1, team2_id: 2,
  score1: 11, score2: 7, target_score: 11,
});

// Rotating round robin, playing: person 5 leads on points. Alan is not in it.
rrEvents.set(2, {
  id: 2, name: 'Tuesday Rot', event_date: '2026-11-24', kind: 'charity',
  fee_cents: 0, payout: 'house', start_time: '18:30', max_teams: 6,
  signup_close: 'day-3h', published: true, format: 'rotating',
  winner_rule: 'points', max_players: 12, status: 'playing',
});
rrRotPlayers.push(
  { id: 1, event_id: 2, name: 'Player 5', person_id: 5, is_main: false, rotator_order: null },
  { id: 2, event_id: 2, name: 'Player 6', person_id: 6, is_main: false, rotator_order: null },
  { id: 3, event_id: 2, name: 'Player 7', person_id: 7, is_main: false, rotator_order: null },
  { id: 4, event_id: 2, name: 'Player 8', person_id: 8, is_main: false, rotator_order: null }
);
rrRotMatches.push({
  id: 1, event_id: 2, round: 1, court: 1, p1_id: 1, p2_id: 2, p3_id: 3, p4_id: 4,
  score1: 11, score2: 7, target_score: 11,
});

// Bracket night, playing: 4 teams, Alan & Laura (seed 1) take the title.
brEvents.set(3, {
  id: 3, name: 'Friday Night', event_date: '2026-11-27', kind: 'charity',
  fee_cents: 0, payout: 'house', start_time: '18:30', max_teams: 4,
  signup_close: 'day-3h', published: true, status: 'playing',
});
brTeams.push(
  { id: 1, event_id: 3, player1: 'Alan', player2: 'Laura', person1_id: 1, person2_id: 2, seed: 1 },
  { id: 2, event_id: 3, player1: 'Kim', player2: 'Justin', person1_id: 3, person2_id: 4, seed: 2 },
  { id: 3, event_id: 3, player1: 'Dawn', player2: 'Allen', person1_id: 7, person2_id: 8, seed: 3 },
  { id: 4, event_id: 3, player1: 'Micheal', player2: 'Raley', person1_id: 9, person2_id: 10, seed: 4 }
);
// Scores by match key: seed 1 beats seed 4, seed 2 beats seed 3, seed 1
// beats seed 2 in the winners final, seed 4 beats seed 3 in the losers
// opener, seed 2 beats seed 4 in the losers final, seed 1 beats seed 2
// in the grand final — champion seed 1, no reset game needed.
const brScores = { 1: [11, 7], 2: [11, 6], 3: [11, 8], 4: [11, 5], 5: [9, 11], 6: [11, 6] };
for (const m of buildBracket(4).matches) {
  if (!brScores[m.key]) continue; // the reset game (key 7) is added unplayed below
  brMatches.push({
    id: m.key, event_id: 3, bracket: m.bracket, round: m.round, game_no: m.gameNo,
    slot1_type: m.slot1.type, slot1_ref: m.slot1.ref,
    slot2_type: m.slot2.type, slot2_ref: m.slot2.ref,
    score1: brScores[m.key][0], score2: brScores[m.key][1], target_score: 11,
  });
}
// The reset game (key 7) is unplayed — its slots never resolve.
brMatches.push({
  id: 7, event_id: 3, bracket: 'G', round: 1, game_no: 1,
  slot1_type: 'winner', slot1_ref: 6, slot2_type: 'loser', slot2_ref: 6,
  score1: null, score2: null, target_score: 11,
});

// Setup bracket night, nobody on it yet — the Admin add-team path below.
brEvents.set(6, {
  id: 6, name: 'Next Bracket', event_date: '2026-12-05', kind: 'charity',
  fee_cents: 0, payout: 'house', start_time: '18:30', max_teams: 4,
  signup_close: 'day-3h', published: true, status: 'setup',
});

// Setup round robin, nobody on it yet — anyone may open it.
rrEvents.set(4, {
  id: 4, name: 'Next RR', event_date: '2026-12-04', kind: 'charity',
  fee_cents: 0, payout: 'house', start_time: '18:30', max_teams: 6,
  signup_close: 'day-3h', published: true, format: 'fixed',
  winner_rule: 'ep', max_players: 12, status: 'setup',
});

// Fixed round robin, playing, with HAND-ADDED teams: names only, NULL
// person ids (the way Admin adds teams by hand, migration 007). Person
// 11 is Alan Cortez by name — he must still see this night.
rrEvents.set(5, {
  id: 5, name: 'Hand-added RR', event_date: '2026-11-20', kind: 'money',
  fee_cents: 1000, payout: 'house', start_time: '18:30', max_teams: 6,
  signup_close: 'day-3h', published: true, format: 'fixed',
  winner_rule: 'ep', max_players: 12, status: 'playing',
});
rrTeams.push(
  { id: 3, event_id: 5, player1: 'Alan Cortez', player2: 'Laura Byron', person1_id: null, person2_id: null },
  { id: 4, event_id: 5, player1: 'Kim Massa', player2: 'Justin Johnson', person1_id: null, person2_id: null }
);
rrMatches.push({
  id: 2, event_id: 5, round: 1, court: 1, team1_id: 3, team2_id: 4,
  score1: 11, score2: 7, target_score: 11,
});

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
    params = params.map((p) => (typeof p === 'string' && /^\d+$/.test(p) ? +p : p));
    const sql = norm(text);
    if (sql === 'SELECT * FROM rr_events WHERE id = $1') {
      const e = rrEvents.get(params[0]);
      return { rows: e ? [e] : [], rowCount: e ? 1 : 0 };
    }
    if (sql === 'SELECT * FROM br_events WHERE id = $1') {
      const e = brEvents.get(params[0]);
      return { rows: e ? [e] : [], rowCount: e ? 1 : 0 };
    }
    if (sql === 'SELECT name FROM people WHERE id = $1') {
      const p = people.get(params[0]);
      return { rows: p ? [{ name: p.name }] : [] };
    }
    if (sql === 'SELECT id, name FROM people WHERE id = $1') {
      const p = people.get(params[0]);
      return { rows: p ? [{ id: p.id, name: p.name }] : [] };
    }
    if (sql === 'SELECT 1 FROM members WHERE person_id = $1 LIMIT 1') {
      return { rows: memberIds.has(params[0]) ? [{}] : [] };
    }
    if (sql === 'SELECT LOWER(name) AS name FROM members') {
      return { rows: [...memberIds].map((id) => ({ name: people.get(id).name.toLowerCase() })) };
    }
    if (sql === 'SELECT 1 FROM members WHERE LOWER(name) = LOWER($1) LIMIT 1') {
      const hit = [...memberIds].some((id) => people.get(id).name.toLowerCase() === String(params[0]).toLowerCase());
      return { rows: hit ? [{}] : [] };
    }
    if (sql === 'SELECT 1 FROM rr_teams WHERE event_id = $1 AND (person1_id = $2 OR person2_id = $2) UNION ALL SELECT 1 FROM rr_solos WHERE event_id = $1 AND person_id = $2 LIMIT 1') {
      const hit = rrTeams.some((t) => t.event_id === params[0] && (t.person1_id === params[1] || t.person2_id === params[1]))
        || rrSolos.some((s) => s.event_id === params[0] && s.person_id === params[1]);
      return { rows: hit ? [{}] : [] };
    }
    if (sql === 'SELECT 1 FROM br_teams WHERE event_id = $1 AND (person1_id = $2 OR person2_id = $2) UNION ALL SELECT 1 FROM br_solos WHERE event_id = $1 AND person_id = $2 LIMIT 1') {
      const hit = brTeams.some((t) => t.event_id === params[0] && (t.person1_id === params[1] || t.person2_id === params[1]))
        || brSolos.some((s) => s.event_id === params[0] && s.person_id === params[1]);
      return { rows: hit ? [{}] : [] };
    }
    if (sql === 'INSERT INTO rr_teams (event_id, player1, player2, person1_id, person2_id) VALUES ($1, $2, $3, $4, $5) RETURNING *') {
      const team = { id: Math.max(0, ...rrTeams.map((t) => t.id)) + 1, event_id: params[0], player1: params[1], player2: params[2], person1_id: params[3], person2_id: params[4] };
      rrTeams.push(team);
      return { rows: [team] };
    }
    if (sql === 'INSERT INTO br_teams (event_id, player1, player2, person1_id, person2_id) VALUES ($1, $2, $3, $4, $5) RETURNING *') {
      const team = { id: Math.max(0, ...brTeams.map((t) => t.id)) + 1, event_id: params[0], player1: params[1], player2: params[2], person1_id: params[3], person2_id: params[4] };
      brTeams.push(team);
      return { rows: [team] };
    }
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
    if (sql === 'SELECT * FROM rr_teams WHERE event_id = $1 ORDER BY id') {
      return { rows: rrTeams.filter((t) => t.event_id === params[0]).sort((a, b) => a.id - b.id) };
    }
    if (sql === 'SELECT * FROM rr_matches WHERE event_id = $1 ORDER BY round, court') {
      return {
        rows: rrMatches
          .filter((m) => m.event_id === params[0])
          .sort((a, b) => a.round - b.round || a.court - b.court),
      };
    }
    if (sql === 'SELECT * FROM rr_rot_players WHERE event_id = $1 ORDER BY id') {
      return { rows: rrRotPlayers.filter((p) => p.event_id === params[0]).sort((a, b) => a.id - b.id) };
    }
    if (sql === 'SELECT * FROM rr_rot_matches WHERE event_id = $1 ORDER BY round, court') {
      return {
        rows: rrRotMatches
          .filter((m) => m.event_id === params[0])
          .sort((a, b) => a.round - b.round || a.court - b.court),
      };
    }
    if (sql === 'SELECT * FROM br_teams WHERE event_id = $1 ORDER BY id') {
      return { rows: brTeams.filter((t) => t.event_id === params[0]).sort((a, b) => a.id - b.id) };
    }
    if (sql === 'SELECT * FROM br_matches WHERE event_id = $1 ORDER BY id') {
      return { rows: brMatches.filter((m) => m.event_id === params[0]).sort((a, b) => a.id - b.id) };
    }
    if (sql === 'SELECT s.id, s.event_id, s.person_id, s.created_at, p.name FROM rr_solos s JOIN people p ON p.id = s.person_id WHERE s.event_id = $1 ORDER BY s.created_at') {
      return {
        rows: rrSolos
          .filter((s) => s.event_id === params[0])
          .map((s) => ({ ...s, name: (people.get(s.person_id) || {}).name || '' })),
      };
    }
    if (sql === 'SELECT s.id, s.event_id, s.person_id, s.created_at, p.name FROM br_solos s JOIN people p ON p.id = s.person_id WHERE s.event_id = $1 ORDER BY s.created_at') {
      return {
        rows: brSolos
          .filter((s) => s.event_id === params[0])
          .map((s) => ({ ...s, name: (people.get(s.person_id) || {}).name || '' })),
      };
    }
    if (sql.startsWith('SELECT e.*, (SELECT COUNT(*) FROM rr_teams')) {
      const rows = [...rrEvents.values()]
        .sort((a, b) => (a.event_date < b.event_date ? 1 : a.event_date > b.event_date ? -1 : b.id - a.id))
        .map((e) => ({
          ...e,
          team_count: rrTeams.filter((t) => t.event_id === e.id).length,
          solo_count: rrSolos.filter((s) => s.event_id === e.id).length,
          player_count: rrRotPlayers.filter((p) => p.event_id === e.id).length,
          match_count: rrMatches.filter((m) => m.event_id === e.id).length
            + rrRotMatches.filter((m) => m.event_id === e.id).length,
          scored_count: rrMatches.filter((m) => m.event_id === e.id && m.score1 != null).length
            + rrRotMatches.filter((m) => m.event_id === e.id && m.score1 != null).length,
        }));
      return { rows };
    }
    if (sql.startsWith('SELECT e.*, (SELECT COUNT(*) FROM br_teams')) {
      const rows = [...brEvents.values()]
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
    throw new Error(`unhandled SQL in stub pool: ${sql}`);
  },
};
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool } };
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    requireAdmin: (req, res, next) => next(),
    isAdmin: async () => adminOn,
  },
};

const nightsRouter = require('../server/routes/nights');
const rrRouter = require('../server/routes/roundrobin');
const brRouter = require('../server/routes/bracket');
const app = express();
app.use(express.json());
app.use('/api', nightsRouter);
app.use('/api', rrRouter);
app.use('/api', brRouter);
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
  // 1. My nights for Alan (person 1): Friday Night (bracket, champions)
  //    then Friday RR (leading) — Tuesday Rot is not his, Next RR has
  //    nobody on it yet.
  let r = await req('GET', '/api/my-nights?personId=1');
  assert(r.status === 200, `my-nights should be 200, got ${r.status}: ${r.text}`);
  assert(r.json.nights.length === 2, `person 1 should have 2 nights, got ${JSON.stringify(r.json.nights)}`);
  assert(r.json.nights[0].id === 3 && r.json.nights[0].kind === 'bracket', 'first night is Friday Night (bracket, newest first)');
  assert(r.json.nights[0].headline === 'Champions: Alan & Laura', `bracket headline is the champion, got ${r.json.nights[0].headline}`);
  assert(r.json.nights[1].id === 1 && r.json.nights[1].kind === 'rr', 'second night is Friday RR');
  assert(r.json.nights[1].headline === 'Leading: Alan & Laura', `RR headline is the leader, got ${r.json.nights[1].headline}`);

  // 2. My nights for person 5: only the rotating night, leading on points.
  r = await req('GET', '/api/my-nights?personId=5');
  assert(r.status === 200, `my-nights person 5 should be 200, got ${r.status}`);
  assert(r.json.nights.length === 1, `person 5 should have 1 night, got ${JSON.stringify(r.json.nights)}`);
  assert(r.json.nights[0].id === 2 && r.json.nights[0].kind === 'rr', 'person 5 night is Tuesday Rot');
  assert(r.json.nights[0].headline === 'Leading: Player 5', `rotating headline is the points leader, got ${r.json.nights[0].headline}`);

  // 2b. Hand-added teams (names only, NULL person ids): person 11 is
  // Alan Cortez by name, so he sees the night and can open it — this is
  // the case the first build missed.
  r = await req('GET', '/api/my-nights?personId=11');
  assert(r.status === 200, `my-nights person 11 should be 200, got ${r.status}`);
  assert(r.json.nights.length === 1, `person 11 should have 1 night, got ${JSON.stringify(r.json.nights)}`);
  assert(r.json.nights[0].id === 5 && r.json.nights[0].kind === 'rr', 'person 11 night is Hand-added RR');
  assert(r.json.nights[0].headline === 'Leading: Alan Cortez & Laura Byron', `hand-added headline is the leader, got ${r.json.nights[0].headline}`);
  r = await req('GET', '/api/round-robin/events/5?viewer=11');
  assert(r.status === 200, `hand-added participant detail should be 200, got ${r.status}: ${r.text}`);
  r = await req('GET', '/api/round-robin/events/5?viewer=1');
  assert(r.status === 403, `hand-added stranger detail should be 403, got ${r.status}`);
  r = await req('GET', '/api/round-robin/events?viewer=11');
  assert(JSON.stringify(r.json.events.map((e) => e.id)) === JSON.stringify([4, 5]), `viewer 11 RR list is setup + own night, got ${JSON.stringify(r.json.events.map((e) => e.id))}`);

  // 3. No person, or a person on no night: empty.
  r = await req('GET', '/api/my-nights');
  assert(r.status === 200 && r.json.nights.length === 0, 'my-nights without a person is empty');
  r = await req('GET', '/api/my-nights?personId=99');
  assert(r.status === 200 && r.json.nights.length === 0, 'my-nights for a stranger is empty');

  // 4. Round robin detail: participant opens, stranger and no-viewer get
  //    403, admin opens, setup stays open to anyone.
  r = await req('GET', '/api/round-robin/events/1?viewer=1');
  assert(r.status === 200, `participant detail should be 200, got ${r.status}: ${r.text}`);
  r = await req('GET', '/api/round-robin/events/1?viewer=5');
  assert(r.status === 403, `stranger detail should be 403, got ${r.status}`);
  assert(r.json.error === 'This night is only visible to its players.', `403 carries the friendly message, got ${r.json.error}`);
  r = await req('GET', '/api/round-robin/events/1');
  assert(r.status === 403, `no-viewer detail should be 403, got ${r.status}`);
  adminOn = true;
  r = await req('GET', '/api/round-robin/events/1');
  assert(r.status === 200, `admin detail should be 200, got ${r.status}: ${r.text}`);
  adminOn = false;
  r = await req('GET', '/api/round-robin/events/4');
  assert(r.status === 200, `setup detail stays public, got ${r.status}: ${r.text}`);

  // 5. Bracket detail: same rule, and the participant sees the podium.
  r = await req('GET', '/api/bracket/events/3?viewer=1');
  assert(r.status === 200, `participant bracket detail should be 200, got ${r.status}: ${r.text}`);
  assert(r.json.podium.champion === 1, `podium champion is Alan & Laura's team, got ${JSON.stringify(r.json.podium)}`);
  r = await req('GET', '/api/bracket/events/3?viewer=5');
  assert(r.status === 403, `stranger bracket detail should be 403, got ${r.status}`);
  r = await req('GET', '/api/bracket/events/3');
  assert(r.status === 403, `no-viewer bracket detail should be 403, got ${r.status}`);
  adminOn = true;
  r = await req('GET', '/api/bracket/events/3');
  assert(r.status === 200, `admin bracket detail should be 200, got ${r.status}: ${r.text}`);
  adminOn = false;

  // 6. Lists hide playing nights the viewer is not part of; setup nights
  //    stay listed for everyone, and no viewer (or admin) sees all.
  r = await req('GET', '/api/round-robin/events?viewer=1');
  assert(r.status === 200, `RR list should be 200, got ${r.status}`);
  assert(JSON.stringify(r.json.events.map((e) => e.id)) === JSON.stringify([4, 1]), `viewer 1 RR list is setup + own night, got ${JSON.stringify(r.json.events.map((e) => e.id))}`);
  r = await req('GET', '/api/round-robin/events');
  assert(JSON.stringify(r.json.events.map((e) => e.id)) === JSON.stringify([4, 1, 2, 5]), `no-viewer RR list is everything, got ${JSON.stringify(r.json.events.map((e) => e.id))}`);
  adminOn = true;
  r = await req('GET', '/api/round-robin/events?viewer=5');
  assert(JSON.stringify(r.json.events.map((e) => e.id)) === JSON.stringify([4, 1, 2, 5]), `admin RR list is everything, got ${JSON.stringify(r.json.events.map((e) => e.id))}`);
  adminOn = false;
  r = await req('GET', '/api/bracket/events?viewer=5');
  assert(JSON.stringify(r.json.events.map((e) => e.id)) === JSON.stringify([6]), `viewer 5 bracket list hides the playing night but shows the setup one, got ${JSON.stringify(r.json.events.map((e) => e.id))}`);
  r = await req('GET', '/api/bracket/events?viewer=1');
  assert(JSON.stringify(r.json.events.map((e) => e.id)) === JSON.stringify([6, 3]), `viewer 1 bracket list shows setup + own night, got ${JSON.stringify(r.json.events.map((e) => e.id))}`);

  // 7. Admin add-team (the real path): teams are picked from the member
  // list, so they carry real person ids — and the participation check
  // matches them by id, not just by name.
  r = await req('POST', '/api/admin/round-robin/events/4/teams', { person1Id: 11, person2Id: 12 });
  assert(r.status === 200, `admin add team should be 200, got ${r.status}: ${r.text}`);
  assert(r.json.team.person1_id === 11 && r.json.team.person2_id === 12, `admin-added team carries person ids, got ${JSON.stringify(r.json.team)}`);
  assert(r.json.team.player1 === 'Alan Cortez' && r.json.team.player2 === 'Laura Byron', `admin-added team names come from the member records, got ${JSON.stringify(r.json.team)}`);
  r = await req('GET', '/api/my-nights?personId=11');
  assert(r.json.nights.length === 2, `person 11 should now have 2 nights, got ${JSON.stringify(r.json.nights)}`);
  assert(r.json.nights[0].id === 4, 'newest night for person 11 is Next RR');
  // Validation: missing picks, same person twice, unknown person,
  // non-member, and a player already on the night.
  r = await req('POST', '/api/admin/round-robin/events/4/teams', { person1Id: 11 });
  assert(r.status === 400, `missing second pick should be 400, got ${r.status}`);
  r = await req('POST', '/api/admin/round-robin/events/4/teams', { person1Id: 11, person2Id: 11 });
  assert(r.status === 400, `same person twice should be 400, got ${r.status}`);
  r = await req('POST', '/api/admin/round-robin/events/4/teams', { person1Id: 11, person2Id: 99 });
  assert(r.status === 404, `unknown person should be 404, got ${r.status}`);
  r = await req('POST', '/api/admin/round-robin/events/4/teams', { person1Id: 11, person2Id: 31 });
  assert(r.status === 400, `non-member should be 400, got ${r.status}`);
  r = await req('POST', '/api/admin/round-robin/events/4/teams', { person1Id: 11, person2Id: 13 });
  assert(r.status === 409, `player already on the night should be 409, got ${r.status}`);
  // Guests: one member + one guest stores the guest with a NULL person
  // id, and the member partner still matches the participation check.
  r = await req('POST', '/api/admin/round-robin/events/4/teams', { person1Id: 13, guest2: 'Sam Guest' });
  assert(r.status === 200, `member + guest team should be 200, got ${r.status}: ${r.text}`);
  assert(r.json.team.person1_id === 13 && r.json.team.person2_id === null, `guest slot stores a NULL person id, got ${JSON.stringify(r.json.team)}`);
  assert(r.json.team.player2 === 'Sam Guest', `guest name is kept, got ${JSON.stringify(r.json.team)}`);
  r = await req('GET', '/api/my-nights?personId=13');
  assert(r.json.nights.length === 1 && r.json.nights[0].id === 4, `member partner of a guest team still matches by id, got ${JSON.stringify(r.json.nights)}`);
  // The guest shows as a guest in the night's team list.
  r = await req('GET', '/api/round-robin/events/4?viewer=13');
  assert(r.status === 200, `detail should be 200, got ${r.status}`);
  assert(r.json.teams.some((t) => t.label === 'Person 13 & Sam Guest (Guest)'), `guest team label carries the Guest marker, got ${JSON.stringify(r.json.teams.map((t) => t.label))}`);
  // A guest name that is a member's full name is rejected.
  r = await req('POST', '/api/admin/round-robin/events/4/teams', { person1Id: 14, guest2: 'Alan Cortez' });
  assert(r.status === 400, `guest name matching a member should be 400, got ${r.status}`);
  // Two guests on a team work too.
  r = await req('POST', '/api/admin/round-robin/events/4/teams', { guest1: 'Guest One', guest2: 'Guest Two' });
  assert(r.status === 200, `two-guest team should be 200, got ${r.status}: ${r.text}`);
  assert(r.json.team.person1_id === null && r.json.team.person2_id === null, `two-guest team stores NULL person ids, got ${JSON.stringify(r.json.team)}`);
  // Bracket: same path, same guarantees.
  r = await req('POST', '/api/admin/bracket/events/6/teams', { person1Id: 11, person2Id: 12 });
  assert(r.status === 200, `admin add bracket team should be 200, got ${r.status}: ${r.text}`);
  assert(r.json.team.person1_id === 11 && r.json.team.person2_id === 12, `admin-added bracket team carries person ids, got ${JSON.stringify(r.json.team)}`);
  r = await req('GET', '/api/my-nights?personId=11');
  assert(r.json.nights.length === 3, `person 11 should now have 3 nights, got ${JSON.stringify(r.json.nights)}`);
  assert(r.json.nights[0].id === 6 && r.json.nights[0].kind === 'bracket', 'newest night for person 11 is Next Bracket');

  console.log(`\nAll my-nights tests passed (${passed} assertions).`);
}

main()
  .then(() => server.close(() => process.exit(0)))
  .catch((e) => {
    console.error(`\nFAILED: ${e.message}`);
    server.close(() => process.exit(1));
  });

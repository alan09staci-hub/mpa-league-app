'use strict';
// Round Robin routes. One-off nights, separate from leagues: fixed doubles
// teams stay together all night, every team plays every other team once,
// one game to 11 per match. Free charity games have no fee and no payouts;
// money-ball events have a per-person entry fee and a payout structure.
// Public: list events, view an event, enter a score (a view, not a lock —
// the same trade-off as league game days). Admin (passcode,
// server-enforced): create/edit/delete events, add/remove teams, build the
// schedule, finish/reopen.
const express = require('express');
const { pool } = require('../db');
const auth = require('../lib/auth');
const {
  PAYOUTS,
  payoutById,
  buildSchedule,
  computeStandings,
  computePayouts,
  scoreError,
  signupCloseAt,
} = require('../lib/roundrobin');
const {
  ROUNDS: ROT_ROUNDS,
  MAX_ROTATORS,
  buildRotationSchedule,
  computePlayerStandings,
} = require('../lib/rotation');
const { myNightIds, isNightParticipant, teamLabel, markTeamGuests, markPlayerGuest, memberNameSet } = require('../lib/nights');

const router = express.Router();
const MAX_TEAMS = 24; // 48 players per night — the absolute ceiling

// Per-night team cap: the night's own max_teams (set at create), falling
// back to the global ceiling for nights created before migration 008.
function nightMaxTeams(event) {
  return event.max_teams || MAX_TEAMS;
}

// Per-night player cap for rotating nights (migration 016); fixed nights
// keep using max_teams.
function nightMaxPlayers(event) {
  return event.max_players || 12;
}

// Rotating-night reads: individual players and their matches.
async function getRotPlayers(eventId) {
  const { rows } = await pool.query(
    'SELECT * FROM rr_rot_players WHERE event_id = $1 ORDER BY id',
    [eventId]
  );
  return rows;
}

async function getRotMatches(eventId) {
  const { rows } = await pool.query(
    'SELECT * FROM rr_rot_matches WHERE event_id = $1 ORDER BY round, court',
    [eventId]
  );
  return rows;
}

// The main player (at most one) and the rotators in cycle order.
function rotMainAndRotators(players) {
  const main = players.find((p) => p.is_main) || null;
  const rotators = players
    .filter((p) => p.rotator_order != null)
    .sort((a, b) => a.rotator_order - b.rotator_order);
  return { main, rotators };
}

// True once the sign-up deadline has passed (only 'day-3h' nights have
// one — 'fill' nights close when they fill).
function signupClosed(event) {
  const closeAt = signupCloseAt(event);
  return closeAt != null && Date.now() >= closeAt.getTime();
}

function asInt(v) {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

async function handle(fn, req, res) {
  try {
    await fn(req, res);
  } catch (e) {
    console.error(e);
    res.status(e.status || 500).json({ error: e.message || 'Server error.' });
  }
}

function bad(res, status, msg) {
  const e = new Error(msg);
  e.status = status;
  throw e;
}

async function getEvent(id) {
  const { rows } = await pool.query('SELECT * FROM rr_events WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getTeams(eventId) {
  const { rows } = await pool.query(
    'SELECT * FROM rr_teams WHERE event_id = $1 ORDER BY id',
    [eventId]
  );
  return rows;
}

async function getMatches(eventId) {
  const { rows } = await pool.query(
    'SELECT * FROM rr_matches WHERE event_id = $1 ORDER BY round, court',
    [eventId]
  );
  return rows;
}

// Solo sign-ups waiting to be paired into teams.
async function getSolos(eventId) {
  const { rows } = await pool.query(
    `SELECT s.id, s.event_id, s.person_id, s.created_at, p.name
       FROM rr_solos s JOIN people p ON p.id = s.person_id
      WHERE s.event_id = $1 ORDER BY s.created_at`,
    [eventId]
  );
  return rows;
}

// Full event payload for a rotating night: players (not teams), the
// rotation matches, per-player standings by the night's winner rule, and
// the main player / rotators. Teams, solos and payouts stay empty — a
// rotating night is individuals only, charity only.
async function rotEventDetail(event, req) {
  const [players, matches, memberNames] = await Promise.all([
    getRotPlayers(event.id),
    getRotMatches(event.id),
    memberNameSet(),
  ]);
  players.forEach((p) => { p.name = markPlayerGuest(p, memberNames); });
  const standings = computePlayerStandings(
    players.map((p) => ({ id: p.id, name: p.name })),
    matches,
    event.winner_rule || 'ep'
  );
  const { main, rotators } = rotMainAndRotators(players);
  // Byes: a player with no match in a round sits that round out.
  const maxRound = matches.reduce((m, x) => Math.max(m, x.round), 0);
  const byes = [];
  for (let r = 1; r <= maxRound; r++) {
    const playing = new Set();
    matches
      .filter((m) => m.round === r)
      .forEach((m) => {
        playing.add(m.p1_id);
        playing.add(m.p2_id);
        playing.add(m.p3_id);
        playing.add(m.p4_id);
      });
    players
      .filter((p) => !playing.has(p.id))
      .forEach((p) => byes.push({ round: r, playerId: p.id }));
  }
  return {
    event,
    teams: [],
    solos: [],
    players,
    matches,
    standings: standings.map((s) => ({
      rank: s.rank,
      playerId: s.player.id,
      name: s.player.name,
      w: s.w,
      l: s.l,
      played: s.played,
      earned: s.earned,
      against: s.against,
      possible: s.possible,
      ep: s.ep,
      tied: !!s.tied,
      reason: s.reason || null,
    })),
    payouts: null,
    byes,
    mainPlayerId: main ? main.id : null,
    rotatorIds: rotators.map((p) => p.id),
    isAdmin: await auth.isAdmin(req),
  };
}

// Full event payload: event + teams + solos + matches + standings + payouts + byes.
async function eventDetail(event, req) {
  if (event.format === 'rotating') return rotEventDetail(event, req);
  const [teams, matches, solos, memberNames] = await Promise.all([
    getTeams(event.id),
    getMatches(event.id),
    getSolos(event.id),
    memberNameSet(),
  ]);
  teams.forEach((t) => markTeamGuests(t, memberNames));
  const standings = computeStandings(teams, matches);
  const payout = computePayouts({
    kind: event.kind,
    feeCents: event.fee_cents,
    payoutId: event.payout,
    teamCount: teams.length,
  });
  // Team names appear next to the money once a team has played: the
  // leaders while the night is running, the final winners once finished.
  const places = payout
    ? payout.places.map((p) => {
        const leader = standings[p.place - 1];
        return { ...p, teamId: leader && leader.played > 0 ? leader.team.id : null };
      })
    : [];
  // Byes: a team with no match in a round sits that round out.
  const maxRound = matches.reduce((m, x) => Math.max(m, x.round), 0);
  const byes = [];
  for (let r = 1; r <= maxRound; r++) {
    const playing = new Set();
    matches
      .filter((m) => m.round === r)
      .forEach((m) => {
        playing.add(m.team1_id);
        playing.add(m.team2_id);
      });
    teams
      .filter((t) => !playing.has(t.id))
      .forEach((t) => byes.push({ round: r, teamId: t.id }));
  }
  return {
    event,
    teams: teams.map((t) => ({ ...t, label: teamLabel(t) })),
    solos: solos.map((s) => ({
      id: s.id,
      person_id: s.person_id,
      name: s.name,
      created_at: s.created_at,
    })),
    matches,
    standings: standings.map((s) => ({
      rank: s.rank,
      teamId: s.team.id,
      label: teamLabel(s.team),
      w: s.w,
      l: s.l,
      played: s.played,
      earned: s.earned,
      against: s.against,
      possible: s.possible,
      ep: s.ep,
    })),
    payouts: payout ? { potCents: payout.potCents, places } : null,
    byes,
    isAdmin: await auth.isAdmin(req),
  };
}

function validDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(s));
}

function validTime(s) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(s || ''));
  return !!m && +m[1] < 24 && +m[2] < 60;
}

// ---------------------------------------------------------------- public

router.get('/round-robin/payouts', (req, res) => {
  res.json({ payouts: PAYOUTS });
});

router.get('/round-robin/events', (req, res) =>
  handle(async () => {
    const { rows } = await pool.query(
      `SELECT e.*,
              (SELECT COUNT(*) FROM rr_teams t WHERE t.event_id = e.id) AS team_count,
              (SELECT COUNT(*) FROM rr_solos s WHERE s.event_id = e.id) AS solo_count,
              (SELECT COUNT(*) FROM rr_rot_players p WHERE p.event_id = e.id) AS player_count,
              (SELECT COUNT(*) FROM rr_matches m WHERE m.event_id = e.id) +
              (SELECT COUNT(*) FROM rr_rot_matches m WHERE m.event_id = e.id) AS match_count,
              (SELECT COUNT(*) FROM rr_matches m WHERE m.event_id = e.id AND m.score1 IS NOT NULL) +
              (SELECT COUNT(*) FROM rr_rot_matches m WHERE m.event_id = e.id AND m.score1 IS NOT NULL) AS scored_count
         FROM rr_events e ORDER BY e.event_date DESC, e.id DESC`
    );
    // A signed-in player only sees playing/finished nights they are part
    // of (plus every setup night, so anyone can join). No viewer, or an
    // admin token, sees the full list as before.
    const viewer = asInt(req.query.viewer);
    if (viewer != null && !(await auth.isAdmin(req))) {
      const mine = await myNightIds('rr', viewer);
      return res.json({
        events: rows.filter((e) => e.status === 'setup' || mine.has(e.id)),
      });
    }
    res.json({ events: rows });
  }, req, res)
);

router.get('/round-robin/events/:id', (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Round robin not found.');
    // Once a night is running, only its players (and Admin) may open the
    // play. Setup nights stay public so anyone can open the join box.
    if (event.status !== 'setup') {
      const viewer = asInt(req.query.viewer);
      const isPart =
        viewer != null && (await isNightParticipant('rr', event.id, viewer));
      if (!isPart && !(await auth.isAdmin(req))) {
        return bad(res, 403, 'This night is only visible to its players.');
      }
    }
    res.json(await eventDetail(event, req));
  }, req, res)
);

// Score entry — public, like league game days. Blocked once the night is
// finished; a blank score clears a saved one.
router.post('/round-robin/events/:id/matches/:mid/score', (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Round robin not found.');
    if (event.status === 'completed') {
      return bad(res, 409, 'This night is finished. Reopen it from Admin to change a score.');
    }
    // Rotating nights keep their matches in rr_rot_matches; fixed nights
    // in rr_matches. The table name comes from the event row, never from
    // the request.
    const matchTable = event.format === 'rotating' ? 'rr_rot_matches' : 'rr_matches';
    const { rows } = await pool.query(
      `SELECT * FROM ${matchTable} WHERE id = $1 AND event_id = $2`,
      [req.params.mid, event.id]
    );
    const match = rows[0];
    if (!match) return bad(res, 404, 'Match not found.');
    let { score1, score2 } = req.body;
    const blank = score1 == null || score1 === '' || score2 == null || score2 === '';
    if (blank) {
      await pool.query(`UPDATE ${matchTable} SET score1 = NULL, score2 = NULL WHERE id = $1`, [match.id]);
      return res.json({ ok: true, cleared: true });
    }
    score1 = asInt(score1);
    score2 = asInt(score2);
    if (score1 == null || score2 == null || score1 < 0 || score2 < 0 || score1 > 30 || score2 > 30) {
      return bad(res, 400, 'Scores must be whole numbers from 0 to 30.');
    }
    const err = scoreError(score1, score2, match.target_score);
    if (err) return bad(res, 400, err);
    await pool.query(`UPDATE ${matchTable} SET score1 = $1, score2 = $2 WHERE id = $3`, [score1, score2, match.id]);
    res.json({ ok: true, score1, score2 });
  }, req, res)
);

// ---------------------------------------------------------------- self-join
// Members join a published night themselves instead of the organizer adding
// every team by hand. Only while the night is in setup AND published —
// joining closes automatically once the night is built (status playing).
// A team is a fixed pair, so join-team takes the person and their partner;
// join-solo leaves the person waiting to be paired by the admin.

async function getPerson(id) {
  const { rows } = await pool.query('SELECT id, name FROM people WHERE id = $1', [id]);
  return rows[0] || null;
}

// True when the person is an MPA member (a members row exists). Only
// members can be put on a night — a made-up name has no identity, so it
// can neither open the night nor enter a score.
async function isMember(id) {
  const { rows } = await pool.query('SELECT 1 FROM members WHERE person_id = $1 LIMIT 1', [id]);
  return rows.length > 0;
}

// True when the name is a member's full name (case-insensitive).
async function isMemberName(name) {
  const { rows } = await pool.query('SELECT 1 FROM members WHERE LOWER(name) = LOWER($1) LIMIT 1', [name]);
  return rows.length > 0;
}

// One player slot from the Admin add form: either a member picked from
// the list ({ personId }) or a guest typed by name ({ guest }). Returns
// { personId, name } or { error: [status, message] }. A guest name that
// is a member's full name is rejected — pick the member instead.
async function resolveSlot(personIdRaw, guestRaw) {
  const personId = asInt(personIdRaw);
  if (personId != null) {
    const person = await getPerson(personId);
    if (!person) return { error: [404, 'Person not found.'] };
    if (!(await isMember(personId))) return { error: [400, 'Players must be MPA members — join MPA first.'] };
    return { personId, name: person.name };
  }
  const guest = String(guestRaw || '').trim();
  if (!guest) return { error: [400, 'Pick a member or add a guest for each player.'] };
  if (guest.length > 60) return { error: [400, 'Names are too long.'] };
  if (await isMemberName(guest)) return { error: [400, 'That name belongs to a member — pick them from the list instead.'] };
  return { personId: null, name: guest };
}

// True when the person is already on this night — on a team (by person id)
// or signed up solo. Hand-added teams carry NULL person ids, so a name-only
// team is not a match here.
async function personOnNight(eventId, personId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM rr_teams WHERE event_id = $1 AND (person1_id = $2 OR person2_id = $2)
      UNION ALL SELECT 1 FROM rr_solos WHERE event_id = $1 AND person_id = $2 LIMIT 1`,
    [eventId, personId]
  );
  return rows.length > 0;
}

function joinNotOpen(event) {
  return event.status !== 'setup' || !event.published;
}

router.post('/round-robin/events/:id/join-team', (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Round robin not found.');
    if (event.format === 'rotating') {
      return bad(res, 400, 'This night rotates partners — join as an individual, not as a team.');
    }
    if (joinNotOpen(event)) return bad(res, 409, 'Sign-ups are not open for this night.');
    if (signupClosed(event)) return bad(res, 409, 'Sign-ups have closed.');
    const personId = asInt(req.body.personId);
    const partnerId = asInt(req.body.partnerPersonId);
    if (personId == null || partnerId == null) return bad(res, 400, 'Pick yourself and a partner.');
    if (personId === partnerId) {
      return bad(res, 400, 'The two players on a team must be different people.');
    }
    const [me, partner] = await Promise.all([getPerson(personId), getPerson(partnerId)]);
    if (!me || !partner) return bad(res, 404, 'Person not found.');
    if ((await personOnNight(event.id, personId)) || (await personOnNight(event.id, partnerId))) {
      return bad(res, 409, 'One of you is already on this night.');
    }
    const teams = await getTeams(event.id);
    if (teams.length >= nightMaxTeams(event)) {
      return bad(res, 400, `At most ${nightMaxTeams(event)} teams (${nightMaxTeams(event) * 2} players) per night.`);
    }
    const { rows } = await pool.query(
      'INSERT INTO rr_teams (event_id, player1, player2, person1_id, person2_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [event.id, me.name, partner.name, me.id, partner.id]
    );
    res.json({ ok: true, team: rows[0] });
  }, req, res)
);

router.post('/round-robin/events/:id/join-solo', (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Round robin not found.');
    if (event.format === 'rotating') {
      return bad(res, 400, 'This night rotates partners — join as an individual.');
    }
    if (joinNotOpen(event)) return bad(res, 409, 'Sign-ups are not open for this night.');
    if (signupClosed(event)) return bad(res, 409, 'Sign-ups have closed.');
    const personId = asInt(req.body.personId);
    if (personId == null) return bad(res, 400, 'Pick who you are.');
    const person = await getPerson(personId);
    if (!person) return bad(res, 404, 'Person not found.');
    if (await personOnNight(event.id, personId)) {
      return bad(res, 409, 'You are already on this night.');
    }
    const teams = await getTeams(event.id);
    if (teams.length >= nightMaxTeams(event)) {
      return bad(res, 400, `At most ${nightMaxTeams(event)} teams (${nightMaxTeams(event) * 2} players) per night.`);
    }
    let rows;
    try {
      ({ rows } = await pool.query(
        'INSERT INTO rr_solos (event_id, person_id) VALUES ($1, $2) RETURNING *',
        [event.id, person.id]
      ));
    } catch (e) {
      // The UNIQUE(event_id, person_id) backstop — a second solo sign-up
      // racing the check above lands here instead of a 500.
      if (e.code === '23505') return bad(res, 409, 'You are already on this night.');
      throw e;
    }
    res.json({ ok: true, solo: { ...rows[0], name: person.name } });
  }, req, res)
);

// Join a rotating night as an individual — no team, no solo pairing.
// Rotating nights only; fixed nights keep join-team / join-solo.
router.post('/round-robin/events/:id/join', (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Round robin not found.');
    if (event.format !== 'rotating') {
      return bad(res, 400, 'This night uses fixed teams — join as a team or solo.');
    }
    if (joinNotOpen(event)) return bad(res, 409, 'Sign-ups are not open for this night.');
    if (signupClosed(event)) return bad(res, 409, 'Sign-ups have closed.');
    const personId = asInt(req.body.personId);
    if (personId == null) return bad(res, 400, 'Pick who you are.');
    const person = await getPerson(personId);
    if (!person) return bad(res, 404, 'Person not found.');
    const players = await getRotPlayers(event.id);
    if (players.some((p) => p.person_id === personId)) {
      return bad(res, 409, 'You are already on this night.');
    }
    if (players.length >= nightMaxPlayers(event)) {
      return bad(res, 400, `At most ${nightMaxPlayers(event)} players per night.`);
    }
    let rows;
    try {
      ({ rows } = await pool.query(
        'INSERT INTO rr_rot_players (event_id, name, person_id) VALUES ($1, $2, $3) RETURNING *',
        [event.id, person.name, person.id]
      ));
    } catch (e) {
      // The UNIQUE(event_id, person_id) backstop — a second sign-up
      // racing the check above lands here instead of a 500.
      if (e.code === '23505') return bad(res, 409, 'You are already on this night.');
      throw e;
    }
    res.json({ ok: true, player: rows[0] });
  }, req, res)
);

// Leave while the night is still in setup. No leaving once it is built —
// the schedule is fixed then, like a league game day after the deadline.
router.post('/round-robin/events/:id/leave', (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Round robin not found.');
    if (event.status !== 'setup') {
      return bad(res, 409, 'The night is already built — sign-ups are closed.');
    }
    const personId = asInt(req.body.personId);
    if (personId == null) return bad(res, 400, 'Pick who you are.');
    if (event.format === 'rotating') {
      const { rowCount } = await pool.query(
        'DELETE FROM rr_rot_players WHERE event_id = $1 AND person_id = $2',
        [event.id, personId]
      );
      if (!rowCount) return bad(res, 404, 'You are not on this night.');
      return res.json({ ok: true, left: 'player' });
    }
    const teamDel = await pool.query(
      'DELETE FROM rr_teams WHERE event_id = $1 AND (person1_id = $2 OR person2_id = $2)',
      [event.id, personId]
    );
    if (teamDel.rowCount) return res.json({ ok: true, left: 'team' });
    const soloDel = await pool.query(
      'DELETE FROM rr_solos WHERE event_id = $1 AND person_id = $2',
      [event.id, personId]
    );
    if (!soloDel.rowCount) return bad(res, 404, 'You are not on this night.');
    res.json({ ok: true, left: 'solo' });
  }, req, res)
);

// ---------------------------------------------------------------- admin

router.post('/admin/round-robin/events', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const name = String(req.body.name || '').trim();
    if (!name) return bad(res, 400, 'Give the night a name.');
    if (name.length > 100) return bad(res, 400, 'Name is too long.');
    if (!validDate(req.body.event_date)) return bad(res, 400, 'Pick a valid date.');
    // Money Ball is the default kind (the create card shows it picked).
    const kind = req.body.kind === 'charity' ? 'charity' : 'money';
    const feeCents = kind === 'money' ? asInt(req.body.fee_cents) : 0;
    if (kind === 'money' && (feeCents == null || feeCents < 0 || feeCents > 100000)) {
      return bad(res, 400, 'Entry fee must be between $0 and $1,000 per person.');
    }
    // Rotating partners is a new format (migration 016): partners change
    // every round and each player carries their own points. Charity/free
    // only — money ball stays fixed-team.
    const format = req.body.format === 'rotating' ? 'rotating' : 'fixed';
    const winnerRule = ['ep', 'points', 'wins'].includes(req.body.winner_rule)
      ? req.body.winner_rule
      : 'ep';
    const maxPlayers = req.body.max_players != null ? asInt(req.body.max_players) : 12;
    if (format === 'rotating' && kind === 'money') {
      return bad(res, 400, 'Rotating nights are free — money ball stays fixed-team.');
    }
    if (format === 'rotating' && (maxPlayers == null || maxPlayers < 2 || maxPlayers > 24)) {
      return bad(res, 400, 'Max players must be between 2 and 24.');
    }
    const payout = payoutById(req.body.payout).id;
    let startTime = '18:30';
    if (req.body.start_time != null) {
      if (!validTime(req.body.start_time)) return bad(res, 400, 'Pick a valid start time.');
      startTime = String(req.body.start_time).slice(0, 5);
    }
    const maxTeams = req.body.max_teams != null ? asInt(req.body.max_teams) : 6;
    if (maxTeams == null || maxTeams < 2 || maxTeams > MAX_TEAMS) {
      return bad(res, 400, `Max teams must be between 2 and ${MAX_TEAMS}.`);
    }
    const signupClose = req.body.signup_close === 'fill' ? 'fill' : 'day-3h';
    // Published by default: the create card opens with Published ✓, so
    // members see the night as soon as it is created.
    const published = req.body.published != null ? Boolean(req.body.published) : true;
    const { rows } = await pool.query(
      `INSERT INTO rr_events (name, event_date, kind, fee_cents, payout, start_time, max_teams, signup_close, published, format, winner_rule, max_players)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [name, req.body.event_date, kind, feeCents || 0, payout, startTime, maxTeams, signupClose, published, format, winnerRule, maxPlayers]
    );
    res.json({ ok: true, event: rows[0] });
  }, req, res)
);

router.patch('/admin/round-robin/events/:id', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Round robin not found.');
    if (event.status !== 'setup') {
      return bad(res, 409, 'Only a night still in setup can be edited.');
    }
    const name = req.body.name != null ? String(req.body.name).trim() : event.name;
    if (!name) return bad(res, 400, 'Give the night a name.');
    if (req.body.event_date != null && !validDate(req.body.event_date)) {
      return bad(res, 400, 'Pick a valid date.');
    }
    const kind = req.body.kind === 'money' ? 'money' : req.body.kind === 'charity' ? 'charity' : event.kind;
    const feeCents =
      kind === 'money'
        ? req.body.fee_cents != null
          ? asInt(req.body.fee_cents)
          : event.fee_cents
        : 0;
    if (kind === 'money' && (feeCents == null || feeCents < 0 || feeCents > 100000)) {
      return bad(res, 400, 'Entry fee must be between $0 and $1,000 per person.');
    }
    if (event.format === 'rotating' && kind === 'money') {
      return bad(res, 400, 'Rotating nights are free — money ball stays fixed-team.');
    }
    const winnerRule =
      req.body.winner_rule != null
        ? ['ep', 'points', 'wins'].includes(req.body.winner_rule)
          ? req.body.winner_rule
          : null
        : event.winner_rule || 'ep';
    if (winnerRule == null) return bad(res, 400, 'Pick a valid winner rule.');
    const maxPlayers = req.body.max_players != null ? asInt(req.body.max_players) : event.max_players || 12;
    if (maxPlayers == null || maxPlayers < 2 || maxPlayers > 24) {
      return bad(res, 400, 'Max players must be between 2 and 24.');
    }
    const payout = req.body.payout != null ? payoutById(req.body.payout).id : event.payout;
    const published = req.body.published != null ? Boolean(req.body.published) : event.published;
    let startTime = event.start_time ? String(event.start_time).slice(0, 5) : '18:30';
    if (req.body.start_time != null) {
      if (!validTime(req.body.start_time)) return bad(res, 400, 'Pick a valid start time.');
      startTime = String(req.body.start_time).slice(0, 5);
    }
    const maxTeams = req.body.max_teams != null ? asInt(req.body.max_teams) : event.max_teams || 6;
    if (maxTeams == null || maxTeams < 2 || maxTeams > MAX_TEAMS) {
      return bad(res, 400, `Max teams must be between 2 and ${MAX_TEAMS}.`);
    }
    const signupClose =
      req.body.signup_close === 'fill' || req.body.signup_close === 'day-3h'
        ? req.body.signup_close
        : event.signup_close || 'day-3h';
    const { rows } = await pool.query(
      `UPDATE rr_events SET name = $1, event_date = $2, kind = $3, fee_cents = $4, payout = $5, published = $6, start_time = $7, max_teams = $8, signup_close = $9, winner_rule = $10, max_players = $11
       WHERE id = $12 RETURNING *`,
      [name, req.body.event_date || event.event_date, kind, feeCents || 0, payout, published, startTime, maxTeams, signupClose, winnerRule, maxPlayers, event.id]
    );
    res.json({ ok: true, event: rows[0] });
  }, req, res)
);

router.delete('/admin/round-robin/events/:id', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Round robin not found.');
    await pool.query('DELETE FROM rr_events WHERE id = $1', [event.id]);
    res.json({ ok: true });
  }, req, res)
);

router.post('/admin/round-robin/events/:id/teams', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Round robin not found.');
    if (event.status !== 'setup') {
      return bad(res, 409, 'Teams can only be added while the night is in setup.');
    }
    const teams = await getTeams(event.id);
    if (teams.length >= nightMaxTeams(event)) {
      return bad(res, 400, `At most ${nightMaxTeams(event)} teams (${nightMaxTeams(event) * 2} players) per night.`);
    }
    // Each slot is a member picked from the list or a guest typed by
    // name. Member slots carry real person ids; guest slots store the
    // typed name with a NULL person id.
    const s1 = await resolveSlot(req.body.person1Id, req.body.guest1);
    if (s1.error) return bad(res, s1.error[0], s1.error[1]);
    const s2 = await resolveSlot(req.body.person2Id, req.body.guest2);
    if (s2.error) return bad(res, s2.error[0], s2.error[1]);
    if (s1.personId != null && s1.personId === s2.personId) {
      return bad(res, 400, 'The two players on a team must be different people.');
    }
    // Already on this night — by person id, or by name on a legacy
    // hand-added team whose person ids are NULL. Guests are names only,
    // so they are never "already on" by this check.
    const nameOnNight = (name) => teams.some((t) =>
      [t.player1, t.player2].some((n) => n && n.toLowerCase() === name.toLowerCase()));
    for (const s of [s1, s2]) {
      if (s.personId != null && ((await personOnNight(event.id, s.personId)) || nameOnNight(s.name))) {
        return bad(res, 409, 'One of these players is already on this night.');
      }
    }
    const { rows } = await pool.query(
      'INSERT INTO rr_teams (event_id, player1, player2, person1_id, person2_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [event.id, s1.name, s2.name, s1.personId, s2.personId]
    );
    res.json({ ok: true, team: rows[0] });
  }, req, res)
);

router.delete('/admin/round-robin/events/:id/teams/:tid', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Round robin not found.');
    if (event.status !== 'setup') {
      return bad(res, 409, 'Teams can only be removed while the night is in setup.');
    }
    const { rowCount } = await pool.query(
      'DELETE FROM rr_teams WHERE id = $1 AND event_id = $2',
      [req.params.tid, event.id]
    );
    if (!rowCount) return bad(res, 404, 'Team not found.');
    res.json({ ok: true });
  }, req, res)
);

// ---- rotating nights: individual players + main/rotator setup ----
// Rotating nights have players, not teams: the admin adds people by name
// (optionally linked to a member record) and picks one main player whose
// partner cycles through the rotators. All of it is setup-only.

router.post('/admin/round-robin/events/:id/players', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Round robin not found.');
    if (event.format !== 'rotating') {
      return bad(res, 400, 'This night uses fixed teams — add a team instead.');
    }
    if (event.status !== 'setup') {
      return bad(res, 409, 'Players can only be added while the night is in setup.');
    }
    const players = await getRotPlayers(event.id);
    // A member picked from the list or a guest typed by name.
    const s = await resolveSlot(req.body.personId, req.body.guest);
    if (s.error) return bad(res, s.error[0], s.error[1]);
    if (s.personId != null && players.some((p) => p.person_id === s.personId
      || (p.name && p.name.toLowerCase() === s.name.toLowerCase()))) {
      return bad(res, 409, 'That person is already on this night.');
    }
    if (players.length >= nightMaxPlayers(event)) {
      return bad(res, 400, `At most ${nightMaxPlayers(event)} players per night.`);
    }
    const { rows } = await pool.query(
      'INSERT INTO rr_rot_players (event_id, name, person_id) VALUES ($1, $2, $3) RETURNING *',
      [event.id, s.name, s.personId]
    );
    res.json({ ok: true, player: rows[0] });
  }, req, res)
);

router.delete('/admin/round-robin/events/:id/players/:pid', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Round robin not found.');
    if (event.format !== 'rotating') {
      return bad(res, 400, 'This night uses fixed teams.');
    }
    if (event.status !== 'setup') {
      return bad(res, 409, 'Players can only be removed while the night is in setup.');
    }
    const { rowCount } = await pool.query(
      'DELETE FROM rr_rot_players WHERE id = $1 AND event_id = $2',
      [req.params.pid, event.id]
    );
    if (!rowCount) return bad(res, 404, 'Player not found.');
    res.json({ ok: true });
  }, req, res)
);

// Set the main player and the rotators who cycle through as the main's
// partner. Either may be empty (no main = everyone rotates freely).
// Replaces the whole config each time: the old main flag and rotator
// order are cleared first, then the new ones are set.
router.post('/admin/round-robin/events/:id/rotation', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Round robin not found.');
    if (event.format !== 'rotating') {
      return bad(res, 400, 'This night uses fixed teams.');
    }
    if (event.status !== 'setup') {
      return bad(res, 409, 'The rotation can only be set while the night is in setup.');
    }
    const mainPlayerId = req.body.mainPlayerId != null ? asInt(req.body.mainPlayerId) : null;
    const rotatorIds = Array.isArray(req.body.rotatorPlayerIds)
      ? req.body.rotatorPlayerIds.map(asInt)
      : [];
    if (req.body.mainPlayerId != null && mainPlayerId == null) {
      return bad(res, 400, 'Pick a valid main player.');
    }
    if (rotatorIds.some((x) => x == null)) {
      return bad(res, 400, 'Rotators must be players on this night.');
    }
    if (rotatorIds.length > MAX_ROTATORS) {
      return bad(res, 400, `At most ${MAX_ROTATORS} players rotate with the main player.`);
    }
    const players = await getRotPlayers(event.id);
    const ids = new Set(players.map((p) => p.id));
    if (mainPlayerId != null && !ids.has(mainPlayerId)) {
      return bad(res, 404, 'Main player is not on this night.');
    }
    if (rotatorIds.some((x) => !ids.has(x))) {
      return bad(res, 404, 'A rotator is not on this night.');
    }
    if (new Set(rotatorIds).size !== rotatorIds.length) {
      return bad(res, 400, 'Each rotator can only be picked once.');
    }
    if (mainPlayerId != null && rotatorIds.includes(mainPlayerId)) {
      return bad(res, 400, 'The main player cannot also rotate with themself.');
    }
    await pool.query('BEGIN');
    try {
      await pool.query(
        'UPDATE rr_rot_players SET is_main = FALSE, rotator_order = NULL WHERE event_id = $1',
        [event.id]
      );
      if (mainPlayerId != null) {
        await pool.query('UPDATE rr_rot_players SET is_main = TRUE WHERE id = $1', [mainPlayerId]);
      }
      for (let i = 0; i < rotatorIds.length; i++) {
        await pool.query('UPDATE rr_rot_players SET rotator_order = $1 WHERE id = $2', [i + 1, rotatorIds[i]]);
      }
      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
    res.json({ ok: true, mainPlayerId, rotatorPlayerIds: rotatorIds });
  }, req, res)
);

// Pair two solo sign-ups into one team (Admin-only, setup only). The two
// solo rows are removed and one team takes their place.
router.post('/admin/round-robin/events/:id/pair', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Round robin not found.');
    if (event.status !== 'setup') {
      return bad(res, 409, 'Solos can only be paired while the night is in setup.');
    }
    const soloIdA = asInt(req.body.soloIdA);
    const soloIdB = asInt(req.body.soloIdB);
    if (soloIdA == null || soloIdB == null) return bad(res, 400, 'Pick two solos to pair.');
    if (soloIdA === soloIdB) return bad(res, 400, 'Pick two different solos.');
    const { rows } = await pool.query(
      `SELECT s.id, s.person_id, p.name FROM rr_solos s JOIN people p ON p.id = s.person_id
        WHERE s.event_id = $1 AND s.id IN ($2, $3)`,
      [event.id, soloIdA, soloIdB]
    );
    if (rows.length !== 2) return bad(res, 404, 'One of those solos is not on this night.');
    const a = rows.find((r) => r.id === soloIdA);
    const b = rows.find((r) => r.id === soloIdB);
    if (a.person_id === b.person_id) {
      return bad(res, 400, 'The two players on a team must be different people.');
    }
    const teams = await getTeams(event.id);
    if (teams.length >= nightMaxTeams(event)) {
      return bad(res, 400, `At most ${nightMaxTeams(event)} teams (${nightMaxTeams(event) * 2} players) per night.`);
    }
    await pool.query('BEGIN');
    try {
      await pool.query('DELETE FROM rr_solos WHERE id IN ($1, $2)', [soloIdA, soloIdB]);
      const { rows: teamRows } = await pool.query(
        'INSERT INTO rr_teams (event_id, player1, player2, person1_id, person2_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [event.id, a.name, b.name, a.person_id, b.person_id]
      );
      await pool.query('COMMIT');
      res.json({ ok: true, team: teamRows[0] });
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
  }, req, res)
);

// Build the schedule (Admin-only). Every team plays every other team once.
// Rebuilding is allowed while no score has been entered yet.
router.post('/admin/round-robin/events/:id/build', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Round robin not found.');
    if (event.status === 'completed') {
      return bad(res, 409, 'This night is finished.');
    }
    if (event.format === 'rotating') {
      // Rotating partners: the engine builds 5 rounds from the players in
      // join order, with the main player's partner cycling the rotators.
      const players = await getRotPlayers(event.id);
      if (players.length < 4) {
        return bad(res, 400, 'Add at least 4 players before building the night.');
      }
      const existing = await getRotMatches(event.id);
      if (existing.some((m) => m.score1 != null)) {
        return bad(res, 409, 'Scores have already been entered — the night can’t be rebuilt.');
      }
      const { main, rotators } = rotMainAndRotators(players);
      const { matches: schedule, byes } = buildRotationSchedule(
        players.map((p) => p.id),
        { mainId: main ? main.id : null, rotatorIds: rotators.map((p) => p.id) }
      );
      await pool.query('BEGIN');
      try {
        await pool.query('DELETE FROM rr_rot_matches WHERE event_id = $1', [event.id]);
        for (const s of schedule) {
          await pool.query(
            `INSERT INTO rr_rot_matches (event_id, round, court, p1_id, p2_id, p3_id, p4_id, target_score)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [event.id, s.round, s.court, s.p1Id, s.p2Id, s.p3Id, s.p4Id, s.target]
          );
        }
        await pool.query("UPDATE rr_events SET status = 'playing' WHERE id = $1", [event.id]);
        await pool.query('COMMIT');
      } catch (e) {
        await pool.query('ROLLBACK');
        throw e;
      }
      return res.json({ ok: true, matches: schedule.length, rounds: ROT_ROUNDS, byes: byes.length });
    }
    const teams = await getTeams(event.id);
    if (teams.length < 2) {
      return bad(res, 400, 'Add at least 2 teams before building the night.');
    }
    const matches = await getMatches(event.id);
    if (matches.some((m) => m.score1 != null)) {
      return bad(res, 409, 'Scores have already been entered — the night can’t be rebuilt.');
    }
    const schedule = buildSchedule(teams.map((t) => t.id));
    await pool.query('BEGIN');
    try {
      await pool.query('DELETE FROM rr_matches WHERE event_id = $1', [event.id]);
      for (const s of schedule) {
        await pool.query(
          `INSERT INTO rr_matches (event_id, round, court, team1_id, team2_id, target_score)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [event.id, s.round, s.court, s.team1Id, s.team2Id, s.target]
        );
      }
      await pool.query("UPDATE rr_events SET status = 'playing' WHERE id = $1", [event.id]);
      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
    res.json({ ok: true, matches: schedule.length, rounds: Math.max(...schedule.map((s) => s.round)) });
  }, req, res)
);

// Finish the night (Admin-only). Asks "finish anyway?" if games are unscored.
router.post('/admin/round-robin/events/:id/finish', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Round robin not found.');
    if (event.status === 'completed') {
      return bad(res, 409, 'This night is already finished.');
    }
    if (event.status !== 'playing') {
      return bad(res, 409, 'Build the night before finishing it.');
    }
    const matches = event.format === 'rotating' ? await getRotMatches(event.id) : await getMatches(event.id);
    const unscored = matches.filter((m) => m.score1 == null).length;
    if (unscored > 0 && !req.body.force) {
      return bad(res, 409, `${unscored} game(s) are still unscored.`);
    }
    await pool.query("UPDATE rr_events SET status = 'completed' WHERE id = $1", [event.id]);
    res.json({ ok: true });
  }, req, res)
);

router.post('/admin/round-robin/events/:id/reopen', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Round robin not found.');
    if (event.status !== 'completed') {
      return bad(res, 409, 'Only a finished night can be reopened.');
    }
    await pool.query("UPDATE rr_events SET status = 'playing' WHERE id = $1", [event.id]);
    res.json({ ok: true });
  }, req, res)
);

module.exports = router;

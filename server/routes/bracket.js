'use strict';
// Bracket routes. One-off double-elimination nights, separate from leagues
// and from round robin: fixed doubles teams stay together all night, teams
// are seeded by combined doubles rating, losers drop to a second bracket,
// lose twice and you're out. The winners-bracket champion meets the
// losers-bracket champion in the grand final, with a reset game if the
// losers champion wins the first final. One game to 11 per match, first to
// 11, win by 1, no deuce — the same game as round robin. Free charity
// nights have no fee and no payouts; money-ball nights have a per-person
// entry fee and a payout structure (House Rule default: 3rd place gets its
// entry fee back, 1st and 2nd split the rest 60/40).
// Mirrors server/routes/roundrobin.js: same public/admin split, same
// self-join flow, same admin tools. Matches are stored with slot
// references (server/lib/bracket.js) and resolved on read.
// Public: list events, view an event, enter a score (a view, not a lock —
// the same trade-off as league game days). Admin (passcode,
// server-enforced): create/edit/delete events, add/remove teams, build the
// bracket, finish/reopen.
const express = require('express');
const { pool } = require('../db');
const auth = require('../lib/auth');
const {
  PAYOUTS,
  payoutById,
  computePayouts,
  scoreError,
  signupCloseAt,
} = require('../lib/roundrobin');
const {
  BRACKET_SIZES,
  buildBracket,
  resolveBracket,
  computeBracketPlaces,
  computeBracketRecords,
  dependentMatchKeys,
} = require('../lib/bracket');
const { myNightIds, isNightParticipant, teamLabel, markTeamGuests, memberNameSet } = require('../lib/nights');

const router = express.Router();

// Per-night team cap: the night's own max_teams (set at create), which is
// also its bracket size — one of 4/6/8/10/12/16.
function nightMaxTeams(event) {
  return event.max_teams || 12;
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

async function getEvent(id, includeDeleted = false) {
  const { rows } = await pool.query(
    'SELECT * FROM br_events WHERE id = $1' + (includeDeleted ? '' : ' AND deleted_at IS NULL'),
    [id]
  );
  return rows[0] || null;
}

async function getTeams(eventId) {
  const { rows } = await pool.query(
    'SELECT * FROM br_teams WHERE event_id = $1 ORDER BY id',
    [eventId]
  );
  return rows;
}

// Matches arrive in creation order (id order) — the bracket is built in
// dependency order, so one forward pass resolves every slot.
async function getMatches(eventId) {
  const { rows } = await pool.query(
    'SELECT * FROM br_matches WHERE event_id = $1 ORDER BY id',
    [eventId]
  );
  return rows;
}

// Solo sign-ups waiting to be paired into teams.
async function getSolos(eventId) {
  const { rows } = await pool.query(
    `SELECT s.id, s.event_id, s.person_id, s.created_at, p.name
       FROM br_solos s JOIN people p ON p.id = s.person_id
      WHERE s.event_id = $1 ORDER BY s.created_at`,
    [eventId]
  );
  return rows;
}

// A stored br_matches row as a lib-style match (key = DB id, slot refs
// already point at DB ids — the build inserts in creation order).
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

// Full event payload: event + teams + solos + matches (with slots resolved
// to team ids) + podium + records + payouts.
async function eventDetail(event, req) {
  const [teams, matches, solos, memberNames] = await Promise.all([
    getTeams(event.id),
    getMatches(event.id),
    getSolos(event.id),
    memberNameSet(),
  ]);
  teams.forEach((t) => markTeamGuests(t, memberNames));
  const libMatches = matches.map(toLibMatch);
  const seedToTeamId = new Map(
    teams.filter((t) => t.seed != null).map((t) => [t.seed, t.id])
  );
  const resolved = resolveBracket(libMatches, seedToTeamId);
  const podium = computeBracketPlaces(libMatches, resolved);
  const records = computeBracketRecords(
    libMatches,
    resolved,
    teams.map((t) => t.id)
  );
  const payout = computePayouts({
    kind: event.kind,
    feeCents: event.fee_cents,
    payoutId: event.payout,
    teamCount: teams.length,
  });
  // A bracket only decides 1st, 2nd and 3rd — a 4-place payout structure
  // has no 4th-place team, so any place past 3rd shows with no team.
  const places = payout
    ? payout.places.map((p) => ({
        ...p,
        teamId:
          p.place === 1
            ? podium.champion
            : p.place === 2
              ? podium.runnerUp
              : p.place === 3
                ? podium.third
                : null,
      }))
    : [];
  return {
    event,
    teams: teams.map((t) => ({ ...t, label: teamLabel(t) })),
    solos: solos.map((s) => ({
      id: s.id,
      person_id: s.person_id,
      name: s.name,
      created_at: s.created_at,
    })),
    matches: matches.map((m) => {
      const r = resolved.get(m.id);
      return {
        ...m,
        team1_id: r.team1Id,
        team2_id: r.team2Id,
        winner_id: r.winnerId,
        loser_id: r.loserId,
        ready: r.ready,
        active: r.active,
      };
    }),
    podium,
    records,
    payouts: payout ? { potCents: payout.potCents, places } : null,
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

router.get('/bracket/payouts', (req, res) => {
  res.json({ payouts: PAYOUTS });
});

router.get('/bracket/events', (req, res) =>
  handle(async () => {
    const { rows } = await pool.query(
      `SELECT e.*,
              (SELECT COUNT(*) FROM br_teams t WHERE t.event_id = e.id) AS team_count,
              (SELECT COUNT(*) FROM br_solos s WHERE s.event_id = e.id) AS solo_count,
              (SELECT COUNT(*) FROM br_matches m WHERE m.event_id = e.id) AS match_count,
              (SELECT COUNT(*) FROM br_matches m WHERE m.event_id = e.id AND m.score1 IS NOT NULL) AS scored_count
         FROM br_events e WHERE e.deleted_at IS NULL ORDER BY e.event_date DESC, e.id DESC`
    );
    // A signed-in player only sees playing/finished nights they are part
    // of (plus every setup night, so anyone can join). No viewer, or an
    // admin token, sees the full list as before.
    const viewer = asInt(req.query.viewer);
    if (viewer != null && !(await auth.isAdmin(req))) {
      const mine = await myNightIds('bracket', viewer);
      return res.json({
        events: rows.filter((e) => e.status === 'setup' || mine.has(e.id)),
      });
    }
    res.json({ events: rows });
  }, req, res)
);

router.get('/bracket/events/:id', (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Bracket night not found.');
    // Once a night is running, only its players (and Admin) may open the
    // play. Setup nights stay public so anyone can open the join box.
    if (event.status !== 'setup') {
      const viewer = asInt(req.query.viewer);
      const isPart =
        viewer != null &&
        (await isNightParticipant('bracket', event.id, viewer));
      if (!isPart && !(await auth.isAdmin(req))) {
        return bad(res, 403, 'This night is only visible to its players.');
      }
    }
    res.json(await eventDetail(event, req));
  }, req, res)
);

// Score entry — public, like league game days and round robin. Blocked
// once the night is finished; a blank score clears a saved one. A match
// can only be scored once both its teams are decided, and the reset game
// only once it is actually needed. Changing (or clearing) a score clears
// every later match that depended on it — a corrected early result must
// not leave later results standing on teams that no longer advanced.
router.post('/bracket/events/:id/matches/:mid/score', (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Bracket night not found.');
    if (event.status === 'completed') {
      return bad(res, 409, 'This night is finished. Reopen it from Admin to change a score.');
    }
    const { rows } = await pool.query(
      'SELECT * FROM br_matches WHERE id = $1 AND event_id = $2',
      [req.params.mid, event.id]
    );
    const match = rows[0];
    if (!match) return bad(res, 404, 'Match not found.');
    const allMatches = await getMatches(event.id);
    const teams = await getTeams(event.id);
    const seedToTeamId = new Map(
      teams.filter((t) => t.seed != null).map((t) => [t.seed, t.id])
    );
    const libMatches = allMatches.map(toLibMatch);
    const resolved = resolveBracket(libMatches, seedToTeamId);
    const r = resolved.get(match.id);
    if (!r.ready) {
      return bad(res, 409, 'This match isn’t ready yet — its teams aren’t decided.');
    }
    if (!r.active) {
      return bad(res, 409, 'No reset game is needed — the winners-bracket champion won the grand final.');
    }
    let { score1, score2 } = req.body;
    const blank = score1 == null || score1 === '' || score2 == null || score2 === '';
    const hadScore = match.score1 != null;
    if (blank) {
      await pool.query('UPDATE br_matches SET score1 = NULL, score2 = NULL WHERE id = $1', [match.id]);
      if (hadScore) {
        const deps = dependentMatchKeys(libMatches, match.id);
        if (deps.length) {
          await pool.query('UPDATE br_matches SET score1 = NULL, score2 = NULL WHERE id = ANY($1)', [deps]);
        }
      }
      return res.json({ ok: true, cleared: true });
    }
    score1 = asInt(score1);
    score2 = asInt(score2);
    if (score1 == null || score2 == null || score1 < 0 || score2 < 0 || score1 > 30 || score2 > 30) {
      return bad(res, 400, 'Scores must be whole numbers from 0 to 30.');
    }
    const err = scoreError(score1, score2, match.target_score);
    if (err) return bad(res, 400, err);
    await pool.query('UPDATE br_matches SET score1 = $1, score2 = $2 WHERE id = $3', [score1, score2, match.id]);
    if (hadScore && (score1 !== match.score1 || score2 !== match.score2)) {
      const deps = dependentMatchKeys(libMatches, match.id);
      if (deps.length) {
        await pool.query('UPDATE br_matches SET score1 = NULL, score2 = NULL WHERE id = ANY($1)', [deps]);
      }
    }
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
    `SELECT 1 FROM br_teams WHERE event_id = $1 AND (person1_id = $2 OR person2_id = $2)
      UNION ALL SELECT 1 FROM br_solos WHERE event_id = $1 AND person_id = $2 LIMIT 1`,
    [eventId, personId]
  );
  return rows.length > 0;
}

function joinNotOpen(event) {
  return event.status !== 'setup' || !event.published;
}

router.post('/bracket/events/:id/join-team', (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Bracket night not found.');
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
      'INSERT INTO br_teams (event_id, player1, player2, person1_id, person2_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [event.id, me.name, partner.name, me.id, partner.id]
    );
    res.json({ ok: true, team: rows[0] });
  }, req, res)
);

router.post('/bracket/events/:id/join-solo', (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Bracket night not found.');
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
        'INSERT INTO br_solos (event_id, person_id) VALUES ($1, $2) RETURNING *',
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

// Leave while the night is still in setup. No leaving once it is built —
// the bracket is fixed then, like a league game day after the deadline.
router.post('/bracket/events/:id/leave', (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Bracket night not found.');
    if (event.status !== 'setup') {
      return bad(res, 409, 'The night is already built — sign-ups are closed.');
    }
    const personId = asInt(req.body.personId);
    if (personId == null) return bad(res, 400, 'Pick who you are.');
    const teamDel = await pool.query(
      'DELETE FROM br_teams WHERE event_id = $1 AND (person1_id = $2 OR person2_id = $2)',
      [event.id, personId]
    );
    if (teamDel.rowCount) return res.json({ ok: true, left: 'team' });
    const soloDel = await pool.query(
      'DELETE FROM br_solos WHERE event_id = $1 AND person_id = $2',
      [event.id, personId]
    );
    if (!soloDel.rowCount) return bad(res, 404, 'You are not on this night.');
    res.json({ ok: true, left: 'solo' });
  }, req, res)
);

// ---------------------------------------------------------------- admin

router.post('/admin/bracket/events', auth.requireAdmin, (req, res) =>
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
    const payout = payoutById(req.body.payout).id;
    let startTime = '18:30';
    if (req.body.start_time != null) {
      if (!validTime(req.body.start_time)) return bad(res, 400, 'Pick a valid start time.');
      startTime = String(req.body.start_time).slice(0, 5);
    }
    const maxTeams = req.body.max_teams != null ? asInt(req.body.max_teams) : 12;
    if (maxTeams == null || !BRACKET_SIZES.includes(maxTeams)) {
      return bad(res, 400, `Teams must be 4, 6, 8, 10, 12 or 16.`);
    }
    const signupClose = req.body.signup_close === 'fill' ? 'fill' : 'day-3h';
    // Published by default: the create card opens with Published ✓, so
    // members see the night as soon as it is created.
    const published = req.body.published != null ? Boolean(req.body.published) : true;
    const { rows } = await pool.query(
      `INSERT INTO br_events (name, event_date, kind, fee_cents, payout, start_time, max_teams, signup_close, published)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [name, req.body.event_date, kind, feeCents || 0, payout, startTime, maxTeams, signupClose, published]
    );
    res.json({ ok: true, event: rows[0] });
  }, req, res)
);

router.patch('/admin/bracket/events/:id', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Bracket night not found.');
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
    const payout = req.body.payout != null ? payoutById(req.body.payout).id : event.payout;
    const published = req.body.published != null ? Boolean(req.body.published) : event.published;
    let startTime = event.start_time ? String(event.start_time).slice(0, 5) : '18:30';
    if (req.body.start_time != null) {
      if (!validTime(req.body.start_time)) return bad(res, 400, 'Pick a valid start time.');
      startTime = String(req.body.start_time).slice(0, 5);
    }
    const maxTeams = req.body.max_teams != null ? asInt(req.body.max_teams) : event.max_teams || 12;
    if (maxTeams == null || !BRACKET_SIZES.includes(maxTeams)) {
      return bad(res, 400, `Teams must be 4, 6, 8, 10, 12 or 16.`);
    }
    const signupClose =
      req.body.signup_close === 'fill' || req.body.signup_close === 'day-3h'
        ? req.body.signup_close
        : event.signup_close || 'day-3h';
    const { rows } = await pool.query(
      `UPDATE br_events SET name = $1, event_date = $2, kind = $3, fee_cents = $4, payout = $5, published = $6, start_time = $7, max_teams = $8, signup_close = $9
       WHERE id = $10 RETURNING *`,
      [name, req.body.event_date || event.event_date, kind, feeCents || 0, payout, published, startTime, maxTeams, signupClose, event.id]
    );
    res.json({ ok: true, event: rows[0] });
  }, req, res)
);

router.delete('/admin/bracket/events/:id', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Bracket night not found.');
    // Soft delete (migration 017): the night leaves the players' view
    // but stays in the database — the Admin-only Finished tab still
    // holds it, where it can be restored or deleted forever.
    await pool.query('UPDATE br_events SET deleted_at = now() WHERE id = $1', [event.id]);
    res.json({ ok: true });
  }, req, res)
);

router.post('/admin/bracket/events/:id/teams', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Bracket night not found.');
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
      'INSERT INTO br_teams (event_id, player1, player2, person1_id, person2_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [event.id, s1.name, s2.name, s1.personId, s2.personId]
    );
    res.json({ ok: true, team: rows[0] });
  }, req, res)
);

router.delete('/admin/bracket/events/:id/teams/:tid', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Bracket night not found.');
    if (event.status !== 'setup') {
      return bad(res, 409, 'Teams can only be removed while the night is in setup.');
    }
    const { rowCount } = await pool.query(
      'DELETE FROM br_teams WHERE id = $1 AND event_id = $2',
      [req.params.tid, event.id]
    );
    if (!rowCount) return bad(res, 404, 'Team not found.');
    res.json({ ok: true });
  }, req, res)
);

// Pair two solo sign-ups into one team (Admin-only, setup only). The two
// solo rows are removed and one team takes their place.
router.post('/admin/bracket/events/:id/pair', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Bracket night not found.');
    if (event.status !== 'setup') {
      return bad(res, 409, 'Solos can only be paired while the night is in setup.');
    }
    const soloIdA = asInt(req.body.soloIdA);
    const soloIdB = asInt(req.body.soloIdB);
    if (soloIdA == null || soloIdB == null) return bad(res, 400, 'Pick two solos to pair.');
    if (soloIdA === soloIdB) return bad(res, 400, 'Pick two different solos.');
    const { rows } = await pool.query(
      `SELECT s.id, s.person_id, p.name FROM br_solos s JOIN people p ON p.id = s.person_id
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
      await pool.query('DELETE FROM br_solos WHERE id IN ($1, $2)', [soloIdA, soloIdB]);
      const { rows: teamRows } = await pool.query(
        'INSERT INTO br_teams (event_id, player1, player2, person1_id, person2_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
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

// Build the bracket (Admin-only). Teams are seeded by combined doubles
// rating (sum of the two players' doubles ratings from their member
// records, highest first; a player with no rating on file counts as 0;
// ties go to the earlier signup), then the double-elimination bracket is
// generated and the night starts. Rebuilding is allowed while no score
// has been entered yet.
router.post('/admin/bracket/events/:id/build', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Bracket night not found.');
    if (event.status === 'completed') {
      return bad(res, 409, 'This night is finished.');
    }
    const teams = await getTeams(event.id);
    if (teams.length < 4) {
      return bad(res, 400, 'Add at least 4 teams before building the bracket.');
    }
    if (!BRACKET_SIZES.includes(teams.length)) {
      return bad(res, 400, `A bracket needs 4, 6, 8, 10, 12 or 16 teams — ${teams.length} signed up. Add or remove a team and try again.`);
    }
    if (teams.length > nightMaxTeams(event)) {
      return bad(res, 400, `At most ${nightMaxTeams(event)} teams per night.`);
    }
    const matches = await getMatches(event.id);
    if (matches.some((m) => m.score1 != null)) {
      return bad(res, 409, 'Scores have already been entered — the night can’t be rebuilt.');
    }
    const personIds = [...new Set(teams.flatMap((t) => [t.person1_id, t.person2_id]).filter((p) => p != null))];
    const ratingByPerson = new Map();
    if (personIds.length) {
      const { rows } = await pool.query(
        'SELECT person_id, dupr_rating FROM members WHERE person_id = ANY($1)',
        [personIds]
      );
      for (const r of rows) ratingByPerson.set(r.person_id, Number(r.dupr_rating) || 0);
    }
    const ratingOf = (pid) => (pid == null ? 0 : ratingByPerson.get(pid) || 0);
    const seeded = teams
      .map((t) => ({ ...t, ratingSum: ratingOf(t.person1_id) + ratingOf(t.person2_id) }))
      .sort((a, b) => b.ratingSum - a.ratingSum || a.id - b.id);
    const built = buildBracket(teams.length);
    await pool.query('BEGIN');
    try {
      await pool.query('DELETE FROM br_matches WHERE event_id = $1', [event.id]);
      for (let i = 0; i < seeded.length; i++) {
        await pool.query('UPDATE br_teams SET seed = $1 WHERE id = $2', [i + 1, seeded[i].id]);
      }
      // Insert in creation order. Every slot references an earlier match,
      // so resolve each winner/loser ref to its DB id as we go; seed refs
      // are seed numbers and go in as-is.
      const dbIdByKey = new Map();
      for (const m of built.matches) {
        const refOf = (slot) => (slot.type === 'seed' ? slot.ref : dbIdByKey.get(slot.ref));
        const { rows } = await pool.query(
          `INSERT INTO br_matches (event_id, bracket, round, game_no, slot1_type, slot1_ref, slot2_type, slot2_ref, target_score)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [event.id, m.bracket, m.round, m.gameNo, m.slot1.type, refOf(m.slot1), m.slot2.type, refOf(m.slot2), m.target]
        );
        dbIdByKey.set(m.key, rows[0].id);
      }
      await pool.query("UPDATE br_events SET status = 'playing' WHERE id = $1", [event.id]);
      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
    res.json({
      ok: true,
      matches: built.matches.length,
      games: 2 * teams.length - 2,
      wbRounds: built.wbRounds,
      lbRounds: built.lbRounds,
    });
  }, req, res)
);

// Finish the night (Admin-only). Asks "finish anyway?" if games are
// unscored — a reset game that is not needed does not count as unscored.
router.post('/admin/bracket/events/:id/finish', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Bracket night not found.');
    if (event.status === 'completed') {
      return bad(res, 409, 'This night is already finished.');
    }
    if (event.status !== 'playing') {
      return bad(res, 409, 'Build the night before finishing it.');
    }
    const [matches, teams] = await Promise.all([getMatches(event.id), getTeams(event.id)]);
    const seedToTeamId = new Map(
      teams.filter((t) => t.seed != null).map((t) => [t.seed, t.id])
    );
    const resolved = resolveBracket(matches.map(toLibMatch), seedToTeamId);
    const unscored = matches.filter((m) => m.score1 == null && resolved.get(m.id).active).length;
    if (unscored > 0 && !req.body.force) {
      return bad(res, 409, `${unscored} game(s) are still unscored.`);
    }
    await pool.query("UPDATE br_events SET status = 'completed' WHERE id = $1", [event.id]);
    res.json({ ok: true });
  }, req, res)
);

router.post('/admin/bracket/events/:id/reopen', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Bracket night not found.');
    if (event.status !== 'completed') {
      return bad(res, 409, 'Only a finished night can be reopened.');
    }
    await pool.query("UPDATE br_events SET status = 'playing' WHERE id = $1", [event.id]);
    res.json({ ok: true });
  }, req, res)
);

module.exports = router;
// The archive routes reuse the full detail payload (and the
// includeDeleted lookup) so an archived night renders exactly like the
// live night page, read-only.
module.exports.eventDetail = eventDetail;
module.exports.getEvent = getEvent;

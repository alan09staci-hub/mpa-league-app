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
} = require('../lib/roundrobin');

const router = express.Router();
const MAX_TEAMS = 24; // 48 players per night

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

function teamLabel(t) {
  return `${t.player1} & ${t.player2}`;
}

// Full event payload: event + teams + solos + matches + standings + payouts + byes.
async function eventDetail(event, req) {
  const [teams, matches, solos] = await Promise.all([
    getTeams(event.id),
    getMatches(event.id),
    getSolos(event.id),
  ]);
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
              (SELECT COUNT(*) FROM rr_matches m WHERE m.event_id = e.id) AS match_count,
              (SELECT COUNT(*) FROM rr_matches m WHERE m.event_id = e.id AND m.score1 IS NOT NULL) AS scored_count
         FROM rr_events e ORDER BY e.event_date DESC, e.id DESC`
    );
    res.json({ events: rows });
  }, req, res)
);

router.get('/round-robin/events/:id', (req, res) =>
  handle(async () => {
    const event = await getEvent(asInt(req.params.id));
    if (!event) return bad(res, 404, 'Round robin not found.');
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
    const { rows } = await pool.query(
      'SELECT * FROM rr_matches WHERE id = $1 AND event_id = $2',
      [req.params.mid, event.id]
    );
    const match = rows[0];
    if (!match) return bad(res, 404, 'Match not found.');
    let { score1, score2 } = req.body;
    const blank = score1 == null || score1 === '' || score2 == null || score2 === '';
    if (blank) {
      await pool.query('UPDATE rr_matches SET score1 = NULL, score2 = NULL WHERE id = $1', [match.id]);
      return res.json({ ok: true, cleared: true });
    }
    score1 = asInt(score1);
    score2 = asInt(score2);
    if (score1 == null || score2 == null || score1 < 0 || score2 < 0 || score1 > 30 || score2 > 30) {
      return bad(res, 400, 'Scores must be whole numbers from 0 to 30.');
    }
    const err = scoreError(score1, score2, match.target_score);
    if (err) return bad(res, 400, err);
    await pool.query('UPDATE rr_matches SET score1 = $1, score2 = $2 WHERE id = $3', [score1, score2, match.id]);
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
    if (joinNotOpen(event)) return bad(res, 409, 'Sign-ups are not open for this night.');
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
    if (teams.length >= MAX_TEAMS) {
      return bad(res, 400, `At most ${MAX_TEAMS} teams (${MAX_TEAMS * 2} players) per night.`);
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
    if (joinNotOpen(event)) return bad(res, 409, 'Sign-ups are not open for this night.');
    const personId = asInt(req.body.personId);
    if (personId == null) return bad(res, 400, 'Pick who you are.');
    const person = await getPerson(personId);
    if (!person) return bad(res, 404, 'Person not found.');
    if (await personOnNight(event.id, personId)) {
      return bad(res, 409, 'You are already on this night.');
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
    const kind = req.body.kind === 'money' ? 'money' : 'charity';
    const feeCents = kind === 'money' ? asInt(req.body.fee_cents) : 0;
    if (kind === 'money' && (feeCents == null || feeCents < 0 || feeCents > 100000)) {
      return bad(res, 400, 'Entry fee must be between $0 and $1,000 per person.');
    }
    const payout = payoutById(req.body.payout).id;
    const { rows } = await pool.query(
      `INSERT INTO rr_events (name, event_date, kind, fee_cents, payout)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, req.body.event_date, kind, feeCents || 0, payout]
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
    const payout = req.body.payout != null ? payoutById(req.body.payout).id : event.payout;
    const published = req.body.published != null ? Boolean(req.body.published) : event.published;
    const { rows } = await pool.query(
      `UPDATE rr_events SET name = $1, event_date = $2, kind = $3, fee_cents = $4, payout = $5, published = $6
       WHERE id = $7 RETURNING *`,
      [name, req.body.event_date || event.event_date, kind, feeCents || 0, payout, published, event.id]
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
    if (teams.length >= MAX_TEAMS) {
      return bad(res, 400, `At most ${MAX_TEAMS} teams (${MAX_TEAMS * 2} players) per night.`);
    }
    const player1 = String(req.body.player1 || '').trim();
    const player2 = String(req.body.player2 || '').trim();
    if (!player1 || !player2) return bad(res, 400, 'Enter both players’ names.');
    if (player1.length > 60 || player2.length > 60) return bad(res, 400, 'Names are too long.');
    if (player1.toLowerCase() === player2.toLowerCase()) {
      return bad(res, 400, 'The two players on a team must be different people.');
    }
    const { rows } = await pool.query(
      'INSERT INTO rr_teams (event_id, player1, player2) VALUES ($1, $2, $3) RETURNING *',
      [event.id, player1, player2]
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
    if (teams.length >= MAX_TEAMS) {
      return bad(res, 400, `At most ${MAX_TEAMS} teams (${MAX_TEAMS * 2} players) per night.`);
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
    const matches = await getMatches(event.id);
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

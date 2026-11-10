'use strict';
// API routes. Public: leagues, standings, game days, self opt-in/out,
// score entry (own court only). Admin (passcode, server-enforced):
// create league, roster management, walk-ins, build/rebuild, finish/reopen.
const express = require('express');
const { pool } = require('../db');
const auth = require('../lib/auth');
const {
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
  createLeagueWithSessions,
  normalizeLeague,
} = require('../lib/league');

const router = express.Router();

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

// ---------------------------------------------------------------- public

router.get('/health', (req, res) => res.json({ ok: true }));

router.get('/leagues', (req, res) =>
  handle(async () => {
    const { rows } = await pool.query(
      `SELECT l.*, COALESCE(pc.count, 0) AS player_count,
              ls.registration_open
         FROM leagues l
         LEFT JOIN (SELECT league_id, COUNT(*) AS count FROM player_leagues GROUP BY league_id) pc
           ON pc.league_id = l.id
         LEFT JOIN league_settings ls ON ls.league_id = l.id
        ORDER BY l.start_date ASC`
    );
    res.json({ leagues: rows.map(normalizeLeague) });
  }, req, res)
);

router.get('/leagues/:id', (req, res) =>
  handle(async () => {
    const league = await getLeague(pool, req.params.id);
    if (!league) return res.status(404).json({ error: 'League not found.' });
    const sessions = await getSessions(pool, league.id);
    const now = new Date();
    const { rows: settings } = await pool.query(
      'SELECT registration_open FROM league_settings WHERE league_id = $1',
      [league.id]
    );
    const current = sessions.find((s) => effectiveStatus(s, now) !== 'completed') || null;
    res.json({
      league: normalizeLeague(league),
      registrationOpen: settings[0] ? settings[0].registration_open : true,
      currentSessionId: current ? current.id : null,
      sessions: sessions.map((s) => ({
        id: s.id,
        session_number: s.session_number,
        date: s.date instanceof Date ? s.date.toISOString().slice(0, 10) : String(s.date).slice(0, 10),
        starts_at: s.starts_at,
        status: effectiveStatus(s, now),
        label: s.label,
        schedule_generated: Boolean(s.schedule_generated_at),
      })),
    });
  }, req, res)
);

router.get('/leagues/:id/standings', (req, res) =>
  handle(async () => {
    const data = await loadStandingsData(pool, req.params.id);
    if (!data) return res.status(404).json({ error: 'League not found.' });
    res.json({ league: data.league, standings: data.rows, currentSessionId: data.currentSession ? data.currentSession.id : null });
  }, req, res)
);

router.get('/leagues/:id/roster', (req, res) =>
  handle(async () => {
    const league = await getLeague(pool, req.params.id);
    if (!league) return res.status(404).json({ error: 'League not found.' });
    const roster = await getRoster(pool, league.id);
    res.json({ roster });
  }, req, res)
);

// Session detail. Auto-generates the schedule when the game day loads after
// the opt-in deadline (server-side, from opted-in players).
router.get('/leagues/:id/sessions/:sid', (req, res) =>
  handle(async () => {
    const league = await getLeague(pool, req.params.id);
    if (!league) return res.status(404).json({ error: 'League not found.' });
    const session = await getSession(pool, league.id, req.params.sid);
    if (!session) return res.status(404).json({ error: 'Game day not found.' });
    const sessions = await getSessions(pool, league.id);
    const idx = sessions.findIndex((s) => s.id === session.id);
    const prev = idx > 0 ? sessions[idx - 1] : null;
    const now = new Date();
    const win = optInWindow(session, prev, league);
    const revealed = now >= win.deadlineAt;
    const status = effectiveStatus(session, now);

    let warnings = [];
    // Auto-generate once, the first time the game day loads after the deadline.
    if (revealed && status !== 'completed' && !session.schedule_generated_at) {
      const attendees = await getAttendees(pool, session.id);
      if (attendees.length >= 4) {
        const gen = await generateForSession(pool, session);
        warnings = gen.warnings;
        const fresh = await getSession(pool, league.id, session.id);
        session.schedule_generated_at = fresh.schedule_generated_at;
      }
    }

    const data = await loadStandingsData(pool, league.id, now);
    const rankByPerson = new Map(data.rows.map((r) => [r.person_id, r.rank]));
    const roster = await getRoster(pool, league.id);
    const attendees = await getAttendees(pool, session.id);
    const optedIn = new Set(attendees.map((a) => a.person_id));
    const optedAt = new Map(attendees.map((a) => [a.person_id, a.opted_in_at]));
    const playing = roster
      .filter((p) => optedIn.has(p.person_id))
      .map((p) => ({
        person_id: p.person_id,
        name: p.name,
        dupr_rating: p.dupr_rating,
        rank: rankByPerson.get(p.person_id) ?? null,
        opted_in_at: optedAt.get(p.person_id),
      }))
      .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
    const notPlaying = roster
      .filter((p) => !optedIn.has(p.person_id))
      .map((p) => ({
        person_id: p.person_id,
        name: p.name,
        dupr_rating: p.dupr_rating,
        rank: rankByPerson.get(p.person_id) ?? null,
      }))
      .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));

    const isAdmin = auth.isAdmin(req);
    const viewerId = asInt(req.query.viewer);
    let matches = null;
    let groups = null;
    let myCourt = null;
    if (session.schedule_generated_at || revealed) {
      const all = await getMatches(pool, session.id);
      if (all.length) {
        if (isAdmin) {
          matches = all;
          groups = courtsFromMatches(all, roster);
        } else if (viewerId && optedIn.has(viewerId)) {
          myCourt = courtOfPerson(all, viewerId);
          if (myCourt && revealed) {
            matches = all.filter((m) => m.court === myCourt);
            groups = courtsFromMatches(matches, roster).filter((g) => g.court === myCourt);
          }
        }
      }
    }
    if (!revealed && !isAdmin) {
      matches = null;
      groups = null;
    }

    res.json({
      league: normalizeLeague(league),
      session: {
        id: session.id,
        session_number: session.session_number,
        date: session.date instanceof Date ? session.date.toISOString().slice(0, 10) : String(session.date).slice(0, 10),
        starts_at: session.starts_at,
        status,
        label: session.label,
        schedule_generated: Boolean(session.schedule_generated_at),
      },
      window: {
        opensAt: win.opensAt,
        deadlineAt: win.deadlineAt,
        isOpen: now >= win.opensAt && now <= win.deadlineAt,
        isRevealed: revealed,
      },
      counts: { playing: playing.length, notPlaying: notPlaying.length, total: roster.length },
      playing,
      notPlaying,
      matches,
      groups,
      myCourt,
      warnings,
      isAdmin,
    });
  }, req, res)
);

function courtOfPerson(matches, personId) {
  for (const m of matches) {
    if (m.kind === 'bye' && m.bye_person_id === personId) return m.court;
    if ([m.team1_p1, m.team1_p2, m.team2_p1, m.team2_p2].includes(personId)) return m.court;
  }
  return null;
}

function courtsFromMatches(matches, roster) {
  const names = new Map(roster.map((p) => [p.person_id, p.name]));
  const byCourt = new Map();
  for (const m of matches) {
    if (!byCourt.has(m.court)) byCourt.set(m.court, { court: m.court, players: [] });
    const g = byCourt.get(m.court);
    const ids = m.kind === 'bye'
      ? [m.bye_person_id]
      : [m.team1_p1, m.team1_p2, m.team2_p1, m.team2_p2];
    for (const id of ids) {
      if (id && !g.players.some((p) => p.person_id === id)) {
        g.players.push({ person_id: id, name: names.get(id) || '?' });
      }
    }
  }
  return [...byCourt.values()].sort((a, b) => a.court - b.court);
}

// Self opt-in. Only the player themself, only while the window is open.
router.post('/leagues/:id/sessions/:sid/opt-in', (req, res) =>
  handle(async () => {
    const personId = asInt(req.body.personId);
    if (!personId) return res.status(400).json({ error: 'personId is required.' });
    const league = await getLeague(pool, req.params.id);
    if (!league) return res.status(404).json({ error: 'League not found.' });
    const session = await getSession(pool, league.id, req.params.sid);
    if (!session) return res.status(404).json({ error: 'Game day not found.' });
    const onRoster = await pool.query(
      'SELECT 1 FROM player_leagues WHERE league_id = $1 AND person_id = $2',
      [league.id, personId]
    );
    if (!onRoster.rows.length) {
      return res.status(403).json({ error: 'You are not on this league roster.' });
    }
    const sessions = await getSessions(pool, league.id);
    const idx = sessions.findIndex((s) => s.id === session.id);
    const win = optInWindow(session, idx > 0 ? sessions[idx - 1] : null, league);
    const now = new Date();
    if (now < win.opensAt) {
      return res.status(409).json({ error: 'Opt-in has not opened yet.', opensAt: win.opensAt });
    }
    if (now > win.deadlineAt) {
      return res.status(409).json({ error: 'Opt-in has closed. Ask the organizer to add you as a walk-in.' });
    }
    await pool.query(
      `INSERT INTO session_players (session_id, person_id, opted_in, opted_in_at, checked_in)
       VALUES ($1,$2,TRUE,now(),TRUE)
       ON CONFLICT (session_id, person_id)
       DO UPDATE SET opted_in = TRUE, opted_in_at = now(), checked_in = TRUE`,
      [session.id, personId]
    );
    res.json({ ok: true });
  }, req, res)
);

// Self opt-out (until game time). If a schedule exists it re-splits in place.
router.post('/leagues/:id/sessions/:sid/opt-out', (req, res) =>
  handle(async () => {
    const personId = asInt(req.body.personId);
    if (!personId) return res.status(400).json({ error: 'personId is required.' });
    const league = await getLeague(pool, req.params.id);
    if (!league) return res.status(404).json({ error: 'League not found.' });
    const session = await getSession(pool, league.id, req.params.sid);
    if (!session) return res.status(404).json({ error: 'Game day not found.' });
    if (new Date() >= new Date(session.starts_at)) {
      return res.status(409).json({ error: 'The game has started — ask the organizer to remove you.' });
    }
    await pool.query(
      'DELETE FROM session_players WHERE session_id = $1 AND person_id = $2',
      [session.id, personId]
    );
    await rebuildInPlace(pool, session);
    res.json({ ok: true });
  }, req, res)
);

// Score entry. A player may only score their own court's games; an
// organizer (admin token) may score any court. Blank scores clear a score.
router.post('/leagues/:id/sessions/:sid/matches/:mid/score', (req, res) =>
  handle(async () => {
    const league = await getLeague(pool, req.params.id);
    if (!league) return res.status(404).json({ error: 'League not found.' });
    const session = await getSession(pool, league.id, req.params.sid);
    if (!session) return res.status(404).json({ error: 'Game day not found.' });
    const { rows } = await pool.query(
      'SELECT * FROM matches WHERE id = $1 AND session_id = $2',
      [req.params.mid, session.id]
    );
    const match = rows[0];
    if (!match) return res.status(404).json({ error: 'Match not found.' });
    if (match.kind !== 'match') return res.status(400).json({ error: 'That row is a bye, not a game.' });
    if (effectiveStatus(session) === 'completed') {
      return res.status(409).json({ error: 'This game day is finished. Reopen it from Admin to change a score.' });
    }
    const sessions = await getSessions(pool, league.id);
    const idx = sessions.findIndex((s) => s.id === session.id);
    const win = optInWindow(session, idx > 0 ? sessions[idx - 1] : null, league);
    if (new Date() < win.deadlineAt) {
      return res.status(409).json({ error: 'Scores open once the game day starts.' });
    }
    const isAdmin = auth.isAdmin(req);
    const personId = asInt(req.body.personId);
    if (!isAdmin) {
      if (!personId) return res.status(400).json({ error: 'personId is required.' });
      const all = await getMatches(pool, session.id);
      const myCourt = courtOfPerson(all, personId);
      if (!myCourt || myCourt !== match.court) {
        return res.status(403).json({ error: 'You can only enter scores for your own court.' });
      }
      const opted = await pool.query(
        'SELECT 1 FROM session_players WHERE session_id = $1 AND person_id = $2 AND opted_in = TRUE',
        [session.id, personId]
      );
      if (!opted.rows.length) {
        return res.status(403).json({ error: 'You are not opted in for this game day.' });
      }
    }

    let { score1, score2 } = req.body;
    const blank = score1 == null || score1 === '' || score2 == null || score2 === '';
    if (blank) {
      await pool.query('UPDATE matches SET score1 = NULL, score2 = NULL WHERE id = $1', [match.id]);
      return res.json({ ok: true, cleared: true });
    }
    score1 = asInt(score1);
    score2 = asInt(score2);
    if (score1 == null || score2 == null || score1 < 0 || score2 < 0 || score1 > 30 || score2 > 30) {
      return res.status(400).json({ error: 'Scores must be whole numbers from 0 to 30.' });
    }
    if (Math.max(score1, score2) !== match.target_score) {
      return res.status(400).json({ error: `One side must reach ${match.target_score} (games to ${match.target_score}).` });
    }
    await pool.query('UPDATE matches SET score1 = $1, score2 = $2 WHERE id = $3', [score1, score2, match.id]);
    res.json({ ok: true, score1, score2 });
  }, req, res)
);

// ---------------------------------------------------------------- admin auth

router.post('/admin/login', (req, res) =>
  handle(async () => {
    if (!auth.passcodeConfigured()) {
      return res.status(503).json({ error: 'Admin passcode is not configured on this server.' });
    }
    if (!auth.checkPasscode(req.body.passcode)) {
      return res.status(401).json({ error: 'Wrong passcode.' });
    }
    const token = auth.issueToken();
    res.setHeader(
      'Set-Cookie',
      `mpa_admin=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${12 * 3600}`
    );
    res.json({ ok: true });
  }, req, res)
);

router.post('/admin/logout', (req, res) => {
  auth.revokeToken(auth.tokenFromReq(req));
  res.setHeader('Set-Cookie', 'mpa_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

router.get('/admin/me', (req, res) => {
  res.json({ admin: auth.isAdmin(req), passcodeConfigured: auth.passcodeConfigured() });
});

// ---------------------------------------------------------------- admin

router.post('/admin/leagues', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const league = await createLeagueWithSessions(pool, req.body);
    res.status(201).json({ league: normalizeLeague(league) });
  }, req, res)
);

router.post('/admin/leagues/:id/players', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const league = await getLeague(pool, req.params.id);
    if (!league) return res.status(404).json({ error: 'League not found.' });
    let person;
    if (req.body.personId) {
      const { rows } = await pool.query('SELECT * FROM people WHERE id = $1', [req.body.personId]);
      person = rows[0];
      if (!person) return res.status(404).json({ error: 'Person not found.' });
    } else {
      person = await findOrCreatePerson(pool, {
        name: req.body.name,
        duprId: req.body.duprId,
        duprRating: req.body.duprRating,
        duprProfileUrl: req.body.duprProfileUrl,
      });
    }
    const { rows } = await pool.query(
      `INSERT INTO player_leagues (person_id, league_id, joined_at)
       VALUES ($1,$2, COALESCE($3, now())) ON CONFLICT (person_id, league_id) DO NOTHING RETURNING *`,
      [person.id, league.id, req.body.joinedAt || null]
    );
    if (!rows.length) return res.status(409).json({ error: 'That person is already in this league.' });
    res.status(201).json({ person });
  }, req, res)
);

router.patch('/admin/leagues/:id/players/:personId', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const league = await getLeague(pool, req.params.id);
    if (!league) return res.status(404).json({ error: 'League not found.' });
    const personId = asInt(req.params.personId);
    if (req.body.duprId !== undefined || req.body.duprRating !== undefined || req.body.duprProfileUrl !== undefined) {
      await pool.query(
        `UPDATE people SET
           dupr_id = COALESCE($2, dupr_id),
           dupr_rating = COALESCE($3, dupr_rating),
           dupr_profile_url = COALESCE($4, dupr_profile_url),
           updated_at = now()
         WHERE id = $1`,
        [personId, req.body.duprId ?? null, req.body.duprRating ?? null, req.body.duprProfileUrl ?? null]
      );
    }
    if (req.body.adminPenalty !== undefined) {
      await pool.query(
        'UPDATE player_leagues SET admin_penalty = $1 WHERE league_id = $2 AND person_id = $3',
        [req.body.adminPenalty, league.id, personId]
      );
    }
    if (req.body.feeWaived !== undefined) {
      await pool.query(
        'UPDATE player_leagues SET fee_waived = $1 WHERE league_id = $2 AND person_id = $3',
        [Boolean(req.body.feeWaived), league.id, personId]
      );
    }
    res.json({ ok: true });
  }, req, res)
);

// Remove a person from this league only.
router.delete('/admin/leagues/:id/players/:personId', auth.requireAdmin, (req, res) =>
  handle(async () => {
    await pool.query(
      'DELETE FROM player_leagues WHERE league_id = $1 AND person_id = $2',
      [req.params.id, req.params.personId]
    );
    res.json({ ok: true });
  }, req, res)
);

// Admin opt-in (walk-in) — any time; courts refresh in place if built.
router.post('/admin/leagues/:id/sessions/:sid/opt-in', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const personId = asInt(req.body.personId);
    if (!personId) return res.status(400).json({ error: 'personId is required.' });
    const league = await getLeague(pool, req.params.id);
    if (!league) return res.status(404).json({ error: 'League not found.' });
    const session = await getSession(pool, league.id, req.params.sid);
    if (!session) return res.status(404).json({ error: 'Game day not found.' });
    const onRoster = await pool.query(
      'SELECT 1 FROM player_leagues WHERE league_id = $1 AND person_id = $2',
      [league.id, personId]
    );
    if (!onRoster.rows.length) {
      return res.status(403).json({ error: 'That person is not on this league roster.' });
    }
    await pool.query(
      `INSERT INTO session_players (session_id, person_id, opted_in, opted_in_at, checked_in)
       VALUES ($1,$2,TRUE,now(),TRUE)
       ON CONFLICT (session_id, person_id)
       DO UPDATE SET opted_in = TRUE, opted_in_at = now(), checked_in = TRUE`,
      [session.id, personId]
    );
    await rebuildInPlace(pool, session);
    res.json({ ok: true });
  }, req, res)
);

// Admin opt-out (no-show removal) — any time; courts refresh in place.
router.post('/admin/leagues/:id/sessions/:sid/opt-out', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const personId = asInt(req.body.personId);
    if (!personId) return res.status(400).json({ error: 'personId is required.' });
    const league = await getLeague(pool, req.params.id);
    if (!league) return res.status(404).json({ error: 'League not found.' });
    const session = await getSession(pool, league.id, req.params.sid);
    if (!session) return res.status(404).json({ error: 'Game day not found.' });
    await pool.query(
      'DELETE FROM session_players WHERE session_id = $1 AND person_id = $2',
      [session.id, personId]
    );
    await rebuildInPlace(pool, session);
    res.json({ ok: true });
  }, req, res)
);

// Manual build / rebuild (Admin-only).
router.post('/admin/leagues/:id/sessions/:sid/build', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const league = await getLeague(pool, req.params.id);
    if (!league) return res.status(404).json({ error: 'League not found.' });
    const session = await getSession(pool, league.id, req.params.sid);
    if (!session) return res.status(404).json({ error: 'Game day not found.' });
    if (effectiveStatus(session) === 'completed') {
      return res.status(409).json({ error: 'This game day is finished.' });
    }
    const gen = await generateForSession(pool, session, { preserveScores: true });
    res.json({ ok: true, ...gen });
  }, req, res)
);

// Finish a game day (Admin-only). Asks "finish anyway?" if games are unscored.
router.post('/admin/leagues/:id/sessions/:sid/finish', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const league = await getLeague(pool, req.params.id);
    if (!league) return res.status(404).json({ error: 'League not found.' });
    const session = await getSession(pool, league.id, req.params.sid);
    if (!session) return res.status(404).json({ error: 'Game day not found.' });
    if (session.status === 'completed') {
      return res.status(409).json({ error: 'This game day is already finished.' });
    }
    const matches = await getMatches(pool, session.id);
    const unscored = matches.filter((m) => m.kind === 'match' && m.score1 == null).length;
    if (unscored > 0 && !req.body.force) {
      return res.status(409).json({ error: `${unscored} game(s) are still unscored.`, unscored });
    }
    await pool.query("UPDATE sessions SET status = 'completed' WHERE id = $1", [session.id]);
    // Snapshot ranks (standings as of this completed night).
    const data = await loadStandingsData(pool, league.id);
    for (const r of data.rows) {
      await pool.query(
        `INSERT INTO rank_snapshots (league_id, session_id, person_id, rank, ep_diff)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (league_id, session_id, person_id)
         DO UPDATE SET rank = EXCLUDED.rank, ep_diff = EXCLUDED.ep_diff`,
        [league.id, session.id, r.person_id, r.rank, r.epDiff]
      );
    }
    res.json({ ok: true, standings: data.rows });
  }, req, res)
);

// Reopen a finished game day. Removes its rank snapshot; matches stay so a
// score can be corrected and the night finished again.
router.post('/admin/leagues/:id/sessions/:sid/reopen', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const league = await getLeague(pool, req.params.id);
    if (!league) return res.status(404).json({ error: 'League not found.' });
    const session = await getSession(pool, league.id, req.params.sid);
    if (!session) return res.status(404).json({ error: 'Game day not found.' });
    await pool.query("UPDATE sessions SET status = 'upcoming' WHERE id = $1", [session.id]);
    await pool.query('DELETE FROM rank_snapshots WHERE session_id = $1', [session.id]);
    res.json({ ok: true });
  }, req, res)
);

// Registration open/closed switch (Admin-only).
router.post('/admin/leagues/:id/settings', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const league = await getLeague(pool, req.params.id);
    if (!league) return res.status(404).json({ error: 'League not found.' });
    if (req.body.registrationOpen !== undefined) {
      await pool.query(
        `INSERT INTO league_settings (league_id, registration_open) VALUES ($1,$2)
         ON CONFLICT (league_id) DO UPDATE SET registration_open = EXCLUDED.registration_open`,
        [league.id, Boolean(req.body.registrationOpen)]
      );
    }
    res.json({ ok: true });
  }, req, res)
);

module.exports = router;

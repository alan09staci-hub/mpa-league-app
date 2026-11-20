'use strict';
// Phase 2 routes: Members directory + Become a Member, join flow +
// registrations, My Dashboard / My Profile, multi-league lookups,
// Admin members/registrations/announce, per-league logo color.
// Email/phone are Admin-only: public endpoints never return them.
const express = require('express');
const { pool } = require('../db');
const auth = require('../lib/auth');
const {
  getLeague,
  getSessions,
  loadStandingsData,
  findOrCreatePerson,
  normalizeLeague,
  dateOnly,
  skillRangeError,
} = require('../lib/league');
const { zonedToUtc } = require('../lib/time');

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

function err(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function cleanStr(v, max = 200) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function cleanRating(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 9) return null;
  return n;
}

// A DUPR ID is exactly 6 letters and numbers (e.g. 7D6WR0). Blank is fine —
// self-rated members have no DUPR ID yet. Normalizes to uppercase so
// "pw5jnx" is stored as "PW5JNX".
function cleanDuprId(v) {
  if (v == null) return null;
  const s = String(v).trim().toUpperCase();
  return s || null;
}

// Returns an error message when a supplied DUPR ID doesn't match the
// 6-letters-and-numbers shape, else null. Blank is never an error.
function duprIdError(v, selfRateHint = true) {
  if (!v) return null;
  if (/^[A-Z0-9]{6}$/.test(v)) return null;
  return selfRateHint
    ? 'That doesn\'t look like a DUPR ID — it\'s 6 letters and numbers. If you don\'t have one yet, choose \'I\'ll rate myself\' instead.'
    : 'That doesn\'t look like a DUPR ID — it\'s 6 letters and numbers.';
}

// Leagues a person is on the roster of (names only).
async function leaguesOfPerson(client, personId) {
  const { rows } = await client.query(
    `SELECT l.id, l.name, l.type, l.skill, l.format, l.day, l.time,
            l.season, l.logo_color, l.start_date, l.stop_date
       FROM player_leagues pl JOIN leagues l ON l.id = pl.league_id
      WHERE pl.person_id = $1 ORDER BY l.start_date ASC`,
    [personId]
  );
  return rows.map(normalizeLeague);
}

// ---------------------------------------------------------------- members (public)

// Public directory: NO email/phone, ever.
router.get('/members', (req, res) =>
  handle(async () => {
    const { rows } = await pool.query(
      `SELECT m.id, m.person_id, m.name, m.dupr_id, m.dupr_rating,
              m.dupr_profile_url, m.photo_url, m.resides, m.age, m.country,
              m.nickname, m.gender, m.height, m.handed,
              m.singles_rating, m.skinny_rating, m.self_rated,
              m.joined_at,
              COALESCE((SELECT json_agg(l.name)
                          FROM player_leagues pl JOIN leagues l ON l.id = pl.league_id
                         WHERE pl.person_id = m.person_id), '[]'::json) AS leagues,
              EXISTS (SELECT 1 FROM player_leagues pl WHERE pl.person_id = m.person_id) AS is_player
         FROM members m ORDER BY m.name ASC`
    );
    res.json({ members: rows });
  }, req, res)
);

// Public name search (cover "I'm already a member" find-my-name).
router.get('/members/search', (req, res) =>
  handle(async () => {
    const q = cleanStr(req.query.q, 100);
    if (!q) return res.json({ members: [] });
    const { rows } = await pool.query(
      `SELECT m.id, m.person_id, m.name, m.dupr_id, m.dupr_rating,
              m.dupr_profile_url, m.photo_url, m.resides, m.age, m.country,
              m.nickname, m.gender, m.height, m.handed,
              m.singles_rating, m.skinny_rating, m.self_rated
         FROM members m WHERE lower(m.name) LIKE '%' || lower($1) || '%'
        ORDER BY m.name ASC LIMIT 20`,
      [q]
    );
    res.json({ members: rows });
  }, req, res)
);

// Become a free MPA member. A DUPR account is the standard way in;
// a self-rating (2.5–5.0, no DUPR account yet) is the fallback.
// Duplicate names are rejected; an existing person record is linked, not
// duplicated. Returns the public member (no email/phone).
// Look a member up by DUPR ID — the join page's member check. Returns
// public fields only (no email/phone): a match means they're already an
// MPA member, so the join form welcomes them back instead of repeating
// the new-member steps. 404 means not a member yet.
router.get('/members/by-dupr/:duprId', (req, res) =>
  handle(async () => {
    const duprId = cleanStr(req.params.duprId, 50);
    if (!duprId) throw err(400, 'A DUPR ID is required.');
    const { rows } = await pool.query(
      `SELECT id, person_id, name, dupr_id, dupr_rating, photo_url, resides, age, country, self_rated
         FROM members WHERE lower(dupr_id) = lower($1) LIMIT 1`,
      [duprId]
    );
    const m = rows[0];
    if (!m) throw err(404, 'No member with that DUPR ID.');
    res.json({
      member: {
        id: m.id, person_id: m.person_id, name: m.name, dupr_id: m.dupr_id,
        dupr_rating: m.dupr_rating == null ? null : Number(m.dupr_rating),
        self_rated: Boolean(m.self_rated),
        photo_url: m.photo_url, resides: m.resides, age: m.age, country: m.country,
      },
    });
  }, req, res)
);

router.post('/members', (req, res) =>
  handle(async () => {
    const name = cleanStr(req.body.name);
    const email = cleanStr(req.body.email);
    const phone = cleanStr(req.body.phone);
    const duprId = cleanDuprId(req.body.duprId);
    const duprRating = cleanRating(req.body.duprRating);
    const duprProfileUrl = cleanStr(req.body.duprProfileUrl, 500);
    const photoUrl = cleanStr(req.body.photoUrl, 500);
    const resides = cleanStr(req.body.resides);
    const age = asInt(req.body.age);
    const country = cleanStr(req.body.country);
    const nickname = cleanStr(req.body.nickname, 100);
    const gender = cleanStr(req.body.gender, 20);
    const height = cleanStr(req.body.height, 20);
    const handed = cleanStr(req.body.handed, 20);
    const singlesRating = cleanRating(req.body.singlesRating);
    const skinnyRating = cleanRating(req.body.skinnyRating);
    // Self-rating fallback: no DUPR account yet, so the member rates
    // themself from the 2.5–5.0 picker. DUPR stays the standard path.
    const selfRated = req.body.selfRated === true;
    const selfRating = cleanRating(req.body.selfRating);
    if (!name) throw err(400, 'Name is required.');
    if (!email || !email.includes('@')) throw err(400, 'A valid email is required.');
    if (!phone) throw err(400, 'A phone number is required.');
    const idErr = duprIdError(duprId);
    if (idErr) throw err(400, idErr);
    const rating = selfRated ? selfRating : duprRating;
    if (selfRated) {
      if (rating == null || rating < 2.5 || rating > 5.0) throw err(400, 'Pick your self-rating (2.5 to 5.0).');
    } else {
      if (!duprId) throw err(400, 'A DUPR ID is required, or rate yourself if you do not have a DUPR account yet.');
      if (rating == null) throw err(400, 'A DUPR doubles rating is required.');
    }
    if (duprProfileUrl && !/^https:\/\//i.test(duprProfileUrl)) {
      throw err(400, 'The DUPR profile link must start with https://');
    }

    const dup = await pool.query('SELECT id FROM members WHERE lower(name) = lower($1)', [name]);
    if (dup.rows.length) throw err(409, 'That name is already a member.');

    // Link to an existing person record (e.g. a roster player) or create one.
    const person = await findOrCreatePerson(pool, {
      name,
      duprId: selfRated ? null : duprId,
      duprRating: rating,
      duprProfileUrl,
    });
    await pool.query(
      `UPDATE people SET photo_url = COALESCE(photo_url, $2), resides = COALESCE(resides, $3),
         age = COALESCE(age, $4), country = COALESCE(country, $5), updated_at = now()
       WHERE id = $1`,
      [person.id, photoUrl, resides, age, country]
    );
    const { rows } = await pool.query(
      `INSERT INTO members (person_id, name, email, phone, dupr_id, dupr_rating,
                            dupr_profile_url, photo_url, resides, age, country,
                            nickname, gender, height, handed, singles_rating, skinny_rating, self_rated)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [person.id, name, email, phone, selfRated ? null : duprId, rating, duprProfileUrl, photoUrl, resides, age, country,
       nickname, gender, height, handed, singlesRating, skinnyRating, selfRated]
    );
    const m = rows[0];
    res.status(201).json({
      member: {
        id: m.id, person_id: m.person_id, name: m.name, dupr_id: m.dupr_id,
        dupr_rating: Number(m.dupr_rating), dupr_profile_url: m.dupr_profile_url,
        self_rated: Boolean(m.self_rated),
        photo_url: m.photo_url, resides: m.resides, age: m.age, country: m.country,
        nickname: m.nickname, gender: m.gender, height: m.height, handed: m.handed,
        singles_rating: m.singles_rating == null ? null : Number(m.singles_rating),
        skinny_rating: m.skinny_rating == null ? null : Number(m.skinny_rating),
        joined_at: m.joined_at,
      },
    });
  }, req, res)
);

// ---------------------------------------------------------------- join flow + registrations (public submit)

// Submit a league registration (DUPR step, then details). Saves a pending
// registration for Admin. No payment verification, no payment gate.
router.post('/leagues/:id/registrations', (req, res) =>
  handle(async () => {
    const league = await getLeague(pool, req.params.id);
    if (!league) throw err(404, 'League not found.');
    const { rows: settings } = await pool.query(
      'SELECT registration_open FROM league_settings WHERE league_id = $1',
      [league.id]
    );
    const open = settings[0] ? settings[0].registration_open : true;
    if (!open) throw err(409, 'Registration for this league is closed.');

    const name = cleanStr(req.body.name);
    const duprId = cleanDuprId(req.body.duprId);
    const duprRating = cleanRating(req.body.duprRating);
    const membershipType = req.body.membershipType === 'non-member' ? 'non-member' : 'member';
    const email = cleanStr(req.body.email);
    const phone = cleanStr(req.body.phone);
    // Self-rating fallback: no DUPR account yet, so the player rates
    // themself from the 2.5–5.0 picker. DUPR stays the standard path.
    const selfRated = req.body.selfRated === true;
    const selfRating = cleanRating(req.body.selfRating);
    if (!name) throw err(400, 'Name is required.');
    const idErr = duprIdError(duprId);
    if (idErr) throw err(400, idErr);
    const rating = selfRated ? selfRating : duprRating;
    if (selfRated) {
      if (rating == null || rating < 2.5 || rating > 5.0) throw err(400, 'Pick your self-rating (2.5 to 5.0).');
    } else {
      if (!duprId) throw err(400, 'A DUPR ID is required, or rate yourself if you do not have a DUPR account yet.');
      if (rating == null) throw err(400, 'A DUPR doubles rating is required.');
    }
    if (!email || !email.includes('@')) throw err(400, 'A valid email is required.');
    if (!phone) throw err(400, 'A phone number is required.');

    // The league's skill band is the qualifier: a rating outside it cannot
    // join this league (the join page shows the same check up front).
    const skillErr = skillRangeError(league.skill, rating, selfRated ? 'rating' : 'DUPR rating');
    if (skillErr) throw err(400, skillErr);

    const existing = await pool.query(
      `SELECT id FROM registrations
        WHERE league_id = $1 AND lower(name) = lower($2)
          AND status IN ('pending','confirmed')`,
      [league.id, name]
    );
    if (existing.rows.length) throw err(409, 'That name already has a pending sign-up for this league.');

    const person = await pool.query('SELECT id FROM people WHERE lower(name) = lower($1)', [name]);
    const { rows } = await pool.query(
      `INSERT INTO registrations (person_id, name, league_id, dupr_id, dupr_rating,
                                  membership_type, email, phone, self_rated)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [person.rows[0] ? person.rows[0].id : null, name, league.id, selfRated ? null : duprId, rating, membershipType, email, phone, selfRated]
    );
    res.status(201).json({ registration: rows[0] });
  }, req, res)
);

// ---------------------------------------------------------------- people (public, device identity)

// Public name search across roster people (find-your-league / identify
// yourself). Returns public fields only — no email/phone exist on people.
router.get('/people/search', (req, res) =>
  handle(async () => {
    const q = cleanStr(req.query.q, 100);
    if (!q) return res.json({ people: [] });
    const { rows } = await pool.query(
      `SELECT DISTINCT p.id, p.name, p.dupr_id, p.dupr_rating, p.dupr_profile_url
         FROM people p
        WHERE lower(p.name) LIKE '%' || lower($1) || '%'
        ORDER BY p.name ASC LIMIT 20`,
      [q]
    );
    res.json({ people: rows });
  }, req, res)
);

// Leagues a person is on the roster of — drives the "Your league" landing
// page and league visibility scoping.
router.get('/people/:id/leagues', (req, res) =>
  handle(async () => {
    const personId = asInt(req.params.id);
    if (!personId) throw err(400, 'personId is required.');
    const { rows: person } = await pool.query('SELECT id, name FROM people WHERE id = $1', [personId]);
    if (!person.length) return res.status(404).json({ error: 'Person not found.' });
    const leagues = await leaguesOfPerson(pool, personId);
    // Also surface leagues they have a live (pending/confirmed) registration for.
    const { rows: regs } = await pool.query(
      `SELECT r.league_id, l.name, r.status
         FROM registrations r JOIN leagues l ON l.id = r.league_id
        WHERE r.person_id = $1 AND r.status IN ('pending','confirmed')`,
      [personId]
    );
    res.json({ person: person[0], leagues, registrations: regs });
  }, req, res)
);

// My Dashboard: per league, the player's standings row + every game they
// played (partner, opponents, score, result).
router.get('/people/:id/dashboard', (req, res) =>
  handle(async () => {
    const personId = asInt(req.params.id);
    if (!personId) throw err(400, 'personId is required.');
    const { rows: person } = await pool.query('SELECT id, name FROM people WHERE id = $1', [personId]);
    if (!person.length) return res.status(404).json({ error: 'Person not found.' });
    const leagues = await leaguesOfPerson(pool, personId);
    const { rows: peopleRows } = await pool.query('SELECT id, name FROM people');
    const names = new Map(peopleRows.map((p) => [p.id, p.name]));

    const out = [];
    for (const league of leagues) {
      const data = await loadStandingsData(pool, league.id);
      const row = data.rows.find((r) => r.person_id === personId) || null;
      const games = [];
      for (const s of data.included) {
        for (const m of s.matches) {
          if (m.kind !== 'match' || m.score1 == null || m.score2 == null) continue;
          const onT1 = m.team1_p1 === personId || m.team1_p2 === personId;
          const onT2 = m.team2_p1 === personId || m.team2_p2 === personId;
          if (!onT1 && !onT2) continue;
          const mine = onT1 ? m.score1 : m.score2;
          const theirs = onT1 ? m.score2 : m.score1;
          const partnerId = onT1
            ? (m.team1_p1 === personId ? m.team1_p2 : m.team1_p1)
            : (m.team2_p1 === personId ? m.team2_p2 : m.team2_p1);
          const opponents = onT1 ? [m.team2_p1, m.team2_p2] : [m.team1_p1, m.team1_p2];
          games.push({
            sessionId: s.id,
            sessionNumber: s.session_number,
            date: s.date,
            court: m.court,
            round: m.round,
            partner: partnerId ? names.get(partnerId) || '—' : null,
            opponents: opponents.map((o) => names.get(o) || '—'),
            score1: m.score1,
            score2: m.score2,
            myScore: mine,
            theirScore: theirs,
            result: mine > theirs ? 'W' : 'L',
            target: m.target_score,
          });
        }
      }
      games.sort((a, b) => (a.date < b.date ? -1 : 1) || a.sessionNumber - b.sessionNumber || a.round - b.round);
      out.push({
        league,
        standings: row ? {
          rank: row.rank, epDiff: row.epDiff, penalty: row.penalty, score: row.score,
          earned: row.earned, against: row.against, possible: row.possible,
          wins: row.wins, losses: row.losses, played: row.played, missed: row.missed,
          previous: row.previous, maxMvmt: row.maxMvmt,
        } : null,
        games,
      });
    }
    res.json({ person: person[0], leagues: out });
  }, req, res)
);

// My Profile: merged member record + person DUPR. Name is NOT editable.
router.get('/people/:id/profile', (req, res) =>
  handle(async () => {
    const personId = asInt(req.params.id);
    if (!personId) throw err(400, 'personId is required.');
    const { rows: person } = await pool.query('SELECT * FROM people WHERE id = $1', [personId]);
    if (!person.length) return res.status(404).json({ error: 'Person not found.' });
    const { rows: member } = await pool.query('SELECT * FROM members WHERE person_id = $1', [personId]);
    const m = member[0] || null;
    const p = person[0];
    res.json({
      person: {
        id: p.id, name: p.name, dupr_id: p.dupr_id,
        dupr_rating: p.dupr_rating == null ? null : Number(p.dupr_rating),
        dupr_profile_url: p.dupr_profile_url, photo_url: p.photo_url,
        resides: p.resides, age: p.age, country: p.country,
      },
      member: m ? {
        id: m.id, email: m.email, phone: m.phone, dupr_id: m.dupr_id,
        dupr_rating: m.dupr_rating == null ? null : Number(m.dupr_rating),
        self_rated: Boolean(m.self_rated),
        dupr_profile_url: m.dupr_profile_url, photo_url: m.photo_url,
        resides: m.resides, age: m.age, country: m.country, joined_at: m.joined_at,
        nickname: m.nickname, gender: m.gender, height: m.height, handed: m.handed,
        singles_rating: m.singles_rating == null ? null : Number(m.singles_rating),
        skinny_rating: m.skinny_rating == null ? null : Number(m.skinny_rating),
      } : null,
      leagues: await leaguesOfPerson(pool, personId),
    });
  }, req, res)
);

// Update my own member record. The name is never editable (it keys rosters
// and registrations). A roster player without a member record gets one
// created on save.
router.patch('/people/:id/profile', (req, res) =>
  handle(async () => {
    const personId = asInt(req.params.id);
    if (!personId) throw err(400, 'personId is required.');
    const { rows: person } = await pool.query('SELECT * FROM people WHERE id = $1', [personId]);
    if (!person.length) return res.status(404).json({ error: 'Person not found.' });
    const p = person[0];
    const email = cleanStr(req.body.email);
    const phone = cleanStr(req.body.phone);
    const duprId = cleanDuprId(req.body.duprId);
    const duprRating = cleanRating(req.body.duprRating);
    const duprProfileUrl = cleanStr(req.body.duprProfileUrl, 500);
    const photoUrl = cleanStr(req.body.photoUrl, 500);
    const resides = cleanStr(req.body.resides);
    const age = req.body.age === '' || req.body.age == null ? null : asInt(req.body.age);
    const country = cleanStr(req.body.country);
    const nickname = cleanStr(req.body.nickname, 100);
    const gender = cleanStr(req.body.gender, 20);
    const height = cleanStr(req.body.height, 20);
    const handed = cleanStr(req.body.handed, 20);
    const singlesRating = cleanRating(req.body.singlesRating);
    const skinnyRating = cleanRating(req.body.skinnyRating);
    const idErr = duprIdError(duprId, false);
    if (idErr) throw err(400, idErr);
    if (email && !email.includes('@')) throw err(400, 'That email does not look valid.');
    if (duprProfileUrl && !/^https:\/\//i.test(duprProfileUrl)) {
      throw err(400, 'The DUPR profile link must start with https://');
    }

    await pool.query(
      `UPDATE people SET dupr_id = COALESCE($2, dupr_id), dupr_rating = COALESCE($3, dupr_rating),
         dupr_profile_url = COALESCE($4, dupr_profile_url), photo_url = COALESCE($5, photo_url),
         resides = COALESCE($6, resides), age = COALESCE($7, age), country = COALESCE($8, country),
         updated_at = now() WHERE id = $1`,
      [personId, duprId, duprRating, duprProfileUrl, photoUrl, resides, age, country]
    );
    const { rows: member } = await pool.query('SELECT id FROM members WHERE person_id = $1', [personId]);
    if (member.length) {
      await pool.query(
        `UPDATE members SET email = COALESCE($2, email), phone = COALESCE($3, phone),
           dupr_id = COALESCE($4, dupr_id), dupr_rating = COALESCE($5, dupr_rating),
           dupr_profile_url = COALESCE($6, dupr_profile_url), photo_url = COALESCE($7, photo_url),
           resides = COALESCE($8, resides), age = COALESCE($9, age), country = COALESCE($10, country),
           nickname = COALESCE($11, nickname), gender = COALESCE($12, gender),
           height = COALESCE($13, height), handed = COALESCE($14, handed),
           singles_rating = COALESCE($15, singles_rating), skinny_rating = COALESCE($16, skinny_rating),
           self_rated = CASE WHEN $4 IS NOT NULL THEN FALSE ELSE self_rated END
         WHERE person_id = $1`,
        [personId, email, phone, duprId, duprRating, duprProfileUrl, photoUrl, resides, age, country,
         nickname, gender, height, handed, singlesRating, skinnyRating]
      );
    } else {
      // No member record yet: a DUPR ID on the save means a real DUPR
      // rating; a rating with no DUPR ID means the member is self-rated.
      const effDuprId = duprId || p.dupr_id;
      const effRating = duprRating != null ? duprRating : p.dupr_rating;
      await pool.query(
        `INSERT INTO members (person_id, name, email, phone, dupr_id, dupr_rating,
                              dupr_profile_url, photo_url, resides, age, country,
                              nickname, gender, height, handed, singles_rating, skinny_rating, self_rated)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [personId, p.name, email, phone,
         duprId || p.dupr_id, duprRating != null ? duprRating : p.dupr_rating,
         duprProfileUrl || p.dupr_profile_url, photoUrl || p.photo_url,
         resides || p.resides, age != null ? age : p.age, country || p.country,
         nickname, gender, height, handed, singlesRating, skinnyRating,
         effDuprId ? false : effRating != null]
      );
    }
    res.json({ ok: true });
  }, req, res)
);

// ---------------------------------------------------------------- admin: members

// Admin member directory — the ONLY place email/phone are returned.
router.get('/admin/members', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const { rows } = await pool.query(
      `SELECT m.*, COALESCE((SELECT json_agg(l.name)
          FROM player_leagues pl JOIN leagues l ON l.id = pl.league_id
         WHERE pl.person_id = m.person_id), '[]'::json) AS leagues
         FROM members m ORDER BY m.name ASC`
    );
    res.json({ members: rows });
  }, req, res)
);

router.patch('/admin/members/:id', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const id = asInt(req.params.id);
    const { rows: member } = await pool.query('SELECT * FROM members WHERE id = $1', [id]);
    if (!member.length) throw err(404, 'Member not found.');
    const m = member[0];
    const email = cleanStr(req.body.email);
    const phone = cleanStr(req.body.phone);
    const duprId = cleanDuprId(req.body.duprId);
    const duprRating = cleanRating(req.body.duprRating);
    const duprProfileUrl = cleanStr(req.body.duprProfileUrl, 500);
    const photoUrl = cleanStr(req.body.photoUrl, 500);
    const resides = cleanStr(req.body.resides);
    const age = req.body.age === '' || req.body.age == null ? null : asInt(req.body.age);
    const country = cleanStr(req.body.country);
    const nickname = cleanStr(req.body.nickname, 100);
    const gender = cleanStr(req.body.gender, 20);
    const height = cleanStr(req.body.height, 20);
    const handed = cleanStr(req.body.handed, 20);
    const singlesRating = cleanRating(req.body.singlesRating);
    const skinnyRating = cleanRating(req.body.skinnyRating);
    const isAdmin = req.body.isAdmin === true ? true : req.body.isAdmin === false ? false : null;
    const idErr = duprIdError(duprId, false);
    if (idErr) throw err(400, idErr);
    if (duprProfileUrl && !/^https:\/\//i.test(duprProfileUrl)) {
      throw err(400, 'The DUPR profile link must start with https://');
    }
    await pool.query(
      `UPDATE members SET email = COALESCE($2, email), phone = COALESCE($3, phone),
         dupr_id = COALESCE($4, dupr_id), dupr_rating = COALESCE($5, dupr_rating),
         dupr_profile_url = COALESCE($6, dupr_profile_url), photo_url = COALESCE($7, photo_url),
         resides = COALESCE($8, resides), age = COALESCE($9, age), country = COALESCE($10, country),
         nickname = COALESCE($11, nickname), gender = COALESCE($12, gender),
         height = COALESCE($13, height), handed = COALESCE($14, handed),
         singles_rating = COALESCE($15, singles_rating), skinny_rating = COALESCE($16, skinny_rating),
         self_rated = CASE WHEN $4 IS NOT NULL THEN FALSE ELSE self_rated END,
         is_admin = COALESCE($17, is_admin)
       WHERE id = $1`,
      [id, email, phone, duprId, duprRating, duprProfileUrl, photoUrl, resides, age, country,
       nickname, gender, height, handed, singlesRating, skinnyRating, isAdmin]
    );
    if (m.person_id) {
      await pool.query(
        `UPDATE people SET dupr_id = COALESCE($2, dupr_id), dupr_rating = COALESCE($3, dupr_rating),
           dupr_profile_url = COALESCE($4, dupr_profile_url), photo_url = COALESCE($5, photo_url),
           resides = COALESCE($6, resides), age = COALESCE($7, age), country = COALESCE($8, country),
           updated_at = now() WHERE id = $1`,
        [m.person_id, duprId, duprRating, duprProfileUrl, photoUrl, resides, age, country]
      );
    }
    res.json({ ok: true });
  }, req, res)
);

router.delete('/admin/members/:id', auth.requireAdmin, (req, res) =>
  handle(async () => {
    await pool.query('DELETE FROM members WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  }, req, res)
);

// ---------------------------------------------------------------- admin: registrations

router.get('/admin/leagues/:id/registrations', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const league = await getLeague(pool, req.params.id);
    if (!league) throw err(404, 'League not found.');
    const { rows } = await pool.query(
      `SELECT r.*, l.name AS league_name FROM registrations r
         JOIN leagues l ON l.id = r.league_id
        WHERE r.league_id = $1 ORDER BY r.created_at ASC`,
      [league.id]
    );
    res.json({ registrations: rows });
  }, req, res)
);

// Confirm / add a registration. "added" also puts the person on the roster,
// carrying the fee waiver with them.
router.post('/admin/registrations/:id/status', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const id = asInt(req.params.id);
    const status = req.body.status;
    if (!['pending', 'confirmed', 'added'].includes(status)) {
      throw err(400, 'Status must be pending, confirmed, or added.');
    }
    const { rows } = await pool.query('SELECT * FROM registrations WHERE id = $1', [id]);
    if (!rows.length) throw err(404, 'Registration not found.');
    const reg = rows[0];
    if (status === 'added') {
      const person = await findOrCreatePerson(pool, {
        name: reg.name,
        duprId: reg.dupr_id,
        duprRating: reg.dupr_rating,
      });
      await pool.query(
        `INSERT INTO player_leagues (person_id, league_id, fee_waived)
         VALUES ($1,$2,$3) ON CONFLICT (person_id, league_id)
         DO UPDATE SET fee_waived = EXCLUDED.fee_waived`,
        [person.id, reg.league_id, reg.fee_waived]
      );
      await pool.query('UPDATE registrations SET person_id = $1 WHERE id = $2', [person.id, id]);
    }
    await pool.query('UPDATE registrations SET status = $1 WHERE id = $2', [status, id]);
    res.json({ ok: true });
  }, req, res)
);

// Waive (or un-waive) a registration fee, per person per league. If the
// person is already on the roster, the waiver follows them there.
router.post('/admin/registrations/:id/waive', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const id = asInt(req.params.id);
    const feeWaived = Boolean(req.body.feeWaived);
    const { rows } = await pool.query('SELECT * FROM registrations WHERE id = $1', [id]);
    if (!rows.length) throw err(404, 'Registration not found.');
    const reg = rows[0];
    await pool.query('UPDATE registrations SET fee_waived = $1 WHERE id = $2', [feeWaived, id]);
    if (reg.person_id) {
      await pool.query(
        'UPDATE player_leagues SET fee_waived = $1 WHERE league_id = $2 AND person_id = $3',
        [feeWaived, reg.league_id, reg.person_id]
      );
    }
    res.json({ ok: true });
  }, req, res)
);

router.delete('/admin/registrations/:id', auth.requireAdmin, (req, res) =>
  handle(async () => {
    await pool.query('DELETE FROM registrations WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  }, req, res)
);

// ---------------------------------------------------------------- admin: add-player autocomplete

// Name autocomplete for the Admin Add-a-player form: matching free members
// and not-yet-added registrations. People already on the given league show
// "Already in the league" and cannot be picked.
router.get('/admin/people/search', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const q = cleanStr(req.query.q, 100);
    const leagueId = asInt(req.query.leagueId);
    if (!q) return res.json({ results: [] });
    const like = `%${q.toLowerCase()}%`;
    const byName = new Map();
    const { rows: people } = await pool.query(
      `SELECT p.id AS person_id, p.name, p.dupr_id, p.dupr_rating, p.dupr_profile_url,
              COALESCE((SELECT json_agg(l.name)
                          FROM player_leagues pl JOIN leagues l ON l.id = pl.league_id
                         WHERE pl.person_id = p.id), '[]'::json) AS leagues,
              EXISTS (SELECT 1 FROM player_leagues pl WHERE pl.person_id = p.id AND pl.league_id = $2) AS in_league
         FROM people p WHERE lower(p.name) LIKE $1 ORDER BY p.name ASC LIMIT 20`,
      [like, leagueId]
    );
    for (const p of people) {
      byName.set(p.name.toLowerCase(), {
        person_id: p.person_id, name: p.name, dupr_id: p.dupr_id,
        dupr_rating: p.dupr_rating == null ? null : Number(p.dupr_rating),
        dupr_profile_url: p.dupr_profile_url, source: 'person',
        leagues: p.leagues, inLeague: p.in_league,
      });
    }
    const { rows: regs } = await pool.query(
      `SELECT r.id, r.name, r.league_id, r.dupr_id, r.dupr_rating, r.self_rated, r.status, l.name AS league_name
         FROM registrations r JOIN leagues l ON l.id = r.league_id
        WHERE lower(r.name) LIKE $1 AND r.status IN ('pending','confirmed')
        ORDER BY r.name ASC LIMIT 20`,
      [like]
    );
    for (const r of regs) {
      const key = r.name.toLowerCase();
      const existing = byName.get(key);
      if (existing) {
        existing.registrationId = r.id;
        existing.registrationLeague = r.league_name;
        continue;
      }
      byName.set(key, {
        person_id: null, name: r.name, dupr_id: r.dupr_id,
        dupr_rating: r.dupr_rating == null ? null : Number(r.dupr_rating),
        self_rated: Boolean(r.self_rated),
        dupr_profile_url: null, source: 'registration',
        leagues: [], inLeague: false,
        registrationId: r.id, registrationLeague: r.league_name,
      });
    }
    res.json({ results: [...byName.values()] });
  }, req, res)
);

// ---------------------------------------------------------------- admin: announce

// Everything the Announce tool needs: the league record, its 8 game days,
// and the member recipient list (contact details — Admin only).
// NOTHING is sent by the app; drafts are copied by the organizer.
router.get('/admin/leagues/:id/announce', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const league = await getLeague(pool, req.params.id);
    if (!league) throw err(404, 'League not found.');
    const sessions = await getSessions(pool, league.id);
    const { rows: members } = await pool.query(
      'SELECT name, email, phone FROM members ORDER BY name ASC'
    );
    res.json({
      league: normalizeLeague(league),
      sessions: sessions.map((s) => ({
        session_number: s.session_number, date: s.date instanceof Date ? s.date.toISOString().slice(0, 10) : String(s.date).slice(0, 10), starts_at: s.starts_at,
        status: s.status, label: s.label,
      })),
      members,
      memberCount: members.length,
      withEmail: members.filter((m) => m.email).length,
      withPhone: members.filter((m) => m.phone).length,
    });
  }, req, res)
);

// Everything the all-leagues announcement needs: every league (with its
// player count and registration state) and the member recipient list.
// The draft itself lists only leagues with registration open; nothing is
// sent by the app — drafts are copied by the organizer.
router.get('/admin/announce-all', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const { rows } = await pool.query(
      `SELECT l.*, COALESCE(pc.count, 0) AS player_count, ls.registration_open
         FROM leagues l
         LEFT JOIN (SELECT league_id, COUNT(*) AS count FROM player_leagues GROUP BY league_id) pc
           ON pc.league_id = l.id
         LEFT JOIN league_settings ls ON ls.league_id = l.id
        ORDER BY l.start_date ASC`
    );
    const { rows: members } = await pool.query(
      'SELECT name, email, phone FROM members ORDER BY name ASC'
    );
    res.json({
      leagues: rows.map(normalizeLeague),
      members,
      memberCount: members.length,
      withEmail: members.filter((m) => m.email).length,
      withPhone: members.filter((m) => m.phone).length,
    });
  }, req, res)
);

// ---------------------------------------------------------------- admin: league settings

// Per-league logo color edit (Admin). The color tints the logo wherever it
// appears; Women's is pink, Advanced stays black-and-yellow.
router.patch('/admin/leagues/:id', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const league = await getLeague(pool, req.params.id);
    if (!league) throw err(404, 'League not found.');
    const b = req.body || {};
    const sets = [];
    const vals = [];
    let n = 0;
    const push = (col, v) => { sets.push(`${col} = $${++n}`); vals.push(v); };
    if (b.logoColor !== undefined) {
      const logoColor = cleanStr(b.logoColor, 32);
      if (!logoColor) throw err(400, 'logoColor is required.');
      push('logo_color', logoColor);
    }
    if (b.name !== undefined) {
      const name = cleanStr(b.name, 200);
      if (!name) throw err(400, 'League name cannot be empty.');
      push('name', name);
    }
    if (b.type !== undefined) {
      const types = ['Intermediate', 'Intermediate/Advanced', 'Advanced', 'Elite', "Women's"];
      if (!types.includes(b.type)) throw err(400, 'Unknown league type.');
      push('type', b.type);
    }
    if (b.skill !== undefined) {
      const skills = ['2.5-2.99', '3.0-3.49', '3.5-4.49', '5.0-ABOVE', '50+'];
      if (!skills.includes(b.skill)) throw err(400, 'Unknown skill range.');
      push('skill', b.skill);
    }
    if (b.format !== undefined) {
      const formats = ['Coed Doubles', "Women's Doubles", "Men's Doubles"];
      if (!formats.includes(b.format)) throw err(400, 'Unknown format.');
      push('format', b.format);
    }
    let newTime = null;
    if (b.day !== undefined) {
      const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      if (!days.includes(b.day)) throw err(400, 'Unknown day.');
      push('day', b.day);
    }
    if (b.time !== undefined) {
      if (!/^\d{2}:\d{2}(:\d{2})?$/.test(String(b.time))) throw err(400, 'Time must be HH:MM.');
      newTime = String(b.time).slice(0, 5);
      push('time', newTime);
    }
    if (b.season !== undefined) push('season', cleanStr(b.season, 100) || '');
    if (b.startDate !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.startDate))) throw err(400, 'Season start must be a date.');
      push('start_date', b.startDate);
    }
    if (b.stopDate !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.stopDate))) throw err(400, 'Season stop must be a date.');
      push('stop_date', b.stopDate);
    }
    if (!sets.length) throw err(400, 'Nothing to update.');
    // Changing Day/Time moves the time component of upcoming sessions'
    // starts_at (same dates, new time) so the opt-in deadline follows the
    // new time. Session DATES and labels are never rewritten here — dates
    // belong to "Move a game day". Completed sessions are never touched.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      vals.push(league.id);
      await client.query(`UPDATE leagues SET ${sets.join(', ')} WHERE id = $${++n}`, vals);
      if (newTime !== null) {
        const time = newTime;
        const { rows: upcoming } = await client.query(
          `SELECT id, starts_at FROM sessions
            WHERE league_id = $1 AND status = 'upcoming' AND starts_at > now()
            ORDER BY starts_at ASC`,
          [league.id]
        );
        for (const s of upcoming) {
          const d = dateOnly(s.starts_at);
          await client.query('UPDATE sessions SET starts_at = $1 WHERE id = $2', [zonedToUtc(d, time), s.id]);
        }
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    const updated = await getLeague(pool, league.id);
    res.json({ ok: true, league: normalizeLeague(updated) });
  }, req, res)
);

// Delete a league and everything that belongs to it (Admin). Sessions,
// matches, rank snapshots, roster spots, and registrations are removed by
// ON DELETE CASCADE; people and free-member records are untouched.
router.delete('/admin/leagues/:id', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const league = await getLeague(pool, req.params.id);
    if (!league) throw err(404, 'League not found.');
    const counts = {};
    for (const [key, sql] of [
      ['players', 'SELECT COUNT(*)::int AS n FROM player_leagues WHERE league_id = $1'],
      ['sessions', 'SELECT COUNT(*)::int AS n FROM sessions WHERE league_id = $1'],
      ['registrations', 'SELECT COUNT(*)::int AS n FROM registrations WHERE league_id = $1'],
    ]) {
      const { rows } = await pool.query(sql, [league.id]);
      counts[key] = rows[0].n;
    }
    const { rows: m } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM matches WHERE session_id IN (SELECT id FROM sessions WHERE league_id = $1)',
      [league.id]
    );
    counts.matches = m[0].n;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM leagues WHERE id = $1', [league.id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.json({ ok: true, deleted: { id: league.id, name: league.name, ...counts } });
  }, req, res)
);

// Rename a person everywhere at once (Admin). Updates the person record,
// the linked member record, and every registration for that person in one
// transaction, so the roster and the member directory can never disagree.
// My Profile keeps the name non-editable — the organizer fixes names here.
router.patch('/admin/people/:id/name', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const personId = asInt(req.params.id);
    if (!personId) throw err(400, 'Person id is required.');
    const name = cleanStr(req.body && req.body.name, 200);
    if (!name) throw err(400, 'Name cannot be empty.');
    const person = (await pool.query('SELECT id, name FROM people WHERE id = $1', [personId])).rows[0];
    if (!person) throw err(404, 'Person not found.');
    const clash = (await pool.query(
      'SELECT id FROM people WHERE lower(name) = lower($1) AND id <> $2',
      [name, personId]
    )).rows[0];
    if (clash) throw err(409, 'Another person already has that name.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE people SET name = $1, updated_at = now() WHERE id = $2', [name, personId]);
      await client.query('UPDATE members SET name = $1 WHERE person_id = $2', [name, personId]);
      await client.query('UPDATE registrations SET name = $1 WHERE person_id = $2', [name, personId]);
      // A pending signup not yet linked to a person still carries the old
      // spelling under the same name — rename it too.
      await client.query(
        'UPDATE registrations SET name = $1 WHERE person_id IS NULL AND lower(name) = lower($2)',
        [name, person.name]
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.json({ ok: true, name });
  }, req, res)
);

module.exports = router;

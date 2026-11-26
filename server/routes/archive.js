'use strict';
// Finished (Archive) tab — Admin-only. Finished leagues/nights and
// deleted ones land here: finishing archives automatically, Delete takes
// an item off the players' view but keeps it here. Restore clears
// deleted_at (the undo for an accidental delete); Delete forever —
// inside the archive only — destroys the rows with the old cascade.
// Items are newest first; the client shows dates MM/DD/YYYY.
// Mounted at /api (see server/index.js).
const express = require('express');
const { pool } = require('../db');
const auth = require('../lib/auth');
const {
  getLeague,
  getSessions,
  loadStandingsData,
  normalizeLeague,
  effectiveStatus,
} = require('../lib/league');
const { rrFixedHeadline, rrRotHeadline, bracketHeadline } = require('../lib/nights');
const rrRoutes = require('./roundrobin');
const brRoutes = require('./bracket');

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

function bad(res, status, msg) {
  const e = new Error(msg);
  e.status = status;
  throw e;
}

function dateOnly(v) {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

function dollars(cents) {
  const c = Number(cents) || 0;
  return '$' + (c / 100).toFixed(c % 100 === 0 ? 0 : 2);
}

// Tables for the three kinds, for Restore / Delete forever. The kind
// comes from the URL but is validated against this map first, so the
// table name in the SQL below is never user input.
const TABLES = { rr: 'rr_events', bracket: 'br_events', league: 'leagues' };

// An item's state in the archive: deleted wins over finished (a night
// that was finished and then deleted shows as Deleted — Restore brings
// it back as finished).
function itemState(row, isFinished) {
  if (row.deleted_at) return 'deleted';
  return isFinished ? 'finished' : 'active';
}

// ---------------------------------------------------------------- list

router.get('/admin/archive', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const items = [];

    // Leagues: finished (every game day completed) or deleted.
    const { rows: leagues } = await pool.query(
      `SELECT l.*,
              (SELECT MAX(s.date) FROM sessions s WHERE s.league_id = l.id) AS last_date,
              (SELECT COUNT(*) FROM player_leagues pl WHERE pl.league_id = l.id) AS player_count,
              (SELECT COUNT(*) FROM sessions s WHERE s.league_id = l.id) AS week_count
         FROM leagues l
        WHERE l.deleted_at IS NOT NULL
           OR (EXISTS (SELECT 1 FROM sessions s WHERE s.league_id = l.id)
               AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.league_id = l.id AND s.status <> 'completed'))`
    );
    for (const l of leagues) {
      const data = await loadStandingsData(pool, l.id, new Date(), true);
      const champ = data && data.rows.length ? data.rows[0] : null;
      const meta = [l.type, l.season || null, `${l.player_count} players`, `${l.week_count} weeks`]
        .filter(Boolean)
        .join(' · ');
      items.push({
        kind: 'league',
        id: l.id,
        name: l.name,
        date: dateOnly(l.last_date) || dateOnly(l.stop_date),
        state: itemState(l, true),
        headline: champ ? `Champion: ${champ.name} — ${champ.epDiff.toFixed(1)}% E/P Diff` : null,
        top: champ ? [champ.name] : [],
        meta,
      });
    }

    // Round robin nights: finished or deleted.
    const { rows: rr } = await pool.query(
      `SELECT e.*,
              (SELECT COUNT(*) FROM rr_teams t WHERE t.event_id = e.id) AS team_count,
              (SELECT COUNT(*) FROM rr_solos s WHERE s.event_id = e.id) AS solo_count,
              (SELECT COUNT(*) FROM rr_rot_players p WHERE p.event_id = e.id) AS player_count,
              (SELECT COUNT(*) FROM rr_matches m WHERE m.event_id = e.id) +
              (SELECT COUNT(*) FROM rr_rot_matches m WHERE m.event_id = e.id) AS match_count,
              (SELECT COUNT(*) FROM rr_matches m WHERE m.event_id = e.id AND m.score1 IS NOT NULL) +
              (SELECT COUNT(*) FROM rr_rot_matches m WHERE m.event_id = e.id AND m.score1 IS NOT NULL) AS scored_count
         FROM rr_events e
        WHERE e.status = 'completed' OR e.deleted_at IS NOT NULL
        ORDER BY e.event_date DESC, e.id DESC`
    );
    for (const e of rr) {
      const { headline, top } =
        e.format === 'rotating' ? await rrRotHeadline(e) : await rrFixedHeadline(e);
      const meta =
        e.format === 'rotating'
          ? `Rotating partners · Free play · ${e.player_count} players · ${e.match_count} games`
          : e.kind === 'money'
            ? `Money Ball · ${dollars(e.fee_cents)} entry · ${e.team_count} teams · ${e.match_count} games`
            : `Free play · ${e.team_count} teams · ${e.match_count} games`;
      items.push({
        kind: 'rr',
        id: e.id,
        name: e.name,
        date: dateOnly(e.event_date),
        state: itemState(e, e.status === 'completed'),
        headline,
        top,
        meta,
      });
    }

    // Bracket nights: finished or deleted.
    const { rows: br } = await pool.query(
      `SELECT e.*,
              (SELECT COUNT(*) FROM br_teams t WHERE t.event_id = e.id) AS team_count,
              (SELECT COUNT(*) FROM br_solos s WHERE s.event_id = e.id) AS solo_count,
              (SELECT COUNT(*) FROM br_matches m WHERE m.event_id = e.id) AS match_count,
              (SELECT COUNT(*) FROM br_matches m WHERE m.event_id = e.id AND m.score1 IS NOT NULL) AS scored_count
         FROM br_events e
        WHERE e.status = 'completed' OR e.deleted_at IS NOT NULL
        ORDER BY e.event_date DESC, e.id DESC`
    );
    for (const e of br) {
      const { headline, top } = await bracketHeadline(e);
      items.push({
        kind: 'bracket',
        id: e.id,
        name: e.name,
        date: dateOnly(e.event_date),
        state: itemState(e, e.status === 'completed'),
        headline,
        top,
        meta: `Double elimination · ${e.team_count} teams · ${e.match_count} games`,
      });
    }

    // Newest first, by date, then by id.
    items.sort((a, b) => {
      const da = a.date || '';
      const db = b.date || '';
      return da < db ? 1 : da > db ? -1 : b.id - a.id;
    });
    res.json({ items });
  }, req, res)
);

// ---------------------------------------------------------------- detail
// The full results payload for one archived item — the same shape as the
// live detail endpoints, so the night pages render it read-only. Admin
// can open a deleted item here; the public detail endpoints 404 on
// deleted rows instead.

router.get('/admin/archive/:kind/:id', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const kind = req.params.kind;
    const id = asInt(req.params.id);
    if (!TABLES[kind] || id == null) return bad(res, 404, 'Not found.');
    if (kind === 'rr') {
      const event = await rrRoutes.getEvent(id, true);
      if (!event) return bad(res, 404, 'Round robin not found.');
      const detail = await rrRoutes.eventDetail(event, req);
      return res.json({
        ...detail,
        kind: 'rr',
        state: itemState(event, event.status === 'completed'),
        archived: true,
      });
    }
    if (kind === 'bracket') {
      const event = await brRoutes.getEvent(id, true);
      if (!event) return bad(res, 404, 'Bracket night not found.');
      const detail = await brRoutes.eventDetail(event, req);
      return res.json({
        ...detail,
        kind: 'bracket',
        state: itemState(event, event.status === 'completed'),
        archived: true,
      });
    }
    const league = await getLeague(pool, id, true);
    if (!league) return bad(res, 404, 'League not found.');
    const [data, sessions] = await Promise.all([
      loadStandingsData(pool, id, new Date(), true),
      getSessions(pool, id),
    ]);
    const rows = data ? data.rows : [];
    const champ = rows.length ? rows[0] : null;
    const allDone = sessions.length > 0 && sessions.every((s) => s.status === 'completed');
    const lastDate = sessions.length
      ? dateOnly(sessions[sessions.length - 1].date)
      : dateOnly(league.stop_date);
    return res.json({
      kind: 'league',
      state: itemState(league, allDone),
      archived: true,
      date: lastDate,
      league: normalizeLeague(league),
      champion: champ ? { name: champ.name, epDiff: champ.epDiff } : null,
      standings: rows.map((r) => ({
        rank: r.rank,
        name: r.name,
        epDiff: r.epDiff,
        score: r.score,
        earned: r.earned,
        possible: r.possible,
        wins: r.wins,
        losses: r.losses,
        played: r.played,
      })),
      sessions: sessions.map((s) => ({
        session_number: s.session_number,
        date: dateOnly(s.date),
        status: effectiveStatus(s),
        label: s.label,
      })),
    });
  }, req, res)
);

// ---------------------------------------------------------------- restore
// Undo a delete: clears deleted_at, putting the item back in the
// players' view. A finished item returns to the archive as Finished; a
// setup/playing item returns to the live lists.

router.post('/admin/archive/:kind/:id/restore', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const kind = req.params.kind;
    const id = asInt(req.params.id);
    if (!TABLES[kind] || id == null) return bad(res, 404, 'Not found.');
    const { rowCount } = await pool.query(
      `UPDATE ${TABLES[kind]} SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL`,
      [id]
    );
    if (!rowCount) return bad(res, 404, 'Nothing to restore — it is not deleted.');
    res.json({ ok: true });
  }, req, res)
);

// ---------------------------------------------------------------- delete forever
// The only way to actually destroy rows now: inside the archive, Admin
// only, with the client's "cannot be undone" confirm. Leagues use the
// old cascade (sessions, matches, rank snapshots, roster spots, and
// registrations go with the league; people and free-member records are
// untouched). Nights cascade to their teams, matches, and solos.

router.delete('/admin/archive/:kind/:id', auth.requireAdmin, (req, res) =>
  handle(async () => {
    const kind = req.params.kind;
    const id = asInt(req.params.id);
    if (!TABLES[kind] || id == null) return bad(res, 404, 'Not found.');
    if (kind === 'league') {
      const league = await getLeague(pool, id, true);
      if (!league) return bad(res, 404, 'League not found.');
      await pool.query('DELETE FROM leagues WHERE id = $1', [id]);
      return res.json({ ok: true, deleted: { id: league.id, name: league.name } });
    }
    const { rowCount } = await pool.query(`DELETE FROM ${TABLES[kind]} WHERE id = $1`, [id]);
    if (!rowCount) return bad(res, 404, 'Not found.');
    res.json({ ok: true });
  }, req, res)
);

module.exports = router;

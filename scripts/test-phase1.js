'use strict';
// Phase 1 end-to-end test. Spins up the real server against a throwaway
// Postgres database and exercises the core flows:
//   admin passcode, create league, add players, self opt-in, manual build,
//   auto-generation after the deadline, player-scoped score entry,
//   standings math (E/P, miss penalty, Previous/Max Mvmt), finish/reopen,
//   DUPR seeding, and the 4/5/6-player court builds.
// Run: npm test
const { execSync } = require('child_process');
const path = require('path');

const TEST_DB = 'mpa_test_phase1';
const PSQL = '/usr/lib/postgresql/16/bin/psql';
const BASE_URL = process.env.TEST_BASE_URL || null;

let failures = 0;
let server = null;
let base = BASE_URL;

function check(name, cond, extra) {
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`);
  }
}

async function req(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const res = await fetch(base + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
const post = (p, body, headers) =>
  req(p, { method: 'POST', body: JSON.stringify(body || {}), headers });
const get = (p, headers) => req(p, { headers });

// Admin requests carry the login cookie captured at sign-in.
let adminCookie = '';
async function adminPost(p, body) {
  return post(p, body, { Cookie: adminCookie });
}
async function adminReq(p, opts = {}) {
  return req(p, { ...opts, headers: { Cookie: adminCookie } });
}

// Next Saturday from today (local date).
function nextWeekday(weekday, from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let add = (weekday - d.getDay() + 7) % 7;
  if (add === 0) add = 7;
  d.setDate(d.getDate() + add);
  return d;
}
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function hhmm(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
// HH:MM of a Date in the league timezone (America/New_York). League times
// are interpreted in that zone, so "one hour ago" must be computed there,
// not in the server's UTC clock.
function nyHhmm(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

async function main() {
  // ---- set up a throwaway database -------------------------------------
  if (!BASE_URL) {
    try {
      execSync(
        `${PSQL} -h /tmp/pgrun -p 5433 -U postgres -c "DROP DATABASE IF EXISTS ${TEST_DB}" -c "CREATE DATABASE ${TEST_DB} OWNER mpa"`,
        { stdio: 'pipe' }
      );
    } catch (e) {
      console.log('  (could not recreate test db via psql — using existing one)');
    }
    process.env.DATABASE_URL = `postgres://mpa:mpa_dev@localhost:5433/${TEST_DB}`;
    process.env.ADMIN_PASSCODE = 'test-pass-123';
    process.env.PORT = '0';
    const { start } = require('../server/index');
    server = await start();
    base = `http://localhost:${server.address().port}`;
  }

  console.log('== health ==');
  check('health ok', (await get('/api/health')).data.ok === true);

  console.log('== admin passcode ==');
  check('admin endpoint 401 without login', (await post('/api/admin/leagues', { name: 'x' })).status === 401);
  check('wrong passcode rejected', (await post('/api/admin/login', { passcode: 'nope' })).status === 401);
  const login = await post('/api/admin/login', { passcode: 'test-pass-123' });
  check('right passcode logs in', login.status === 200 && login.data.ok === true);
  adminCookie = (login.headers || new Map()).get?.('set-cookie') || '';
  // fetch() in node returns headers via res.headers — re-do login capturing it.
  const loginRes = await fetch(base + '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode: 'test-pass-123' }),
  });
  adminCookie = loginRes.headers.get('set-cookie') || '';
  check('login sets a cookie', adminCookie.includes('mpa_admin='));
  check('me reports admin', (await adminReq('/api/admin/me')).data.admin === true);

  // ---- League A: future Saturday league, 10 players, manual build -------
  console.log('== league A: create + roster + self opt-in ==');
  const sat = nextWeekday(6);
  const created = await adminPost('/api/admin/leagues', {
    name: 'Advanced 2026', type: 'Advanced', skill: '3.5-4.49',
    format: 'Coed Doubles', day: 'Saturday', time: '18:30',
    season: 'Winter 2026', startDate: isoDate(sat),
    stopDate: isoDate(new Date(sat.getTime() + 7 * 7 * 86400000)),
    location: 'YMCA, 601 26th Ave SE, Moultrie, GA 31768', maxPlayers: 36, logoColor: 'black-yellow',
  });
  check('league created', created.status === 201, JSON.stringify(created.data));
  const leagueA = created.data.league;
  check('8 sessions generated', (await get(`/api/leagues/${leagueA.id}`)).data.sessions.length === 8);

  const names = ['Alan Cortez', 'Justin Johnson', 'Zell Emerson', 'Stew Meridian', 'Laura Byron',
    'Lacey Herdon', 'Kimberly Johnson', 'Caroline Horne', 'Chris Phillips', 'Jamie Lowery'];
  const dupr = { 'Alan Cortez': 3.643, 'Justin Johnson': 4.1, 'Zell Emerson': 3.9 };
  const ids = {};
  for (const n of names) {
    const r = await adminPost(`/api/admin/leagues/${leagueA.id}/players`, {
      name: n, duprId: dupr[n] ? 'DUPR' + n.slice(0, 2).toUpperCase() : null, duprRating: dupr[n] || null,
    });
    check(`add player ${n}`, r.status === 201, JSON.stringify(r.data));
    ids[n] = r.data.person.id;
  }
  const dup = await adminPost(`/api/admin/leagues/${leagueA.id}/players`, { name: 'Alan Cortez' });
  check('duplicate roster add rejected', dup.status === 409);

  // DUPR seeding: before any session completes, order is DUPR desc.
  const seed = await get(`/api/leagues/${leagueA.id}/standings`);
  check('DUPR seeding puts Justin (4.1) first', seed.data.standings[0].name === 'Justin Johnson',
    seed.data.standings.map((s) => s.name).join(','));
  check('unrated players below rated', seed.data.standings.slice(0, 3).every((s) => s.dupr_rating != null));

  const detailA = await get(`/api/leagues/${leagueA.id}`);
  const s1 = detailA.data.sessions[0];
  check('current game day is session 1', detailA.data.currentSessionId === s1.id);
  for (const n of names) {
    const r = await post(`/api/leagues/${leagueA.id}/sessions/${s1.id}/opt-in`, { personId: ids[n] });
    if (r.status !== 200) check(`self opt-in ${n}`, false, JSON.stringify(r.data));
  }
  check('all 10 opted in', true);
  const before = await get(`/api/leagues/${leagueA.id}/sessions/${s1.id}?viewer=${ids['Alan Cortez']}`);
  check('before deadline: not revealed, no matches', before.data.window.isRevealed === false && before.data.matches === null);
  check('playing count 10', before.data.counts.playing === 10);

  const build = await adminPost(`/api/admin/leagues/${leagueA.id}/sessions/${s1.id}/build`, {});
  check('manual build ok', build.status === 200, JSON.stringify(build.data));
  const builtMatches = build.data.matches.filter((m) => m.kind === 'match');
  const builtByes = build.data.matches.filter((m) => m.kind === 'bye');
  check('10 players -> 2 courts of 5 -> 10 games', builtMatches.length === 10, `got ${builtMatches.length}`);
  check('10 players -> 10 bye rows (1 per game)', builtByes.length === 10, `got ${builtByes.length}`);
  check('5-player games are to 15', builtMatches.every((m) => m.target_score === 15));

  // ---- score entry: player scope + validation ----------------------------
  console.log('== score entry: player scope ==');
  const detailAfterBuild = await get(`/api/leagues/${leagueA.id}/sessions/${s1.id}?viewer=${ids['Alan Cortez']}`);
  check('before deadline: still no matches for player', detailAfterBuild.data.matches === null);
  // Force the deadline to pass by using the admin-built schedule: scores are
  // blocked pre-deadline, so verify the block, then test scoring on league B.
  const anyMatch = builtMatches[0];
  const early = await post(`/api/leagues/${leagueA.id}/sessions/${s1.id}/matches/${anyMatch.id}/score`, {
    personId: ids['Alan Cortez'], score1: 15, score2: 13,
  });
  check('score blocked before deadline', early.status === 409, JSON.stringify(early.data));

  // ---- League B: sessions Nov 8/9/10 at 06:30 (all deadlines passed) -----
  // Players joined Nov 7, so all three sessions count for misses.
  console.log('== league B: auto-generate after deadline, scoring, finish ==');
  const pastDates = [8, 9, 10, 11, 12, 13, 14, 15].map(
    (d) => `2026-11-${String(d).padStart(2, '0')}`
  );
  const createdB = await adminPost('/api/admin/leagues', {
    name: 'Test League B', type: 'Intermediate', skill: '3.0-3.49',
    format: 'Coed Doubles', day: 'Saturday',
    time: '06:30', season: '', startDate: pastDates[0],
    stopDate: pastDates[7], gameDates: pastDates,
  });
  check('league B created', createdB.status === 201, JSON.stringify(createdB.data));
  const leagueB = createdB.data.league;
  const bNames = ['P1 One', 'P2 Two', 'P3 Three', 'P4 Four'];
  const bIds = {};
  for (const n of bNames) {
    const r = await adminPost(`/api/admin/leagues/${leagueB.id}/players`, { name: n, joinedAt: '2026-11-07' });
    bIds[n] = r.data.person.id;
  }
  const detailB = await get(`/api/leagues/${leagueB.id}`);
  const bs1 = detailB.data.sessions[0];
  check('league B session 1 revealed (deadline passed)', (await get(`/api/leagues/${leagueB.id}/sessions/${bs1.id}`)).data.window.isRevealed === true);
  // Walk-ins via admin (self opt-in is closed after the deadline).
  for (const n of bNames) {
    const r = await adminPost(`/api/admin/leagues/${leagueB.id}/sessions/${bs1.id}/opt-in`, { personId: bIds[n] });
    if (r.status !== 200) check(`walk-in ${n}`, false, JSON.stringify(r.data));
  }
  const auto = await get(`/api/leagues/${leagueB.id}/sessions/${bs1.id}?viewer=${bIds['P1 One']}`);
  check('schedule auto-generated on load', auto.data.matches && auto.data.matches.length > 0, JSON.stringify(auto.data.matches || auto.data));
  const bGames = auto.data.matches.filter((m) => m.kind === 'match');
  check('4 players -> 3 games to 20', bGames.length === 3 && bGames.every((m) => m.target_score === 20), `got ${bGames.length}`);
  check('4 players -> no byes', auto.data.matches.filter((m) => m.kind === 'bye').length === 0);
  check('player sees only own court (court 1 of 1)', auto.data.myCourt === 1);

  // Score validation + player scoping on a 2-court league: use league A after
  // forcing its deadline via a second past session is complex; instead test
  // scoring fully on league B (single court) and scoping on league C below.
  const bad = await post(`/api/leagues/${leagueB.id}/sessions/${bs1.id}/matches/${bGames[0].id}/score`, {
    personId: bIds['P1 One'], score1: 14, score2: 10,
  });
  check('score 14-10 rejected (must reach 20)', bad.status === 400, JSON.stringify(bad.data));
  const good = await post(`/api/leagues/${leagueB.id}/sessions/${bs1.id}/matches/${bGames[0].id}/score`, {
    personId: bIds['P1 One'], score1: 20, score2: 13,
  });
  check('score 20-13 saved by a player on that court', good.status === 200, JSON.stringify(good.data));
  // Score the other two games: game2 20-18, game3 12-20.
  await post(`/api/leagues/${leagueB.id}/sessions/${bs1.id}/matches/${bGames[1].id}/score`, {
    personId: bIds['P2 Two'], score1: 20, score2: 18,
  });
  await post(`/api/leagues/${leagueB.id}/sessions/${bs1.id}/matches/${bGames[2].id}/score`, {
    personId: bIds['P3 Three'], score1: 12, score2: 20,
  });

  // Standings math check (4-player court, rounds: 1v2 vs 3v4, 1v3 vs 2v4, 1v4 vs 2v3).
  const stB = await get(`/api/leagues/${leagueB.id}/standings`);
  const row = (name) => stB.data.standings.find((s) => s.name === name);
  // P1: games 20-13 (W), 20-18 (W), 12-20 (L) -> earned 52, against 51, possible 60.
  check('P1 earned 52 / against 51 / possible 60', row('P1 One').earned === 52 && row('P1 One').against === 51 && row('P1 One').possible === 60,
    JSON.stringify(row('P1 One')));
  check('P1 E/P 86.667%', Math.abs(row('P1 One').epDiff - (52 / 60) * 100) < 0.001, String(row('P1 One').epDiff));
  check('P1 2W-1L', row('P1 One').wins === 2 && row('P1 One').losses === 1);

  // Finish: blocked while unscored? All 3 are scored now — test the 409 path
  // on league A session 1 (built, unscored).
  const finA = await adminPost(`/api/admin/leagues/${leagueA.id}/sessions/${s1.id}/finish`, {});
  check('finish blocked with unscored games', finA.status === 409 && finA.data.unscored === 10, JSON.stringify(finA.data));
  const finB = await adminPost(`/api/admin/leagues/${leagueB.id}/sessions/${bs1.id}/finish`, {});
  check('finish league B session 1', finB.status === 200, JSON.stringify(finB.data));
  const stB2 = await get(`/api/leagues/${leagueB.id}/standings`);
  // Session 2 has already started (in progress), so Previous now reads the
  // session-1 snapshot ranks saved at finish.
  const finRank = (name) => finB.data.standings.find((s) => s.name === name).rank;
  check('during session 2, Previous reads the session-1 snapshot',
    stB2.data.standings.filter((s) => s.name !== 'P5 Five').every((s) => s.previous === finRank(s.name)),
    JSON.stringify(stB2.data.standings.map((s) => `${s.name}: prev ${s.previous}`)));
  const detailB2 = await get(`/api/leagues/${leagueB.id}`);
  check('current game day rolled to session 2', detailB2.data.currentSessionId === detailB.data.sessions[1].id);

  // Session 2: P4 misses (1st miss free). Session 3: P4 misses again (2nd miss -> 2.5).
  const bs2 = detailB.data.sessions[1];
  for (const n of ['P1 One', 'P2 Two', 'P3 Three']) {
    await adminPost(`/api/admin/leagues/${leagueB.id}/sessions/${bs2.id}/opt-in`, { personId: bIds[n] });
  }
  const build2 = await adminPost(`/api/admin/leagues/${leagueB.id}/sessions/${bs2.id}/build`, {});
  // 3 players cannot form a court — build warns, no matches.
  check('3 players -> no matches + warning',
    (build2.data.matches || []).filter((m) => m.kind === 'match').length === 0 &&
    (build2.data.warnings || []).length > 0,
    JSON.stringify(build2.data));
  // Add a walk-in to make 4, rebuild, score, finish.
  const w = await adminPost(`/api/admin/leagues/${leagueB.id}/players`, { name: 'P5 Five', joinedAt: '2026-11-07' });
  bIds['P5 Five'] = w.data.person.id;
  await adminPost(`/api/admin/leagues/${leagueB.id}/sessions/${bs2.id}/opt-in`, { personId: bIds['P5 Five'] });
  const d2b = await get(`/api/leagues/${leagueB.id}/sessions/${bs2.id}?viewer=${bIds['P1 One']}`);
  const g2 = (d2b.data.matches || []).filter((m) => m.kind === 'match');
  check('walk-in makes 4 -> 3 games', g2.length === 3, `got ${g2.length}`);
  for (const m of g2) {
    await post(`/api/leagues/${leagueB.id}/sessions/${bs2.id}/matches/${m.id}/score`, {
      personId: bIds['P1 One'], score1: 20, score2: 10,
    });
  }
  const finB2 = await adminPost(`/api/admin/leagues/${leagueB.id}/sessions/${bs2.id}/finish`, {});
  check('finish session 2', finB2.status === 200, JSON.stringify(finB2.data));
  const stB3 = await get(`/api/leagues/${leagueB.id}/standings`);
  const p4 = stB3.data.standings.find((s) => s.name === 'P4 Four');
  check('P4 missed 1 (session 2): penalty still 0 (1st free)', p4.missed === 1 && p4.penalty === 0, JSON.stringify(p4));
  check('Previous now filled from session 1 snapshot', stB3.data.standings.every((s) => s.previous !== null || s.name === 'P5 Five'));

  // Session 3: P4 misses again -> 2nd miss -> 2.5 penalty.
  const bs3 = detailB.data.sessions[2];
  for (const n of ['P1 One', 'P2 Two', 'P3 Three', 'P5 Five']) {
    await adminPost(`/api/admin/leagues/${leagueB.id}/sessions/${bs3.id}/opt-in`, { personId: bIds[n] });
  }
  await adminPost(`/api/admin/leagues/${leagueB.id}/sessions/${bs3.id}/build`, {});
  const d3 = await get(`/api/leagues/${leagueB.id}/sessions/${bs3.id}?viewer=${bIds['P1 One']}`);
  for (const m of (d3.data.matches || []).filter((mm) => mm.kind === 'match')) {
    await post(`/api/leagues/${leagueB.id}/sessions/${bs3.id}/matches/${m.id}/score`, {
      personId: bIds['P1 One'], score1: 20, score2: 10,
    });
  }
  await adminPost(`/api/admin/leagues/${leagueB.id}/sessions/${bs3.id}/finish`, {});
  const stB4 = await get(`/api/leagues/${leagueB.id}/standings`);
  const p4b = stB4.data.standings.find((s) => s.name === 'P4 Four');
  check('P4 missed 2: penalty 2.5', p4b.missed === 2 && Math.abs(p4b.penalty - 2.5) < 0.001, JSON.stringify(p4b));

  // Reopen removes the snapshot.
  const reopen = await adminPost(`/api/admin/leagues/${leagueB.id}/sessions/${bs3.id}/reopen`, {});
  check('reopen session 3', reopen.status === 200, JSON.stringify(reopen.data));
  const stB5 = await get(`/api/leagues/${leagueB.id}/standings`);
  const p4c = stB5.data.standings.find((s) => s.name === 'P4 Four');
  check('after reopen, P4 missed back to 1 / penalty 0', p4c.missed === 1 && p4c.penalty === 0, JSON.stringify(p4c));

  // ---- League C: 6-player court build + player scoping across courts -----
  console.log('== league C: 6-player court + cross-court score block ==');
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 3600000);
  const createdC = await adminPost('/api/admin/leagues', {
    name: 'Test League C', type: 'Intermediate', skill: '3.0-3.49',
    format: 'Coed Doubles', day: nextWeekday(6).toLocaleDateString('en-US', { weekday: 'long' }),
    time: nyHhmm(oneHourAgo), season: '', startDate: isoDate(now),
    stopDate: isoDate(new Date(now.getTime() + 7 * 7 * 86400000)),
  });
  const leagueC = createdC.data.league;
  const cNames = ['C1 A', 'C2 B', 'C3 C', 'C4 D', 'C5 E', 'C6 F'];
  const cIds = {};
  for (const n of cNames) {
    const r = await adminPost(`/api/admin/leagues/${leagueC.id}/players`, { name: n });
    cIds[n] = r.data.person.id;
  }
  const detailC = await get(`/api/leagues/${leagueC.id}`);
  const cs1 = detailC.data.sessions[0];
  for (const n of cNames) {
    await adminPost(`/api/admin/leagues/${leagueC.id}/sessions/${cs1.id}/opt-in`, { personId: cIds[n] });
  }
  const autoC = await get(`/api/leagues/${leagueC.id}/sessions/${cs1.id}?viewer=${cIds['C1 A']}`);
  const cGames = (autoC.data.matches || []).filter((m) => m.kind === 'match');
  const cByes = (autoC.data.matches || []).filter((m) => m.kind === 'bye');
  check('6 players -> 9 games to 10', cGames.length === 9 && cGames.every((m) => m.target_score === 10), `got ${cGames.length}`);
  check('6 players -> 18 bye rows (2 per game)', cByes.length === 18, `got ${cByes.length}`);
  // Every player: 6 games, 3 byes, 60 possible.
  const allC = await adminReq(`/api/leagues/${leagueC.id}/sessions/${cs1.id}`);
  const allMatches = allC.data.matches || [];
  for (const n of cNames) {
    const pid = cIds[n];
    const played = allMatches.filter((m) => m.kind === 'match' && [m.team1_p1, m.team1_p2, m.team2_p1, m.team2_p2].includes(pid)).length;
    const sat = allMatches.filter((m) => m.kind === 'bye' && m.bye_person_id === pid).length;
    if (played !== 6 || sat !== 3) check(`6-court rotation ${n}: 6 games + 3 byes`, false, `played ${played}, sat ${sat}`);
  }
  check('6-court rotation: everyone 6 games + 3 byes', true);

  // 12-player league A: force deadline by finishing is not possible; test
  // cross-court scoping via league C is single-court. Build a 10-player
  // past-deadline league D for the cross-court check.
  console.log('== league D: 10 players, cross-court score block ==');
  const createdD = await adminPost('/api/admin/leagues', {
    name: 'Test League D', type: 'Intermediate', skill: '3.0-3.49',
    format: 'Coed Doubles', day: nextWeekday(6).toLocaleDateString('en-US', { weekday: 'long' }),
    time: nyHhmm(oneHourAgo), season: '', startDate: isoDate(now),
    stopDate: isoDate(new Date(now.getTime() + 7 * 7 * 86400000)),
  });
  const leagueD = createdD.data.league;
  const dIds = {};
  for (let i = 1; i <= 10; i++) {
    const r = await adminPost(`/api/admin/leagues/${leagueD.id}/players`, { name: `D${i} Player` });
    dIds[`D${i}`] = r.data.person.id;
  }
  const detailD = await get(`/api/leagues/${leagueD.id}`);
  const ds1 = detailD.data.sessions[0];
  for (let i = 1; i <= 10; i++) {
    await adminPost(`/api/admin/leagues/${leagueD.id}/sessions/${ds1.id}/opt-in`, { personId: dIds[`D${i}`] });
  }
  const dView1 = await get(`/api/leagues/${leagueD.id}/sessions/${ds1.id}?viewer=${dIds.D1}`);
  const dCourts = [...new Set(dView1.data.matches.map((m) => m.court))].join(',');
  check('D1 sees only their court', dView1.data.matches.every((m) => m.court === dView1.data.myCourt),
    'myCourt=' + dView1.data.myCourt + ' courts=' + dCourts);
  const dViewAll = await adminReq(`/api/leagues/${leagueD.id}/sessions/${ds1.id}`);
  const court2Match = (dViewAll.data.matches || []).find((m) => m.kind === 'match' && m.court === 2);
  const cross = await post(`/api/leagues/${leagueD.id}/sessions/${ds1.id}/matches/${court2Match.id}/score`, {
    personId: dIds.D1, score1: 15, score2: 10,
  });
  check('player on court 1 cannot score court 2', cross.status === 403, JSON.stringify(cross.data));
  const court1Match = (dViewAll.data.matches || []).find((m) => m.kind === 'match' && m.court === 1);
  const own = await post(`/api/leagues/${leagueD.id}/sessions/${ds1.id}/matches/${court1Match.id}/score`, {
    personId: dIds.D1, score1: 15, score2: 10,
  });
  check('player on court 1 can score court 1', own.status === 200, JSON.stringify(own.data));
  // Admin can score any court.
  const adminScore = await adminPost(`/api/leagues/${leagueD.id}/sessions/${ds1.id}/matches/${court2Match.id}/score`, {
    score1: 15, score2: 12,
  });
  check('organizer can score any court', adminScore.status === 200, JSON.stringify(adminScore.data));
  // A non-opted-in person cannot score.
  const stranger = await adminPost(`/api/admin/leagues/${leagueD.id}/players`, { name: 'Out Sider' });
  const strangerScore = await post(`/api/leagues/${leagueD.id}/sessions/${ds1.id}/matches/${court1Match.id}/score`, {
    personId: stranger.data.person.id, score1: 15, score2: 0,
  });
  check('non-opted-in person cannot score', strangerScore.status === 403, JSON.stringify(strangerScore.data));

  console.log(failures === 0 ? '\nALL PHASE 1 TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
  if (server) server.close();
  process.exit(failures === 0 ? 0 : 1);
}

// ---- unit tests for the standings rules (run after the e2e flow) ---------
function unitStandings() {
  const { computeStandings } = require('../server/lib/standings');
  console.log('== unit: miss penalty ladder + absent cannot move up + Max Mvmt ==');
  const mk = (id, name, dupr) => ({
    person_id: id, name, dupr_id: null, dupr_rating: dupr ?? null,
    joined_at: new Date('2026-11-01'), admin_penalty: 0,
  });
  // Miss ladder: 3 completed sessions; player M missed all 3 (3 misses -> 5.0).
  const roster = [mk(1, 'A'), mk(2, 'B'), mk(3, 'M')];
  const sess = (id, date, attendees, matches) => ({ id, date, status: 'completed', attendees: new Set(attendees), matches });
  const match = (a, b, s1, s2) => ({ kind: 'match', team1_p1: a, team1_p2: null, team2_p1: b, team2_p2: null, score1: s1, score2: s2, target_score: 15 });
  const sessions = [
    sess(1, '2026-11-07', [1, 2], [match(1, 2, 15, 5)]),
    sess(2, '2026-11-14', [1, 2], [match(1, 2, 15, 5)]),
    sess(3, '2026-11-21', [1, 2], [match(1, 2, 15, 5)]),
  ];
  const rows = computeStandings({
    league: { id: 1, max_players: 36 }, roster, sessions,
    prevSnapshot: new Map(), latestCompleted: sessions[2], currentAttendees: new Set([1, 2]),
  });
  const mRow = rows.find((r) => r.person_id === 3);
  check('3 misses -> penalty 5.0', mRow.missed === 3 && Math.abs(mRow.penalty - 5.0) < 0.001, JSON.stringify(mRow));

  // Absent cannot move up: after week 1 the order is A=1, B=2, P=3.
  // In week 2 P is absent and A tanks (loses 0-15 to B), so on raw E/P
  // P would climb to 2nd. The rule must hold P at 3rd and flag Y.
  const roster2 = [mk(1, 'A'), mk(2, 'B'), mk(3, 'P')];
  const s0 = sess(1, '2026-11-07', [1, 2, 3], [
    match(1, 2, 15, 14), // A beats B
    match(1, 3, 15, 14), // A beats P
    match(2, 3, 15, 14), // B beats P
  ]);
  const s1 = sess(2, '2026-11-14', [1, 2], [
    match(2, 1, 15, 0), // B beats A 15-0
  ]);
  const rows2 = computeStandings({
    league: { id: 1, max_players: 36 }, roster: roster2, sessions: [s0, s1],
    prevSnapshot: new Map([[1, 1], [2, 2], [3, 3]]),
    latestCompleted: s1,
    currentAttendees: new Set([1, 2]),
  });
  const pRow = rows2.find((r) => r.person_id === 3);
  check('absent P (raw 2nd) is held at rank 3', pRow.rank === 3, JSON.stringify(pRow));
  check('absent P is flagged Y', pRow.maxMvmt === 'Y', JSON.stringify(pRow));
  check('ranks stay 1..3', rows2.map((r) => r.rank).sort().join(',') === '1,2,3',
    rows2.map((r) => `${r.name}:${r.rank}`).join(', '));
  const bestRow = rows2.find((r) => r.person_id === 2);
  check('B (played) takes rank 1', bestRow.rank === 1, JSON.stringify(bestRow));
}

main().catch(async (e) => {
  console.error('TEST CRASH', e);
  if (server) server.close();
  process.exit(1);
});

// Run the unit checks after the e2e flow (they do not need the server).
unitStandings();

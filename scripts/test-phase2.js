'use strict';
// Phase 2 end-to-end test. Spins up the real server against a throwaway
// Postgres database and exercises the Phase 2 flows:
//   members (create, duplicate guard, public hides email/phone, admin
//   sees + edits them), join flow + registrations (submit, confirm, waive,
//   add to roster with fee carried over, delete, closed-league rejection),
//   multi-league (one person, two rosters), admin autocomplete search,
//   My Dashboard (standings + games) / My Profile (name not editable,
//   member created on save), Announce data, logo color edit, create-league
//   with per-week custom dates, and admin enforcement on every new
//   admin endpoint.
// Run: npm test (runs phase 1, then this)
const { execSync } = require('child_process');

const TEST_DB = 'mpa_test_phase2';
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
  return { status: res.status, data, headers: res.headers };
}
const post = (p, body, headers) => req(p, { method: 'POST', body: JSON.stringify(body || {}), headers });
const patch = (p, body, headers) => req(p, { method: 'PATCH', body: JSON.stringify(body || {}), headers });
const get = (p, headers) => req(p, { headers });

let adminCookie = '';
async function adminPost(p, body) { return post(p, body, { Cookie: adminCookie }); }
async function adminPatch(p, body) { return patch(p, body, { Cookie: adminCookie }); }
async function adminGet(p) { return get(p, { Cookie: adminCookie }); }
async function adminDel(p) { return req(p, { method: 'DELETE', headers: { Cookie: adminCookie } }); }

function nextWeekday(weekday, from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let add = (weekday - d.getDay() + 7) % 7;
  if (add === 0) add = 7;
  d.setDate(d.getDate() + add);
  return d;
}
function prevWeekday(weekday, from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let sub = (d.getDay() - weekday + 7) % 7;
  if (sub === 0) sub = 7;
  d.setDate(d.getDate() - sub);
  return d;
}
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function main() {
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

  console.log('== admin login ==');
  const loginRes = await fetch(base + '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode: 'test-pass-123' }),
  });
  adminCookie = loginRes.headers.get('set-cookie') || '';
  check('admin login ok', loginRes.status === 200 && adminCookie.includes('mpa_admin='));

  // ---- admin enforcement on the new endpoints (no cookie) ----
  console.log('== admin enforcement ==');
  check('admin members 401 without login', (await get('/api/admin/members')).status === 401);
  check('admin announce 401 without login', (await get('/api/admin/leagues/1/announce')).status === 401);
  check('admin people search 401 without login', (await get('/api/admin/people/search?q=a')).status === 401);
  check('admin registrations 401 without login', (await get('/api/admin/leagues/1/registrations')).status === 401);
  check('admin member patch 401 without login', (await patch('/api/admin/members/1', { phone: 'x' })).status === 401);
  check('admin league patch 401 without login', (await patch('/api/admin/leagues/1', { logoColor: 'pink' })).status === 401);
  check('admin reg status 401 without login', (await post('/api/admin/registrations/1/status', { status: 'confirmed' })).status === 401);

  // ---- members ----
  console.log('== members ==');
  const mem = await post('/api/members', {
    name: 'Alice Adams', email: 'alice@example.test', phone: '555-0101',
    duprId: 'A1B2C3', duprRating: 3.5, resides: 'Moultrie, GA', age: 40, country: 'USA',
  });
  check('become a member 201', mem.status === 201, JSON.stringify(mem.data));
  const alice = mem.data.member;
  check('member response has no email/phone', alice && !('email' in alice) && !('phone' in alice), JSON.stringify(alice));
  check('member dupr saved', alice && alice.dupr_id === 'A1B2C3' && Number(alice.dupr_rating) === 3.5);
  check('duplicate member name rejected', (await post('/api/members', {
    name: 'alice adams', email: 'other@example.test', phone: '555-0102', duprId: 'X9Y8Z7', duprRating: 3.0,
  })).status === 409);
  check('member without DUPR rejected', (await post('/api/members', {
    name: 'No Dupr', email: 'n@example.test', phone: '555-0103', duprRating: 3.0,
  })).status === 400);
  check('member with bad email rejected', (await post('/api/members', {
    name: 'Bad Email', email: 'not-an-email', phone: '555-0104', duprId: 'B1C2D3', duprRating: 3.0,
  })).status === 400);

  const dir = await get('/api/members');
  check('public directory lists Alice', dir.data.members.some((m) => m.name === 'Alice Adams'));
  check('public directory hides email/phone', dir.data.members.every((m) => !('email' in m) && !('phone' in m)), JSON.stringify(dir.data.members[0]));
  const admMem = await adminGet('/api/admin/members');
  const aliceAdmin = admMem.data.members.find((m) => m.name === 'Alice Adams');
  check('admin members shows email/phone', aliceAdmin && aliceAdmin.email === 'alice@example.test' && aliceAdmin.phone === '555-0101', JSON.stringify(aliceAdmin));
  const memEdit = await adminPatch(`/api/admin/members/${aliceAdmin.id}`, { phone: '555-9999', resides: 'Norman Park, GA' });
  check('admin member edit ok', memEdit.status === 200, JSON.stringify(memEdit.data));
  const admMem2 = await adminGet('/api/admin/members');
  check('admin member edit persisted', admMem2.data.members.find((m) => m.id === aliceAdmin.id).phone === '555-9999');
  const memSearch = await get('/api/members/search?q=alic');
  check('public member search finds Alice', memSearch.data.members.length === 1 && memSearch.data.members[0].name === 'Alice Adams');
  const peopleSearch = await get('/api/people/search?q=alic');
  check('public people search finds Alice', peopleSearch.data.people.length >= 1 && peopleSearch.data.people[0].name === 'Alice Adams');

  // ---- leagues: A (Saturday, custom per-week dates), B (Women's Thursday) ----
  console.log('== leagues + per-week dates ==');
  const sat = nextWeekday(6);
  const customDates = [];
  for (let i = 0; i < 8; i++) {
    const d = new Date(sat.getTime() + i * 7 * 86400000);
    // Move week 3 by one day (the per-week edit case: a holiday week).
    if (i === 2) d.setDate(d.getDate() + 1);
    customDates.push(isoDate(d));
  }
  const createdA = await adminPost('/api/admin/leagues', {
    name: 'Advanced 2026', type: 'Advanced', skill: '3.5-4.49',
    format: 'Coed Doubles', day: 'Saturday', time: '18:30',
    season: 'Winter 2026', startDate: isoDate(sat),
    stopDate: isoDate(new Date(sat.getTime() + 7 * 7 * 86400000)),
    gameDates: customDates, maxPlayers: 36, logoColor: 'black-yellow',
  });
  check('league A created with custom dates', createdA.status === 201, JSON.stringify(createdA.data));
  const leagueA = createdA.data.league;
  const detailA = await get(`/api/leagues/${leagueA.id}`);
  check('league A has 8 sessions', detailA.data.sessions.length === 8);
  check('week 3 date is the edited date', detailA.data.sessions[2].date === customDates[2], `${detailA.data.sessions[2].date} vs ${customDates[2]}`);
  check('other weeks match the weekly pattern', detailA.data.sessions[0].date === customDates[0] && detailA.data.sessions[7].date === customDates[7]);
  check('7 game dates rejected', (await adminPost('/api/admin/leagues', {
    name: 'Bad Dates', type: 'Advanced', skill: '3.5-4.49', day: 'Saturday', time: '18:30',
    startDate: isoDate(sat), stopDate: isoDate(sat), gameDates: customDates.slice(0, 7),
  })).status === 400);

  const thu = nextWeekday(4);
  const createdB = await adminPost('/api/admin/leagues', {
    name: "MPA Winter 2026 - Women's", type: "Women's", skill: '3.0-3.49',
    format: "Women's Doubles", day: 'Thursday', time: '18:30',
    season: 'Winter 2026', startDate: isoDate(thu),
    stopDate: isoDate(new Date(thu.getTime() + 7 * 7 * 86400000)),
    maxPlayers: 36, logoColor: 'pink',
  });
  check('league B created', createdB.status === 201, JSON.stringify(createdB.data));
  const leagueB = createdB.data.league;

  // Logo color edit.
  const logoPatch = await adminPatch(`/api/admin/leagues/${leagueA.id}`, { logoColor: 'pink' });
  check('logo color patch ok', logoPatch.status === 200, JSON.stringify(logoPatch.data));
  const detailA2 = await get(`/api/leagues/${leagueA.id}`);
  check('logo color persisted', detailA2.data.league.logo_color === 'pink');
  await adminPatch(`/api/admin/leagues/${leagueA.id}`, { logoColor: 'black-yellow' });

  // ---- join flow + registrations ----
  console.log('== join flow + registrations ==');
  const regBad = await post(`/api/leagues/${leagueA.id}/registrations`, {
    name: 'Bob Brown', duprRating: 3.2, membershipType: 'member',
    email: 'bob@example.test', phone: '555-0201',
  });
  check('registration without DUPR rejected', regBad.status === 400, JSON.stringify(regBad.data));
  const reg1 = await post(`/api/leagues/${leagueA.id}/registrations`, {
    name: 'Bob Brown', duprId: 'B2C3D4', duprRating: 3.2, membershipType: 'non-member',
    email: 'bob@example.test', phone: '555-0201',
  });
  check('registration submitted (non-member $50)', reg1.status === 201 && reg1.data.registration.membership_type === 'non-member', JSON.stringify(reg1.data));
  check('registration starts pending', reg1.data.registration.status === 'pending');
  check('duplicate pending registration rejected', (await post(`/api/leagues/${leagueA.id}/registrations`, {
    name: 'bob brown', duprId: 'B2C3D4', duprRating: 3.2, membershipType: 'member',
    email: 'bob@example.test', phone: '555-0201',
  })).status === 409);
  const reg2 = await post(`/api/leagues/${leagueA.id}/registrations`, {
    name: 'Carol Clark', duprId: 'C3D4E5', duprRating: 3.8, membershipType: 'member',
    email: 'carol@example.test', phone: '555-0202',
  });
  check('second registration (member $20)', reg2.status === 201 && reg2.data.registration.membership_type === 'member');

  // Closed registration rejects new sign-ups.
  await adminPost(`/api/admin/leagues/${leagueA.id}/settings`, { registrationOpen: false });
  check('registration rejected while closed', (await post(`/api/leagues/${leagueA.id}/registrations`, {
    name: 'Dave Davis', duprId: 'D4E5F6', duprRating: 3.1, membershipType: 'member',
    email: 'dave@example.test', phone: '555-0203',
  })).status === 409);
  await adminPost(`/api/admin/leagues/${leagueA.id}/settings`, { registrationOpen: true });

  const regs = await adminGet(`/api/admin/leagues/${leagueA.id}/registrations`);
  check('admin registrations list (2)', regs.data.registrations.length === 2, JSON.stringify(regs.data));
  const bobReg = regs.data.registrations.find((r) => r.name === 'Bob Brown');
  const confirm = await adminPost(`/api/admin/registrations/${bobReg.id}/status`, { status: 'confirmed' });
  check('registration confirm ok', confirm.status === 200);
  const waive = await adminPost(`/api/admin/registrations/${bobReg.id}/waive`, { feeWaived: true });
  check('registration fee waive ok', waive.status === 200);
  const add = await adminPost(`/api/admin/registrations/${bobReg.id}/status`, { status: 'added' });
  check('registration add-to-league ok', add.status === 200);
  const rosterA = await get(`/api/leagues/${leagueA.id}/roster`);
  const bobRow = rosterA.data.roster.find((p) => p.name === 'Bob Brown');
  check('Bob is on the roster with DUPR carried over', bobRow && bobRow.dupr_id === 'B2C3D4' && Number(bobRow.dupr_rating) === 3.2, JSON.stringify(bobRow));
  check('fee waiver followed Bob onto his player record', bobRow && bobRow.fee_waived === true, JSON.stringify(bobRow));
  const regs2 = await adminGet(`/api/admin/leagues/${leagueA.id}/registrations`);
  check('registration status is added', regs2.data.registrations.find((r) => r.id === bobReg.id).status === 'added');
  const carolReg = regs2.data.registrations.find((r) => r.name === 'Carol Clark');
  const del = await adminDel(`/api/admin/registrations/${carolReg.id}`);
  check('registration delete ok', del.status === 200);
  check('registration gone', (await adminGet(`/api/admin/leagues/${leagueA.id}/registrations`)).data.registrations.length === 1);

  // ---- admin autocomplete search ----
  console.log('== admin autocomplete ==');
  const search = await adminGet(`/api/admin/people/search?q=bob&leagueId=${leagueA.id}`);
  const bobHit = search.data.results.find((r) => r.name === 'Bob Brown');
  check('autocomplete finds Bob', Boolean(bobHit), JSON.stringify(search.data));
  check('autocomplete flags Bob already in league A', bobHit && bobHit.inLeague === true, JSON.stringify(bobHit));
  const searchA = await adminGet(`/api/admin/people/search?q=alic&leagueId=${leagueA.id}`);
  const aliceHit = searchA.data.results.find((r) => r.name === 'Alice Adams');
  check('autocomplete finds member Alice (not in league)', aliceHit && aliceHit.inLeague === false, JSON.stringify(aliceHit));

  // ---- multi-league: same person in two leagues ----
  console.log('== multi-league ==');
  const addAliceA = await adminPost(`/api/admin/leagues/${leagueA.id}/players`, { personId: alice.person_id });
  check('Alice added to league A by personId', addAliceA.status === 201, JSON.stringify(addAliceA.data));
  const addAliceB = await adminPost(`/api/admin/leagues/${leagueB.id}/players`, { personId: alice.person_id });
  check('Alice added to league B (same person)', addAliceB.status === 201 && addAliceB.data.person.id === alice.person_id, JSON.stringify(addAliceB.data));
  const aliceLeagues = await get(`/api/people/${alice.person_id}/leagues`);
  check('Alice is in 2 leagues', aliceLeagues.data.leagues.length === 2, JSON.stringify(aliceLeagues.data.leagues));
  check('duplicate add to same league rejected', (await adminPost(`/api/admin/leagues/${leagueA.id}/players`, { personId: alice.person_id })).status === 409);
  // Remove from one league only.
  const rm = await adminDel(`/api/admin/leagues/${leagueB.id}/players/${alice.person_id}`);
  check('remove Alice from league B only', rm.status === 200);
  const aliceLeagues2 = await get(`/api/people/${alice.person_id}/leagues`);
  check('Alice still in league A only', aliceLeagues2.data.leagues.length === 1 && aliceLeagues2.data.leagues[0].id === leagueA.id);
  await adminPost(`/api/admin/leagues/${leagueB.id}/players`, { personId: alice.person_id });
  check('Alice re-added to league B', (await get(`/api/people/${alice.person_id}/leagues`)).data.leagues.length === 2);

  // ---- player fee waiver on the roster row ----
  const rosterA2 = await get(`/api/leagues/${leagueA.id}/roster`);
  const aliceRow = rosterA2.data.roster.find((p) => p.name === 'Alice Adams');
  const waivePlayer = await adminPatch(`/api/admin/leagues/${leagueA.id}/players/${alice.person_id}`, { feeWaived: true });
  check('player-row fee waive ok', waivePlayer.status === 200);
  const rosterA3 = await get(`/api/leagues/${leagueA.id}/roster`);
  check('Alice fee waived on roster', rosterA3.data.roster.find((p) => p.name === 'Alice Adams').fee_waived === true);
  // Waiving in league A must not touch league B.
  const rosterB = await get(`/api/leagues/${leagueB.id}/roster`);
  check('Alice fee NOT waived in league B (per-league)', rosterB.data.roster.find((p) => p.name === 'Alice Adams').fee_waived === false);

  // ---- dashboard + profile ----
  console.log('== dashboard + profile ==');
  const prof = await get(`/api/people/${alice.person_id}/profile`);
  check('profile merges member + person', prof.data.member && prof.data.member.email === 'alice@example.test' && prof.data.person.dupr_id === 'A1B2C3', JSON.stringify(prof.data));
  check('profile lists 2 leagues', prof.data.leagues.length === 2);
  const profPatch = await patch(`/api/people/${alice.person_id}/profile`, {
    name: 'Alice Changed', email: 'alice2@example.test', resides: 'Moultrie, GA',
  });
  check('profile patch ok', profPatch.status === 200, JSON.stringify(profPatch.data));
  const prof2 = await get(`/api/people/${alice.person_id}/profile`);
  check('name is NOT editable via profile', prof2.data.person.name === 'Alice Adams', JSON.stringify(prof2.data.person));
  check('profile email updated', prof2.data.member.email === 'alice2@example.test');
  const dash = await get(`/api/people/${alice.person_id}/dashboard`);
  check('dashboard lists 2 leagues', dash.data.leagues.length === 2, JSON.stringify(dash.data.leagues.map((l) => l.league.name)));
  check('dashboard standings row present', dash.data.leagues.every((l) => l.standings && l.standings.rank >= 1));
  check('dashboard games empty before any night', dash.data.leagues.every((l) => l.games.length === 0));
  check('unknown person 404', (await get('/api/people/999999/leagues')).status === 404);
  check('unknown person dashboard 404', (await get('/api/people/999999/dashboard')).status === 404);

  // Roster player without a member record gets one created on profile save.
  const eve = await adminPost(`/api/admin/leagues/${leagueA.id}/players`, {
    name: 'Eve Evans', duprId: 'E5F6G7', duprRating: 3.4,
  });
  const eveId = eve.data.person.id;
  check('Eve has no member record yet', (await get(`/api/people/${eveId}/profile`)).data.member === null);
  await patch(`/api/people/${eveId}/profile`, { email: 'eve@example.test', phone: '555-0205' });
  const eveProf = await get(`/api/people/${eveId}/profile`);
  check('profile save created Eve\'s member record', eveProf.data.member && eveProf.data.member.email === 'eve@example.test');

  // ---- a played night: dashboard games ----
  console.log('== played night -> dashboard games ==');
  const lastSat = prevWeekday(6);
  const createdC = await adminPost('/api/admin/leagues', {
    name: 'Past League', type: 'Advanced', skill: '3.5-4.49',
    format: 'Coed Doubles', day: 'Saturday', time: '18:30',
    season: 'Fall 2026', startDate: isoDate(lastSat),
    stopDate: isoDate(new Date(lastSat.getTime() + 7 * 7 * 86400000)),
    maxPlayers: 36, logoColor: 'black-yellow',
  });
  const leagueC = createdC.data.league;
  const detailC = await get(`/api/leagues/${leagueC.id}`);
  const cSess = detailC.data.sessions[0];
  check('league C session 1 is revealed (deadline passed)', detailC.data.currentSessionId === cSess.id);
  const names4 = ['Fay Fox', 'Gus Green', 'Hal Hill', 'Ivy Iris'];
  const ids4 = [];
  for (const n of names4) {
    const r = await adminPost(`/api/admin/leagues/${leagueC.id}/players`, { name: n, duprId: `D${n[0]}`, duprRating: 3.0 });
    ids4.push(r.data.person.id);
  }
  for (const pid of ids4) {
    const w = await adminPost(`/api/admin/leagues/${leagueC.id}/sessions/${cSess.id}/opt-in`, { personId: pid });
    if (w.status !== 200) check(`walk-in ${pid}`, false, JSON.stringify(w.data));
  }
  const built = await adminPost(`/api/admin/leagues/${leagueC.id}/sessions/${cSess.id}/build`, {});
  check('4-player build ok', built.status === 200, JSON.stringify(built.data));
  const sessDetail = await adminGet(`/api/leagues/${leagueC.id}/sessions/${cSess.id}`);
  const games = sessDetail.data.matches.filter((m) => m.kind === 'match');
  check('4 players -> 3 games to 20', games.length === 3 && games.every((m) => m.target_score === 20), `got ${games.length}`);
  for (const [i, g] of games.entries()) {
    const s = await adminPost(`/api/leagues/${leagueC.id}/sessions/${cSess.id}/matches/${g.id}/score`, { score1: 20, score2: 13 + i });
    if (s.status !== 200) check(`score game ${g.id}`, false, JSON.stringify(s.data));
  }
  check('all 3 games scored', true);
  const fin = await adminPost(`/api/admin/leagues/${leagueC.id}/sessions/${cSess.id}/finish`, {});
  check('finish league C session 1', fin.status === 200, JSON.stringify(fin.data));
  const fayDash = await get(`/api/people/${ids4[0]}/dashboard`);
  const fayLeague = fayDash.data.leagues.find((l) => l.league.id === leagueC.id);
  check('Fay dashboard: 3 games played', fayLeague && fayLeague.games.length === 3, JSON.stringify(fayLeague && fayLeague.games));
  check('Fay games have partner + opponents + result', fayLeague && fayLeague.games.every((g) => g.partner && g.opponents.length === 2 && (g.result === 'W' || g.result === 'L')));
  check('Fay standings rank present', fayLeague && fayLeague.standings && fayLeague.standings.rank >= 1);
  const stC = await get(`/api/leagues/${leagueC.id}/standings`);
  check('standings show 60 possible per player', stC.data.standings.every((s) => s.possible === 60), JSON.stringify(stC.data.standings));

  // ---- announce ----
  console.log('== announce ==');
  const ann = await adminGet(`/api/admin/leagues/${leagueA.id}/announce`);
  check('announce returns league + 8 sessions', ann.status === 200 && ann.data.sessions.length === 8, JSON.stringify(ann.data.league && ann.data.league.name));
  check('announce recipient list is members', ann.data.memberCount >= 2 && ann.data.members.some((m) => m.name === 'Alice Adams'));
  check('announce counts with-email/with-phone', ann.data.withEmail >= 2 && ann.data.withPhone >= 2, JSON.stringify({ e: ann.data.withEmail, p: ann.data.withPhone }));
  check('announce members carry email + phone', ann.data.members.every((m) => m.email && m.phone));

  // ---- SPA shell ----
  console.log('== spa shell ==');
  const shell = await fetch(base + '/');
  const html = await shell.text();
  check('SPA shell serves', shell.status === 200 && html.includes('<main id="app">') && html.includes('/app.js'));

  // ---- member delete ----
  console.log('== member delete ==');
  const memDel = await adminDel(`/api/admin/members/${aliceAdmin.id}`);
  check('admin member delete ok', memDel.status === 200);
  check('Alice gone from admin members', !(await adminGet('/api/admin/members')).data.members.some((m) => m.name === 'Alice Adams'));
  check('Alice person record still exists (roster untouched)', (await get(`/api/people/${alice.person_id}/profile`)).status === 200);

  console.log(failures === 0 ? '\nALL PHASE 2 TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
  if (server) server.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('TEST CRASH', e);
  if (server) server.close();
  process.exit(1);
});

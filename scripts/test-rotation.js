'use strict';
// Headless tests for the rotating-partners round robin engine
// (server/lib/rotation.js). Run: node scripts/test-rotation.js
// No DB needed — the engine is pure.
const {
  ROUNDS,
  TARGET,
  MAX_ROTATORS,
  mulberry32,
  buildRotationSchedule,
  computePlayerStandings,
} = require('../server/lib/rotation');

let failures = 0;
function check(cond, label) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  }
}

// --- helpers ---------------------------------------------------------------
function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
// Partners each player has had across the whole schedule.
function partnerCounts(matches) {
  const seen = new Map(); // player -> Map(partner -> count)
  const note = (a, b) => {
    if (!seen.has(a)) seen.set(a, new Map());
    const m = seen.get(a);
    m.set(b, (m.get(b) || 0) + 1);
  };
  for (const m of matches) {
    note(m.p1Id, m.p2Id);
    note(m.p2Id, m.p1Id);
    note(m.p3Id, m.p4Id);
    note(m.p4Id, m.p3Id);
  }
  return seen;
}
// Individual cross-pairings already faced (opponent repeats).
function oppRepeatCount(matches) {
  const faced = new Set();
  let repeats = 0;
  for (const m of matches) {
    for (const x of [m.p1Id, m.p2Id]) {
      for (const y of [m.p3Id, m.p4Id]) {
        const k = pairKey(x, y);
        if (faced.has(k)) repeats += 1;
        faced.add(k);
      }
    }
  }
  return repeats;
}
function repeatPartnerPairs(matches) {
  const seen = new Set();
  let repeats = 0;
  for (const m of matches) {
    for (const k of [pairKey(m.p1Id, m.p2Id), pairKey(m.p3Id, m.p4Id)]) {
      if (seen.has(k)) repeats += 1;
      seen.add(k);
    }
  }
  return repeats;
}

// --- mulberry32 ------------------------------------------------------------
{
  const r1 = mulberry32(123);
  const r2 = mulberry32(123);
  check(r1() === r2() && r1() === r2(), 'mulberry32: same seed, same sequence');
  const r3 = mulberry32(124);
  check(r3() !== mulberry32(123)(), 'mulberry32: different seed, different first value');
}

// --- exact preview default schedule ----------------------------------------
// The approved preview's default: 12 players in this order, Brad main,
// Mika + Wilson rotating. The rendered schedule (inspection
// 0a082dd8-ae7f-41a6-a484-6c9de76cc367):
const PREVIEW_PLAYERS = [
  'Brad', 'Mika', 'Oscar', 'Sharon', 'Bradley', 'Nathan',
  'Jason', 'Jenn', 'Victoria', 'Wilson', 'Haley', 'David',
];
const PREVIEW_SCHEDULE = [
  // round, court, p1, p2, p3, p4
  [1, 1, 'Bradley', 'Haley', 'Brad', 'Mika'],
  [1, 2, 'Jason', 'Jenn', 'David', 'Victoria'],
  [1, 3, 'Oscar', 'Sharon', 'Wilson', 'Nathan'],
  [2, 1, 'Jenn', 'Haley', 'Bradley', 'Nathan'],
  [2, 2, 'David', 'Mika', 'Victoria', 'Oscar'],
  [2, 3, 'Sharon', 'Jason', 'Brad', 'Wilson'],
  [3, 1, 'Jenn', 'David', 'Brad', 'Mika'],
  [3, 2, 'Haley', 'Oscar', 'Sharon', 'Victoria'],
  [3, 3, 'Bradley', 'Wilson', 'Jason', 'Nathan'],
  [4, 1, 'Sharon', 'Bradley', 'Nathan', 'David'],
  [4, 2, 'Haley', 'Victoria', 'Brad', 'Wilson'],
  [4, 3, 'Mika', 'Jason', 'Oscar', 'Jenn'],
  [5, 1, 'Nathan', 'Oscar', 'Brad', 'Mika'],
  [5, 2, 'Haley', 'Sharon', 'Victoria', 'Jason'],
  [5, 3, 'David', 'Bradley', 'Jenn', 'Wilson'],
];
{
  const { matches, byes } = buildRotationSchedule(PREVIEW_PLAYERS, {
    mainId: 'Brad',
    rotatorIds: ['Mika', 'Wilson'],
  });
  check(byes.length === 0, 'preview default: no byes');
  check(matches.length === 15, `preview default: 15 matches (got ${matches.length})`);
  let exact = matches.length === PREVIEW_SCHEDULE.length;
  if (exact) {
    for (let i = 0; i < PREVIEW_SCHEDULE.length; i++) {
      const [r, c, p1, p2, p3, p4] = PREVIEW_SCHEDULE[i];
      const m = matches[i];
      if (
        m.round !== r || m.court !== c ||
        m.p1Id !== p1 || m.p2Id !== p2 || m.p3Id !== p3 || m.p4Id !== p4
      ) {
        exact = false;
        console.error(
          `  exact mismatch at match ${i + 1}: expected R${r}C${c} ${p1}&${p2} vs ${p3}&${p4}, ` +
          `got R${m.round}C${m.court} ${m.p1Id}&${m.p2Id} vs ${m.p3Id}&${m.p4Id}`
        );
        break;
      }
    }
  }
  check(exact, 'preview default: schedule reproduces the captured R1–R5 exactly');
}

// --- property tests: shape, byes, main rotation, no repeat partners --------
function checkSchedule(n, opts, label) {
  const players = Array.from({ length: n }, (_, i) => i);
  const { matches, byes } = buildRotationSchedule(players, opts);
  // A doubles round needs a multiple of 4 players: matches per round is
  // floor(n/4) and n%4 sit out each round (0 for 12, 1 for 5/9, 2 for
  // 6/10, 3 for 7/11).
  const perRound = Math.floor(n / 4);
  const byesPerRound = n % 4;
  check(
    matches.length === ROUNDS * perRound,
    `${label}: ${matches.length} matches, expected ${ROUNDS * perRound}`
  );
  check(
    matches.every((m) => m.target === TARGET),
    `${label}: every match is to ${TARGET}`
  );
  for (let r = 1; r <= ROUNDS; r++) {
    const rm = matches.filter((m) => m.round === r);
    check(rm.length === perRound, `${label} R${r}: ${perRound} matches (got ${rm.length})`);
    const seen = new Set();
    for (const m of rm) {
      for (const p of [m.p1Id, m.p2Id, m.p3Id, m.p4Id]) {
        check(!seen.has(p), `${label} R${r}: player ${p} plays at most once`);
        seen.add(p);
      }
      const courts = rm.map((x) => x.court);
      check(
        JSON.stringify([...courts].sort((a, b) => a - b)) === JSON.stringify(courts) &&
          courts.every((c, i) => c === i + 1),
        `${label} R${r}: courts are 1..${perRound} in order`
      );
    }
    if (n % 4 === 0) {
      check(seen.size === n, `${label} R${r}: all ${n} play (no byes)`);
    } else {
      check(seen.size === n - byesPerRound, `${label} R${r}: ${n - byesPerRound} play, ${byesPerRound} sit out`);
    }
  }
  if (byesPerRound > 0) {
    check(
      byes.length === ROUNDS * byesPerRound,
      `${label}: ${ROUNDS * byesPerRound} bye slots over ${ROUNDS} rounds (got ${byes.length})`
    );
    const perRoundByes = {};
    for (let r = 1; r <= ROUNDS; r++) {
      const rb = byes.filter((b) => b.round === r);
      perRoundByes[r] = rb.length;
    }
    check(
      Object.values(perRoundByes).every((c) => c === byesPerRound),
      `${label}: exactly ${byesPerRound} bye(s) per round (got ${JSON.stringify(perRoundByes)})`
    );
    const sitCounts = {};
    for (const b of byes) sitCounts[b.playerId] = (sitCounts[b.playerId] || 0) + 1;
    const maxSits = Math.max(...Object.values(sitCounts));
    check(maxSits <= 3, `${label}: bye rotates, nobody sits more than 3 times (max ${maxSits})`);
    for (const b of byes) {
      const playing = matches.some(
        (m) => m.round === b.round && [m.p1Id, m.p2Id, m.p3Id, m.p4Id].includes(b.playerId)
      );
      check(!playing, `${label}: the bye player has no match that round`);
    }
  } else {
    check(byes.length === 0, `${label}: no byes for a count divisible by 4`);
  }
  // Main player's partner cycles the rotators in pick order.
  if (opts.mainId != null && (opts.rotatorIds || []).length) {
    const rots = opts.rotatorIds.filter((id) => players.includes(id));
    for (let r = 1; r <= ROUNDS; r++) {
      const want = rots[(r - 1) % rots.length];
      const mainMatch = matches.find(
        (m) =>
          m.round === r &&
          [m.p1Id, m.p2Id, m.p3Id, m.p4Id].includes(opts.mainId)
      );
      check(!!mainMatch, `${label} R${r}: main player has a match`);
      const partner =
        mainMatch.p1Id === opts.mainId
          ? mainMatch.p2Id
          : mainMatch.p2Id === opts.mainId
            ? mainMatch.p1Id
            : mainMatch.p3Id === opts.mainId
              ? mainMatch.p4Id
              : mainMatch.p3Id;
      check(
        partner === want,
        `${label} R${r}: main partners ${want} (got ${partner})`
      );
    }
  }
  // Repeat partners: the main's partnerships repeat by design (5 rounds,
  // 1–5 rotators — e.g. Brad–Mika three times with two rotators), and tiny
  // nights force repeats (at n=4 the two field players must pair together
  // every round). So count repeats only among pairs that don't involve
  // the main player, and bound them loosely — the search minimizes them,
  // and a broken search would repeat whole rounds (~10+ for n=12).
  const nonMainRepeats = (() => {
    const seen = new Set();
    let reps = 0;
    for (const m of matches) {
      for (const k of [pairKey(m.p1Id, m.p2Id), pairKey(m.p3Id, m.p4Id)]) {
        const [a, b] = k.split('|').map(Number);
        if (opts.mainId != null && (a === opts.mainId || b === opts.mainId)) continue;
        if (seen.has(k)) reps += 1;
        seen.add(k);
      }
    }
    return reps;
  })();
  if (n >= 8) {
    check(nonMainRepeats <= 2, `${label}: non-main repeat partners stay low (got ${nonMainRepeats})`);
  } else if (n >= 5) {
    check(nonMainRepeats <= 3, `${label}: non-main repeat partners stay low (got ${nonMainRepeats})`);
  } else {
    check(repeatPartnerPairs(matches) > 0, `${label}: 4 players over 5 rounds must repeat partners`);
    if (opts.mainId == null) {
      const early = matches.filter((m) => m.round <= 3);
      check(repeatPartnerPairs(early) === 0, `${label}: rounds 1–3 repeat-free`);
    }
  }
  // Opponent repeats stay low — the search minimizes them (a random
  // matching would repeat roughly twice as often).
  const opp = oppRepeatCount(matches);
  check(opp <= 20, `${label}: opponent repeats stay low (got ${opp})`);
  // Deterministic: same inputs rebuild the same schedule.
  const again = buildRotationSchedule(players, opts);
  check(
    JSON.stringify(again.matches) === JSON.stringify(matches) &&
      JSON.stringify(again.byes) === JSON.stringify(byes),
    `${label}: deterministic rebuild`
  );
  return { matches, byes };
}

checkSchedule(12, { mainId: 0, rotatorIds: [1, 9] }, 'n=12 main+2 rotators');
checkSchedule(12, {}, 'n=12 no main');
checkSchedule(12, { mainId: 3, rotatorIds: [0] }, 'n=12 main+1 rotator');
checkSchedule(12, { mainId: 5, rotatorIds: [0, 2, 4, 7, 11] }, 'n=12 main+5 rotators');
checkSchedule(8, { mainId: 0, rotatorIds: [1, 2] }, 'n=8 main+2 rotators');
checkSchedule(8, {}, 'n=8 no main');
checkSchedule(6, { mainId: 0, rotatorIds: [3] }, 'n=6 main+1 rotator');
checkSchedule(6, {}, 'n=6 no main');
checkSchedule(5, { mainId: 0, rotatorIds: [1, 2] }, 'n=5 (odd) main+2 rotators');
checkSchedule(5, {}, 'n=5 (odd) no main');
checkSchedule(7, { mainId: 2, rotatorIds: [0, 5] }, 'n=7 (odd) main+2 rotators');
checkSchedule(11, {}, 'n=11 (odd) no main');
checkSchedule(16, { mainId: 0, rotatorIds: [1, 2] }, 'n=16 main+2 rotators');
checkSchedule(20, {}, 'n=20 no main');
checkSchedule(24, { mainId: 0, rotatorIds: [1, 2, 3] }, 'n=24 main+3 rotators');
checkSchedule(4, {}, 'n=4 no main');
checkSchedule(4, { mainId: 0, rotatorIds: [1] }, 'n=4 main+1 rotator');

// Main / rotators not among the players are ignored.
{
  const { matches } = buildRotationSchedule([0, 1, 2, 3, 4, 5, 6, 7], {
    mainId: 99,
    rotatorIds: [88, 77],
  });
  check(matches.length === 10, 'unknown main/rotators ignored, free rotation (10 matches)');
  const { matches: m2 } = buildRotationSchedule([0, 1, 2, 3, 4, 5, 6, 7], {
    mainId: 0,
    rotatorIds: [1, 99],
  });
  const r1Main = m2.find(
    (m) => m.round === 1 && [m.p1Id, m.p2Id, m.p3Id, m.p4Id].includes(0)
  );
  check(!!r1Main, 'main with one valid rotator still plays round 1');
}

// Fewer than 4 players builds nothing.
check(
  buildRotationSchedule([0, 1, 2], {}).matches.length === 0,
  '3 players builds nothing'
);
check(
  buildRotationSchedule([], {}).matches.length === 0,
  '0 players builds nothing'
);

// --- per-player standings ---------------------------------------------------
const P = (id, name) => ({ id, name });
{
  // Scripted 4-player night: every player has a different profile under
  // the three winner rules (ep winner B, points winner B, wins winner A;
  // ep and points disagree on 4th/5th).
  const players = [P(0, 'A'), P(1, 'B'), P(2, 'C'), P(3, 'D'), P(4, 'E')];
  const ms = [
    { p1_id: 0, p2_id: 1, p3_id: 2, p4_id: 3, score1: 11, score2: 6 },
    { p1_id: 0, p2_id: 2, p3_id: 1, p4_id: 4, score1: 11, score2: 8 },
    { p1_id: 0, p2_id: 3, p3_id: 1, p4_id: 2, score1: 11, score2: 10 },
    { p1_id: 0, p2_id: 4, p3_id: 2, p4_id: 3, score1: 11, score2: 4 },
    { p1_id: 1, p2_id: 2, p3_id: 3, p4_id: 4, score1: 11, score2: 9 },
    { p1_id: 1, p2_id: 3, p3_id: 0, p4_id: 4, score1: 11, score2: 5 },
  ];
  const byId = (rows) => new Map(rows.map((r) => [r.player.id, r]));
  const ep = byId(computePlayerStandings(players, ms, 'ep'));
  check(ep.get(1).earned === 51 && ep.get(1).ep === 51 / 55, 'standings: B 51 earned, ep 51/55');
  check(ep.get(0).earned === 49 && ep.get(0).w === 4, 'standings: A 49 earned, 4W');
  check(ep.get(4).played === 4 && ep.get(4).possible === 44, 'standings: E played 4 (one bye), possible 44');
  check(
    JSON.stringify(computePlayerStandings(players, ms, 'ep').map((r) => r.player.name)) ===
      JSON.stringify(['B', 'A', 'C', 'E', 'D']),
    `standings ep order B,A,C,E,D (got ${computePlayerStandings(players, ms, 'ep').map((r) => r.player.name).join(',')})`
  );
  check(
    JSON.stringify(computePlayerStandings(players, ms, 'points').map((r) => r.player.name)) ===
      JSON.stringify(['B', 'A', 'C', 'D', 'E']),
    `standings points order B,A,C,D,E (got ${computePlayerStandings(players, ms, 'points').map((r) => r.player.name).join(',')})`
  );
  check(
    JSON.stringify(computePlayerStandings(players, ms, 'wins').map((r) => r.player.name)) ===
      JSON.stringify(['A', 'B', 'D', 'C', 'E']),
    `standings wins order A,B,D,C,E (got ${computePlayerStandings(players, ms, 'wins').map((r) => r.player.name).join(',')})`
  );
  // C and D tie at 2W under 'wins': their head-to-head is 1–1 (D won
  // m3 11–10, C won m5 11–9 — m1/m4 they partnered), so point
  // differential decides: D −7 beats C −8.
  {
    const winsRows = computePlayerStandings(players, ms, 'wins');
    const byName = new Map(winsRows.map((r) => [r.player.name, r]));
    check(byName.get('D').reason === 'Better point difference', `wins: D reason is PD (got ${byName.get('D').reason})`);
    check(byName.get('C').reason === 'Worse point difference', `wins: C reason is PD (got ${byName.get('C').reason})`);
    check(byName.get('A').reason == null && byName.get('B').reason == null, 'wins: A and B needed no tiebreaker');
  }
  // Unscored matches are ignored; empty nights are all zeros with null ep.
  const partial = computePlayerStandings(players, [
    { p1_id: 0, p2_id: 1, p3_id: 2, p4_id: 3, score1: null, score2: null },
  ]);
  check(partial.every((r) => r.played === 0 && r.ep == null), 'standings: unscored matches ignored');
  // Nobody has played anything, so the chain runs out immediately: every
  // player genuinely ties for 1st.
  check(partial.every((r) => r.rank === 1 && r.tied && r.reason == null), 'standings: unscored night is a genuine tie for 1st');
  const empty = computePlayerStandings(players, []);
  check(empty.every((r) => r.w === 0 && r.played === 0 && r.ep == null), 'standings: empty night is all zeros');
  check(empty.every((r) => r.rank === 1 && r.tied && r.reason == null), 'standings: empty night is a genuine tie for 1st');
}

// --- tiebreaker chain ------------------------------------------------------
// The approved chain: winner rule, then most wins, head-to-head wins vs
// the tied players (opposite sides only), point differential,
// head-to-head point differential, fewest points against, then a genuine
// tie that shares the rank.

// Live night, event 8 (Tuesday Night, Fri Nov 27 — the first rotating
// night on the app): winner rule 'points'. The top three all banked 51
// points at E/P 92.7%, and the old code listed them in signup order
// (wilson on top). The chain must rank Frank 1st (he beat wilson 11–7 in
// Round 1, their only meeting as opponents), wilson 2nd, Pat 3rd (fewer
// wins, worse PD +10 vs +12). Players/matches are the live rows, verbatim.
const E8_PLAYERS = [
  P(1, 'Bradley'), P(2, 'wilson'), P(3, 'Brad'), P(4, 'Mika'),
  P(5, 'Nathan'), P(6, 'Jason'), P(7, 'Jenn'), P(8, 'Pat'),
  P(9, 'Jack'), P(10, 'Brittney'), P(11, 'Taylor'), P(12, 'Frank'),
];
const E8_MATCHES = [
  { p1_id: 4, p2_id: 5, p3_id: 10, p4_id: 7, score1: 11, score2: 8 },
  { p1_id: 1, p2_id: 12, p3_id: 3, p4_id: 2, score1: 11, score2: 7 },
  { p1_id: 6, p2_id: 9, p3_id: 8, p4_id: 11, score1: 11, score2: 8 },
  { p1_id: 5, p2_id: 2, p3_id: 3, p4_id: 4, score1: 11, score2: 9 },
  { p1_id: 6, p2_id: 12, p3_id: 9, p4_id: 1, score1: 7, score2: 11 },
  { p1_id: 10, p2_id: 11, p3_id: 7, p4_id: 8, score1: 5, score2: 11 },
  { p1_id: 1, p2_id: 10, p3_id: 8, p4_id: 5, score1: 7, score2: 11 },
  { p1_id: 12, p2_id: 9, p3_id: 4, p4_id: 6, score1: 11, score2: 4 },
  { p1_id: 7, p2_id: 11, p3_id: 3, p4_id: 2, score1: 6, score2: 11 },
  { p1_id: 10, p2_id: 8, p3_id: 2, p4_id: 12, score1: 10, score2: 11 },
  { p1_id: 6, p2_id: 1, p3_id: 3, p4_id: 4, score1: 11, score2: 8 },
  { p1_id: 5, p2_id: 7, p3_id: 9, p4_id: 11, score1: 11, score2: 7 },
  { p1_id: 1, p2_id: 5, p3_id: 7, p4_id: 6, score1: 3, score2: 11 },
  { p1_id: 11, p2_id: 4, p3_id: 8, p4_id: 12, score1: 7, score2: 11 },
  { p1_id: 9, p2_id: 10, p3_id: 3, p4_id: 2, score1: 3, score2: 11 },
];
{
  const rows = computePlayerStandings(E8_PLAYERS, E8_MATCHES, 'points');
  const names = rows.map((r) => r.player.name);
  check(
    JSON.stringify(names) === JSON.stringify(['Frank', 'wilson', 'Pat', 'Nathan', 'Jenn', 'Brad', 'Jason', 'Jack', 'Bradley', 'Mika', 'Brittney', 'Taylor']),
    `event 8 points order (got ${names.join(',')})`
  );
  const byName = new Map(rows.map((r) => [r.player.name, r]));
  check(byName.get('Frank').rank === 1 && byName.get('wilson').rank === 2 && byName.get('Pat').rank === 3, 'event 8 points: Frank 1st, wilson 2nd, Pat 3rd');
  check(byName.get('Frank').reason === 'Beat wilson head-to-head', `event 8: Frank reason (got ${byName.get('Frank').reason})`);
  check(byName.get('wilson').reason === 'Lost to Frank head-to-head', `event 8: wilson reason (got ${byName.get('wilson').reason})`);
  check(byName.get('Pat').reason === 'Fewer wins', `event 8: Pat reason (got ${byName.get('Pat').reason})`);
  check(byName.get('Nathan').reason === 'More wins', `event 8: Nathan reason (got ${byName.get('Nathan').reason})`);
  check(byName.get('Jenn').reason === 'Fewer wins', `event 8: Jenn reason (got ${byName.get('Jenn').reason})`);
  // Bradley and Jack tie at 43 pts and 3W and never faced each other
  // (they partnered in R2) — point differential decides: Jack +2 beats
  // Bradley −1.
  check(byName.get('Jack').reason === 'Better point difference', `event 8: Jack reason (got ${byName.get('Jack').reason})`);
  check(byName.get('Bradley').reason === 'Worse point difference', `event 8: Bradley reason (got ${byName.get('Bradley').reason})`);
  check(byName.get('Brad').reason == null && byName.get('Jason').reason == null && byName.get('Mika').reason == null, 'event 8: Brad, Jason, Mika needed no tiebreaker');
  // The bottom two banked identical lines (33 pts, 0W–5L, 55 against) and
  // never faced each other — a genuine tie that shares 11th.
  check(byName.get('Brittney').rank === 11 && byName.get('Taylor').rank === 11, 'event 8: Brittney and Taylor share 11th');
  check(byName.get('Brittney').tied && byName.get('Taylor').tied, 'event 8: Brittney and Taylor are marked tied');
  check(byName.get('Brittney').reason == null && byName.get('Taylor').reason == null, 'event 8: tied players carry no reason');
  check(rows.filter((r) => !r.tied).every((r) => r.reason !== undefined), 'event 8: every row carries a reason field');
  // Everyone played 5 games, so E/P is the same ranking as points here.
  const epRows = computePlayerStandings(E8_PLAYERS, E8_MATCHES, 'ep');
  check(
    JSON.stringify(epRows.map((r) => r.player.name)) === JSON.stringify(names) &&
      JSON.stringify(epRows.map((r) => r.rank)) === JSON.stringify(rows.map((r) => r.rank)),
    `event 8 ep order matches points order (got ${epRows.map((r) => r.player.name).join(',')})`
  );
  // Wins rule: 4W group {wilson, Frank, Nathan} — Frank first on the
  // head-to-head over wilson, then wilson over Nathan on PD (+12 vs +5).
  // 3W group {Pat, Jenn, Jason, Bradley, Jack} — head-to-head mini-table
  // is Jack 3, Jenn 2, Jason 2, Pat 1, Bradley 1: Jack first, then Jenn
  // over Jason on PD (+10 vs +3), then Pat over Bradley on PD (+10 vs
  // −1). Jenn beat Jack directly once but loses the mini-table on
  // aggregate, so her reason stays generic.
  const winsRows = computePlayerStandings(E8_PLAYERS, E8_MATCHES, 'wins');
  check(
    JSON.stringify(winsRows.map((r) => r.player.name)) === JSON.stringify(['Frank', 'wilson', 'Nathan', 'Jack', 'Jenn', 'Jason', 'Pat', 'Bradley', 'Brad', 'Mika', 'Brittney', 'Taylor']),
    `event 8 wins order (got ${winsRows.map((r) => r.player.name).join(',')})`
  );
  const winsByName = new Map(winsRows.map((r) => [r.player.name, r]));
  check(winsByName.get('Nathan').reason === 'Worse point difference', `event 8 wins: Nathan reason (got ${winsByName.get('Nathan').reason})`);
  check(winsByName.get('Jack').reason === 'More head-to-head wins', `event 8 wins: Jack reason (got ${winsByName.get('Jack').reason})`);
  check(winsByName.get('Jenn').reason === 'Fewer head-to-head wins', `event 8 wins: Jenn reason (got ${winsByName.get('Jenn').reason})`);
  check(winsByName.get('Jason').reason === 'Worse point difference', `event 8 wins: Jason reason (got ${winsByName.get('Jason').reason})`);
  check(winsByName.get('Pat').reason === 'Lost to Jason head-to-head', `event 8 wins: Pat reason (got ${winsByName.get('Pat').reason})`);
  check(winsByName.get('Bradley').reason === 'Worse point difference', `event 8 wins: Bradley reason (got ${winsByName.get('Bradley').reason})`);
  check(winsByName.get('Brittney').tied && winsByName.get('Taylor').tied, 'event 8 wins: Brittney and Taylor still tied');
}

// Synthetic head-to-head case: A and B tie on points (35) and wins (2),
// and A beat B twice (11–7, 11–6) — the head-to-head decides it.
{
  const players = [P(0, 'A'), P(1, 'B'), P(2, 'C'), P(3, 'D'), P(4, 'E'), P(5, 'F')];
  const ms = [
    { p1_id: 0, p2_id: 2, p3_id: 1, p4_id: 3, score1: 11, score2: 7 },
    { p1_id: 0, p2_id: 3, p3_id: 1, p4_id: 2, score1: 11, score2: 6 },
    { p1_id: 1, p2_id: 4, p3_id: 5, p4_id: 2, score1: 11, score2: 4 },
    { p1_id: 1, p2_id: 5, p3_id: 3, p4_id: 4, score1: 11, score2: 4 },
    { p1_id: 0, p2_id: 4, p3_id: 2, p4_id: 5, score1: 5, score2: 11 },
    { p1_id: 0, p2_id: 5, p3_id: 3, p4_id: 4, score1: 8, score2: 11 },
  ];
  const rows = computePlayerStandings(players, ms, 'points');
  check(
    JSON.stringify(rows.map((r) => r.player.name)) === JSON.stringify(['A', 'B', 'F', 'D', 'C', 'E']),
    `h2h case order A,B,F,D,C,E (got ${rows.map((r) => r.player.name).join(',')})`
  );
  const byName = new Map(rows.map((r) => [r.player.name, r]));
  check(byName.get('A').reason === 'Beat B head-to-head', `h2h case: A reason (got ${byName.get('A').reason})`);
  check(byName.get('B').reason === 'Lost to A head-to-head', `h2h case: B reason (got ${byName.get('B').reason})`);
  check(byName.get('F').reason == null, 'h2h case: F needed no tiebreaker');
}

// Rock-paper-scissors mini-table: X, Y, Z tie on points (21) and wins
// (1) and each went 1–1 in the mini-table (X beat Y, Y beat Z, Z beat
// X), so the head-to-head falls through and point differential decides:
// Y −5, Z −10, X −11.
{
  const players = [P(0, 'X'), P(1, 'Y'), P(2, 'Z'), P(3, 'A'), P(4, 'B'), P(5, 'C'), P(6, 'D'), P(7, 'E'), P(8, 'F')];
  const ms = [
    { p1_id: 0, p2_id: 3, p3_id: 1, p4_id: 4, score1: 11, score2: 10 },
    { p1_id: 1, p2_id: 5, p3_id: 2, p4_id: 6, score1: 11, score2: 4 },
    { p1_id: 2, p2_id: 7, p3_id: 0, p4_id: 8, score1: 11, score2: 9 },
    { p1_id: 0, p2_id: 4, p3_id: 5, p4_id: 6, score1: 1, score2: 11 },
    { p1_id: 1, p2_id: 3, p3_id: 7, p4_id: 8, score1: 0, score2: 11 },
    { p1_id: 2, p2_id: 4, p3_id: 3, p4_id: 6, score1: 6, score2: 11 },
  ];
  const rows = computePlayerStandings(players, ms, 'points');
  check(
    JSON.stringify(rows.map((r) => r.player.name)) === JSON.stringify(['D', 'E', 'C', 'A', 'Y', 'Z', 'X', 'F', 'B']),
    `rps case order D,E,C,A,Y,Z,X,F,B (got ${rows.map((r) => r.player.name).join(',')})`
  );
  const byName = new Map(rows.map((r) => [r.player.name, r]));
  check(byName.get('D').reason == null, 'rps case: D needed no tiebreaker');
  check(byName.get('E').reason === 'More head-to-head wins', `rps case: E reason (got ${byName.get('E').reason})`);
  check(byName.get('C').reason === 'Fewer head-to-head wins', `rps case: C reason (got ${byName.get('C').reason})`);
  check(byName.get('A').reason === 'Worse point difference', `rps case: A reason (got ${byName.get('A').reason})`);
  check(byName.get('Y').reason === 'Better point difference', `rps case: Y reason (got ${byName.get('Y').reason})`);
  check(byName.get('Z').reason === 'Worse point difference', `rps case: Z reason (got ${byName.get('Z').reason})`);
  check(byName.get('X').reason === 'Worse point difference', `rps case: X reason (got ${byName.get('X').reason})`);
  check(byName.get('F').reason == null && byName.get('B').reason == null, 'rps case: F and B needed no tiebreaker');
}

// Full simulated night: play a built schedule with random scores, then the
// standings must account for every point scored.
{
  let seed = 999;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const players = Array.from({ length: 12 }, (_, i) => P(i, `P${i}`));
  const { matches } = buildRotationSchedule(players.map((p) => p.id), {
    mainId: 0,
    rotatorIds: [1, 9],
  });
  for (const m of matches) {
    const loser = Math.floor(rand() * 11);
    if (rand() < 0.5) {
      m.score1 = 11;
      m.score2 = loser;
    } else {
      m.score1 = loser;
      m.score2 = 11;
    }
  }
  // computePlayerStandings reads DB-shaped rows (snake_case ids), so map
  // the engine's camelCase matches first.
  const dbMatches = matches.map((m) => ({
    p1_id: m.p1Id, p2_id: m.p2Id, p3_id: m.p3Id, p4_id: m.p4Id,
    score1: m.score1, score2: m.score2,
  }));
  const rows = computePlayerStandings(players, dbMatches, 'ep');
  const totalEarned = rows.reduce((s, r) => s + r.earned, 0);
  const totalScored = matches.reduce((s, m) => s + m.score1 + m.score2, 0);
  // Each point is banked by BOTH players on the side (per the preview's
  // banking: each player credits their own side's score), so the
  // standings total is twice the scored total.
  check(totalEarned === 2 * totalScored, `simulated night: standings account for every point (${totalEarned} vs 2×${totalScored})`);
  check(rows.every((r) => r.played === 5), 'simulated night: every player played 5 games');
  check(rows.every((r) => r.possible === 55), 'simulated night: possible is 55 for everyone');
  check(rows.every((r) => r.w + r.l === r.played), 'simulated night: W+L == played');
}

if (failures) {
  console.error(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('\nAll rotation engine tests passed.');

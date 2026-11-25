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
      JSON.stringify(['A', 'B', 'C', 'D', 'E']),
    `standings wins order A,B,C,D,E (got ${computePlayerStandings(players, ms, 'wins').map((r) => r.player.name).join(',')})`
  );
  // Unscored matches are ignored; empty nights are all zeros with null ep.
  const partial = computePlayerStandings(players, [
    { p1_id: 0, p2_id: 1, p3_id: 2, p4_id: 3, score1: null, score2: null },
  ]);
  check(partial.every((r) => r.played === 0 && r.ep == null), 'standings: unscored matches ignored');
  const empty = computePlayerStandings(players, []);
  check(empty.every((r) => r.w === 0 && r.played === 0 && r.ep == null), 'standings: empty night is all zeros');
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

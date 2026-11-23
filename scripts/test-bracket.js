'use strict';
// Headless tests for the double-elimination bracket engine
// (server/lib/bracket.js). Run: node scripts/test-bracket.js
// No DB needed — the engine is pure.
const {
  BRACKET_SIZES,
  seedOrder,
  buildBracket,
  resolveBracket,
  computeBracketPlaces,
  computeBracketRecords,
  dependentMatchKeys,
} = require('../server/lib/bracket');

let failures = 0;
function check(cond, label) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  }
}
function slotStr(s) {
  return s.type === 'seed' ? `#${s.ref}` : `${s.type === 'winner' ? 'W' : 'L'}${s.ref}`;
}
function matchStr(m) {
  return `${m.bracket}${m.round}G${m.gameNo}(${slotStr(m.slot1)} v ${slotStr(m.slot2)})`;
}

// Simulate one full night: play matches in creation order, random winner,
// scores 11-x (x < 11). Returns { resolved, champion, losses, games }.
function simulate(n, rand) {
  const built = buildBracket(n);
  const seedToTeamId = new Map();
  for (let s = 1; s <= n; s++) seedToTeamId.set(s, s); // team id == seed
  const matches = built.matches.map((m) => ({ ...m, score1: null, score2: null }));
  for (const m of matches) {
    const resolved = resolveBracket(matches, seedToTeamId);
    const r = resolved.get(m.key);
    if (!r.active) continue; // reset game not needed
    if (!r.ready) throw new Error(`match ${m.key} not ready when its turn came (n=${n})`);
    const t1Wins = rand() < 0.5;
    const loserScore = Math.floor(rand() * 11); // 0..10
    m.score1 = t1Wins ? 11 : loserScore;
    m.score2 = t1Wins ? loserScore : 11;
  }
  const resolved = resolveBracket(matches, seedToTeamId);
  const places = computeBracketPlaces(matches, resolved);
  const losses = new Map();
  const games = new Map();
  for (let s = 1; s <= n; s++) {
    losses.set(s, 0);
    games.set(s, 0);
  }
  for (const m of matches) {
    const r = resolved.get(m.key);
    if (r.winnerId == null) continue;
    games.set(r.winnerId, games.get(r.winnerId) + 1);
    games.set(r.loserId, games.get(r.loserId) + 1);
    losses.set(r.loserId, losses.get(r.loserId) + 1);
  }
  return { built, matches, resolved, places, losses, games };
}

console.log('seedOrder');
check(JSON.stringify(seedOrder(4)) === JSON.stringify([1, 4, 2, 3]), 'seedOrder(4) = [1,4,2,3]');
check(JSON.stringify(seedOrder(8)) === JSON.stringify([1, 8, 4, 5, 2, 7, 3, 6]), 'seedOrder(8)');
check(
  JSON.stringify(seedOrder(16)) === JSON.stringify([1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]),
  'seedOrder(16)'
);

for (const n of BRACKET_SIZES) {
  const b = buildBracket(n);
  const wb = b.matches.filter((m) => m.bracket === 'W');
  const lb = b.matches.filter((m) => m.bracket === 'L');
  const gf = b.matches.filter((m) => m.bracket === 'G');
  check(b.matches.length === 2 * n - 1, `n=${n}: stored matches 2n-1 (${b.matches.length})`);
  check(wb.length === n - 1, `n=${n}: WB matches n-1 (${wb.length})`);
  check(lb.length === n - 2, `n=${n}: LB matches n-2 (${lb.length})`);
  check(gf.length === 2, `n=${n}: GF matches 2 (GF1 + reset)`);

  // Byes fall to the top seeds: the seeds missing from WB round 0 are
  // exactly 1..(B-n).
  const B = b.B;
  const inR0 = new Set();
  for (const m of wb.filter((m) => m.round === 0)) {
    if (m.slot1.type === 'seed') inR0.add(m.slot1.ref);
    if (m.slot2.type === 'seed') inR0.add(m.slot2.ref);
  }
  const byeSeeds = [];
  for (let s = 1; s <= n; s++) if (!inR0.has(s)) byeSeeds.push(s);
  check(
    JSON.stringify(byeSeeds) === JSON.stringify(Array.from({ length: B - n }, (_, i) => i + 1)),
    `n=${n}: bye seeds are the top ${B - n} (got ${byeSeeds.join(',')})`
  );

  // Reference graph: every match's winner advances to exactly one later
  // match — except the reset game, whose winner is champion. Every
  // winners-bracket loser's drop is referenced exactly once (losers-bracket
  // losers are eliminated, so they are referenced nowhere).
  const winnerRefs = new Map();
  const loserRefs = new Map();
  for (const m of b.matches) {
    for (const s of [m.slot1, m.slot2]) {
      if (s.type === 'winner') winnerRefs.set(s.ref, (winnerRefs.get(s.ref) || 0) + 1);
      if (s.type === 'loser') loserRefs.set(s.ref, (loserRefs.get(s.ref) || 0) + 1);
    }
  }
  for (const m of b.matches) {
    if (m.key === b.gf2Key) continue;
    check(winnerRefs.get(m.key) === 1, `n=${n}: winner of match ${m.key} advances exactly once`);
  }
  for (const m of wb) {
    check(loserRefs.get(m.key) === 1, `n=${n}: loser of WB match ${m.key} drops exactly once`);
  }
  for (const m of lb) {
    check(!loserRefs.has(m.key), `n=${n}: loser of LB match ${m.key} is eliminated (no onward ref)`);
  }
  check(loserRefs.get(b.gf1Key) === 1, `n=${n}: loser of GF1 goes to the reset game`);
  check(!loserRefs.has(b.gf2Key), `n=${n}: loser of the reset game is runner-up (no onward ref)`);

  // Random full nights: 2n-2 games to a champion (+1 with a reset),
  // every non-champion ends with exactly 2 losses, every team plays >= 2.
  let seed = 12345 + n;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let run = 0; run < 200; run++) {
    const sim = simulate(n, rand);
    const played = sim.matches.filter((m) => {
      const r = sim.resolved.get(m.key);
      return r.winnerId != null;
    }).length;
    check(played === 2 * n - 2 || played === 2 * n - 1, `n=${n} run ${run}: games to champion 2n-2 or 2n-1 (got ${played})`);
    check(sim.places.champion != null, `n=${n} run ${run}: a champion is decided`);
    check(sim.losses.get(sim.places.champion) <= 1, `n=${n} run ${run}: champion has at most 1 loss`);
    for (let s = 1; s <= n; s++) {
      if (s === sim.places.champion) continue;
      check(sim.losses.get(s) === 2, `n=${n} run ${run}: team ${s} ends with exactly 2 losses (got ${sim.losses.get(s)})`);
      check(sim.games.get(s) >= 2, `n=${n} run ${run}: team ${s} plays at least 2 games (got ${sim.games.get(s)})`);
    }
    check(sim.places.third != null, `n=${n} run ${run}: a 3rd place is decided`);
  }
}

// Exact 12-team tables from the approved preview (inspection
// 2472222e-075c-421d-bb00-1abf67e230bd).
{
  const b = buildBracket(12);
  const byKey = new Map(b.matches.map((m) => [m.key, m]));
  // WB: keys 1-4 play-in, 5-8 QF, 9-10 SF, 11 final.
  const wbStr = (k) => matchStr(byKey.get(k));
  check(wbStr(1) === 'W0G1(#8 v #9)', `12: play-in G1 ${wbStr(1)}`);
  check(wbStr(2) === 'W0G2(#5 v #12)', `12: play-in G2 ${wbStr(2)}`);
  check(wbStr(3) === 'W0G3(#7 v #10)', `12: play-in G3 ${wbStr(3)}`);
  check(wbStr(4) === 'W0G4(#6 v #11)', `12: play-in G4 ${wbStr(4)}`);
  check(wbStr(5) === 'W1G1(#1 v W1)', `12: QF G1 ${wbStr(5)}`);
  check(wbStr(6) === 'W1G2(#4 v W2)', `12: QF G2 ${wbStr(6)}`);
  check(wbStr(7) === 'W1G3(#2 v W3)', `12: QF G3 ${wbStr(7)}`);
  check(wbStr(8) === 'W1G4(#3 v W4)', `12: QF G4 ${wbStr(8)}`);
  // LB: keys 12-13 R1, 14-16 R2, 17-18 R3, 19 R4, 20 R5, 21 LB Final.
  check(matchStr(byKey.get(12)) === 'L0G1(L1 v L4)', `12: LB R1 G1 ${matchStr(byKey.get(12))}`);
  check(matchStr(byKey.get(13)) === 'L0G2(L2 v L3)', `12: LB R1 G2 ${matchStr(byKey.get(13))}`);
  check(matchStr(byKey.get(14)) === 'L1G1(W12 v L8)', `12: LB R2 G1 ${matchStr(byKey.get(14))}`);
  check(matchStr(byKey.get(15)) === 'L1G2(W13 v L7)', `12: LB R2 G2 ${matchStr(byKey.get(15))}`);
  check(matchStr(byKey.get(16)) === 'L1G3(L5 v L6)', `12: LB R2 G3 ${matchStr(byKey.get(16))}`);
  check(matchStr(byKey.get(17)) === 'L2G1(W14 v L9)', `12: LB R3 G1 ${matchStr(byKey.get(17))}`);
  check(matchStr(byKey.get(18)) === 'L2G2(W15 v W16)', `12: LB R3 G2 ${matchStr(byKey.get(18))}`);
  check(matchStr(byKey.get(19)) === 'L3G1(W17 v L10)', `12: LB R4 ${matchStr(byKey.get(19))}`);
  check(matchStr(byKey.get(20)) === 'L4G1(W19 v W18)', `12: LB R5 ${matchStr(byKey.get(20))}`);
  check(matchStr(byKey.get(21)) === 'L5G1(W20 v L11)', `12: LB Final ${matchStr(byKey.get(21))}`);
  check(matchStr(byKey.get(22)) === 'G0G1(W11 v W21)', `12: GF1 ${matchStr(byKey.get(22))}`);
  check(matchStr(byKey.get(23)) === 'G1G1(W22 v L22)', `12: reset ${matchStr(byKey.get(23))}`);
  check(b.losersFinalRound === 5, `12: losers final is LB round 5 (got ${b.losersFinalRound})`);
}

// Scripted 4-team night, winners-bracket champion wins the grand final.
{
  const b = buildBracket(4);
  const seedToTeamId = new Map([[1, 1], [2, 2], [3, 3], [4, 4]]);
  const matches = b.matches.map((m) => ({ ...m, score1: null, score2: null }));
  const score = (key, s1, s2) => {
    const m = matches.find((x) => x.key === key);
    m.score1 = s1;
    m.score2 = s2;
  };
  // n=4 keys: 1,2 = WB play-in (SFs), 3 = WB Final, 4 = LB R1,
  // 5 = LB Final, 6 = GF1, 7 = reset game.
  // WB SF: 1 beats 4 (key 1), 2 beats 3 (key 2). WB Final: 1 beats 2 (key 3).
  // LB R1: 4 beats 3 (key 4). LB Final: 2 beats 4 (key 5).
  // GF1: 1 beats 2 (key 6) — no reset game needed.
  score(1, 11, 5);
  score(2, 11, 9);
  score(3, 11, 8);
  score(4, 11, 2);
  score(5, 6, 11); // team 2 wins (score2 is team 2's side: loser of WB final)
  score(6, 11, 4);
  const resolved = resolveBracket(matches, seedToTeamId);
  check(resolved.get(7).active === false, 'scripted 4: reset game inactive when WB champion wins GF1');
  const places = computeBracketPlaces(matches, resolved);
  check(places.champion === 1, `scripted 4: champion is 1 (got ${places.champion})`);
  check(places.runnerUp === 2, `scripted 4: runner-up is 2 (got ${places.runnerUp})`);
  check(places.third === 4, `scripted 4: 3rd is 4 (got ${places.third})`);
  const recs = computeBracketRecords(matches, resolved, [1, 2, 3, 4]);
  const recById = new Map(recs.map((r) => [r.teamId, r]));
  check(recById.get(1).w === 3 && recById.get(1).l === 0, 'scripted 4: champion 3W-0L');
  check(recById.get(2).w === 2 && recById.get(2).l === 2, 'scripted 4: runner-up 2W-2L');
}

// Same night, but the losers champion wins GF1 — the reset game decides it.
{
  const b = buildBracket(4);
  const seedToTeamId = new Map([[1, 1], [2, 2], [3, 3], [4, 4]]);
  const matches = b.matches.map((m) => ({ ...m, score1: null, score2: null }));
  const score = (key, s1, s2) => {
    const m = matches.find((x) => x.key === key);
    m.score1 = s1;
    m.score2 = s2;
  };
  score(1, 11, 5);
  score(2, 11, 9);
  score(3, 11, 8);
  score(4, 11, 2);
  score(5, 6, 11);
  score(6, 4, 11); // team 2 (losers champion) wins GF1
  let resolved = resolveBracket(matches, seedToTeamId);
  check(resolved.get(7).active === true, 'scripted 4 (reset): reset game active when LB champion wins GF1');
  let places = computeBracketPlaces(matches, resolved);
  check(places.champion == null, 'scripted 4 (reset): no champion until the reset game');
  score(7, 11, 9); // GF2 slot1 is the GF1 winner (team 2) — team 2 wins the reset too
  resolved = resolveBracket(matches, seedToTeamId);
  places = computeBracketPlaces(matches, resolved);
  check(places.champion === 2, `scripted 4 (reset): champion is 2 (got ${places.champion})`);
  check(places.runnerUp === 1, `scripted 4 (reset): runner-up is 1 (got ${places.runnerUp})`);
  check(places.third === 4, `scripted 4 (reset): 3rd is 4 (got ${places.third})`);
}

// Changing an early score clears every later match that depended on it.
{
  const b = buildBracket(4);
  const deps = dependentMatchKeys(b.matches, 1); // play-in G1
  // Winner of G1 goes to the WB Final (key 3); loser drops to LB R1 (key 4),
  // whose winner goes to the LB Final (key 5), whose winner goes to GF1 (6),
  // whose winner/loser go to the reset (7).
  check(
    JSON.stringify(deps) === JSON.stringify([3, 4, 5, 6, 7]),
    `dependents of match 1 are 3,4,5,6,7 (got ${deps.join(',')})`
  );
  const depsFinal = dependentMatchKeys(b.matches, 3); // WB Final
  check(JSON.stringify(depsFinal) === JSON.stringify([5, 6, 7]), `dependents of WB final are 5,6,7 (got ${depsFinal.join(',')})`);
}

// buildBracket rejects sizes outside the approved set.
{
  let threw = false;
  try {
    buildBracket(9);
  } catch (e) {
    threw = true;
  }
  check(threw, 'buildBracket(9) throws');
}

// A night still in setup has no matches: places and records must not throw.
{
  const empty = resolveBracket([], new Map());
  check(empty.size === 0, 'resolveBracket([]) is empty');
  const places = computeBracketPlaces([], empty);
  check(places.champion == null && places.runnerUp == null && places.third == null, 'computeBracketPlaces([]) is all null');
  const recs = computeBracketRecords([], empty, [1, 2]);
  check(recs.length === 2 && recs.every((r) => r.w === 0 && r.l === 0 && r.played === 0), 'computeBracketRecords([]) is all zeros');
}

if (failures) {
  console.error(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('\nAll bracket engine tests passed.');

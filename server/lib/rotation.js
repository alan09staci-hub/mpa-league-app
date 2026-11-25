'use strict';
// Rotating-partners round robin — pure logic (no DB): schedule building and
// per-player standings. Kept free of DB access so it can be unit-tested
// with plain node, like server/lib/bracket.js.
//
// The format (from the approved RR Player Points Preview): partners rotate
// every round instead of fixed teams staying together all night, and each
// player carries their own points from every game into a personal bank.
// One game to 11 per match, first to 11, win by 1 (no deuce) — the same
// single-game shape as fixed-team round robin. A night is 5 rounds; every
// player plays once per round (even counts), and with an odd count one
// player sits out each round (a rotating bye).
//
// Schedule: a deterministic seeded search, ported from the preview.
//   - Main player (optional): the main's partner each round cycles through
//     the rotators in pick order (rotators[r % rotators.length]). Rotators
//     not with the main that round partner with someone from the field.
//     Nobody sits out because of the main/rotator setup.
//   - The rest are paired by bestPairs: 300 random shuffles of the pool,
//     scored 10 points per pair that has already partnered before, lowest
//     score wins — repeats are minimized, not banned.
//   - Opponents are matched by a second 300-trial search: the pairs are
//     shuffled and matched in order, scored 1 per individual cross-pairing
//     already faced before, lowest wins. Courts are assigned 1, 2, 3… in
//     that shuffled order.
//   - Randomness is deterministic seeded mulberry32: seedBase =
//     mainIdx*31 + sum(rotatorIdxs)*7 + rotators.length*3 (indices are
//     0-based positions in the player list); per-round seed =
//     9000 + (round-1)*131 + seedBase. Same players + main + rotators
//     always rebuild the same schedule — and with the preview's default
//     (Brad main, Mika/Wilson rotating) it reproduces the preview's
//     captured R1–R5 exactly (verified in scripts/test-rotation.js).
//
// Standings: ranked per player by the night's winner rule:
//   - 'ep' (default): E/P Diff% (earned/possible), tie-break wins desc,
//     against asc, earned desc.
//   - 'points': most total points (earned desc), then E/P, then wins.
//   - 'wins': most game wins first (wins desc), then E/P, then earned.
// "Possible" is 11 per game played — the winner always reaches exactly
// 11, so E/P never exceeds 100%.

const ROUNDS = 5;
const TARGET = 11;
const MAX_ROTATORS = 5;

// Canonical mulberry32 — small deterministic PRNG.
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Unordered pair key for two player ids (numbers or strings).
function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// Fisher-Yates shuffle, in place, driven by rand.
function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

// 300 random shuffles of the pool; the pairing with the fewest repeat
// partners (10 points each) wins. Returns pairs [[a, b], …] in shuffle order.
function bestPairs(pool, rand, partnerSeen) {
  let best = null;
  let bestScore = Infinity;
  for (let t = 0; t < 300; t++) {
    const arr = shuffle([...pool], rand);
    let score = 0;
    for (let i = 0; i + 1 < arr.length; i += 2) {
      if (partnerSeen.has(pairKey(arr[i], arr[i + 1]))) score += 10;
    }
    if (score < bestScore) {
      bestScore = score;
      best = arr;
    }
  }
  const pairs = [];
  for (let i = 0; i + 1 < best.length; i += 2) pairs.push([best[i], best[i + 1]]);
  return pairs;
}

// 300 shuffles of the pairs; matched in order ([0]v[1], [2]v[3], …), scored
// 1 per individual cross-pairing already faced before. Lowest score wins.
// Returns matches [[[a, b], [c, d]], …] in court order.
function bestMatching(pairs, rand, oppSeen) {
  let best = null;
  let bestScore = Infinity;
  for (let t = 0; t < 300; t++) {
    const arr = shuffle([...pairs], rand);
    let score = 0;
    for (let i = 0; i + 1 < arr.length; i += 2) {
      const [a1, a2] = arr[i];
      const [b1, b2] = arr[i + 1];
      for (const x of [a1, a2]) {
        for (const y of [b1, b2]) {
          if (oppSeen.has(pairKey(x, y))) score += 1;
        }
      }
    }
    if (score < bestScore) {
      bestScore = score;
      best = arr;
    }
  }
  const out = [];
  for (let i = 0; i + 1 < best.length; i += 2) out.push([best[i], best[i + 1]]);
  return out;
}

// playerIds: array of player ids (any order — the order is the seed order).
// opts: { mainId, rotatorIds, rounds } — mainId/rotatorIds must be among
// playerIds to take effect; rotators cycle in the order given.
// Returns { matches: [{ round, court, p1Id, p2Id, p3Id, p4Id, target: 11 }],
//           byes: [{ round, playerId }] }.
// A doubles round needs a multiple of 4 players, so the number sitting out
// each round is players.length % 4 (0 for the usual 12-player night, 1 for
// 5 or 9 players, 2 for 6 or 10, 3 for 7 or 11) — the byes rotate so the
// sitting is shared. Fewer than 4 players builds nothing (no doubles match).
function buildRotationSchedule(playerIds, opts = {}) {
  const players = [...playerIds];
  const rounds = opts.rounds || ROUNDS;
  if (players.length < 4 || rounds < 1) return { matches: [], byes: [] };
  const mainIdx = opts.mainId != null ? players.indexOf(opts.mainId) : -1;
  const rotators = (opts.rotatorIds || []).filter((id) => players.includes(id));
  const rotIdxs = rotators.map((id) => players.indexOf(id));
  const seedBase =
    mainIdx >= 0
      ? mainIdx * 31 + rotIdxs.reduce((s, x) => s + x, 0) * 7 + rotIdxs.length * 3
      : 0;
  const byesPerRound = players.length % 4;
  const partnerSeen = new Set();
  const oppSeen = new Set();
  const sitCounts = new Map(players.map((p) => [p, 0]));
  const matches = [];
  const byes = [];
  for (let r = 1; r <= rounds; r++) {
    // Per-round seed is 0-based (round 1 uses 9000 + seedBase) — this is
    // what reproduces the preview's captured schedule exactly.
    const rand = mulberry32(9000 + (r - 1) * 131 + seedBase);
    let mainPair = null;
    let pool;
    if (mainIdx >= 0 && rotators.length) {
      const partner = rotators[(r - 1) % rotators.length];
      mainPair = [players[mainIdx], partner];
      // Pool order matters for the seeded search: the field players first
      // (in list order), then the idle rotators in pick order.
      const field = players.filter((p) => p !== players[mainIdx] && !rotators.includes(p));
      const idle = rotators.filter((x) => x !== partner);
      pool = [...field, ...idle];
    } else {
      pool = [...players];
    }
    // Byes: the eligible players who have sat out least so far, ties
    // broken by scan order from the round's start index — the sitting is
    // shared instead of landing on the same players, and the result stays
    // deterministic for the same inputs. The main pair never sits out.
    const byeSet = new Set();
    if (byesPerRound > 0) {
      const start = ((r - 1) * byesPerRound) % players.length;
      const scan = [];
      for (let i = 0; i < players.length; i++) scan.push(players[(start + i) % players.length]);
      const eligible = scan.filter((p) => pool.includes(p));
      eligible.sort((a, b) => sitCounts.get(a) - sitCounts.get(b));
      for (const b of eligible.slice(0, byesPerRound)) {
        byeSet.add(b);
        sitCounts.set(b, sitCounts.get(b) + 1);
        byes.push({ round: r, playerId: b });
      }
    }
    const rest = pool.filter((p) => !byeSet.has(p));
    const pairs = bestPairs(rest, rand, partnerSeen);
    // The main pair goes first in the list the opponent search shuffles.
    const allPairs = mainPair ? [mainPair, ...pairs] : pairs;
    const matched = bestMatching(allPairs, rand, oppSeen);
    matched.forEach(([a, b], i) => {
      matches.push({
        round: r,
        court: i + 1,
        p1Id: a[0],
        p2Id: a[1],
        p3Id: b[0],
        p4Id: b[1],
        target: TARGET,
      });
    });
    // Record what happened this round so later rounds avoid repeats.
    for (const [a, b] of pairs) partnerSeen.add(pairKey(a, b));
    for (const [a, b] of matched) {
      for (const x of a) {
        for (const y of b) oppSeen.add(pairKey(x, y));
      }
    }
  }
  return { matches, byes };
}

// players: [{ id, name }]. matches: rows with p1_id, p2_id, p3_id, p4_id,
// score1, score2 (score1 is the (p1,p2) side's score).
// winnerRule: 'ep' | 'points' | 'wins' (default 'ep').
// Returns ranked rows: [{ player, rank, w, l, played, earned, against,
// possible, ep }].
function computePlayerStandings(players, matches, winnerRule = 'ep') {
  const byId = new Map(
    players.map((p) => [
      p.id,
      { player: p, w: 0, l: 0, played: 0, earned: 0, against: 0, possible: 0 },
    ])
  );
  for (const m of matches) {
    if (m.score1 == null || m.score2 == null) continue;
    const a1 = byId.get(m.p1_id);
    const a2 = byId.get(m.p2_id);
    const b1 = byId.get(m.p3_id);
    const b2 = byId.get(m.p4_id);
    if (!a1 || !a2 || !b1 || !b2) continue;
    const sideA = [a1, a2];
    const sideB = [b1, b2];
    for (const p of sideA) {
      p.played += 1;
      p.possible += TARGET;
      p.earned += m.score1;
      p.against += m.score2;
    }
    for (const p of sideB) {
      p.played += 1;
      p.possible += TARGET;
      p.earned += m.score2;
      p.against += m.score1;
    }
    const winners = m.score1 > m.score2 ? sideA : sideB;
    const losers = m.score1 > m.score2 ? sideB : sideA;
    for (const p of winners) p.w += 1;
    for (const p of losers) p.l += 1;
  }
  const rows = [...byId.values()].map((r) => ({
    ...r,
    ep: r.possible > 0 ? r.earned / r.possible : null,
  }));
  const epOf = (r) => r.ep ?? -1;
  if (winnerRule === 'points') {
    rows.sort((x, y) => y.earned - x.earned || epOf(y) - epOf(x) || y.w - x.w);
  } else if (winnerRule === 'wins') {
    rows.sort((x, y) => y.w - x.w || epOf(y) - epOf(x) || y.earned - x.earned);
  } else {
    rows.sort(
      (x, y) => epOf(y) - epOf(x) || y.w - x.w || x.against - y.against || y.earned - x.earned
    );
  }
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  return rows;
}

module.exports = {
  ROUNDS,
  TARGET,
  MAX_ROTATORS,
  mulberry32,
  pairKey,
  buildRotationSchedule,
  computePlayerStandings,
};

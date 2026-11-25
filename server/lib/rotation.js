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
// Standings: ranked per player by the night's winner rule, then the
// tiebreaker chain (approved 2026-11-25): most game wins, head-to-head
// wins against the other tied players (opposite sides only), point
// differential, head-to-head point differential, fewest points against,
// then a genuine tie — tied players share the rank (two 1sts, then 3rd)
// instead of an invented order. Each row also carries `reason`, a short
// plain line naming the level that decided its rank against the adjacent
// player it was tied with (null when no tiebreaker was needed), and
// `tied` for a genuine tie.
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
// possible, ep, tied, reason }].
//
// Tiebreaker chain (approved 2026-11-25), applied in this order after the
// night's winner rule:
//   1. the winner rule itself (most total points, E/P Diff%, or most wins)
//   2. most game wins (a no-op when wins is the primary rule)
//   3. head-to-head: most games won against the other tied players — only
//      games where they were on opposite sides count (partnering does not)
//   4. point differential (earned minus against)
//   5. head-to-head point differential (vs the other tied players)
//   6. fewest points against
//   7. genuine tie: players still tied share the rank (standard
//      competition ranking — two 1sts, then 3rd) instead of an invented
//      order.
// `tied` marks a genuine tie; `reason` is a short plain line naming the
// level that decided the row's rank against the adjacent player it was
// tied with at the primary rule (null when no tiebreaker was needed, or
// when the row is genuinely tied).
function computePlayerStandings(players, matches, winnerRule = 'ep') {
  const byId = new Map(
    players.map((p) => [
      p.id,
      {
        player: p,
        w: 0,
        l: 0,
        played: 0,
        earned: 0,
        against: 0,
        possible: 0,
        h2h: new Map(),
      },
    ])
  );
  // Head-to-head note, from one player's perspective: games won/lost and
  // points for/against against one opponent (opposite sides only).
  const h2hNote = (row, oppId, won, forPts, againstPts) => {
    let rec = row.h2h.get(oppId);
    if (!rec) {
      rec = { w: 0, l: 0, forPts: 0, againstPts: 0 };
      row.h2h.set(oppId, rec);
    }
    if (won) rec.w += 1;
    else rec.l += 1;
    rec.forPts += forPts;
    rec.againstPts += againstPts;
  };
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
    const aWon = m.score1 > m.score2;
    const winners = aWon ? sideA : sideB;
    const losers = aWon ? sideB : sideA;
    for (const p of winners) p.w += 1;
    for (const p of losers) p.l += 1;
    for (const a of sideA) {
      for (const b of sideB) {
        h2hNote(a, b.player.id, aWon, m.score1, m.score2);
        h2hNote(b, a.player.id, !aWon, m.score2, m.score1);
      }
    }
  }
  const rows = [...byId.values()].map((r) => ({
    ...r,
    ep: r.possible > 0 ? r.earned / r.possible : null,
  }));
  if (!rows.length) return [];

  // Head-to-head totals against the other players in a tied group.
  const h2hWins = (row, group) => {
    let n = 0;
    for (const o of group) {
      if (o === row) continue;
      const rec = row.h2h.get(o.player.id);
      if (rec) n += rec.w;
    }
    return n;
  };
  const h2hPd = (row, group) => {
    let n = 0;
    for (const o of group) {
      if (o === row) continue;
      const rec = row.h2h.get(o.player.id);
      if (rec) n += rec.forPts - rec.againstPts;
    }
    return n;
  };
  // One comparator per level: <0 when a ranks above b, 0 when tied.
  // Head-to-head levels take the tied group as context.
  const epCmp = (a, b) => {
    if (a.ep == null && b.ep == null) return 0;
    if (a.ep == null) return 1;
    if (b.ep == null) return -1;
    // Exact fraction comparison — no float rounding on close E/Ps.
    return b.earned * a.possible - a.earned * b.possible;
  };
  const primaryCmp =
    winnerRule === 'points'
      ? (a, b) => b.earned - a.earned
      : winnerRule === 'wins'
        ? (a, b) => b.w - a.w
        : epCmp;
  const levels = [
    { id: 'primary', cmp: primaryCmp },
    { id: 'wins', cmp: (a, b) => b.w - a.w },
    { id: 'h2h', cmp: (a, b, g) => h2hWins(b, g) - h2hWins(a, g) },
    { id: 'pd', cmp: (a, b) => b.earned - b.against - (a.earned - a.against) },
    { id: 'h2hpd', cmp: (a, b, g) => h2hPd(b, g) - h2hPd(a, g) },
    { id: 'against', cmp: (a, b) => a.against - b.against },
  ];
  // Split a group into subgroups that tie at one level, keeping the
  // group's order inside each subgroup (stable — a genuine tie keeps
  // signup order on screen).
  const splitGroup = (group, level) => {
    const sorted = [...group].sort((a, b) => level.cmp(a, b, group));
    const out = [];
    let run = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      if (level.cmp(sorted[i - 1], sorted[i], group) === 0) run.push(sorted[i]);
      else {
        out.push(run);
        run = [sorted[i]];
      }
    }
    out.push(run);
    return out;
  };

  // Refine the groups level by level: each level splits every group that
  // is still tied at the levels above it.
  let groups = [rows];
  let primaryGroups = groups;
  levels.forEach((level, li) => {
    const next = [];
    for (const g of groups) next.push(...splitGroup(g, level));
    groups = next;
    if (li === 0) primaryGroups = groups;
  });

  // Standard competition ranking: a genuine tie shares the rank, and the
  // next rank skips the tied places (two 1sts, then 3rd).
  const ordered = groups.flat();
  let pos = 0;
  for (const g of groups) {
    for (const r of g) {
      r.rank = pos + 1;
      r.tied = g.length > 1;
      r.reason = null;
    }
    pos += g.length;
  }

  // Reason for a row that was tied at the primary rule but ended up alone
  // at its rank: the first tiebreaker level that separated it from the
  // adjacent player it was tied with (the one above if there is one,
  // otherwise the one below). Walk the levels, narrowing to the subgroup
  // still tied with the row, until the neighbour separates.
  const reasonText = (levelId, won, row, neighbor) => {
    switch (levelId) {
      case 'wins':
        return won ? 'More wins' : 'Fewer wins';
      case 'h2h': {
        const rec = row.h2h.get(neighbor.player.id);
        if (won && rec && rec.w > rec.l) return `Beat ${neighbor.player.name} head-to-head`;
        if (!won && rec && rec.l > rec.w) return `Lost to ${neighbor.player.name} head-to-head`;
        return won ? 'More head-to-head wins' : 'Fewer head-to-head wins';
      }
      case 'pd':
        return won ? 'Better point difference' : 'Worse point difference';
      case 'h2hpd':
        return won ? 'Better head-to-head point difference' : 'Worse head-to-head point difference';
      case 'against':
        return won ? 'Let in fewer points' : 'Let in more points';
      default:
        return null;
    }
  };
  for (let i = 0; i < ordered.length; i++) {
    const row = ordered[i];
    if (row.tied) continue;
    const pGroup = primaryGroups.find((g) => g.includes(row));
    if (!pGroup || pGroup.length < 2) continue;
    const above = i > 0 && pGroup.includes(ordered[i - 1]) ? ordered[i - 1] : null;
    const below =
      i + 1 < ordered.length && pGroup.includes(ordered[i + 1]) ? ordered[i + 1] : null;
    const neighbor = above || below;
    if (!neighbor) continue;
    let group = pGroup;
    for (let li = 1; li < levels.length; li++) {
      const level = levels[li];
      const c = level.cmp(row, neighbor, group);
      if (c !== 0) {
        row.reason = reasonText(level.id, c < 0, row, neighbor);
        break;
      }
      group = splitGroup(group, level).find((g) => g.includes(row));
    }
  }

  return ordered.map((r) => {
    const { h2h, ...rest } = r;
    return rest;
  });
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

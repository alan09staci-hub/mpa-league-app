'use strict';
// Schedule generation — court-size builds (spec):
//   4 on a court = 3 games to 20 each, no byes
//   5 on a court = 5 games to 15 each, 1 bye per game
//   6 on a court = 9 games to 10 each, 2 byes per game
// Every player reaches 60 possible points per session. Courts are assigned
// by standings order (top players Court 1), same court all session.
// Pairings: the 4- and 5-player builds rotate so every player partners
// every other player exactly once. The 6-player build is a deterministic
// greedy rotation (each player plays 6, sits 3) that maximises new
// partnerships. The spec pins the counts, not the exact pairings.

function partitionCourts(playersInOrder) {
  const n = playersInOrder.length;
  if (n < 4) return { courts: [], warnings: [`Only ${n} player(s) opted in — at least 4 are needed for a court.`] };
  const courtCount = Math.ceil(n / 6);
  const base = Math.floor(n / courtCount);
  const rem = n % courtCount;
  const courts = [];
  const warnings = [];
  let i = 0;
  for (let c = 0; c < courtCount; c++) {
    const size = base + (c < rem ? 1 : 0);
    const members = playersInOrder.slice(i, i + size);
    i += size;
    if (size < 4) {
      warnings.push(
        `Court ${c + 1} would have only ${size} player(s) — courts need 4–6. Those players have no matches; add a walk-in or remove a player.`
      );
    }
    courts.push(members);
  }
  return { courts, warnings };
}

function courtMatches(players, court) {
  const n = players.length;
  const out = [];
  if (n === 4) {
    const [a, b, c, d] = players;
    const rounds = [
      [[a, b], [c, d]],
      [[a, c], [b, d]],
      [[a, d], [b, c]],
    ];
    rounds.forEach(([t1, t2], idx) => {
      out.push({ court, round: idx + 1, kind: 'match', team1: t1, team2: t2, target: 20 });
    });
  } else if (n === 5) {
    for (let r = 0; r < 5; r++) {
      const bye = players[r];
      const rest = [1, 2, 3, 4].map((k) => players[(r + k) % 5]);
      out.push({ court, round: r + 1, kind: 'bye', bye, target: 15 });
      out.push({ court, round: r + 1, kind: 'match', team1: [rest[0], rest[2]], team2: [rest[1], rest[3]], target: 15 });
    }
  } else if (n === 6) {
    greedySix(players, court, out);
  }
  return out;
}

// 9 rounds, 2 sit per round, each player plays 6 (to 10) and sits 3.
// Greedy: each round, sit the pair that has sat least (and least together),
// then pair the remaining four to maximise new partnerships.
function greedySix(players, court, out) {
  const sat = new Map(players.map((p) => [p, 0]));
  const satTogether = new Map();
  const partnered = new Map();
  const opposed = new Map();
  const pairKey = (a, b) => [a, b].sort().join('|');

  for (let r = 0; r < 9; r++) {
    // Choose the sitting pair.
    let bestSit = null;
    let bestSitScore = null;
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const a = players[i];
        const b = players[j];
        const score = [
          Math.max(sat.get(a), sat.get(b)),
          satTogether.get(pairKey(a, b)) || 0,
          i + j,
        ];
        if (!bestSitScore || score < bestSitScore) {
          bestSitScore = score;
          bestSit = [a, b];
        }
      }
    }
    const [s1, s2] = bestSit;
    const playing = players.filter((p) => p !== s1 && p !== s2);
    const [a, b, c, d] = playing;
    const pairings = [
      [[a, b], [c, d]],
      [[a, c], [b, d]],
      [[a, d], [b, c]],
    ];
    let bestPair = null;
    let bestPairScore = null;
    for (const [t1, t2] of pairings) {
      const score = [
        (partnered.get(pairKey(t1[0], t1[1])) || 0) + (partnered.get(pairKey(t2[0], t2[1])) || 0),
        (opposed.get(pairKey(t1[0], t2[0])) || 0) + (opposed.get(pairKey(t1[0], t2[1])) || 0) +
          (opposed.get(pairKey(t1[1], t2[0])) || 0) + (opposed.get(pairKey(t1[1], t2[1])) || 0),
      ];
      if (!bestPairScore || score < bestPairScore) {
        bestPairScore = score;
        bestPair = [t1, t2];
      }
    }
    sat.set(s1, sat.get(s1) + 1);
    sat.set(s2, sat.get(s2) + 1);
    satTogether.set(pairKey(s1, s2), (satTogether.get(pairKey(s1, s2)) || 0) + 1);
    const [t1, t2] = bestPair;
    partnered.set(pairKey(t1[0], t1[1]), (partnered.get(pairKey(t1[0], t1[1])) || 0) + 1);
    partnered.set(pairKey(t2[0], t2[1]), (partnered.get(pairKey(t2[0], t2[1])) || 0) + 1);
    for (const x of t1) {
      for (const y of t2) {
        opposed.set(pairKey(x, y), (opposed.get(pairKey(x, y)) || 0) + 1);
      }
    }
    out.push({ court, round: r + 1, kind: 'bye', bye: s1, target: 10 });
    out.push({ court, round: r + 1, kind: 'bye', bye: s2, target: 10 });
    out.push({ court, round: r + 1, kind: 'match', team1: t1, team2: t2, target: 10 });
  }
}

// playersInOrder: array of person ids in standings (or DUPR seeding) order.
function generateSchedule(playersInOrder) {
  const { courts, warnings } = partitionCourts(playersInOrder);
  const matches = [];
  for (let c = 0; c < courts.length; c++) {
    const members = courts[c];
    if (members.length < 4 || members.length > 6) continue;
    matches.push(...courtMatches(members, c + 1));
  }
  return { matches, warnings };
}

// Match identity for carrying scores across a rebuild: same court and same
// four players (a bye row keys on its one player).
function matchKey(m) {
  if (m.kind === 'bye') return `${m.court}|bye|${m.bye_person_id ?? m.bye}`;
  const ids = [m.team1_p1, m.team1_p2, m.team2_p1, m.team2_p2]
    .filter((x) => x != null)
    .sort((a, b) => a - b);
  return `${m.court}|match|${ids.join(',')}`;
}

module.exports = { partitionCourts, courtMatches, generateSchedule, matchKey };

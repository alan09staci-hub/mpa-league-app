'use strict';
// Double-elimination bracket nights — pure logic (no DB), ported from the
// approved preview (artifact double-elimination-bracket-preview, index.html
// buildBracket). Kept free of DB access so it can be unit-tested with plain
// node. Do not redesign the structure: the preview was approved by Alan
// ("bracket looks good", 2026-11-22) with the rule that higher seeds always
// get the bye, in both brackets, whenever a bye is needed.
//
// Structure (n = team count, one of 4/6/8/10/12/16):
// - B = next power of two >= n. seedOrder(B) interleaves the seeds
//   ([1,4,2,3] / [1,8,4,5,2,7,3,6] / [1,16,8,9,4,13,5,12,2,15,7,10,3,14,6,11]).
//   Consecutive seed pairs form the winners-bracket play-in; a pair with a
//   phantom seed (> n) gives the real (top) seed a bye — no BYE box, the
//   seed goes straight into the next round. The winners bracket then pairs
//   consecutive slots until the final. No re-seeding, no rematch avoidance.
// - Losers bracket carries a `waiting` list. First-round losers play each
//   other first-vs-last (pairCross). Each later round pairs waiting winners
//   in order against new winners-bracket losers in REVERSE order; leftover
//   waiting winners and leftover droppers pair among themselves in that
//   same round (cross pairs first, then waiting leftovers, then dropper
//   leftovers). If the total is odd, the LAST fresh dropper sits out — a
//   waiting winner never sits out. After all winners-bracket rounds except
//   the final, waiting teams play each other until one survives; that
//   survivor meets the winners-bracket final loser in the Losers Final.
// - Grand final: winners-bracket champion vs losers-bracket champion. The
//   reset game (same two teams) is played only if the losers champion wins
//   the first final.
// - Every match is one game to 11, first to 11, win by 1 (no deuce — the
//   same rule as round robin). Total games to a champion: 2n-2, +1 if a
//   reset game happens. Every team plays at least 2 games; every
//   non-champion ends with exactly 2 losses.
//
// Matches are stored with slot references, not resolved team ids, so a
// score entered now decides who plays later:
//   slot = { type: 'seed', ref: seedNumber }
//        | { type: 'winner', ref: matchKey }  (winner of that match)
//        | { type: 'loser', ref: matchKey }   (loser of that match)
// Matches are created in dependency order (all winners, then losers rounds
// in order, then Losers Final, Grand Final, Reset Game), so one forward
// pass resolves everything. `key` is the creation-order number (1-based);
// the route maps keys to DB ids on insert, since every slot references an
// earlier match.

const BRACKET_SIZES = [4, 6, 8, 10, 12, 16];

function nextPow2(n) {
  let b = 1;
  while (b < n) b *= 2;
  return b;
}

// Standard interleaved seed order for a power-of-two bracket: start [1,2];
// each round, interleave each seed with (length*2+1 - seed).
function seedOrder(B) {
  let order = [1, 2];
  while (order.length < B) {
    const sum = order.length * 2 + 1;
    const next = [];
    for (const s of order) next.push(s, sum - s);
    order = next;
  }
  return order;
}

// pairCross: first vs last, second vs second-last, ...; one leftover (odd
// count) is carried unchanged. Used for losers-bracket rounds played among
// themselves.
function pairCross(slots) {
  const arr = [...slots];
  const pairs = [];
  while (arr.length >= 2) pairs.push([arr.shift(), arr.pop()]);
  return { pairs, leftover: arr.length === 1 ? arr[0] : null };
}

// Build the bracket for n teams. Returns:
// { n, B, byeCount, matches, wbRounds, lbRounds, losersFinalRound,
//   wbFinalKey, lbFinalKey, gf1Key, gf2Key }
// matches: [{ key, bracket: 'W'|'L'|'G', round, gameNo,
//             slot1, slot2, target: 11 }] in creation order.
// round is 0-based within its bracket; gameNo is 1-based within the round.
function buildBracket(n) {
  if (!BRACKET_SIZES.includes(n)) {
    throw new Error(`A bracket needs 4, 6, 8, 10, 12 or 16 teams — got ${n}.`);
  }
  const B = nextPow2(n);
  const order = seedOrder(B);
  const matches = [];
  let key = 0;
  const perRound = new Map(); // "W:0" -> count, for gameNo
  function add(bracket, round, slot1, slot2) {
    key += 1;
    const rk = `${bracket}:${round}`;
    const gameNo = (perRound.get(rk) || 0) + 1;
    perRound.set(rk, gameNo);
    const m = { key, bracket, round, gameNo, slot1, slot2, target: 11 };
    matches.push(m);
    return m;
  }

  // ---- winners bracket ----
  const wbRounds = []; // per round index: array of match keys
  const firstPairs = [];
  for (let i = 0; i < order.length; i += 2) firstPairs.push([order[i], order[i + 1]]);
  let nextSlots = [];
  const r0 = [];
  for (const [a, b] of firstPairs) {
    if (a <= n && b <= n) {
      const m = add('W', 0, { type: 'seed', ref: a }, { type: 'seed', ref: b });
      r0.push(m.key);
      nextSlots.push({ type: 'winner', ref: m.key });
    } else {
      // Phantom seed (> n): the real seed takes the bye — no box, it goes
      // straight into the next round. Byes always fall to the top seeds,
      // because phantom seeds sit opposite the top of seedOrder.
      const real = a <= n ? a : b;
      nextSlots.push({ type: 'seed', ref: real });
    }
  }
  wbRounds.push(r0);
  let round = 1;
  while (nextSlots.length > 1) {
    const cur = [];
    const following = [];
    for (let i = 0; i < nextSlots.length; i += 2) {
      const m = add('W', round, nextSlots[i], nextSlots[i + 1]);
      cur.push(m.key);
      following.push({ type: 'winner', ref: m.key });
    }
    wbRounds.push(cur);
    nextSlots = following;
    round += 1;
  }
  const K = wbRounds.length; // number of winners-bracket rounds
  const wbFinalKey = wbRounds[K - 1][0];

  // ---- losers bracket ----
  // playEachOther(slots, round): one losers round from pairCross; returns
  // the new waiting list — winners in game order, leftover appended after.
  function playEachOther(slots, lbRound) {
    const { pairs, leftover } = pairCross(slots);
    const made = [];
    for (const [s1, s2] of pairs) made.push(add('L', lbRound, s1, s2).key);
    const waitingOut = made.map((k) => ({ type: 'winner', ref: k }));
    if (leftover) waitingOut.push(leftover);
    return waitingOut;
  }

  const lbRounds = [];
  let waiting = []; // slots carried into the next losers round
  let lbRound = 0;
  for (let k = 0; k < K - 1; k++) {
    const drop = wbRounds[k].map((matchKey) => ({ type: 'loser', ref: matchKey }));
    if (waiting.length === 0) {
      if (drop.length === 1) {
        // Lone loser just waits — no losers match this round. (Defensive:
        // never fires for 4/6/8/10/12/16, where every non-final winners
        // round has >= 2 matches.)
        waiting = drop;
      } else {
        const before = matches.length;
        waiting = playEachOther(drop, lbRound);
        lbRounds.push(matches.slice(before).map((m) => m.key));
        lbRound += 1;
      }
      continue;
    }
    const wPool = [...waiting];
    let dPool = [...drop];
    let sitOut = null;
    if ((wPool.length + dPool.length) % 2 === 1 && dPool.length > 0) {
      // Odd total: the LAST fresh dropper sits this round out. A waiting
      // winner never sits out.
      sitOut = dPool.pop();
    }
    const cross = Math.min(wPool.length, dPool.length);
    const pairs = [];
    for (let i = 0; i < cross; i++) {
      // Waiting winners in order vs droppers in REVERSE order.
      pairs.push([wPool[i], dPool[dPool.length - 1 - i]]);
    }
    // Leftovers pair among themselves in the same round. (Both pools are
    // even here — the total was made even by the sit-out — so pairCross
    // never leaves a leftover; kept for safety.)
    const wLeft = pairCross(wPool.slice(cross));
    const dLeft = pairCross(dPool.slice(0, dPool.length - cross));
    const allPairs = [...pairs, ...wLeft.pairs, ...dLeft.pairs];
    const before = matches.length;
    const made = [];
    for (const [s1, s2] of allPairs) made.push(add('L', lbRound, s1, s2).key);
    lbRounds.push(matches.slice(before).map((m) => m.key));
    waiting = made.map((mKey) => ({ type: 'winner', ref: mKey }));
    if (wLeft.leftover) waiting.push(wLeft.leftover);
    if (dLeft.leftover) waiting.push(dLeft.leftover);
    if (sitOut) waiting.push(sitOut);
    lbRound += 1;
  }
  // Drain: remaining waiting teams play each other until one survives.
  while (waiting.length > 1) {
    const before = matches.length;
    waiting = playEachOther(waiting, lbRound);
    lbRounds.push(matches.slice(before).map((m) => m.key));
    lbRound += 1;
  }
  // Losers Final: sole survivor vs the winners-bracket final loser.
  const lbFinal = add('L', lbRound, waiting[0], { type: 'loser', ref: wbFinalKey });
  const losersFinalRound = lbRound;
  lbRounds.push([lbFinal.key]);

  // ---- grand final + reset game ----
  const gf1 = add('G', 0, { type: 'winner', ref: wbFinalKey }, { type: 'winner', ref: lbFinal.key });
  const gf2 = add('G', 1, { type: 'winner', ref: gf1.key }, { type: 'loser', ref: gf1.key });

  return {
    n,
    B,
    byeCount: B - n,
    matches,
    wbRounds: K,
    lbRounds: lbRounds.length,
    losersFinalRound,
    wbFinalKey,
    lbFinalKey: lbFinal.key,
    gf1Key: gf1.key,
    gf2Key: gf2.key,
  };
}

// Resolve every match's slots to team ids, in creation order.
// matches: lib-style matches (key, bracket, round, slot1, slot2, score1,
// score2). seedToTeamId: Map seed -> team id.
// Returns Map key -> { team1Id, team2Id, winnerId, loserId, ready, active,
// scored }. `ready` means both teams are known; `active` is false only for
// a reset game that is not needed (the winners-bracket champion won the
// first grand final).
function resolveBracket(matches, seedToTeamId) {
  const resolved = new Map();
  let gf1 = null;
  for (const m of matches) {
    const slotTeam = (slot) => {
      if (slot.type === 'seed') return seedToTeamId.get(slot.ref) ?? null;
      const r = resolved.get(slot.ref);
      if (!r) return null;
      return slot.type === 'winner' ? r.winnerId : r.loserId;
    };
    const team1Id = slotTeam(m.slot1);
    const team2Id = slotTeam(m.slot2);
    let winnerId = null;
    let loserId = null;
    if (m.score1 != null && m.score2 != null) {
      if (m.score1 > m.score2) {
        winnerId = team1Id;
        loserId = team2Id;
      } else {
        winnerId = team2Id;
        loserId = team1Id;
      }
    }
    const ready = team1Id != null && team2Id != null;
    let active = true;
    if (m.bracket === 'G' && m.round === 1) {
      // Reset game: active only when the first grand final is decided and
      // its winner came from the losers side (GF1 slot2 is the losers
      // champion, so winner === team2Id means the losers champion won).
      active = !!(gf1 && gf1.winnerId != null && gf1.winnerId === gf1.team2Id);
    }
    const r = {
      team1Id,
      team2Id,
      winnerId,
      loserId,
      ready,
      active,
      scored: m.score1 != null,
    };
    resolved.set(m.key, r);
    if (m.bracket === 'G' && m.round === 0) gf1 = r;
  }
  return resolved;
}

// Who stands where, from resolved matches. Returns
// { champion, runnerUp, third } (team ids, null until decided).
// 3rd = loser of the Losers Final. The champion is the reset-game winner
// when one was played, else the first grand final's winner — but only once
// the grand final is actually decided (if the losers champion won GF1, the
// champion is undecided until the reset game).
function computeBracketPlaces(matches, resolved) {
  // No matches yet (night still in setup, not built): nothing is decided.
  if (!matches.length) return { champion: null, runnerUp: null, third: null };
  const gf1 = matches.find((m) => m.bracket === 'G' && m.round === 0);
  const gf2 = matches.find((m) => m.bracket === 'G' && m.round === 1);
  const lbRounds = matches.filter((m) => m.bracket === 'L').map((m) => m.round);
  const lbFinalRound = lbRounds.length ? Math.max(...lbRounds) : null;
  const lbFinal = lbFinalRound == null ? null : matches.find((m) => m.bracket === 'L' && m.round === lbFinalRound);
  if (!gf1 || !gf2 || !lbFinal) return { champion: null, runnerUp: null, third: null };
  const r1 = resolved.get(gf1.key);
  const r2 = resolved.get(gf2.key);
  const rl = resolved.get(lbFinal.key);
  let champion = null;
  let runnerUp = null;
  if (r2.winnerId != null) {
    champion = r2.winnerId;
    runnerUp = r2.loserId;
  } else if (r1.winnerId != null && r1.winnerId === r1.team1Id) {
    // Winners-bracket champion won the first grand final — no reset game.
    champion = r1.winnerId;
    runnerUp = r1.loserId;
  }
  return { champion, runnerUp, third: rl.loserId };
}

// Per-team win/loss record from resolved matches, for the pot card.
// teamIds: array of team ids. Returns [{ teamId, w, l, played }].
function computeBracketRecords(matches, resolved, teamIds) {
  const rec = new Map(teamIds.map((id) => [id, { teamId: id, w: 0, l: 0, played: 0 }]));
  for (const m of matches) {
    const r = resolved.get(m.key);
    if (!r || r.winnerId == null) continue;
    const w = rec.get(r.winnerId);
    const l = rec.get(r.loserId);
    if (w) {
      w.w += 1;
      w.played += 1;
    }
    if (l) {
      l.l += 1;
      l.played += 1;
    }
  }
  return [...rec.values()];
}

// Every match that depends on matchKey, transitively — used when a score
// is changed or cleared, so later results never stand on teams that no
// longer advanced. matches are lib-style (slot refs point at keys).
function dependentMatchKeys(matches, matchKey) {
  const byKey = new Map(matches.map((m) => [m.key, m]));
  const out = [];
  const seen = new Set([matchKey]);
  const queue = [matchKey];
  while (queue.length) {
    const cur = queue.shift();
    for (const m of matches) {
      if (seen.has(m.key)) continue;
      const refs = [m.slot1, m.slot2];
      if (refs.some((s) => s.type !== 'seed' && s.ref === cur)) {
        seen.add(m.key);
        out.push(m.key);
        queue.push(m.key);
      }
    }
  }
  return out;
}

module.exports = {
  BRACKET_SIZES,
  nextPow2,
  seedOrder,
  pairCross,
  buildBracket,
  resolveBracket,
  computeBracketPlaces,
  computeBracketRecords,
  dependentMatchKeys,
};

'use strict';
// Round Robin — pure logic (no DB): schedule building, team standings and
// money-ball payouts. Kept dependency-free so it can be unit-tested with
// plain node.
//
// Schedule: fixed doubles teams stay together all night. Every team plays
// every other team once (circle method). One game to 11, win by 2, per
// match — the same single-game shape as a league match. Each match gets its
// own court (2 teams to a court). With an odd team count one team sits out
// each round (a rotating bye, derived from the schedule — no bye rows are
// stored); the night stays a round robin, not a bracket.
//
// Standings: ranked by E/P percentage (points earned / possible), tie-break
// match wins — the same ordering as league standings. With win-by-2 a game
// can run past 11 (12-10, 13-11), so "possible" for a match is the winning
// score — that keeps E/P at or below 100%.
//
// Payouts: the pot is players x entry fee. The House Rule (the default)
// pays 3rd place its team entry fee back and splits the rest 60/40 between
// 1st and 2nd. The other structures are the standard splits from the table
// Alan sent (winner-take-all, 60/40, 66.7/33.3, 50/30/20, 40/30/20/10),
// paid as percentages of the pot. Amounts are integer cents; 1st place
// absorbs any rounding remainder so the payouts always sum to the pot.

const PAYOUTS = [
  {
    id: 'house',
    label: 'House rule — 3rd gets entry back, 1st & 2nd split the rest 60/40',
    house: true,
  },
  { id: 'winner-take-all', label: 'Winner-take-all — 100%', shares: [1] },
  { id: 'top-two-60-40', label: 'Top-two — 60/40', shares: [0.6, 0.4] },
  { id: 'top-two-66-33', label: 'Top-two — 66.7/33.3', shares: [2 / 3, 1 / 3] },
  { id: 'top-three-50-30-20', label: 'Top-three — 50/30/20', shares: [0.5, 0.3, 0.2] },
  { id: 'top-four-40-30-20-10', label: 'Top-four — 40/30/20/10', shares: [0.4, 0.3, 0.2, 0.1] },
];

function payoutById(id) {
  return PAYOUTS.find((p) => p.id === id) || PAYOUTS[0];
}

// teamIds: array of team ids (any order). Returns matches in round order:
// [{ round, court, team1Id, team2Id, target: 11 }].
function buildSchedule(teamIds) {
  const teams = [...teamIds];
  if (teams.length < 2) return [];
  const odd = teams.length % 2 === 1;
  if (odd) teams.push(null); // bye dummy
  const n = teams.length;
  const arr = [...teams];
  const out = [];
  for (let r = 0; r < n - 1; r++) {
    let court = 1;
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a != null && b != null) {
        out.push({ round: r + 1, court: court++, team1Id: a, team2Id: b, target: 11 });
      }
      // One side null means the other team sits out this round (bye).
    }
    // Circle method: keep the first team fixed, rotate the rest.
    arr.splice(1, 0, arr.pop());
  }
  return out;
}

// Win-by-2 score rule for a game to `target` (11). Returns an error message
// when the score cannot stand, else null. Used by the score endpoint and
// mirrored on the client; unit-tested here.
function scoreError(score1, score2, target) {
  if (score1 == null || score2 == null) return 'Enter both scores.';
  if (score1 === score2) return 'Scores cannot tie.';
  const hi = Math.max(score1, score2);
  const lo = Math.min(score1, score2);
  if (hi < target) return `One side must reach ${target} (games to ${target}).`;
  if (hi - lo < 2) return `Win by 2 — ${hi}-${lo} is not enough. Play on.`;
  return null;
}

// teams: [{ id, player1, player2 }]. matches: rows with team1_id, team2_id,
// score1, score2, target_score. Returns ranked rows:
// [{ team, rank, w, l, played, earned, against, possible, ep }].
function computeStandings(teams, matches) {
  const byId = new Map(
    teams.map((t) => [
      t.id,
      { team: t, w: 0, l: 0, played: 0, earned: 0, against: 0, possible: 0 },
    ])
  );
  for (const m of matches) {
    if (m.score1 == null || m.score2 == null) continue;
    const a = byId.get(m.team1_id);
    const b = byId.get(m.team2_id);
    if (!a || !b) continue;
    // Win-by-2: a game can run past 11, so "possible" is the winning score
    // of that game — E/P never exceeds 100%.
    const possible = Math.max(m.score1, m.score2);
    a.played += 1;
    b.played += 1;
    a.possible += possible;
    b.possible += possible;
    a.earned += m.score1;
    a.against += m.score2;
    b.earned += m.score2;
    b.against += m.score1;
    if (m.score1 > m.score2) {
      a.w += 1;
      b.l += 1;
    } else {
      b.w += 1;
      a.l += 1;
    }
  }
  const rows = [...byId.values()].map((r) => ({
    ...r,
    ep: r.possible > 0 ? r.earned / r.possible : null,
  }));
  rows.sort(
    (x, y) => (y.ep ?? -1) - (x.ep ?? -1) || y.w - x.w || x.team.id - y.team.id
  );
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  return rows;
}

// Money-ball payouts. All amounts are integer cents.
// { kind: 'charity'|'money', feeCents, payoutId, teamCount }
// Returns { potCents, places: [{ place, amountCents, note? }] } or null for
// charity nights. Places are only listed when that many teams exist.
function computePayouts({ kind, feeCents, payoutId, teamCount }) {
  if (kind !== 'money' || !teamCount || teamCount < 2 || !feeCents) return null;
  const pot = teamCount * 2 * feeCents;
  const def = payoutById(payoutId);
  if (def.house) {
    if (teamCount >= 3) {
      const third = 2 * feeCents; // the team gets its entry fee back
      const rest = pot - third;
      const first = Math.round(rest * 0.6);
      return {
        potCents: pot,
        places: [
          { place: 1, amountCents: first },
          { place: 2, amountCents: rest - first },
          { place: 3, amountCents: third, note: 'Entry fee back' },
        ],
      };
    }
    const first = Math.round(pot * 0.6);
    return {
      potCents: pot,
      places: [
        { place: 1, amountCents: first },
        { place: 2, amountCents: pot - first },
      ],
    };
  }
  const shares = def.shares;
  const amounts = shares.map((s) => Math.round(pot * s));
  // Only pay places that exist; unclaimed shares roll to 1st.
  const paid = amounts
    .map((amountCents, i) => ({ place: i + 1, amountCents }))
    .filter((p) => p.place <= teamCount);
  const unclaimed = amounts
    .slice(teamCount)
    .reduce((sum, a) => sum + a, 0);
  const allocated = paid.reduce((sum, p) => sum + p.amountCents, 0);
  if (paid.length) paid[0].amountCents += unclaimed + (pot - allocated - unclaimed);
  return { potCents: pot, places: paid };
}

module.exports = { PAYOUTS, payoutById, buildSchedule, computeStandings, computePayouts, scoreError };

'use strict';
// Standings math (spec):
//   E/P Diff% = Earned / Possible * 100. Rank by E/P Diff% − Penalty.
//   Tie-break: Match Wins, then higher ranked previous week.
//   Miss penalty (automatic): 1st miss free, 2nd 2.5, 3rd 5.0, each
//   further +2.5. Only sessions on/after the day the player joined the
//   roster count. Admin can add a manual adjustment on top.
//   Max Movement Rule: 20% of league size, floored (7 for a 36-player
//   league). The Y flag marks a player who moved the maximum in either
//   direction OR did not play that week; absent players CANNOT move up.
//   First game night seeding: by DUPR rating, highest to lowest, until
//   the first session is completed; then E/P governs.
//
// Inputs:
//   league: { id, max_players }
//   roster: [{ person_id, name, dupr_id, dupr_rating, joined_at (Date),
//              admin_penalty }]
//   sessions: [{ id, date (YYYY-MM-DD), status ('completed'|'in_progress'),
//                attendees: Set<person_id>,
//                matches: [{ kind, team1_p1, team1_p2, team2_p1, team2_p2,
//                            score1, score2, target_score }] }]
//     Only sessions that have started (completed or in_progress) are passed.
//   prevSnapshot: Map<person_id, rank> from the completed session BEFORE
//     the latest completed one (that is what "Previous" reads).
//   latestCompleted: the most recent completed session { attendees } or null.
//   currentAttendees: Set<person_id> opted in for the current game day
//     (earliest non-completed session), or null when there is none.
//
// Standings are computed from scored matches in completed or in-progress
// sessions, so they move live during a night and are final once finished.

function maxMovement(maxPlayers) {
  return Math.floor(maxPlayers * 0.2);
}

function computeStandings({ league, roster, sessions, prevSnapshot, latestCompleted, currentAttendees }) {
  const maxMove = maxMovement(league.max_players || 36);
  const hasCompleted = sessions.some((s) => s.status === 'completed');

  const rows = roster.map((p) => {
    let earned = 0;
    let against = 0;
    let possible = 0;
    let wins = 0;
    let losses = 0;
    let played = 0;
    for (const s of sessions) {
      const optedIn = s.attendees.has(p.person_id);
      if (optedIn) played += 1;
      for (const m of s.matches) {
        if (m.kind !== 'match') continue;
        if (m.score1 == null || m.score2 == null) continue;
        const onT1 = m.team1_p1 === p.person_id || m.team1_p2 === p.person_id;
        const onT2 = m.team2_p1 === p.person_id || m.team2_p2 === p.person_id;
        if (!onT1 && !onT2) continue;
        const mine = onT1 ? m.score1 : m.score2;
        const theirs = onT1 ? m.score2 : m.score1;
        earned += mine;
        against += theirs;
        possible += m.target_score;
        if (mine > theirs) wins += 1;
        else if (mine < theirs) losses += 1;
      }
    }

    const joinedDate = new Date(p.joined_at).toISOString().slice(0, 10);
    let missed = 0;
    for (const s of sessions) {
      if (s.status !== 'completed') continue;
      if (s.date < joinedDate) continue; // only sessions on/after joining count
      if (!s.attendees.has(p.person_id)) missed += 1;
    }
    const missPenalty = Math.max(0, missed - 1) * 2.5;
    const penalty = missPenalty + Number(p.admin_penalty || 0);
    const epDiff = possible > 0 ? (earned / possible) * 100 : 0;

    return {
      person_id: p.person_id,
      name: p.name,
      dupr_id: p.dupr_id,
      dupr_rating: p.dupr_rating == null ? null : Number(p.dupr_rating),
      earned,
      against,
      possible,
      wins,
      losses,
      played,
      missed,
      missPenalty,
      penalty,
      epDiff,
      score: epDiff - penalty,
      previous: prevSnapshot && prevSnapshot.has(p.person_id) ? prevSnapshot.get(p.person_id) : null,
      missCurGameDay: currentAttendees ? !currentAttendees.has(p.person_id) : false,
      rank: null,
      maxMvmt: null,
    };
  });

  if (!hasCompleted) {
    // First-night seeding: DUPR rating highest to lowest; unrated below.
    rows.sort((a, b) => {
      const ra = a.dupr_rating == null ? -1 : a.dupr_rating;
      const rb = b.dupr_rating == null ? -1 : b.dupr_rating;
      return rb - ra || a.name.localeCompare(b.name);
    });
    rows.forEach((r, i) => {
      r.rank = i + 1;
      r.maxMvmt = null;
    });
    return rows;
  }

  // Raw order: score desc, wins desc, previous rank asc, DUPR desc, name.
  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.wins !== a.wins) return b.wins - a.wins;
    const pa = a.previous == null ? Infinity : a.previous;
    const pb = b.previous == null ? Infinity : b.previous;
    if (pa !== pb) return pa - pb;
    const ra = a.dupr_rating == null ? -1 : a.dupr_rating;
    const rb = b.dupr_rating == null ? -1 : b.dupr_rating;
    if (rb !== ra) return rb - ra;
    return a.name.localeCompare(b.name);
  });

  const absentLatest = latestCompleted
    ? new Set(rows.filter((r) => !latestCompleted.attendees.has(r.person_id)).map((r) => r.person_id))
    : new Set();

  // Assign final ranks. Sort key is the raw position, except an absent
  // player sorts no higher than their previous rank (absent players cannot
  // move up). Then repair: any absent player still ranked above their
  // previous rank swaps places with the player at their previous rank.
  // The repair terminates because snapshot ranks are unique, so a fixed
  // absent player can never be displaced by another repair.
  const keyed = rows.map((r, idx) => {
    const key = absentLatest.has(r.person_id) && r.previous != null
      ? Math.max(idx, r.previous - 1)
      : idx;
    return { r, idx, key };
  });
  keyed.sort((a, b) => a.key - b.key || a.idx - b.idx);
  keyed.forEach((k, i) => { k.r.rank = i + 1; });
  for (const { r } of keyed) {
    if (r.previous == null) continue;
    if (!absentLatest.has(r.person_id)) continue;
    if (r.rank >= r.previous) continue;
    const other = rows.find((x) => x.rank === r.previous);
    if (!other) continue;
    other.rank = r.rank;
    r.rank = r.previous;
  }
  for (const r of rows) {
    if (r.previous == null) {
      r.maxMvmt = null;
    } else if (absentLatest.has(r.person_id) || Math.abs(r.rank - r.previous) >= maxMove) {
      r.maxMvmt = 'Y';
    } else {
      r.maxMvmt = '';
    }
  }

  rows.sort((a, b) => a.rank - b.rank);
  return rows;
}

module.exports = { computeStandings, maxMovement };

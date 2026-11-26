// Player matches view — the league game-day Matches tab shows ALL of a
// player's games in order (not just the match now playing), each with a
// Score Match tab; tapping it opens the score view, and saving returns
// to the list with the just-played match shown scored (winning team
// green, losing team red) and the next match marked UP NOW.
//
// The shared helpers in public/app.js are extracted and run as the real
// client code, following the scripts/test-medals.js pattern.
// Run: node scripts/test-player-matches.js
const assert = require('assert');
const fs = require('fs');

let count = 0;
function check(cond, label) {
  count++;
  assert.ok(cond, label);
}

const appJs = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
const css = fs.readFileSync(require.resolve('../public/styles.css'), 'utf8');

// --- Extract the real helpers from the client source and run them ---
const block = appJs.match(/\/\/ ---------- Player matches view \(shared helpers\) ----------[\s\S]*?\/\/ ---------- \/Player matches view ----------/);
assert.ok(block, 'player matches helper block must exist in public/app.js');
const helpers = eval(`(function () { ${block[0]}\n; return { courtMembersInOrder, courtNumbers, courtMemberIds, firstUnscoredMatch, isLastMatch, saveBarLabel, validateLeagueScores }; })()`);
for (const name of ['courtMembersInOrder', 'courtNumbers', 'courtMemberIds', 'firstUnscoredMatch', 'isLastMatch', 'saveBarLabel', 'validateLeagueScores']) {
  check(typeof helpers[name] === 'function', `${name} is a function`);
}
const { courtMembersInOrder, courtNumbers, courtMemberIds, firstUnscoredMatch, isLastMatch, saveBarLabel, validateLeagueScores } = helpers;

// --- Court numbers follow rank (seating) order, not group order ---
// Preview night: Court 1 of 5 in standings order Alan, Sydnee, Stew,
// Wilson, Dawn. The Groups list orders them by first appearance in the
// matches (bye first, then the round-1 teams), so the numbers must come
// from the rank-ordered playing list, not from the group order.
const playing = [
  { person_id: 1, name: 'Alan Cortez' },
  { person_id: 2, name: 'Sydnee Dalton' },
  { person_id: 3, name: 'Stew Meridian' },
  { person_id: 4, name: 'Wilson Hulett' },
  { person_id: 5, name: 'Dawn Smith' },
];
const groupOrder = [1, 2, 4, 3, 5]; // bye Alan, then round-1 teams Sydnee/Wilson, Stew/Dawn
check(JSON.stringify(courtMembersInOrder(playing, groupOrder)) === JSON.stringify([1, 2, 3, 4, 5]),
  'court order is the rank order (Alan 1, Sydnee 2, Stew 3, Wilson 4, Dawn 5), not the group first-appearance order');
const nums = courtNumbers(playing, groupOrder);
check(nums.get(1) === 1 && nums.get(2) === 2 && nums.get(3) === 3 && nums.get(4) === 4 && nums.get(5) === 5,
  'courtNumbers maps each player to 1..5 in court order');
check(nums.size === 5, 'courtNumbers has one number per court member');
// A member missing from the playing list still gets a number, last.
const numsGap = courtNumbers(playing.slice(0, 4), [1, 2, 3, 4, 5]);
check(numsGap.get(5) === 5, 'member missing from playing list is numbered last, not dropped');

// --- Court members come from Groups when present, else from matches ---
const groups = [{ court: 1, players: groupOrder.map((id) => ({ person_id: id })) }];
check(JSON.stringify(courtMemberIds(groups, [], 1)) === JSON.stringify(groupOrder),
  'courtMemberIds reads the court members from Groups');
const fiveMatches = [
  { id: 11, court: 1, round: 1, kind: 'bye', bye_person_id: 1, target_score: 15 },
  { id: 12, court: 1, round: 1, kind: 'match', team1_p1: 2, team1_p2: 3, team2_p1: 4, team2_p2: 5, target_score: 15, score1: null, score2: null },
];
check(JSON.stringify(courtMemberIds(null, fiveMatches, 1)) === JSON.stringify([1, 2, 3, 4, 5]),
  'courtMemberIds falls back to the players on the court matches (bye + teams) when Groups is missing');
// A 6-player court has 2 byes per round — both are members.
const sixMatches = [
  { id: 21, court: 2, round: 1, kind: 'bye', bye_person_id: 6, target_score: 10 },
  { id: 22, court: 2, round: 1, kind: 'bye', bye_person_id: 7, target_score: 10 },
  { id: 23, court: 2, round: 1, kind: 'match', team1_p1: 8, team1_p2: 9, team2_p1: 10, team2_p2: 11, target_score: 10, score1: null, score2: null },
];
check(JSON.stringify(courtMemberIds(null, sixMatches, 2)) === JSON.stringify([6, 7, 8, 9, 10, 11]),
  'courtMemberIds includes both bye players on a 6-player court');

// --- First unscored match is the one up; save bar label by position ---
const mk = (id, round, s1, s2) => ({ id, court: 1, round, kind: 'match', target_score: 15, score1: s1, score2: s2 });
const games = [mk(101, 1, null, null), mk(102, 2, null, null), mk(103, 3, null, null), mk(104, 4, null, null), mk(105, 5, null, null)];
check(firstUnscoredMatch(games).id === 101, 'first unscored is Match 1 at the start');
const afterOne = [mk(101, 1, 15, 9), mk(102, 2, null, null), mk(103, 3, null, null), mk(104, 4, null, null), mk(105, 5, null, null)];
check(firstUnscoredMatch(afterOne).id === 102, 'after Match 1 is scored, the first unscored is Match 2');
check(firstUnscoredMatch(afterOne.map((m) => ({ ...m, score1: 15, score2: 9 }))) === null, 'no unscored match once all are scored');
check(isLastMatch(games, games[4]) === true, 'Match 5 is the last match');
check(isLastMatch(games, games[0]) === false, 'Match 1 is not the last match');
check(saveBarLabel(games, games[0]) === 'SAVE — NEXT MATCH', 'Match 1 save bar says SAVE — NEXT MATCH');
check(saveBarLabel(games, games[4]) === 'SAVE — FINISH THE NIGHT', 'last match save bar says SAVE — FINISH THE NIGHT');

// --- Score validation is unchanged (both scores, 0–30 ints, no tie,
// winner reaches the target exactly) ---
check(validateLeagueScores(15, 9, 15) === null, '15–9 to 15 is valid');
check(validateLeagueScores(20, 18, 20) === null, '20–18 to 20 is valid');
check(validateLeagueScores(10, 3, 10) === null, '10–3 to 10 is valid');
check(validateLeagueScores(null, 9, 15) === 'Enter both scores.', 'missing score is rejected');
check(validateLeagueScores(15, null, 15) === 'Enter both scores.', 'missing score is rejected (other side)');
check(validateLeagueScores(15.5, 9, 15) === 'Scores must be whole numbers from 0 to 30.', 'non-integer is rejected');
check(validateLeagueScores(15, 31, 15) === 'Scores must be whole numbers from 0 to 30.', 'score above 30 is rejected');
check(validateLeagueScores(-1, 15, 15) === 'Scores must be whole numbers from 0 to 30.', 'negative score is rejected');
check(validateLeagueScores(12, 12, 15) === 'Scores cannot tie.', 'tie is rejected');
check(validateLeagueScores(14, 12, 15) === 'One side must reach 15 (games to 15).', 'winner short of target is rejected');
check(validateLeagueScores(16, 9, 15) === 'One side must reach 15 (games to 15).', 'winner past target is rejected');

// --- The list renders every match in order (source-level) ---
const rm = appJs.match(/function renderMatches\([\s\S]*?\n}\n/);
assert.ok(rm, 'renderMatches must exist');
check(rm[0].includes('Score Match'), 'renderMatches renders a Score Match tab on each match');
check(rm[0].includes('UP NOW'), 'renderMatches marks the match now playing UP NOW');
check(rm[0].includes('Court ${court} · ${numbers.size} Players'), 'renderMatches shows a per-court header with the player count');
check(rm[0].includes('courtGames.map((m) => cardHtml'), 'renderMatches renders every match on the court, in order');
check(!rm[0].includes('const current = games.find'), 'renderMatches no longer renders only the first unscored match');
check(!rm[0].includes('<h3>Finished</h3>'), 'renderMatches no longer splits scored matches under a Finished heading');
check(rm[0].includes('rr-team-win') && rm[0].includes('rr-team-lose'), 'scored matches use the normal green/red team panels');
check(rm[0].includes('byesForRound(m.court, m.round)'), 'every round shows its own bye row(s), not just the first bye found');

// --- The score view shows the preview layout (source-level) ---
const sv = appJs.match(/function renderScoreView\([\s\S]*?\n}\n/);
assert.ok(sv, 'renderScoreView must exist');
check(sv[0].includes('1 to ${m.target_score} by 1'), 'score view says "1 to {target} by 1"');
check(sv[0].includes('class="save-bar"'), 'score view save is the yellow SAVE bar');
check(sv[0].includes('saveBarLabel(opts.games || [], m)'), 'save bar label comes from the match position (NEXT MATCH / FINISH THE NIGHT)');
check(sv[0].includes('match-bye'), 'score view shows the light-yellow BYE row for that match');
check(sv[0].includes('validateLeagueScores(n1, n2, m.target_score)'), 'score view validates through the shared helper');
check(sv[0].includes("id=\"svClear\""), 'score view keeps the Clear button for a scored match');
check(sv[0].includes("scoreMatchId = null;\n      renderGameDay(leagueId, sessionId);"), 'saving returns to the Matches list (scoreMatchId cleared, game day re-rendered)');

// --- CSS for the new pieces ---
for (const cls of ['.up-badge', '.score-tab', '.match-bye', '.save-bar', '.match-head', '.match-title']) {
  check(css.includes(cls), `styles.css defines ${cls}`);
}
check(css.includes('.match-bye { background: #fff8e1;'), 'BYE row is light yellow');
check(css.includes('.save-bar { display: block; width: 100%; background: var(--yellow); color: var(--black);'), 'SAVE bar is full-width yellow with dark text');

// --- Untouched: round-robin and bracket keep their own SCORE flows ---
check(appJs.includes('data-rr-score'), 'round-robin/bracket SCORE buttons still use data-rr-score');
check(appJs.includes('// the round in play gets SCORE buttons on its unplayed matches.'), 'round-robin SCORE-gating comment is untouched');
check((appJs.match(/data-rr-score/g) || []).length >= 4, 'round-robin and bracket still wire their own score buttons');
check(appJs.includes('renderRREvent') && appJs.includes('renderBrEvent'), 'round-robin and bracket renders still exist');

console.log(`\nAll player-matches tests passed (${count} assertions).`);
process.exit(0);

'use strict';
// Headless tests for the bracket-tree layout helper (brTreeColumns in
// public/app.js). Run: node scripts/test-br-tree.js
// No DB, no browser — the helper is pure, so it is pulled out of app.js
// by brace matching and run against the real Friday Night data (event 2:
// 8 teams, all 15 matches scored) plus synthetic 4-team and 12-team shapes.
const fs = require('fs');

let failures = 0;
function check(cond, label) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  }
}

const src = fs.readFileSync(`${__dirname}/../public/app.js`, 'utf8');
function extractFn(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found in app.js`);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}
const factory = new Function(
  `${extractFn('brNextPow2')}\n${extractFn('brRoundTitle')}\n${extractFn('brTreeColumns')}\nreturn { brNextPow2, brRoundTitle, brTreeColumns };`,
);
const { brRoundTitle, brTreeColumns } = factory();

// Build roundGroups exactly the way renderBrEvent does.
function buildGroups(matches, n) {
  const maxWbRound = Math.max(-1, ...matches.filter((m) => m.bracket === 'W').map((m) => m.round));
  const maxLbRound = Math.max(-1, ...matches.filter((m) => m.bracket === 'L').map((m) => m.round));
  const groups = [];
  for (const br of ['W', 'L', 'G']) {
    const rounds = [...new Set(matches.filter((m) => m.bracket === br).map((m) => m.round))].sort((a, b) => a - b);
    for (const r of rounds) {
      const ms = matches.filter((m) => m.bracket === br && m.round === r);
      groups.push({
        bracket: br,
        round: r,
        matches: ms,
        title: brRoundTitle(br, r, ms.length, n, br === 'W' && r === maxWbRound, br === 'L' && r === maxLbRound),
      });
    }
  }
  return groups;
}
const mk = (bracket, round, gameNo, t1, t2, s1, s2) => ({ bracket, round, game_no: gameNo, team1_id: t1, team2_id: t2, score1: s1, score2: s2 });

// --- Friday Night, event 2 (live data, verified 2026-11-25) ---
// Teams: 5 Alan & Laura (#1), 6 Kim & Justin (#2), 7 Kari & Bryan (#3),
// 8 Dawn & Allen (#4), 9 Stew & Sydnee (#5), 10 Lacey & Chris (#6),
// 11 Caroline & Oscar (#7), 12 Micheal & Raley (#8).
{
  const matches = [
    mk('W', 0, 1, 5, 12, 11, 9), mk('W', 0, 2, 8, 9, 6, 11), mk('W', 0, 3, 6, 11, 9, 11), mk('W', 0, 4, 7, 10, 11, 7),
    mk('W', 1, 1, 5, 9, 8, 11), mk('W', 1, 2, 11, 7, 5, 11),
    mk('W', 2, 1, 9, 7, 7, 11),
    mk('L', 0, 1, 12, 10, 5, 11), mk('L', 0, 2, 8, 6, 7, 11),
    mk('L', 1, 1, 10, 11, 5, 11), mk('L', 1, 2, 6, 5, 8, 11),
    mk('L', 2, 1, 11, 5, 7, 11),
    mk('L', 3, 1, 5, 9, 9, 11),
    mk('G', 0, 1, 7, 9, 6, 11),
    mk('G', 1, 1, 9, 7, 6, 11),
  ];
  const cols = brTreeColumns(buildGroups(matches, 8));
  check(cols.length === 8, 'Friday: 8 columns');
  check(
    cols.map((c) => c.head).join('|') ===
      'Winners Quarterfinal|Winners Semifinal|Winners Final|Losers Round 1|Losers Round 2|Losers Round 3|Losers Final|Grand Final',
    `Friday: column heads in order (got ${cols.map((c) => c.head).join('|')})`,
  );
  check(cols.map((c) => c.matches.length).join(',') === '4,2,1,2,2,1,1,2', `Friday: match counts 4,2,1,2,2,1,1,2 (got ${cols.map((c) => c.matches.length).join(',')})`);
  check(
    cols.reduce((n, c) => n + c.matches.length, 0) === 15,
    'Friday: all 15 matches in the tree',
  );
  check(
    cols.map((c) => (c.vertical ? '1' : '0')).join('') === '01100000',
    `Friday: vertical elbows only on the two clean winners feeds (got ${cols.map((c) => (c.vertical ? '1' : '0')).join('')})`,
  );
  const gf = cols.find((c) => c.bracket === 'G');
  check(gf && gf.matches.length === 2, 'Friday: grand-final column holds both games');
  check(
    gf && gf.matches[0].round === 0 && gf.matches[0].score1 === 6 && gf.matches[0].score2 === 11 &&
      gf.matches[1].round === 1 && gf.matches[1].score1 === 6 && gf.matches[1].score2 === 11,
    'Friday: grand-final column is GF1 (6–11) then the reset game (6–11), in order',
  );
  check(
    cols.filter((c) => c.bracket === 'W').length === 3 && cols.filter((c) => c.bracket === 'L').length === 4,
    'Friday: 3 winners columns, 4 losers columns (grid is 3+2 vs 4+2)',
  );
}

// --- 4-team night (synthetic) ---
{
  const matches = [
    mk('W', 0, 1, 1, 4, 11, 5), mk('W', 0, 2, 2, 3, 11, 9),
    mk('W', 1, 1, 1, 2, 11, 7),
    mk('L', 0, 1, 4, 3, 11, 8),
    mk('L', 1, 1, 3, 2, 11, 6),
    mk('G', 0, 1, 1, 3, 11, 4),
  ];
  const cols = brTreeColumns(buildGroups(matches, 4));
  check(cols.length === 5, '4-team: 5 columns');
  check(
    cols.map((c) => c.head).join('|') === 'Winners Semifinal|Winners Final|Losers Round 1|Losers Final|Grand Final',
    `4-team: column heads in order (got ${cols.map((c) => c.head).join('|')})`,
  );
  check(cols.map((c) => c.matches.length).join(',') === '2,1,1,1,1', '4-team: match counts 2,1,1,1,1');
  check(cols.map((c) => (c.vertical ? '1' : '0')).join('') === '01000', '4-team: vertical elbow only on the winners final');
}

// --- 12-team shape (fabricated counts): the play-in breaks the clean
// two-to-one feed, so the first winners step draws no elbow.
{
  const fake = (bracket, round, count) => ({
    bracket,
    round,
    title: `${bracket}${round}`,
    matches: Array.from({ length: count }, (_, i) => ({ id: `${bracket}${round}-${i}` })),
  });
  const groups = [
    fake('W', 0, 4), fake('W', 1, 4), fake('W', 2, 2), fake('W', 3, 1),
    fake('L', 0, 4), fake('L', 1, 4), fake('L', 2, 2), fake('L', 3, 2), fake('L', 4, 1), fake('L', 5, 1),
    fake('G', 0, 1), fake('G', 1, 1),
  ];
  const cols = brTreeColumns(groups);
  check(cols.length === 11, '12-team: 11 columns (4W + 6L + 1G)');
  check(
    cols.map((c) => (c.vertical ? '1' : '0')).join('') === '00110000000',
    `12-team: vertical elbows only where the winners feed is clean two-to-one (got ${cols.map((c) => (c.vertical ? '1' : '0')).join('')})`,
  );
  check(cols.find((c) => c.bracket === 'G').matches.length === 2, '12-team: grand-final column holds both games');
}

if (failures) {
  console.error(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('\nAll bracket tree tests passed.');

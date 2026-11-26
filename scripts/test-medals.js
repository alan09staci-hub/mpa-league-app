// Ribbon medals — the red-white-blue ribbon medal SVG replaces the plain
// gradient discs at every medal spot in the app.
//
// The shared helper medalSvg(place, detail) in public/app.js is ported
// from the ribbon-medals-preview artifact (approved 2026-11-25): a
// red-white-blue striped V-ribbon, a radial-gradient metal disc with a
// darker rim, a laurel wreath, small "MPA" lettering above the big place
// number. Night cards use detail 'mid' (disc 56px); Finished cards use
// 'small' (24px wide, laurel simplified). The waving-flag card
// backgrounds and the champion banner's trophy are untouched.
// Run: node scripts/test-medals.js
const assert = require('assert');
const fs = require('fs');

let count = 0;
function check(cond, label) {
  count++;
  assert.ok(cond, label);
}

const appJs = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
const css = fs.readFileSync(require.resolve('../public/styles.css'), 'utf8');

// --- Extract the real helper from the client source and run it ---
const block = appJs.match(/\/\/ ---------- Ribbon medals \(shared SVG\) ----------[\s\S]*?\/\/ ---------- \/Ribbon medals ----------/);
assert.ok(block, 'ribbon medal helper block must exist in public/app.js');
const medalSvg = eval(`(function () { ${block[0]}\n; return medalSvg; })()`);
check(typeof medalSvg === 'function', 'medalSvg is a function');

const RIBBON = ['#c0272d', '#f4f1ea', '#22408c']; // red, white, blue
const METALS = {
  1: { hi: '#ffe98a', deep: '#7a5200', name: 'gold' },
  2: { hi: '#ffffff', deep: '#54585e', name: 'silver' },
  3: { hi: '#ffc890', deep: '#63380f', name: 'bronze' },
};
for (const place of [1, 2, 3]) {
  const svg = medalSvg(place, 'mid');
  const metal = METALS[place];
  check(svg.startsWith('<svg viewBox="0 0 120 140"'), `place ${place} mid: svg has the 120x140 viewBox`);
  for (const c of RIBBON) check(svg.includes(`fill="${c}"`), `place ${place} mid: ribbon carries ${c}`);
  check(svg.includes('>MPA<'), `place ${place} mid: disc says MPA`);
  check(svg.includes(`>${place}<`), `place ${place} mid: disc shows the number ${place}`);
  check(svg.includes(metal.hi), `place ${place} mid: ${metal.name} highlight ${metal.hi}`);
  check(svg.includes(metal.deep), `place ${place} mid: ${metal.name} dark shade ${metal.deep} (MPA + number)`);
  check(svg.includes('radialGradient'), `place ${place} mid: disc uses a radial gradient`);
  check(svg.includes('font-size="11.5"'), `place ${place} mid: MPA at 11.5px`);
  check(svg.includes('font-size="34"'), `place ${place} mid: number at 34px`);
  // 5 leaves per side x 2 sides + 1 highlight ellipse = 11 ellipses.
  check((svg.match(/<ellipse/g) || []).length === 11, `place ${place} mid: 11 ellipses (10 laurel leaves + highlight)`);
  check(svg.includes('MPA</text>'), `place ${place} mid: MPA is text, not a copied image`);
}
// Small detail: laurel simplified (3 leaves per side), MPA/number kept.
const small = medalSvg(1, 'small');
check(small.includes('>MPA<'), 'place 1 small: disc says MPA');
check(small.includes('>1<'), 'place 1 small: disc shows the number 1');
check((small.match(/<ellipse/g) || []).length === 7, 'place 1 small: 7 ellipses (6 laurel leaves + highlight)');
check(small.includes('font-size="10.5"'), 'place 1 small: MPA at 10.5px');
check(small.includes('font-size="36"'), 'place 1 small: number at 36px');
check(medalSvg(3, 'small').includes('#63380f'), 'place 3 small: bronze dark shade');
// Gradient ids are unique per call (no duplicate-id collisions on a page
// that shows several medals at once).
const idA = medalSvg(1, 'mid').match(/id="g([^"]+)"/)[1];
const idB = medalSvg(1, 'mid').match(/id="g([^"]+)"/)[1];
check(idA !== idB, 'two medalSvg calls get different gradient ids');

// --- Every medal spot uses the helper; no plain gradient discs left ---
check((appJs.match(/medalSvg\(p\.place, 'mid'\)/g) || []).length === 3, '3 night spots use medalSvg(p.place, mid) — RR money pot + bracket money pot + bracket podium');
check((appJs.match(/medalSvg\(s\.rank, 'mid'\)/g) || []).length === 2, '2 night spots use medalSvg(s.rank, mid) — RR free-play leaders + rotating leaders');
check((appJs.match(/medalSvg\(i \+ 1, 'small'\)/g) || []).length === 1, 'Finished cards use medalSvg(i + 1, small)');
check(!appJs.includes('rr-medal m${'), 'no plain .rr-medal m1/m2/m3 disc markup remains');
check(!appJs.includes('fin-medal-${'), 'no plain .fin-medal-0/1/2 disc markup remains');
check(!appJs.includes('class="rr-medal m'), 'no old medal class with a metal suffix remains');
check(!appJs.includes('class="fin-medal fin-medal'), 'no old Finished medal class remains');

// --- CSS: preview sizes, no old gradient disc rules ---
check(css.includes('.rr-medal { width: 91px;'), 'styles.css sizes .rr-medal at 91px (disc renders 56px, the preview size)');
check(css.includes('.rr-medal svg'), 'styles.css sizes the SVG inside .rr-medal');
check(css.includes('.fin-medal { width: 24px;'), 'styles.css sizes .fin-medal at 24px (the preview small size)');
check(css.includes('.fin-medal svg'), 'styles.css sizes the SVG inside .fin-medal');
check(!css.includes('.rr-medal.m1'), 'no old .rr-medal.m1 gradient rule remains');
check(!css.includes('.rr-medal.m2'), 'no old .rr-medal.m2 gradient rule remains');
check(!css.includes('.rr-medal.m3'), 'no old .rr-medal.m3 gradient rule remains');
check(!css.includes('.fin-medal-0'), 'no old .fin-medal-0 gradient rule remains');
check(!css.includes('.fin-medal-1'), 'no old .fin-medal-1 gradient rule remains');
check(!css.includes('.fin-medal-2'), 'no old .fin-medal-2 gradient rule remains');

// --- Untouched: waving flag cards and champion banner trophy ---
check(appJs.includes('FLAG_WRAP_HTML'), 'flag card wrapper still exists');
check(appJs.includes('flagPauseBtnHtml'), 'flag Pause button still exists');
check((appJs.match(/BR_TROPHY_SVG/g) || []).length >= 3, 'champion banner trophy still defined and used');
check(appJs.includes('M32 13l1.7 3.4'), 'champion banner trophy SVG is unchanged (star path intact)');

console.log(`\nAll medal tests passed (${count} assertions).`);
process.exit(0);

// sms: links — the multi-recipient fix (2026-11-26).
//
// Alan reported the Thanksgiving note sent from Admin → Announce →
// "Custom message — pick who it goes to" (Everyone) only reached the
// FIRST person on the list. Root cause: the picked numbers were joined
// and only spaces stripped (phones.replace(/ /g, '')), so stored numbers
// like "(229) 555-1234" went into the URL as sms:(229)555-1234,(229)...
// and iOS Messages choked on the malformed addresses after the first.
// Stored numbers can carry formatting because only the Admin member-edit
// save strips to digits; the join / Become a Member forms store the
// number exactly as typed (server cleanStr only trims).
//
// The shared helper smsHref(phones, text) in public/app.js normalizes
// every number to digits only and uses Apple's documented multi-recipient
// form sms:/open?addresses={numbers}&body={text}; a single recipient
// keeps the plain sms:{number}?&body=... shape.
// Run: node scripts/test-sms-href.js
const assert = require('assert');
const fs = require('fs');

let count = 0;
function check(cond, label) {
  count++;
  assert.ok(cond, label);
}

const appJs = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');

// --- Extract the real helper from the client source and run it ---
const block = appJs.match(/\/\/ ---------- sms: links \(shared\) ----------[\s\S]*?\/\/ ---------- \/sms: links ----------/);
assert.ok(block, 'smsHref helper block must exist in public/app.js');
const smsHref = eval(`(function () { ${block[0]}\n; return smsHref; })()`);
check(typeof smsHref === 'function', 'smsHref is a function');

// --- The old failure case: formatted numbers, Everyone ---
const formatted = ['(229) 555-1234', '(229) 555-5678', '229-555-9012'];
const multi = smsHref(formatted, 'Happy Thanksgiving!');
check(multi === 'sms:/open?addresses=2295551234,2295555678,2295559012&body=Happy%20Thanksgiving!',
  `formatted list comes out digits-only, comma-separated: ${multi}`);
check(!/[()\- ]/.test(multi.split('&body=')[0]), 'multi-recipient addresses carry no parens, dashes or spaces');
check(multi.startsWith('sms:/open?addresses='), 'multi-recipient uses sms:/open?addresses= form');

// --- Single recipient: shape unchanged from before the fix ---
const single = smsHref(['(229) 555-1234'], 'Hi there');
check(single === 'sms:2295551234?&body=Hi%20there', `single recipient keeps plain sms: shape: ${single}`);
check(smsHref('(229) 555-1234', 'Hi') === 'sms:2295551234?&body=Hi', 'a bare string (not an array) works as one number');
check(smsHref(['2295551234'], 'Hi') === 'sms:2295551234?&body=Hi', 'already-digits number passes through unchanged');

// --- Body encoding ---
const encoded = smsHref(['2295551234', '2295555678'], 'Happy Thanksgiving! 🦃\n— MPA & friends');
check(encoded.includes('body=Happy%20Thanksgiving!%20%F0%9F%A6%83%0A%E2%80%94%20MPA%20%26%20friends'),
  'body is encodeURIComponent-encoded (spaces, newline, &, emoji)');
check(encoded.split('?addresses=')[1].split('&body=')[0] === '2295551234,2295555678',
  'body encoding does not touch the addresses');

// --- Normalization edge cases ---
check(smsHref(['1-229-555-1234', '+1 (229) 555-5678'], 'x') ===
  'sms:/open?addresses=12295551234,12295555678&body=x',
  'leading 1 / +1 kept as digits, formatting stripped');
check(smsHref(['(229) 555-1234', null, '', undefined], 'x') === 'sms:2295551234?&body=x',
  'empty / null entries are dropped, leaving the single-recipient shape');

// --- Escaping: the & in the multi-recipient URL survives esc() in an href ---
const escBlock = appJs.match(/function esc\(s\) \{[\s\S]*?\n\}/);
assert.ok(escBlock, 'esc helper must exist in public/app.js');
const esc = eval(`(function () { ${escBlock[0]}\n; return esc; })()`);
const hrefAttr = esc(smsHref(formatted, 'Happy Thanksgiving!'));
check(hrefAttr === 'sms:/open?addresses=2295551234,2295555678,2295559012&amp;body=Happy%20Thanksgiving!',
  `esc() renders the multi-recipient href with &amp;body=: ${hrefAttr}`);

// --- Call-site wiring: every multi-recipient text goes through the helper ---
check(!appJs.includes('phones.replace(/ /g, '), 'no phones.replace(/ /g, ...) remains anywhere in app.js');
check(!appJs.includes('sms:${phones'), 'no raw sms:${phones...} template remains');
check((appJs.match(/location\.href = smsHref\(phones, text\)/g) || []).length === 1,
  'custom-message Send by text uses smsHref(phones, text)');
check((appJs.match(/esc\(smsHref\(members\.filter\(\(m\) => m\.phone\)\.map\(\(m\) => m\.phone\), textDraft\)\)/g) || []).length === 3,
  'all three announce-draft Send by text anchors use smsHref (one-league, all-leagues, Join MPA)');
check(appJs.includes('location.href = smsHref([phone], text);'),
  'passcode reset uses smsHref([phone], text) — same single-recipient output as before');
check(appJs.includes("location.href = `sms:${num}?&body=${encodeURIComponent(document.getElementById('an-text-body').textContent)}`;"),
  'invite-someone-new single-recipient spot is untouched');
check((appJs.match(/function smsHref\(/g) || []).length === 1, 'exactly one smsHref definition');

console.log(`\nAll sms: link tests passed (${count} assertions).`);
process.exit(0);

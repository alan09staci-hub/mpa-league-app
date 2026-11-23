'use strict';
/* MPA League App — Phase 1 frontend (plain JS, mobile-first).
   Player identity is device-local: tap your name, it is remembered. */
const app = document.getElementById('app');
const modalRoot = document.getElementById('modalRoot');
const toastRoot = document.getElementById('toastRoot');

const YMCA_ADDR = 'YMCA, 601 26th Ave SE, Moultrie, GA 31768';
const MAPS_Q = encodeURIComponent(YMCA_ADDR);

function toast(msg) {
  toastRoot.innerHTML = `<div class="toast"></div>`;
  toastRoot.firstChild.textContent = msg;
  setTimeout(() => { toastRoot.innerHTML = ''; }, 2600);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
const post = (p, body) => api(p, { method: 'POST', body: JSON.stringify(body || {}) });

// ---------- identity (device-local) ----------
function getIdentity() {
  try { return JSON.parse(localStorage.getItem('mpa_identity') || 'null'); } catch { return null; }
}
function setIdentity(personId, name) {
  localStorage.setItem('mpa_identity', JSON.stringify({ personId, name }));
  renderIdentity();
}
function clearIdentity() {
  localStorage.removeItem('mpa_identity');
  renderIdentity();
}
function renderIdentity() {
  syncAdminLink();
  const slot = document.getElementById('identitySlot');
  const id = getIdentity();
  if (!id) { slot.innerHTML = ''; return; }
  const first = id.name.split(' ')[0];
  const initial = (first[0] || '?').toUpperCase();
  slot.innerHTML = `<div class="acct">
    <button class="identity-chip" id="acctBtn" aria-haspopup="true"><span class="avatar">${initial}</span>${esc(first)} ▾</button>
    <div class="acct-menu" id="acctMenu" hidden>
      <a href="#/dashboard">My Dashboard</a>
      <a href="#/profile">My Profile</a>
      <a href="#/myleagues">My Leagues</a>
      <button id="acctSwitch">Switch identity</button>
    </div>
  </div>`;
  const menu = document.getElementById('acctMenu');
  document.getElementById('acctBtn').onclick = (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  };
  document.addEventListener('click', function closeMenu(e) {
    if (!e.target.closest('.acct')) { menu.hidden = true; }
  });
  menu.querySelectorAll('a').forEach((a) => { a.onclick = () => { menu.hidden = true; }; });
  document.getElementById('acctSwitch').onclick = () => {
    clearIdentity();
    myLeaguesCache = null;
    toast('Pick your name again to identify yourself.');
    render();
  };
}

// The Admin link in the header shows only while this device is signed in
// as Admin — players never see it. The sign-in link lives in the footer
// instead, so it is always findable without sitting in the header.
async function syncAdminLink() {
  const link = document.getElementById('adminLink');
  if (!link) return;
  const me = await api('/api/admin/me').catch(() => ({ admin: false }));
  link.hidden = !me.admin;
}

// ---------- helpers ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function asLocalDate(iso) {
  // Date-only strings ("2026-11-07") must not shift a day in US timezones.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return new Date(iso + 'T12:00:00');
  return new Date(iso);
}
function fmtDateShort(iso) {
  const d = asLocalDate(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtTimeShort(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
// Activity times render in the league timezone (America/New_York).
function fmtActivityTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function fmtClock(t) {
  const parts = String(t || '').split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1] || 0);
  if (Number.isNaN(h)) return String(t || '');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}
// Phone numbers display as (xxx) xxx-xxxx no matter how they were typed in.
// Anything that is not a 10-digit US number (after dropping a leading 1)
// displays exactly as stored — never mangled. Stored values are untouched.
function fmtPhone(v) {
  if (v == null) return '';
  const digits = String(v).replace(/\D/g, '');
  let d = digits;
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  if (d.length !== 10) return String(v);
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
// Skill-range gate for joining (mirror of server/lib/league.js): the
// league's skill band is the qualifier. Returns an error message when the
// rating is outside the band, else null. '50+' is an age band, not a
// rating band, so it never gates on rating.
function skillRangeError(skill, rating, label = 'DUPR rating') {
  if (rating == null || Number.isNaN(Number(rating))) return null;
  const r = Number(rating);
  if (skill === '50+') return null;
  if (skill === '5.0-ABOVE') {
    return r >= 5.0 ? null : `Your ${label} ${r} is below this league's skill range (5.0 and above).`;
  }
  const m = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(String(skill || ''));
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = Number(m[2]);
  if (r < lo || r > hi) return `Your ${label} ${r} is outside this league's skill range (${skill}).`;
  return null;
}
// A DUPR ID is exactly 6 letters and numbers (e.g. 7D6WR0). Blank is fine —
// self-rated members have no DUPR ID yet. Normalizes to uppercase so
// "pw5jnx" passes and is stored as "PW5JNX".
function normDuprId(v) {
  return (v || '').trim().toUpperCase();
}
function duprIdError(v, selfRateHint = true) {
  const id = normDuprId(v);
  if (!id) return null;
  if (/^[A-Z0-9]{6}$/.test(id)) return null;
  return selfRateHint
    ? 'That doesn\'t look like a DUPR ID — it\'s 6 letters and numbers. If you don\'t have one yet, choose \'I\'ll rate myself\' instead.'
    : 'That doesn\'t look like a DUPR ID — it\'s 6 letters and numbers.';
}
function countdownTo(iso) {
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return 'now';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m}m`;
  return `${h}h ${m}m`;
}
const DUPR_SIGNUP_URL = 'https://dashboard.dupr.com/signup';
const APP_URL = 'https://mpa-league-app.onrender.com';
const RECLIQUE_URL = 'https://moultrie.recliquecore.com/';

// ---------- maps chooser (Google / Apple, remembered per device) ----------
function getMapApp() {
  try { return localStorage.getItem('mpa_map_app') || null; } catch { return null; }
}
function setMapApp(v) {
  try { localStorage.setItem('mpa_map_app', v); } catch { /* ignore */ }
}
function mapUrlFor(app, mode, kind) {
  if (kind === 'place') {
    return app === 'apple'
      ? `https://maps.apple.com/?q=${MAPS_Q}`
      : `https://www.google.com/maps/search/?api=1&query=${MAPS_Q}`;
  }
  const gModes = { car: 'driving', walk: 'walking', transit: 'transit', bike: 'bicycling' };
  if (app === 'apple') {
    // Apple Maps has no bicycling directions — fall back to driving.
    const flag = { car: 'd', walk: 'w', transit: 'r', bike: 'd' }[mode] || 'd';
    return `https://maps.apple.com/?daddr=${MAPS_Q}&dirflg=${flag}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${MAPS_Q}&travelmode=${gModes[mode] || 'driving'}`;
}
function openMap(mode, kind) {
  const pref = getMapApp();
  if (pref) {
    window.open(mapUrlFor(pref, mode, kind || 'dir'), '_blank', 'noopener');
    return;
  }
  // First tap: ask which map app, remember the choice.
  modalRoot.innerHTML = `
    <div class="modal-backdrop" id="backdrop"><div class="modal" role="dialog" aria-label="Choose your map app">
      <button class="x" id="modalX" aria-label="Close">&times;</button>
      <h2>Choose your map app</h2>
      <p class="muted">Your choice is remembered on this device. You can change it anytime from the "Map app" control.</p>
      <div class="btnrow">
        <button class="btn" id="mapGoogle">Google Maps</button>
        <button class="btn" id="mapApple">Apple Maps</button>
      </div>
    </div></div>`;
  const close = () => { modalRoot.innerHTML = ''; };
  document.getElementById('modalX').onclick = close;
  document.getElementById('backdrop').onclick = (e) => { if (e.target.id === 'backdrop') close(); };
  const pick = (app) => {
    setMapApp(app);
    close();
    window.open(mapUrlFor(app, mode, kind || 'dir'), '_blank', 'noopener');
    render();
  };
  document.getElementById('mapGoogle').onclick = () => pick('google');
  document.getElementById('mapApple').onclick = () => pick('apple');
}
function mapPrefControl() {
  const pref = getMapApp();
  const label = pref === 'apple' ? 'Apple Maps' : pref === 'google' ? 'Google Maps' : 'Not chosen yet';
  return `<span class="map-pref">Map app: ${label} · <button class="linkbtn" id="mapChange" type="button">Change</button></span>`;
}
// One delegated handler for every map link and "Change" control in the app.
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-map]');
  if (a) {
    e.preventDefault();
    openMap(a.dataset.map, a.dataset.mapKind || 'dir');
    return;
  }
  const ch = e.target.closest('#mapChange');
  if (ch) {
    try { localStorage.removeItem('mpa_map_app'); } catch { /* ignore */ }
    toast('Pick your map app on the next tap.');
    render();
  }
});

// ---------- favorites (per device) ----------
function favs() {
  try { return JSON.parse(localStorage.getItem('mpa_favorites') || '[]'); } catch { return []; }
}
function isFav(id) { return favs().includes(id); }
function toggleFav(id) {
  let list = favs();
  list = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  try { localStorage.setItem('mpa_favorites', JSON.stringify(list)); } catch { /* ignore */ }
  render();
}

// ---------- cover flow state (device-local) ----------
function coverSteps() {
  try { return JSON.parse(localStorage.getItem('mpa_cover_steps') || '{}'); } catch { return {}; }
}
function setCoverStep(k) {
  const s = coverSteps();
  s[k] = true;
  try { localStorage.setItem('mpa_cover_steps', JSON.stringify(s)); } catch { /* ignore */ }
}
function coverEntered() {
  try { return localStorage.getItem('mpa_cover_entered') === '1'; } catch { return false; }
}
function setCoverEntered() {
  try { localStorage.setItem('mpa_cover_entered', '1'); } catch { /* ignore */ }
}
// Sync the step checkmarks from the person's real records (member record,
// DUPR on file, league roster) instead of resetting to "0 of 3 steps done".
async function syncCoverSteps(personId) {
  try {
    const prof = await api(`/api/people/${personId}/profile`);
    if (prof.person && prof.person.dupr_id) setCoverStep('dupr');
    if (prof.member) setCoverStep('member');
    if (prof.leagues && prof.leagues.length) setCoverStep('joined');
  } catch { /* ignore — steps stay as recorded */ }
}

// ---------- identity cache ----------
let myLeaguesCache = null; // { personId, leagues, registrations }
async function myLeaguesFull(personId) {
  if (myLeaguesCache && myLeaguesCache.personId === personId) return myLeaguesCache;
  const { leagues, registrations } = await api(`/api/people/${personId}/leagues`);
  myLeaguesCache = { personId, leagues, registrations: registrations || [] };
  return myLeaguesCache;
}
async function myLeagues(personId) {
  return (await myLeaguesFull(personId)).leagues;
}
// Registrations for leagues the person has signed up for but is not yet
// rostered in — the landing page shows these instead of a duplicate Join card.
async function myPendingRegistrations(personId) {
  const { leagues, registrations } = await myLeaguesFull(personId);
  const rostered = new Set(leagues.map((l) => l.id));
  return (registrations || []).filter((r) => !rostered.has(r.league_id));
}
function personName(map, id) { return map.get(id) || '—'; }
function initials(map, id) {
  const name = (map.get(id) || '').trim();
  if (!name || name === '—') return '—';
  const parts = name.split(/\s+/);
  const first = parts[0] ? parts[0][0] : '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}


// ---------- router ----------
let refreshTimer = null;
function route() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const h = raw.split('?')[0];
  const parts = h.split('/').filter(Boolean);
  if (parts[0] === 'admin') return renderAdmin();
  if (parts[0] === 'members' && parts[1]) return renderMemberProfile(+parts[1]);
  if (parts[0] === 'members') return renderMembersPage();
  if (parts[0] === 'join') return renderJoinPage(parts[1] ? +parts[1] : null);
  if (parts[0] === 'roundrobin' && parts[1]) return renderRREvent(+parts[1]);
  if (parts[0] === 'roundrobin') return renderRRList();
  if (parts[0] === 'bracket' && parts[1]) return renderBrEvent(+parts[1]);
  if (parts[0] === 'bracket') return renderBrList();
  if (parts[0] === 'myleagues') return renderMyLeagues();
  if (parts[0] === 'dashboard') return renderDashboard();
  if (parts[0] === 'profile') return renderProfile();
  if (parts[0] === 'league' && parts[2] === 'game' && parts[3] && parts[4] === 'sheet') return renderCourtSheet(+parts[1], +parts[3]);
  if (parts[0] === 'league' && parts[2] === 'game' && parts[3]) return renderGameDay(+parts[1], +parts[3]);
  if (parts[0] === 'league' && parts[1]) return renderLeague(+parts[1]);
  return renderRoot();
}
function render() { clearInterval(refreshTimer); route(); }
window.addEventListener('hashchange', render);

// ---------- root: cover / recognition routing ----------
async function renderRoot() {
  const id = getIdentity();
  if (id) {
    // A recognized member skips the cover: sync the step checkmarks from
    // their real records, then route by league membership.
    await syncCoverSteps(id.personId);
    const mine = await myLeagues(id.personId).catch(() => []);
    return renderLanding(id, mine); // the landing is the front page for every member — with no league it shows "not in a league yet" plus the glimpse
  }
  const me = await api('/api/admin/me').catch(() => ({ admin: false }));
  if (me.admin) return renderHome(); // Admin sees all leagues
  if (coverEntered()) return renderFindLeague();
  return renderCover();
}

// ---------- home (Admin view: all leagues, stats, Members box) ----------
async function renderHome() {
  app.innerHTML = `<h1>Home of the Moultrie Pickleball League</h1>
    <p class="muted">At the YMCA in Moultrie, GA. Pick your league to see standings, schedule, and the current game day.</p>
    <div id="stats"><p class="muted">Loading…</p></div>
    <div class="btnrow"><a class="btn" href="#/members">Become a Member</a><a class="btn secondary" href="#/myleagues">My Leagues</a></div>
    <div id="leagues"><p class="muted">Loading leagues…</p></div>`;
  try {
    const [{ leagues }, { members }] = await Promise.all([
      api('/api/leagues'),
      api('/api/members').catch(() => ({ members: [] })),
    ]);
    document.getElementById('stats').innerHTML = `
      <div class="stat-row">
        <span class="stat"><strong>${members.length}</strong> Members</span>
        <span class="stat"><strong>0</strong> Tournaments</span>
        <span class="stat"><strong>${leagues.length}</strong> Leagues</span>
        <span class="stat"><strong>0</strong> Team Leagues</span>
      </div>
      <div class="card"><strong>Members</strong> — ${members.length} free MPA member(s).
        <div class="btnrow"><a class="btn secondary small" href="#/members">Open Members directory</a></div></div>
      <div class="card"><strong>Round Robin</strong> — one-off charity and money-ball nights with fixed teams, separate from leagues.
        <div class="btnrow"><a class="btn secondary small" href="#/roundrobin">Open Round Robin</a></div></div>
      <div class="card"><strong>Bracket</strong> — one-off double-elimination bracket nights with fixed teams, separate from leagues. Lose twice and you're out.
        <div class="btnrow"><a class="btn secondary small" href="#/bracket">Open Bracket</a></div></div>`;
    const el = document.getElementById('leagues');
    if (!leagues.length) {
      el.innerHTML = `<div class="card"><p>No leagues yet. An admin can create one from the Admin page.</p></div>`;
      return;
    }
    el.innerHTML = leagues.map(leagueCardHtml).join('');
    bindFavButtons();
  } catch (e) {
    document.getElementById('leagues').innerHTML = `<div class="banner warn">${esc(e.message)}</div>`;
  }
}

function colorForLeague(l) {
  if (!l) return 'black-yellow';
  if (l.skill === '50+') return 'red';
  if (l.type === 'Advanced') return 'blue';
  if (l.type === 'Intermediate/Advanced') return 'green';
  if (l.type === "Women's") return 'pink';
  if (l.type === 'Elite') return 'dark-gray';
  return 'black-yellow';
}

function logoSrcFor(color) {
  if (color === 'pink') return '/mpa-logo-pink.webp';
  if (color === 'blue') return '/mpa-logo-blue.webp';
  if (color === 'green') return '/mpa-logo-green.webp';
  if (color === 'red') return '/mpa-logo-red.webp';
  if (color === 'dark-gray') return '/mpa-logo-dark-gray.webp';
  return '/mpa-logo.webp';
}

function leagueCardHtml(l) {
  return `
      <div class="card league-card">
        <span class="mark ${esc(colorForLeague(l))}"><img src="${logoSrcFor(colorForLeague(l))}" alt="MPA"></span>
        <span class="info">
          <span class="name">${esc(l.name)}</span><br>
          <span class="sub">${esc(l.type)} · ${esc(l.skill)} · ${esc(l.format)}<br>
          ${esc(l.day)}s ${esc(fmtClock(l.time))} · ${l.player_count ?? ''} player(s)${l.season ? ` · ${esc(l.season)}` : ''}</span>
        </span>
        <button class="btn secondary small" data-fav="${l.id}">${isFav(l.id) ? '★ Favorited' : '☆ Favorite'}</button>
        <a class="btn small" href="#/league/${l.id}">View</a>
      </div>`;
}

function bindFavButtons() {
  app.querySelectorAll('button[data-fav]').forEach((b) => {
    b.onclick = (e) => {
      e.preventDefault();
      toggleFav(+b.dataset.fav);
      toast(isFav(+b.dataset.fav) ? 'Added to favorites on this device.' : 'Removed from favorites.');
    };
  });
}

// ---------- "Your league" landing page ----------
async function renderLanding(id, mine) {
  const first = id.name.split(' ')[0];
  app.innerHTML = `<h1>Your league</h1><p class="muted">Loading…</p>`;
  try {
    const [{ leagues }, { members }, { events: rrEvents }, { events: brEvents }] = await Promise.all([
      api('/api/leagues'),
      api('/api/members').catch(() => ({ members: [] })),
      api('/api/round-robin/events').catch(() => ({ events: [] })),
      api('/api/bracket/events').catch(() => ({ events: [] })),
    ]);
    const mineIds = new Set(mine.map((l) => l.id));
    const mineFull = leagues.filter((l) => mineIds.has(l.id));
    // Pending signups: signed up but not yet on the roster — show the
    // signup instead of a duplicate Join card for the same league.
    const pending = await myPendingRegistrations(id.personId).catch(() => []);
    const pendingIds = new Set(pending.map((r) => r.league_id));
    const newSeasons = leagues.filter((l) => !mineIds.has(l.id) && !pendingIds.has(l.id));
    const openNights = (rrEvents || []).filter((e) => e.published && e.status === 'setup');
    const openBrackets = (brEvents || []).filter((e) => e.published && e.status === 'setup');
    app.innerHTML = `
      <div class="landing-watermark" aria-hidden="true"></div>
      <div class="landing-view">
      <h1>Your league</h1>
      <p class="muted">Hi ${esc(first)} — here are the leagues you are part of.</p>
      <div class="stat-row">
        <span class="stat stat-members"><strong>${members.length}</strong> Members</span>
        <span class="stat stat-tournaments"><strong>0</strong> Tournaments</span>
        <span class="stat stat-leagues"><strong>${leagues.length}</strong> Leagues</span>
        <span class="stat stat-teams"><strong>0</strong> Team Leagues</span>
      </div>
      <div id="myLeagueCards">${mineFull.map(leagueCardHtml).join('') || '<p class="muted">You are not in a league yet.</p>'}</div>
      ${pending.length ? pending.map((r) => `<div class="card"><strong>You're signed up for ${esc(r.name)}</strong><br><span class="muted small">The organizer will add you to the roster.</span></div>`).join('') : ''}
      ${newSeasons.length ? `<h2>A new season is open</h2>
        ${newSeasons.map((l) => `<div class="card new-season">
          <strong>${esc(l.name)}</strong><br>
          <span class="muted small">${esc(l.type)} · ${esc(l.skill)} · ${esc(l.format)} · ${esc(l.day)}s ${esc(fmtClock(l.time))} · ${esc(l.season || 'Season not set')}</span>
          <div class="btnrow"><a class="btn green small" href="#/join/${l.id}">Join this league</a></div>
        </div>`).join('')}` : ''}
      <div class="btnrow"><a class="btn landing-btn-members" href="#/members">Members</a><a class="btn landing-btn-leagues" href="#/myleagues">My Leagues</a></div>
      ${openNights.length ? `<h2>Round Robin — sign-ups open</h2>
        ${openNights.map((e) => `<div class="card">
          <strong>${esc(e.name)}</strong><br>
          <span class="muted small">${esc(rrWhen(e))} · ${rrKindLabel(e.kind)}${e.kind === 'money' ? ` · ${rrMoney(e.fee_cents)} per person` : ''} · ${e.team_count} of ${e.max_teams || 24} teams filled${e.solo_count ? ` · ${e.solo_count} waiting to be paired` : ''}</span>
          <div class="btnrow"><a class="btn green small" href="#/roundrobin/${e.id}">Join this night</a></div>
        </div>`).join('')}` : ''}
      ${openBrackets.length ? `<h2>Bracket — sign-ups open</h2>
        ${openBrackets.map((e) => `<div class="card">
          <strong>${esc(e.name)}</strong><br>
          <span class="muted small">${esc(rrWhen(e))} · Double elimination · ${rrKindLabel(e.kind)}${e.kind === 'money' ? ` · ${rrMoney(e.fee_cents)} per person` : ''} · ${e.team_count} of ${e.max_teams || 12} teams filled${e.solo_count ? ` · ${e.solo_count} waiting to be paired` : ''}</span>
          <div class="btnrow"><a class="btn green small" href="#/bracket/${e.id}">Join this night</a></div>
        </div>`).join('')}` : ''}
      ${leagues.length === 0 ? `<div class="card"><h2>A glimpse of what's coming</h2>
        <p class="muted small">Here's what the app looks like once play starts. The samples below are from the completed test season, not live pages.</p>
        <div class="gl-phone">
          <div class="gl-phone-top"><span>MPA</span><span class="gl-pill">MEMBER</span></div>
          <div class="gl-check">✓</div>
          <h3>You're a member!</h3>
          <p>You're now a <strong>free MPA member</strong>. MPA ladder leagues are <strong>in the works</strong> at the YMCA in Moultrie, GA — join now and pick the league for your skill when play starts.</p>
          <div class="gl-works"><strong>Leagues in the works</strong><br>No league to join yet. We'll let you know when a league opens.</div>
          <p class="muted small">Step 1 was DUPR or self-rate 2.5–5.0 • Step 2 was name / email / phone<br>If you can't open DUPR, you can rate yourself instead when you join.</p>
        </div>
        <ul>
          <li><strong>No leagues open yet</strong> — nothing to join right now.</li>
          <li><strong>Your league home</strong> — your leagues, standings, and next game day, once you're in one.</li>
          <li><strong>Find your league</strong> — tap your name to see the leagues you're part of.</li>
          <li><strong>No game day yet</strong> — game days appear once a league starts.</li>
        </ul>
        <div class="gl-how"><strong>How scoring works</strong><br>Every player plays for <strong>60 points</strong> a night. How a court gets there depends on how many players are on it:<br>• <strong>4 players</strong> — 3 games to 20<br>• <strong>5 players</strong> — 5 games to 15, with 1 player sitting out (BYE) each game<br>• <strong>6 players</strong> — 9 games to 10, with 2 sitting out each game<br>First to the target, win by 1. Your standing is your points <strong>earned</strong> divided by your points <strong>possible</strong>.</div>
        <div class="gl-sample">
          <div class="gl-sample-head">SAMPLE — <span>WHAT A LEAGUE WILL LOOK LIKE</span> • NOT LIVE</div>
          <div class="gl-sample-title"><div><div class="gl-kicker">SAMPLE • EXAMPLE FROM THE COMPLETED TEST SEASON</div><h3>Matches — one at a time</h3><p class="muted small">Sample only — no live match today. This is what they'll see on game night once a league is running.</p></div></div>
          <div class="gl-phone">
            <div class="gl-phone-top"><span>MATCHES</span><span class="gl-pill">COURT 1</span></div>
            <div class="gl-pills"><span class="gl-pill dark">SAMPLE</span><span class="gl-pill green">● NOW PLAYING</span></div>
            <div class="gl-match">
              <strong>First to 15, win by 1</strong><br><span class="muted small">Court 1 • Round 1</span>
              <div class="gl-team">Alan &amp; Stew</div>
              <div class="gl-vs">VS</div>
              <div class="gl-team">Justin &amp; Zell</div>
              <div class="gl-score-btn">SCORE</div>
            </div>
            <h4>Finished</h4>
            <div class="rr-team-win"><span>Laura &amp; Bryan</span><span class="rr-score">15</span></div>
            <div class="rr-team-lose"><span>Kim &amp; Justin</span><span class="rr-score">9</span></div>
            <p class="muted small">Before the night starts this tab reads: “Matches will show once the game day starts.”</p>
          </div>
          <ul class="gl-notes">
            <li><strong>Sample:</strong> names and scores are from the completed test season — shown so a new member can see how a league night works</li>
            <li>When a league is live, a player sees <strong>only their own court's games</strong> (including BYEs), and only the match now playing gets a SCORE button</li>
          </ul>
        </div>
        <div class="gl-sample">
          <div class="gl-sample-head">SAMPLE — <span>WHAT A LEAGUE WILL LOOK LIKE</span> • NOT LIVE</div>
          <div class="gl-sample-title"><div><div class="gl-kicker">SAMPLE • EXAMPLE FROM THE COMPLETED TEST SEASON</div><h3>Enter score</h3><p class="muted small">Sample only — type the score, tap Save, and the next match comes up.</p></div></div>
          <div class="gl-phone">
            <div class="gl-phone-top"><span>GAMES TO 15</span></div>
            <div class="gl-team">Alan &amp; Stew</div>
            <div class="gl-score-box">15</div>
            <div class="gl-vs">VS</div>
            <div class="gl-team">Justin &amp; Zell</div>
            <div class="gl-score-box">9</div>
            <div class="gl-score-btn">SAVE</div>
          </div>
          <ul class="gl-notes">
            <li><strong>Sample:</strong> plain boxes — no spinners, no “to 15” labels. First to 15, win by 1.</li>
          </ul>
        </div>
        <div class="gl-sample">
          <div class="gl-sample-head">SAMPLE — <span>WHAT A LEAGUE WILL LOOK LIKE</span> • NOT LIVE</div>
          <div class="gl-sample-title"><div><div class="gl-kicker">SAMPLE • EXAMPLE FROM THE COMPLETED TEST SEASON</div><h3>Members &amp; Dashboard</h3><p class="muted small">Sample only — the directory, your profile, and your results across your leagues.</p></div></div>
          <div class="gl-phone">
            <div class="gl-phone-top"><span>MEMBERS</span></div>
            <div class="gl-tiles">
              <div class="gl-tile"><span class="gl-avatar">A</span><strong>Alan Cortez</strong><br><span class="muted small">DUPR 3.608 • AMATEUR</span></div>
              <div class="gl-tile"><span class="gl-avatar">D</span><strong>Dawn Smith</strong><br><span class="muted small">AMATEUR</span></div>
            </div>
            <div class="gl-dash"><strong>My Dashboard</strong><br><span class="muted small">Your rank, your record, and every game you played — partner, opponents, score, result — per league.</span></div>
          </div>
          <ul class="gl-notes">
            <li><strong>Sample:</strong> email and phone are never shown here — only the admin sees them.</li>
          </ul>
        </div>
      </div>` : ''}</div>`;
    bindFavButtons();
  } catch (e) {
    app.innerHTML = `<div class="banner warn">${esc(e.message)}</div>`;
  }
}

// ---------- find your league (cover entered, no name picked yet) ----------
async function renderFindLeague() {
  app.innerHTML = `<h1>Find your league</h1>
    <p class="muted">Tap your name to see the leagues you are part of.</p>
    <div class="searchrow"><input type="text" id="findQ" placeholder="Search your name…" autocomplete="off"></div>
    <div id="findList"><p class="muted">Type your name above.</p></div>
    <p class="muted">Not a member yet? <a href="#/members">Become a free MPA member</a> — or <button class="linkbtn" id="restartCover">start the welcome steps over</button>.</p>`;
  document.getElementById('restartCover').onclick = () => {
    try { localStorage.removeItem('mpa_cover_entered'); localStorage.removeItem('mpa_cover_steps'); } catch { /* ignore */ }
    render();
  };
  const listEl = document.getElementById('findList');
  const run = async () => {
    const q = document.getElementById('findQ').value.trim();
    if (q.length < 2) { listEl.innerHTML = '<p class="muted">Type your name above.</p>'; return; }
    const [{ people }, { members }] = await Promise.all([
      api(`/api/people/search?q=${encodeURIComponent(q)}`).catch(() => ({ people: [] })),
      api(`/api/members/search?q=${encodeURIComponent(q)}`).catch(() => ({ members: [] })),
    ]);
    const byId = new Map();
    for (const p of people) byId.set(p.id, p);
    for (const m of members) if (m.person_id && !byId.has(m.person_id)) byId.set(m.person_id, m);
    const rows = [...byId.values()];
    if (!rows.length) { listEl.innerHTML = '<p class="muted">No match — check the spelling, or become a member first.</p>'; return; }
    listEl.innerHTML = rows.map((p) => `<div class="person-row tappable" data-pid="${p.id}" data-name="${esc(p.name)}">
      <span class="who"><span class="nm">${esc(p.name)}</span>
      <div class="fp">${p.dupr_id ? `DUPR ${esc(p.dupr_id)} · ${p.dupr_rating ?? ''}` : (p.self_rated ? `Self-rated ${p.dupr_rating ?? ''}` : 'No DUPR on file')}</div></span></div>`).join('');
    listEl.querySelectorAll('.person-row').forEach((row) => {
      row.onclick = () => {
        setIdentity(+row.dataset.pid, row.dataset.name);
        toast(`Hi ${row.dataset.name} — welcome back.`);
        render();
      };
    });
  };
  document.getElementById('findQ').addEventListener('input', run);
}

// ---------- cover / welcome page ----------
let coverTab = 'welcome';
async function renderCover() {
  const steps = coverSteps();
  const done = ['dupr', 'member', 'joined'].filter((k) => steps[k]).length;
  app.innerHTML = `
    <h1>Home of the Moultrie Pickleball League</h1>
    <p>Home of the Moultrie Pickleball League at the YMCA in Moultrie, GA. Complete the three steps below to become a full member, and the league opens right here.</p>
    <div class="tabs">
      <button data-tab="welcome" class="${coverTab === 'welcome' ? 'active' : ''}">Welcome</button>
      <button data-tab="members" class="${coverTab === 'members' ? 'active' : ''}">Members</button>
    </div>
    <div id="coverBody"></div>`;
  app.querySelectorAll('.tabs button').forEach((b) => {
    b.onclick = () => { coverTab = b.dataset.tab; renderCover(); };
  });
  if (coverTab === 'members') {
    renderMembersDirectory(document.getElementById('coverBody'));
    return;
  }
  const body = document.getElementById('coverBody');
  const check = (k) => (steps[k] ? '✓ ' : '');
  body.innerHTML = `
    <p class="muted"><strong>${done} of 3 steps done</strong></p>
    <div class="card step ${steps.dupr ? 'done' : ''}">
      <h3>${check('dupr')}Step 1 — Get a DUPR account</h3>
      <p class="muted small">A DUPR account is the standard way to join MPA. It is free — and if you don't have one yet, you can rate yourself when you join.</p>
      <div class="btnrow">
        <a class="btn small" href="${DUPR_SIGNUP_URL}" target="_blank" rel="noopener">Create a DUPR account</a>
        <button class="btn secondary small" id="haveDupr">I have a DUPR account</button>
      </div>
    </div>
    <div class="card step ${steps.member ? 'done' : ''}">
      <h3>${check('member')}Step 2 — Become a free MPA member</h3>
      <p class="muted small">Free and unlimited. You'll need your DUPR ID and doubles rating — or your self-rating if you don't have a DUPR account yet.</p>
      <div class="btnrow"><button class="btn small" id="showMemberForm">Become a Member</button></div>
      <div id="memberFormSlot"></div>
      <p class="muted small">Already a member? <button class="linkbtn" id="showFindMe">I'm already a member — find my name</button></p>
      <div id="findMeSlot"></div>
    </div>
    <div class="card step ${steps.joined ? 'done' : ''}">
      <h3>${check('joined')}Step 3 — Join the league</h3>
      <p class="muted small">Pick a league and sign up.</p>
      <div id="joinPickSlot"><p class="muted">Loading leagues…</p></div>
    </div>
    ${done === 3 ? `<div class="btnrow"><button class="btn green" id="enterLeague">Enter the league →</button></div>` : ''}`;
  document.getElementById('haveDupr').onclick = () => { setCoverStep('dupr'); renderCover(); };
  document.getElementById('showMemberForm').onclick = () => {
    renderMemberForm(document.getElementById('memberFormSlot'), () => {
      setCoverStep('dupr');
      setCoverStep('member');
      renderCover();
    });
  };
  document.getElementById('showFindMe').onclick = () => {
    const slot = document.getElementById('findMeSlot');
    slot.innerHTML = `<div class="searchrow"><input type="text" id="findMeQ" placeholder="Search your name…" autocomplete="off"></div><div id="findMeList"></div>`;
    const run = async () => {
      const q = document.getElementById('findMeQ').value.trim();
      const listEl = document.getElementById('findMeList');
      if (q.length < 2) { listEl.innerHTML = ''; return; }
      const { members } = await api(`/api/members/search?q=${encodeURIComponent(q)}`).catch(() => ({ members: [] }));
      if (!members.length) { listEl.innerHTML = '<p class="muted">No match — check the spelling, or become a member with the form above.</p>'; return; }
      listEl.innerHTML = members.map((m) => `<div class="person-row tappable" data-pid="${m.person_id}" data-name="${esc(m.name)}">
        <span class="who"><span class="nm">${esc(m.name)}</span>
        <div class="fp">${m.dupr_id ? `DUPR ${esc(m.dupr_id)} · ${m.dupr_rating ?? ''}` : (m.self_rated ? `Self-rated ${m.dupr_rating ?? ''}` : '')}</div></span></div>`).join('');
      listEl.querySelectorAll('.person-row').forEach((row) => {
        row.onclick = () => {
          setIdentity(+row.dataset.pid, row.dataset.name);
          setCoverStep('dupr');
          setCoverStep('member');
          toast(`Welcome back, ${row.dataset.name}.`);
          render();
        };
      });
    };
    document.getElementById('findMeQ').addEventListener('input', run);
  };
  try {
    const { leagues } = await api('/api/leagues');
    const slot = document.getElementById('joinPickSlot');
    if (!slot) return;
    if (!leagues.length) {
      slot.innerHTML = '<p class="muted">No leagues are open yet.</p>';
      return;
    }
    slot.innerHTML = `<select id="joinPickLeague">${leagues.map((l) => `<option value="${l.id}">${esc(l.name)} — ${esc(l.day)}s ${esc(fmtClock(l.time))}</option>`).join('')}</select>
      <div class="btnrow"><button class="btn green small" id="joinPickGo">Join this league</button></div>`;
    document.getElementById('joinPickGo').onclick = () => {
      location.hash = `#/join/${document.getElementById('joinPickLeague').value}`;
    };
  } catch { /* join picker stays in its loading state */ }
  document.getElementById('enterLeague')?.addEventListener('click', () => {
    setCoverEntered();
    toast('Welcome to the league.');
    render();
  });
}

// ---------- members directory (shared) ----------
// Split "Alan Cortez" into first/last for the WRPA-style tile (bold last name).
function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: parts[0] || '', last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}
function isUsa(country) {
  const c = String(country || '').trim().toLowerCase();
  return c === 'usa' || c === 'us' || c === 'united states' || c === 'united states of america';
}
function fmtRating(v) {
  return v == null || v === '' ? '—' : Number(v).toFixed(3);
}
function ratingInRange(v, range) {
  if (!range) return true;
  if (v == null || v === '') return false;
  const n = Number(v);
  if (range === '2') return n >= 2 && n < 3;
  if (range === '3') return n >= 3 && n < 3.5;
  if (range === '3.5') return n >= 3.5 && n < 5;
  if (range === '5') return n >= 5;
  return true;
}
function ageInRange(age, range) {
  if (!range) return true;
  if (age == null) return false;
  if (range === 'u30') return age < 30;
  if (range === '30') return age >= 30 && age < 50;
  if (range === '50') return age >= 50;
  return true;
}
function memberTileHtml(m) {
  const initial = (m.name[0] || '?').toUpperCase();
  const { first, last } = splitName(m.name);
  const flag = isUsa(m.country) ? ' 🇺🇸' : '';
  const nameLink = `<a href="#/members/${m.id}">${esc(first)}${last ? ` <strong>${esc(last)}</strong>` : ''}</a>`;
  return `<div class="member-tile" data-mid="${m.id}">
    <div class="tile-front">
      <button class="flip-btn" data-flip="${m.id}" title="Flip card">Flip ↻</button>
      ${m.photo_url ? `<img class="photo" src="${esc(m.photo_url)}" alt="">` : `<span class="avatar big">${initial}</span>`}
      <div class="tile-row">
        <span><span class="lbl">Resides</span><strong>${esc([m.resides, m.country].filter(Boolean).join(', ') || '—')}</strong></span>
        <span><span class="lbl">Age</span><strong>${m.age ?? '—'}</strong></span>
      </div>
      <div class="tile-name">${nameLink}${flag}</div>
      <div class="tile-am">AMATEUR</div>
    </div>
    <div class="tile-back">
      <button class="flip-btn" data-flip="${m.id}" title="Flip card">Flip ↻</button>
      <div class="tile-back-rows">
        <div><span class="lbl">DUPR ID</span><strong>${m.dupr_id ? esc(m.dupr_id) : '—'}</strong></div>
        <div><span class="lbl">Doubles${m.self_rated ? ' (self-rated)' : ''}</span><strong>${fmtRating(m.dupr_rating)}</strong></div>
        <div><span class="lbl">Singles</span><strong>${fmtRating(m.singles_rating)}</strong></div>
        <div><span class="lbl">Skinny Singles</span><strong>${fmtRating(m.skinny_rating)}</strong></div>
      </div>
      <div class="tile-name">${nameLink}</div>
    </div>
  </div>`;
}
function memberListRowHtml(m) {
  const initial = (m.name[0] || '?').toUpperCase();
  const { first, last } = splitName(m.name);
  const flag = isUsa(m.country) ? ' 🇺🇸' : '';
  const meta = [m.resides, m.age != null ? `Age ${m.age}` : null, m.country].filter(Boolean).join(' · ');
  return `<div class="member-list-row">
    ${m.photo_url ? `<img class="photo" src="${esc(m.photo_url)}" alt="">` : `<span class="avatar big">${initial}</span>`}
    <span class="info"><span class="nm"><a href="#/members/${m.id}">${esc(first)}${last ? ` <strong>${esc(last)}</strong>` : ''}</a>${flag}</span><br>
    <span class="sub">${m.dupr_id ? `DUPR ${esc(m.dupr_id)} · Rating ${fmtRating(m.dupr_rating)}` : (m.self_rated ? `Self-rated ${fmtRating(m.dupr_rating)}` : 'No DUPR on file')}</span>
    ${meta ? `<br><span class="sub">${esc(meta)}</span>` : ''}
    <br><span class="sub">AMATEUR</span></span>
  </div>`;
}

async function renderMembersDirectory(container) {
  container.innerHTML = `
    <p class="dupr-powered">Ratings powered by <strong>DUPR</strong></p>
    <div class="card filter-bar">
      <div class="filter-grid">
        <label>Search by Name<input type="text" id="memQ" placeholder="Name" autocomplete="off"></label>
        <label>Age<select id="memAge"><option value="">All</option><option value="u30">Under 30</option><option value="30">30–49</option><option value="50">50+</option></select></label>
        <label>Gender<select id="memGender"><option value="">All</option><option>Female</option><option>Male</option></select></label>
        <label>Country<select id="memCountry"><option value="">All</option></select></label>
        <label>Doubles<select id="memDbl"><option value="">All</option><option value="2">2.0–2.99</option><option value="3">3.0–3.49</option><option value="3.5">3.5–4.49</option><option value="5">5.0+</option></select></label>
        <label>Singles<select id="memSgl"><option value="">All</option><option value="2">2.0–2.99</option><option value="3">3.0–3.49</option><option value="3.5">3.5–4.49</option><option value="5">5.0+</option></select></label>
        <label>Skinny<select id="memSkin"><option value="">All</option><option value="2">2.0–2.99</option><option value="3">3.0–3.49</option><option value="3.5">3.5–4.49</option><option value="5">5.0+</option></select></label>
      </div>
      <div class="btnrow"><button class="btn" id="memSearchBtn">🔍 Search</button><button class="btn secondary" id="memClearBtn">Clear filters</button></div>
    </div>
    <div class="dir-head"><h2>Players</h2>
      <div class="view-toggle"><button id="memListBtn">☰ List View</button><button id="memTileBtn" class="active">▦ Tile View</button></div>
    </div>
    <div id="memTiles"><p class="muted">Loading members…</p></div>`;
  const { members } = await api('/api/members').catch(() => ({ members: [] }));
  const countrySel = document.getElementById('memCountry');
  [...new Set(members.map((m) => m.country).filter(Boolean))].sort().forEach((c) => {
    const o = document.createElement('option');
    o.textContent = c;
    countrySel.appendChild(o);
  });
  let view = 'tile';
  const draw = () => {
    const q = (document.getElementById('memQ').value || '').trim().toLowerCase();
    const age = document.getElementById('memAge').value;
    const gender = document.getElementById('memGender').value;
    const country = document.getElementById('memCountry').value;
    const dbl = document.getElementById('memDbl').value;
    const sgl = document.getElementById('memSgl').value;
    const skin = document.getElementById('memSkin').value;
    const list = members.filter((m) =>
      (!q || m.name.toLowerCase().includes(q)) &&
      ageInRange(m.age, age) &&
      (!gender || (m.gender || '').toLowerCase() === gender.toLowerCase()) &&
      (!country || m.country === country) &&
      ratingInRange(m.dupr_rating, dbl) &&
      ratingInRange(m.singles_rating, sgl) &&
      ratingInRange(m.skinny_rating, skin)
    );
    const el = document.getElementById('memTiles');
    if (!list.length) { el.innerHTML = '<p class="muted">No members match those filters.</p>'; return; }
    el.innerHTML = view === 'tile'
      ? `<div class="mem-grid">${list.map(memberTileHtml).join('')}</div>`
      : list.map(memberListRowHtml).join('');
    el.querySelectorAll('[data-flip]').forEach((b) => {
      b.onclick = (e) => { e.preventDefault(); b.closest('.member-tile').classList.toggle('flipped'); };
    });
  };
  draw();
  document.getElementById('memQ').addEventListener('input', draw);
  ['memAge', 'memGender', 'memCountry', 'memDbl', 'memSgl', 'memSkin'].forEach((id) => {
    document.getElementById(id).addEventListener('change', draw);
  });
  document.getElementById('memSearchBtn').onclick = draw;
  document.getElementById('memClearBtn').onclick = () => {
    ['memQ', 'memAge', 'memGender', 'memCountry', 'memDbl', 'memSgl', 'memSkin'].forEach((id) => {
      document.getElementById(id).value = '';
    });
    draw();
  };
  document.getElementById('memListBtn').onclick = () => {
    view = 'list';
    document.getElementById('memListBtn').classList.add('active');
    document.getElementById('memTileBtn').classList.remove('active');
    draw();
  };
  document.getElementById('memTileBtn').onclick = () => {
    view = 'tile';
    document.getElementById('memTileBtn').classList.add('active');
    document.getElementById('memListBtn').classList.remove('active');
    draw();
  };
}

// ---------- member profile (tapped from the directory) ----------
// Built only from what the member entered in the membership form — nothing
// is fetched live from DUPR. Email/phone are never shown here.
async function renderMemberProfile(memberId) {
  app.innerHTML = `<p><a href="#/members">← Members</a></p><p class="muted">Loading…</p>`;
  try {
    const { members } = await api('/api/members');
    const m = members.find((x) => x.id === memberId);
    if (!m) {
      app.innerHTML = `<div class="card"><h2>Member not found</h2><p class="muted">That member record does not exist.</p><p><a href="#/members">← Back to Members</a></p></div>`;
      return;
    }
    const initial = (m.name[0] || '?').toUpperCase();
    const dash = (v) => (v == null || v === '' ? '—' : esc(v));
    const leagues = m.leagues || [];
    app.innerHTML = `
      <p><a href="#/members">← Back to Members</a></p>
      <div class="profile-head">
        ${m.photo_url ? `<img class="photo big" src="${esc(m.photo_url)}" alt="">` : `<span class="avatar huge">${initial}</span>`}
        <h1>${esc(m.name)}</h1>
        <p class="muted">Amateur | ${esc(m.country || '—')}</p>
        ${m.self_rated ? '<p><span class="self-rated">Self-rated — no DUPR account on file yet</span></p>' : ''}
      </div>
      <div class="detail-strip">
        <div><span class="lbl">DUPR ID</span><strong>${dash(m.dupr_id)}</strong></div>
        <div><span class="lbl">Nickname</span><strong>${dash(m.nickname)}</strong></div>
        <div><span class="lbl">Age</span><strong>${m.age ?? '—'}</strong></div>
        <div><span class="lbl">Gender</span><strong>${dash(m.gender)}</strong></div>
        <div><span class="lbl">Height</span><strong>${dash(m.height)}</strong></div>
        <div><span class="lbl">Handed</span><strong>${dash(m.handed)}</strong></div>
      </div>
      <div class="stat-row">
        <button class="stat" id="profLeagues"><strong>${leagues.length}</strong> Leagues →</button>
        <span class="stat"><strong>0</strong> Tournaments</span>
      </div>
      <div id="profLeagueList"></div>
      <h2>Rating</h2>
      ${m.self_rated
        ? '<p class="dupr-powered">Self-rated — this rating is the member\'s own, not a DUPR rating</p>'
        : '<p class="dupr-powered">Ratings powered by <strong>DUPR</strong></p>'}
      <div class="rating-boxes">
        <div class="rating-box"><span class="lbl">Doubles${m.self_rated ? ' (self-rated)' : ''}</span><strong>${fmtRating(m.dupr_rating)}</strong></div>
        <div class="rating-box"><span class="lbl">Singles</span><strong>${fmtRating(m.singles_rating)}</strong></div>
        <div class="rating-box"><span class="lbl">Skinny Singles</span><strong>${fmtRating(m.skinny_rating)}</strong></div>
      </div>
      ${m.dupr_profile_url
        ? `<div class="btnrow"><a class="btn" href="${esc(m.dupr_profile_url)}" target="_blank" rel="noopener">View on DUPR</a></div>`
        : (m.self_rated
          ? '<p class="muted">No DUPR account on file yet — the member can add one from My Profile, or the admin can add it from Admin → Members → Edit.</p>'
          : `<p class="muted">DUPR ID ${esc(m.dupr_id || '—')} — the live rating and rating history live on DUPR behind its sign-in. Add a DUPR profile link to this member record to link out to it.</p>`)}
      <p class="fineprint">The ratings shown here are the ones this member entered when joining MPA. They only change when the member or admin updates them — there is no live DUPR sync.</p>
      <div class="btnrow"><a class="btn secondary" href="#/members">Back to Members</a></div>`;
    document.getElementById('profLeagues').onclick = () => {
      const el = document.getElementById('profLeagueList');
      el.innerHTML = leagues.length
        ? `<div class="card">${leagues.map((l) => `<div>${esc(l)}</div>`).join('')}</div>`
        : '<p class="muted">Not in a league yet.</p>';
    };
  } catch (e) {
    app.innerHTML = `<div class="banner warn">${esc(e.message)}</div><p><a href="#/members">← Back to Members</a></p>`;
  }
}

// ---------- become a member form (shared) ----------
function renderMemberForm(container, onDone) {
  container.innerHTML = `
    <div class="card">
      <h3>Become a free MPA member</h3>
      <label>Full name</label><input type="text" id="mf-name" autocomplete="name">
      <div class="field-row">
        <div><label>Email</label><input type="text" id="mf-email" autocomplete="email"></div>
        <div><label>Phone</label><input type="text" id="mf-phone" autocomplete="tel"></div>
      </div>
      <label class="radio"><input type="radio" name="mf-mode" value="dupr" checked> I have a DUPR account</label><br>
      <label class="radio"><input type="radio" name="mf-mode" value="self"> I don't have one yet — I'll rate myself</label>
      <div id="mf-dupr-fields">
        <div class="field-row">
          <div><label>DUPR ID (required)</label><input type="text" id="mf-dupr"><p class="fineprint">6 letters and numbers, like 7D6WR0.</p></div>
          <div><label>DUPR doubles rating (required)</label><input type="number" step="0.001" id="mf-rating" placeholder="e.g. 3.643"></div>
        </div>
      </div>
      <div id="mf-self-fields" style="display:none">
        <label>Your level</label>
        <div class="level-pick" id="mf-levels">${[2.5, 3.0, 3.5, 4.0, 4.5, 5.0].map((lv) => `<button type="button" data-level="${lv}">${lv.toFixed(1)}</button>`).join('')}</div>
        <p class="fineprint">Pick the level you play at. You can add your DUPR account later and we'll swap it in.</p>
      </div>
      <label>DUPR profile link (optional)</label><input type="text" id="mf-profile" placeholder="https://…">
      <div class="field-row">
        <div><label>Resides (optional)</label><input type="text" id="mf-resides" placeholder="e.g. Norman Park, GA"></div>
        <div><label>Age (optional)</label><input type="number" id="mf-age"></div>
      </div>
      <div class="field-row">
        <div><label>Country (optional)</label><input type="text" id="mf-country" placeholder="e.g. USA"></div>
        <div><label>Profile photo URL (optional)</label><input type="text" id="mf-photo" placeholder="https://…"></div>
      </div>
      <div class="field-row">
        <div><label>Nickname (optional)</label><input type="text" id="mf-nick" placeholder="e.g. Al"></div>
        <div><label>Gender (optional)</label><select id="mf-gender"><option value="">—</option><option>Female</option><option>Male</option></select></div>
      </div>
      <div class="field-row">
        <div><label>Height (optional)</label><input type="text" id="mf-height" placeholder="e.g. 5'9&quot;"></div>
        <div><label>Handed (optional)</label><select id="mf-handed"><option value="">—</option><option>Right</option><option>Left</option></select></div>
      </div>
      <div class="field-row">
        <div><label>Singles rating (optional)</label><input type="number" step="0.001" id="mf-singles" placeholder="e.g. 3.500"></div>
        <div><label>Skinny Singles rating (optional)</label><input type="number" step="0.001" id="mf-skinny" placeholder="e.g. 3.200"></div>
      </div>
      <p class="fineprint">A DUPR account is the standard way to join MPA. <a href="${DUPR_SIGNUP_URL}" target="_blank" rel="noopener">Create one free</a>. Don't have one yet? Rate yourself above — you can add your DUPR account later. Your email and phone are only visible to the admin, never on public pages.</p>
      <div class="btnrow"><button class="btn" id="mf-submit">Become a Member</button></div>
      <p class="fineprint" id="mf-err"></p>
    </div>`;
  // Self-rating fallback: the level picker (2.5–5.0) and the DUPR / self-rate switch.
  let mfLevel = null;
  document.querySelectorAll('input[name="mf-mode"]').forEach((r) => {
    r.addEventListener('change', () => {
      const self = document.querySelector('input[name="mf-mode"]:checked').value === 'self';
      document.getElementById('mf-dupr-fields').style.display = self ? 'none' : '';
      document.getElementById('mf-self-fields').style.display = self ? '' : 'none';
      document.getElementById('mf-err').textContent = '';
    });
  });
  document.querySelectorAll('#mf-levels button').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#mf-levels button').forEach((x) => x.classList.remove('picked'));
      b.classList.add('picked');
      mfLevel = +b.dataset.level;
    });
  });
  document.getElementById('mf-submit').onclick = async () => {
    const err = document.getElementById('mf-err');
    try {
      const mode = document.querySelector('input[name="mf-mode"]:checked')?.value || 'dupr';
      const duprId = normDuprId(document.getElementById('mf-dupr').value);
      const duprRating = document.getElementById('mf-rating').value ? +document.getElementById('mf-rating').value : null;
      if (mode === 'self') {
        if (mfLevel == null) { err.textContent = 'Pick your level.'; return; }
      } else if (!duprId || duprRating == null) {
        err.textContent = 'A DUPR ID and doubles rating are required — or rate yourself if you do not have a DUPR account yet.';
        return;
      } else {
        const idErr = duprIdError(duprId);
        if (idErr) { err.textContent = idErr; return; }
      }
      const { member } = await api('/api/members', {
        method: 'POST',
        body: JSON.stringify({
          name: document.getElementById('mf-name').value.trim(),
          email: document.getElementById('mf-email').value.trim(),
          phone: document.getElementById('mf-phone').value.trim(),
          duprId: mode === 'self' ? null : duprId,
          duprRating: mode === 'self' ? null : duprRating,
          selfRated: mode === 'self',
          selfRating: mode === 'self' ? mfLevel : null,
          duprProfileUrl: document.getElementById('mf-profile').value.trim() || null,
          resides: document.getElementById('mf-resides').value.trim() || null,
          age: document.getElementById('mf-age').value ? +document.getElementById('mf-age').value : null,
          country: document.getElementById('mf-country').value.trim() || null,
          photoUrl: document.getElementById('mf-photo').value.trim() || null,
          nickname: document.getElementById('mf-nick').value.trim() || null,
          gender: document.getElementById('mf-gender').value || null,
          height: document.getElementById('mf-height').value.trim() || null,
          handed: document.getElementById('mf-handed').value || null,
          singlesRating: document.getElementById('mf-singles').value ? +document.getElementById('mf-singles').value : null,
          skinnyRating: document.getElementById('mf-skinny').value ? +document.getElementById('mf-skinny').value : null,
        }),
      });
      setIdentity(member.person_id, member.name);
      toast(`Welcome to MPA, ${member.name}.`);
      if (onDone) onDone();
      else render();
    } catch (e) { err.textContent = e.message; }
  };
}

// ---------- league page ----------
let leagueTab = 'standings';
async function renderLeague(leagueId) {
  app.innerHTML = `<p class="muted">Loading league…</p>`;
  try {
    const { league, sessions, currentSessionId, registrationOpen } = await api(`/api/leagues/${leagueId}`);
    const id = getIdentity();
    // League visibility: a player sees only their own league(s); Admin sees all.
    const me = await api('/api/admin/me').catch(() => ({ admin: false }));
    if (id && !me.admin) {
      const mine = await myLeagues(id.personId).catch(() => []);
      if (!mine.some((l) => l.id === leagueId)) {
        app.innerHTML = `<div class="card"><h2>This isn't one of your leagues</h2>
          <p class="muted">You are not on the roster for ${esc(league.name)}. Players only see the leagues they are part of.</p>
          <div class="btnrow"><a class="btn" href="#/">← Your leagues</a></div></div>`;
        return;
      }
    }
    const cur = sessions.find((s) => s.id === currentSessionId) || null;
    const next = sessions.find((s) => s.status === 'upcoming') || null;
    const nextLine = !sessions.length ? '' : next
      ? `Next Game Day: ${new Date(next.starts_at).toLocaleDateString('en-US', { weekday: 'short' })} ${fmtDateShort(next.starts_at).replace(/, \d{4}$/, '')}, ${fmtTimeShort(next.starts_at)}`
      : 'Season complete';
    const sessionLines = [
      cur ? `Viewing Session: ${cur.session_number}` : null,
      nextLine || null,
    ].filter(Boolean).join('<br>');
    app.innerHTML = `
      <p><a href="#/">${id ? '← Your leagues' : '← All leagues'}</a></p>
      <h1>${esc(league.name)}</h1>
      <button class="btn secondary small" data-fav-league="${league.id}">${isFav(league.id) ? '★ Favorited' : '♡ Add to favorites'}</button>
      <p class="muted">${esc(league.type)} · ${esc(league.skill)} · ${esc(league.format)} · ${esc(league.day)}s ${esc(fmtClock(league.time))}<br>
      <a href="#" data-map="place" data-map-kind="place">${esc(league.location)}</a><br>
      ${fmtDateShort(league.start_date)} – ${fmtDateShort(league.stop_date)}${sessionLines ? `<br>${sessionLines}` : ''}</p>
      ${registrationOpen
        ? `<div class="card reg-open"><strong>✓ Registration Open — Join the League</strong><br>
           <div class="btnrow"><a class="btn green" href="#/join/${league.id}">Join the League</a></div></div>`
        : `<div class="card reg-closed"><strong>🔒 Registration Closed</strong><br>
           <span class="muted small">Sign-ups for this league are closed right now.</span></div>`}
      <div class="btnrow"><a class="btn secondary" href="mailto:moultriepickleball@gmail.com?subject=MPA%20league%20question">Contact League</a></div>
      ${currentSessionId ? `<div class="btnrow"><a class="btn" href="#/league/${league.id}/game/${currentSessionId}">Current Game Day</a>
        <button class="btn secondary" id="allDaysBtn">All Game Days</button></div>` : ''}
      <div class="tabs" role="tablist">
        <button data-tab="standings" class="${leagueTab === 'standings' ? 'active' : ''}">Standings</button>
        <button data-tab="schedule" class="${leagueTab === 'schedule' ? 'active' : ''}">Schedule</button>
        <button data-tab="info" class="${leagueTab === 'info' ? 'active' : ''}">Info</button>
      </div>
      <div id="tabBody"><p class="muted">Loading…</p></div>`;
    document.getElementById('allDaysBtn')?.addEventListener('click', () => openAllDays(league, sessions));
    document.querySelector('button[data-fav-league]')?.addEventListener('click', (e) => {
      const lid = +e.currentTarget.dataset.favLeague;
      toggleFav(lid);
      e.currentTarget.textContent = isFav(lid) ? '★ Favorited' : '♡ Add to favorites';
      toast(isFav(lid) ? 'Added to favorites on this device.' : 'Removed from favorites.');
    });
    app.querySelectorAll('.tabs button').forEach((b) => {
      b.onclick = () => { leagueTab = b.dataset.tab; renderLeague(leagueId); };
    });
    if (leagueTab === 'standings') await renderStandingsTab(league, sessions, currentSessionId, id);
    if (leagueTab === 'schedule') renderScheduleTab(league, sessions);
    if (leagueTab === 'info') renderInfoTab(league, registrationOpen);
  } catch (e) {
    app.innerHTML = `<div class="banner warn">${esc(e.message)}</div><p><a href="#/">&larr; All leagues</a></p>`;
  }
}

async function renderStandingsTab(league, sessions, currentSessionId, id) {
  const body = document.getElementById('tabBody');
  const { standings } = await api(`/api/leagues/${league.id}/standings`);
  const cols = [
    ['Rank', 'rank'], ['Previous', 'previous'], ['Max Mvmt', 'maxMvmt'], ['E/P Diff %', 'epDiff'],
    ['Penalty', 'penalty'], ['E/P Diff % - Penalty', 'score'], ['Earned', 'earned'],
    ['Against', 'against'], ['Possible', 'possible'], ['Wins', 'wins'], ['Losses', 'losses'],
    ['# Played', 'played'], ['# Missed', 'missed'], ['Miss Cur Game Day', 'missCurGameDay'],
  ];
  const fmt = (r, key) => {
    const v = r[key];
    if (key === 'epDiff' || key === 'score') return Number(v).toFixed(3) + '%';
    if (key === 'penalty') return Number(v).toFixed(1);
    if (key === 'previous') return v == null ? '—' : v;
    if (key === 'maxMvmt') return v == null ? '—' : v;
    if (key === 'missCurGameDay') return v ? 'Y' : '';
    return v;
  };
  body.innerHTML = `
    <div class="standings-wrap">
      <p class="scroll-hint">scroll left and right to see all columns</p>
      <div class="scroll-arrows">
        <button id="scrollL" aria-label="Scroll left">&lsaquo;</button>
        <button id="scrollR" aria-label="Scroll right">&rsaquo;</button>
      </div>
      <div class="table-scroll" id="standScroll">
        <table class="standings">
          <thead><tr><th class="name">Player</th>${cols.map(([label]) => `<th class="v"><span>${label}</span></th>`).join('')}</tr></thead>
          <tbody>
            ${standings.map((r) => `<tr class="${id && id.personId === r.person_id ? 'you' : ''}">
              <td class="name">${esc(r.name)}${id && id.personId === r.person_id ? '<span class="you-badge">YOU</span>' : ''}</td>
              ${cols.map(([, key]) => `<td>${fmt(r, key)}</td>`).join('')}
            </tr>`).join('') || '<tr><td colspan="15" class="muted">No players on the roster yet.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
    <div class="rule-box"><strong>Max Movement Rule — 20% of league size.</strong>
      Max movement per player this week is ${Math.floor((league.max_players || 36) * 0.2)}.
      Y marks a player who moved ${Math.floor((league.max_players || 36) * 0.2)} or more spots up or down this week. Otherwise N.<br>
      <span class="muted">Miss penalty: 1st miss free, 2nd miss 2.5 points off E/P Diff%, 3rd 5.0, each further miss +2.5.
      Only sessions after joining the roster count.</span></div>
    <div class="footer-box">
      <div class="transport">
        <a href="#" data-map="car" title="Drive">🚗</a>
        <a href="#" data-map="walk" title="Walk">🚶</a>
        <a href="#" data-map="transit" title="Transit">🚌</a>
        <a href="#" data-map="bike" title="Bike">🚲</a>
      </div>
      MPA ${esc(league.name)}<br>at<br>
      <a href="#" data-map="place" data-map-kind="place">${esc(league.location)}</a><br>
      ${mapPrefControl()}
    </div>`;
  const sc = document.getElementById('standScroll');
  document.getElementById('scrollL').onclick = () => sc.scrollBy({ left: -260, behavior: 'smooth' });
  document.getElementById('scrollR').onclick = () => sc.scrollBy({ left: 260, behavior: 'smooth' });
}

function renderScheduleTab(league, sessions) {
  const body = document.getElementById('tabBody');
  const byMonth = {};
  for (const s of sessions) {
    const key = new Date(s.starts_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    (byMonth[key] = byMonth[key] || []).push(s);
  }
  body.innerHTML = Object.entries(byMonth).map(([month, list]) => `
    <div class="month-bar">${month}</div>
    ${list.map((s) => {
      const d = new Date(s.starts_at);
      const badge = s.status === 'completed'
        ? '<span class="badge completed">Completed</span>'
        : `<span class="badge optin">Opt In ${fmtDateShort(s.starts_at)} ${fmtTimeShort(s.starts_at)}</span>`;
      return `<div class="day-card" onclick="location.hash='#/league/${league.id}/game/${s.id}'">
        <span class="dateblock"><span class="dow">${d.toLocaleDateString('en-US', { weekday: 'short' })}</span><br><span class="num">${d.getDate()}</span></span>
        <span class="info"><span class="t">${esc(league.name)}</span><br>
        <span class="s">Moultrie Pickleball Association · Session ${s.session_number} · ${esc(s.label)}</span></span>
        ${badge}
      </div>`;
    }).join('')}`).join('') || '<p class="muted">No game days yet.</p>';
}

function renderInfoTab(league, registrationOpen) {
  const body = document.getElementById('tabBody');
  body.innerHTML = `
    <div class="card"><h2>League Details</h2>
      <p><strong>Format:</strong> ${esc(league.format)} · <strong>Type:</strong> Ladder · <strong>Player Type:</strong> Scramble</p>
      <p><strong>Day/Time:</strong> ${esc(league.day)}s at ${esc(fmtClock(league.time))}</p>
      <p><strong>Season:</strong> ${esc(league.season || 'Not set')} · ${fmtDateShort(league.start_date)} – ${fmtDateShort(league.stop_date)}</p>
      <p><strong>Skill:</strong> ${esc(league.skill)} · <strong>Age:</strong> Any</p>
      <p><strong>Description:</strong> A ladder scramble league at the YMCA in Moultrie, GA. Courts are assigned by standings; players stay on the same court for the whole session.</p>
      <p><strong>Weather Policy:</strong> Play is outdoors on lighted courts. The organizer will announce any weather delay or cancellation.</p>
      <p><strong>Refund Policy:</strong> Contact the league organizer about refunds.</p>
    </div>
    <div class="card"><h2>Membership &amp; Participation</h2>
      <p>Membership in the Moultrie Pickleball Association is free and requires a DUPR account. Falsifying a DUPR rating or unsportsmanlike conduct may result in removal from the league.</p>
    </div>
    <div class="card"><h2>Session Details</h2>
      <p>Skill: ${esc(league.skill)} · Age: Any · Max Players Per Session: ${league.max_players} · Max Movement Rule: 0.20 · 1st Choice Group Size: 6 · 2nd Choice Group Size: 5</p>
    </div>
    <div class="card"><h2>Signup / Payment Type</h2>
      <p>Closed League. Registration is currently <strong>${registrationOpen === false ? 'Closed' : 'Open'}</strong>.</p>
    </div>
    <div class="card"><h2>New Players Start</h2><p>At Rating — first-night seeding is by DUPR rating, highest to lowest.</p></div>
    <div class="card"><h2>Ranking Type</h2>
      <p>Percentage of Points — % Earned to Possible, then Match Wins; a tie goes to the higher ranked player from the previous week.</p>
      <p><strong>Miss penalty (automatic):</strong> 1st miss free, 2nd miss 2.5 points off E/P Diff%, 3rd 5.0, each further miss +2.5. Only sessions after joining the roster count.</p>
      <p><strong>Admin Adjustment penalties:</strong> Unsportsmanlike conduct — 2.5 points. DUPR falsification is not a points penalty (a DUPR account is required to become a free member); it is a removal matter under Membership &amp; Participation.</p>
      <p><strong>DUPR seeding:</strong> until the first session is completed, standings, RSVP rank, and court assignment run by DUPR rating, highest to lowest. Unrated players rank below rated players.</p>
    </div>
    <div class="card"><h2>Location Information</h2>
      <p><a href="#" data-map="place" data-map-kind="place">${esc(league.location)}</a></p>
      <p>Surface: Pickleball Hardcourt · Play Area: Outdoor Non-Covered · Net: Permanent · Ball: Franklin X40 · Courts: 12 · Parking: No Fee · Lighting: Lighted</p>
      <p>${mapPrefControl()}</p>
    </div>`;
}

// ---------- all game days modal ----------
function openAllDays(league, sessions) {
  modalRoot.innerHTML = `
    <div class="modal-backdrop" id="backdrop">
      <div class="modal" role="dialog" aria-label="All Game Days">
        <button class="x" id="modalX" aria-label="Close">&times;</button>
        <h2>Session — All Game Days</h2>
        <div class="tabs"><button class="active">Current</button><button id="pastTab">Past</button></div>
        <div id="modalList">
          ${sessions.map((s) => `<button class="modal-row" data-sid="${s.id}">
            <span class="check">${s.status === 'completed' ? '✓' : ''}</span>
            <span><strong>Session ${s.session_number}</strong> — ${fmtDateTime(s.starts_at)}<br>
            <span class="muted small">${esc(s.label)} · ${s.status}</span></span></button>`).join('')}
        </div>
      </div>
    </div>`;
  const close = () => { modalRoot.innerHTML = ''; };
  document.getElementById('modalX').onclick = close;
  document.getElementById('backdrop').onclick = (e) => { if (e.target.id === 'backdrop') close(); };
  document.getElementById('pastTab').onclick = () => {
    document.getElementById('modalList').innerHTML = '<p class="muted">No past sessions available.</p>';
  };
  modalRoot.querySelectorAll('.modal-row').forEach((b) => {
    b.onclick = () => { close(); location.hash = `#/league/${league.id}/game/${b.dataset.sid}`; };
  });
  document.addEventListener('keydown', function escClose(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escClose); }
  });
}

// ---------- game day ----------
let gdTab = 'rsvps';
let scoreMatchId = null; // id of the match open in the dedicated score view (pauses the 30s auto-refresh)
async function renderGameDay(leagueId, sessionId) {
  const adminView = location.hash.includes('view=organizer');
  app.innerHTML = `<p class="muted">Loading game day…</p>`;
  try {
    const id = getIdentity();
    const viewer = id ? `?viewer=${id.personId}` : '';
    const data = await api(`/api/leagues/${leagueId}/sessions/${sessionId}${viewer}`);
    const { league, session, window: win, counts, playing, notPlaying, matches, groups, myCourt, warnings } = data;
    const rosterMap = new Map();
    [...playing, ...notPlaying].forEach((p) => rosterMap.set(p.person_id, p.name));

    const isFinished = session.status === 'completed';
    const revealed = win.isRevealed;
    app.innerHTML = `
      <p><a href="#/league/${leagueId}">&larr; Back to league</a> · <button class="linkbtn" id="allDaysBtn2">All Game Days</button></p>
      ${adminView && data.isAdmin ? `<div class="banner organizer"><strong>Organizer view</strong> — you see every court.
        <a href="#/admin">Back to Admin</a></div>` : ''}
      ${isFinished ? `<div class="banner finished">✓ This game day is finished. Scores are read-only — reopen it from Admin to change a score.</div>` : ''}
      <h1>${esc(league.name)}</h1>
      <p class="muted">Session ${session.session_number} · ${esc(session.label)}<br>
      <a href="#" data-map="place" data-map-kind="place">${esc(league.location)}</a><br>
      ${fmtDateTime(session.starts_at)}<br>
      Opt-in deadline: ${fmtDateTime(win.deadlineAt)} (${revealed ? 'passed' : 'in ' + countdownTo(win.deadlineAt)})</p>
      ${warnings && warnings.length ? `<div class="banner warn">${warnings.map(esc).join('<br>')}</div>` : ''}
      <div class="tabs">
        <button data-tab="rsvps" class="${gdTab === 'rsvps' ? 'active' : ''}">RSVPs</button>
        <button data-tab="groups" class="${gdTab === 'groups' ? 'active' : ''}">Groups</button>
        <button data-tab="matches" class="${gdTab === 'matches' ? 'active' : ''}">Matches</button>
      </div>
      <div id="gdBody"></div>`;
    document.getElementById('allDaysBtn2').onclick = async () => {
      const l = await api(`/api/leagues/${leagueId}`);
      openAllDays(l.league, l.sessions);
    };
    app.querySelectorAll('.tabs button').forEach((b) => {
      b.onclick = () => { gdTab = b.dataset.tab; scoreMatchId = null; renderGameDay(leagueId, sessionId); };
    });
    if (gdTab !== 'matches') scoreMatchId = null;
    if (gdTab === 'rsvps') renderRsvps(leagueId, sessionId, data, id);
    if (gdTab === 'groups') renderGroups(data, id);
    if (gdTab === 'matches') renderMatches(leagueId, sessionId, data, id);
   // Refresh quietly, but never while the player is typing a score.
clearInterval(refreshTimer);
refreshTimer = setInterval(() => {

      const ae = document.activeElement;
      if (ae && ae.tagName === 'INPUT') return;
      if (scoreMatchId) return;
      if (modalRoot.innerHTML) return;
      renderGameDay(leagueId, sessionId);
    }, 30000);
  } catch (e) {
    clearInterval(refreshTimer);
    app.innerHTML = `<div class="banner warn">${esc(e.message)}</div><p><a href="#/league/${leagueId}">&larr; Back to league</a></p>`;
  }
}

function renderRsvps(leagueId, sessionId, data, id) {
  const adminView = location.hash.includes('view=organizer');
  const body = document.getElementById('gdBody');
  const { counts, playing, notPlaying } = data;
  const total = counts.total || 0;
  const pct = total ? Math.round((counts.playing / total) * 100) : 0;
  const circ = 2 * Math.PI * 34;
  const rowHtml = (p, isPlaying) => {
    const isMe = id && id.personId === p.person_id;
    const fp = isPlaying && p.opted_in_at
      ? `<div class="fp">Opted in ${new Date(p.opted_in_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>` : '';
    const finished = data.session.status === 'completed';
    const btn = (adminView && data.isAdmin && !finished)
      ? (isPlaying
        ? `<button class="btn secondary small" data-act="admin-out" data-pid="${p.person_id}">Opt out</button>`
        : `<button class="btn green small" data-act="admin-in" data-pid="${p.person_id}">Opt in</button>`)
      : (isMe
        ? (isPlaying
          ? `<button class="btn secondary small" data-act="out" data-pid="${p.person_id}">Opt out</button>`
          : `<button class="btn green small" data-act="in" data-pid="${p.person_id}">Opt in</button>`)
        : '');
    return `<div class="person-row ${!id ? 'tappable' : ''}" data-pid="${p.person_id}">
      <span class="rank">${p.rank ?? '—'}</span>
      <span class="who"><span class="nm">${esc(p.name)}</span>${isMe ? '<span class="you-badge">YOU</span>' : ''}${fp}</span>
      ${btn}
    </div>`;
  };
  body.innerHTML = `
    <div class="card"><div class="donut-row">
      <svg width="90" height="90" viewBox="0 0 90 90">
        <circle cx="45" cy="45" r="34" fill="none" stroke="#e8e6e1" stroke-width="12"/>
        <circle cx="45" cy="45" r="34" fill="none" stroke="#1a7f37" stroke-width="12"
          stroke-dasharray="${(pct / 100) * circ} ${circ}" transform="rotate(-90 45 45)"/>
        <text x="45" y="50" text-anchor="middle" font-size="16" font-weight="700">${counts.playing}/${total}</text>
      </svg>
      <div class="donut-legend">
        <span class="dot" style="background:#1a7f37"></span>Playing: ${counts.playing}<br>
        <span class="dot" style="background:#e8e6e1"></span>Not Playing: ${counts.notPlaying}<br>
        <span class="dot" style="background:#f7c948"></span>Total: ${total}
      </div>
    </div></div>
    ${!id ? '<div class="banner">Tap your name below to identify yourself — then you can opt in and see your court.</div>' : ''}
    <div class="card"><h3>Playing (${counts.playing})</h3>
      <div class="searchrow"><input type="text" id="searchP" placeholder="Search players…"></div>
      <div id="playingList">${playing.map((p) => rowHtml(p, true)).join('') || '<p class="muted">Nobody opted in yet.</p>'}</div>
    </div>
    <div class="card"><h3>Not Playing (${counts.notPlaying})</h3>
      <div class="searchrow"><input type="text" id="searchN" placeholder="Search players…"></div>
      <div id="notPlayingList">${notPlaying.map((p) => rowHtml(p, false)).join('') || '<p class="muted">Everyone is playing.</p>'}</div>
    </div>`;
  const wire = (inputId, listId) => {
    const inp = document.getElementById(inputId);
    if (!inp) return;
    inp.oninput = () => {
      const q = inp.value.toLowerCase();
      document.getElementById(listId).querySelectorAll('.person-row').forEach((row) => {
        row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    };
  };
  wire('searchP', 'playingList');
  wire('searchN', 'notPlayingList');
  body.querySelectorAll('.person-row.tappable').forEach((row) => {
    row.onclick = (e) => {
      if (e.target.tagName === 'BUTTON') return;
      const pid = +row.dataset.pid;
      const name = row.querySelector('.nm').textContent;
      setIdentity(pid, name);
      toast(`You are ${name}.`);
      renderGameDay(leagueId, sessionId);
    };
  });
  body.querySelectorAll('button[data-act]').forEach((b) => {
    b.onclick = async () => {
      const pid = +b.dataset.pid;
      const act = b.dataset.act;
      try {
        if (act === 'in') await post(`/api/leagues/${leagueId}/sessions/${sessionId}/opt-in`, { personId: pid });
        else if (act === 'out') await post(`/api/leagues/${leagueId}/sessions/${sessionId}/opt-out`, { personId: pid });
        else if (act === 'admin-in') await post(`/api/admin/leagues/${leagueId}/sessions/${sessionId}/opt-in`, { personId: pid });
        else await post(`/api/admin/leagues/${leagueId}/sessions/${sessionId}/opt-out`, { personId: pid });
        toast(act === 'in' ? 'Opted in — you are checked in.' : act === 'admin-in' ? 'Opted in by Admin.' : act === 'admin-out' ? 'Opted out by Admin.' : 'Opted out.');
        renderGameDay(leagueId, sessionId);
      } catch (e) { toast(e.message); }
    };
  });
}

function renderGroups(data, id) {
  const body = document.getElementById('gdBody');
  const { groups, window: win, isAdmin } = data;
 if (!win.isRevealed && !isAdmin) {

    body.innerHTML = `<div class="card"><p>Groups will show once the opt-in deadline passes (${fmtDateTime(win.deadlineAt)}).</p></div>`;
    return;
  }
  if (!groups || !groups.length) {
    body.innerHTML = `<div class="card"><p>No schedule yet. ${isAdmin ? 'Build it from Admin → Game day tools.' : 'The organizer builds the schedule after the deadline.'}</p></div>`;
    return;
  }
  body.innerHTML = groups.map((g) => `
    <div class="court-card"><h3>Court ${g.court}</h3>
      ${g.players.map((p) => `<div class="person-row"><span class="who"><span class="nm">${esc(p.name)}</span>${id && id.personId === p.person_id ? '<span class="you-badge">YOU</span>' : ''}</span></div>`).join('')}
    </div>`).join('');
}

function renderMatches(leagueId, sessionId, data, id) {
  const body = document.getElementById('gdBody');
  const { matches, window: win, isAdmin, session } = data;
 if (!win.isRevealed && !isAdmin) {

    body.innerHTML = `<div class="card"><p>Matches will show once the game day starts.</p></div>`;
    return;
  }
  if (!matches || !matches.length) {
    body.innerHTML = `<div class="card"><p>No matches yet. ${isAdmin ? 'Build the schedule from Admin → Game day tools.' : ''}</p></div>`;
    return;
  }
  const rosterMap = new Map();
  [...data.playing, ...data.notPlaying].forEach((p) => rosterMap.set(p.person_id, p.name));
  const finished = session.status === 'completed';
  const games = matches.filter((m) => m.kind === 'match');
  const byes = matches.filter((m) => m.kind === 'bye');
  const byeForRound = (round) => byes.find((b) => b.round === round);
  // A dedicated score view is open — show it instead of the list.
  if (scoreMatchId) {
    const open = games.find((g) => g.id === scoreMatchId);
    if (open) { renderScoreView(leagueId, sessionId, id, open, rosterMap); return; }
    scoreMatchId = null;
  }
  if (!games.length) {
    body.innerHTML = byes.map((m) => `<div class="bye-row">Court ${m.court} · Round ${m.round} — ${esc(personName(rosterMap, m.bye_person_id))} sits out (BYE)</div>`).join('');
    return;
  }
 const cardHtml = (m, showScore) => {
  const t1 = `${esc(personName(rosterMap, m.team1_p1))} & ${esc(personName(rosterMap, m.team1_p2))}`;
  const t2 = `${esc(personName(rosterMap, m.team2_p1))} & ${esc(personName(rosterMap, m.team2_p2))}`;
  const bye = byeForRound(m.round);
  const scored = m.score1 != null;
  return `<div class="match-card">
    <div class="teams">Match ${m.round}</div>
    <p class="muted">First to ${m.target_score}, win by 1</p>
    <div class="muted">Court ${m.court} · Round ${m.round}</div>
    <div class="teams">${t1}</div>
    <div class="vs">VS</div>
    <div class="teams">${t2}</div>
    ${bye ? `<div class="bye-row">${esc(personName(rosterMap, bye.bye_person_id))} — BYE</div>` : ''}
    ${scored ? `<p>${m.score1} – ${m.score2}</p>` : ''}
    ${showScore && !finished ? `<button class="btn" data-score="${m.id}">SCORE</button>` : ''}
  </div>`;
};


  const current = games.find((m) => m.score1 == null);
  const done = games.filter((m) => m.score1 != null);
  let html = '';
  if (!current) {
    html += `<div class="card"><p><strong>All matches scored</strong></p></div>`;
  } else {
    html += cardHtml(current, true);
  }
  if (done.length) {
    html += `<h3>Finished</h3>` + done.map((m) => cardHtml(m, true)).join('');
  }
  body.innerHTML = html;
  body.querySelectorAll('button[data-score]').forEach((b) => {
    b.onclick = () => { scoreMatchId = +b.dataset.score; renderGameDay(leagueId, sessionId); };
  });
}

// Dedicated one-match score screen, opened from the Matches list via SCORE.
// scoreMatchId tracks the open match so the 30s auto-refresh never kicks
// the player out mid-entry.
function renderScoreView(leagueId, sessionId, id, m, rosterMap) {
  const body = document.getElementById('gdBody');
  const p1 = esc(personName(rosterMap, m.team1_p1));
  const p2 = esc(personName(rosterMap, m.team1_p2));
  const p3 = esc(personName(rosterMap, m.team2_p1));
  const p4 = esc(personName(rosterMap, m.team2_p2));
  const scored = m.score1 != null;
  body.innerHTML = `
    <div class="match-card">
      <h3>Match ${m.round} · Court ${m.court} · Round ${m.round}</h3>
      <p class="muted">Games to ${m.target_score}</p>
      <div class="teams">${p1}<br>${p2}</div>
      <div class="score-row">
        <input type="text" inputmode="numeric" id="sv-s1" value="${scored ? m.score1 : ''}" placeholder="—" aria-label="Team 1 score">
      </div>
      <div class="vs" style="text-align:center">VS</div>
      <div class="teams">${p3}<br>${p4}</div>
      <div class="score-row">
        <input type="text" inputmode="numeric" id="sv-s2" value="${scored ? m.score2 : ''}" placeholder="—" aria-label="Team 2 score">
      </div>
      <div class="score-row">
        <button class="btn" id="svSave">Save score</button>
        ${scored ? `<button class="btn secondary small" id="svClear">Clear</button>` : ''}
        <button class="btn secondary" id="svBack">Back</button>
      </div>
    </div>`;

  document.getElementById('svBack').onclick = () => { scoreMatchId = null; renderGameDay(leagueId, sessionId); };
  document.getElementById('svSave').onclick = async () => {
    const s1 = document.getElementById('sv-s1').value;
    const s2 = document.getElementById('sv-s2').value;
    const n1 = s1 === '' ? null : +s1;
    const n2 = s2 === '' ? null : +s2;
    if (n1 == null || n2 == null) { toast('Enter both scores.'); return; }
    if (!Number.isInteger(n1) || !Number.isInteger(n2) || n1 < 0 || n2 < 0 || n1 > 30 || n2 > 30) { toast('Scores must be whole numbers from 0 to 30.'); return; }
    if (n1 === n2) { toast('Scores cannot tie.'); return; }
    if (Math.max(n1, n2) !== m.target_score) { toast(`One side must reach ${m.target_score} (games to ${m.target_score}).`); return; }
    try {
      await post(`/api/leagues/${leagueId}/sessions/${sessionId}/matches/${m.id}/score`, {
        personId: id ? id.personId : null,
        score1: n1,
        score2: n2,
      });
      toast('Score saved.');
      scoreMatchId = null;
      renderGameDay(leagueId, sessionId);
    } catch (e) { toast(e.message); }
  };
  const clearBtn = document.getElementById('svClear');
  if (clearBtn) {
    clearBtn.onclick = async () => {
      try {
        await post(`/api/leagues/${leagueId}/sessions/${sessionId}/matches/${m.id}/score`, {
          personId: id ? id.personId : null, score1: null, score2: null,
        });
        toast('Score cleared.');
        scoreMatchId = null;
        renderGameDay(leagueId, sessionId);
      } catch (e) { toast(e.message); }
    };
  }
}

// ---------- admin ----------
let adminLeagueId = null;
let adminSections = {};
async function renderAdmin() {
  clearInterval(refreshTimer);
  const me = await api('/api/admin/me').catch(() => ({ admin: false, passcodeConfigured: false }));
  if (!me.admin) {
    const list = await api('/api/admin/list').catch(() => ({ admins: [] }));
    const admins = list.admins || [];
    app.innerHTML = `
      <div class="admin-watermark" aria-hidden="true"></div>
      <div class="admin-view">
      <h1>Admin</h1>
      <p class="muted">ADMIN ONLY — pick your name and enter your passcode.</p>
      ${me.passcodeConfigured ? '' : '<div class="banner warn">No Admin passcode is configured on this server yet. Set ADMIN_PASSCODE in the environment.</div>'}
      <div class="card">
        ${admins.length ? `
        <label>Sign in as</label>
        <select id="loginAdmin">${admins.map((a) => `<option value="${a.person_id}">${esc(a.name)}</option>`).join('')}</select>
        <label>Admin passcode</label>
        <input type="password" id="passcode" autocomplete="current-password" placeholder="Passcode">
        <div class="btnrow"><button class="btn" id="loginBtn">Sign in</button></div>
        <p class="fineprint" id="loginErr"></p>
        <p class="fineprint">Each admin has their own passcode. Forgot yours? Ask an admin to set a new one for you.</p>`
        : '<p class="muted">No admins are flagged yet — flag one in Admin → Members → Edit. (You need to be signed in as Admin to do that.)</p>'}
      </div></div>`;
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
      loginBtn.onclick = async () => {
        const personId = +document.getElementById('loginAdmin').value;
        const passcode = document.getElementById('passcode').value;
        try {
          const out = await post('/api/admin/login', { personId, passcode });
          toast(`Signed in as ${out.name || 'Admin'}.`);
          syncAdminLink();
          renderAdmin();
        } catch (e) {
          document.getElementById('loginErr').textContent = e.message;
        }
      };
      document.getElementById('passcode').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') loginBtn.click();
      });
    }
    return;
  }

  const { leagues } = await api('/api/leagues');
  if (!adminLeagueId && leagues.length) adminLeagueId = leagues[0].id;
  const league = leagues.find((l) => l.id === adminLeagueId);
  app.innerHTML = `
    <div class="admin-watermark" aria-hidden="true"></div>
    <div class="admin-view">
    <h1>Admin</h1><p class="muted">ADMIN ONLY</p>
    <p class="muted">Signed in as <strong>${esc(me.name || 'Admin')}</strong></p>
    <div class="btnrow"><button class="btn secondary small" id="logoutBtn">Sign out</button><a class="btn secondary small" href="#/roundrobin">Round Robin</a><a class="btn secondary small" href="#/bracket">Bracket</a></div>
    <div class="league-tabs">
      ${leagues.map((l) => `<button data-lid="${l.id}" class="${l.id === adminLeagueId ? 'active' : ''}">${esc(l.name)}</button>`).join('')}
    </div>
    <div id="adminBody"></div></div>`;
  document.getElementById('logoutBtn').onclick = async () => {
    await post('/api/admin/logout', {});
    syncAdminLink();
    renderAdmin();
  };
  app.querySelectorAll('.league-tabs button').forEach((b) => {
    b.onclick = () => { adminLeagueId = +b.dataset.lid; renderAdmin(); };
  });
  renderAdminBody(leagues, league, me);
}

function section(key, title, desc, innerHtml) {
  const open = !!adminSections[key];
  return `<div class="admin-section sec-${key}">
    <button class="head" data-sec="${key}">
      <span><span class="t">${title}</span><br><span class="d">${desc}</span></span>
      <span class="chev">${open ? '▾' : '▸'}</span>
    </button>
    ${open ? `<div class="body">${innerHtml}</div>` : ''}
  </div>`;
}

// One row per admin activity entry: "{Name} signed in · {date/time}".
// The table only holds sign-ins in this build; any future action label
// renders as-is instead of "signed in".
function activityRowsHtml(entries) {
  if (!entries || !entries.length) return '<p class="muted">No admin sign-ins yet.</p>';
  return entries.map((e) => `
    <div class="person-row"><span class="who"><span class="nm">${esc(e.name || 'Admin')}</span>
      <div class="fp">${e.action === 'sign-in' ? 'signed in' : esc(e.action)} · ${esc(fmtActivityTime(e.created_at))}</div></span></div>`).join('');
}

async function renderAdminBody(leagues, league, me) {
  const body = document.getElementById('adminBody');

  // ---- logo color for the current league (follows the league, no picker) ----
  let logoHtml = '';
  if (league) {
    logoHtml = `<div class="card"><strong>Logo color for ${esc(league.name)}:</strong> ${esc(colorForLeague(league))} — the logo color follows the league: Advanced blue, Intermediate/Advanced green, Women's pink, Elite dark gray, 50+ red, anything else black and yellow.</div>`;
  }

  // ---- create a league (with per-week date editing) ----
  const createHtml = `
    <div class="rr-create-card">
      <h3>CREATE A LEAGUE <span class="rr-admin-badge">ADMIN</span></h3>
    <label>League Name</label><input type="text" id="cl-name" placeholder="e.g. Advanced 2026">
    <div class="field-row">
      <div><label>Type</label><select id="cl-type">
        <option>Intermediate</option><option>Intermediate/Advanced</option><option selected>Advanced</option><option>Elite</option><option>Women's</option>
      </select></div>
      <div><label>Skill</label><select id="cl-skill">
        <option>2.5-2.99</option><option>3.0-3.49</option><option selected>3.5-4.49</option><option>5.0-ABOVE</option><option>50+</option>
      </select></div>
    </div>
    <div class="field-row">
      <div><label>Format</label><select id="cl-format">
        <option selected>Coed Doubles</option><option>Women's Doubles</option><option>Men's Doubles</option>
      </select></div>
      <div><label>Logo color</label><p class="fineprint">Set by the league — Advanced blue, Intermediate/Advanced green, Women's pink, Elite dark gray, 50+ red, anything else black and yellow.</p></div>
    </div>
    <div class="field-row">
      <div><label>Day</label><select id="cl-day">
        <option>Monday</option><option>Tuesday</option><option>Wednesday</option><option>Thursday</option><option>Friday</option><option selected>Saturday</option><option>Sunday</option>
      </select></div>
      <div><label>Time</label><select id="cl-time">
        <option>08:30</option><option>09:00</option><option>17:00</option><option selected>18:30</option><option>19:00</option>
      </select><p class="fineprint">YMCA, 601 26th Ave SE, Moultrie, GA 31768</p></div>
    </div>
    <div class="field-row">
      <div><label>Season start</label><input type="date" id="cl-start"></div>
      <div><label>Season stop</label><input type="date" id="cl-stop"></div>
    </div>
    <div class="field-row">
      <div><label>Season</label><select id="cl-season"><option value="">Not set</option><option>Winter 2026</option><option>Spring 2027</option><option>Summer 2027</option><option>Fall 2027</option></select></div>
      <div><label>Max players</label><input type="number" id="cl-max" value="36" min="4" max="36"><p class="fineprint">Max 36 players, max 6 courts.</p></div>
    </div>
    <div class="btnrow"><button class="btn secondary small" id="cl-gen-dates">Generate the 8 weekly dates</button></div>
    <div id="cl-dates"><p class="fineprint">Pick the start date and day above, then generate the 8 weekly game days. Each week's date can be edited — move a week that falls on a holiday or during school vacation.</p></div>
    <div class="btnrow"><button class="btn" id="cl-create">Create league</button></div>
    <p class="fineprint" id="cl-err"></p>
    </div>
    <h3>Edit an existing league</h3>
    <label>League</label><select id="el-league">${leagues.map((l) => `<option value="${l.id}" ${league && l.id === league.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
    <label>League Name</label><input type="text" id="el-name">
    <div class="field-row">
      <div><label>Type</label><select id="el-type">
        <option>Intermediate</option><option>Intermediate/Advanced</option><option>Advanced</option><option>Elite</option><option>Women's</option>
      </select></div>
      <div><label>Skill</label><select id="el-skill">
        <option>2.5-2.99</option><option>3.0-3.49</option><option>3.5-4.49</option><option>5.0-ABOVE</option><option>50+</option>
      </select></div>
    </div>
    <div class="field-row">
      <div><label>Format</label><select id="el-format">
        <option>Coed Doubles</option><option>Women's Doubles</option><option>Men's Doubles</option>
      </select></div>
      <div><label>Season</label><select id="el-season"><option value="">Not set</option><option>Winter 2026</option><option>Spring 2027</option><option>Summer 2027</option><option>Fall 2027</option></select></div>
    </div>
    <div class="field-row">
      <div><label>Day</label><select id="el-day">
        <option>Monday</option><option>Tuesday</option><option>Wednesday</option><option>Thursday</option><option>Friday</option><option>Saturday</option><option>Sunday</option>
      </select></div>
      <div><label>Time</label><select id="el-time">
        <option>08:30</option><option>09:00</option><option>17:00</option><option>18:30</option><option>19:00</option>
      </select></div>
    </div>
    <div class="field-row">
      <div><label>Season start</label><input type="date" id="el-start"></div>
      <div><label>Season stop</label><input type="date" id="el-stop"></div>
    </div>
    <p class="fineprint">Changing the time moves the start time of upcoming game days (same dates) so the opt-in deadline follows the new time. Game-day dates are moved separately under Game day tools.</p>
    <div class="btnrow"><button class="btn" id="el-save">Save league changes</button></div>
    <p class="fineprint" id="el-err"></p>`;

  // ---- per-league data for the sections below ----
  let regHtml = '<p class="muted">Pick a league above.</p>';
  let regsHtml = '<p class="muted">Pick a league above.</p>';
  let membersHtml = '<p class="muted">Pick a league above.</p>';
  let playersHtml = '<p class="muted">Pick a league above.</p>';
  let penaltiesHtml = '<p class="muted">Pick a league above.</p>';
  let toolsHtml = '<p class="muted">Pick a league above.</p>';

  // Members are not tied to a league — the directory lists every free
  // member with Edit/Remove whether or not a league exists. (With no
  // leagues live this used to read "Pick a league above.")
  const { members } = await api('/api/admin/members');
  membersHtml = members.map((m) => `
    <div class="person-row" data-mid="${m.id}"><span class="who"><span class="nm${m.is_admin ? ' admin-name' : ''}">${esc(m.name)}${m.is_admin ? ' <span class="admin-badge">ADMIN</span>' : ''}</span>
      <div class="fp">${m.self_rated ? `Self-rated ${m.dupr_rating ?? ''}` : `DUPR ${esc(m.dupr_id || '—')} · ${m.dupr_rating ?? ''}`}${m.leagues && m.leagues.length ? ` · Leagues: ${m.leagues.map(esc).join(', ')}` : ''}</div>
      <div class="fp">${esc(m.email || '')}${m.email && m.phone ? ' · ' : ''}${esc(fmtPhone(m.phone))} · joined ${fmtDateShort(m.joined_at)}${m.updated_at ? ` · updated ${fmtDateShort(m.updated_at)}` : ''}${m.rating_changes ? ` · ${m.rating_changes} rating change${m.rating_changes === 1 ? '' : 's'}` : ''}</div></span>
      <span class="rowbtns">
        <button class="btn secondary small" data-mem-edit="${m.id}">Edit</button>
        <button class="btn secondary small" data-mem-del="${m.id}">Remove</button>
      </span></div>
    <div class="edit-slot" id="mem-edit-${m.id}"></div>`).join('') || '<p class="muted">No free members yet.</p>';

  // ---- admin passcodes (each admin signs in with their own) ----
  const { admins: passcodeAdmins } = await api('/api/admin/passcodes');
  const passcodesHtml = `
    <p class="fineprint">Each admin signs in with their own passcode. Alan's master passcode (the one set in the server) always works for him too. Only the scrambled form of a passcode is ever stored — nobody can look one up. Forgot yours? Another admin sets a new one for you here.</p>
    ${passcodeAdmins.map((a) => `
    <div class="person-row"><span class="who"><span class="nm">${esc(a.name)}</span>
      <div class="fp">${a.has_passcode ? 'Passcode set' : 'No passcode set yet'}</div></span>
      <span class="rowbtns">
        <input type="password" id="pc-${a.person_id}" placeholder="New passcode" autocomplete="new-password" style="width:140px">
        <button class="btn secondary small" data-pc-set="${a.person_id}">${a.has_passcode ? 'Change' : 'Set'}</button>
        ${a.has_passcode ? `<button class="btn secondary small" data-pc-del="${a.person_id}">Remove</button>` : ''}
      </span></div>`).join('') || '<p class="muted">No admins flagged yet.</p>'}
    <p class="fineprint" id="pc-msg"></p>`;

  // ---- admin activity (sign-ins; refreshes every 30 seconds below) ----
  const { activity } = await api('/api/admin/activity');
  const activityHtml = `<div id="admin-activity-list">${activityRowsHtml(activity)}</div>`;

  if (league) {
    const l = await api(`/api/leagues/${league.id}`);
    regHtml = `
      <p>Registration for <strong>${esc(league.name)}</strong> is currently <strong>${l.registrationOpen ? 'Open' : 'Closed'}</strong>.</p>
      <p class="fineprint">Open: the home panel shows a green "Registration Open — Join the League" button. Closed: it shows a grey locked "Registration Closed" button. The Info tab wording follows this switch.</p>
      <div class="btnrow"><button class="btn" id="rg-toggle">${l.registrationOpen ? 'Close registration' : 'Open registration'}</button></div>`;

    const { registrations } = await api(`/api/admin/leagues/${league.id}/registrations`);
    regsHtml = registrations.map((r) => `
      <div class="person-row"><span class="who"><span class="nm">${esc(r.name)}</span>
        <div class="fp">${r.self_rated ? `Self-rated ${r.dupr_rating ?? ''}` : `DUPR ${esc(r.dupr_id || '—')} · ${r.dupr_rating ?? ''}`} · ${r.membership_type === 'member' ? 'YMCA member $20' : 'Non-member $50'} · ${r.status}${r.fee_waived ? ' · <span class="fee-waived">Fee waived</span>' : ''}</div>
        <div class="fp">${esc(r.email || '')}${r.email && r.phone ? ' · ' : ''}${esc(fmtPhone(r.phone))}</div></span>
        <span class="rowbtns">
          ${r.status === 'pending' ? `<button class="btn small" data-reg-confirm="${r.id}">Confirm</button>` : ''}
          ${r.status !== 'added' ? `<button class="btn green small" data-reg-add="${r.id}">Add to league</button>` : ''}
          <button class="btn secondary small" data-reg-waive="${r.id}" data-waived="${r.fee_waived ? 1 : 0}">${r.fee_waived ? 'Undo fee waiver' : 'Waive fee'}</button>
          <button class="btn secondary small" data-reg-del="${r.id}">Delete</button>
        </span></div>`).join('') || '<p class="muted">No sign-ups for this league yet.</p>';
    regsHtml += `<p class="fineprint">Confirm moves a sign-up to confirmed; "Add to league" puts the person on the roster (carrying any fee waiver with them). Waiving a fee hides the ReClique Pay button for that person. Nothing here charges anyone — payment happens on ReClique.</p>`;

    const { roster } = await api(`/api/leagues/${league.id}/roster`);
    playersHtml = `
      <label>Add a player</label>
      <input type="text" id="ap-name" placeholder="Full name" autocomplete="off">
      <div id="ap-suggest"></div>
      <div class="field-row">
        <div><label>DUPR ID</label><input type="text" id="ap-dupr"><p class="fineprint">6 letters and numbers, like 7D6WR0.</p></div>
        <div><label>DUPR doubles rating</label><input type="number" step="0.001" id="ap-rating" placeholder="e.g. 3.643"></div>
      </div>
      <label>DUPR profile link (optional)</label><input type="text" id="ap-profile" placeholder="https://…">
      <div class="btnrow"><button class="btn" id="ap-add">Add to ${esc(league.name)}</button></div>
      <p class="fineprint" id="ap-err"></p>
      <h3>Roster (${roster.length})</h3>
      ${roster.map((p) => `<div class="person-row"><span class="who"><span class="nm">${esc(p.name)}</span>
        <div class="fp">${p.dupr_id ? `DUPR ${esc(p.dupr_id)} · ${p.dupr_rating ?? ''}` : 'No DUPR on file'}${p.fee_waived ? ' · <span class="fee-waived">Fee waived</span>' : ''}</div></span>
        <span class="rowbtns">
          <button class="btn secondary small" data-p-waive="${p.person_id}" data-waived="${p.fee_waived ? 1 : 0}">${p.fee_waived ? 'Undo fee waiver' : 'Waive fee'}</button>
          <button class="btn secondary small" data-p-edit="${p.person_id}">Edit DUPR</button>
          <button class="btn secondary small" data-p-name="${p.person_id}">Edit name</button>
          <button class="btn secondary small" data-remove="${p.person_id}">Remove</button>
        </span></div>
      <div class="edit-slot" id="p-edit-${p.person_id}"></div>`).join('') || '<p class="muted">No players yet.</p>'}`;

    const { standings } = await api(`/api/leagues/${league.id}/standings`);
    penaltiesHtml = `<p class="fineprint">Miss penalty is automatic: 1st miss free, 2nd miss 2.5 points off E/P Diff%, 3rd 5.0, each further miss +2.5. Only sessions after joining the roster count. The Admin adjustment is on top — extra penalty points for the defined penalties (see Info tab): unsportsmanlike conduct, 2.5 points.</p>` +
      standings.map((s) => `
      <div class="person-row"><span class="who"><span class="nm">${esc(s.name)}</span>
        <div class="fp">Missed ${s.missed} · Miss penalty ${Number(s.missPenalty).toFixed(1)} · Total penalty ${Number(s.penalty).toFixed(1)}</div></span>
        <span class="rowbtns"><label class="fineprint">Admin adjustment</label>
        <input type="number" step="0.5" min="0" class="adj-input" id="adj-${s.person_id}" value="${Number(s.penalty - s.missPenalty).toFixed(1)}">
        <button class="btn small" data-adj-save="${s.person_id}">Save</button></span></div>`).join('') || '<p class="muted">No players yet.</p>';

    const upcomingSessions = l.sessions.filter((s) => s.status === 'upcoming');
    const curSession = l.sessions.find((s) => s.status !== 'completed') || l.sessions[l.sessions.length - 1];
    const moveHtml = upcomingSessions.length ? `
      <label>Game day to move</label>
      <select id="gt-move-session">${upcomingSessions.map((s) => `<option value="${s.id}">Week ${s.session_number} — ${fmtDateShort(s.date)}</option>`).join('')}</select>
      <label>New date</label>
      <input type="date" id="gt-move-date">
      <div class="btnrow"><button class="btn" id="gt-move">Move game day</button></div>
      <p class="fineprint" id="gt-move-msg"></p>` : '<p class="muted">No upcoming game days to move.</p>';
    toolsHtml = `
      <label>Game day</label>
      <select id="gt-session">${l.sessions.map((s) => `<option value="${s.id}" ${curSession && s.id === curSession.id ? 'selected' : ''}>Session ${s.session_number} — ${fmtDateShort(s.starts_at)} (${s.status})</option>`).join('')}</select>
      <div class="btnrow">
        <button class="btn" id="gt-build">Build / Rebuild schedule</button>
        <button class="btn green" id="gt-finish">Finish game day</button>
        <button class="btn secondary" id="gt-view">View as Organizer</button>
        <button class="btn secondary" id="gt-sheet">Print Court Sheet</button>
        <button class="btn secondary" id="gt-alldays">All Game Days</button>
      </div>
      <p class="fineprint" id="gt-msg"></p>
      <p class="fineprint">Finish asks "finish anyway?" if games are unscored. Rebuilding keeps scores where the same four players stay together. The Court Sheet lists each court with its players and a check-off box by every name — print it before the night.</p>
      <h3>Move a game day</h3>
      ${moveHtml}
      <p class="fineprint">Moving a game day shifts that day and every game day after it by the same amount, so the season stays weekly — if a night is rained out, moving it a week pushes the whole rest of the season back a week.</p>`;
  }

  // ---- custom message: type any text and pick who it goes to ----
  // Who "Just me" is: the signed-in admin, or the one flagged admin
  // when the sign-in is a legacy token with no person id.
  const flaggedAdmins = members.filter((m) => m.is_admin);
  const mePid = (me && me.personId) || (flaggedAdmins.length === 1 ? flaggedAdmins[0].person_id : null);
  const cmMembers = members.filter((m) => m.phone).slice().sort((a, b) => a.name.localeCompare(b.name));
  const cmNoPhone = members.length - cmMembers.length;
  const cmListHtml = cmMembers.map((m) => `
      <label style="display:block"><input type="checkbox" class="cm-pick" value="${esc(m.phone)}" data-pid="${m.person_id}" data-me="${m.person_id === mePid ? '1' : '0'}"> ${esc(m.name)}${m.person_id === mePid ? ' (you)' : ''} · ${esc(fmtPhone(m.phone))}</label>`).join('');

  // ---- announce a league (the drafts) ----
 const announceSectionHtml = `

    <label>Announce</label>
    <label class="radio"><input type="radio" name="an-mode" value="one" checked> One league</label><br>
    <label class="radio"><input type="radio" name="an-mode" value="all"> All open leagues</label><br>
    <label class="radio"><input type="radio" name="an-mode" value="join"> Join MPA</label>
    <label>League</label>
    <select id="an-league">${leagues.map((l) => `<option value="${l.id}" ${league && l.id === league.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
    <div class="btnrow"><button class="btn" id="an-gen">Write the announcement</button></div>
    <div id="an-out"><p class="fineprint">Picks the league and writes an advertising email and a shorter text version from that league's saved record. Nothing is sent by the app — copy the drafts and send them from your own email or phone.</p></div>
    <div class="card"><h3>Custom message — pick who it goes to</h3>
      <p class="muted small">Type any message and choose who gets it — just yourself to test it, everyone, or pick names. Nothing is sent by the app; it opens your Messages app with the message filled in and only the people you picked.</p>
      <label>Message</label>
      <textarea id="cm-text" rows="4" style="width:100%" placeholder="Type your message here"></textarea>
      <label>Who gets it</label>
      <div class="btnrow">
        <button class="btn secondary small" id="cm-just-me" type="button">Just me</button>
        <button class="btn secondary small" id="cm-everyone" type="button">Everyone</button>
        <button class="btn secondary small" id="cm-clear" type="button">Clear</button>
      </div>
      <div id="cm-list" style="max-height:220px;overflow-y:auto">${cmListHtml}</div>
      ${cmNoPhone ? `<p class="fineprint">${cmNoPhone} member${cmNoPhone === 1 ? '' : 's'} ${cmNoPhone === 1 ? 'has' : 'have'} no phone on file and ${cmNoPhone === 1 ? 'is' : 'are'} not listed.</p>` : ''}
      <p class="fineprint" id="cm-count">0 picked</p>
      <div class="btnrow"><button class="btn" id="cm-send" type="button">Send by text</button></div>
      <p class="fineprint" id="cm-msg"></p>
    </div>`;

  // ---- create a round robin night (the preview's Step 1 card) ----
  const rrCreateHtml = `
    <div class="rr-create-card">
      <h3>STEP 1 — YOU CREATE THE NIGHT <span class="rr-admin-badge">ADMIN</span></h3>
      <p>Same as creating a night today, plus one new thing: a Publish button. Until you publish, members don't see it. Try switching between Free play and Money Ball — watch the member card change.</p>
      <label>Night name</label><input type="text" id="rrc-name" placeholder="e.g. Monday Money Ball" style="width:100%">
      <div class="field-row">
        <div><label>Date</label><input type="date" id="rrc-date"><p class="fineprint" id="rrc-date-label"></p></div>
        <div><label>Start time</label><input type="time" id="rrc-time" value="18:30"><p class="fineprint">YMCA, 601 26th Ave SE, Moultrie, GA 31768</p></div>
      </div>
      <div class="field-row">
        <div><label>Kind of night</label>
          <div class="level-pick" id="rrc-kind">
            <button type="button" data-kind="money" class="picked">Money Ball</button>
            <button type="button" data-kind="charity">Free play</button>
          </div>
          <p class="fineprint" id="rrc-kind-note">Money Ball is the default $10 a person.</p></div>
        <div id="rrc-fee-wrap"><label>Entry fee per person</label><input type="text" inputmode="decimal" id="rrc-fee" value="10" style="width:80px"><p class="fineprint">Pot grows with every player who joins.</p></div>
      </div>
      <div class="field-row">
        <div><label>Max teams</label><select id="rrc-max">${Array.from({ length: 23 }, (_, i) => i + 2).map((n) => `<option value="${n}"${n === 6 ? ' selected' : ''}>${n} teams · ${Math.ceil(n / 2)} courts</option>`).join('')}</select><p class="fineprint">Signups close on their own when it fills.</p></div>
        <div><label>Signups close</label><select id="rrc-close"><option value="day-3h">Day of play, 3:30 PM</option><option value="fill">When it fills</option></select><p class="fineprint">You can also close them early by hand.</p></div>
      </div>
      <p id="rrc-payout-wrap"><label>Payout</label><select id="rrc-payout">${RR_PAYOUTS.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('')}</select></p>
      <div class="rr-publish-row"><button class="btn rr-publish-btn" id="rrc-publish">Published ✓ — tap to unpublish</button><span class="rr-publish-note" id="rrc-publish-note">Published — members can see this night and join.</span></div>
      <div class="btnrow"><button class="btn" id="rrc-create">Create night</button></div>
      <p class="fineprint" id="rrc-err"></p>
    </div>`;

  // ---- create a bracket night (same card shape as round robin) ----
  // A bracket only decides 1st, 2nd and 3rd, so the 4-place payout split
  // is not offered here — there is no 4th-place team to pay.
  const brCreateHtml = `
    <div class="rr-create-card">
      <h3>STEP 1 — YOU CREATE THE BRACKET NIGHT <span class="rr-admin-badge">ADMIN</span></h3>
      <p>A one-off double-elimination night: teams are seeded by combined doubles rating, the lowest seeds play first, losers drop to a second bracket — lose twice and you're out. The winners-bracket champion meets the losers-bracket champion in the grand final.</p>
      <label>Night name</label><input type="text" id="brc-name" placeholder="e.g. Friday Bracket Night" style="width:100%">
      <div class="field-row">
        <div><label>Date</label><input type="date" id="brc-date"><p class="fineprint" id="brc-date-label"></p></div>
        <div><label>Start time</label><input type="time" id="brc-time" value="18:30"><p class="fineprint">YMCA, 601 26th Ave SE, Moultrie, GA 31768</p></div>
      </div>
      <div class="field-row">
        <div><label>Kind of night</label>
          <div class="level-pick" id="brc-kind">
            <button type="button" data-kind="money" class="picked">Money Ball</button>
            <button type="button" data-kind="charity">Free play</button>
          </div>
          <p class="fineprint" id="brc-kind-note">Money Ball is the default $10 a person.</p></div>
        <div id="brc-fee-wrap"><label>Entry fee per person</label><input type="text" inputmode="decimal" id="brc-fee" value="10" style="width:80px"><p class="fineprint">Pot grows with every player who joins.</p></div>
      </div>
      <div class="field-row">
        <div><label>Teams</label><select id="brc-max">${[4, 6, 8, 10, 12, 16].map((n) => `<option value="${n}"${n === 12 ? ' selected' : ''}>${n} teams</option>`).join('')}</select><p class="fineprint">The bracket only comes in these sizes. Signups close on their own when it fills.</p></div>
        <div><label>Signups close</label><select id="brc-close"><option value="day-3h">Day of play, 3:30 PM</option><option value="fill">When it fills</option></select><p class="fineprint">You can also close them early by hand.</p></div>
      </div>
      <p id="brc-payout-wrap"><label>Payout</label><select id="brc-payout">${RR_PAYOUTS.filter((p) => p.id !== 'top-four-40-30-20-10').map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('')}</select></p>
      <div class="rr-publish-row"><button class="btn rr-publish-btn" id="brc-publish">Published ✓ — tap to unpublish</button><span class="rr-publish-note" id="brc-publish-note">Published — members can see this night and join.</span></div>
      <div class="btnrow"><button class="btn" id="brc-create">Create night</button></div>
      <p class="fineprint" id="brc-err"></p>
    </div>`;

  // ---- delete a league (wipe it clean) ----
  const deleteHtml = `
    <label>League</label><select id="dl-league">${leagues.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select>
    <p class="fineprint">Deletes the league and everything in it — players, game days, matches, standings, and sign-ups. Free MPA members are NOT deleted. This cannot be undone.</p>
    <div class="btnrow"><button class="btn secondary small" id="dl-delete">Delete league</button></div>
    <p class="fineprint" id="dl-msg"></p>`;

  body.innerHTML = logoHtml +
    section('create', 'Create a league', 'Make a new league, or edit an existing one: name, type, skill, format, day, time, and season dates.', createHtml) +
    section('announce', 'Announce this league', 'Writes the email and text announcement for a league, with copy buttons.', announceSectionHtml) +
    section('registration', 'Registration', 'Open or close league sign-ups.', regHtml) +
    section('registrations', 'Registrations', 'People who signed up: confirm them, waive a fee, or add them to a league.', regsHtml) +
    section('players', 'Players', 'The league roster: add, edit, or remove players.', playersHtml) +
    section('members', 'Members', 'Free MPA member directory, with DUPR ratings and an Edit button per member.', membersHtml) +
    section('tools', 'Game day tools', 'Finish a game day, build the schedule, print the court sheet, and move a game day.', toolsHtml) +
    section('penalties', 'Standings penalties', 'Miss penalties and Admin adjustments per player.', penaltiesHtml) +
    section('roundrobin', 'Round Robin', 'Create a one-off round robin night — members join themselves once it is published.', rrCreateHtml) +
    section('bracket', 'Bracket', 'Create a one-off double-elimination bracket night — members join themselves once it is published.', brCreateHtml) +
    section('passcodes', 'Admin passcodes', 'Each admin signs in with their own passcode — set one, change one, or remove one.', passcodesHtml) +
    section('activity', 'Admin activity', 'Who signed in, and when. Refreshes every 30 seconds while you are on this page.', activityHtml) +
    section('delete', 'Delete a league', 'Wipe a league clean: players, game days, matches, and sign-ups go with it. Members stay.', deleteHtml);


  body.querySelectorAll('.admin-section > button.head').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.sec;
      adminSections[k] = !adminSections[k];
      renderAdminBody(leagues, league, me);
    };
  });

  // ---- admin passcodes: set/change and remove ----
  document.querySelectorAll('[data-pc-set]').forEach((b) => {
    b.onclick = async () => {
      const pid = +b.dataset.pcSet;
      const input = document.getElementById(`pc-${pid}`);
      const msg = document.getElementById('pc-msg');
      const passcode = input.value;
      if (passcode.length < 4) { msg.textContent = 'Passcode must be at least 4 characters.'; return; }
      try {
        await post('/api/admin/passcodes', { personId: pid, passcode });
        toast('Passcode saved.');
        renderAdmin();
      } catch (e) { msg.textContent = e.message; }
    };
  });
  document.querySelectorAll('[data-pc-del]').forEach((b) => {
    b.onclick = async () => {
      const pid = +b.dataset.pcDel;
      const msg = document.getElementById('pc-msg');
      if (!confirm('Remove this admin’s passcode? They won’t be able to sign in until a new one is set.')) return;
      try {
        await api(`/api/admin/passcodes/${pid}`, { method: 'DELETE' });
        toast('Passcode removed.');
        renderAdmin();
      } catch (e) { msg.textContent = e.message; }
    };
  });

  // ---- delete a league ----
  const dlBtn = document.getElementById('dl-delete');
  if (dlBtn) {
    dlBtn.onclick = async () => {
      const sel = document.getElementById('dl-league');
      const lid = +sel.value;
      const name = sel.selectedOptions[0]?.textContent || 'this league';
      const msg = document.getElementById('dl-msg');
      if (!confirm(`Delete ${name} and everything in it — players, game days, matches, standings, and sign-ups? Members are NOT deleted. This cannot be undone.`)) return;
      try {
        const out = await api(`/api/admin/leagues/${lid}`, { method: 'DELETE' });
        msg.textContent = `Deleted ${out.deleted.name}.`;
        toast(`Deleted ${out.deleted.name}.`);
        adminLeagueId = null;
        renderAdmin();
      } catch (e) { msg.textContent = e.message; }
    };
  }

  // ---- create a round robin night ----
  const rrcCreateBtn = document.getElementById('rrc-create');
  if (rrcCreateBtn) {
    let rrcKind = 'money';
    let rrcPublished = true;
    const rrcDate = document.getElementById('rrc-date');
    const rrcDateLabel = document.getElementById('rrc-date-label');
    const rrcTime = document.getElementById('rrc-time');
    const rrcClose = document.getElementById('rrc-close');
    const rrcFeeWrap = document.getElementById('rrc-fee-wrap');
    const rrcPayoutWrap = document.getElementById('rrc-payout-wrap');
    const rrcKindNote = document.getElementById('rrc-kind-note');
    const rrcPublishBtn = document.getElementById('rrc-publish');
    const rrcPublishNote = document.getElementById('rrc-publish-note');
    const rrcSyncDate = () => {
      if (rrcDateLabel) {
        rrcDateLabel.textContent = rrcDate.value
          ? asLocalDate(rrcDate.value).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
          : '';
      }
    };
    const rrcSyncClose = () => {
      const opt = rrcClose ? rrcClose.querySelector('option[value="day-3h"]') : null;
      if (opt) {
        const [h, m] = (rrcTime.value || '18:30').split(':').map(Number);
        const close = `${String((h - 3 + 24) % 24).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;
        opt.textContent = `Day of play, ${fmtClock(close)}`;
      }
    };
    const rrcSyncPublish = () => {
      rrcPublishBtn.textContent = rrcPublished ? 'Published ✓ — tap to unpublish' : 'Not published — tap to publish';
      rrcPublishNote.textContent = rrcPublished
        ? 'Published — members can see this night and join.'
        : "Not published — members won't see this night until you publish it.";
      rrcPublishNote.classList.toggle('off', !rrcPublished);
    };
    if (rrcDate) rrcDate.onchange = rrcSyncDate;
    if (rrcTime) rrcTime.onchange = rrcSyncClose;
    rrcSyncClose();
    document.querySelectorAll('#rrc-kind button').forEach((b) => {
      b.onclick = () => {
        rrcKind = b.dataset.kind;
        document.querySelectorAll('#rrc-kind button').forEach((x) => x.classList.toggle('picked', x === b));
        const money = rrcKind === 'money';
        if (rrcFeeWrap) rrcFeeWrap.hidden = !money;
        if (rrcPayoutWrap) rrcPayoutWrap.hidden = !money;
        if (rrcKindNote) rrcKindNote.textContent = money ? 'Money Ball is the default $10 a person.' : 'Free play — no entry fee, no payouts. The Leaders card shows the top 3 teams instead.';
      };
    });
    if (rrcPublishBtn) rrcPublishBtn.onclick = () => { rrcPublished = !rrcPublished; rrcSyncPublish(); };
    rrcCreateBtn.onclick = async () => {
      const err = document.getElementById('rrc-err');
      const name = document.getElementById('rrc-name').value.trim();
      const date = rrcDate.value;
      if (!name) { err.textContent = 'Give the night a name.'; return; }
      if (!date) { err.textContent = 'Pick a date.'; return; }
      const body = {
        name,
        event_date: date,
        kind: rrcKind,
        start_time: rrcTime.value || '18:30',
        max_teams: +document.getElementById('rrc-max').value || 6,
        signup_close: rrcClose.value,
        published: rrcPublished,
      };
      if (rrcKind === 'money') {
        const fee = parseFloat(document.getElementById('rrc-fee').value);
        if (Number.isNaN(fee) || fee < 0) { err.textContent = 'Entry fee must be $0 or more.'; return; }
        body.fee_cents = Math.round(fee * 100);
        body.payout = document.getElementById('rrc-payout').value;
      }
      try {
        const { event } = await post('/api/admin/round-robin/events', body);
        toast('Night created.');
        location.hash = `#/roundrobin/${event.id}`;
      } catch (e) { err.textContent = e.message; }
    };
  }

  // ---- create a bracket night ----
  const brcCreateBtn = document.getElementById('brc-create');
  if (brcCreateBtn) {
    let brcKind = 'money';
    let brcPublished = true;
    const brcDate = document.getElementById('brc-date');
    const brcDateLabel = document.getElementById('brc-date-label');
    const brcTime = document.getElementById('brc-time');
    const brcClose = document.getElementById('brc-close');
    const brcFeeWrap = document.getElementById('brc-fee-wrap');
    const brcPayoutWrap = document.getElementById('brc-payout-wrap');
    const brcKindNote = document.getElementById('brc-kind-note');
    const brcPublishBtn = document.getElementById('brc-publish');
    const brcPublishNote = document.getElementById('brc-publish-note');
    const brcSyncDate = () => {
      if (brcDateLabel) {
        brcDateLabel.textContent = brcDate.value
          ? asLocalDate(brcDate.value).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
          : '';
      }
    };
    const brcSyncClose = () => {
      const opt = brcClose ? brcClose.querySelector('option[value="day-3h"]') : null;
      if (opt) {
        const [h, m] = (brcTime.value || '18:30').split(':').map(Number);
        const close = `${String((h - 3 + 24) % 24).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;
        opt.textContent = `Day of play, ${fmtClock(close)}`;
      }
    };
    const brcSyncPublish = () => {
      brcPublishBtn.textContent = brcPublished ? 'Published ✓ — tap to unpublish' : 'Not published — tap to publish';
      brcPublishNote.textContent = brcPublished
        ? 'Published — members can see this night and join.'
        : "Not published — members won't see this night until you publish it.";
      brcPublishNote.classList.toggle('off', !brcPublished);
    };
    if (brcDate) brcDate.onchange = brcSyncDate;
    if (brcTime) brcTime.onchange = brcSyncClose;
    brcSyncClose();
    document.querySelectorAll('#brc-kind button').forEach((b) => {
      b.onclick = () => {
        brcKind = b.dataset.kind;
        document.querySelectorAll('#brc-kind button').forEach((x) => x.classList.toggle('picked', x === b));
        const money = brcKind === 'money';
        if (brcFeeWrap) brcFeeWrap.hidden = !money;
        if (brcPayoutWrap) brcPayoutWrap.hidden = !money;
        if (brcKindNote) brcKindNote.textContent = money ? 'Money Ball is the default $10 a person.' : 'Free play — no entry fee, no payouts. The Winners card shows the top 3 once the night is finished.';
      };
    });
    if (brcPublishBtn) brcPublishBtn.onclick = () => { brcPublished = !brcPublished; brcSyncPublish(); };
    brcCreateBtn.onclick = async () => {
      const err = document.getElementById('brc-err');
      const name = document.getElementById('brc-name').value.trim();
      const date = brcDate.value;
      if (!name) { err.textContent = 'Give the night a name.'; return; }
      if (!date) { err.textContent = 'Pick a date.'; return; }
      const body = {
        name,
        event_date: date,
        kind: brcKind,
        start_time: brcTime.value || '18:30',
        max_teams: +document.getElementById('brc-max').value || 12,
        signup_close: brcClose.value,
        published: brcPublished,
      };
      if (brcKind === 'money') {
        const fee = parseFloat(document.getElementById('brc-fee').value);
        if (Number.isNaN(fee) || fee < 0) { err.textContent = 'Entry fee must be $0 or more.'; return; }
        body.fee_cents = Math.round(fee * 100);
        body.payout = document.getElementById('brc-payout').value;
      }
      try {
        const { event } = await post('/api/admin/bracket/events', body);
        toast('Night created.');
        location.hash = `#/bracket/${event.id}`;
      } catch (e) { err.textContent = e.message; }
    };
  }

  // ---- create a league ----
  const genBtn = document.getElementById('cl-gen-dates');
  if (genBtn) {
    genBtn.onclick = () => {
      const start = document.getElementById('cl-start').value;
      const day = document.getElementById('cl-day').value;
      if (!start) { toast('Pick the season start date first.'); return; }
      const dayNum = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 }[day];
      const d = new Date(start + 'T12:00:00');
      while (d.getDay() !== dayNum) d.setDate(d.getDate() + 1);
      const dates = [];
      for (let i = 0; i < 8; i++) {
        const c = new Date(d.getTime() + i * 7 * 86400000);
        dates.push(`${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`);
      }
      document.getElementById('cl-dates').innerHTML =
        `<p class="fineprint">The 8 weekly game days — edit any week (a holiday or school vacation) before creating the league.</p>` +
        dates.map((dt, i) => `<label>Week ${i + 1}</label><input type="date" class="cl-date" value="${dt}">`).join('');
    };
  }
  const createBtn = document.getElementById('cl-create');
  if (createBtn) {
    createBtn.onclick = async () => {
      const err = document.getElementById('cl-err');
      try {
        const dateInputs = [...document.querySelectorAll('.cl-date')].map((i) => i.value).filter(Boolean);
        const payload = {
          name: document.getElementById('cl-name').value.trim(),
          type: document.getElementById('cl-type').value,
          skill: document.getElementById('cl-skill').value,
          format: document.getElementById('cl-format').value,
          day: document.getElementById('cl-day').value,
          time: document.getElementById('cl-time').value,
          season: document.getElementById('cl-season').value,
          startDate: document.getElementById('cl-start').value,
          stopDate: document.getElementById('cl-stop').value,
          maxPlayers: +document.getElementById('cl-max').value || 36,
          logoColor: colorForLeague({ type: document.getElementById('cl-type').value, skill: document.getElementById('cl-skill').value }),
        };
        if (dateInputs.length) payload.gameDates = dateInputs;
        const { league: created } = await api('/api/admin/leagues', { method: 'POST', body: JSON.stringify(payload) });
        toast(`League "${created.name}" created with 8 game days.`);
        adminLeagueId = created.id;
        renderAdmin();
      } catch (e) { err.textContent = e.message; }
    };
  }

  // ---- edit an existing league ----
  const elLeague = document.getElementById('el-league');
  if (elLeague && leagues.length) {
    const fillEdit = () => {
      const l = leagues.find((x) => x.id === +elLeague.value);
      if (!l) return;
      document.getElementById('el-name').value = l.name || '';
      const setSel = (id, val) => {
        const sel = document.getElementById(id);
        if (val != null && ![...sel.options].map((o) => o.value).includes(val)) {
          const o = document.createElement('option');
          o.value = val; o.textContent = val; sel.appendChild(o);
        }
        sel.value = val ?? '';
      };
      setSel('el-type', l.type);
      setSel('el-skill', l.skill);
      setSel('el-format', l.format);
      setSel('el-season', l.season || '');
      setSel('el-day', l.day);
      setSel('el-time', String(l.time).slice(0, 5));
      document.getElementById('el-start').value = (l.start_date || '').slice(0, 10);
      document.getElementById('el-stop').value = (l.stop_date || '').slice(0, 10);
    };
    elLeague.onchange = fillEdit;
    fillEdit();
    document.getElementById('el-save').onclick = async () => {
      const err = document.getElementById('el-err');
      try {
        await api(`/api/admin/leagues/${elLeague.value}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: document.getElementById('el-name').value.trim(),
            type: document.getElementById('el-type').value,
            skill: document.getElementById('el-skill').value,
            format: document.getElementById('el-format').value,
            day: document.getElementById('el-day').value,
            time: document.getElementById('el-time').value,
            season: document.getElementById('el-season').value,
            startDate: document.getElementById('el-start').value,
            stopDate: document.getElementById('el-stop').value,
          }),
        });
        toast('League updated.');
        renderAdmin();
      } catch (e) { err.textContent = e.message; }
    };
  }

  // ---- registration switch ----
  const rgBtn = document.getElementById('rg-toggle');
  if (rgBtn) {
    rgBtn.onclick = async () => {
      const l = await api(`/api/leagues/${league.id}`);
      await post(`/api/admin/leagues/${league.id}/settings`, { registrationOpen: !l.registrationOpen });
      toast(l.registrationOpen ? 'Registration closed.' : 'Registration opened.');
      renderAdmin();
    };
  }

  // ---- registrations ----
  body.querySelectorAll('button[data-reg-confirm]').forEach((b) => {
    b.onclick = async () => {
      await post(`/api/admin/registrations/${b.dataset.regConfirm}/status`, { status: 'confirmed' });
      toast('Registration confirmed.');
      renderAdmin();
    };
  });
  body.querySelectorAll('button[data-reg-add]').forEach((b) => {
    b.onclick = async () => {
      try {
        await post(`/api/admin/registrations/${b.dataset.regAdd}/status`, { status: 'added' });
        toast('Added to the league.');
        renderAdmin();
      } catch (e) { toast(e.message); }
    };
  });
  body.querySelectorAll('button[data-reg-waive]').forEach((b) => {
    b.onclick = async () => {
      await post(`/api/admin/registrations/${b.dataset.regWaive}/waive`, { feeWaived: b.dataset.waived !== '1' });
      toast(b.dataset.waived === '1' ? 'Fee waiver removed.' : 'Fee waived.');
      renderAdmin();
    };
  });
  body.querySelectorAll('button[data-reg-del]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Delete this registration?')) return;
      await api(`/api/admin/registrations/${b.dataset.regDel}`, { method: 'DELETE' });
      toast('Registration deleted.');
      renderAdmin();
    };
  });

  // ---- members (edit / remove) ----
  body.querySelectorAll('button[data-mem-edit]').forEach((b) => {
    b.onclick = async () => {
      const slot = document.getElementById(`mem-edit-${b.dataset.memEdit}`);
      const { members } = await api('/api/admin/members');
      const m = members.find((x) => x.id === +b.dataset.memEdit);
      if (!m) return;
      const v = (x) => (x == null ? '' : esc(x));
      slot.innerHTML = `<div class="card">
        <p class="fineprint">Member since ${fmtDateShort(m.joined_at)} · Last updated ${m.updated_at ? fmtDateShort(m.updated_at) : '—'}</p>
        <div class="field-row">
          <div><label>Email</label><input type="text" id="me-email" value="${v(m.email)}"></div>
          <div><label>Phone</label><input type="text" id="me-phone" value="${esc(fmtPhone(m.phone))}"></div>
        </div>
        <div class="field-row">
          <div><label>DUPR ID</label><input type="text" id="me-dupr" value="${v(m.dupr_id)}"><p class="fineprint">6 letters and numbers, like 7D6WR0.</p></div>
          <div><label>DUPR doubles rating</label><input type="number" step="0.001" id="me-rating" value="${m.dupr_rating ?? ''}"></div>
        </div>
        <label>DUPR profile link</label><input type="text" id="me-profile" value="${v(m.dupr_profile_url)}" placeholder="https://…">
        <div class="field-row">
          <div><label>Resides</label><input type="text" id="me-resides" value="${v(m.resides)}"></div>
          <div><label>Age</label><input type="number" id="me-age" value="${m.age ?? ''}"></div>
        </div>
        <div class="field-row">
          <div><label>Country</label><input type="text" id="me-country" value="${v(m.country)}"></div>
          <div><label>Profile photo URL</label><input type="text" id="me-photo" value="${v(m.photo_url)}"></div>
        </div>
        <div class="field-row">
          <div><label>Nickname</label><input type="text" id="me-nick" value="${v(m.nickname)}"></div>
          <div><label>Gender</label><select id="me-gender"><option value="">—</option><option ${m.gender === 'Female' ? 'selected' : ''}>Female</option><option ${m.gender === 'Male' ? 'selected' : ''}>Male</option></select></div>
        </div>
        <div class="field-row">
          <div><label>Height</label><input type="text" id="me-height" value="${v(m.height)}"></div>
          <div><label>Handed</label><select id="me-handed"><option value="">—</option><option ${m.handed === 'Right' ? 'selected' : ''}>Right</option><option ${m.handed === 'Left' ? 'selected' : ''}>Left</option></select></div>
        </div>
        <div class="field-row">
          <div><label>Singles rating</label><input type="number" step="0.001" id="me-singles" value="${m.singles_rating ?? ''}"></div>
          <div><label>Skinny Singles rating</label><input type="number" step="0.001" id="me-skinny" value="${m.skinny_rating ?? ''}"></div>
        </div>
        <label><input type="checkbox" id="me-admin" ${m.is_admin ? 'checked' : ''}> Make admin</label>
        <p class="fineprint">Admins show their name in red with an ADMIN badge on the Members list.</p>
        <p class="fineprint" style="margin-top:12px"><strong>Rating history</strong></p>
        <div id="me-history"><p class="fineprint">Loading rating history…</p></div>
        <div class="btnrow"><button class="btn small" id="me-save">Save member</button></div>
        <p class="fineprint" id="me-err"></p></div>`;
      // Phone formats as (xxx) xxx-xxxx while typing; the save strips it
      // back to digits, so the stored value stays digits-only.
      const mePhone = document.getElementById('me-phone');
      if (mePhone) mePhone.addEventListener('input', () => { mePhone.value = fmtPhone(mePhone.value); });
    // Rating history timeline, with a filter by rating type. The baseline
    // ('system') reads as "recorded as X" — it is the go-live starting
    // point, not a change. Past changes before tracking started are not
    // recoverable, so the timeline starts there.
    let meHist = [];
    let meHistFilter = 'all';
    const fmtHistR = (r) => (r == null ? '—' : Number(r).toFixed(3));
    function renderMeHist() {
      const el = document.getElementById('me-history');
      if (!el) return;
      const rows = meHist.filter((h) => meHistFilter === 'all' || h.rating_type === meHistFilter);
      const typeName = { doubles: 'Doubles', singles: 'Singles', skinny: 'Skinny Singles' };
      const whoName = { member: 'Member', admin: 'Admin', system: 'Tracking started' };
      const btn = (f, label) => `<button class="btn secondary small" data-hf="${f}" ${meHistFilter === f ? 'disabled' : ''}>${label}</button>`;
      el.innerHTML = `<div class="btnrow">${btn('all', 'All')}${btn('doubles', 'Doubles')}${btn('singles', 'Singles')}${btn('skinny', 'Skinny')}</div>` +
        (rows.length ? rows.map((h) => `<p class="fineprint">${fmtDateShort(h.created_at)} · ${typeName[h.rating_type] || h.rating_type} · ${h.changed_by === 'system' ? `recorded as ${fmtHistR(h.new_rating)}` : `${fmtHistR(h.old_rating)} → ${fmtHistR(h.new_rating)}`} · ${whoName[h.changed_by] || h.changed_by}</p>`).join('') : '<p class="fineprint">No rating changes yet.</p>');
      el.querySelectorAll('button[data-hf]').forEach((b) => { b.onclick = () => { meHistFilter = b.dataset.hf; renderMeHist(); }; });
    }
    api(`/api/admin/members/${m.id}/rating-history`).then((r) => { meHist = r.history || []; renderMeHist(); }).catch(() => {
      const el = document.getElementById('me-history');
      if (el) el.innerHTML = '<p class="fineprint">Rating history is not available.</p>';
    });
      document.getElementById('me-save').onclick = async () => {
        const err = document.getElementById('me-err');
        const duprId = normDuprId(document.getElementById('me-dupr').value);
        const idErr = duprIdError(duprId, false);
        if (idErr) { err.textContent = idErr; return; }
        try {
          await api(`/api/admin/members/${m.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              email: document.getElementById('me-email').value.trim() || null,
              phone: document.getElementById('me-phone').value.replace(/\D/g, '') || null,
              duprId: duprId || null,
              duprRating: document.getElementById('me-rating').value ? +document.getElementById('me-rating').value : null,
              duprProfileUrl: document.getElementById('me-profile').value.trim() || null,
              resides: document.getElementById('me-resides').value.trim() || null,
              age: document.getElementById('me-age').value ? +document.getElementById('me-age').value : null,
              country: document.getElementById('me-country').value.trim() || null,
              photoUrl: document.getElementById('me-photo').value.trim() || null,
              nickname: document.getElementById('me-nick').value.trim() || null,
              gender: document.getElementById('me-gender').value || null,
              height: document.getElementById('me-height').value.trim() || null,
              handed: document.getElementById('me-handed').value || null,
              singlesRating: document.getElementById('me-singles').value ? +document.getElementById('me-singles').value : null,
              skinnyRating: document.getElementById('me-skinny').value ? +document.getElementById('me-skinny').value : null,
              isAdmin: document.getElementById('me-admin').checked,
            }),
          });
          toast('Member saved.');
          renderAdmin();
        } catch (e) { err.textContent = e.message; }
      };
    };
  });
  body.querySelectorAll('button[data-mem-del]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Remove this free member? (Their league roster spots are not affected.)')) return;
      await api(`/api/admin/members/${b.dataset.memDel}`, { method: 'DELETE' });
      toast('Member removed.');
      renderAdmin();
    };
  });

  // ---- players: autocomplete, add, waive, edit DUPR, remove ----
  const apName = document.getElementById('ap-name');
  let pickedPersonId = null;
  if (apName) {
    apName.addEventListener('input', async () => {
      const q = apName.value.trim();
      const slot = document.getElementById('ap-suggest');
      pickedPersonId = null;
      if (q.length < 2) { slot.innerHTML = ''; return; }
      const { results } = await api(`/api/admin/people/search?q=${encodeURIComponent(q)}&leagueId=${league.id}`).catch(() => ({ results: [] }));
      if (!results.length) { slot.innerHTML = ''; return; }
      slot.innerHTML = `<div class="suggest">` + results.map((r) => `
        <div class="suggest-row ${r.inLeague ? 'disabled' : ''}" data-pid="${r.person_id || ''}" data-name="${esc(r.name)}"
             data-dupr="${esc(r.dupr_id || '')}" data-rating="${r.dupr_rating ?? ''}" data-profile="${esc(r.dupr_profile_url || '')}">
          <span class="nm">${esc(r.name)}</span>
          <span class="sub">${r.inLeague ? 'Already in the league' : r.source === 'registration' ? `Signed up for ${esc(r.registrationLeague || '')}` : r.leagues && r.leagues.length ? `Also in: ${r.leagues.map(esc).join(', ')}` : 'Free member'}</span>
          <span class="sub">${r.dupr_id ? `DUPR ${esc(r.dupr_id)} · ${r.dupr_rating ?? ''}` : (r.self_rated ? `Self-rated ${r.dupr_rating ?? ''}` : '')}</span>
        </div>`).join('') + `</div>`;
      slot.querySelectorAll('.suggest-row:not(.disabled)').forEach((row) => {
        row.onclick = () => {
          pickedPersonId = row.dataset.pid ? +row.dataset.pid : null;
          apName.value = row.dataset.name;
          document.getElementById('ap-dupr').value = row.dataset.dupr;
          document.getElementById('ap-rating').value = row.dataset.rating;
          document.getElementById('ap-profile').value = row.dataset.profile;
          slot.innerHTML = '';
        };
      });
    });
  }
  const addBtn = document.getElementById('ap-add');
  if (addBtn) {
    addBtn.onclick = async () => {
      const err = document.getElementById('ap-err');
      if (!pickedPersonId) {
        const idErr = duprIdError(document.getElementById('ap-dupr').value, false);
        if (idErr) { err.textContent = idErr; return; }
      }
      try {
        const payload = pickedPersonId
          ? { personId: pickedPersonId }
          : {
              name: document.getElementById('ap-name').value.trim(),
              duprId: normDuprId(document.getElementById('ap-dupr').value) || null,
              duprRating: document.getElementById('ap-rating').value ? +document.getElementById('ap-rating').value : null,
              duprProfileUrl: document.getElementById('ap-profile').value.trim() || null,
            };
        await api(`/api/admin/leagues/${league.id}/players`, { method: 'POST', body: JSON.stringify(payload) });
        toast('Player added.');
        renderAdmin();
      } catch (e) { err.textContent = e.message; }
    };
  }
  body.querySelectorAll('button[data-p-waive]').forEach((b) => {
    b.onclick = async () => {
      await api(`/api/admin/leagues/${league.id}/players/${b.dataset.pWaive}`, {
        method: 'PATCH', body: JSON.stringify({ feeWaived: b.dataset.waived !== '1' }),
      });
      toast(b.dataset.waived === '1' ? 'Fee waiver removed.' : 'Fee waived.');
      renderAdmin();
    };
  });
  body.querySelectorAll('button[data-p-edit]').forEach((b) => {
    b.onclick = async () => {
      const slot = document.getElementById(`p-edit-${b.dataset.pEdit}`);
      const { roster } = await api(`/api/leagues/${league.id}/roster`);
      const p = roster.find((x) => x.person_id === +b.dataset.pEdit);
      if (!p) return;
      const v = (x) => (x == null ? '' : esc(x));
      slot.innerHTML = `<div class="card">
        <div class="field-row">
          <div><label>DUPR ID</label><input type="text" id="pe-dupr" value="${v(p.dupr_id)}"><p class="fineprint">6 letters and numbers, like 7D6WR0.</p></div>
          <div><label>DUPR doubles rating</label><input type="number" step="0.001" id="pe-rating" value="${p.dupr_rating ?? ''}"></div>
        </div>
        <label>DUPR profile link</label><input type="text" id="pe-profile" value="${v(p.dupr_profile_url)}" placeholder="https://…">
        <div class="btnrow"><button class="btn small" id="pe-save">Save DUPR</button></div>
        <p class="fineprint" id="pe-err"></p></div>`;
      document.getElementById('pe-save').onclick = async () => {
        const err = document.getElementById('pe-err');
        const duprId = normDuprId(document.getElementById('pe-dupr').value);
        const idErr = duprIdError(duprId, false);
        if (idErr) { err.textContent = idErr; return; }
        try {
          await api(`/api/admin/leagues/${league.id}/players/${p.person_id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              duprId: duprId || null,
              duprRating: document.getElementById('pe-rating').value ? +document.getElementById('pe-rating').value : null,
              duprProfileUrl: document.getElementById('pe-profile').value.trim() || null,
            }),
          });
          toast('DUPR saved.');
          renderAdmin();
        } catch (e) { err.textContent = e.message; }
      };
    };
  });
  body.querySelectorAll('button[data-p-name]').forEach((b) => {
    b.onclick = async () => {
      const slot = document.getElementById(`p-edit-${b.dataset.pName}`);
      const { roster } = await api(`/api/leagues/${league.id}/roster`);
      const p = roster.find((x) => x.person_id === +b.dataset.pName);
      if (!p) return;
      slot.innerHTML = `<div class="card">
        <label>Player name</label><input type="text" id="pn-name" value="${esc(p.name)}">
        <p class="fineprint">Renames this player everywhere at once — roster, member directory, and registrations.</p>
        <div class="btnrow"><button class="btn small" id="pn-save">Save name</button></div>
        <p class="fineprint" id="pn-err"></p></div>`;
      document.getElementById('pn-save').onclick = async () => {
        const err = document.getElementById('pn-err');
        const name = document.getElementById('pn-name').value.trim();
        if (!name) { err.textContent = 'Name cannot be empty.'; return; }
        const dup = roster.find((x) => x.person_id !== p.person_id && x.name.toLowerCase() === name.toLowerCase());
        if (dup && !confirm(`A player named ${name} is already on this roster. Rename anyway?`)) return;
        try {
          await api(`/api/admin/people/${p.person_id}/name`, { method: 'PATCH', body: JSON.stringify({ name }) });
          toast('Name updated.');
          renderAdmin();
        } catch (e) { err.textContent = e.message; }
      };
    };
  });
  body.querySelectorAll('button[data-remove]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Remove this player from this league only?')) return;
      await api(`/api/admin/leagues/${league.id}/players/${b.dataset.remove}`, { method: 'DELETE' });
      toast('Player removed from this league.');
      renderAdmin();
    };
  });

  // ---- standings penalties ----
  body.querySelectorAll('button[data-adj-save]').forEach((b) => {
    b.onclick = async () => {
      const val = +document.getElementById(`adj-${b.dataset.adjSave}`).value || 0;
      await api(`/api/admin/leagues/${league.id}/players/${b.dataset.adjSave}`, {
        method: 'PATCH', body: JSON.stringify({ adminPenalty: val }),
      });
      toast('Adjustment saved.');
      renderAdmin();
    };
  });

  // ---- game day tools ----
  const buildBtn = document.getElementById('gt-build');
  if (buildBtn) {
    const sid = () => document.getElementById('gt-session').value;
    buildBtn.onclick = async () => {
      const msg = document.getElementById('gt-msg');
      try {
        const r = await post(`/api/admin/leagues/${league.id}/sessions/${sid()}/build`, {});
        msg.textContent = `Schedule built: ${r.matches.filter((m) => m.kind === 'match').length} games for ${r.playerCount} players.` + (r.warnings.length ? ' ' + r.warnings.join(' ') : '');
      } catch (e) { msg.textContent = e.message; }
    };
    document.getElementById('gt-finish').onclick = async () => {
      const msg = document.getElementById('gt-msg');
      try {
        await post(`/api/admin/leagues/${league.id}/sessions/${sid()}/finish`, {});
        msg.textContent = '✓ This game day is finished.';
        renderAdmin();
      } catch (e) {
        if (e.message.includes('unscored')) {
          if (confirm(`${e.message}\n\nFinish anyway?`)) {
            try {
              await post(`/api/admin/leagues/${league.id}/sessions/${sid()}/finish`, { force: true });
              msg.textContent = '✓ This game day is finished.';
              renderAdmin();
            } catch (e2) { msg.textContent = e2.message; }
          }
        } else { msg.textContent = e.message; }
      }
    };
    document.getElementById('gt-view').onclick = () => {
      location.hash = `#/league/${league.id}/game/${sid()}?view=organizer`;
    };
    document.getElementById('gt-sheet').onclick = () => {
      location.hash = `#/league/${league.id}/game/${sid()}/sheet`;
    };
    document.getElementById('gt-alldays').onclick = async () => {
      const l = await api(`/api/leagues/${league.id}`);
      openAllDays(l.league, l.sessions);
    };
    const moveBtn = document.getElementById('gt-move');
    if (moveBtn) {
      moveBtn.onclick = async () => {
        const msg = document.getElementById('gt-move-msg');
        const sid = +document.getElementById('gt-move-session').value;
        const newDate = document.getElementById('gt-move-date').value;
        if (!newDate) { msg.textContent = 'Pick a new date first.'; return; }
        try {
          const r = await api(`/api/admin/leagues/${league.id}/sessions/${sid}/date`, { method: 'PATCH', body: JSON.stringify({ gameDate: newDate }) });
          const moved = r.sessions.find((s) => s.id === sid);
          const later = r.sessions.filter((s) => s.session_number > moved.session_number);
          const summary = `Week ${moved.session_number} moved to ${fmtDateShort(moved.date)}.` +
            (later.length ? ` Weeks ${later[0].session_number}–${later[later.length - 1].session_number} shifted to ${later.map((s) => fmtDateShort(s.date)).join(', ')}.` : '');
          toast('Game day moved.');
          await renderAdmin();
          const m2 = document.getElementById('gt-move-msg');
          if (m2) m2.textContent = summary;
        } catch (e) { msg.textContent = e.message; }
      };
    }
  }

  // ---- announce ----
  const anGen = document.getElementById('an-gen');
  if (anGen) {
    document.querySelectorAll('input[name="an-mode"]').forEach((r) => {
      r.onchange = () => {
        const one = document.querySelector('input[name="an-mode"]:checked').value === 'one';
        const sel = document.getElementById('an-league');
        if (sel) sel.disabled = !one;
      };
    });
    anGen.onclick = async () => {
      const out = document.getElementById('an-out');
      const mode = document.querySelector('input[name="an-mode"]:checked').value;
      try {
        if (mode === 'all') {
          const data = await api('/api/admin/announce-all');
          out.innerHTML = announceAllHtml(data);
        } else if (mode === 'join') {
          const data = await api('/api/admin/announce-all');
          out.innerHTML = announceJoinHtml(data);
        } else {
          const lid = +document.getElementById('an-league').value;
          const data = await api(`/api/admin/leagues/${lid}/announce`);
          out.innerHTML = announceHtml(data);
        }
        wireAnnounceCopy();
      } catch (e) { out.innerHTML = `<div class="banner warn">${esc(e.message)}</div>`; }
    };
  }

  // ---- custom message: pick recipients, send by text ----
  const cmSend = document.getElementById('cm-send');
  if (cmSend) {
    const cmPicks = () => Array.from(document.querySelectorAll('.cm-pick'));
    const cmUpdate = () => {
      const n = cmPicks().filter((c) => c.checked).length;
      const el = document.getElementById('cm-count');
      if (el) el.textContent = `${n} picked`;
    };
    cmPicks().forEach((c) => { c.onchange = cmUpdate; });
    document.getElementById('cm-just-me').onclick = () => {
      const mine = cmPicks().find((c) => c.dataset.me === '1');
      cmPicks().forEach((c) => { c.checked = c === mine; });
      const msg = document.getElementById('cm-msg');
      if (!mine && msg) msg.textContent = 'Could not tell which member you are — pick your name from the list.';
      cmUpdate();
    };
    document.getElementById('cm-everyone').onclick = () => { cmPicks().forEach((c) => { c.checked = true; }); cmUpdate(); };
    document.getElementById('cm-clear').onclick = () => { cmPicks().forEach((c) => { c.checked = false; }); cmUpdate(); };
    cmSend.onclick = () => {
      const text = document.getElementById('cm-text').value.trim();
      const phones = cmPicks().filter((c) => c.checked).map((c) => c.value).join(', ');
      const msg = document.getElementById('cm-msg');
      if (!text) { if (msg) msg.textContent = 'Type the message first.'; return; }
      if (!phones) { if (msg) msg.textContent = 'Pick at least one person.'; return; }
      if (msg) msg.textContent = '';
      location.href = `sms:${phones.replace(/ /g, '')}?&body=${encodeURIComponent(text)}`;
    };
  }

  // ---- admin activity: refresh every 30 seconds while on the Admin page ----
  // Only the activity list re-renders, so typing in a passcode box (or
  // anything else on the page) is never disturbed. render() clears this
  // interval on route change, as it does for the game-day refresh. If the
  // section is closed the list is not in the DOM and the cycle is skipped.
  clearInterval(refreshTimer);
  refreshTimer = setInterval(async () => {
    const list = document.getElementById('admin-activity-list');
    if (!list) return;
    try {
      const { activity: fresh } = await api('/api/admin/activity');
      list.innerHTML = activityRowsHtml(fresh);
    } catch { /* poll quietly fails; the next cycle retries */ }
  }, 30000);
}

// ---------- announce drafts (client-side; nothing is sent) ----------
function announceHtml({ league, sessions, members, memberCount, withEmail, withPhone }) {
  const dayLines = sessions.map((s) => {
    const d = asLocalDate(s.date);
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  });
  const subject = `New MPA league: ${league.name} — join now`;
  const emailText = [
    `A new MPA league is open: ${league.name}`,
    ``,
    `${league.type} · Skill ${league.skill} · ${league.format}`,
    `${league.day}s at ${fmtClock(league.time)} · Season ${league.season || 'not set'} · ${fmtDateShort(league.start_date)} – ${fmtDateShort(league.stop_date)}`,
    `At the YMCA, 601 26th Ave SE, Moultrie, GA 31768`,
    ``,
    `Game days:`,
    ...dayLines.map((d) => `• ${d} at ${fmtClock(league.time)}`),
    ``,
    `Joining costs $20 (YMCA member) / $50 (non-member), paid on ReClique: ${RECLIQUE_URL}`,
    ``,
    `Three steps to join:`,
    `1. Get a free DUPR account: ${DUPR_SIGNUP_URL}`,
    `2. Become a free MPA member`,
    `3. Join the league — sign up here: ${APP_URL}/#/join/${league.id}`,
    ``,
    `Tip: if the DUPR link won't open from your email or text, copy it and paste it into Safari.`,
    ``,
    `Moultrie Pickleball Association`,
  ].join('\n');
  const emailBodyHtml = [
    `<p><strong>A new MPA league is open: ${esc(league.name)}</strong></p>`,
    `<p>${esc(league.type)} · Skill ${esc(league.skill)} · ${esc(league.format)}<br>${esc(league.day)}s at ${esc(fmtClock(league.time))} · Season ${esc(league.season || 'not set')} · ${fmtDateShort(league.start_date)} – ${fmtDateShort(league.stop_date)}<br>At the YMCA, 601 26th Ave SE, Moultrie, GA 31768</p>`,
    `<p><strong>Game days:</strong><br>${dayLines.map((d) => `• ${esc(d)} at ${esc(fmtClock(league.time))}`).join('<br>')}</p>`,
    `<p>Joining costs $20 (YMCA member) / $50 (non-member), paid on ReClique: <a href="${RECLIQUE_URL}">${RECLIQUE_URL}</a></p>`,
    `<p><strong>Three steps to join:</strong><br>1. Get a free DUPR account: <a href="${DUPR_SIGNUP_URL}">${DUPR_SIGNUP_URL}</a><br>2. Become a free MPA member<br>3. Join the league — sign up here: <a href="${APP_URL}/#/join/${league.id}">${APP_URL}/#/join/${league.id}</a></p>`,
    `<p><em>Tip: if the DUPR link won't open from your email or text, copy it and paste it into Safari.</em></p>`,
    `<p>Moultrie Pickleball Association</p>`,
  ].join('');
  const textDraft = [
    `New MPA league: ${league.name} — ${league.format}, ${league.day}s ${fmtClock(league.time)} at the YMCA in Moultrie.`,
    `Starts ${fmtDateShort(league.start_date)}, 8 weeks. $20 member / $50 non-member.`,
    `Sign up (about 2 minutes): ${APP_URL}/#/join/${league.id}`,
    `Need a DUPR account first (free): ${DUPR_SIGNUP_URL}`,
    `Tip: if the DUPR link won't open from your email or text, copy it and paste it into Safari.`,
    `— Moultrie Pickleball Association`,
  ].join('\n');
  const emails = members.filter((m) => m.email).map((m) => m.email).join(', ');
  const phones = members.filter((m) => m.phone).map((m) => m.phone).join(', ');
  return `
    <div class="card"><h3>Email draft</h3>
      <label>Subject</label><input type="text" id="an-subject" value="${esc(subject)}" readonly>
      <div class="btnrow"><button class="btn secondary small" id="an-copy-subject">Copy subject</button>
      <button class="btn small" id="an-copy-email">Copy email</button>${emails ? `<a class="btn small" href="mailto:${esc(emails.replace(/ /g, ''))}?subject=${encodeURIComponent(subject)}&amp;body=${encodeURIComponent(emailText)}">Send by email</a>` : ''}</div>
      <div class="draft" id="an-email-body">${emailBodyHtml}</div>
      <p class="fineprint">Copy keeps the links clickable when pasted into email.</p>
    </div>
    <div class="card"><h3>Text message draft</h3>
      <pre class="draft-text" id="an-text-body">${esc(textDraft)}</pre>
      <div class="btnrow"><button class="btn small" id="an-copy-text">Copy text</button>${phones ? `<a class="btn small" href="sms:${esc(phones.replace(/ /g, ''))}?&amp;body=${encodeURIComponent(textDraft)}">Send by text</a>` : ''}</div>
    </div>
    <div class="card"><h3>Who it goes to — MPA members (${memberCount})</h3>
      <p class="muted small">${withEmail} with an email on file · ${withPhone} with a phone number</p>
      <div class="btnrow">
        <button class="btn secondary small" id="an-copy-emails" ${emails ? '' : 'disabled'}>Copy email addresses</button>
        <button class="btn secondary small" id="an-copy-phones" ${phones ? '' : 'disabled'}>Copy phone numbers</button>
      </div>
      <p class="fineprint">Nothing is sent by the app — copy the drafts and send them from your own email or phone.</p>
    </div>
    <div id="an-data" data-emails="${esc(emails)}" data-phones="${esc(phones)}" data-email-text="${esc(emailText)}" hidden></div>`;
}

// ---------- all-leagues announcement (client-side; nothing is sent) ----------
// Lists every league with registration open, so each person picks the one
// for their skill and taps through to that league's join page. Same card
// structure and ids as announceHtml, so the copy buttons wire up the same.
function announceAllHtml({ leagues, members, memberCount, withEmail, withPhone }) {
  const open = leagues.filter((l) => l.registration_open !== false);
  const subject = `New MPA leagues are open — pick yours and join`;
  const leagueLines = open.map((l) =>
    `• ${l.name} — ${l.type} · Skill ${l.skill} · ${l.format} · ${l.day}s ${fmtClock(l.time)} · ${fmtDateShort(l.start_date)} – ${fmtDateShort(l.stop_date)} · ${l.player_count ?? ''} player(s) — Join: ${APP_URL}/#/join/${l.id}`
  );
  const emailText = [
    `New MPA leagues are open — pick the one for your skill and join.`,
    ``,
    ...(open.length ? leagueLines : [`No leagues are open for registration right now — check back soon.`]),
    ``,
    `Joining costs $20 (YMCA member) / $50 (non-member), paid on ReClique: ${RECLIQUE_URL}`,
    ``,
    `Three steps to join:`,
    `1. Get a free DUPR account: ${DUPR_SIGNUP_URL}`,
    `2. Become a free MPA member`,
    `3. Pick your league and join: ${APP_URL}/`,
    ``,
    `Tip: if the DUPR link won't open from your email or text, copy it and paste it into Safari.`,
    ``,
    `Moultrie Pickleball Association`,
  ].join('\n');
  const emailBodyHtml = [
    `<p><strong>New MPA leagues are open — pick the one for your skill and join.</strong></p>`,
    ...(open.length ? [`<p>${open.map((l) => `• <strong>${esc(l.name)}</strong> — ${esc(l.type)} · Skill ${esc(l.skill)} · ${esc(l.format)}<br>${esc(l.day)}s ${esc(fmtClock(l.time))} · ${fmtDateShort(l.start_date)} – ${fmtDateShort(l.stop_date)} · ${l.player_count ?? ''} player(s)<br>Join: <a href="${APP_URL}/#/join/${l.id}">${APP_URL}/#/join/${l.id}</a>`).join('<br><br>')}</p>`] : [`<p>No leagues are open for registration right now — check back soon.</p>`]),
    `<p>Joining costs $20 (YMCA member) / $50 (non-member), paid on ReClique: <a href="${RECLIQUE_URL}">${RECLIQUE_URL}</a></p>`,
    `<p><strong>Three steps to join:</strong><br>1. Get a free DUPR account: <a href="${DUPR_SIGNUP_URL}">${DUPR_SIGNUP_URL}</a><br>2. Become a free MPA member<br>3. Pick your league and join: <a href="${APP_URL}/">${APP_URL}/</a></p>`,
    `<p><em>Tip: if the DUPR link won't open from your email or text, copy it and paste it into Safari.</em></p>`,
    `<p>Moultrie Pickleball Association</p>`,
  ].join('');
  const textDraft = [
    `New MPA leagues are open — pick the one for your skill and join.`,
    ...open.map((l) => `• ${l.name} (${l.skill}, ${l.day}s ${fmtClock(l.time)})`),
    `See them all and join: ${APP_URL}/`,
    `$20 member / $50 non-member. Need a DUPR account first (free): ${DUPR_SIGNUP_URL}`,
    `Tip: if the DUPR link won't open from your email or text, copy it and paste it into Safari.`,
    `— Moultrie Pickleball Association`,
  ].join('\n');
  const emails = members.filter((m) => m.email).map((m) => m.email).join(', ');
  const phones = members.filter((m) => m.phone).map((m) => m.phone).join(', ');
  return `
    <div class="card"><h3>Email draft — all open leagues (${open.length})</h3>
      <label>Subject</label><input type="text" id="an-subject" value="${esc(subject)}" readonly>
      <div class="btnrow"><button class="btn secondary small" id="an-copy-subject">Copy subject</button>
      <button class="btn small" id="an-copy-email">Copy email</button>${emails ? `<a class="btn small" href="mailto:${esc(emails.replace(/ /g, ''))}?subject=${encodeURIComponent(subject)}&amp;body=${encodeURIComponent(emailText)}">Send by email</a>` : ''}</div>
      <div class="draft" id="an-email-body">${emailBodyHtml}</div>
      <p class="fineprint">Copy keeps the links clickable when pasted into email.</p>
    </div>
    <div class="card"><h3>Text message draft</h3>
      <pre class="draft-text" id="an-text-body">${esc(textDraft)}</pre>
      <div class="btnrow"><button class="btn small" id="an-copy-text">Copy text</button>${phones ? `<a class="btn small" href="sms:${esc(phones.replace(/ /g, ''))}?&amp;body=${encodeURIComponent(textDraft)}">Send by text</a>` : ''}</div>
    </div>
    <div class="card"><h3>Who it goes to — MPA members (${memberCount})</h3>
      <p class="muted small">${withEmail} with an email on file · ${withPhone} with a phone number</p>
      <div class="btnrow">
        <button class="btn secondary small" id="an-copy-emails" ${emails ? '' : 'disabled'}>Copy email addresses</button>
        <button class="btn secondary small" id="an-copy-phones" ${phones ? '' : 'disabled'}>Copy phone numbers</button>
      </div>
      <p class="fineprint">Nothing is sent by the app — copy the drafts and send them from your own email or phone.</p>
    </div>
    <div id="an-data" data-emails="${esc(emails)}" data-phones="${esc(phones)}" data-email-text="${esc(emailText)}" hidden></div>`;
}

// ---------- Join MPA invitation (client-side; nothing is sent) ----------
// A general invite to join the association — no league attached. Same card
// structure and ids as the other drafts, so the copy and send buttons wire
// up the same, plus an "Invite someone new" card that texts the invite to
// a phone number typed in by the organizer.
function announceJoinHtml({ members, memberCount, withEmail, withPhone }) {
  const subject = `Join the Moultrie Pickleball Association — free to join`;
  const emailText = [
    `Join the Moultrie Pickleball Association — membership is free.`,
    ``,
    `MPA ladder leagues are in the works at the YMCA in Moultrie, GA — Coed Doubles, Women's Doubles, and more, for every skill level. Join now and pick the league for your skill when play starts.`,
    ``,
    `Two steps to join:`,
    `1. Get a free DUPR account: ${DUPR_SIGNUP_URL}`,
    `2. Become a free MPA member`,
    ``,
    `If you can't open DUPR, you can rate yourself instead when you join.`,
    ``,
    `Playing in an MPA league won't change your DUPR rating — league scores stay here and are never sent to DUPR.`,
    ``,
    `Join here: ${APP_URL}/`,
    ``,

    `Tip: if the DUPR link won't open from your email or text, copy it and paste it into Safari.`,
    ``,
    `Moultrie Pickleball Association`,
  ].join('\n');
  const emailBodyHtml = [
    `<p><strong>Join the Moultrie Pickleball Association — membership is free.</strong></p>`,
    `<p>MPA ladder leagues are in the works at the YMCA in Moultrie, GA — Coed Doubles, Women's Doubles, and more, for every skill level. Join now and pick the league for your skill when play starts.</p>`,
    `<p><strong>Two steps to join:</strong><br>1. Get a free DUPR account: <a href="${DUPR_SIGNUP_URL}">${DUPR_SIGNUP_URL}</a><br>2. Become a free MPA member</p>`,
    `<p>If you can't open DUPR, you can rate yourself instead when you join.</p>`,
    `<p>Playing in an MPA league won't change your DUPR rating — league scores stay here and are never sent to DUPR.</p>`,
    `<p>Join here: <a href="${APP_URL}/">${APP_URL}/</a></p>`,
    `<p><em>Tip: if the DUPR link won't open from your email or text, copy it and paste it into Safari.</em></p>`,
    `<p>Moultrie Pickleball Association</p>`,
  ].join('');
  const textDraft = [
    `Join the Moultrie Pickleball Association — it's free.`,
    `1. Get a free DUPR account: ${DUPR_SIGNUP_URL}`,
    `2. Become a free MPA member`,
    `If you can't open DUPR, you can rate yourself instead when you join.`,
    `League play won't change your DUPR rating — scores stay here, never sent to DUPR.`,
    `Join here: ${APP_URL}/`,
    `Tip: if the DUPR link won't open from your email or text, copy it and paste it into Safari.`,
    `— Moultrie Pickleball Association`,
  ].join('\n');
  const emails = members.filter((m) => m.email).map((m) => m.email).join(', ');
  const phones = members.filter((m) => m.phone).map((m) => m.phone).join(', ');
  return `
    <div class="card"><h3>Email draft — Join MPA</h3>
      <label>Subject</label><input type="text" id="an-subject" value="${esc(subject)}" readonly>
      <div class="btnrow"><button class="btn secondary small" id="an-copy-subject">Copy subject</button>
      <button class="btn small" id="an-copy-email">Copy email</button>${emails ? `<a class="btn small" href="mailto:${esc(emails.replace(/ /g, ''))}?subject=${encodeURIComponent(subject)}&amp;body=${encodeURIComponent(emailText)}">Send by email</a>` : ''}</div>
      <div class="draft" id="an-email-body">${emailBodyHtml}</div>
      <p class="fineprint">Copy keeps the links clickable when pasted into email.</p>
    </div>
    <div class="card"><h3>Text message draft</h3>
      <pre class="draft-text" id="an-text-body">${esc(textDraft)}</pre>
      <div class="btnrow"><button class="btn small" id="an-copy-text">Copy text</button>${phones ? `<a class="btn small" href="sms:${esc(phones.replace(/ /g, ''))}?&amp;body=${encodeURIComponent(textDraft)}">Send by text</a>` : ''}</div>
    </div>
    <div class="card"><h3>Invite someone new</h3>
      <p class="muted small">Text the Join MPA invite to someone who isn't a member yet — type their number and send.</p>
      <label>Phone number</label><input type="tel" id="an-invite-phone" placeholder="e.g. 229-555-0123">
      <div class="btnrow"><button class="btn" id="an-invite-send">Text the invite</button></div>
      <p class="fineprint" id="an-invite-msg"></p>
    </div>
    <div class="card"><h3>Who it goes to — MPA members (${memberCount})</h3>
      <p class="muted small">${withEmail} with an email on file · ${withPhone} with a phone number</p>
      <div class="btnrow">
        <button class="btn secondary small" id="an-copy-emails" ${emails ? '' : 'disabled'}>Copy email addresses</button>
        <button class="btn secondary small" id="an-copy-phones" ${phones ? '' : 'disabled'}>Copy phone numbers</button>
      </div>
      <p class="fineprint">Nothing is sent by the app — copy the drafts and send them from your own email or phone.</p>
    </div>
    <div id="an-data" data-emails="${esc(emails)}" data-phones="${esc(phones)}" data-email-text="${esc(emailText)}" hidden></div>`;
}

async function copyRich(html, text) {
  try {
    const item = new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    });
    await navigator.clipboard.write([item]);
    toast('Copied — links stay clickable when pasted.');
  } catch {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied as plain text (this browser refused the rich copy).');
    } catch { toast('Copy failed — select the draft text manually.'); }
  }
}

function wireAnnounceCopy(data) {
  const d = document.getElementById('an-data');
  document.getElementById('an-copy-subject').onclick = async () => {
    try { await navigator.clipboard.writeText(document.getElementById('an-subject').value); toast('Subject copied.'); }
    catch { toast('Copy failed — select the subject manually.'); }
  };
  document.getElementById('an-copy-email').onclick = () => {
    copyRich(document.getElementById('an-email-body').innerHTML, d.dataset.emailText);
  };
  document.getElementById('an-copy-text').onclick = async () => {
    try { await navigator.clipboard.writeText(document.getElementById('an-text-body').textContent); toast('Text copied.'); }
    catch { toast('Copy failed — select the text manually.'); }
  };
  document.getElementById('an-copy-emails').onclick = async () => {
    try { await navigator.clipboard.writeText(d.dataset.emails); toast('Email addresses copied.'); }
    catch { toast('Copy failed.'); }
  };
  document.getElementById('an-copy-phones').onclick = async () => {
    try { await navigator.clipboard.writeText(d.dataset.phones); toast('Phone numbers copied.'); }
    catch { toast('Copy failed.'); }
  };
  // Join MPA invite: text the invite to a number typed in by the organizer.
  const inviteBtn = document.getElementById('an-invite-send');
  if (inviteBtn) {
    inviteBtn.onclick = () => {
      const num = document.getElementById('an-invite-phone').value.replace(/[^+0-9]/g, '');
      const msg = document.getElementById('an-invite-msg');
      if (!num) { if (msg) msg.textContent = 'Enter a phone number first.'; return; }
      location.href = `sms:${num}?&body=${encodeURIComponent(document.getElementById('an-text-body').textContent)}`;
    };
  }
}

// ---------- members page ----------
async function renderMembersPage() {
  const id = getIdentity();
  app.innerHTML = `<p><a href="#/">&larr; Back</a></p>
    <h1>Members</h1>
    <p class="muted">Free MPA members. Email and phone are never shown here — only the admin sees them.</p>
    <div id="newSeasonSlot"></div>
    <div class="btnrow"><button class="btn" id="memJoinBtn">Become a Member</button></div>
    <div id="memFormSlot"></div>
    <div id="memDir"></div>`;
  // A new season reaches existing members as join cards.
  if (id) {
    try {
      const [{ leagues }, mine, pending] = await Promise.all([
        api('/api/leagues'),
        myLeagues(id.personId),
        myPendingRegistrations(id.personId),
      ]);
      const mineIds = new Set(mine.map((l) => l.id));
      const pendingIds = new Set(pending.map((r) => r.league_id));
      const open = leagues.filter((l) => !mineIds.has(l.id) && !pendingIds.has(l.id));
      const slot = document.getElementById('newSeasonSlot');
      if (slot && (open.length || pending.length)) {
        slot.innerHTML = pending.map((r) => `<div class="card"><strong>You're signed up for ${esc(r.name)}</strong><br><span class="muted small">The organizer will add you to the roster.</span></div>`).join('') + (open.length ? `<h2>A new season is open</h2>` + open.map((l) => `<div class="card new-season">
          <strong>${esc(l.name)}</strong><br>
          <span class="muted small">${esc(l.type)} · ${esc(l.skill)} · ${esc(l.format)} · ${esc(l.day)}s ${esc(fmtClock(l.time))} · ${esc(l.season || 'Season not set')}</span>
          <div class="btnrow"><a class="btn green small" href="#/join/${l.id}">Join this league</a></div>
        </div>`).join('') : '');
      }
    } catch { /* join cards are a bonus — the directory still loads */ }
  }
  document.getElementById('memJoinBtn').onclick = () => {
    renderMemberForm(document.getElementById('memFormSlot'), () => renderMembersPage());
  };
  renderMembersDirectory(document.getElementById('memDir'));
}

// ---------- join the league ----------
async function renderJoinPage(leagueId) {
  app.innerHTML = `<p><a href="#/">&larr; Back</a></p><h1>Join the League</h1><p class="muted">Loading…</p>`;
  try {
    const { leagues } = await api('/api/leagues');
    if (!leagues.length) {
      app.innerHTML = `<div class="card"><p>No leagues are open yet.</p></div>`;
      return;
    }
    let league = leagueId ? leagues.find((l) => l.id === leagueId) : leagues[0];
    if (!league) league = leagues[0];
    const detail = await api(`/api/leagues/${league.id}`);
    const id = getIdentity();
    let prefill = null;
    if (id) {
      try { prefill = await api(`/api/people/${id.personId}/profile`); } catch { /* no prefill */ }
    }
    const memberBanner = prefill && prefill.member
      ? `<div class="banner finished">You're already an MPA member — your name and DUPR are filled in below.</div>`
      : '';
    const step1Done = prefill && prefill.person && prefill.person.dupr_id;
    // A returning self-rated player has a rating but no DUPR ID — open
    // Step 1 in self-rate mode, with their level picked when it matches.
    const selfPrefill = prefill && prefill.person && !prefill.person.dupr_id && prefill.person.dupr_rating != null;
    const selfLevel0 = (selfPrefill && [2.5, 3.0, 3.5, 4.0, 4.5, 5.0].includes(Number(prefill.person.dupr_rating)))
      ? Number(prefill.person.dupr_rating) : null;
    app.innerHTML = `
      <p><a href="#/">&larr; Back</a></p>
      <h1>Join the League</h1>
      ${memberBanner}
      ${!detail.registrationOpen ? `<div class="card reg-closed"><strong>🔒 Registration Closed</strong><br>
        <span class="muted small">Sign-ups for ${esc(league.name)} are closed right now.</span></div>` : `
      <label>League</label>
      <select id="j-league">${leagues.map((l) => `<option value="${l.id}" ${l.id === league.id ? 'selected' : ''}>${esc(l.name)} — ${esc(l.day)}s ${esc(fmtClock(l.time))}</option>`).join('')}</select>
      <div id="j-step1" class="card" style="${step1Done ? 'display:none' : ''}">
        <h3>Step 1 — Your rating</h3>
        <p class="muted small">A DUPR account is the standard way to join MPA. <a href="${DUPR_SIGNUP_URL}" target="_blank" rel="noopener">Create one free</a>. Don't have one yet? Rate yourself — you can add your DUPR account later.</p>
        <label class="radio"><input type="radio" name="j-mode" value="dupr" ${selfPrefill ? '' : 'checked'}> I have a DUPR account</label><br>
        <label class="radio"><input type="radio" name="j-mode" value="self" ${selfPrefill ? 'checked' : ''}> I don't have one yet — I'll rate myself</label>
        <div id="j-dupr-fields" style="${selfPrefill ? 'display:none' : ''}">
          <label>DUPR ID</label><input type="text" id="j-dupr" value="${step1Done ? esc(prefill.person.dupr_id) : ''}">
          <p class="fineprint">6 letters and numbers, like 7D6WR0.</p>
          <label>DUPR doubles rating</label><input type="number" step="0.001" id="j-rating" value="${step1Done && prefill.person.dupr_rating != null ? prefill.person.dupr_rating : ''}" placeholder="e.g. 3.643">
        </div>
        <div id="j-self-fields" style="${selfPrefill ? '' : 'display:none'}">
          <label>Your level</label>
          <div class="level-pick" id="j-levels">${[2.5, 3.0, 3.5, 4.0, 4.5, 5.0].map((lv) => `<button type="button" data-level="${lv}" class="${selfLevel0 === lv ? 'picked' : ''}">${lv.toFixed(1)}</button>`).join('')}</div>
          <p class="fineprint">Pick the level you play at. The league's skill range still applies — a level outside it can't join.</p>
        </div>
        <div class="btnrow"><button class="btn" id="j-to2">Continue</button></div>
        <p class="fineprint" id="j-err1"></p>
      </div>
      <div id="j-step2" class="card" style="${step1Done ? '' : 'display:none'}">
        <h3>Step 2 — Your details</h3>
        <p class="fineprint" id="j-member-note"></p>
        <label>Full name</label><input type="text" id="j-name" value="${prefill ? esc(prefill.person.name) : ''}">
        <div class="field-row">
          <div><label>Email</label><input type="text" id="j-email" value="${prefill && prefill.member ? esc(prefill.member.email || '') : ''}"></div>
          <div><label>Phone</label><input type="text" id="j-phone" value="${prefill && prefill.member ? esc(prefill.member.phone || '') : ''}"></div>
        </div>
        <label>YMCA membership</label>
        <label class="radio"><input type="radio" name="j-mtype" value="member" checked> YMCA member</label><br>
        <label class="radio"><input type="radio" name="j-mtype" value="non-member"> Non-member</label>
        <p class="fineprint">Nothing is charged here.</p>
        <div class="btnrow"><button class="btn green" id="j-submit">Sign up</button></div>
        <p class="fineprint" id="j-err2"></p>
      </div>
      <div id="j-done"></div>`}
      <p class="muted small">A new season reaches existing members as a join card — signing up again never repeats the DUPR and member steps.</p>`;
    if (!detail.registrationOpen) return;
    document.getElementById('j-league').onchange = (e) => { location.hash = `#/join/${e.target.value}`; };
    // Self-rating fallback: the level picker (2.5–5.0) and the DUPR / self-rate switch.
    let selfLevel = selfLevel0;
    document.querySelectorAll('input[name="j-mode"]').forEach((r) => {
      r.addEventListener('change', () => {
        const self = document.querySelector('input[name="j-mode"]:checked').value === 'self';
        document.getElementById('j-dupr-fields').style.display = self ? 'none' : '';
        document.getElementById('j-self-fields').style.display = self ? '' : 'none';
        document.getElementById('j-err1').textContent = '';
      });
    });
    document.querySelectorAll('#j-levels button').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('#j-levels button').forEach((x) => x.classList.remove('picked'));
        b.classList.add('picked');
        selfLevel = +b.dataset.level;
      });
    });
    document.getElementById('j-to2')?.addEventListener('click', async () => {
      const err = document.getElementById('j-err1');
      const mode = document.querySelector('input[name="j-mode"]:checked')?.value || 'dupr';
      if (mode === 'self') {
        if (selfLevel == null) { err.textContent = 'Pick your level.'; return; }
        const skillErr = skillRangeError(league.skill, selfLevel, 'rating');
        if (skillErr) { err.textContent = skillErr; return; }
        const note = document.getElementById('j-member-note');
        if (note) note.textContent = `You're joining with a self-rating of ${selfLevel.toFixed(1)} — add your DUPR account later and we'll swap it in.`;
        document.getElementById('j-step1').style.display = 'none';
        document.getElementById('j-step2').style.display = '';
        return;
      }
      const dupr = normDuprId(document.getElementById('j-dupr').value);
      const ratingVal = document.getElementById('j-rating').value;
      if (!dupr) { err.textContent = 'Enter your DUPR ID.'; return; }
      const idErr = duprIdError(dupr);
      if (idErr) { err.textContent = idErr; return; }
      document.getElementById('j-dupr').value = dupr;
      if (!ratingVal) { err.textContent = 'Enter your DUPR doubles rating.'; return; }
      const rating = +ratingVal;
      // The league's skill band is the qualifier — checked here and again
      // on the server when the sign-up is submitted.
      const skillErr = skillRangeError(league.skill, rating);
      if (skillErr) { err.textContent = skillErr; return; }
      // Member check: a DUPR ID already on file means they're an MPA
      // member, so welcome them back and fill in their name. A miss just
      // means they're new — they become a free member when they sign up.
      let found = null;
      try { ({ member: found } = await api(`/api/members/by-dupr/${encodeURIComponent(dupr)}`)); } catch { /* not a member yet */ }
      const note = document.getElementById('j-member-note');
      if (found) {
        document.getElementById('j-name').value = found.name;
        if (note) note.textContent = `Welcome back, ${found.name} — you're already an MPA member. Your name is filled in below.`;
      } else if (note) {
        note.textContent = `No member with that DUPR ID yet — you'll become a free MPA member when you sign up below.`;
      }
      document.getElementById('j-step1').style.display = 'none';
      document.getElementById('j-step2').style.display = '';
    });
    document.getElementById('j-submit').onclick = async () => {
      const err = document.getElementById('j-err2');
      const lid = +document.getElementById('j-league').value;
      const mode = document.querySelector('input[name="j-mode"]:checked')?.value || 'dupr';
      const body = {
        name: document.getElementById('j-name').value.trim(),
        duprId: mode === 'self' ? null : normDuprId(document.getElementById('j-dupr').value),
        duprRating: mode === 'self' ? null : (document.getElementById('j-rating').value ? +document.getElementById('j-rating').value : null),
        selfRated: mode === 'self',
        selfRating: mode === 'self' ? selfLevel : null,
        email: document.getElementById('j-email').value.trim(),
        phone: document.getElementById('j-phone').value.trim(),
        membershipType: document.querySelector('input[name="j-mtype"]:checked').value,
      };
      try {
        const { registration } = await api(`/api/leagues/${lid}/registrations`, { method: 'POST', body: JSON.stringify(body) });
        myLeaguesCache = null; // new signup is a pending registration — refetch on next view
        setCoverStep('dupr');
        setCoverStep('member');
        setCoverStep('joined');
        document.getElementById('j-done').innerHTML = `
          <div class="banner finished">✓ You're signed up for ${esc(leagues.find((l) => l.id === lid).name)}.
          The organizer will add you to the league.</div>
          <div class="btnrow"><a class="btn secondary" href="#/league/${lid}">View the league</a></div>`;
        document.getElementById('j-step2').style.display = 'none';
      } catch (e) { err.textContent = e.message; }
    };
  } catch (e) {
    app.innerHTML = `<div class="banner warn">${esc(e.message)}</div>`;
  }
}

// ---------- My Leagues hub ----------
let hubTab = 'registered';
let hubFilter = 'active';
async function renderMyLeagues() {
  const id = getIdentity();
  app.innerHTML = `<h1>My Leagues</h1><p class="muted">Loading…</p>`;
  try {
    const me = await api('/api/admin/me').catch(() => ({ admin: false }));
    const { leagues } = await api('/api/leagues');
    const mine = id ? await myLeagues(id.personId).catch(() => []) : [];
    const mineIds = new Set(mine.map((l) => l.id));
    const favIds = new Set(favs());
    const byId = new Map(leagues.map((l) => [l.id, l]));
    const bySeason = (list) => {
      const groups = {};
      for (const l of list) {
        const key = l.season || 'Season not set';
        (groups[key] = groups[key] || []).push(l);
      }
      return groups;
    };
    // Active/Past needs session status: fetch details per league (cheap at this scale).
    const details = {};
    for (const l of leagues) {
      try { details[l.id] = await api(`/api/leagues/${l.id}`); } catch { /* ignore */ }
    }
    const pastIds = new Set(leagues.filter((l) => {
      const d = details[l.id];
      return d && d.sessions.length && d.sessions.every((s) => s.status === 'completed');
    }).map((l) => l.id));
    const inFilter = (l) => (hubFilter === 'active' ? !pastIds.has(l.id) : pastIds.has(l.id));

    let list = [];
    if (hubTab === 'registered') list = mine.map((m) => byId.get(m.id)).filter(Boolean);
    if (hubTab === 'managing') list = me.admin ? leagues : [];
    if (hubTab === 'favorites') list = leagues.filter((l) => favIds.has(l.id));
    list = list.filter(inFilter);
    const groups = bySeason(list);

    app.innerHTML = `
      <h1>My Leagues</h1>
      <div class="tabs">
        <button data-tab="registered" class="${hubTab === 'registered' ? 'active' : ''}">Registered</button>
        <button data-tab="managing" class="${hubTab === 'managing' ? 'active' : ''}">Managing</button>
        <button data-tab="favorites" class="${hubTab === 'favorites' ? 'active' : ''}">Favorites</button>
      </div>
      <div class="btnrow">
        <button class="btn secondary small ${hubFilter === 'active' ? '' : ''}" id="hubActive">Active</button>
        <button class="btn secondary small" id="hubPast">Past</button>
        <span class="muted small" style="align-self:center">${hubFilter === 'active' ? 'Showing active leagues' : 'Showing past leagues'}</span>
      </div>
      <div class="searchrow"><input type="text" id="hubSearch" placeholder="Search for league…" autocomplete="off"></div>
      <div id="hubList">
        ${Object.entries(groups).map(([season, ls]) => `<h2>${esc(season)}</h2>${ls.map(leagueCardHtml).join('')}`).join('') || '<p class="muted">No leagues here yet.</p>'}
      </div>
      <div class="card"><h3>Get the app on your phone or computer</h3>
        <p class="muted small">There is no App Store or Google Play listing for the MPA app — it is a web page. Add it to your home screen instead:</p>
        <p class="small"><strong>iPhone:</strong> open the app in Safari → Share → "Add to Home Screen" → Add.<br>
        <strong>Android:</strong> open the app in Chrome → menu → "Add to Home screen".<br>
        <strong>Desktop:</strong> open the app in your browser and bookmark it, or use your browser's "Install" / "Add to Home Screen" option.</p>
      </div>`;
    app.querySelectorAll('.tabs button').forEach((b) => {
      b.onclick = () => { hubTab = b.dataset.tab; renderMyLeagues(); };
    });
    document.getElementById('hubActive').onclick = () => { hubFilter = 'active'; renderMyLeagues(); };
    document.getElementById('hubPast').onclick = () => { hubFilter = 'past'; renderMyLeagues(); };
    document.getElementById('hubSearch').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      document.getElementById('hubList').querySelectorAll('.league-card').forEach((card) => {
        card.style.display = card.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    });
    bindFavButtons();
  } catch (e) {
    app.innerHTML = `<div class="banner warn">${esc(e.message)}</div>`;
  }
}

// ---------- My Dashboard ----------
async function renderDashboard() {
  const id = getIdentity();
  if (!id) {
    app.innerHTML = `<div class="card"><h2>My Dashboard</h2><p class="muted">Pick your name first — tap your name on a game day RSVP list, or <a href="#/">find your league</a>.</p></div>`;
    return;
  }
  app.innerHTML = `<h1>My Dashboard</h1><p class="muted">Loading…</p>`;
  try {
    const { person, leagues } = await api(`/api/people/${id.personId}/dashboard`);
    app.innerHTML = `<h1>My Dashboard</h1><p class="muted">${esc(person.name)}</p>` +
      (leagues.map(({ league, standings, games }) => `
        <div class="card">
          <h2>${esc(league.name)}</h2>
          ${standings ? `<p>Rank <strong>${standings.rank}</strong> · E/P Diff% − Penalty <strong>${Number(standings.score).toFixed(3)}%</strong>
            (${Number(standings.epDiff).toFixed(3)}% − ${Number(standings.penalty).toFixed(1)})<br>
            Record <strong>${standings.wins}W–${standings.losses}L</strong> · Points ${standings.earned}/${standings.possible} · Game days ${standings.played} · Missed ${standings.missed}</p>`
          : '<p class="muted">No standings yet — the first night has not been played.</p>'}
          <h3>Games played (${games.length})</h3>
          ${games.map((g) => `<div class="person-row"><span class="who"><span class="nm">Session ${g.sessionNumber} · ${fmtDateShort(g.date)} · Court ${g.court} · Round ${g.round}</span>
            <div class="fp">with ${esc(g.partner || '—')} vs ${g.opponents.map(esc).join(' & ')} — ${g.myScore}–${g.theirScore} (to ${g.target})</div></span>
            <strong>${g.result}</strong></div>`).join('') || '<p class="muted">No games scored yet.</p>'}
        </div>`).join('') || '<p class="muted">You are not in a league yet.</p>');
  } catch (e) {
    app.innerHTML = `<div class="banner warn">${esc(e.message)}</div>`;
  }
}

// ---------- My Profile ----------
async function renderProfile() {
  const id = getIdentity();
  if (!id) {
    app.innerHTML = `<div class="card"><h2>My Profile</h2><p class="muted">Pick your name first — tap your name on a game day RSVP list, or <a href="#/">find your league</a>.</p></div>`;
    return;
  }
  app.innerHTML = `<h1>My Profile</h1><p class="muted">Loading…</p>`;
  try {
    const { person, member } = await api(`/api/people/${id.personId}/profile`);
    const v = (x) => (x == null ? '' : esc(x));
    app.innerHTML = `
      <h1>My Profile</h1>
      <p class="muted">Your free MPA member record. Your name cannot be changed here — the organizer fixes it from Admin.</p>
      ${!member ? '<div class="banner">You do not have a free member record yet. Saving below creates one.</div>' : ''}
      ${member && member.self_rated ? '<div class="banner">You joined with a self-rating — add your DUPR ID and rating below to swap it in.</div>' : ''}
      <div class="card">
        <label>Full name</label><input type="text" value="${v(person.name)}" disabled>
        <div class="field-row">
          <div><label>Email</label><input type="text" id="pf-email" value="${member ? v(member.email) : ''}"></div>
          <div><label>Phone</label><input type="text" id="pf-phone" value="${member ? v(member.phone) : ''}"></div>
        </div>
        <div class="field-row">
          <div><label>DUPR ID</label><input type="text" id="pf-dupr" value="${v(person.dupr_id)}"><p class="fineprint">6 letters and numbers, like 7D6WR0.</p></div>
          <div><label>DUPR doubles rating</label><input type="number" step="0.001" id="pf-rating" value="${person.dupr_rating ?? ''}"></div>
        </div>
        <label>DUPR profile link</label><input type="text" id="pf-profile" value="${v(person.dupr_profile_url)}" placeholder="https://…">
        <div class="field-row">
          <div><label>Resides</label><input type="text" id="pf-resides" value="${v(person.resides)}"></div>
          <div><label>Age</label><input type="number" id="pf-age" value="${person.age ?? ''}"></div>
        </div>
        <div class="field-row">
          <div><label>Country</label><input type="text" id="pf-country" value="${v(person.country)}"></div>
          <div><label>Profile photo URL</label><input type="text" id="pf-photo" value="${v(person.photo_url)}" placeholder="https://…"></div>
        </div>
        <div class="field-row">
          <div><label>Nickname</label><input type="text" id="pf-nick" value="${member ? v(member.nickname) : ''}"></div>
          <div><label>Gender</label><select id="pf-gender"><option value="">—</option><option ${member && member.gender === 'Female' ? 'selected' : ''}>Female</option><option ${member && member.gender === 'Male' ? 'selected' : ''}>Male</option></select></div>
        </div>
        <div class="field-row">
          <div><label>Height</label><input type="text" id="pf-height" value="${member ? v(member.height) : ''}"></div>
          <div><label>Handed</label><select id="pf-handed"><option value="">—</option><option ${member && member.handed === 'Right' ? 'selected' : ''}>Right</option><option ${member && member.handed === 'Left' ? 'selected' : ''}>Left</option></select></div>
        </div>
        <div class="field-row">
          <div><label>Singles rating</label><input type="number" step="0.001" id="pf-singles" value="${member && member.singles_rating != null ? member.singles_rating : ''}"></div>
          <div><label>Skinny Singles rating</label><input type="number" step="0.001" id="pf-skinny" value="${member && member.skinny_rating != null ? member.skinny_rating : ''}"></div>
        </div>
        <div class="btnrow"><button class="btn" id="pf-save">Save profile</button></div>
        <p class="fineprint" id="pf-err"></p>
      </div>`;
    document.getElementById('pf-save').onclick = async () => {
      const err = document.getElementById('pf-err');
      const duprId = normDuprId(document.getElementById('pf-dupr').value);
      const idErr = duprIdError(duprId, false);
      if (idErr) { err.textContent = idErr; return; }
      try {
        await api(`/api/people/${id.personId}/profile`, {
          method: 'PATCH',
          body: JSON.stringify({
            email: document.getElementById('pf-email').value.trim() || null,
            phone: document.getElementById('pf-phone').value.trim() || null,
            duprId: duprId || null,
            duprRating: document.getElementById('pf-rating').value ? +document.getElementById('pf-rating').value : null,
            duprProfileUrl: document.getElementById('pf-profile').value.trim() || null,
            resides: document.getElementById('pf-resides').value.trim() || null,
            age: document.getElementById('pf-age').value ? +document.getElementById('pf-age').value : null,
            country: document.getElementById('pf-country').value.trim() || null,
            photoUrl: document.getElementById('pf-photo').value.trim() || null,
            nickname: document.getElementById('pf-nick').value.trim() || null,
            gender: document.getElementById('pf-gender').value || null,
            height: document.getElementById('pf-height').value.trim() || null,
            handed: document.getElementById('pf-handed').value || null,
            singlesRating: document.getElementById('pf-singles').value ? +document.getElementById('pf-singles').value : null,
            skinnyRating: document.getElementById('pf-skinny').value ? +document.getElementById('pf-skinny').value : null,
          }),
        });
        setCoverStep('dupr');
        setCoverStep('member');
        toast('Profile saved.');
        renderProfile();
      } catch (e) { err.textContent = e.message; }
    };
  } catch (e) {
    app.innerHTML = `<div class="banner warn">${esc(e.message)}</div>`;
  }
}

// ---------- printable Court Sheet ----------
async function renderCourtSheet(leagueId, sessionId) {
  app.innerHTML = `<p class="muted">Loading court sheet…</p>`;
  try {
    const id = getIdentity();
    const viewer = id ? `?viewer=${id.personId}` : '';
    const data = await api(`/api/leagues/${leagueId}/sessions/${sessionId}${viewer}`);
    if (!data.isAdmin) {
      app.innerHTML = `<div class="card"><h2>Court Sheet</h2>
        <p class="muted">Court sheets are printed from Admin (Admin → Game day tools → Court Sheet) or from the Organizer view.</p>
        <p><a href="#/league/${leagueId}/game/${sessionId}">← Back to game day</a></p></div>`;
      return;
    }
    const { league, session, groups, matches } = data;
    const names = new Map();
    [...data.playing, ...data.notPlaying].forEach((p) => names.set(p.person_id, p.name));
    const gamesByCourt = {};
    for (const m of matches || []) {
      if (m.kind !== 'match') continue;
      (gamesByCourt[m.court] = gamesByCourt[m.court] || []).push(m);
    }
    app.innerHTML = `
      <div class="sheet">
        <div class="btnrow"><button class="btn" id="printBtn">🖨 Print</button>
        <a class="btn secondary" href="#/admin">Back to Admin</a></div>
        <h1>${esc(league.name)} — Court Sheet</h1>
        <p><strong>Session ${session.session_number}</strong> · ${fmtDateTime(session.starts_at)}<br>
        ${esc(league.location)} · Games to 15 (60 points per player per session)</p>
        ${(groups || []).map((g) => `
          <div class="court-sheet">
            <h2>Court ${g.court}</h2>
            ${g.players.map((p) => `<div class="check-row"><span class="box">☐</span> ${esc(p.name)}</div>`).join('')}
            <h3>Matches</h3>
            ${(gamesByCourt[g.court] || []).map((m) => {
              const t1 = `${esc(names.get(m.team1_p1) || '—')} & ${esc(names.get(m.team1_p2) || '—')}`;
              const t2 = `${esc(names.get(m.team2_p1) || '—')} & ${esc(names.get(m.team2_p2) || '—')}`;
              return `<div class="sheet-match">Round ${m.round}: ${t1} vs ${t2} &nbsp; ____ – ____</div>`;
            }).join('') || '<p class="muted">No matches yet.</p>'}
          </div>`).join('') || '<p class="muted">No schedule yet — build it from Admin → Game day tools.</p>'}
      </div>`;
    document.getElementById('printBtn').onclick = () => window.print();
  } catch (e) {
    app.innerHTML = `<div class="banner warn">${esc(e.message)}</div>`;
  }
}

renderIdentity();
render();

// ---------- Round Robin ----------
// One-off nights, separate from leagues. Fixed doubles teams stay together
// all night; every team plays every other team once, one game to 15.
// Free charity nights have no fee and no payouts; money-ball nights have a
// per-person entry fee and a payout structure (House Rule default: 3rd place
// gets its entry fee back, 1st and 2nd split the rest 60/40).
// Scoring mirrors the league flow: one match at a time, SCORE button,
// dedicated score screen, finished matches below.
let rrScoreMatchId = null;
// Partner picked in the join box (survives the 30s refresh), and the first
// solo picked for Admin pairing. Both carry the event id they belong to,
// so a stale pick from another night is ignored.
let rrJoinPartner = null; // { personId, name, eventId }
let rrPairFirst = null; // { id, eventId, name }

// Member search shared by the join pickers: members first, then any other
// person record, merged by person id — the same merge as Find your league.
async function rrSearchPeople(q) {
  const [{ people }, { members }] = await Promise.all([
    api(`/api/people/search?q=${encodeURIComponent(q)}`).catch(() => ({ people: [] })),
    api(`/api/members/search?q=${encodeURIComponent(q)}`).catch(() => ({ members: [] })),
  ]);
  const byId = new Map();
  for (const p of people || []) {
    byId.set(p.id, { personId: p.id, name: p.name, dupr_id: p.dupr_id, dupr_rating: p.dupr_rating, self_rated: p.self_rated });
  }
  for (const m of members || []) {
    if (m.person_id && !byId.has(m.person_id)) {
      byId.set(m.person_id, { personId: m.person_id, name: m.name, dupr_id: m.dupr_id, dupr_rating: m.dupr_rating, self_rated: m.self_rated });
    }
  }
  return [...byId.values()];
}

function rrPersonRowHtml(p) {
  return `<div class="person-row tappable" data-pid="${p.personId}" data-name="${esc(p.name)}">
    <span class="who"><span class="nm">${esc(p.name)}</span>
    <div class="fp">${p.dupr_id ? `DUPR ${esc(p.dupr_id)} · ${p.dupr_rating ?? ''}` : (p.self_rated ? `Self-rated ${p.dupr_rating ?? ''}` : 'No DUPR on file')}</div></span></div>`;
}

const RR_PAYOUTS = [
  { id: 'house', label: 'House rule — 3rd gets entry back, 1st & 2nd split the rest 60/40' },
  { id: 'winner-take-all', label: 'Winner-take-all — 100%' },
  { id: 'top-two-60-40', label: 'Top-two — 60/40' },
  { id: 'top-two-66-33', label: 'Top-two — 66.7/33.3' },
  { id: 'top-three-50-30-20', label: 'Top-three — 50/30/20' },
  { id: 'top-four-40-30-20-10', label: 'Top-four — 40/30/20/10' },
];

function rrMoney(cents) {
  const d = cents / 100;
  return '$' + (Number.isInteger(d) ? String(d) : d.toFixed(2));
}
function rrKindLabel(kind) {
  return kind === 'money' ? 'Money Ball' : 'Free Charity';
}
function rrStatusLabel(s) {
  return s === 'setup' ? 'Setting up' : s === 'playing' ? 'Playing' : 'Finished';
}
// The YYYY-MM-DD part of an event date. The API returns the stored DATE as
// an ISO string at midnight UTC — slice the date part off instead of
// building a Date from it, or the night renders a day early in EST.
function rrEventDatePart(ev) {
  return String(ev.event_date || '').slice(0, 10);
}
// "Mon Nov 23 · 6:30 PM" — weekday + date from the stored date part, time
// from the night's own start time (default 6:30 PM).
function rrWhen(ev) {
  const d = asLocalDate(rrEventDatePart(ev));
  const wd = d.toLocaleDateString('en-US', { weekday: 'short' });
  const md = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${wd} ${md} · ${fmtClock(String(ev.start_time || '18:30').slice(0, 5))}`;
}
// "Sign-ups close Mon 3:30 PM" for day-3h nights (start time minus 3
// hours, same day); "Sign-ups close when full" for fill nights.
function rrCloseLabel(ev) {
  if (ev.signup_close === 'fill') return 'Sign-ups close when full';
  const [h, m] = String(ev.start_time || '18:30').slice(0, 5).split(':').map(Number);
  const close = `${String((h - 3 + 24) % 24).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;
  const wd = asLocalDate(rrEventDatePart(ev)).toLocaleDateString('en-US', { weekday: 'short' });
  return `Sign-ups close ${wd} ${fmtClock(close)}`;
}
function rrPayoutLabel(id) {
  const p = RR_PAYOUTS.find((x) => x.id === id);
  return p ? p.label : id;
}

async function renderRRList() {
  // Nights list only — creating a night moved to the Admin page
  // ("Round Robin" section), where the create card lives.
  app.innerHTML = `<h1>Round Robin</h1>
    <p class="muted">One-off nights, separate from leagues. Fixed teams stay together all night — every team plays every other team once.</p>
    <div id="rrList"><p class="muted">Loading…</p></div>`;
  const me = await api('/api/admin/me').catch(() => ({ admin: false }));
  const { events } = await api('/api/round-robin/events').catch(() => ({ events: [] }));
  document.getElementById('rrList').innerHTML = events.length
    ? events
        .map((ev) => {
          const joinOpen = ev.published && ev.status === 'setup' && !me.admin;
          return `<div class="card">
        <strong>${esc(ev.name)}</strong><br>
        <span class="muted">${esc(rrWhen(ev))} · ${rrKindLabel(ev.kind)} · ${rrStatusLabel(ev.status)}${ev.published && ev.status === 'setup' ? ' · Sign-ups open' : ''} · ${ev.team_count} team(s)${ev.solo_count ? ` · ${ev.solo_count} waiting to be paired` : ''}${ev.kind === 'money' ? ` · ${rrMoney(ev.fee_cents)} per person` : ''}${ev.match_count ? ` · ${ev.scored_count}/${ev.match_count} scored` : ''}</span>
        <div class="btnrow"><a class="btn ${joinOpen ? 'green ' : ''}small" href="#/roundrobin/${ev.id}">${joinOpen ? 'Join' : 'Open'}</a></div>
      </div>`;
        })
        .join('')
    : `<div class="card"><p>No round robin nights yet.</p></div>`;
}

async function renderRREvent(id) {
  // Same refresh discipline as game days: clear the old timer before
  // setting a new one. No refresh while a score screen is open, so typed
  // scores are never wiped mid-entry.
  clearInterval(refreshTimer);
  const data = await api(`/api/round-robin/events/${id}`).catch((e) => ({ error: e.message }));
  if (data.error || !data.event) {
    app.innerHTML = `<div class="banner warn">${esc(data.error || 'Not found.')}</div>`;
    return;
  }
  const { event, teams, solos = [], matches, standings, payouts, byes, isAdmin } = data;
  const byId = new Map(teams.map((t) => [t.id, t]));
  // Matches arrive ordered by round, court — number them 1..N for the night
  // so every card has its own number (the old "Match ${round}" label put
  // "Match 1" on every Round 1 card).
  const numOf = new Map(matches.map((m, i) => [m.id, i + 1]));
  const finished = event.status === 'completed';
  if (rrScoreMatchId) {
    const open = matches.find((m) => m.id === rrScoreMatchId);
    if (open) { renderRRScoreView(id, open, byId, numOf.get(open.id)); return; }
    rrScoreMatchId = null;
  }
  let html = `<h1>${esc(event.name)}</h1>
    <p class="muted">${esc(rrWhen(event))} · ${rrKindLabel(event.kind)} · ${rrStatusLabel(event.status)}</p>
    ${event.status === 'setup' ? `<p class="muted">${esc(rrCloseLabel(event))}</p>` : ''}`;
  if (finished) html += `<div class="banner finished">Night finished — final standings and payouts below.</div>`;
  const placeLabel = (n) => ['1ST', '2ND', '3RD'][n - 1] || `${n}TH`;
  if (event.kind === 'money' && payouts) {
    const standingByTeam = new Map(standings.map((s) => [s.teamId, s]));
    html += `<div class="card"><strong>Pot ${rrMoney(payouts.potCents)}</strong> <span class="muted">— ${teams.length * 2} players × ${rrMoney(event.fee_cents)} · ${esc(rrPayoutLabel(event.payout))}</span>
      ${payouts.places
        .map((p) => {
          const s = p.teamId != null ? standingByTeam.get(p.teamId) : null;
          return `<div class="rr-place">
            <div class="rr-medal m${p.place}">${p.place}</div>
            <div class="rr-place-info">
              <div class="rr-place-label">${placeLabel(p.place)} PLACE</div>
              <div class="rr-place-team">${s ? esc(s.label) : '<span class="muted">—</span>'}</div>
              ${s ? `<div class="muted">${s.w}W–${s.l}L · E/P ${s.ep == null ? '—' : (s.ep * 100).toFixed(1) + '%'}</div>` : ''}
            </div>
            <div class="rr-place-amount"><strong>${rrMoney(p.amountCents)}</strong>${p.note ? `<div class="muted">${esc(p.note)}</div>` : ''}</div>
          </div>`;
        })
        .join('')}
    </div>`;
  }
  // Free play: same medal winners view as money ball, without the money —
  // top 3 teams that have played, "Leaders" while playing, "Winners" once
  // the night is finished. The full standings list below is unchanged.
  if (event.kind !== 'money' && standings.some((s) => s.played > 0)) {
    html += `<div class="card"><strong>${finished ? 'Winners' : 'Leaders'}</strong>
      ${standings.filter((s) => s.played > 0).slice(0, 3)
        .map((s) => `<div class="rr-place">
          <div class="rr-medal m${s.rank}">${s.rank}</div>
          <div class="rr-place-info">
            <div class="rr-place-label">${placeLabel(s.rank)} PLACE</div>
            <div class="rr-place-team">${esc(s.label)}</div>
            <div class="muted">${s.w}W–${s.l}L · E/P ${s.ep == null ? '—' : (s.ep * 100).toFixed(1) + '%'}</div>
          </div>
        </div>`)
        .join('')}
    </div>`;
  }
  // Where the viewer stands on this night (person ids come from the
  // self-join endpoints; hand-added teams carry NULL ids and never match).
  const meId = getIdentity() ? getIdentity().personId : null;
  const myTeam = meId ? teams.find((t) => t.person1_id === meId || t.person2_id === meId) : null;
  const mySolo = meId ? solos.find((s) => s.person_id === meId) : null;
  const nightFull = teams.length >= (event.max_teams || 24);
  if (event.status === 'setup' && event.published) {
    // Join box — members join themselves. The organizer's add-by-hand form
    // stays below in the Teams card, and joining closes on its own once
    // the night is built (status playing).
    html += `<div class="card" id="rr-join-box"><h3>Join this night</h3>`;
    if (!meId) {
      html += `<p class="muted">Sign-ups are open — tap your name to join.</p>
        <div class="searchrow"><input type="text" id="rr-who-q" placeholder="Search your name…" autocomplete="off"></div>
        <div id="rr-who-list"><p class="muted">Type your name above.</p></div>
        <p class="muted">Not a member yet? <a href="#/members">Become a free MPA member</a> first.</p>`;
    } else if (myTeam) {
      html += `<p>You're in — <strong>${esc(myTeam.label)}</strong></p>
        <div class="btnrow"><button class="btn secondary small" id="rr-leave">Leave this night</button></div>`;
    } else if (mySolo) {
      html += `<p>You're signed up solo — waiting to be paired.</p>
        <div class="btnrow"><button class="btn secondary small" id="rr-leave">Leave this night</button></div>`;
    } else {
      const partner = rrJoinPartner && rrJoinPartner.eventId === id ? rrJoinPartner : null;
      html += `<p>Join as <strong>${esc(getIdentity().name)}</strong></p>
        <label>Partner (for a team)</label>
        <div class="searchrow"><input type="text" id="rr-partner-q" placeholder="Search your partner's name…" autocomplete="off"></div>
        <div id="rr-partner-list">${partner ? `<p>Partner: <strong>${esc(partner.name)}</strong> <button class="btn secondary small" id="rr-partner-clear">Change</button></p>` : '<p class="muted">Pick a partner, or join solo and the organizer will pair you up.</p>'}</div>
        <div class="btnrow"><button class="btn" id="rr-join-team" ${partner && !nightFull ? '' : 'disabled'}>Join as a team</button>
        <button class="btn secondary" id="rr-join-solo" ${nightFull ? 'disabled' : ''}>Join solo</button></div>
        ${nightFull ? `<p class="muted">This night is full (${event.max_teams || 24} teams).</p>` : ''}`;
    }
    html += `</div>`;
  }
  if (event.status === 'setup') {
    html += `<div class="card"><h3>Teams — ${teams.length}</h3>
      ${teams.map((t) => `<div>${esc(t.label)}${isAdmin ? ` <button class="btn secondary small" data-rm-team="${t.id}">Remove</button>` : ''}</div>`).join('') || '<p class="muted">No teams yet.</p>'}
      ${isAdmin ? `<p><input type="text" id="rr-p1" placeholder="Player 1" style="width:45%"> <input type="text" id="rr-p2" placeholder="Player 2" style="width:45%"></p>
      <div class="btnrow"><button class="btn small" id="rr-add-team">Add team</button></div>` : '<p class="muted">Waiting for the organizer to add teams and build the night.</p>'}
    </div>`;
    if (solos.length) {
      html += `<div class="card"><h3>Waiting to be paired — ${solos.length}</h3>
        ${solos.map((s) => {
          const picked = isAdmin && rrPairFirst && rrPairFirst.eventId === id && rrPairFirst.id === s.id;
          return `<div>${esc(s.name)}${isAdmin ? ` <button class="btn secondary small" data-rr-pair="${s.id}"${picked ? ' disabled' : ''}>${picked ? 'Picked — now tap a second solo' : 'Pair'}</button>` : ''}</div>`;
        }).join('')}
        ${isAdmin ? '<p class="muted">Tap Pair on two solos to make them a team.</p>' : '<p class="muted">The organizer pairs solos into teams.</p>'}
      </div>`;
    }
    if (isAdmin) {
      html += `<div class="card"><h3>Night settings</h3>
        ${event.kind === 'money' ? `<p>Entry fee per person ($) <input type="text" inputmode="decimal" id="rr-edit-fee" value="${(event.fee_cents / 100).toFixed(2)}" style="width:80px"></p>
        <p>Payout <select id="rr-edit-payout">${RR_PAYOUTS.map((p) => `<option value="${p.id}"${p.id === event.payout ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}</select></p>
        <div class="btnrow"><button class="btn small" id="rr-save-settings">Save settings</button></div>` : '<p class="muted">Free charity night — no fee, no payouts. To run this as a money ball instead, delete it and create a new night.</p>'}
        <p>Sign-ups: <strong>${event.published ? 'Open — members can join' : 'Closed — members cannot join'}</strong></p>
        <div class="btnrow"><button class="btn secondary small" id="rr-publish">${event.published ? 'Unpublish' : 'Publish'}</button>${event.published ? '<button class="btn secondary small" id="rr-close-signups">Close signups</button>' : ''}</div>
        <div class="btnrow"><button class="btn" id="rr-build" ${teams.length < 2 ? 'disabled' : ''}>Build the night</button>
        <button class="btn secondary small" id="rr-delete">Delete night</button></div>
        <p class="muted">Building pairs every team against every other team once — ${teams.length} teams make ${teams.length * (teams.length - 1) / 2} games to 11.</p>
      </div>`;
    }
  }
  if (matches.length) {
    const games = matches;
    const done = games.filter((m) => m.score1 != null);
    const byeForRound = (round) => byes.find((b) => b.round === round);
    const cardHtml = (m, isCurrentRound) => {
      const bye = byeForRound(m.round);
      const scored = m.score1 != null;
      const t1Win = scored && m.score1 > m.score2;
      const t2Win = scored && m.score2 > m.score1;
      const teamRow = (label, won, lost, score) =>
        `<div class="teams${won ? ' rr-team-win' : lost ? ' rr-team-lose' : ''}">${esc(label)}${scored ? ` <span class="rr-score">${score}</span>` : ''}</div>`;
      // SCORE button: only on an unplayed match in the round in play —
      // the preview shows no button on a match that already has a score.
      const canScore = !finished && !scored && isCurrentRound;
      // Edit link: Admin-only, on a scored match while the night is still
      // playing — reopens the same score screen, so a mistyped score can
      // be fixed without the big SCORE button coming back.
      const canEdit = !finished && scored && isAdmin;
      return `<div class="match-card">
        <div class="teams">Match ${numOf.get(m.id)}</div>
        <p class="muted">First to ${m.target_score}, win by 1</p>
        <div class="muted">Court ${m.court} · Round ${m.round}</div>
        ${teamRow(byId.get(m.team1_id)?.label || '', t1Win, t2Win, m.score1)}
        <div class="vs">VS</div>
        ${teamRow(byId.get(m.team2_id)?.label || '', t2Win, t1Win, m.score2)}
        ${bye ? `<div class="bye-row">${esc(byId.get(bye.teamId)?.label || '')} — BYE</div>` : ''}
        ${canScore ? `<button class="btn" data-rr-score="${m.id}">SCORE</button>` : ''}
        ${canEdit ? `<button class="rr-edit" data-rr-score="${m.id}">Edit</button>` : ''}
      </div>`;
    };
    // Rounds stack: the round in play on top, the rounds already played
    // drop down below it in order, then the rounds still to come. Only
    // the round in play gets SCORE buttons on its unplayed matches.
    const upcoming = games.filter((m) => m.score1 == null);
    const rounds = [...new Set(games.map((m) => m.round))].sort((a, b) => a - b);
    const currentRound = upcoming.length ? Math.min(...upcoming.map((m) => m.round)) : null;
    const nextRound = currentRound == null ? null : Math.min(...rounds.filter((r) => r > currentRound), Infinity);
    const roundStatus = (r) => {
      if (r === currentRound) return ['playing', 'Now playing'];
      if (games.filter((m) => m.round === r).every((m) => m.score1 != null)) return ['completed', 'Completed'];
      return r === nextRound ? ['next', 'Up next'] : ['upcoming', 'Upcoming'];
    };
    html += `<h2>Matches</h2>`;
    const orderedRounds = currentRound == null ? rounds : [currentRound, ...rounds.filter((r) => r !== currentRound)];
    for (const r of orderedRounds) {
      const [cls, label] = roundStatus(r);
      html += `<section class="rr-round"><h3>Round ${r} <span class="badge ${cls}">${label}</span></h3><div class="rr-matches">` + games.filter((m) => m.round === r).map((m) => cardHtml(m, r === currentRound)).join('') + `</div></section>`;
    }
    if (standings.length && standings.some((s) => s.played > 0)) {
      html += `<div class="card"><h3>Standings</h3>
        ${standings
          .map(
            (s) => `<div>${s.rank}. <strong>${esc(s.label)}</strong> — ${s.w}W-${s.l}L · E/P ${s.ep == null ? '—' : (s.ep * 100).toFixed(1) + '%'}</div>`
          )
          .join('')}
      </div>`;
    }
    if (isAdmin && event.status === 'playing') {
      html += `<div class="btnrow"><button class="btn" id="rr-finish">Finish the night</button>${done.length === 0 ? '<button class="btn secondary" id="rr-rebuild">Rebuild the night</button>' : ''}<button class="btn secondary" id="rr-delete">Delete night</button></div>`;
    }
    if (isAdmin && finished) {
      html += `<div class="btnrow"><button class="btn secondary" id="rr-reopen">Reopen the night</button><button class="btn secondary" id="rr-delete">Delete night</button></div>`;
    }
  }
  app.innerHTML = html;
  app.querySelectorAll('button[data-rr-score]').forEach((b) => {
    b.onclick = () => { rrScoreMatchId = +b.dataset.rrScore; renderRREvent(id); };
  });
  app.querySelectorAll('button[data-rm-team]').forEach((b) => {
    b.onclick = async () => {
      try {
        await api(`/api/admin/round-robin/events/${id}/teams/${b.dataset.rmTeam}`, { method: 'DELETE' });
        renderRREvent(id);
      } catch (e) { toast(e.message); }
    };
  });
  const addBtn = document.getElementById('rr-add-team');
  if (addBtn) {
    addBtn.onclick = async () => {
      const p1 = document.getElementById('rr-p1').value.trim();
      const p2 = document.getElementById('rr-p2').value.trim();
      if (!p1 || !p2) { toast('Enter both players’ names.'); return; }
      try {
        await post(`/api/admin/round-robin/events/${id}/teams`, { player1: p1, player2: p2 });
        renderRREvent(id);
      } catch (e) { toast(e.message); }
    };
  }
  const saveBtn = document.getElementById('rr-save-settings');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const fee = parseFloat(document.getElementById('rr-edit-fee').value);
      if (Number.isNaN(fee) || fee < 0) { toast('Entry fee must be $0 or more.'); return; }
      try {
        await api(`/api/admin/round-robin/events/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ fee_cents: Math.round(fee * 100), payout: document.getElementById('rr-edit-payout').value }),
        });
        toast('Settings saved.');
        renderRREvent(id);
      } catch (e) { toast(e.message); }
    };
  }
  const buildBtn = document.getElementById('rr-build');
  if (buildBtn) {
    buildBtn.onclick = async () => {
      try {
        const r = await post(`/api/admin/round-robin/events/${id}/build`, {});
        toast(`${r.matches} games built over ${r.rounds} rounds.`);
        renderRREvent(id);
      } catch (e) { toast(e.message); }
    };
  }
  const delBtn = document.getElementById('rr-delete');
  if (delBtn) {
    delBtn.onclick = async () => {
      if (!confirm('Delete this night, its teams and all its scores? This cannot be undone.')) return;
      try {
        await api(`/api/admin/round-robin/events/${id}`, { method: 'DELETE' });
        toast('Night deleted.');
        location.hash = '#/roundrobin';
      } catch (e) { toast(e.message); }
    };
  }
  const finBtn = document.getElementById('rr-finish');
  if (finBtn) {
    finBtn.onclick = async () => {
      try {
        await post(`/api/admin/round-robin/events/${id}/finish`, {});
        toast('Night finished.');
        renderRREvent(id);
      } catch (e) {
        if (/unscored/.test(e.message) && confirm(`${e.message} Finish anyway?`)) {
          try {
            await post(`/api/admin/round-robin/events/${id}/finish`, { force: true });
            toast('Night finished.');
            renderRREvent(id);
          } catch (e2) { toast(e2.message); }
        } else if (!/unscored/.test(e.message)) {
          toast(e.message);
        }
      }
    };
  }
  const rebuildBtn = document.getElementById('rr-rebuild');
  if (rebuildBtn) {
    rebuildBtn.onclick = async () => {
      if (!confirm('Rebuild the schedule? No scores have been entered yet, so nothing is lost.')) return;
      try {
        const r = await post(`/api/admin/round-robin/events/${id}/build`, {});
        toast(`${r.matches} games built over ${r.rounds} rounds.`);
        renderRREvent(id);
      } catch (e) { toast(e.message); }
    };
  }
  const reopenBtn = document.getElementById('rr-reopen');
  if (reopenBtn) {
    reopenBtn.onclick = async () => {
      try {
        await post(`/api/admin/round-robin/events/${id}/reopen`, {});
        toast('Night reopened.');
        renderRREvent(id);
      } catch (e) { toast(e.message); }
    };
  }
  // ---- self-join wiring ----
  const whoQ = document.getElementById('rr-who-q');
  if (whoQ) {
    const whoList = document.getElementById('rr-who-list');
    whoQ.addEventListener('input', async () => {
      const q = whoQ.value.trim();
      if (q.length < 2) { whoList.innerHTML = '<p class="muted">Type your name above.</p>'; return; }
      const rows = await rrSearchPeople(q);
      if (!rows.length) { whoList.innerHTML = '<p class="muted">No match — check the spelling, or become a member first.</p>'; return; }
      whoList.innerHTML = rows.map(rrPersonRowHtml).join('');
      whoList.querySelectorAll('.person-row').forEach((row) => {
        row.onclick = () => {
          setIdentity(+row.dataset.pid, row.dataset.name);
          toast(`Hi ${row.dataset.name} — welcome back.`);
          renderRREvent(id);
        };
      });
    });
  }
  const partnerQ = document.getElementById('rr-partner-q');
  if (partnerQ) {
    const partnerList = document.getElementById('rr-partner-list');
    partnerQ.addEventListener('input', async () => {
      const q = partnerQ.value.trim();
      if (q.length < 2) { partnerList.innerHTML = '<p class="muted">Pick a partner, or join solo and the organizer will pair you up.</p>'; return; }
      const rows = (await rrSearchPeople(q)).filter((p) => p.personId !== meId);
      if (!rows.length) { partnerList.innerHTML = '<p class="muted">No match — check the spelling.</p>'; return; }
      partnerList.innerHTML = rows.map(rrPersonRowHtml).join('');
      partnerList.querySelectorAll('.person-row').forEach((row) => {
        row.onclick = () => {
          rrJoinPartner = { personId: +row.dataset.pid, name: row.dataset.name, eventId: id };
          partnerList.innerHTML = `<p>Partner: <strong>${esc(rrJoinPartner.name)}</strong> <button class="btn secondary small" id="rr-partner-clear">Change</button></p>`;
          const joinTeamBtn = document.getElementById('rr-join-team');
          if (joinTeamBtn) joinTeamBtn.disabled = false;
          wirePartnerClear();
        };
      });
    });
  }
  function wirePartnerClear() {
    const clearBtn = document.getElementById('rr-partner-clear');
    if (clearBtn) {
      clearBtn.onclick = () => {
        rrJoinPartner = null;
        document.getElementById('rr-partner-list').innerHTML = '<p class="muted">Pick a partner, or join solo and the organizer will pair you up.</p>';
        const joinTeamBtn = document.getElementById('rr-join-team');
        if (joinTeamBtn) joinTeamBtn.disabled = true;
      };
    }
  }
  wirePartnerClear();
  const joinTeamBtn = document.getElementById('rr-join-team');
  if (joinTeamBtn) {
    joinTeamBtn.onclick = async () => {
      if (!rrJoinPartner || rrJoinPartner.eventId !== id) { toast('Pick a partner first.'); return; }
      try {
        await post(`/api/round-robin/events/${id}/join-team`, { personId: meId, partnerPersonId: rrJoinPartner.personId });
        toast(`You're in — ${getIdentity().name} & ${rrJoinPartner.name}.`);
        rrJoinPartner = null;
        renderRREvent(id);
      } catch (e) { toast(e.message); }
    };
  }
  const joinSoloBtn = document.getElementById('rr-join-solo');
  if (joinSoloBtn) {
    joinSoloBtn.onclick = async () => {
      try {
        await post(`/api/round-robin/events/${id}/join-solo`, { personId: meId });
        toast('Signed up solo — the organizer will pair you up.');
        renderRREvent(id);
      } catch (e) { toast(e.message); }
    };
  }
  const leaveBtn = document.getElementById('rr-leave');
  if (leaveBtn) {
    leaveBtn.onclick = async () => {
      try {
        await post(`/api/round-robin/events/${id}/leave`, { personId: meId });
        toast('You left this night.');
        renderRREvent(id);
      } catch (e) { toast(e.message); }
    };
  }
  app.querySelectorAll('button[data-rr-pair]').forEach((b) => {
    b.onclick = async () => {
      const soloId = +b.dataset.rrPair;
      if (!rrPairFirst || rrPairFirst.eventId !== id) {
        const solo = solos.find((s) => s.id === soloId);
        rrPairFirst = { id: soloId, eventId: id, name: solo ? solo.name : '' };
        toast(`Picked ${rrPairFirst.name || 'solo'} — now tap a second solo to pair them.`);
        renderRREvent(id);
        return;
      }
      if (rrPairFirst.id === soloId) { rrPairFirst = null; renderRREvent(id); return; }
      try {
        await post(`/api/admin/round-robin/events/${id}/pair`, { soloIdA: rrPairFirst.id, soloIdB: soloId });
        toast('Paired into a team.');
        rrPairFirst = null;
        renderRREvent(id);
      } catch (e) { toast(e.message); }
    };
  });
  const pubBtn = document.getElementById('rr-publish');
  if (pubBtn) {
    pubBtn.onclick = async () => {
      try {
        await api(`/api/admin/round-robin/events/${id}`, { method: 'PATCH', body: JSON.stringify({ published: !event.published }) });
        toast(event.published ? 'Night unpublished — sign-ups closed.' : 'Night published — members can join.');
        renderRREvent(id);
      } catch (e) { toast(e.message); }
    };
  }
  const closeBtn = document.getElementById('rr-close-signups');
  if (closeBtn) {
    closeBtn.onclick = async () => {
      try {
        await api(`/api/admin/round-robin/events/${id}`, { method: 'PATCH', body: JSON.stringify({ published: false }) });
        toast('Sign-ups closed.');
        renderRREvent(id);
      } catch (e) { toast(e.message); }
    };
  }
  if (!rrScoreMatchId) {
    refreshTimer = setInterval(() => {
      // Don't wipe a join in progress — if the viewer is typing in the
      // join box, skip this refresh cycle.
      const ae = document.activeElement;
      if (ae && ae.closest && ae.closest('#rr-join-box')) return;
      renderRREvent(id);
    }, 30000);
  }
}

// Dedicated one-match score screen, mirroring the league flow: stacked
// names, plain score boxes, white card.
function renderRRScoreView(id, m, byId, num) {
  const t1 = esc(byId.get(m.team1_id)?.label || '');
  const t2 = esc(byId.get(m.team2_id)?.label || '');
  const scored = m.score1 != null;
  app.innerHTML = `
    <div class="match-card">
      <h3>Match ${num} · Court ${m.court} · Round ${m.round}</h3>
      <p class="muted">Games to ${m.target_score}</p>
      <div class="teams">${t1}</div>
      <div class="score-row">
        <input type="text" inputmode="numeric" id="rr-s1" value="${scored ? m.score1 : ''}" placeholder="—" aria-label="Team 1 score">
      </div>
      <div class="vs" style="text-align:center">VS</div>
      <div class="teams">${t2}</div>
      <div class="score-row">
        <input type="text" inputmode="numeric" id="rr-s2" value="${scored ? m.score2 : ''}" placeholder="—" aria-label="Team 2 score">
      </div>
      <div class="score-row">
        <button class="btn" id="rr-svSave">Save score</button>
        ${scored ? `<button class="btn secondary small" id="rr-svClear">Clear</button>` : ''}
        <button class="btn secondary" id="rr-svBack">Back</button>
      </div>
    </div>`;
  document.getElementById('rr-svBack').onclick = () => { rrScoreMatchId = null; renderRREvent(id); };
  document.getElementById('rr-svSave').onclick = async () => {
    const s1 = document.getElementById('rr-s1').value;
    const s2 = document.getElementById('rr-s2').value;
    const n1 = s1 === '' ? null : +s1;
    const n2 = s2 === '' ? null : +s2;
    if (n1 == null || n2 == null) { toast('Enter both scores.'); return; }
    if (!Number.isInteger(n1) || !Number.isInteger(n2) || n1 < 0 || n2 < 0 || n1 > 30 || n2 > 30) { toast('Scores must be whole numbers from 0 to 30.'); return; }
    if (n1 === n2) { toast('Scores cannot tie.'); return; }
    if (Math.max(n1, n2) < m.target_score) { toast(`One side must reach ${m.target_score} (games to ${m.target_score}).`); return; }
    if (Math.max(n1, n2) > m.target_score) { toast(`First to ${m.target_score} — the game ends at ${m.target_score}.`); return; }
    try {
      await post(`/api/round-robin/events/${id}/matches/${m.id}/score`, { score1: n1, score2: n2 });
      toast('Score saved.');
      rrScoreMatchId = null;
      renderRREvent(id);
    } catch (e) { toast(e.message); }
  };
  const clearBtn = document.getElementById('rr-svClear');
  if (clearBtn) {
    clearBtn.onclick = async () => {
      try {
        await post(`/api/round-robin/events/${id}/matches/${m.id}/score`, { score1: null, score2: null });
        toast('Score cleared.');
        rrScoreMatchId = null;
        renderRREvent(id);
      } catch (e) { toast(e.message); }
    };
  }
}

// ---------- Bracket ----------
// One-off double-elimination nights, separate from leagues and round robin.
// Fixed doubles teams stay together all night; teams are seeded by combined
// doubles rating, losers drop to a second bracket, lose twice and you're out.
// The winners-bracket champion meets the losers-bracket champion in the
// grand final, with a reset game if the losers champion wins the first final.
// Scoring mirrors the round robin flow: one match at a time, SCORE button,
// dedicated score screen, finished matches below.
//
// Two differences from round robin, both forced by the shape of a bracket:
// - A bracket night plays several matches at once (the whole play-in round
//   is ready on the first night), so a SCORE button sits on every match
//   whose teams are both decided and that has no score yet — not only on
//   one "round in play". Rounds are badged Now playing / Completed /
//   Waiting instead of being reordered, so the bracket always reads in
//   bracket order (winners rounds, then losers rounds, then grand final).
// - There is no standings table and no court assignment: a bracket has no
//   E/P order until it resolves, and matches are not scheduled onto courts.
let brScoreMatchId = null;
// Partner picked in the join box (survives the 30s refresh), and the first
// solo picked for Admin pairing. Both carry the event id they belong to,
// so a stale pick from another night is ignored.
let brJoinPartner = null; // { personId, name, eventId }
let brPairFirst = null; // { id, eventId, name }
const BRACKET_SIZES = [4, 6, 8, 10, 12, 16];

function brNextPow2(n) {
  let b = 1;
  while (b < n) b *= 2;
  return b;
}

// Round titles. Winners bracket by match count, with a play-in label when
// the top seeds waited on byes; losers bracket by index, the last round
// being the Losers Final; G is the Grand Final / Reset Game.
function brRoundTitle(bracket, round, count, n, isLastWb, isLastLb) {
  if (bracket === 'G') return round === 0 ? 'Grand Final' : 'Reset Game';
  if (bracket === 'W') {
    // The play-in check comes first: for 6 and 10 teams the play-in has
    // only 2 matches, which would otherwise read as a semifinal.
    if (round === 0 && brNextPow2(n) > n) return 'Winners Round 1 · Play-in';
    if (isLastWb) return 'Winners Final';
    if (count === 2) return 'Winners Semifinal';
    if (count === 4) return 'Winners Quarterfinal';
    if (count === 8) return 'Winners Round of 16';
    return `Winners Round ${round + 1}`;
  }
  if (isLastLb) return 'Losers Final';
  return `Losers Round ${round + 1}`;
}

async function renderBrList() {
  // Nights list only — creating a night lives on the Admin page
  // ("Bracket" section), where the create card lives.
  app.innerHTML = `<h1>Bracket</h1>
    <p class="muted">One-off double-elimination bracket nights, separate from leagues. Fixed teams stay together all night — lose twice and you're out, and the winners-bracket champion meets the losers-bracket champion in the grand final.</p>
    <div id="brList"><p class="muted">Loading…</p></div>`;
  const me = await api('/api/admin/me').catch(() => ({ admin: false }));
  const { events } = await api('/api/bracket/events').catch(() => ({ events: [] }));
  document.getElementById('brList').innerHTML = events.length
    ? events
        .map((ev) => {
          const joinOpen = ev.published && ev.status === 'setup' && !me.admin;
          return `<div class="card">
        <strong>${esc(ev.name)}</strong><br>
        <span class="muted">${esc(rrWhen(ev))} · Double elimination · ${rrKindLabel(ev.kind)} · ${rrStatusLabel(ev.status)}${ev.published && ev.status === 'setup' ? ' · Sign-ups open' : ''} · ${ev.team_count} team(s)${ev.solo_count ? ` · ${ev.solo_count} waiting to be paired` : ''}${ev.kind === 'money' ? ` · ${rrMoney(ev.fee_cents)} per person` : ''}${ev.match_count ? ` · ${ev.scored_count}/${ev.match_count} scored` : ''}</span>
        <div class="btnrow"><a class="btn ${joinOpen ? 'green ' : ''}small" href="#/bracket/${ev.id}">${joinOpen ? 'Join' : 'Open'}</a></div>
      </div>`;
        })
        .join('')
    : `<div class="card"><p>No bracket nights yet.</p></div>`;
}

async function renderBrEvent(id) {
  // Same refresh discipline as game days and round robin: clear the old
  // timer before setting a new one. No refresh while a score screen is
  // open, so typed scores are never wiped mid-entry.
  clearInterval(refreshTimer);
  const data = await api(`/api/bracket/events/${id}`).catch((e) => ({ error: e.message }));
  if (data.error || !data.event) {
    app.innerHTML = `<div class="banner warn">${esc(data.error || 'Not found.')}</div>`;
    return;
  }
  const { event, teams, solos = [], matches, podium, records, payouts, isAdmin } = data;
  const byId = new Map(teams.map((t) => [t.id, t]));
  const recByTeam = new Map(records.map((r) => [r.teamId, r]));
  const matchesById = new Map(matches.map((m) => [m.id, m]));
  // Matches arrive in creation order — number them 1..N for the night so
  // every card has its own number.
  const numOf = new Map(matches.map((m, i) => [m.id, i + 1]));
  const finished = event.status === 'completed';
  // Round groups, in bracket order: winners rounds, then losers rounds,
  // then the grand final. Each group knows its title and its match count.
  const maxWbRound = Math.max(-1, ...matches.filter((m) => m.bracket === 'W').map((m) => m.round));
  const maxLbRound = Math.max(-1, ...matches.filter((m) => m.bracket === 'L').map((m) => m.round));
  const roundGroups = [];
  for (const br of ['W', 'L', 'G']) {
    const rounds = [...new Set(matches.filter((m) => m.bracket === br).map((m) => m.round))].sort((a, b) => a - b);
    for (const r of rounds) {
      const ms = matches.filter((m) => m.bracket === br && m.round === r);
      roundGroups.push({
        bracket: br,
        round: r,
        matches: ms,
        title: brRoundTitle(br, r, ms.length, teams.length, br === 'W' && r === maxWbRound, br === 'L' && r === maxLbRound),
      });
    }
  }
  const titleOf = (m) => {
    const g = roundGroups.find((x) => x.bracket === m.bracket && x.round === m.round);
    return g ? g.title : '';
  };
  // A slot that hasn't resolved yet: say who it will be ("Winner · Winners
  // Quarterfinal · Game 2"). Seed slots always resolve once the night is
  // built, so they only show as a fallback.
  const slotLabel = (slot) => {
    if (slot.type === 'seed') return `#${slot.ref}`;
    const src = matchesById.get(slot.ref);
    if (!src) return '—';
    return `${slot.type === 'winner' ? 'Winner' : 'Loser'} · ${titleOf(src)} · Game ${src.game_no}`;
  };
  const gf1 = matches.find((m) => m.bracket === 'G' && m.round === 0);
  const gf1Decided = !!gf1 && gf1.score1 != null;
  if (brScoreMatchId) {
    const open = matches.find((m) => m.id === brScoreMatchId);
    if (open) { renderBrScoreView(id, open, byId, numOf.get(open.id), titleOf(open)); return; }
    brScoreMatchId = null;
  }
  let html = `<h1>${esc(event.name)}</h1>
    <p class="muted">${esc(rrWhen(event))} · Double elimination · ${rrKindLabel(event.kind)} · ${rrStatusLabel(event.status)}</p>
    ${event.status === 'setup' ? `<p class="muted">${esc(rrCloseLabel(event))}</p>` : ''}`;
  if (finished) html += `<div class="banner finished">Night finished — final standings and payouts below.</div>`;
  const placeLabel = (n) => ['1ST', '2ND', '3RD'][n - 1] || `${n}TH`;
  if (event.kind === 'money' && payouts) {
    html += `<div class="card"><strong>Pot ${rrMoney(payouts.potCents)}</strong> <span class="muted">— ${teams.length * 2} players × ${rrMoney(event.fee_cents)} · ${esc(rrPayoutLabel(event.payout))}</span>
      ${payouts.places
        .map((p) => {
          const t = p.teamId != null ? byId.get(p.teamId) : null;
          const r = p.teamId != null ? recByTeam.get(p.teamId) : null;
          return `<div class="rr-place">
            <div class="rr-medal m${p.place}">${p.place}</div>
            <div class="rr-place-info">
              <div class="rr-place-label">${placeLabel(p.place)} PLACE</div>
              <div class="rr-place-team">${t ? `<span class="br-seed">#${t.seed}</span>${esc(t.label)}` : '<span class="muted">—</span>'}</div>
              ${r ? `<div class="muted">${r.w}W–${r.l}L</div>` : ''}
            </div>
            <div class="rr-place-amount"><strong>${rrMoney(p.amountCents)}</strong>${p.note ? `<div class="muted">${esc(p.note)}</div>` : ''}</div>
          </div>`;
        })
        .join('')}
    </div>`;
  }
  // Free play: same medal winners view as money ball, without the money —
  // the podium (champion, runner-up, 3rd) once the night is finished. While
  // the night is still playing there is no Leaders card: a bracket has no
  // standings order until it resolves.
  if (event.kind !== 'money' && finished && podium) {
    const won = [
      { place: 1, teamId: podium.champion },
      { place: 2, teamId: podium.runnerUp },
      { place: 3, teamId: podium.third },
    ].filter((p) => p.teamId != null);
    if (won.length) {
      html += `<div class="card"><strong>Winners</strong>
        ${won
          .map((p) => {
            const t = byId.get(p.teamId);
            const r = recByTeam.get(p.teamId);
            return `<div class="rr-place">
              <div class="rr-medal m${p.place}">${p.place}</div>
              <div class="rr-place-info">
                <div class="rr-place-label">${placeLabel(p.place)} PLACE</div>
                <div class="rr-place-team">${t ? `<span class="br-seed">#${t.seed}</span>${esc(t.label)}` : '<span class="muted">—</span>'}</div>
                ${r ? `<div class="muted">${r.w}W–${r.l}L</div>` : ''}
              </div>
            </div>`;
          })
          .join('')}
      </div>`;
    }
  }
  // Where the viewer stands on this night (person ids come from the
  // self-join endpoints; hand-added teams carry NULL ids and never match).
  const meId = getIdentity() ? getIdentity().personId : null;
  const myTeam = meId ? teams.find((t) => t.person1_id === meId || t.person2_id === meId) : null;
  const mySolo = meId ? solos.find((s) => s.person_id === meId) : null;
  const nightFull = teams.length >= (event.max_teams || 12);
  if (event.status === 'setup' && event.published) {
    // Join box — members join themselves. The organizer's add-by-hand form
    // stays below in the Teams card, and joining closes on its own once
    // the night is built (status playing).
    html += `<div class="card" id="br-join-box"><h3>Join this night</h3>`;
    if (!meId) {
      html += `<p class="muted">Sign-ups are open — tap your name to join.</p>
        <div class="searchrow"><input type="text" id="br-who-q" placeholder="Search your name…" autocomplete="off"></div>
        <div id="br-who-list"><p class="muted">Type your name above.</p></div>
        <p class="muted">Not a member yet? <a href="#/members">Become a free MPA member</a> first.</p>`;
    } else if (myTeam) {
      html += `<p>You're in — <strong>${esc(myTeam.label)}</strong></p>
        <div class="btnrow"><button class="btn secondary small" id="br-leave">Leave this night</button></div>`;
    } else if (mySolo) {
      html += `<p>You're signed up solo — waiting to be paired.</p>
        <div class="btnrow"><button class="btn secondary small" id="br-leave">Leave this night</button></div>`;
    } else {
      const partner = brJoinPartner && brJoinPartner.eventId === id ? brJoinPartner : null;
      html += `<p>Join as <strong>${esc(getIdentity().name)}</strong></p>
        <label>Partner (for a team)</label>
        <div class="searchrow"><input type="text" id="br-partner-q" placeholder="Search your partner's name…" autocomplete="off"></div>
        <div id="br-partner-list">${partner ? `<p>Partner: <strong>${esc(partner.name)}</strong> <button class="btn secondary small" id="br-partner-clear">Change</button></p>` : '<p class="muted">Pick a partner, or join solo and the organizer will pair you up.</p>'}</div>
        <div class="btnrow"><button class="btn" id="br-join-team" ${partner && !nightFull ? '' : 'disabled'}>Join as a team</button>
        <button class="btn secondary" id="br-join-solo" ${nightFull ? 'disabled' : ''}>Join solo</button></div>
        ${nightFull ? `<p class="muted">This night is full (${event.max_teams || 12} teams).</p>` : ''}`;
    }
    html += `</div>`;
  }
  if (event.status === 'setup') {
    html += `<div class="card"><h3>Teams — ${teams.length}</h3>
      ${teams.map((t) => `<div>${esc(t.label)}${isAdmin ? ` <button class="btn secondary small" data-rm-team="${t.id}">Remove</button>` : ''}</div>`).join('') || '<p class="muted">No teams yet.</p>'}
      ${isAdmin ? `<p><input type="text" id="br-p1" placeholder="Player 1" style="width:45%"> <input type="text" id="br-p2" placeholder="Player 2" style="width:45%"></p>
      <div class="btnrow"><button class="btn small" id="br-add-team">Add team</button></div>` : '<p class="muted">Waiting for the organizer to add teams and build the night.</p>'}
    </div>`;
    if (solos.length) {
      html += `<div class="card"><h3>Waiting to be paired — ${solos.length}</h3>
        ${solos.map((s) => {
          const picked = isAdmin && brPairFirst && brPairFirst.eventId === id && brPairFirst.id === s.id;
          return `<div>${esc(s.name)}${isAdmin ? ` <button class="btn secondary small" data-br-pair="${s.id}"${picked ? ' disabled' : ''}>${picked ? 'Picked — now tap a second solo' : 'Pair'}</button>` : ''}</div>`;
        }).join('')}
        ${isAdmin ? '<p class="muted">Tap Pair on two solos to make them a team.</p>' : '<p class="muted">The organizer pairs solos into teams.</p>'}
      </div>`;
    }
    if (isAdmin) {
      const canBuild = BRACKET_SIZES.includes(teams.length);
      html += `<div class="card"><h3>Night settings</h3>
        ${event.kind === 'money' ? `<p>Entry fee per person ($) <input type="text" inputmode="decimal" id="br-edit-fee" value="${(event.fee_cents / 100).toFixed(2)}" style="width:80px"></p>
        <p>Payout <select id="br-edit-payout">${RR_PAYOUTS.filter((p) => p.id !== 'top-four-40-30-20-10').map((p) => `<option value="${p.id}"${p.id === event.payout ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}</select></p>
        <div class="btnrow"><button class="btn small" id="br-save-settings">Save settings</button></div>` : '<p class="muted">Free charity night — no fee, no payouts. To run this as a money ball instead, delete it and create a new night.</p>'}
        <p>Sign-ups: <strong>${event.published ? 'Open — members can join' : 'Closed — members cannot join'}</strong></p>
        <div class="btnrow"><button class="btn secondary small" id="br-publish">${event.published ? 'Unpublish' : 'Publish'}</button>${event.published ? '<button class="btn secondary small" id="br-close-signups">Close signups</button>' : ''}</div>
        <div class="btnrow"><button class="btn" id="br-build" ${canBuild ? '' : 'disabled'}>Build the bracket</button>
        <button class="btn secondary small" id="br-delete">Delete night</button></div>
        ${canBuild
          ? `<p class="muted">Building seeds the teams by combined doubles rating and builds the double-elimination bracket — ${teams.length} teams make ${2 * teams.length - 2} games to 11 (+1 if a reset game is needed).</p>`
          : `<p class="muted">A bracket needs 4, 6, 8, 10, 12 or 16 teams — ${teams.length} signed up. Add or remove a team, then build.</p>`}
      </div>`;
    }
  }
  if (matches.length) {
    const games = matches;
    const done = games.filter((m) => m.score1 != null);
    const teamCell = (m, which) => {
      const teamId = which === 1 ? m.team1_id : m.team2_id;
      const team = teamId != null ? byId.get(teamId) : null;
      if (team) return `<span class="br-seed">#${team.seed}</span>${esc(team.label)}`;
      const slot = which === 1 ? { type: m.slot1_type, ref: m.slot1_ref } : { type: m.slot2_type, ref: m.slot2_ref };
      return `<span class="br-slot-wait">${esc(slotLabel(slot))}</span>`;
    };
    const cardHtml = (m) => {
      const scored = m.score1 != null;
      const t1Win = scored && m.score1 > m.score2;
      const t2Win = scored && m.score2 > m.score1;
      const teamRow = (cell, won, lost, score) =>
        `<div class="teams${won ? ' rr-team-win' : lost ? ' rr-team-lose' : ''}">${cell}${scored ? ` <span class="rr-score">${score}</span>` : ''}</div>`;
      // SCORE button: on every unplayed match whose teams are both decided
      // and that is actually going to be played (the reset game only when
      // it is needed) — a bracket plays several matches at once, so there
      // is no single "round in play" to gate on.
      const canScore = !finished && !scored && m.ready && m.active;
      // Edit link: Admin-only, on a scored match while the night is still
      // playing — reopens the same score screen, so a mistyped score can
      // be fixed without the big SCORE button coming back.
      const canEdit = !finished && scored && isAdmin;
      const isReset = m.bracket === 'G' && m.round === 1;
      const noReset = isReset && !m.active && gf1Decided;
      return `<div class="match-card">
        <div class="teams">Match ${numOf.get(m.id)}</div>
        <p class="muted">First to ${m.target_score}, win by 1</p>
        <div class="muted">${esc(titleOf(m))} · Game ${m.game_no}</div>
        ${teamRow(teamCell(m, 1), t1Win, t2Win, m.score1)}
        <div class="vs">VS</div>
        ${teamRow(teamCell(m, 2), t2Win, t1Win, m.score2)}
        ${noReset ? `<p class="muted">No reset game needed — the winners-bracket champion won the grand final.</p>` : ''}
        ${canScore ? `<button class="btn" data-br-score="${m.id}">SCORE</button>` : ''}
        ${canEdit ? `<button class="rr-edit" data-br-score="${m.id}">Edit</button>` : ''}
      </div>`;
    };
    // Bracket sections stay in bracket order — winners rounds, then losers
    // rounds, then the grand final — each badged by whether it has a match
    // ready to score, is fully scored, or is still waiting on earlier
    // results. (Round robin reorders its rounds with the round in play on
    // top; a bracket has several playable rounds at once, so reordering
    // would shuffle the bracket as the night goes on.)
    html += `<h2>Bracket</h2>`;
    for (const g of roundGroups) {
      const allScored = g.matches.every((m) => m.score1 != null);
      const anyReady = g.matches.some((m) => m.score1 == null && m.ready && m.active);
      const [cls, label] = allScored
        ? ['completed', 'Completed']
        : anyReady
          ? ['playing', 'Now playing']
          : ['upcoming', 'Waiting'];
      html += `<section class="rr-round"><h3>${esc(g.title)} <span class="badge ${cls}">${label}</span></h3><div class="rr-matches">` + g.matches.map(cardHtml).join('') + `</div></section>`;
    }
    if (isAdmin && event.status === 'playing') {
      html += `<div class="btnrow"><button class="btn" id="br-finish">Finish the night</button>${done.length === 0 ? '<button class="btn secondary" id="br-rebuild">Rebuild the night</button>' : ''}<button class="btn secondary" id="br-delete">Delete night</button></div>`;
    }
    if (isAdmin && finished) {
      html += `<div class="btnrow"><button class="btn secondary" id="br-reopen">Reopen the night</button><button class="btn secondary" id="br-delete">Delete night</button></div>`;
    }
  }
  app.innerHTML = html;
  app.querySelectorAll('button[data-br-score]').forEach((b) => {
    b.onclick = () => { brScoreMatchId = +b.dataset.brScore; renderBrEvent(id); };
  });
  app.querySelectorAll('button[data-rm-team]').forEach((b) => {
    b.onclick = async () => {
      try {
        await api(`/api/admin/bracket/events/${id}/teams/${b.dataset.rmTeam}`, { method: 'DELETE' });
        renderBrEvent(id);
      } catch (e) { toast(e.message); }
    };
  });
  const addBtn = document.getElementById('br-add-team');
  if (addBtn) {
    addBtn.onclick = async () => {
      const p1 = document.getElementById('br-p1').value.trim();
      const p2 = document.getElementById('br-p2').value.trim();
      if (!p1 || !p2) { toast('Enter both players’ names.'); return; }
      try {
        await post(`/api/admin/bracket/events/${id}/teams`, { player1: p1, player2: p2 });
        renderBrEvent(id);
      } catch (e) { toast(e.message); }
    };
  }
  const saveBtn = document.getElementById('br-save-settings');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const fee = parseFloat(document.getElementById('br-edit-fee').value);
      if (Number.isNaN(fee) || fee < 0) { toast('Entry fee must be $0 or more.'); return; }
      try {
        await api(`/api/admin/bracket/events/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ fee_cents: Math.round(fee * 100), payout: document.getElementById('br-edit-payout').value }),
        });
        toast('Settings saved.');
        renderBrEvent(id);
      } catch (e) { toast(e.message); }
    };
  }
  const buildBtn = document.getElementById('br-build');
  if (buildBtn) {
    buildBtn.onclick = async () => {
      try {
        const r = await post(`/api/admin/bracket/events/${id}/build`, {});
        toast(`Bracket built — ${r.games} games to a champion.`);
        renderBrEvent(id);
      } catch (e) { toast(e.message); }
    };
  }
  const delBtn = document.getElementById('br-delete');
  if (delBtn) {
    delBtn.onclick = async () => {
      if (!confirm('Delete this night, its teams and all its scores? This cannot be undone.')) return;
      try {
        await api(`/api/admin/bracket/events/${id}`, { method: 'DELETE' });
        toast('Night deleted.');
        location.hash = '#/bracket';
      } catch (e) { toast(e.message); }
    };
  }
  const finBtn = document.getElementById('br-finish');
  if (finBtn) {
    finBtn.onclick = async () => {
      try {
        await post(`/api/admin/bracket/events/${id}/finish`, {});
        toast('Night finished.');
        renderBrEvent(id);
      } catch (e) {
        if (/unscored/.test(e.message) && confirm(`${e.message} Finish anyway?`)) {
          try {
            await post(`/api/admin/bracket/events/${id}/finish`, { force: true });
            toast('Night finished.');
            renderBrEvent(id);
          } catch (e2) { toast(e2.message); }
        } else if (!/unscored/.test(e.message)) {
          toast(e.message);
        }
      }
    };
  }
  const rebuildBtn = document.getElementById('br-rebuild');
  if (rebuildBtn) {
    rebuildBtn.onclick = async () => {
      if (!confirm('Rebuild the bracket? No scores have been entered yet, so nothing is lost.')) return;
      try {
        const r = await post(`/api/admin/bracket/events/${id}/build`, {});
        toast(`Bracket built — ${r.games} games to a champion.`);
        renderBrEvent(id);
      } catch (e) { toast(e.message); }
    };
  }
  const reopenBtn = document.getElementById('br-reopen');
  if (reopenBtn) {
    reopenBtn.onclick = async () => {
      try {
        await post(`/api/admin/bracket/events/${id}/reopen`, {});
        toast('Night reopened.');
        renderBrEvent(id);
      } catch (e) { toast(e.message); }
    };
  }
  // ---- self-join wiring ----
  const whoQ = document.getElementById('br-who-q');
  if (whoQ) {
    const whoList = document.getElementById('br-who-list');
    whoQ.addEventListener('input', async () => {
      const q = whoQ.value.trim();
      if (q.length < 2) { whoList.innerHTML = '<p class="muted">Type your name above.</p>'; return; }
      const rows = await rrSearchPeople(q);
      if (!rows.length) { whoList.innerHTML = '<p class="muted">No match — check the spelling, or become a member first.</p>'; return; }
      whoList.innerHTML = rows.map(rrPersonRowHtml).join('');
      whoList.querySelectorAll('.person-row').forEach((row) => {
        row.onclick = () => {
          setIdentity(+row.dataset.pid, row.dataset.name);
          toast(`Hi ${row.dataset.name} — welcome back.`);
          renderBrEvent(id);
        };
      });
    });
  }
  const partnerQ = document.getElementById('br-partner-q');
  if (partnerQ) {
    const partnerList = document.getElementById('br-partner-list');
    partnerQ.addEventListener('input', async () => {
      const q = partnerQ.value.trim();
      if (q.length < 2) { partnerList.innerHTML = '<p class="muted">Pick a partner, or join solo and the organizer will pair you up.</p>'; return; }
      const rows = (await rrSearchPeople(q)).filter((p) => p.personId !== meId);
      if (!rows.length) { partnerList.innerHTML = '<p class="muted">No match — check the spelling.</p>'; return; }
      partnerList.innerHTML = rows.map(rrPersonRowHtml).join('');
      partnerList.querySelectorAll('.person-row').forEach((row) => {
        row.onclick = () => {
          brJoinPartner = { personId: +row.dataset.pid, name: row.dataset.name, eventId: id };
          partnerList.innerHTML = `<p>Partner: <strong>${esc(brJoinPartner.name)}</strong> <button class="btn secondary small" id="br-partner-clear">Change</button></p>`;
          const joinTeamBtn = document.getElementById('br-join-team');
          if (joinTeamBtn) joinTeamBtn.disabled = false;
          wirePartnerClear();
        };
      });
    });
  }
  function wirePartnerClear() {
    const clearBtn = document.getElementById('br-partner-clear');
    if (clearBtn) {
      clearBtn.onclick = () => {
        brJoinPartner = null;
        document.getElementById('br-partner-list').innerHTML = '<p class="muted">Pick a partner, or join solo and the organizer will pair you up.</p>';
        const joinTeamBtn = document.getElementById('br-join-team');
        if (joinTeamBtn) joinTeamBtn.disabled = true;
      };
    }
  }
  wirePartnerClear();
  const joinTeamBtn = document.getElementById('br-join-team');
  if (joinTeamBtn) {
    joinTeamBtn.onclick = async () => {
      if (!brJoinPartner || brJoinPartner.eventId !== id) { toast('Pick a partner first.'); return; }
      try {
        await post(`/api/bracket/events/${id}/join-team`, { personId: meId, partnerPersonId: brJoinPartner.personId });
        toast(`You're in — ${getIdentity().name} & ${brJoinPartner.name}.`);
        brJoinPartner = null;
        renderBrEvent(id);
      } catch (e) { toast(e.message); }
    };
  }
  const joinSoloBtn = document.getElementById('br-join-solo');
  if (joinSoloBtn) {
    joinSoloBtn.onclick = async () => {
      try {
        await post(`/api/bracket/events/${id}/join-solo`, { personId: meId });
        toast('Signed up solo — the organizer will pair you up.');
        renderBrEvent(id);
      } catch (e) { toast(e.message); }
    };
  }
  const leaveBtn = document.getElementById('br-leave');
  if (leaveBtn) {
    leaveBtn.onclick = async () => {
      try {
        await post(`/api/bracket/events/${id}/leave`, { personId: meId });
        toast('You left this night.');
        renderBrEvent(id);
      } catch (e) { toast(e.message); }
    };
  }
  app.querySelectorAll('button[data-br-pair]').forEach((b) => {
    b.onclick = async () => {
      const soloId = +b.dataset.brPair;
      if (!brPairFirst || brPairFirst.eventId !== id) {
        const solo = solos.find((s) => s.id === soloId);
        brPairFirst = { id: soloId, eventId: id, name: solo ? solo.name : '' };
        toast(`Picked ${brPairFirst.name || 'solo'} — now tap a second solo to pair them.`);
        renderBrEvent(id);
        return;
      }
      if (brPairFirst.id === soloId) { brPairFirst = null; renderBrEvent(id); return; }
      try {
        await post(`/api/admin/bracket/events/${id}/pair`, { soloIdA: brPairFirst.id, soloIdB: soloId });
        toast('Paired into a team.');
        brPairFirst = null;
        renderBrEvent(id);
      } catch (e) { toast(e.message); }
    };
  });
  const pubBtn = document.getElementById('br-publish');
  if (pubBtn) {
    pubBtn.onclick = async () => {
      try {
        await api(`/api/admin/bracket/events/${id}`, { method: 'PATCH', body: JSON.stringify({ published: !event.published }) });
        toast(event.published ? 'Night unpublished — sign-ups closed.' : 'Night published — members can join.');
        renderBrEvent(id);
      } catch (e) { toast(e.message); }
    };
  }
  const closeBtn = document.getElementById('br-close-signups');
  if (closeBtn) {
    closeBtn.onclick = async () => {
      try {
        await api(`/api/admin/bracket/events/${id}`, { method: 'PATCH', body: JSON.stringify({ published: false }) });
        toast('Sign-ups closed.');
        renderBrEvent(id);
      } catch (e) { toast(e.message); }
    };
  }
  if (!brScoreMatchId) {
    refreshTimer = setInterval(() => {
      // Don't wipe a join in progress — if the viewer is typing in the
      // join box, skip this refresh cycle.
      const ae = document.activeElement;
      if (ae && ae.closest && ae.closest('#br-join-box')) return;
      renderBrEvent(id);
    }, 30000);
  }
}

// Dedicated one-match score screen, mirroring the round robin flow:
// stacked names (with seed chips), plain score boxes, white card.
function renderBrScoreView(id, m, byId, num, title) {
  const t1 = byId.get(m.team1_id);
  const t2 = byId.get(m.team2_id);
  const teamLine = (t) => (t ? `<span class="br-seed">#${t.seed}</span>${esc(t.label)}` : '—');
  const scored = m.score1 != null;
  app.innerHTML = `
    <div class="match-card">
      <h3>Match ${num} · ${esc(title)} · Game ${m.game_no}</h3>
      <p class="muted">Games to ${m.target_score}</p>
      <div class="teams">${teamLine(t1)}</div>
      <div class="score-row">
        <input type="text" inputmode="numeric" id="br-s1" value="${scored ? m.score1 : ''}" placeholder="—" aria-label="Team 1 score">
      </div>
      <div class="vs" style="text-align:center">VS</div>
      <div class="teams">${teamLine(t2)}</div>
      <div class="score-row">
        <input type="text" inputmode="numeric" id="br-s2" value="${scored ? m.score2 : ''}" placeholder="—" aria-label="Team 2 score">
      </div>
      <div class="score-row">
        <button class="btn" id="br-svSave">Save score</button>
        ${scored ? `<button class="btn secondary small" id="br-svClear">Clear</button>` : ''}
        <button class="btn secondary" id="br-svBack">Back</button>
      </div>
    </div>`;
  document.getElementById('br-svBack').onclick = () => { brScoreMatchId = null; renderBrEvent(id); };
  document.getElementById('br-svSave').onclick = async () => {
    const s1 = document.getElementById('br-s1').value;
    const s2 = document.getElementById('br-s2').value;
    const n1 = s1 === '' ? null : +s1;
    const n2 = s2 === '' ? null : +s2;
    if (n1 == null || n2 == null) { toast('Enter both scores.'); return; }
    if (!Number.isInteger(n1) || !Number.isInteger(n2) || n1 < 0 || n2 < 0 || n1 > 30 || n2 > 30) { toast('Scores must be whole numbers from 0 to 30.'); return; }
    if (n1 === n2) { toast('Scores cannot tie.'); return; }
    if (Math.max(n1, n2) < m.target_score) { toast(`One side must reach ${m.target_score} (games to ${m.target_score}).`); return; }
    if (Math.max(n1, n2) > m.target_score) { toast(`First to ${m.target_score} — the game ends at ${m.target_score}.`); return; }
    try {
      await post(`/api/bracket/events/${id}/matches/${m.id}/score`, { score1: n1, score2: n2 });
      toast('Score saved.');
      brScoreMatchId = null;
      renderBrEvent(id);
    } catch (e) { toast(e.message); }
  };
  const clearBtn = document.getElementById('br-svClear');
  if (clearBtn) {
    clearBtn.onclick = async () => {
      try {
        await post(`/api/bracket/events/${id}/matches/${m.id}/score`, { score1: null, score2: null });
        toast('Score cleared.');
        brScoreMatchId = null;
        renderBrEvent(id);
      } catch (e) { toast(e.message); }
    };
  }
}

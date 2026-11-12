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
const JOIN_PAGE_URL = 'https://capable-blini-464d32.netlify.app';
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
let myLeaguesCache = null; // { personId, leagues }
async function myLeagues(personId) {
  if (myLeaguesCache && myLeaguesCache.personId === personId) return myLeaguesCache.leagues;
  const { leagues } = await api(`/api/people/${personId}/leagues`);
  myLeaguesCache = { personId, leagues };
  return leagues;
}
function personName(map, id) { return map.get(id) || '—'; }

// ---------- router ----------
let refreshTimer = null;
function route() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const h = raw.split('?')[0];
  const parts = h.split('/').filter(Boolean);
  if (parts[0] === 'admin') return renderAdmin();
  if (parts[0] === 'members') return renderMembersPage();
  if (parts[0] === 'join') return renderJoinPage(parts[1] ? +parts[1] : null);
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
    if (mine.length) return renderLanding(id, mine);
    return renderMembersPage(); // member, but in no league yet
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
        <div class="btnrow"><a class="btn secondary small" href="#/members">Open Members directory</a></div></div>`;
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

function leagueCardHtml(l) {
  return `
      <div class="card league-card">
        <span class="mark ${esc(l.logo_color)}"><img src="/mpa-logo.webp" alt="MPA"></span>
        <span class="info">
          <span class="name">${esc(l.name)}</span><br>
          <span class="sub">${esc(l.type)} · ${esc(l.skill)} · ${esc(l.format)}<br>
          ${esc(l.day)}s ${esc(l.time.slice(0, 5))} · ${l.player_count ?? ''} player(s)${l.season ? ` · ${esc(l.season)}` : ''}</span>
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
    const [{ leagues }, { members }] = await Promise.all([
      api('/api/leagues'),
      api('/api/members').catch(() => ({ members: [] })),
    ]);
    const mineIds = new Set(mine.map((l) => l.id));
    const mineFull = leagues.filter((l) => mineIds.has(l.id));
    const newSeasons = leagues.filter((l) => !mineIds.has(l.id));
    app.innerHTML = `
      <h1>Your league</h1>
      <p class="muted">Hi ${esc(first)} — here are the leagues you are part of.</p>
      <div class="stat-row">
        <span class="stat"><strong>${members.length}</strong> Members</span>
        <span class="stat"><strong>0</strong> Tournaments</span>
        <span class="stat"><strong>${leagues.length}</strong> Leagues</span>
        <span class="stat"><strong>0</strong> Team Leagues</span>
      </div>
      <div id="myLeagueCards">${mineFull.map(leagueCardHtml).join('') || '<p class="muted">You are not in a league yet.</p>'}</div>
      ${newSeasons.length ? `<h2>A new season is open</h2>
        ${newSeasons.map((l) => `<div class="card new-season">
          <strong>${esc(l.name)}</strong><br>
          <span class="muted small">${esc(l.type)} · ${esc(l.skill)} · ${esc(l.format)} · ${esc(l.day)}s ${esc(l.time.slice(0, 5))} · ${esc(l.season || 'Season not set')}</span>
          <div class="btnrow"><a class="btn green small" href="#/join/${l.id}">Join this league</a></div>
        </div>`).join('')}` : ''}
      <div class="btnrow"><a class="btn secondary" href="#/members">Members</a><a class="btn secondary" href="#/myleagues">My Leagues</a></div>`;
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
      <div class="fp">${p.dupr_id ? `DUPR ${esc(p.dupr_id)} · ${p.dupr_rating ?? ''}` : 'No DUPR on file'}</div></span></div>`).join('');
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
      <p class="muted small">A DUPR account is required to be part of MPA. It is free.</p>
      <div class="btnrow">
        <a class="btn small" href="${DUPR_SIGNUP_URL}" target="_blank" rel="noopener">Create a DUPR account</a>
        <button class="btn secondary small" id="haveDupr">I have a DUPR account</button>
      </div>
    </div>
    <div class="card step ${steps.member ? 'done' : ''}">
      <h3>${check('member')}Step 2 — Become a free MPA member</h3>
      <p class="muted small">Free and unlimited. You will need your DUPR ID and doubles rating.</p>
      <div class="btnrow"><button class="btn small" id="showMemberForm">Become a Member</button></div>
      <div id="memberFormSlot"></div>
      <p class="muted small">Already a member? <button class="linkbtn" id="showFindMe">I'm already a member — find my name</button></p>
      <div id="findMeSlot"></div>
    </div>
    <div class="card step ${steps.joined ? 'done' : ''}">
      <h3>${check('joined')}Step 3 — Join the league</h3>
      <p class="muted small">Pick a league and sign up. Joining costs $20 (YMCA member) / $50 (non-member), paid on ReClique.</p>
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
        <div class="fp">${m.dupr_id ? `DUPR ${esc(m.dupr_id)} · ${m.dupr_rating ?? ''}` : ''}</div></span></div>`).join('');
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
    slot.innerHTML = `<select id="joinPickLeague">${leagues.map((l) => `<option value="${l.id}">${esc(l.name)} — ${esc(l.day)}s ${esc(l.time.slice(0, 5))}</option>`).join('')}</select>
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
function memberTileHtml(m) {
  const initial = (m.name[0] || '?').toUpperCase();
  const nameInner = m.dupr_profile_url
    ? `<a href="${esc(m.dupr_profile_url)}" target="_blank" rel="noopener">${esc(m.name)}</a>`
    : esc(m.name);
  const meta = [m.resides, m.age ? `Age ${m.age}` : null, m.country].filter(Boolean).join(' · ');
  return `<div class="member-tile">
    ${m.photo_url ? `<img class="photo" src="${esc(m.photo_url)}" alt="">` : `<span class="avatar big">${initial}</span>`}
    <span class="info"><span class="nm">${nameInner}</span><br>
    <span class="sub">${m.dupr_id ? `DUPR ${esc(m.dupr_id)} · Rating ${m.dupr_rating ?? '—'}` : 'No DUPR on file'}</span>
    ${meta ? `<br><span class="sub">${esc(meta)}</span>` : ''}
    ${m.leagues && m.leagues.length ? `<br><span class="badge done">${m.leagues.map(esc).join(', ')}</span>` : '<br><span class="badge">Member</span>'}
    </span>
  </div>`;
}

async function renderMembersDirectory(container) {
  container.innerHTML = `<div class="searchrow"><input type="text" id="memSearch" placeholder="Search members…" autocomplete="off"></div>
    <div id="memTiles"><p class="muted">Loading members…</p></div>`;
  const { members } = await api('/api/members').catch(() => ({ members: [] }));
  const draw = (q) => {
    const list = members.filter((m) => !q || m.name.toLowerCase().includes(q));
    document.getElementById('memTiles').innerHTML = list.map(memberTileHtml).join('') || '<p class="muted">No members yet.</p>';
  };
  draw('');
  document.getElementById('memSearch').addEventListener('input', (e) => draw(e.target.value.toLowerCase()));
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
      <div class="field-row">
        <div><label>DUPR ID</label><input type="text" id="mf-dupr"></div>
        <div><label>DUPR doubles rating</label><input type="number" step="0.001" id="mf-rating" placeholder="e.g. 3.643"></div>
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
      <p class="fineprint">A DUPR account is required to be part of MPA. <a href="${DUPR_SIGNUP_URL}" target="_blank" rel="noopener">Create one free</a>. Your email and phone are only visible to the admin, never on public pages.</p>
      <div class="btnrow"><button class="btn" id="mf-submit">Become a Member</button></div>
      <p class="fineprint" id="mf-err"></p>
    </div>`;
  document.getElementById('mf-submit').onclick = async () => {
    const err = document.getElementById('mf-err');
    try {
      const { member } = await api('/api/members', {
        method: 'POST',
        body: JSON.stringify({
          name: document.getElementById('mf-name').value.trim(),
          email: document.getElementById('mf-email').value.trim(),
          phone: document.getElementById('mf-phone').value.trim(),
          duprId: document.getElementById('mf-dupr').value.trim(),
          duprRating: document.getElementById('mf-rating').value ? +document.getElementById('mf-rating').value : null,
          duprProfileUrl: document.getElementById('mf-profile').value.trim() || null,
          resides: document.getElementById('mf-resides').value.trim() || null,
          age: document.getElementById('mf-age').value ? +document.getElementById('mf-age').value : null,
          country: document.getElementById('mf-country').value.trim() || null,
          photoUrl: document.getElementById('mf-photo').value.trim() || null,
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
    app.innerHTML = `
      <p><a href="#/">${id ? '← Your leagues' : '← All leagues'}</a></p>
      <h1>${esc(league.name)}</h1>
      <p class="muted">${esc(league.type)} · ${esc(league.skill)} · ${esc(league.format)} · ${esc(league.day)}s ${esc(league.time.slice(0, 5))}<br>
      <a href="#" data-map="place" data-map-kind="place">${esc(league.location)}</a></p>
      ${registrationOpen
        ? `<div class="card reg-open"><strong>✓ Registration Open — Join the League</strong><br>
           <span class="muted small">Joining costs $20 (YMCA member) / $50 (non-member), paid on ReClique.</span><br>
           <div class="btnrow"><a class="btn green" href="#/join/${league.id}">Join the League</a></div></div>`
        : `<div class="card reg-closed"><strong>🔒 Registration Closed</strong><br>
           <span class="muted small">Sign-ups for this league are closed right now.</span></div>`}
      ${currentSessionId ? `<div class="btnrow"><a class="btn" href="#/league/${league.id}/game/${currentSessionId}">Current Game Day</a>
        <button class="btn secondary" id="allDaysBtn">All Game Days</button></div>` : ''}
      <div class="tabs" role="tablist">
        <button data-tab="standings" class="${leagueTab === 'standings' ? 'active' : ''}">Standings</button>
        <button data-tab="schedule" class="${leagueTab === 'schedule' ? 'active' : ''}">Schedule</button>
        <button data-tab="info" class="${leagueTab === 'info' ? 'active' : ''}">Info</button>
      </div>
      <div id="tabBody"><p class="muted">Loading…</p></div>`;
    document.getElementById('allDaysBtn')?.addEventListener('click', () => openAllDays(league, sessions));
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
      Y marks a player who moved the maximum in either direction, or did not play that week.
      Absent players cannot move up.<br>
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
      <p><strong>Day/Time:</strong> ${esc(league.day)}s at ${esc(league.time.slice(0, 5))}</p>
      <p><strong>Season:</strong> ${esc(league.season || 'Not set')} · ${fmtDateShort(league.start_date)} – ${fmtDateShort(league.stop_date)}</p>
      <p><strong>Skill:</strong> ${esc(league.skill)} · <strong>Age:</strong> Any</p>
      <p><strong>Description:</strong> A ladder scramble league at the YMCA in Moultrie, GA. Courts are assigned by standings; players stay on the same court for the whole session.</p>
      <p><strong>Weather Policy:</strong> Play is outdoors on lighted courts. The organizer will announce any weather delay or cancellation.</p>
      <p><strong>Refund Policy:</strong> League fees are handled through the YMCA (ReClique). Contact the league organizer about refunds.</p>
    </div>
    <div class="card"><h2>Membership &amp; Participation</h2>
      <p>Membership in the Moultrie Pickleball Association is free and requires a DUPR account. Falsifying a DUPR rating, unsportsmanlike conduct, or non-payment of league fees may result in removal from the league.</p>
    </div>
    <div class="card"><h2>Session Details</h2>
      <p>Skill: ${esc(league.skill)} · Age: Any · Max Players Per Session: ${league.max_players} · Max Movement Rule: 0.20 · 1st Choice Group Size: 6 · 2nd Choice Group Size: 5</p>
    </div>
    <div class="card"><h2>Signup / Payment Type</h2>
      <p>Closed League. Registration is currently <strong>${registrationOpen === false ? 'Closed' : 'Open'}</strong>. Joining costs $20 (YMCA member) / $50 (non-member), paid on ReClique.
      <a href="${RECLIQUE_URL}" target="_blank" rel="noopener">Pay on ReClique</a></p>
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
      b.onclick = () => { gdTab = b.dataset.tab; renderGameDay(leagueId, sessionId); };
    });
    if (gdTab === 'rsvps') renderRsvps(leagueId, sessionId, data, id);
    if (gdTab === 'groups') renderGroups(data, id);
    if (gdTab === 'matches') renderMatches(leagueId, sessionId, data, id);
    // Refresh quietly, but never while the player is typing a score.
    refreshTimer = setInterval(() => {
      const ae = document.activeElement;
      if (ae && ae.tagName === 'INPUT') return;
      if (modalRoot.innerHTML) return;
      renderGameDay(leagueId, sessionId);
    }, 30000);
  } catch (e) {
    clearInterval(refreshTimer);
    app.innerHTML = `<div class="banner warn">${esc(e.message)}</div><p><a href="#/league/${leagueId}">&larr; Back to league</a></p>`;
  }
}

function renderRsvps(leagueId, sessionId, data, id) {
  const body = document.getElementById('gdBody');
  const { counts, playing, notPlaying } = data;
  const total = counts.total || 0;
  const pct = total ? Math.round((counts.playing / total) * 100) : 0;
  const circ = 2 * Math.PI * 34;
  const rowHtml = (p, isPlaying) => {
    const isMe = id && id.personId === p.person_id;
    const fp = isPlaying && p.opted_in_at
      ? `<div class="fp">Opted in ${new Date(p.opted_in_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>` : '';
    const btn = isMe
      ? (isPlaying
        ? `<button class="btn secondary small" data-act="out" data-pid="${p.person_id}">Opt out</button>`
        : `<button class="btn green small" data-act="in" data-pid="${p.person_id}">Opt in</button>`)
      : '';
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
      try {
        if (b.dataset.act === 'in') await post(`/api/leagues/${leagueId}/sessions/${sessionId}/opt-in`, { personId: pid });
        else await post(`/api/leagues/${leagueId}/sessions/${sessionId}/opt-out`, { personId: pid });
        toast(b.dataset.act === 'in' ? 'Opted in — you are checked in.' : 'Opted out.');
        renderGameDay(leagueId, sessionId);
      } catch (e) { toast(e.message); }
    };
  });
}

function renderGroups(data, id) {
  const body = document.getElementById('gdBody');
  const { groups, window: win, isAdmin } = data;
  if (!win.isRevealed) {
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
  if (!win.isRevealed) {
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
  const byes = matches.filter((m) => m.kind === 'bye');
  const games = matches.filter((m) => m.kind === 'match');
  body.innerHTML = `
    ${games.map((m) => {
      const t1 = `${esc(personName(rosterMap, m.team1_p1))} & ${esc(personName(rosterMap, m.team1_p2))}`;
      const t2 = `${esc(personName(rosterMap, m.team2_p1))} & ${esc(personName(rosterMap, m.team2_p2))}`;
      const scored = m.score1 != null;
      return `<div class="match-card">
        <div class="teams">Court ${m.court} · Round ${m.round}<br>${t1} <span class="vs">vs</span> ${t2}</div>
        ${finished
          ? `<p>${scored ? `${m.score1} – ${m.score2}` : 'Not scored'}</p>`
          : `<div class="score-row">
              <input type="number" min="0" max="30" inputmode="numeric" id="s1-${m.id}" value="${scored ? m.score1 : ''}" placeholder="—" aria-label="Team 1 score">
              <span>–</span>
              <input type="number" min="0" max="30" inputmode="numeric" id="s2-${m.id}" value="${scored ? m.score2 : ''}" placeholder="—" aria-label="Team 2 score">
              <span class="target">to ${m.target_score}</span>
              <button class="btn small" data-save="${m.id}">Save</button>
              ${scored ? `<button class="btn secondary small" data-clear="${m.id}">Clear</button>` : ''}
            </div>`}
      </div>`;
    }).join('')}
    ${byes.map((m) => `<div class="bye-row">Court ${m.court} · Round ${m.round} — ${esc(personName(rosterMap, m.bye_person_id))} sits out (BYE)</div>`).join('')}`;
  body.querySelectorAll('button[data-save]').forEach((b) => {
    b.onclick = async () => {
      const mid = b.dataset.save;
      const s1 = document.getElementById(`s1-${mid}`).value;
      const s2 = document.getElementById(`s2-${mid}`).value;
      try {
        await post(`/api/leagues/${leagueId}/sessions/${sessionId}/matches/${mid}/score`, {
          personId: id ? id.personId : null,
          score1: s1 === '' ? null : +s1,
          score2: s2 === '' ? null : +s2,
        });
        toast('Score saved.');
        renderGameDay(leagueId, sessionId);
      } catch (e) { toast(e.message); }
    };
  });
  body.querySelectorAll('button[data-clear]').forEach((b) => {
    b.onclick = async () => {
      try {
        await post(`/api/leagues/${leagueId}/sessions/${sessionId}/matches/${b.dataset.clear}/score`, {
          personId: id ? id.personId : null, score1: null, score2: null,
        });
        toast('Score cleared.');
        renderGameDay(leagueId, sessionId);
      } catch (e) { toast(e.message); }
    };
  });
}

// ---------- admin ----------
let adminLeagueId = null;
let adminSections = {};
async function renderAdmin() {
  clearInterval(refreshTimer);
  const me = await api('/api/admin/me').catch(() => ({ admin: false, passcodeConfigured: false }));
  if (!me.admin) {
    app.innerHTML = `
      <h1>Admin</h1>
      <p class="muted">ADMIN ONLY — enter the Admin passcode.</p>
      ${me.passcodeConfigured ? '' : '<div class="banner warn">No Admin passcode is configured on this server yet. Set ADMIN_PASSCODE in the environment.</div>'}
      <div class="card">
        <label>Admin passcode</label>
        <input type="password" id="passcode" autocomplete="current-password" placeholder="Passcode">
        <div class="btnrow"><button class="btn" id="loginBtn">Sign in</button></div>
        <p class="fineprint" id="loginErr"></p>
      </div>`;
    document.getElementById('loginBtn').onclick = async () => {
      const passcode = document.getElementById('passcode').value;
      try {
        await post('/api/admin/login', { passcode });
        toast('Signed in as Admin.');
        renderAdmin();
      } catch (e) {
        document.getElementById('loginErr').textContent = e.message;
      }
    };
    document.getElementById('passcode').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('loginBtn').click();
    });
    return;
  }

  const { leagues } = await api('/api/leagues');
  if (!adminLeagueId && leagues.length) adminLeagueId = leagues[0].id;
  const league = leagues.find((l) => l.id === adminLeagueId);
  app.innerHTML = `
    <h1>Admin</h1><p class="muted">ADMIN ONLY</p>
    <div class="btnrow"><button class="btn secondary small" id="logoutBtn">Sign out</button></div>
    <div class="league-tabs">
      ${leagues.map((l) => `<button data-lid="${l.id}" class="${l.id === adminLeagueId ? 'active' : ''}">${esc(l.name)}</button>`).join('')}
    </div>
    <div id="adminBody"></div>`;
  document.getElementById('logoutBtn').onclick = async () => {
    await post('/api/admin/logout', {});
    renderAdmin();
  };
  app.querySelectorAll('.league-tabs button').forEach((b) => {
    b.onclick = () => { adminLeagueId = +b.dataset.lid; renderAdmin(); };
  });
  renderAdminBody(leagues, league);
}

function section(key, title, desc, innerHtml) {
  const open = !!adminSections[key];
  return `<div class="admin-section">
    <button class="head" data-sec="${key}">
      <span><span class="t">${title}</span><br><span class="d">${desc}</span></span>
      <span class="chev">${open ? '▾' : '▸'}</span>
    </button>
    ${open ? `<div class="body">${innerHtml}</div>` : ''}
  </div>`;
}

async function renderAdminBody(leagues, league) {
  const body = document.getElementById('adminBody');

  // ---- logo color for the current league ----
  let logoHtml = '';
  if (league) {
    logoHtml = `<div class="card"><strong>Logo color for ${esc(league.name)}:</strong>
      <div class="swatches" id="lg-swatches">
        <button data-c="black-yellow" class="${league.logo_color === 'black-yellow' ? 'sel' : ''}" style="background:#141414" title="Black & yellow"></button>
        <button data-c="pink" class="${league.logo_color === 'pink' ? 'sel' : ''}" style="background:#f7c6dd" title="Pink"></button>
        <button data-c="blue" class="${league.logo_color === 'blue' ? 'sel' : ''}" style="background:#bcd6f7" title="Blue"></button>
        <button data-c="green" class="${league.logo_color === 'green' ? 'sel' : ''}" style="background:#bfe3c0" title="Green"></button>
      </div>
      <span class="fineprint" id="lg-msg"></span></div>`;
  }

  // ---- create a league (with per-week date editing) ----
  const createHtml = `
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
      <div><label>Logo color</label><div class="swatches" id="cl-swatches">
        <button data-c="black-yellow" class="sel" style="background:#141414" title="Black & yellow"></button>
        <button data-c="pink" style="background:#f7c6dd" title="Pink"></button>
        <button data-c="blue" style="background:#bcd6f7" title="Blue"></button>
        <button data-c="green" style="background:#bfe3c0" title="Green"></button>
      </div></div>
    </div>
    <div class="field-row">
      <div><label>Day</label><select id="cl-day">
        <option>Monday</option><option>Tuesday</option><option>Wednesday</option><option>Thursday</option><option>Friday</option><option selected>Saturday</option><option>Sunday</option>
      </select></div>
      <div><label>Time</label><select id="cl-time">
        <option>08:30</option><option>09:00</option><option>17:00</option><option selected>18:30</option><option>19:00</option>
      </select></div>
    </div>
    <div class="field-row">
      <div><label>Season start</label><input type="date" id="cl-start"></div>
      <div><label>Season stop</label><input type="date" id="cl-stop"></div>
    </div>
    <div class="field-row">
      <div><label>Season</label><select id="cl-season"><option value="">Not set</option><option>Winter 2026</option><option>Spring 2027</option><option>Summer 2027</option><option>Fall 2027</option></select></div>
      <div><label>Max players</label><input type="number" id="cl-max" value="36" min="4" max="36"></div>
    </div>
    <div class="btnrow"><button class="btn secondary small" id="cl-gen-dates">Generate the 8 weekly dates</button></div>
    <div id="cl-dates"><p class="fineprint">Pick the start date and day above, then generate the 8 weekly game days. Each week's date can be edited — move a week that falls on a holiday or during school vacation.</p></div>
    <div class="btnrow"><button class="btn" id="cl-create">Create league</button></div>
    <p class="fineprint" id="cl-err"></p>`;

  // ---- per-league data for the sections below ----
  let regHtml = '<p class="muted">Pick a league above.</p>';
  let regsHtml = '<p class="muted">Pick a league above.</p>';
  let membersHtml = '<p class="muted">Pick a league above.</p>';
  let playersHtml = '<p class="muted">Pick a league above.</p>';
  let penaltiesHtml = '<p class="muted">Pick a league above.</p>';
  let toolsHtml = '<p class="muted">Pick a league above.</p>';
  if (league) {
    const l = await api(`/api/leagues/${league.id}`);
    regHtml = `
      <p>Registration for <strong>${esc(league.name)}</strong> is currently <strong>${l.registrationOpen ? 'Open' : 'Closed'}</strong>.</p>
      <p class="fineprint">Open: the home panel shows a green "Registration Open — Join the League" button. Closed: it shows a grey locked "Registration Closed" button. The Info tab wording follows this switch.</p>
      <div class="btnrow"><button class="btn" id="rg-toggle">${l.registrationOpen ? 'Close registration' : 'Open registration'}</button></div>`;

    const { registrations } = await api(`/api/admin/leagues/${league.id}/registrations`);
    regsHtml = registrations.map((r) => `
      <div class="person-row"><span class="who"><span class="nm">${esc(r.name)}</span>
        <div class="fp">DUPR ${esc(r.dupr_id || '—')} · ${r.dupr_rating ?? ''} · ${r.membership_type === 'member' ? 'YMCA member $20' : 'Non-member $50'} · ${r.status}${r.fee_waived ? ' · <span class="fee-waived">Fee waived</span>' : ''}</div>
        <div class="fp">${esc(r.email || '')}${r.email && r.phone ? ' · ' : ''}${esc(r.phone || '')}</div></span>
        <span class="rowbtns">
          ${r.status === 'pending' ? `<button class="btn small" data-reg-confirm="${r.id}">Confirm</button>` : ''}
          ${r.status !== 'added' ? `<button class="btn green small" data-reg-add="${r.id}">Add to league</button>` : ''}
          <button class="btn secondary small" data-reg-waive="${r.id}" data-waived="${r.fee_waived ? 1 : 0}">${r.fee_waived ? 'Undo fee waiver' : 'Waive fee'}</button>
          <button class="btn secondary small" data-reg-del="${r.id}">Delete</button>
        </span></div>`).join('') || '<p class="muted">No sign-ups for this league yet.</p>';
    regsHtml += `<p class="fineprint">Confirm moves a sign-up to confirmed; "Add to league" puts the person on the roster (carrying any fee waiver with them). Waiving a fee hides the ReClique Pay button for that person. Nothing here charges anyone — payment happens on ReClique.</p>`;

    const { members } = await api('/api/admin/members');
    membersHtml = members.map((m) => `
      <div class="person-row" data-mid="${m.id}"><span class="who"><span class="nm">${esc(m.name)}</span>
        <div class="fp">DUPR ${esc(m.dupr_id || '—')} · ${m.dupr_rating ?? ''}${m.leagues && m.leagues.length ? ` · Leagues: ${m.leagues.map(esc).join(', ')}` : ''}</div>
        <div class="fp">${esc(m.email || '')}${m.email && m.phone ? ' · ' : ''}${esc(m.phone || '')} · joined ${fmtDateShort(m.joined_at)}</div></span>
        <span class="rowbtns">
          <button class="btn secondary small" data-mem-edit="${m.id}">Edit</button>
          <button class="btn secondary small" data-mem-del="${m.id}">Remove</button>
        </span></div>
      <div class="edit-slot" id="mem-edit-${m.id}"></div>`).join('') || '<p class="muted">No free members yet.</p>';

    const { roster } = await api(`/api/leagues/${league.id}/roster`);
    playersHtml = `
      <label>Add a player</label>
      <input type="text" id="ap-name" placeholder="Full name" autocomplete="off">
      <div id="ap-suggest"></div>
      <div class="field-row">
        <div><label>DUPR ID</label><input type="text" id="ap-dupr"></div>
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

    toolsHtml = `
      <label>Game day</label>
      <select id="gt-session">${l.sessions.map((s) => `<option value="${s.id}">Session ${s.session_number} — ${fmtDateShort(s.starts_at)} (${s.status})</option>`).join('')}</select>
      <div class="btnrow">
        <button class="btn" id="gt-build">Build / Rebuild schedule</button>
        <button class="btn green" id="gt-finish">Finish game day</button>
        <button class="btn secondary" id="gt-view">View as Organizer</button>
        <button class="btn secondary" id="gt-sheet">Print Court Sheet</button>
        <button class="btn secondary" id="gt-alldays">All Game Days</button>
      </div>
      <p class="fineprint" id="gt-msg"></p>
      <p class="fineprint">Finish asks "finish anyway?" if games are unscored. Rebuilding keeps scores where the same four players stay together. The Court Sheet lists each court with its players and a check-off box by every name — print it before the night.</p>`;
  }

  const announceHtml = `
    <label>League</label>
    <select id="an-league">${leagues.map((l) => `<option value="${l.id}" ${league && l.id === league.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
    <div class="btnrow"><button class="btn" id="an-gen">Write the announcement</button></div>
    <div id="an-out"><p class="fineprint">Picks the league and writes an advertising email and a shorter text version from that league's saved record. Nothing is sent by the app — copy the drafts and send them from your own email or phone.</p></div>`;

  body.innerHTML = logoHtml +
    section('create', 'Create a league', 'Make a new league: name, type, skill, format, day, time, and season dates.', createHtml) +
    section('registration', 'Registration', 'Open or close league sign-ups.', regHtml) +
    section('registrations', 'Registrations', 'People who signed up: confirm them, waive a fee, or add them to a league.', regsHtml) +
    section('members', 'Members', 'Free MPA member directory, with DUPR ratings and an Edit button per member.', membersHtml) +
    section('players', 'Players', 'The league roster: add, edit, or remove players.', playersHtml) +
    section('penalties', 'Standings penalties', 'Miss penalties and Admin adjustments per player.', penaltiesHtml) +
    section('tools', 'Game day tools', 'Finish a game day, build the schedule, and print the court sheet.', toolsHtml) +
    section('announce', 'Announce this league', 'Writes the email and text announcement for a league, with copy buttons.', announceHtml);

  body.querySelectorAll('.admin-section > button.head').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.sec;
      adminSections[k] = !adminSections[k];
      renderAdminBody(leagues, league);
    };
  });

  // ---- logo color edit ----
  let logoColor = league ? league.logo_color : 'black-yellow';
  body.querySelectorAll('#lg-swatches button').forEach((b) => {
    b.onclick = async () => {
      logoColor = b.dataset.c;
      body.querySelectorAll('#lg-swatches button').forEach((x) => x.classList.toggle('sel', x === b));
      try {
        await api(`/api/admin/leagues/${league.id}`, { method: 'PATCH', body: JSON.stringify({ logoColor }) });
        document.getElementById('lg-msg').textContent = 'Logo color saved.';
      } catch (e) { document.getElementById('lg-msg').textContent = e.message; }
    };
  });

  // ---- create a league ----
  let clColor = 'black-yellow';
  body.querySelectorAll('#cl-swatches button').forEach((b) => {
    b.onclick = () => {
      clColor = b.dataset.c;
      body.querySelectorAll('#cl-swatches button').forEach((x) => x.classList.toggle('sel', x === b));
    };
  });
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
          logoColor: clColor,
        };
        if (dateInputs.length) payload.gameDates = dateInputs;
        const { league: created } = await api('/api/admin/leagues', { method: 'POST', body: JSON.stringify(payload) });
        toast(`League "${created.name}" created with 8 game days.`);
        adminLeagueId = created.id;
        renderAdmin();
      } catch (e) { err.textContent = e.message; }
    };
  }

  if (!league) return;

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
        <div class="field-row">
          <div><label>Email</label><input type="text" id="me-email" value="${v(m.email)}"></div>
          <div><label>Phone</label><input type="text" id="me-phone" value="${v(m.phone)}"></div>
        </div>
        <div class="field-row">
          <div><label>DUPR ID</label><input type="text" id="me-dupr" value="${v(m.dupr_id)}"></div>
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
        <div class="btnrow"><button class="btn small" id="me-save">Save member</button></div>
        <p class="fineprint" id="me-err"></p></div>`;
      document.getElementById('me-save').onclick = async () => {
        const err = document.getElementById('me-err');
        try {
          await api(`/api/admin/members/${m.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              email: document.getElementById('me-email').value.trim() || null,
              phone: document.getElementById('me-phone').value.trim() || null,
              duprId: document.getElementById('me-dupr').value.trim() || null,
              duprRating: document.getElementById('me-rating').value ? +document.getElementById('me-rating').value : null,
              duprProfileUrl: document.getElementById('me-profile').value.trim() || null,
              resides: document.getElementById('me-resides').value.trim() || null,
              age: document.getElementById('me-age').value ? +document.getElementById('me-age').value : null,
              country: document.getElementById('me-country').value.trim() || null,
              photoUrl: document.getElementById('me-photo').value.trim() || null,
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
          <span class="sub">${r.dupr_id ? `DUPR ${esc(r.dupr_id)} · ${r.dupr_rating ?? ''}` : ''}</span>
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
      try {
        const payload = pickedPersonId
          ? { personId: pickedPersonId }
          : {
              name: document.getElementById('ap-name').value.trim(),
              duprId: document.getElementById('ap-dupr').value.trim() || null,
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
          <div><label>DUPR ID</label><input type="text" id="pe-dupr" value="${v(p.dupr_id)}"></div>
          <div><label>DUPR doubles rating</label><input type="number" step="0.001" id="pe-rating" value="${p.dupr_rating ?? ''}"></div>
        </div>
        <label>DUPR profile link</label><input type="text" id="pe-profile" value="${v(p.dupr_profile_url)}" placeholder="https://…">
        <div class="btnrow"><button class="btn small" id="pe-save">Save DUPR</button></div>
        <p class="fineprint" id="pe-err"></p></div>`;
      document.getElementById('pe-save').onclick = async () => {
        const err = document.getElementById('pe-err');
        try {
          await api(`/api/admin/leagues/${league.id}/players/${p.person_id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              duprId: document.getElementById('pe-dupr').value.trim() || null,
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
  }

  // ---- announce ----
  const anGen = document.getElementById('an-gen');
  if (anGen) {
    anGen.onclick = async () => {
      const out = document.getElementById('an-out');
      const lid = +document.getElementById('an-league').value;
      try {
        const data = await api(`/api/admin/leagues/${lid}/announce`);
        out.innerHTML = announceHtml(data);
        wireAnnounceCopy(data);
      } catch (e) { out.innerHTML = `<div class="banner warn">${esc(e.message)}</div>`; }
    };
  }
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
    `${league.day}s at ${league.time.slice(0, 5)} · Season ${league.season || 'not set'} · ${fmtDateShort(league.start_date)} – ${fmtDateShort(league.stop_date)}`,
    `At the YMCA, 601 26th Ave SE, Moultrie, GA 31768`,
    ``,
    `Game days:`,
    ...dayLines.map((d) => `• ${d} at ${league.time.slice(0, 5)}`),
    ``,
    `Joining costs $20 (YMCA member) / $50 (non-member), paid on ReClique: ${RECLIQUE_URL}`,
    ``,
    `Three steps to join:`,
    `1. Get a free DUPR account: ${DUPR_SIGNUP_URL}`,
    `2. Become a free MPA member`,
    `3. Join the league — sign up here: ${JOIN_PAGE_URL}`,
    ``,
    `Moultrie Pickleball Association`,
  ].join('\n');
  const emailBodyHtml = [
    `<p><strong>A new MPA league is open: ${esc(league.name)}</strong></p>`,
    `<p>${esc(league.type)} · Skill ${esc(league.skill)} · ${esc(league.format)}<br>${esc(league.day)}s at ${esc(league.time.slice(0, 5))} · Season ${esc(league.season || 'not set')} · ${fmtDateShort(league.start_date)} – ${fmtDateShort(league.stop_date)}<br>At the YMCA, 601 26th Ave SE, Moultrie, GA 31768</p>`,
    `<p><strong>Game days:</strong><br>${dayLines.map((d) => `• ${esc(d)} at ${esc(league.time.slice(0, 5))}`).join('<br>')}</p>`,
    `<p>Joining costs $20 (YMCA member) / $50 (non-member), paid on ReClique: <a href="${RECLIQUE_URL}">${RECLIQUE_URL}</a></p>`,
    `<p><strong>Three steps to join:</strong><br>1. Get a free DUPR account: <a href="${DUPR_SIGNUP_URL}">${DUPR_SIGNUP_URL}</a><br>2. Become a free MPA member<br>3. Join the league — sign up here: <a href="${JOIN_PAGE_URL}">${JOIN_PAGE_URL}</a></p>`,
    `<p>Moultrie Pickleball Association</p>`,
  ].join('');
  const textDraft = [
    `New MPA league: ${league.name} — ${league.format}, ${league.day}s ${league.time.slice(0, 5)} at the YMCA in Moultrie.`,
    `Starts ${fmtDateShort(league.start_date)}, 8 weeks. $20 member / $50 non-member.`,
    `Sign up (about 2 minutes): ${JOIN_PAGE_URL}`,
    `Need a DUPR account first (free): ${DUPR_SIGNUP_URL}`,
    `— Moultrie Pickleball Association`,
  ].join('\n');
  const emails = members.filter((m) => m.email).map((m) => m.email).join(', ');
  const phones = members.filter((m) => m.phone).map((m) => m.phone).join(', ');
  return `
    <div class="card"><h3>Email draft</h3>
      <label>Subject</label><input type="text" id="an-subject" value="${esc(subject)}" readonly>
      <div class="btnrow"><button class="btn secondary small" id="an-copy-subject">Copy subject</button>
      <button class="btn small" id="an-copy-email">Copy email</button></div>
      <div class="draft" id="an-email-body">${emailBodyHtml}</div>
      <p class="fineprint">Copy keeps the links clickable when pasted into email.</p>
    </div>
    <div class="card"><h3>Text message draft</h3>
      <pre class="draft-text" id="an-text-body">${esc(textDraft)}</pre>
      <div class="btnrow"><button class="btn small" id="an-copy-text">Copy text</button></div>
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
      const [{ leagues }, mine] = await Promise.all([
        api('/api/leagues'),
        myLeagues(id.personId),
      ]);
      const mineIds = new Set(mine.map((l) => l.id));
      const open = leagues.filter((l) => !mineIds.has(l.id));
      const slot = document.getElementById('newSeasonSlot');
      if (slot && open.length) {
        slot.innerHTML = `<h2>A new season is open</h2>` + open.map((l) => `<div class="card new-season">
          <strong>${esc(l.name)}</strong><br>
          <span class="muted small">${esc(l.type)} · ${esc(l.skill)} · ${esc(l.format)} · ${esc(l.day)}s ${esc(l.time.slice(0, 5))} · ${esc(l.season || 'Season not set')}</span>
          <div class="btnrow"><a class="btn green small" href="#/join/${l.id}">Join this league</a></div>
        </div>`).join('');
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
    app.innerHTML = `
      <p><a href="#/">&larr; Back</a></p>
      <h1>Join the League</h1>
      ${memberBanner}
      ${!detail.registrationOpen ? `<div class="card reg-closed"><strong>🔒 Registration Closed</strong><br>
        <span class="muted small">Sign-ups for ${esc(league.name)} are closed right now.</span></div>` : `
      <label>League</label>
      <select id="j-league">${leagues.map((l) => `<option value="${l.id}" ${l.id === league.id ? 'selected' : ''}>${esc(l.name)} — ${esc(l.day)}s ${esc(l.time.slice(0, 5))}</option>`).join('')}</select>
      <div id="j-step1" class="card" style="${step1Done ? 'display:none' : ''}">
        <h3>Step 1 — Your DUPR</h3>
        <p class="muted small">A DUPR account is required to be part of MPA. <a href="${DUPR_SIGNUP_URL}" target="_blank" rel="noopener">Create one free</a>.</p>
        <label>DUPR ID</label><input type="text" id="j-dupr" value="${step1Done ? esc(prefill.person.dupr_id) : ''}">
        <label>DUPR doubles rating</label><input type="number" step="0.001" id="j-rating" value="${step1Done && prefill.person.dupr_rating != null ? prefill.person.dupr_rating : ''}" placeholder="e.g. 3.643">
        <div class="btnrow"><button class="btn" id="j-to2">Continue</button></div>
        <p class="fineprint" id="j-err1"></p>
      </div>
      <div id="j-step2" class="card" style="${step1Done ? '' : 'display:none'}">
        <h3>Step 2 — Your details</h3>
        <label>Full name</label><input type="text" id="j-name" value="${prefill ? esc(prefill.person.name) : ''}">
        <div class="field-row">
          <div><label>Email</label><input type="text" id="j-email" value="${prefill && prefill.member ? esc(prefill.member.email || '') : ''}"></div>
          <div><label>Phone</label><input type="text" id="j-phone" value="${prefill && prefill.member ? esc(prefill.member.phone || '') : ''}"></div>
        </div>
        <label>YMCA membership</label>
        <label class="radio"><input type="radio" name="j-mtype" value="member" checked> YMCA member — $20</label><br>
        <label class="radio"><input type="radio" name="j-mtype" value="non-member"> Non-member — $50</label>
        <p class="fineprint">Fees are paid on ReClique after you sign up. Nothing is charged here.</p>
        <div class="btnrow"><button class="btn green" id="j-submit">Sign up</button></div>
        <p class="fineprint" id="j-err2"></p>
      </div>
      <div id="j-done"></div>`}
      <p class="muted small">A new season reaches existing members as a join card — signing up again never repeats the DUPR and member steps.</p>`;
    if (!detail.registrationOpen) return;
    document.getElementById('j-league').onchange = (e) => { location.hash = `#/join/${e.target.value}`; };
    document.getElementById('j-to2')?.addEventListener('click', () => {
      const err = document.getElementById('j-err1');
      if (!document.getElementById('j-dupr').value.trim()) { err.textContent = 'Enter your DUPR ID.'; return; }
      if (!document.getElementById('j-rating').value) { err.textContent = 'Enter your DUPR doubles rating.'; return; }
      document.getElementById('j-step1').style.display = 'none';
      document.getElementById('j-step2').style.display = '';
    });
    document.getElementById('j-submit').onclick = async () => {
      const err = document.getElementById('j-err2');
      const lid = +document.getElementById('j-league').value;
      const body = {
        name: document.getElementById('j-name').value.trim(),
        duprId: document.getElementById('j-dupr').value.trim(),
        duprRating: document.getElementById('j-rating').value ? +document.getElementById('j-rating').value : null,
        email: document.getElementById('j-email').value.trim(),
        phone: document.getElementById('j-phone').value.trim(),
        membershipType: document.querySelector('input[name="j-mtype"]:checked').value,
      };
      try {
        const { registration } = await api(`/api/leagues/${lid}/registrations`, { method: 'POST', body: JSON.stringify(body) });
        setCoverStep('dupr');
        setCoverStep('member');
        setCoverStep('joined');
        document.getElementById('j-done').innerHTML = `
          <div class="banner finished">✓ You're signed up for ${esc(leagues.find((l) => l.id === lid).name)}.
          The organizer will add you to the league. Your fee is ${registration.membership_type === 'member' ? '$20 (YMCA member)' : '$50 (non-member)'}.</div>
          <div class="btnrow"><a class="btn" href="${RECLIQUE_URL}" target="_blank" rel="noopener">Pay on ReClique</a>
          <a class="btn secondary" href="#/league/${lid}">View the league</a></div>`;
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
      <div class="card">
        <label>Full name</label><input type="text" value="${v(person.name)}" disabled>
        <div class="field-row">
          <div><label>Email</label><input type="text" id="pf-email" value="${member ? v(member.email) : ''}"></div>
          <div><label>Phone</label><input type="text" id="pf-phone" value="${member ? v(member.phone) : ''}"></div>
        </div>
        <div class="field-row">
          <div><label>DUPR ID</label><input type="text" id="pf-dupr" value="${v(person.dupr_id)}"></div>
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
        <div class="btnrow"><button class="btn" id="pf-save">Save profile</button></div>
        <p class="fineprint" id="pf-err"></p>
      </div>`;
    document.getElementById('pf-save').onclick = async () => {
      const err = document.getElementById('pf-err');
      try {
        await api(`/api/people/${id.personId}/profile`, {
          method: 'PATCH',
          body: JSON.stringify({
            email: document.getElementById('pf-email').value.trim() || null,
            phone: document.getElementById('pf-phone').value.trim() || null,
            duprId: document.getElementById('pf-dupr').value.trim() || null,
            duprRating: document.getElementById('pf-rating').value ? +document.getElementById('pf-rating').value : null,
            duprProfileUrl: document.getElementById('pf-profile').value.trim() || null,
            resides: document.getElementById('pf-resides').value.trim() || null,
            age: document.getElementById('pf-age').value ? +document.getElementById('pf-age').value : null,
            country: document.getElementById('pf-country').value.trim() || null,
            photoUrl: document.getElementById('pf-photo').value.trim() || null,
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

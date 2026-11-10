# Phase 2 — Progress

Date: 2026-11-10. Status: **built and tested**. No deployment (no Render
account exists yet — deployment is a later step).

## What is built (Phase 2)

- **Members** (`server/routes/people.js`, migration 002): Become a Member
  (name, email, phone, DUPR ID/rating required; optional profile link,
  photo, resides/age/country; duplicate-name guard; links an existing
  person record instead of duplicating). Public directory
  (`GET /api/members`) never returns email/phone; Admin-only list
  (`GET /api/admin/members`) is the only place contact details appear.
  Admin edit/delete per member (edit also syncs the linked person record).
  Public name search for the cover "I'm already a member" find-my-name,
  and a public people search for find-your-league.
- **Join flow + registrations**: two-step join page (DUPR step, then
  details + $20 YMCA member / $50 non-member; league picker; prefilled
  name + DUPR for recognized members with an "already an MPA member"
  banner). Submitting saves a pending registration; the confirmation
  shows a Pay button out to ReClique — no payment verification, no
  payment gate. Closed registration rejects sign-ups (409). Admin:
  confirm / add to league (DUPR carried over, fee waiver follows the
  person onto the roster) / delete, per-person per-league Waive fee with
  green "Fee waived" marker + undo (waiver follows both directions
  between registration and roster row, and is per league).
- **Cover / welcome flow + recognition routing**: new visitors see the
  3 steps (DUPR → free membership → join) with the exact intro text,
  a live "X of 3 steps done" counter, "I'm already a member" find-my-name
  inside step 2, and Welcome / Members tabs. A recognized member skips
  the cover: step checkmarks sync from their real records (member
  record, DUPR on file, roster) instead of resetting to "0 of 3 steps
  done"; in a league → "Your league" landing page; not in a league →
  Members page. "A new season is open" join cards on the landing and
  Members pages; Join opens that league's registration prefilled at the
  details step. Cover-entered but unidentified visitors get a
  "Find your league" name picker.
- **Multi-league + landing + visibility**: one person, one record, roster
  spots in several leagues (junction already existed; Phase 2 wires the
  UI + `GET /api/people/:id/leagues`). "Your league" landing page: one
  card per league, "← Your leagues" back link on league pages. Players
  see only their own leagues (league page shows a "This isn't one of
  your leagues" card otherwise); Admin sees all leagues through tabs.
  Per-league logo color edit in Admin (PATCH /api/admin/leagues/:id).
- **My Leagues hub**: Registered / Managing / Favorites tabs, Active /
  Past filter (by session status), "Search for league", season grouping,
  install help card stating plainly there is no App Store or Google Play
  listing, with Add to Home Screen steps for iPhone, Android, desktop.
- **Account dropdown**: avatar + first name in the topbar (on every
  page) opening My Dashboard / My Profile / My Leagues; renders only
  after a name is picked. My Dashboard: per league, the standings row
  (rank, E/P Diff% − Penalty, record, points, game days) and every game
  played (partner, opponents, score, result). My Profile: edit own
  member record (name not editable); a roster player without a member
  record gets one created on save.
- **Admin page — all sections** (collapsible, with the spec's one-line
  descriptions): Create a league, Registration (open/close switch),
  Registrations, Members, Players, Standings penalties, Game day tools,
  Announce this league. Players section has the name autocomplete
  (members + not-yet-added registrations, DUPR auto-filled, "Already in
  the league" rows unpickable, "Also in: …" notes), per-row fee waive,
  and inline DUPR edit. Standings penalties shows the automatic miss
  penalty per player plus the Admin adjustment editor (unsportsmanlike
  conduct 2.5 hint).
- **Announce**: Admin picks a league; the tool writes the advertising
  email (subject "New MPA league: <name> — join now", body with league
  details, all 8 game days, YMCA address, $20/$50 fee, the 3 steps,
  DUPR sign-up link, Join MPA page link) and a shorter text version.
  Copy buttons copy RICH text (ClipboardItem text/html + text/plain) so
  links stay clickable when pasted, with a plain-text fallback. Recipient
  list ("Who it goes to — MPA members (N)", with-email/with-phone
  counts) with Copy email addresses / Copy phone numbers buttons.
  NOTHING is sent by the app.
- **Printable Court Sheet**: Admin Game day tools → "Print Court Sheet"
  (or Organizer view); each court with its players and a check-off box
  by every name, matches with blank score lines, under the date, time,
  and YMCA address header, with a Print button.
- **Google/Apple Maps chooser**: first tap on any map link asks (Google
  Maps / Apple Maps), remembered per device; "Map app: … · Change"
  control in the Standings footer and Info tab; Apple Maps bicycling
  falls back to driving.
- **Add to favorites**: per device (localStorage), toggle on league cards
  (home, landing, hub); hub Favorites tab reads it.
- **Create-a-league form (full)**: Type/Skill/Format/Day/Time dropdowns,
  Start/Stop calendar pickers, Season field, logo color swatches, and a
  "Generate the 8 weekly dates" step that renders 8 individually editable
  date inputs (a week falling on a holiday can be moved). Server rejects
  a gameDates array that is not exactly 8.
- **League page**: Registration panel (green "Registration Open — Join
  the League" / grey locked "Registration Closed"), Info tab registration
  state wording, per-league logo colors on cards.

## What is tested (Phase 2)

`npm test` runs Phase 1 then Phase 2 — **all tests pass** (run 2026-11-10).
`scripts/test-phase2.js` covers, end-to-end against a throwaway database:
admin enforcement on every new admin endpoint (401 without login), member
create + duplicate-name guard + missing-DUPR/bad-email rejections, public
directory hiding email/phone vs Admin showing them, member edit/delete,
public people/member search, league creation with custom per-week dates
(week 3 moved a day — sessions match the edited dates; 7 dates rejected),
logo color patch, join flow (missing DUPR 400, duplicate pending 409,
closed-league 409, member $20 / non-member $50), registration confirm →
waive → add to roster (DUPR carried, fee waiver followed onto the player
record, per-league), registration delete, autocomplete (finds member +
registration, "already in league" flag), multi-league (same person in two
leagues, remove from one only, duplicate add rejected), per-league fee
waiver isolation, profile get/merge + patch (name NOT editable, member
created on save for a roster player), dashboard (2 leagues, standings rows,
0 games before a night), a full played night on a past league (4 players,
3 games to 20, scored + finished → dashboard shows 3 games with partner,
opponents, result; standings 60 possible each), Announce data (8 sessions,
member recipients with email/phone + counts), and the SPA shell serving.
Also smoke-tested the real server by hand on the dev database (member
create, directory, searches, admin login, league create) and reset the dev
DB to empty afterwards.

## What remains (after Phase 2)

- **Deployment**: no Render account exists yet. When Alan is ready:
  create the account (his or the YMCA's name), point a Blueprint at this
  repo, set ADMIN_PASSCODE in the Render dashboard, deploy. Then Alan
  tests on his phone against the Muse app.
- **Alan's testing rounds**: the rebuild has not yet been driven by Alan
  (screenshots, corrections) the way the Muse app was.
- **Go-live** (Alan's call): fresh data via the form, registration
  switch as he sets it, public link shared. The Muse app is NOT deleted
  until Alan says so.
- Open items carried from Phase 1 / the spec: whether Max Movement
  should track roster size instead of max players (one-line change in
  `standings.js`); no 9th week is auto-created when all 8 are finished
  (fresh-season decision for later); Admin tokens live in server memory
  (fine for a single-instance service).

## Spec interpretations (added in Phase 2)

- **Date serialization**: pg returns DATE columns as midnight-UTC Dates,
  which JSON turns into full timestamps that shift a day in US timezones.
  `normalizeLeague` (`server/lib/league.js`) converts league
  start/stop/game_dates to YYYY-MM-DD in every league response, and
  session dates are normalized the same way in the league detail,
  session detail, and announce endpoints.
- **Members vs people**: `members` is the free-membership record (contact
  details live here); `people` is the single person record (DUPR, roster
  links). Becoming a member links an existing person record rather than
  duplicating it. Deleting a member never removes roster spots.
- **Registration contact**: migration 002 adds email/phone to
  `registrations` (Phase 1 had no columns for them); the join form
  collects both.
- **Announce recipients**: MPA members (the whole directory), not the
  announced league's roster — as in the Muse app. Drafts are built
  client-side from the announce endpoint data; the server never sends
  anything.
- **League visibility** is routing, not a lock (as in the Muse app):
  the league page blocks non-members from opening another league, and
  the game day only reveals a court to an opted-in player, but there is
  no sign-in; the Admin passcode is the only real lock, and it guards
  Admin + Organizer view.
- **Favorites / maps choice / cover steps / identity** are all
  per-device (localStorage); phone and desktop do not share them.
- **My Profile creation**: saving a profile for a roster player without
  a member record creates the member row with whatever contact details
  were supplied (email/phone nullable there; the Become-a-Member form
  still requires them).

# Phase 1 — Progress

Date: 2026-11-10. Status: **built and tested**. No deployment (no Render
account exists yet — deployment is a later step).

## What is built

- **Data model + Postgres** (`server/migrations/001_init.sql`): people,
  members, leagues, league_settings, player_leagues (junction),
  registrations, sessions, session_players, matches, rank_snapshots.
  Migrations run automatically on server start.
- **Leagues**: create via Admin API (name, type, skill, format, day, time,
  season, start/stop, 8 weekly game dates generated, location, max
  players, logo color); list/detail with sessions and registration state.
- **Game days**: 8 sessions per league; Current Game Day = earliest
  non-completed session; effective status flips to in_progress at game
  time; no 9th week is auto-created (see open questions).
- **RSVPs / opt-in**: self opt-in only inside the window (opens 1h after
  the previous game starts — at league creation for the first session;
  deadline 3h before game time). Opting in IS checking in. Opt-in time
  shown in fine print. Self opt-out until game time.
- **Automatic schedule generation**: when the game day loads after the
  deadline, from opted-in players, in standings order (DUPR seeding until
  the first session completes). Court builds exactly per spec: 4 → 3
  games to 20; 5 → 5 games to 15, 1 bye per game; 6 → 9 games to 10,
  2 byes per game. Every player reaches 60 possible.
- **Score entry**: player may score only their own court's games
  (server-enforced, 403 otherwise); organizer (admin token) may score any
  court; blank clears a score; one side must reach the target score.
  Scores are blocked before the deadline and on a finished night.
- **Standings**: E/P Diff% = Earned/Possible; rank by E/P Diff% − Penalty;
  tie-break Match Wins, then previous-week rank, then DUPR. Miss penalty
  automatic (1st free, 2nd 2.5, 3rd 5.0, +2.5 each) counting only sessions
  on/after the join date; Admin adjustment on top. Previous and Max Mvmt
  from rank snapshots. Standings include scored matches from in-progress
  sessions, so they move live during a night.
- **Player view**: game day opens in Player view; tap your name to
  identify yourself (device-remembered, YOU badge); complete Playing/Not
  Playing lists; opt-in/out only on your own row; Groups/Matches hidden
  until identity + opt-in + reveal; after the reveal only your own court
  and its games, with score entry.
- **Organizer view + Admin passcode**: passcode from `ADMIN_PASSCODE`
  env var only (never hardcoded; login disabled with a warning if unset).
  Admin token (12h httpOnly cookie) enforced server-side on score saving,
  schedule build/rebuild, walk-ins/no-shows, finish/reopen, roster and
  league management. Minimal Admin UI: passcode login, league tabs,
  create-league form, players (add/remove), game-day tools (build/rebuild,
  finish with "finish anyway?" prompt, view-as-organizer, registration
  switch).
- **Finish / reopen**: finish snapshots ranks and rolls Current Game Day
  to the next week; reopen removes the snapshot and keeps matches (scores
  preserved) so a score can be corrected.
- **Deployment config**: `render.yaml` (web Starter + Postgres Starter,
  ~$13/mo; `ADMIN_PASSCODE` set in the dashboard, never in the file).
- **Frontend**: mobile-first SPA — home (league cards), league page
  (Standings with vertical headers + scroll arrows/hint, Max Movement box,
  footer with transport icons; Schedule month cards; Info tab), game day
  page (RSVPs donut + lists, Groups, Matches, All Game Days modal),
  Admin page. MPA logo copied in.

## What is tested

`npm test` — **all tests pass** (run 2026-11-10, see output in the run
log). End-to-end against a throwaway Postgres database plus direct unit
tests of the standings rules. Verified: passcode login (401s, wrong/right
passcode), league creation (8 sessions), roster add + duplicate rejection,
DUPR seeding order, self opt-in window, pre-deadline score block, manual
build (10 players → 2 courts of 5 → 10 games to 15 + 10 bye rows),
auto-generation on load after the deadline (4 players → 3 games to 20,
no byes; 6 players → 9 games to 10, 18 bye rows, everyone 6 games + 3
byes), cross-court score block (403) vs own-court save vs organizer save
vs non-opted-in block, score validation (14-10 rejected), standings math
(P1 52 earned / 51 against / 60 possible = 86.667%, 2W-1L), finish blocked
with 10 unscored games then forced, Previous reading the session-1
snapshot during session 2, current-game-day roll-forward, 3-player court
warning + walk-in rebuild to 4, miss penalty ladder (1 miss → 0, 2 misses
→ 2.5), reopen restoring penalty 0, and the unit cases (3 misses → 5.0;
absent player with the best raw E/P held at rank 3 and flagged Y).

Also smoke-tested the real server by hand: `npm start`, health check,
admin login, league creation, 8 sessions listed.

## What remains (Phase 2)

Built and tested 2026-11-10 — see the Phase 2 section at the top of this
file. Remaining work is deployment, Alan's testing rounds, and go-live.

## Spec interpretations (decided while building)

- **Max Movement**: the spec defines the Y flag and "absent players
  cannot move up" — it does not require clamping ranks. Implemented:
  no general rank clamp; Y flags a player who moved ≥ the max (20% of
  league size, floored — 7 for a 36-player league, computed from the
  league's max players) in either direction, or did not play that week.
  Absent players are held at or below their previous rank via a
  key-sort + swap repair (terminates because snapshot ranks are unique).
  If Alan wants the max-players basis changed to roster size, it is a
  one-line change in `standings.js` (`maxMovement`).
- **Standings during a night**: computed from scored matches in completed
  *or in-progress* sessions, so they move live; final once finished.
- **First-session opt-in**: opens at league creation (no previous game).
- **Score validation**: one side must reach exactly the target
  (15/20/10); scores 0–30.
- **7 opted-in players**: courts split 4 + 3; the 3-player court gets no
  matches and a warning (court builds only define 4/5/6). Add a walk-in
  or remove a player.
- **6-player pairings**: deterministic greedy rotation maximising new
  partnerships (the spec pins the counts — 9 games, 2 byes per game,
  60 possible — not the exact pairings).
- **Reopen** keeps matches; only the snapshot is removed.
- **Current Game Day when all 8 are finished**: none (season complete);
  no 9th week is created. The go-live plan deletes the test league
  anyway, so this is a fresh-season decision for later.
- **Admin sessions**: tokens live in server memory (12h). Fine for a
  single-instance Render service; would need a shared store only if the
  service ever scaled past one instance.

## Environment notes

- This sandbox discards `apt` installs between some calls, so Postgres
  16 was installed from cached `.deb`s and runs as user `mpa` with its
  data directory in `/tmp/pgsql-data` on port 5433 (it survives across
  calls; restart with `pg_ctl -D /tmp/pgsql-data -l /tmp/pgsql-data.log
  start` as user `mpa` if needed). On a normal machine the setup is a
  plain `apt install postgresql` — see README.
- `.env` in this folder is local-only (gitignored) with the dev passcode
  `dev-passcode`. The real passcode is Alan's choice, set via the
  environment / Render dashboard — never in code.
- Dev database `mpa_league` was reset to empty after smoke testing.
- The Muse app (`pickleball-league-app`) was not touched at any point.

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

- **Max Movement**: Y flags a player who moved ≥ the max (20% of
  league size, floored — 7 for a 36-player league, computed from the
  league's max players) in either direction; otherwise N. Sitting out
  does not earn a Y. Absent players keep their frozen E/P and rank
  wherever that number lands, so they can move up if the players who
  played did not score enough to stay ahead. (Changed 2026-11-14 per
  Alan, from the WRPA example; the earlier key-sort + swap repair that
  held sitters in place was removed, and the earlier absent→Y flag
  was removed with the 2026-11-14 max-movement fix.)
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

## 2026-11-14 — Announce both ways + DUPR member check + skill gate (Alan: "Love it all")

Alan compared the announce flow against WRPA: one short phone-tied link opens a card list of leagues, each person picks the one they're qualified for, tapping through to registration that knows whether they're already a member. He approved both options: the single-league draft (for social media) and the all-leagues list version. Preview artifact `mpa-announce-options-preview` shown and approved 2026-11-14.

What changed (local copies; hand to Alan for upload):
- `server/routes/people.js` — NEW `GET /api/members/by-dupr/:duprId` (public fields only, no email/phone): the join page's member check. NEW `GET /api/admin/announce-all`: every league (player count + registration state) + member recipients for the all-leagues draft. Skill gate in `POST /leagues/:id/registrations`: rating outside the league's skill band is rejected 400.
- `server/lib/league.js` — NEW `skillRangeError(skill, rating)` (exported): bands `2.5-2.99`, `3.0-3.49`, `3.5-4.49` inclusive, `5.0-ABOVE` (>= 5.0), `50+` never gates (age band).
- `public/app.js` — NEW `APP_URL` (https://mpa-league-app.onrender.com); `JOIN_PAGE_URL` (Netlify) removed — drafts now link to the app itself. Announce section gains a One league / All open leagues picker; "all" fetches `/api/admin/announce-all` and renders NEW `announceAllHtml` (same card ids as `announceHtml`, so copy buttons wire up unchanged). Single-league drafts now link step 3 / sign-up to the app's join page `#/join/:id`. Join page Step 1 Continue now: skill check first, then the DUPR member lookup — a match welcomes the member back and fills in their name; a miss says they'll become a free member on sign-up. Home league cards already showed skill/dates/time/player count — no change needed there.

Verified (no dev DB — `npm test` cannot run): `node --check` passes on all four touched files; `skillRangeError` 12/12 cases (both copies identical); `announceAllHtml` rendered against live-shaped data — open leagues listed with per-league join links, closed league excluded, home link, fee + DUPR lines, recipient card, copy-data block all present; single draft join link is the app join page, Netlify link gone. Server + client route files load cleanly via `require`.

## 2026-11-14 — One-tap send from the Announce drafts (Alan's pick)

Alan asked whether the drafts can send automatically after copying. True auto-send would need an email/text service wired to the server (accounts + per-message cost), so he picked one-tap open instead: `public/app.js` only — both drafts (single-league `announceHtml` and all-leagues `announceAllHtml`) now have a "Send by email" button (mailto: with all member emails in To, subject + plain-text body filled in) and a "Send by text" button (sms: with all member phones and the text draft filled in). Tapping one opens the phone's Mail/Messages app; the organizer just hits Send. Buttons are hidden when there are no emails/phones on file; the copy buttons stay as the fallback. Verified: `node --check` passes; both drafts render-tested in node — mailto/sms hrefs carry the right recipients, subject, and body; empty-recipient case hides the buttons. File: ~/workspace/your_files/mpa-announce-both/app.js (replaces the earlier copy there).

## 2026-11-14 — Join MPA announce mode + text-the-invite (Alan's ask)

Third Announce mode, `public/app.js` only: "Join MPA" — a general invite to join the association, no league attached (email + text drafts, same copy/send buttons, recipients card). Plus an "Invite someone new" card: type a phone number, tap "Text the invite", and Messages opens with that number and the invite text filled in (wired in `wireAnnounceCopy`, which reads the draft from the DOM; empty number shows "Enter a phone number first."). The mode reuses `GET /api/admin/announce-all` for the member list; the league select is disabled for both "all" and "join". Verified: `node --check` passes; `announceJoinHtml` render-tested in node — 10/10 checks (subject, 3 steps, home + DUPR + ReClique links, fee line, no league names, send buttons with right recipients, invite card, recipients card). File: ~/workspace/your_files/mpa-announce-both/app.js (md5 4bc1c97506b7a1411411eddb633b7fbc).

## 2026-11-14 — Join MPA draft: step 3 removed (Alan's ask)

Alan: "on your join MPA, leave off the 3. pick your league." `announceJoinHtml` only (scoped by function — the all-leagues draft keeps its step 3, since picking a league is the point there): email + text drafts now read "Two steps to join" (DUPR, free member) with a "Join here" line carrying the app link, since step 3 was the only line that linked to the app. Verified: `node --check` passes; Join MPA render-tested 7/7 (no step 3, two steps, Join here link, DUPR/fee/ReClique intact, invite card + send buttons intact); all-leagues draft re-rendered to confirm its step 3 is untouched. File: ~/workspace/your_files/mpa-announce-both/app.js.

## 2026-11-14 — Join MPA draft: fee line removed (Alan's ask)

Alan: take out "Leagues are $20 member / $50 non-member" from the Join MPA invite. Removed from all three Join MPA wordings (`announceJoinHtml` only): the text draft's "Leagues are $20 member / $50 non-member." line and the email's "Joining a league costs $20 (YMCA member) / $50 (non-member), paid on ReClique" line (plain text + HTML). The league drafts keep their fee lines (different wording, untouched). Verified: `node --check` passes; Join MPA render-tested 5/5 (no $20/$50/ReClique anywhere in the join draft, two steps + Join here + DUPR intact, invite card + send buttons intact); single-league draft re-rendered to confirm its fee line is untouched. File: ~/workspace/your_files/mpa-announce-both/app.js.

## 2026-11-14 — Safari tip in the announce drafts (Alan's ask)

Alan confirmed: the DUPR link works when pasted into Safari but sticks when tapped from Mail/Messages (in-app browser). No alternate DUPR signup route exists (www.dupr.com's buttons all lead to the same /signup form; dashboard root is just sign-in). Added one tip line to all three announce drafts, in the email plain text, the email HTML, and the text draft, just before the signature: "Tip: if the DUPR link won't open from your email or text, copy it and paste it into Safari." Verified: `node --check` passes; all three drafts render-tested — tip appears 3x in each (9 total), DUPR link intact. File: ~/workspace/your_files/mpa-announce-both/app.js.

## 2026-11-14 — Self-rating fallback (Alan's ask, approved from preview)

DUPR signup emails are not arriving (DUPR outage; another player reported signup unresponsive 2026-11-12), so new players can't get a DUPR account and get stuck at Step 1 of joining. Alan approved the preview (mpa-self-rating-join-preview): self-rating as a fallback, DUPR stays the standard. Level picker 2.5–5.0 on the join page Step 1 and the Become a Member form; the league's skill band still gates the self-rating the same way. Member/registration rows carry self_rated (migration 005); directory, profile, Admin members/registrations, and the find-my-name rows label it "Self-rated X" (never shown as a DUPR rating). Adding a real DUPR ID later — from My Profile or Admin → Members → Edit — clears the flag. Seeding uses the rating either way. Verified: node --check on all files; skillRangeError cases pass on server + client (incl. 4.5 above the 4.49 cap, as designed); all three self_rated INSERTs balanced; new variables scoped inside their own functions. Files: ~/workspace/your_files/mpa-self-rate/ (app.js, styles.css, people.js, league.js, 005_self_rated.sql).

Verified live 2026-11-14 ~20:22: all five GitHub files in the right folders with matching md5s; live app.js is the new build; /api/health ok; member lookup returns Alan with self_rated false. Note: right after the upload the members endpoints briefly errored "column self_rated does not exist" — the new code was live before the restarted server had run migration 005; it self-healed within ~2 minutes as the deploy finished. Alan to test the flow with a test name (self-rate 3.5 on the join page, then delete the test registration from Admin).

## 2026-11-14 — Round Robin tab (Alan's ask, approved from preview)

Separate tab for one-off round-robin events, apart from leagues: free charity games and money-ball events. Fixed teams stay together all night; every team plays every other team once, one game to 15, same one-match-at-a-time scoring as league night. Money ball: per-person entry fee set per event (default $10), pot = players x fee, payout structures from Alan's table plus the House Rule default (3rd gets entry fee back, 1st/2nd split the rest 60/40).

Built: migration 006_round_robin.sql (rr_events / rr_teams / rr_matches), server/lib/roundrobin.js (circle-method schedule, E/P team standings, payout math), server/routes/roundrobin.js (create/edit/delete events, add/remove teams, build, public score entry, finish/reopen), public/app.js (#/roundrobin list + event pages, Round Robin card on home). 31 node checks passed on schedule/standings/payouts; node --check clean on all changed files; require chain loads.

Upload note: first upload swapped the two roundrobin.js files (routes file landed in server/lib/, server/routes/ empty) — fixed by re-uploading each to its own folder.

Verified live 2026-11-14 ~21:10: all five GitHub files in the right folders with matching md5s; live app.js is the new build; /api/health ok; /api/round-robin/payouts returns all 6 structures; /api/round-robin/events returns an empty list (migration ran, no events yet).

Entry-point fix 2026-11-14 ~21:16: the first build only linked Round Robin from the Home page, but Alan's phone opens the "Your league" landing page, which had no link — added a Round Robin button to the landing page btnrow and to the account menu (app.js fc3b097a, verified live). Alan created the first event himself: "Saturday night", Nov 21 2026, free charity, setup, 0 teams yet.

Rounds stack + winners by place 2026-11-15 ~17:06: preview (money-ball-rounds-preview) iterated side-by-side -> vertical stack -> uniform boxes with badges -> SCORE only on current round -> green/red winners/losers, all approved by Alan. Live build: pot card names leading teams with "(leading)" while playing (routes/roundrobin.js attaches payout teamId once the ranked team has played > 0); Matches is a vertical rounds stack (round in play on top "Now playing", completed drop down in order "Completed", next "Up next", later "Upcoming"); SCORE only on unplayed matches of the round in play; scored cards show winner green / loser red, white lettering, score on each team's row. Scored matches keep their SCORE button while playing so a mistyped score can be fixed (same as the league) — deliberate difference from the static preview. Files: app.js 4947423d, styles.css 636aa8e2, server/routes/roundrobin.js 84631c37, all verified GitHub + live. Deploy lag: new app.js served ~2 min before the API showed the new payout code — wait before concluding a deploy failed. Event 3 ("Saturday Night Money Ball") fully scored by Alan (15/15, still playing): leaders JJ & ALAN 90.9%, BOB & TOM 89.1%, LAURA & BRYAN 85.5%.

Rounds view fix 2026-11-15 ~17:11: Alan's screenshot showed the live page didn't match the preview — matches were stacked as separate cards and SCORE buttons sat on finished matches. Fix: each round is now a <section class="rr-round"> box with its matches in a 3-column grid (1 column under 860px), and canScore is now !finished && !scored && isCurrentRound, so no button on any scored match. Files: app.js 4b0406ac, styles.css 2e652055, verified GitHub + live. The live CSS lagged the JS by ~2 min after the upload (same deploy lag as the payout fix). Consequence flagged to Alan: a mistyped score can no longer be fixed in the app; only fix is deleting the night unless he asks for an edit button back.

Pot card rebuilt to the preview's winners view 2026-11-15 ~17:19 (Alan: "i like this view that is missing on the app"): medal circles (gold/silver/bronze), place label, team name + record/E/P, amount right-aligned, "Entry fee back" under 3rd; "· LEADING" in the place label while playing, plain once finished. Record/E/P come from the standings rows the server already returns (looked up by payout teamId). Rendered against live event data before handover: 1st JJ & ALAN 3W-2L 90.9% $60, 2nd BOB & TOM 3W-2L 89.1% $40, 3rd LAURA & BRYAN 3W-2L 85.5% $20. Files: app.js c3df965b, styles.css 6788d6ff, verified GitHub + live. Live files lagged GitHub ~2.5 min after the upload before the deploy landed.

Edit link on scored RR matches 2026-11-15 ~18:48 (Alan approved 18:43, after the week-ahead message asked the open question): small grey underlined "Edit" under the score on scored matches, Admin-only, while the night is playing — reopens the same score screen (Save/Clear/Back), so a mistyped score can be fixed without the big SCORE button coming back. Uses the existing data-rr-score wiring; no new handlers. Regular players see nothing. Same upload also carried the LEADING removal (app.js 6dc7e06c, styles.css f2e11a7d, verified GitHub + live; LEADING count 0 in live app.js). Live files lagged GitHub ~2.5 min again.

Charity medals 2026-11-15 ~19:11 (Alan asked 19:02): free charity nights now show a "Leaders" card (top 3 teams that have played, medal circles + place label + record/E/P, no money) — "Winners" once the night is finished. Same .rr-place design as the money-ball pot card; placeLabel moved to renderRREvent scope so both blocks share it. Money-ball pot card untouched (regression-rendered with event 3 values: Pot $120, $60/$40/$20 + Entry fee back). Verified live first try — GitHub and live app.js both 2c79d47b, no deploy lag this time. Note: Alan had deleted event 3 (Money Ball) and created event 4 "Saturday Night" charity (4 teams, 6/6 scored; leaders Laura & Bryan 97.0%, Kim & Justin 93.9%, Sam & Stan 81.8%) before asking — whether the Money Ball deletion was the Saturday reset is unanswered.

Join MPA wording 2026-11-15 ~19:23 (Alan asked 19:16, approved the wording): email + text drafts now say "MPA ladder leagues are in the works at the YMCA in Moultrie, GA — Coed Doubles, Women's Doubles, and more, for every skill level. Join now and pick the league for your skill when play starts." plus "If you can't open DUPR, you can rate yourself instead when you join." Single/all-league drafts unchanged. Verified live first try (GitHub + live app.js 46c3db71). Alan corrected the framing: the leagues ARE open in the app; the invite says "in the works" because the YMCA payment option isn't settled. Same evening Alan asked to see all pages a player sees after signing up — preview artifact pages-after-sign-up built (8 phone mockups: signup confirmation, league waiting room, Your League landing, Find your league, Current Game Day player view, Matches, score screen, Members/Profile/Dashboard) with callouts for the two known gaps (ReClique dead end; pending signup not shown on landing). Pending-signup fix still unanswered.

Fee hidden until YMCA approves 2026-11-15 ~19:32 (Alan asked 19:32): all player-facing $20/$50 + Pay on ReClique removed from public/app.js — cover Step 3 line, league-page registration-open card, league-page Info Signup/Payment box, join-page member/non-member radios (question kept, prices dropped), success banner fee line + Pay button. Membership type still collected (needed when fees return). Admin registrations row and announce drafts still show fees (Alan-facing; drafts moot while leagues are wiped). Verified by grep: remaining $20/$50 hits are Admin row + drafts only; "Your fee is" 0; node --check OK. Staged mpa-hide-fee/app.js c79d36f7, handed over; live verification pending Alan's upload. Preview pages-after-sign-up reworked to the empty state (edit verified by builder ~19:35): Page 1 "You're a member" no fee/no Pay, Page 2 "No leagues open yet", Page 3 member home with no league card, Page 4 "No league yet", Page 5 "No game day yet"; pages 6-8 marked SAMPLE (test-season data). Wipe timing still unanswered — Alan was asked "now vs go-live" via options; note there is NO delete-league button/endpoint in the app today, so wiping needs a small build. Wiping deletes the whole test season (8 weeks, standings, players, sessions).

Wipe build VERIFIED LIVE 2026-11-15 ~19:44 (Alan "Done"): GitHub public/app.js 181596 bytes sha 38fb0b45 (== local), public/index.html 832 bytes sha bc16d72a (== local), server/routes/people.js 40770 bytes sha 1884fad9 (== local); no stray public/api.js. Live app.js md5 70639888 + index.html 16e09ade match; health ok. Live leagues list = ONLY league 1 'MPA WINTER 2026 - ADVANCED' — the Women's league was never recreated on the live app (it lives only in the Muse reference app), so the wipe is a single delete. Next: Alan deletes league 1 in Admin (Delete a league section); Enzo verifies /api/leagues is empty after.

Wipe VERIFIED 2026-11-15 ~19:50: /api/leagues returns {"leagues":[]}; Alan's screenshot shows the landing page "You are not in a league yet" with 0 Leagues. Admin link visible in his screenshot because his device is Admin-signed-in (gating follows sign-in, not page); a player device never sees it. To see the true player view: sign out of Admin or use a private window. Round Robin move proposed (Alan 19:50): he wants the RR tab on the Admin side so players can't run their own nights. Verified in code: RR management is ALREADY server-gated (create/teams/build/finish/reopen/delete all requireAdmin) and the client hides the New-night form from non-admins (renderRRList `if (!me.admin) return;`) — players today can only see nights + enter scores. Remaining work is moving the entry points (home card, landing button, account-menu link) to Admin and letting players reach a night by a shared link. Awaiting Alan's pick: link-only vs also surfacing a playing night on the landing page.

RR-move + glimpse VERIFIED LIVE 2026-11-15 ~20:08 (Alan "Done"): GitHub public/app.js 182896 bytes sha 3530b48c (== local); live app.js md5 6f69638c matches; health ok; leagues still []. Live file contains the glimpse, exactly one 'Round Robin' href (the Admin-page button), and the landing btnrow is Members/My Leagues only. Alan accepted the glimpse leaving once leagues exist, noting it looks better than a blank page — the page won't be blank later: join cards (not in a league) or league cards (in one) fill it.

Front-page fix VERIFIED LIVE 2026-11-15 ~20:16 (Alan "Done" 20:13): GitHub public/app.js 182932 bytes sha 8c94479c (== local). Live lagged ~2.5 min on first check (old md5 6f69638c), recheck after 150s: live md5 050f609c matches, fix comment present, health ok, leagues []. Root cause of Alan's "dead" logo/Back: renderRoot sent members with no league to the Members page, so #/ re-rendered the same page. Fix: renderRoot now returns renderLanding for every recognized member. RR-move + glimpse build (6f69638c) verified live 20:08. All three builds (fee-hide, delete-league, RR-move+glimpse, front-page fix) are cumulative in the current live app.js 050f609c.

Visual-glimpse build VERIFIED LIVE 2026-11-15 ~20:26 (Alan "Done" 20:26): GitHub app.js 187379 bytes sha 6891cf3c (== local), styles.css 24907 bytes sha 8bf39930 (== local); live app.js md5 b03d7c3e and styles.css md5 c685db21 match, no deploy lag; 3 gl-sample cards in the live file; health ok; leagues []. Front page now shows the "You're a member!" phone card, steps 2-5 list, and three SAMPLE visual cards (Matches / Enter score / Members & Dashboard) in the preview's style, only while no leagues exist.

Glimpse fixes VERIFIED LIVE 2026-11-15 ~20:39 (Alan "Done" 20:36): GitHub app.js 187729 bytes sha 88dac084 (== local), styles.css 24766 bytes sha 9af3a8d7 (== local). Live lagged ~2.5 min on first check (old md5s), recheck after 150s: live md5s d6461769 / 87ebb11b match, gl-num 0, "How scoring works" present, health ok, leagues []. Numbers gone, YMCA-approval wording gone, scoring explainer live.

Announce dead-button bug — DIAGNOSED + FIXED 2026-11-15 ~21:11 (Alan reported 21:03): "Write the announcement" did nothing (no drafts, no warning) in Join MPA mode with zero leagues. Root cause: `if (!league) return;` in renderAdminBody (app.js line 1877) cut off ALL wiring after it whenever no league exists — the section headers still worked (wired earlier at ~1730) but anGen.onclick (and Member Edit, registrations buttons) was never assigned. Verified every league.id use after that line sits inside a click handler or behind an element guard, so removing the line is safe with no league. Fix: deleted the one line. Handed over (mpa-announce-fix/app.js cc71f95b); live verification pending Alan's upload.

Announce fix VERIFIED LIVE 2026-11-15 ~21:16 (Alan "Done" 21:13): GitHub app.js 187705 bytes sha 2ce31c89 (== local); live lagged ~2.5 min on first check (old md5 d6461769), recheck after 150s: live md5 cc71f95b matches, early return gone (0), health ok, leagues []. (First GitHub API call returned a transient error body — retry showed the correct sha/size; raw-file md5 also matched.)

DUPR line in Join MPA drafts — BUILT + VERIFIED LIVE 2026-11-15 ~21:24 (Alan 21:19): after sending the announcement he said "maybe we should have said that any league will not affect DUPR during completion of play." True for this app — nothing is ever sent to DUPR; a rating changes only when a member/Admin edits it. Added to announceJoinHtml only (email text + email HTML + text draft): email "Playing in an MPA league won't change your DUPR rating — league scores stay here and are never sent to DUPR."; text "League play won't change your DUPR rating — scores stay here, never sent to DUPR." Single-league and all-leagues drafts unchanged (offered to add there too). Handed over (mpa-dupr-line/app.js deaa1f9a); GitHub raw md5 matched; live lagged ~2.5 min, recheck after 150s: live md5 deaa1f9a, line count 3, health ok, leagues [].

Permanent Admin tab — BUILT + VERIFIED LIVE 2026-11-16 ~18:41 (Alan 18:37): the 12h Admin sign-in kept expiring and the header link vanished with it, so he had to hunt for the #/admin link. Change: index.html line 17 loses `hidden`; syncAdminLink (app.js ~line 77) now always sets link.hidden = false instead of hiding when signed out. Trade-off flagged to Alan: this reverses the 2026-11-15 decision — players see the Admin tab too — but the passcode is the lock; the tab only opens the sign-in form when signed out. 12h sign-in unchanged. Handed over (mpa-admin-tab/app.js 49f03a27 + index.html 8a93235e); GitHub raw md5s matched; live lagged ~2.5 min, recheck after 150s: live md5s match, hidden 0, always-show 1, health ok, leagues [].

Admin footer sign-in link — BUILT + VERIFIED LIVE 2026-11-16 ~18:51 (Alan 18:46): he asked if the permanent header tab was only in his view (no — everyone saw it) and worried players would try to guess the passcode. Checked auth: NO lockout — POST /admin/login (api.js line 363) returns 401 "Wrong passcode." with no attempt counting, so unlimited guesses. Offered a lockout (5 wrong tries → 15 min) — Alan hasn't answered yet. Build: header Admin link back to hidden-unless-signed-in (index.html + syncAdminLink restored); new small grey "Admin sign in" footer link on every page (index.html + .site-footer in styles.css). Handed over (mpa-admin-footer/app.js dd982226 + index.html b7aee539 + styles.css 82197060); GitHub raw md5s matched; live lagged ~2.5 min, recheck after 150s: live md5s match, footer link 1, header hidden 1, hide logic 1, health ok, leagues [].

App logo swap to MPA shield — BUILT + VERIFIED LIVE 2026-11-16 ~20:04 (Alan 19:48): he picked fresh option A (black-and-yellow shield, two black paddles around a yellow ball) and asked for MPA on it, then approved the swap. Edit: "PICKLEBALL" → "MPA" in the same yellow lettering (media edit of new-a.jpg); cropped tight to the shield (859×910, md5 0fca3fd5e71e0c4026dc1da279c88176) so it reads at 40px header height; black background blends with the black topbar. Upload path: file first landed as "New MPA logo.webp" (wrong name — app still showed old logo), then Alan renamed it to mpa-logo.webp (commit 79a1a90). Verified: GitHub raw + live mpa-logo.webp both md5 0fca3fd5, health ok, no deploy lag this time. Note: GitHub's file-page image preview still showed the old logo from its cache after the rename — the actual file was already the new shield. Old option-4 logo stays in the Muse reference app untouched. Files: ~/workspace/your_files/mpa-logo-swap/mpa-logo.webp (also copied into rebuild/public/).

League logo colors by type — BUILT + VERIFIED LIVE 2026-11-16 ~20:47 (Alan 20:12): page/header logo stays black and yellow; league-card logos change color by league — red for 50+ (keyed to Skill "50+"), blue for Advanced, green for Intermediate/Advanced, pink for Women's, dark gray for Elite, anything else black and yellow. Implementation: colorForLeague(l) + logoSrcFor(color) in public/app.js (leagueCardHtml mark class + img src both derived; create payload computes logoColor from type/skill); manual Logo color pickers removed from the create form and the Admin "Logo color for X" card (replaced with a note stating the rule); styles.css gained .mark.red/.blue/.green/.dark-gray. Five shield variants are exact hue-shift recolors of the new MPA shield (PIL HSV shift; dark gray = desaturate + halve brightness): pink 4765496b, blue 77c63720, green 9f539967, red d2aebfc2, dark-gray 37fd901f; app.js 1a1e0847, styles.css ecbb3eca. Upload saga: Alan's first upload (20:19) landed a picker-based app.js (manual swatches + red/dark-gray, no auto-derive) and no logos; his second (20:26) landed the auto app.js but still no logos; a zip of the 5 landed whole (GitHub doesn't unzip). Alan chose auto over picker (~20:24) and asked Enzo to upload via browser ("Try that", 20:41) — browser task completed ~20:47 (commit 7819d10, Alan signed in directly), all 5 verified live (GitHub raw + live md5s match, health ok, leagues []). Stray public/mpa-league-logos.zip remains in the repo (harmless).

Fee cleanup — BUILT + VERIFIED LIVE 2026-11-18 ~21:00 (Alan: "Yes, fix it all", 2026-11-18 20:56): two player-visible fee lines the 2026-11-15 fee-hide had missed — Info-tab Refund Policy "League fees are handled through the YMCA (ReClique)" (live line 1115) and join-page Step 2 fine print "Fees are paid on ReClique after you sign up. Nothing is charged here." (live line 2572). Fix: app.js e12abe72d44cd78b3b60bac9d25b1d6a, exactly 2 lines changed from the live base 1a1e0847 (Refund → "Contact the league organizer about refunds."; join fine print → "Nothing is charged here."), node --check OK; Alan uploaded to public/app.js; verified live ~21:00 (GitHub + live md5 e12abe72, both fee strings 0, replacements at 1115/2572, health ok, leagues []) — no deploy lag this time. Deliberately kept: Admin announce drafts ($20/$50 ReClique), Admin registrations hint, RECLIQUE_URL constant. Membership & Participation "non-payment of league fees may result in removal" line still in the live app — Alan hasn't answered whether to trim it (the ladies preview's copy was trimmed in the watermark repair below).

Ladies in-progress preview — WATERMARK REPAIRED 2026-11-18 ~20:58 (inspection repair, authorized by Alan's "Yes, fix it all"): the first in-progress build had dropped the watermark entirely (inspection 2026-11-16 21:23 confirmed no watermark code, plain cream background). Repair added the pink MPA shield as a fixed full-page background at 20% opacity (assets/mpa-logo-pink.webp, background-size:cover, z-index 0, pointer-events none), content wrapped above it, plus an Opacity slider (0–40%, starts 20%) and Hide/Show toggle. Preview Info tab is now fully fee-free: Refund Policy → "Contact the league organizer about refunds." and the Membership & Participation non-payment line removed (zero matches for "reclique", "league fees", "non-payment" in index.html). Everything else untouched: Session 4 of 8, standings through Session 3, Session 4 Current Game Day with courts, working SCORE flow, finished matches winner-green/loser-red.

Round Robin self-join — BUILT + STAGED 2026-11-18 ~21:27 (Alan approved the preview, cap raised to 24 teams). Three files in ~/workspace/your_files/mpa-rr-self-join/ (rebuild copies updated in place, identical md5s):
- public/app.js ab172ddc1cf0b9c328df303f32267052 (199,059 bytes) — landing card for published setup nights ("Round Robin — sign-ups open", X of 24 teams filled, Y waiting to be paired, Join button); night-page join box (find-your-name if no identity, partner picker from members, Join as a team / Join solo, Leave); solos list + Admin Pair controls; Admin Publish/Unpublish + Close signups. Glimpse, fee-cleanup lines, and logo-color code untouched (verified).
- server/routes/roundrobin.js 1aa891606759a982ca984a142d86ad62 (21,633 bytes) — MAX_TEAMS 24; new public POST join-team / join-solo / leave (setup + published gate, duplicate checks, cap); PATCH accepts published; admin POST pair (two solos → one team, transaction, cap enforced). lib/roundrobin.js unchanged.
- server/migrations/007_rr_self_join.sql fa23d96790d31666c8b4942a58345c01 (1,290 bytes) — published flag on rr_events (default FALSE), person1_id/person2_id on rr_teams (FK people, SET NULL), rr_solos table + UNIQUE + index. All IF NOT EXISTS.
Tests: node --check OK both files; 24-team schedule verified (276 matches, 23 rounds, 12/round, every pair once); 23-team (253 matches, 1 bye/round each); house payouts at 24 teams × $10 = pot $480 (1st $276, 2nd $184, 3rd $20 back). NOT verified: migration never run against a real DB (dev Postgres gone) — watch the first Render deploy log for 007 applying; client join flow code-reviewed only, not run in a browser. Known limitation: a hand-added name-only team can't be duplicate-detected if that person later self-joins. No per-event max, no join deadline (sign-ups close at build), no payment collection. Existing event 4 (Nov 21, playing) gets published=false and stays join-closed; Alan must create + Publish a new night for the 23rd.
PENDING: Alan uploads the three files to GitHub → verify GitHub raw + live md5s, GET /api/round-robin/events returns solo_count, then update MEMORY.md.

Round Robin self-join — VERIFIED LIVE 2026-11-18 ~21:32. Alan uploaded all three files; GitHub raw + live md5s match staged (app.js ab172ddc, routes 1aa89160, 007 fa23d967). First live check hit a transient 500 on GET /api/round-robin/events (deploy in flight); retry seconds later: events endpoint returns event 4 with published:false and solo_count:"0" — migration 007 applied; event detail returns teams with person1_id/person2_id (null for hand-added); health ok; join strings present in live app.js. Event 4 intact (4 teams, 6/6 scored, playing). Remaining: Alan creates + Publishes a Nov 23 night for members to join.

Admin create-night card — BUILT + STAGED 2026-11-18 ~21:42 (Alan: "make it look like this in the ADMIN page", from the self-join preview Step 1). Five files in ~/workspace/your_files/mpa-rr-admin-create/ (rebuild copies identical):
- public/app.js 4434f6cd2ebb853a4f3e6c7191b9323f (205,084 bytes) — new collapsible "Round Robin" section on #/admin with the dark create card (STEP 1 — YOU CREATE THE NIGHT, ADMIN badge, field grid, big Publish button); create form removed from RR list page (list-only now); landing spots "X of {max_teams}"; night header "Mon Nov 23 · 6:30 PM" + sign-ups line; nightFull uses event max.
- public/styles.css d1191ad4930a7809c295ba201dcfc5be (26,297 bytes) — .rr-create-card dark block.
- server/routes/roundrobin.js 6b4990ea1156f31b5d3fa435c7167809 (24,473 bytes) — create accepts start_time/max_teams/signup_close/published, kind defaults money, published defaults true; PATCH accepts new fields; joins + admin add-team + pair enforce event max_teams; joins enforce signup deadline (409 "Sign-ups have closed.").
- server/lib/roundrobin.js edc21816fa6e2ae4afc0e5874995888f (7,750 bytes) — eventDatePart + signupCloseAt (zonedToUtc − 3h, null for 'fill').
- server/migrations/008_rr_create_fields.sql 3b5f0e1a29e3c63f5c7dd755c0a5646b (940 bytes) — start_time TIME DEFAULT '18:30', max_teams INT DEFAULT 6 CHECK 2..24, signup_close TEXT DEFAULT 'day-3h' CHECK ('fill','day-3h').
Tests: node --check OK; signup close verified independently (Nov 23 18:30 → 2026-11-23T20:30Z = 3:30 PM EST; fill → null; DST fall-back handled per builder); 24-team schedule + house payouts still pass; fee strings 0; logo code intact; old create IDs gone. NOT verified: migration never run on a real DB; client flow code-reviewed only. Judgment calls flagged to Alan at handover: publish ON / Money Ball / day-of 3:30 PM / 6 teams defaults (per preview); card has a Night name field (preview shows none, server requires it); close label follows start time; no edit UI for the new fields on existing nights (PATCH accepts them); same deploy race as 007.
PENDING: Alan uploads the five files → verify GitHub raw + live md5s, GET /api/round-robin/events/4 returns start_time/max_teams/signup_close, then update MEMORY.md.

Admin create-night card — VERIFIED LIVE 2026-11-18 ~21:55. Alan uploaded all five files; GitHub raw + live md5s match staged (app.js 4434f6cd, styles d1191ad4, routes 6b4990ea, lib edc21816, 008 3b5f0e1a). Live app.js contains "YOU CREATE THE NIGHT" and styles.css contains .rr-create-card; health ok; no deploy lag this time. Migration 008: server is up on the new code (migrate runs at boot before listening), but the new columns could not be read back from the API because the events list is empty. NOTE: event 4 (Nov 21 charity test night, 4 teams, 6/6 scored, verified present at 21:32) is GONE from GET /api/round-robin/events (returns {"events":[]}) and GET /api/round-robin/events/4 returns 404 "Round robin not found." — asked Alan whether he deleted it; he confirmed 2026-11-18 22:05 he deleted it himself from the Admin page. No bug, no investigation needed.

Admin Members list with no league — FIXED + STAGED 2026-11-18 ~22:14. Root cause (same family as the 2026-11-15 Announce bug): in renderAdminBody, the members list HTML was built inside `if (league) { ... }`, so with no leagues live (wiped 2026-11-15) the Members section just read "Pick a league above." and showed no one — even though 16 members exist and the Edit wiring itself was fine. Fix (app.js only, md5 60d8f6780e748faf9f926f3d6ec1fdb3): moved the `GET /api/admin/members` fetch + membersHtml build to before the `if (league)` block (lines ~1630-1639), deleted the copy inside it. Diff vs live base (4434f6cd) is exactly that move + a comment. node --check OK; fee strings 0; logo code untouched; server unchanged. Staged at ~/workspace/your_files/mpa-admin-members/public/app.js (rebuild copy updated in place, identical). This also fixes Cindy's edit path: Admin → Members → Edit can now fix her dupr_id ("Cindy Spurlin" stored as the ID).
PENDING: Alan uploads public/app.js → verify GitHub raw + live md5 60d8f678, then update MEMORY.md.
VERIFIED LIVE 2026-11-18 ~22:17: GitHub raw + live app.js both md5 60d8f678 (live lagged ~2.5 min as usual, then landed); fix comment present live; health ok; members still 16. MEMORY.md updated.

Double-elimination bracket nights — BUILT + STAGED 2026-11-22 ~22:00 (Alan approved the preview "bracket looks good" 2026-11-22 evening, bye rule: higher seeds always get the bye in both brackets; he picked "its own bracket night" 2026-11-22 21:16, not a finish after a round robin). A bracket night is its own night type, mirroring round robin nights end to end. Engine ported exactly from the approved preview (artifact double-elimination-bracket-preview, inspection 2472222e-075c-421d-bb00-1abf67e230bd): B = next power of two, interleaved seedOrder, phantom-seed byes to the top seeds (no BYE boxes), winners bracket by consecutive slots, losers bracket with the waiting list (first losers play each other first-vs-last; later rounds pair waiting winners in order vs droppers in reverse; leftover pools pair among themselves; odd total sits out the LAST fresh dropper, never a waiting winner), grand final + reset game only if the losers champion wins the first final. Games to 11, win by 1, no deuce.
Files (all in the rebuild folder, NOT pushed — parent does the push):
- server/lib/bracket.js (366 lines, new) — pure engine: BRACKET_SIZES [4,6,8,10,12,16], seedOrder, buildBracket (slot refs {seed|winner|loser}, creation order), resolveBracket (incl. reset-game active flag), computeBracketPlaces (champion/runner-up/3rd = LB Final loser), computeBracketRecords, dependentMatchKeys (cascade-clear on score change).
- server/routes/bracket.js (703 lines, new) — mirrors roundrobin.js route for route (16 routes): public list/detail/score, join-team/join-solo/leave, admin create/patch/delete/teams/pair/build/finish/reopen. Build seeds by combined doubles rating (members.dupr_rating sum, missing = 0, ties to earlier signup), requires 4/6/8/10/12/16 teams. Score endpoint blocks unready matches and an unneeded reset game; changing/clearing a score clears every later match that depended on it. Finish counts only active unscored matches (an unneeded reset game doesn't block finishing).
- server/migrations/014_bracket_nights.sql (79 lines, new) — br_events/br_teams/br_matches/br_solos; matches store slot refs (no FK on refs — they point at earlier matches in the same night, engine is the authority); max_teams CHECK IN (4,6,8,10,12,16); br_teams.seed NULL until built.
- server/index.js — mounts brRoutes under /api (2 lines).
- public/app.js (+723 lines) — router #/bracket + #/bracket/:id; Bracket card on Admin home; landing "Bracket — sign-ups open" card (fee per person shown, same as RR — no payment collection); Admin btnrow Bracket link; Admin "Bracket" section with dark create card (brc- ids: name/date/6:30 PM/kind toggle Money Ball $10 default/Teams picker 4-16 default 12/signups close/payout/publish ON default); renderBrList/renderBrEvent/renderBrScoreView mirroring the RR views (reuses rrSearchPeople/rrPersonRowHtml/rrWhen/rrCloseLabel/rrMoney/rrKindLabel/rrStatusLabel/rrPayoutLabel). Seed chips #1..#N on every team row; undecided slots read "Winner · Winners Quarterfinal · Game 2". Money pot card with W-L records; free-play Winners card (champion/runner-up/3rd) only once finished — no Leaders card while playing, a bracket has no standings order until it resolves.
- public/styles.css — .br-seed (yellow pill) + .br-slot-wait (muted italic). All other bracket styling reuses .rr-* classes.
- scripts/test-bracket.js (279 lines, new) — headless engine tests.
Judgment calls (flag to Alan): (1) SCORE buttons sit on EVERY match whose teams are both decided (a bracket plays several matches at once — the whole play-in round is ready on night one), not only on one "round in play"; rounds stay in bracket order with Now playing / Completed / Waiting badges instead of being reordered like RR. (2) No court assignment on bracket matches (the engine doesn't schedule courts). (3) A bracket night only comes in 4/6/8/10/12/16 teams — if e.g. 9 teams sign up, Build refuses with "Add or remove a team"; the create card's Teams picker is the cap and the bracket size. (4) The 4-place payout split is not offered on bracket nights (create card or night settings) — a bracket only decides 1st/2nd/3rd, so there is no 4th-place team to pay. (5) Seeding counts a player with no rating on file as 0. (6) Fees follow the RR pattern exactly: fee per person shown on the landing card, list, and pot card; paid offline, nothing collected.
Tests (all local, no DB available — no Postgres/Docker on this machine, same gap as 007/008): node scripts/test-bracket.js passes — seedOrder 4/8/16, per-size counts (stored 2n-1: WB n-1, LB n-2, GF 2; games to a champion 2n-2 +1 reset), bye seeds are exactly the top B-n, reference-graph invariants (every winner advances exactly once, WB losers drop exactly once, LB losers eliminated), 200 random full nights per size (every non-champion exactly 2 losses, every team ≥2 games, champion ≤1 loss, 3rd decided), exact 12-team WB/LB tables from the inspection, two scripted 4-team nights (WB champ wins GF1 → no reset; LB champ wins GF1 → reset decides it), cascade-clear dependents, buildBracket(9) throws, empty-matches places/records don't throw. Round titles verified by extracting brRoundTitle from app.js and checking every round of every size (incl. the 2-match play-in at 6/10 teams, which the first draft mislabeled "Semifinal" — fixed by checking play-in before count). node --check OK on app.js, bracket.js, routes/bracket.js, index.js. Express app loads with 16 bracket + 16 RR routes registered (85 total), no conflicts. Client/server endpoint names match (public + admin). No stray `if (!league) return;` (0). No new ReClique mentions (6 lines in app.js, all pre-existing). RR functions intact (renderRREvent/renderRRList/renderRRScoreView all still present).
NOT verified: migration 014 never run against a real DB — watch the first Render deploy log for 014 applying; client bracket flow code-reviewed only, not run in a browser; no live verification yet. Two bugs were caught and fixed during the build, before any push: (a) computeBracketPlaces threw on a setup night with no matches (gf1 undefined) — now returns all-null; (b) the round-title play-in check (above).
PENDING: parent pushes via GitHub connector → verify GitHub raw + live md5s, GET /api/bracket/events returns [], create a test night live (or Alan creates one), then update MEMORY.md.

Ambassadors — BUILT + STAGED 2026-11-24 (Alan approved the preview "Build it, we can modify verbiage when its built"). Mirrors the Admin sign-in system end to end, with its own passcode per ambassador and NO master passcode.
Files (all in the rebuild folder, NOT pushed — parent does the push):
- server/migrations/015_ambassadors.sql (new) — members.is_ambassador BOOLEAN DEFAULT FALSE (nobody pre-marked); ambassador_passcodes (person_id PK, SHA-256 hash only); ambassador_passcode_attempts (per-ambassador lockout); ambassador_tokens (token_hash PK, person_id, expires_at) + expires index.
- server/lib/auth.js — checkAmbassadorPasscode returns 'ok'/'not-set'/'wrong', no master fallback; issueAmbToken/revokeAmbToken/isValidAmbToken/ambTokenFromReq (mpa_ambassador cookie)/ambassadorIdentity (name + DUPR rating for the home page)/requireAmbassador/isAmbassador. Lockout helpers now take an optional table param (validated to admin_ or ambassador_passcode_attempts, default admin) — existing admin calls unchanged.
- server/routes/api.js (+7 routes) — POST /api/ambassador/login (flagged ambassador only, per-ambassador lock check, 429 when locked), POST /api/ambassador/logout, GET /api/ambassador/me (ambassador/name/personId/duprRating/selfRated), GET /api/ambassador/list (public names), GET/POST/DELETE /api/ambassador/passcodes (Admin-only, min 4 chars, hash only).
- server/routes/people.js — PATCH /admin/members accepts isAmbassador (mirror of isAdmin; NO last-ambassador guard — with nobody flagged the tab just shows "no ambassadors flagged yet").
- public/index.html — Ambassadors link in the header, always visible (unlike the Admin link, which shows only while signed in as Admin).
- public/app.js — router #/ambassadors; renderAmbassadors(): sign-in screen (pick a flagged ambassador, enter your own passcode, mirrors Admin sign-in) then the home: "Signed in as {name}", Sign out, Who you are (name + DUPR/Self-rated rating), What ambassadors do (Alan's exact four duties), Who you've brought in ("Nobody yet — invite tracking isn't built yet"), Your invite tools (Copy app link + Copy how-joining link, clipboard with a long-press fallback). Admin page: "Make ambassador" switch in Members → Edit (saves isAmbassador), AMBASSADOR badge on the Members list, "Ambassador passcodes" section (set/change/remove, apc- ids) after Admin passcodes.
- public/styles.css — .sec-ambpasscodes header color #8e44ad (added — without it the section title is invisible) + .amb-badge (green pill).
Separation is structural: ambassador tokens live in ambassador_tokens with the mpa_ambassador cookie; admin tokens in admin_tokens with mpa_admin. Neither helper reads the other's table or cookie, so an ambassador token cannot grant Admin access and vice versa.
Tests (all local, no DB available — no Postgres on this machine, same gap as 007/008/014): node --check OK on auth.js, api.js, people.js, app.js, index.js, db.js. checkAmbassadorPasscode logic tested headless (ok/wrong/not-set, no master even for person 1; admin master behavior unchanged). Express app loads with all 7 ambassador routes registered (92 total routes, was 85) and all 10 admin auth routes intact. Client/server endpoint names match. ReClique mentions unchanged (5 case-sensitive lines, all pre-existing).
NOT verified: migration 015 never run against a real DB — watch the first Render deploy log for 015 applying; client ambassador flow code-reviewed only, not run in a browser; no live verification yet.
PENDING: parent pushes via GitHub connector → verify GitHub raw + live md5s, GET /api/ambassador/list returns [], flag a test ambassador + set a passcode + sign in live, then update MEMORY.md.

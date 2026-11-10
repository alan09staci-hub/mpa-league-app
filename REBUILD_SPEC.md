# MPA League App — Public Rebuild Spec

## Purpose
Rebuild the Moultrie Pickleball Association league app as a real public web app
so **every player can open it on their own phone**, see the stats, open Current
Game Day when matches start, and log scores for their court.

## Reference — DO NOT TOUCH
The current app lives in Muse as artifact `pickleball-league-app` (a fullstack
app). It stays exactly as it is, untouched, as the reference to bounce the
rebuild off. Never edit it, never delete it, never copy its data out of Muse
by any means other than what this spec states. The rebuild is a **separate new
codebase** under `~/workspace/goals/pickleball-league-app/rebuild/`.

The public signup page (static, already live at
https://capable-blini-464d32.netlify.app) is a separate thing and stays as it
is. Do not rebuild it in Phase 1.

## Stack (keep it simple — Alan does not code; someone must maintain this)
- Node.js + Express, plain HTML/CSS/JS frontend (no heavy framework).
- Postgres database.
- `render.yaml` declaring a web service + Postgres database, ready to deploy
  to Render (paid tiers only: ~$7/mo web + ~$6/mo Postgres = ~$13/mo; the
  free web tier sleeps and free Postgres deletes data after 30 days — do not
  use them).
- A README explaining how to run it locally, how to deploy, and how to back
  up the database.
- Mobile-first responsive design. Players use phones courtside.

## Data — start fresh
Do NOT migrate the test data. The go-live plan is to delete the test league
and go live fresh, so the rebuilt app starts empty. Alan creates leagues
through the Create-a-league form (he has done this before).

## Data model
- `people`: one record per person (name, DUPR id, DUPR doubles rating, DUPR
  profile link, photo, resides, age, country). A person is never duplicated.
- `player_leagues` (junction): one person can be on the roster of several
  leagues; each league keeps its own standings, misses, and Admin penalty.
  Removing a person removes them from that league only.
- `members`: free MPA members (name, email, phone, DUPR id/rating/profile
  link, photo, resides/age/country, joined date). Email/phone are Admin-only,
  never shown on public pages.
- `registrations`: league signups (person name, league, DUPR id/rating,
  membership type member $20 / non-member $50, status pending/confirmed/
  added, fee waived flag per league).
- `leagues`: name, type (Intermediate, Intermediate/Advanced, Advanced,
  Elite, Women's), skill (2.5-2.99, 3.0-3.49, 3.5-4.49, 5.0-ABOVE, 50+),
  format (Coed / Women's / Men's Doubles, Ladder Scramble), day, time,
  season (Winter/Spring/Summer/Fall + year, may be blank), start/stop dates,
  8 weekly game-day dates (each individually editable), location, max players
  (default 36), logo color (e.g. pink for Women's, black-yellow for Advanced).
- `sessions`: one per game day per league (date, time, status
  upcoming/in_progress/completed, label).
- `session_players`: opt-in state per player per session (opted in, opt-in
  timestamp, checked in — opting in IS checking in).
- `matches`: court, round, players (2v2), scores, bye rounds included.
- `rank_snapshots`: rank per player saved when a session is completed
  (drives Previous and Max Mvmt columns; reopening a session removes its
  snapshot).
- `league_settings`: registration open/closed per league (defaults Open).

## League rules (all decided by Alan — do not change)
- 60 points per player per session. Games to 15, except court-size builds:
  4 on a court = 3 games to 20 each; 5 on a court = 4 games to 15 each with
  1 BYE per game (5 games total); 6 on a court = 6 games to 10 each with
  2 BYEs per game (9 games total).
- Courts of 4–6 players, assigned by league standings (top players Court 1),
  same court for the whole session. Max 6 courts, max 36 players per league.
- 8-week seasons.
- Standings: E/P Diff% = Earned / Possible. Rank by **E/P Diff% − Penalty**.
  Tie-break: Match Wins, then higher ranked previous week. Columns: Rank,
  Previous, Max Mvmt, E/P Diff%, Penalty, E/P Diff% − Penalty, Earned,
  Against, Possible, Wins, Losses, # Played, # Missed, Miss Cur Game Day.
- Miss penalty (automatic): 1st miss free, 2nd miss 2.5 points off E/P
  Diff%, 3rd 5.0, each further miss +2.5. Only sessions on/after the day the
  player joined the roster count. Admin can add a manual adjustment on top.
- Defined Admin adjustment penalty: unsportsmanlike conduct, 2.5 points.
  DUPR falsification is NOT a points penalty (a DUPR account is required to
  be a free member; falsification is a removal matter).
- Max Movement Rule: 20% of league size, floored (7 for a 36-player league).
  The Y flag marks a player who moved the maximum in either direction OR did
  not play that week; absent players CANNOT move up. (The current Muse app
  still only flags the biggest climber — the rebuild implements the stated
  rule, not the bug.)
- First game night seeding: by DUPR rating, highest to lowest, until the
  first session is completed; then E/P governs. Unrated players below rated.
- Opt-in opens 1 hour after the current game starts (7:30 PM Saturday for a
  6:30 PM game). Opt-in deadline 3 hours before game time (3:30 PM).
  Groups and matches reveal at the deadline. Schedule auto-generates when
  the game day loads after the deadline, from opted-in players.
- Admin can add a walk-in or remove a no-show and courts auto-refresh in
  place; a game whose same four players stay together keeps its score.
- Finish game day is Admin-only; asks "finish anyway?" if games are
  unscored; completing snapshots ranks and rolls Current Game Day to the
  next week.
- A player must have a DUPR account to be part of MPA. DUPR rating is
  self-reported (player supplies ID + rating, admin verifies on DUPR). There
  is NO live DUPR sync and no DUPR API. DUPR sign-up:
  https://dashboard.dupr.com/signup
- Joining costs $20 (YMCA member) / $50 (non-member), paid on ReClique
  (https://moultrie.recliquecore.com/). There is no ReClique API and no
  payment verification — the Pay button is a link out. Payment-first is the
  intended policy but NOT enforced in the app yet (on hold until the YMCA
  gives clear instruction). Do not build a payment gate in Phase 1.
- YMCA: 601 26th Ave SE, Moultrie, GA 31768. Courts are lighted. Facility:
  Surface Pickleball Hardcourt, Play Area Outdoor Non-Covered, Net Permanent,
  Ball Franklin X40, Courts 12, Parking No Fee, Lighting lighted.
- League: Advanced 2026 — Coed Doubles Ladder Scramble, Saturdays 6:30 PM,
  skill 3.5 and above, Age Any. Women's league — Women's Doubles, Thursdays
  6:30 PM, skill 3.0–3.49. (These are examples of what Alan enters in the
  form; do not hardcode leagues — the form creates them.)

## Screens and behavior

### Cover / welcome page
- Shown only to brand-new visitors. Intro text: "Home of the Moultrie
  Pickleball League at the YMCA in Moultrie, GA. Complete the three steps
  below to become a full member, and the league opens right here."
- Three steps in order: (1) Get a DUPR account, (2) Become a free MPA
  member (with "I'm already a member" Find-my-name inside step 2),
  (3) Join the league. When all three are done, "Enter the league".
- Welcome / Members tabs under the intro; Members shows the member
  directory with no league entry needed.
- A recognized member skips the cover: in a league → "Your league" landing
  page; not in a league → Members page. A new season reaches existing
  members as an "A new season is open" join card; Join opens that league's
  registration prefilled (name + DUPR) at the details step.

### Home page
- MPA logo (black-and-yellow; two yellow paddles behind a ball over a black
  ribbon reading "MPA"). The logo file lives at
  `~/workspace/paddle-options/mpa-logo.webp` — copy it into the rebuild.
- "Become a Member" button; stat boxes (Members first, Tournaments 0,
  Leagues live count, Team Leagues 0).
- Members box → searchable tile directory (photo or initials, name, DUPR
  rating, League player / Member badge; name links to stored DUPR profile
  URL when present, otherwise DUPR ID is plain text; shows Resides/Age/
  Country when provided). No email/phone on public cards.
- Leagues list; a player/member sees only their own league(s); Admin sees
  all leagues through tabs.
- "Add to favorites" persists per device (phone and desktop do not share).
- League cards show the per-league logo color.

### League page — Standings / Schedule / Info tabs
- Standings table with vertical headers (bottom-to-top), the columns listed
  under League rules. Penalty is read-only here. Below the table: the Max
  Movement Rule box and the footer (MPA league name, "at", YMCA address,
  transport icons opening directions in car/walk/transit/bike mode).
- The standings box scrolls left/right with a visible scrollbar, a "scroll
  left and right" hint, and ‹ › arrows.
- Schedule tab: month headers, game day cards (date block, league title,
  association, session label, status badge — grey "Completed" for played
  nights, green "Opt In <date time>" for upcoming). No delete buttons.
- Info tab: League Details, Membership & Participation, Session Details,
  Signup/Payment Type, New Players Start (At Rating), Ranking Type (with the
  miss penalty rule, the Admin Adjustment penalties paragraph, and the DUPR
  seeding rule), Location Information with facility rows.
- Every YMCA address links to a map for "YMCA, 601 26th Ave SE, Moultrie,
  GA 31768" (new tab). First tap offers a Google/Apple Maps chooser,
  remembered on device, with a "Map app: … · Change" control. Apple Maps
  bicycling falls back to driving.

### Current Game Day page
- Header: Back to league / All Game Days, league title, Session number,
  location, day/time, opt-in deadline with live countdown.
- Tabs: RSVPs / Groups / Matches.
- RSVPs: Playing / Not Playing / Total donut; Playing list (search, Sort by
  Rank, checked-in count, rank + name + opt-in time in fine print under each
  name) and Not Playing list (search, Sort by Rank, rank + name, Opt in
  button on the viewer's own row only).
- Groups: court groups split by standings. Matches: "Matches will show once
  the game day starts." before the night; after the reveal, that game day's
  matches with score entry. A finished night shows a read-only banner.
- All Game Days (from league page, game day page, Admin) opens a modal
  titled "Session N - All Game Days" with Current and Past tabs; Current
  lists the season's game days with a green checkmark on completed nights;
  tapping a row opens that game day. Past shows "No past sessions available."

### Player view (the core of this rebuild)
- The game day opens in Player view by default. The player taps their own
  name to identify themself; identity is remembered on the device; their row
  shows a YOU badge.
- Player view shows the complete Playing and Not Playing lists like Admin,
  but Opt in / opt-out controls appear ONLY on the viewer's own row. Only
  the player themself can opt themself in/out.
- Groups and Matches stay hidden until the player picks who they are, opts
  in, and the reveal time (3 hours before game time) passes. After the
  reveal a player sees ONLY their own court and ONLY their court's games,
  with score entry for that court.
- My Dashboard: the player's standings (rank, E/P Diff% − Penalty, record,
  points, game days) and every game they played — partner, opponents, score,
  result — per league.
- My Profile: the player edits their own free-member record (name itself is
  NOT editable). A roster player without a member record gets one created
  on save.
- Account dropdown (avatar with first name) in the headers of the leagues
  landing page, league page, My Leagues hub, and game day page, with only
  My Dashboard, My Profile, and My Leagues. The menu renders only after a
  name is picked on the device.

### Leagues landing page ("Your league")
- After a player picks their name: one card per league they are in; tapping
  opens that league until "← Your leagues" returns to the list. A player in
  no league gets the find-your-name/join path.

### My Leagues hub
- Registered / Managing / Favorites tabs, Active / Past filter, "Search for
  league" box, league cards (MPA logo in per-league color, name, "Moultrie
  Pickleball Association", "Moultrie, GA, USA", skill + Format line, View
  button, player count), grouped by season. An install help card ("Get the
  app on your phone or computer") with Add to Home Screen steps for iPhone,
  Android, and desktop, stating plainly there is no App Store or Google Play
  listing.

### Admin page (ADMIN ONLY heading) — passcode from day one
- The public app MUST have an Admin passcode from the start, applied to the
  Admin page AND the Organizer view, with server-side enforcement on score
  saving, schedule generation, check-in, and opt-in/out of other players.
  (In the Muse app the passcode was deliberately sequenced last; for the
  public rebuild it is a day-one requirement, because anyone can open the
  app.) Alan will choose the passcode when the app is ready; do not invent
  one in the code — make it an environment variable.
- Sections, each collapsible behind a header bar with a chevron and a short
  small-font one-line description under the bold title:
  - Create a league: "Make a new league: name, type, skill, format, day,
    time, and season dates."
  - Registration: "Open or close league sign-ups."
  - Registrations: "People who signed up: confirm them, waive a fee, or
    add them to a league."
  - Members: "Free MPA member directory, with DUPR ratings and an Edit
    button per member."
  - Players: "The league roster: add, edit, or remove players."
  - Standings penalties: "Miss penalties and Admin adjustments per player."
  - Game day tools: "Finish a game day, build the schedule, and print the
    court sheet."
  - Announce this league: "Writes the email and text announcement for a
    league, with copy buttons."
- Create a league form: League Name, Type dropdown, Skill dropdown, Format
  picker, Day and Time dropdowns, Start/Stop calendar pickers for the 8-week
  season, the 8 weekly dates generated from them with each week's date
  individually editable, Season field, Logo color picker with swatches and
  preview. A created league appears in the home Leagues list and opens with
  its own players, game days, standings, and day/time rules.
- Registrations: confirm / add / delete; per-person per-league "Waive fee"
  (shows a green "Fee waived" marker, hides the ReClique Pay button for
  them, undoable). Player rows have the same Waive fee control; the waiver
  follows the person from registration onto their player record.
- Members: Edit per member (name, email, phone, DUPR ID/rating/profile
  link); email/phone visible here only. Add a player form with name
  autocomplete: typing a name offers matching free members and not-yet-added
  registrations, filling DUPR ID, rating, and profile link; people already
  on the roster show "Already in the league" and cannot be picked; a
  brand-new name works as plain manual entry. Adding someone already in
  another league links the same person (DUPR carries over, no duplicate).
- Game day tools: "Game day to finish" picker + Finish game day button;
  Schedule & lineup tools (manual Build/Rebuild — Admin-only); Viewing-as
  Organizer/Player entry (Organizer view shows an "Organizer view" banner
  with a Back to Admin button instead of a switch); All Game Days; printable
  Court Sheet (each court with its players and a check-off box by every
  name, under the date, time, and YMCA address header, with a Print button).
- Announce this league: pick a league and it writes an advertising email
  draft (subject "New MPA league: <name> — join now", body with league
  details, all 8 weekly game days, YMCA address, $20/$50 fee, the 3 steps,
  DUPR sign-up link, Join MPA page link) and a shorter text version. Copy
  buttons copy RICH text so links stay clickable when pasted. A recipient
  list sits beside the drafts ("Who it goes to — MPA members (N)") with
  Copy email addresses / Copy phone numbers buttons. NOTHING is sent by the
  app — no email/SMS dispatch.

## Phase plan
- **Phase 1 (first playable version, ~1 week):** data model + database,
  leagues, game days, RSVPs/opt-in, auto schedule generation, score entry,
  standings, Player view (own court + own scores), Organizer view behind the
  Admin passcode, Admin passcode itself, deployment config. Deployable to
  Render; Alan tests it on his phone against the Muse app.
- **Phase 2 (full parity, ~2–3 weeks total):** cover flow + recognition
  routing, Members directory + Become a Member, join flow + registrations,
  Admin page (all sections), multi-league + landing page + league visibility
  scoping, My Leagues hub, account dropdown + Dashboard/Profile, Announce
  tool, printable Court Sheet, maps chooser, favorites, Create-a-league form.
- **Go-live (separate step, Alan's call):** Render account in Alan's or the
  YMCA's name, fresh data (leagues created through the form), registration
  switch as Alan sets it, public link shared. The Muse app is NOT deleted
  until Alan says so.

## Non-goals / do not build
- No payment verification, no payment gate (on hold until YMCA instruction).
- No live DUPR sync (no API access exists).
- No email/SMS sending from the app (drafts + copy only).
- No App Store / Google Play app (web page + Add to Home Screen).
- Do not invent league details, fees, dates, or rules not in this spec.
- Do not record or repeat Alan's email address or phone number anywhere in
  code, docs, or chat. Refer only to "his email/phone on file."

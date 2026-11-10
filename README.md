# MPA League App — Public Rebuild

The Moultrie Pickleball Association league app, rebuilt as a real public
web app so **every player can open it on their own phone**, see the stats,
open Current Game Day when matches start, and log scores for their court.

> The original app still lives in Muse (artifact `pickleball-league-app`)
> and is **untouched** — it is the reference this rebuild is bounced off.
> This codebase is separate. No data was migrated; the app starts empty
> and leagues are created through the Admin form.

## Stack

- Node.js + Express, plain HTML/CSS/JS frontend (no framework), mobile-first.
- Postgres (local dev: Postgres 16; production: Render Postgres).
- `render.yaml` declares the web service + database for Render.

## Run locally

```bash
npm install
cp .env.example .env   # then set ADMIN_PASSCODE in .env
npm start              # runs migrations, serves on http://localhost:3000
```

Local Postgres (this dev machine): a Postgres 16 cluster is already
running on port 5433 with database `mpa_league` and role `mpa`
(password `mpa_dev` — dev only). If you are setting up on a fresh machine,
install Postgres 16, then:

```bash
createdb -O mpa mpa_league   # as a superuser, after creating role mpa
```

`DATABASE_URL` defaults to
`postgres://mpa:mpa_dev@localhost:5433/mpa_league`. Override it in `.env`.

## Admin passcode

The Admin page and Organizer view are protected by a passcode from day
one. The passcode comes **only** from the `ADMIN_PASSCODE` environment
variable — it is never hardcoded and never stored in the database. If it
is unset, Admin login is disabled and the server logs a warning. A
successful login issues a random token (12-hour httpOnly cookie);
server-side checks enforce it on score saving, schedule generation,
check-in, and opting other players in/out.

## Test

```bash
npm test   # spins up the real server against a throwaway database
```

Covers: passcode login, league creation, roster management, DUPR seeding,
self opt-in windows, manual + automatic schedule generation, the 4/5/6
player court builds, player-scoped score entry (own court only, cross-court
blocked, organizer can score any court), standings math (E/P, miss penalty
ladder, Previous/Max Mvmt, absent-cannot-move-up), finish/reopen and
snapshot handling, and current-game-day roll-forward.

## Deploy to Render

**Do not deploy until the Render account exists** (Alan's or the YMCA's
name). Paid tiers only — the free web tier sleeps after 15 idle minutes
and free Postgres deletes its data after 30 days.

1. Create the Render account.
2. New → Blueprint, point it at this repo (it reads `render.yaml`).
3. In the Render dashboard, set `ADMIN_PASSCODE` on the web service.
   Never put it in this repo.
4. Deploy. `DATABASE_URL` is wired automatically from the database.

Cost: ~$7/mo web (Starter) + ~$6/mo Postgres (Starter) = **~$13/mo**,
plus ~$11/yr if you add a custom domain. Render gives a free
`*.onrender.com` address otherwise. There is no per-player charge —
unlimited players use the app at that price.

## Back up the database

```bash
pg_dump "$DATABASE_URL" -Fc -f mpa-backup.dump   # restore with pg_restore
```

On Render, use the database dashboard's backup feature as well. Back up
before any go-live and weekly during the season.

## Project layout

```
server/
  index.js            Express app + static frontend
  db.js               Postgres pool + migration runner
  migrations/         SQL migrations (001_init.sql = full data model,
                      002_phase2.sql = registration email/phone)
  lib/
    time.js           League-timezone helpers (America/New_York)
    auth.js           Admin passcode sessions
    schedule.js       Court partition + match generation (4/5/6 builds)
    standings.js      E/P Diff%, miss penalty, Max Movement, snapshots
    league.js         Shared loaders, opt-in windows, schedule rebuilds,
                      date normalization (normalizeLeague)
  routes/
    api.js            Public + admin API (leagues, game days, scores)
    people.js         Phase 2 API (members, registrations, dashboard,
                      profile, announce, logo color)
public/
  index.html app.js styles.css   Mobile-first SPA (cover, landing,
                      members, join, hub, dashboard, profile, court
                      sheet, Admin)
  mpa-logo.webp       MPA logo (black & yellow)
scripts/
  test-phase1.js      End-to-end test suite (Phase 1)
  test-phase2.js      End-to-end test suite (Phase 2)
render.yaml           Render web service + Postgres (paid tiers)
```

## Phase 1 scope (built) vs Phase 2 (built)

Built (Phase 1): data model + Postgres, leagues, game days, RSVPs/opt-in, auto
schedule generation, score entry, standings, Player view (own court +
own scores), Organizer view behind the Admin passcode, Admin passcode,
deployment config.

Built (Phase 2): cover flow + recognition routing, Members directory +
Become a Member, join flow + registrations, full Admin page sections
(Registrations, Members, Standings penalties, Announce — drafts + rich-text
copy only, no sending), multi-league landing page + league visibility
scoping, My Leagues hub, account dropdown + Dashboard/Profile, Announce
tool, printable Court Sheet, maps chooser, favorites, Create-a-league form
with per-week date editing. See `PROGRESS.md`.

Not yet: deployment to Render (needs the Render account) and Alan's
testing rounds.

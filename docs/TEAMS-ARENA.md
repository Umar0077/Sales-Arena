# Teams Arena and Senior / Junior bonuses

## What it is

A fifth Live Arena screen, **Teams Arena**, comparing Team Alpha, Team Panthers and Team Sigma (or any teams the
Admin creates): three ranked team cards with the official logos, the overall top 3 performers, and a full
leaderboard per team (every member, including members with no leads or sales yet).

It is a display / analytics feature. Team ranks, crowns and animations never create or change a reward, a spin
or a payment.

## Layout follows the number of ACTIVE teams (no code change needed)

| Active teams | Teams Arena shows |
| --- | --- |
| 0 | An empty state ("set up teams in Team Management") |
| 1 | Single-team spotlight (no "winner" of a one-team race) |
| 2 | Head-to-head: "PANTHERS VS SIGMA", the current leader on the LEFT (gold frame, crown, lifted), 2nd on the right (silver), a VS emblem with the share of validated sales. A tie (equal validated AND submitted) is neutral: both "TIED", same size, no gold. |
| 3 | Three ranked cards, 1st on the left and in front |
| 4+ | A responsive grid; every team kept at a readable card width (the page scrolls rather than shrinking cards) |

Every team shows its own Top 3 under its card (fewer if it has fewer members). Archived (inactive) teams and their
members never appear in the live competition or in the overall Top Performers.

## Team sale celebrations (Teams Arena only)

On a display showing **Teams Arena**, a validated sale of a competing team plays that team's celebration
**instead of** the standard sale card: "TEAM SIGMA GOT A SALE!" with the Owner's lion emblem, "TEAM PANTHERS GOT A
SALE!" with the Owner's panther emblem, and, for any other team (including teams created later), "{TEAM NAME} GOT A
SALE!" with its own crest (initials when it has no logo). Always with the real closer's name; the team's validated
total is added only once the standings have refreshed past the figure at arrival (never guessed).

| Screen on this display | What a validated sale shows |
| --- | --- |
| Teams Arena | the team celebration (one per sale), or the standard sale card when attribution is not safe (below) |
| Daily / Weekly / Monthly / Spin & Win | the existing sale card, unchanged |

Each display decides from its own screen, so two displays can present the same sale differently.

**Attribution** (server, read-only, after the sale is committed): the agent's `user_code` (never a display name) and
the sale's business day in the configured timezone (America/New_York): the team the agent belonged to that day.
It is sent on the existing `sale.validated` event and in the background-sync recovery list (no extra request,
stream or timer). Uploaded logos are not sent on the event; displays use their own standings copy.

| Case | Presentation |
| --- | --- |
| Transfer (e.g. Sigma → Panthers from Nov 5) | sale's business day before Nov 5 → Sigma, on / after → Panthers |
| Unassigned agent | standard sale card |
| Archived (inactive) team, or a team not on this display's standings | standard sale card (never another team's emblem) |
| No attribution sent (lookup failed / older server) | standard sale card |
| Duplicate display names | no effect (by user_code) |
| Team renamed while the sale waits | the current name from the standings |
| Team archived while the sale waits | re-checked at show time → standard sale card |
| Late sale from Safe Quote | attributed by its own business day; shown if within the existing recovery window |

**Queue**: the existing dedupe (case id) plus the celebration layer's own memory, so stream, background sync,
reconnects, other tabs and period switches never replay a sale. One celebration at a time, in arrival order
(~5.6 s each; Lite 4.2 s; reduced motion 3.8 s). Bonus popups keep priority: a waiting celebration never starts
while a bonus is queued or open (it follows after), a celebration already on screen finishes first. The two never
overlap and the bonus stays the agent's individual award (the celebration shows no money). Leaving Teams Arena
hands any waiting celebration back to the standard sale card.

**Artwork**: `public/teams/celebrations/sigma-lion-emblem.webp` and `panthers-panther-emblem.webp`, converted
(2× high-quality resample to 1332 × 750, lossless WebP) from the Owner's transparent line-art PNGs (kept in
`assets/teams/originals/` as `Sigma Lion Emblem (transparent).png` / `Panthers Panther Emblem (transparent).png`);
the artwork is not edited. It is shown whole (contain, centred, never stretched) on a backlight (warm ivory-gold
for Sigma, cool ice for Panthers) so the black linework reads clearly on the dark arena. To change an emblem,
replace the WebP at the same path. Motion is layered (3D-style entrance, parallax, light pass, glowing edge).

**Admin → Celebrations → Teams Arena sale celebrations**: on / off, sounds on / off (also follows the master
sound, volume and the Sale category), Full / Lite, and Sigma / Panthers / other-team previews that run only on the
Admin's own screen (no request, no sale, no award, nothing sent to displays).

## Owner: switch to Panthers vs Sigma (archive Team Alpha) and reorganise members

Nothing happens automatically. In Admin → Team Management:

1. **Teams** tab → Team Alpha → **Archive (deactivate)** → confirm. Alpha leaves the live arena at once (head-to-head
   appears); its members stay assigned to Alpha (nobody is moved), and its history, sales and awards are untouched.
   **Reactivate** brings it back at any time.
2. **Members & agents** tab → Team filter "Team Alpha (archived)" → for each member, **Move** → choose Panthers or
   Sigma (or another team) and the effective business date → check the preview → **Confirm transfer**. The old
   membership is closed (kept in history), the new one starts that day; earlier days keep counting for Alpha.
   Members you leave on archived Alpha are simply not in the live competition.
3. Optional: set designations (Senior / Junior from a date) in the same list; add new teams with **Create a team**
   (name, logo upload with preview, colours, leader, active).

## Where the numbers come from

| Figure | Source |
| --- | --- |
| Submitted leads, validated sales, close rate | Safe Quote's per-closer figures for the period: the same numbers as the Daily / Weekly / Monthly screens (one request per date range, cached 5 s, shared by all displays for 2 s) |
| Teams, members, Senior / Junior | PostgreSQL: `teams`, `team_memberships`, `agent_designations` (migration 010) |

Ranking: validated sales, then submitted leads, then (teams) the Admin display order / (members) the name. Equal
validated and submitted figures share a placement. Never random, never by cash.

**Team attribution policy (effective-dated by business day).** Each business day's figures count for the team
the agent belonged to on that day. When an agent transfers inside the selected period, their figures are fetched
separately for the days before and after the transfer, so a transfer never moves past results.

Live updates reuse what is already there: a validated sale on the live stream (or the 15 s background sync, or
the 3-minute full refresh) refreshes the live data, and the Teams Arena reloads its standings after that; team
changes arrive as the `teams.updated` stream event and in the background-sync fingerprint. No extra stream
connection and no timer of its own. Sale and bonus popups, Arena Cub reactions and reconnect recovery are the
existing ones and work on every screen.

## Owner approvals before go-live (nothing happens automatically)

1. **Initial roster import**: Admin → Team Management → *Initial roster import* (Owner only).
   * The preview is read-only. It matches each roster name against the agents table and Safe Quote's closer list:
     *exact* (identical name, pre-selected), *possible* (e.g. "Adeel Afzal" → "Muhammad Adeel Afzal"),
     *multiple* (e.g. "Uswah" is close to both "Urwah Malik" and "Uswa E Husna"), *unmatched* (no Safe Quote
     closer yet; a user code is never invented).
   * Header-row names (Imad Tariq, Ismail, Jeff) are offered only as optional team leaders, never as members.
   * Choose the identities, the effective date (default: the 1st of the current business month), tick the
     confirmation, import. One transaction, audited. Unmatched people stay unassigned; add them later (Members tab)
     once they have a Safe Quote user code.
2. **Teams Arena screen**: Admin → Reward Programs → Arena Display: enable *Teams Arena* (off by default), choose
   whether its tab is shown, optionally make it the default screen or use *Switch the Live Arena now*. Direct link:
   `/?screen=teams`.
3. **Senior-only bonuses**: Admin → Reward Programs → Daily / Weekly / Monthly → *Senior Bonuses* → *Senior / Junior
   eligibility review* (Owner only). Existing programmes are "all agents" until this is applied. The preview lists
   the programmes, who keeps qualifying (Seniors), who stops (Juniors, and agents with no designation yet: designate
   them first) and the existing awards, which are never changed. Apply with a reason.
4. **Junior bonuses**: none exist. When management decides amounts, create them under *Junior Bonuses*. They use
   the same engine (highest tier, upgrades, Award History, popups, Missing Awards) with their own `junior…`
   reward group, so they never replace a Senior tier. A Junior programme cannot be activated while an "all agents"
   programme of the same period is still active (step 3 first).

## Deployment (combined release: real-time delivery + Teams Arena)

1. Fresh, verified `pg_dump` of production.
2. Build the new commit in an isolated release directory: `npm ci`, `npm run typecheck`, `npm run build`.
3. Migration: `node --env-file=<production env file> scripts/db-migrate.mjs status`, then `… up` (applies
   `010_teams_arena`: new tables, new nullable / defaulted columns, no data change). Check `status` again.
4. Switch the `sales-arena` service to the new release. Open displays reconnect by themselves.
5. Smoke tests: `/api/arena/sync`, `/api/arena/teams?period=day` (no teams yet: empty list), the stream, Admin →
   System Health → Live delivery, Admin → Team Management loads, existing screens unchanged, Award History totals
   unchanged.
6. Owner approvals above, in order.

Rollback: switch the service back to the previous release. Migration 010 is additive and the previous release
ignores the new tables / columns, so the database does not need to be restored. If the Owner already applied
the Senior-only change and wants it undone, restore the programme rows from the backup or ask for a reverse
(audited) change; awards are never affected either way.

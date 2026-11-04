# Teams Arena and Senior / Junior bonuses

## What it is

A fifth Live Arena screen, **Teams Arena**, comparing Team Alpha, Team Panthers and Team Sigma (or any teams the
Admin creates): three ranked team cards with the official logos, the overall top 3 performers, and a full
leaderboard per team (every member, including members with no leads or sales yet).

It is a display / analytics feature. Team ranks, crowns and animations never create or change a reward, a spin
or a payment.

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

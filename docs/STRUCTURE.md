# Repository structure

FE Sales Arena is one Next.js 16 (App Router) application. The code is grouped by where it runs; this is a
layout convention only: there is still one app, one build, one server process and the same `@/` import alias
(`@/*` → repository root).

```
app/            Next.js routes, layouts, route handlers (app/api), globals.css, icons      (framework-required)
proxy.ts        request proxy: IP perimeter + admin gate                                    (framework-required)
instrumentation.ts  server start-up hook (starts the Safe Quote sales sync)                 (framework-required)

frontend/       browser code
  components/   React UI: arena screens, admin panel, celebrations, Arena Cub, spin flow, layout …
  stores/       Zustand stores (client state)
  hooks/        React hooks (Teams Arena standings)
  live/         live delivery in the browser: SSE stream, background sync, config / display sync, latency
  cub/          Arena Cub behaviour (state machine, director, motion, phrases, sounds)
  audio/        sound engine and synthesized sounds (incl. Teams Arena stingers)
  events/       in-browser event bus
  performance/  quality, reduced motion, frame monitor
  admin/        admin settings client (saves global settings)
  rewards/      demo-mode reward engine (live awards come from the server)
  mock-api/     demo data seed
  features/     browser-only domain helpers (celebration tiers, wheel maths / theme, targets, stats, reward validation)

backend/        server-only code (imported by app/api route handlers, proxy.ts, instrumentation.ts)
  auth/ security/ settings/ events/ live/ sales/ safequote/ rewards/ spins/ targets/ teams/ cub/

database/       PostgreSQL: connection pool (client.ts), migration runner (migrate-core.mjs), status (migrations.ts)
  migrations/   versioned SQL migrations 001 – 010 (contents unchanged)

shared/         environment-neutral code imported by BOTH browser and server: types, business calendar, settings
                defaults and keys, IP / CIDR maths, team ranking / matching / roster / celebration rules, Arena Cub
                config and actions, target maths, lead counting and the arena data shape, cn()/utils

public/         files served as-is (URLs unchanged)        assets/   source artwork (not served)
scripts/        operational CLIs (db-migrate, create-admin, import-sales, ip-security, benchmarks)
tests/          unit/ integration/ e2e/ (unchanged layout)  docs/     documentation
```

## Boundaries (checked after the reorganisation)

| From | May import |
| --- | --- |
| `shared/` | `shared/` and npm packages only (no React state, no Node/database code) |
| `frontend/` | `frontend/`, `shared/` (never `backend/` or `database/`) |
| `backend/` | `backend/`, `database/`, `shared/` (never `frontend/`) |
| `database/` | itself only |
| `app/` | route files and API handlers import from all of the above as before; client pages never import `backend/` or `database/` |

## Kept in place, and why

* `app/**`, `proxy.ts`, `instrumentation.ts`, `next.config.ts`, `postcss.config.mjs`, `tsconfig.json`, `eslint.config.mjs`,
  `vitest*.config.ts`, `playwright*.config.ts`: locations required by Next.js or by the tools that discover them.
* `app/globals.css`: the global stylesheet loaded by the root layout; moving it changes nothing useful and risks
  CSS order. Tailwind scans the whole repository, so the moved components are compiled exactly as before.
* `public/**`: served URLs must not change. `assets/**`: already separate source artwork.
* `scripts/**`: the operational commands (`npm run db:migrate`, `node scripts/db-migrate.mjs status|up`, …) are
  unchanged; `db-migrate.mjs` imports the runner from `database/`.
* `tests/**`: already split into unit / integration / e2e.

## Migrations

The migration runner (`database/migrate-core.mjs`) applies a fixed, ordered list of versions and records each
file's SHA-256. Only the folder it reads moved (`lib/server/db/migrations` → `database/migrations`, the files moved
with `git mv`, contents byte-identical): the version list and all ten checksums were verified identical before and
after the move, so an existing database sees no pending or changed migration.

## Old → new paths (189 files)

| Old path | New path |
| --- | --- |
| `lib/server/auth/arena-device.ts` | `backend/auth/arena-device.ts` |
| `lib/server/auth/guard.ts` | `backend/auth/guard.ts` |
| `lib/server/auth/password.ts` | `backend/auth/password.ts` |
| `lib/server/auth/rate-limit.ts` | `backend/auth/rate-limit.ts` |
| `lib/server/auth/session.ts` | `backend/auth/session.ts` |
| `lib/server/cub/acks.ts` | `backend/cub/acks.ts` |
| `lib/server/cub/activity.ts` | `backend/cub/activity.ts` |
| `lib/server/cub/commands.ts` | `backend/cub/commands.ts` |
| `lib/server/events/broadcaster.ts` | `backend/events/broadcaster.ts` |
| `lib/server/events/pg-bus.ts` | `backend/events/pg-bus.ts` |
| `lib/server/live/sync-state.ts` | `backend/live/sync-state.ts` |
| `lib/server/rewards/audience.ts` | `backend/rewards/audience.ts` |
| `lib/server/rewards/awards.ts` | `backend/rewards/awards.ts` |
| `lib/server/rewards/catalog.ts` | `backend/rewards/catalog.ts` |
| `lib/server/rewards/engine.ts` | `backend/rewards/engine.ts` |
| `lib/server/rewards/program-admin.ts` | `backend/rewards/program-admin.ts` |
| `lib/server/rewards/programs.ts` | `backend/rewards/programs.ts` |
| `lib/server/rewards/recovery.ts` | `backend/rewards/recovery.ts` |
| `lib/server/safequote/client.ts` | `backend/safequote/client.ts` |
| `lib/server/safequote/errors.ts` | `backend/safequote/errors.ts` |
| `lib/server/safequote/mapper.ts` | `backend/safequote/mapper.ts` |
| `lib/server/safequote/reconciliation.ts` | `backend/safequote/reconciliation.ts` |
| `lib/server/safequote/schemas.ts` | `backend/safequote/schemas.ts` |
| `lib/server/safequote/sse-consumer.ts` | `backend/safequote/sse-consumer.ts` |
| `lib/server/safequote/sse-parser.ts` | `backend/safequote/sse-parser.ts` |
| `lib/server/sales/delivery-trace.ts` | `backend/sales/delivery-trace.ts` |
| `lib/server/sales/delivery.ts` | `backend/sales/delivery.ts` |
| `lib/server/sales/ingest.ts` | `backend/sales/ingest.ts` |
| `lib/server/sales/scheduler.ts` | `backend/sales/scheduler.ts` |
| `lib/server/sales/sync.ts` | `backend/sales/sync.ts` |
| `lib/server/security/client-ip.ts` | `backend/security/client-ip.ts` |
| `lib/server/security/enforce.ts` | `backend/security/enforce.ts` |
| `lib/server/security/http.ts` | `backend/security/http.ts` |
| `lib/server/security/ip-admin.ts` | `backend/security/ip-admin.ts` |
| `lib/server/security/ip-policy.ts` | `backend/security/ip-policy.ts` |
| `lib/server/settings/arena-config.ts` | `backend/settings/arena-config.ts` |
| `lib/server/settings/display.ts` | `backend/settings/display.ts` |
| `lib/server/spins/execute.ts` | `backend/spins/execute.ts` |
| `lib/server/spins/http.ts` | `backend/spins/http.ts` |
| `lib/server/spins/ledger.ts` | `backend/spins/ledger.ts` |
| `lib/server/spins/prizes.ts` | `backend/spins/prizes.ts` |
| `lib/server/spins/rules.ts` | `backend/spins/rules.ts` |
| `lib/server/targets/store.ts` | `backend/targets/store.ts` |
| `lib/server/teams/attribution.ts` | `backend/teams/attribution.ts` |
| `lib/server/teams/http.ts` | `backend/teams/http.ts` |
| `lib/server/teams/repo.ts` | `backend/teams/repo.ts` |
| `lib/server/teams/roster-import.ts` | `backend/teams/roster-import.ts` |
| `lib/server/teams/standings.ts` | `backend/teams/standings.ts` |
| `lib/server/db/client.ts` | `database/client.ts` |
| `lib/server/db/migrate-core.d.mts` | `database/migrate-core.d.mts` |
| `lib/server/db/migrate-core.mjs` | `database/migrate-core.mjs` |
| `lib/server/db/migrations.ts` | `database/migrations.ts` |
| `lib/server/db/migrations/001_initial_schema.sql` | `database/migrations/001_initial_schema.sql` |
| `lib/server/db/migrations/002_admin_auth.sql` | `database/migrations/002_admin_auth.sql` |
| `lib/server/db/migrations/003_spin_credit_ledger.sql` | `database/migrations/003_spin_credit_ledger.sql` |
| `lib/server/db/migrations/004_sync_eligibility_devices.sql` | `database/migrations/004_sync_eligibility_devices.sql` |
| `lib/server/db/migrations/005_sales_targets.sql` | `database/migrations/005_sales_targets.sql` |
| `lib/server/db/migrations/006_reward_programs_v2.sql` | `database/migrations/006_reward_programs_v2.sql` |
| `lib/server/db/migrations/007_ip_perimeter_security.sql` | `database/migrations/007_ip_perimeter_security.sql` |
| `lib/server/db/migrations/008_bonus_award_recovery.sql` | `database/migrations/008_bonus_award_recovery.sql` |
| `lib/server/db/migrations/009_highest_tier_rewards.sql` | `database/migrations/009_highest_tier_rewards.sql` |
| `lib/server/db/migrations/010_teams_arena.sql` | `database/migrations/010_teams_arena.sql` |
| `lib/admin/global-settings.ts` | `frontend/admin/global-settings.ts` |
| `lib/audio/engine.ts` | `frontend/audio/engine.ts` |
| `lib/audio/synth.ts` | `frontend/audio/synth.ts` |
| `lib/audio/team-stingers.ts` | `frontend/audio/team-stingers.ts` |
| `components/admin/admin-api.ts` | `frontend/components/admin/admin-api.ts` |
| `components/admin/AdminLiveSync.tsx` | `frontend/components/admin/AdminLiveSync.tsx` |
| `components/admin/AdminShell.tsx` | `frontend/components/admin/AdminShell.tsx` |
| `components/admin/cub/ArenaCubSettings.tsx` | `frontend/components/admin/cub/ArenaCubSettings.tsx` |
| `components/admin/GlobalPerformanceCard.tsx` | `frontend/components/admin/GlobalPerformanceCard.tsx` |
| `components/admin/LiveDeliveryPanel.tsx` | `frontend/components/admin/LiveDeliveryPanel.tsx` |
| `components/admin/LoginForm.tsx` | `frontend/components/admin/LoginForm.tsx` |
| `components/admin/rewards/AudienceReview.tsx` | `frontend/components/admin/rewards/AudienceReview.tsx` |
| `components/admin/rewards/AwardHistoryTab.tsx` | `frontend/components/admin/rewards/AwardHistoryTab.tsx` |
| `components/admin/rewards/ProgramMaintenance.tsx` | `frontend/components/admin/rewards/ProgramMaintenance.tsx` |
| `components/admin/rewards/ProgramsTab.tsx` | `frontend/components/admin/rewards/ProgramsTab.tsx` |
| `components/admin/rewards/RecoveryPanel.tsx` | `frontend/components/admin/rewards/RecoveryPanel.tsx` |
| `components/admin/SpinnerPreview.tsx` | `frontend/components/admin/SpinnerPreview.tsx` |
| `components/admin/spins/AllocateTab.tsx` | `frontend/components/admin/spins/AllocateTab.tsx` |
| `components/admin/spins/BalancesTab.tsx` | `frontend/components/admin/spins/BalancesTab.tsx` |
| `components/admin/spins/DevicesTab.tsx` | `frontend/components/admin/spins/DevicesTab.tsx` |
| `components/admin/spins/HistoryTab.tsx` | `frontend/components/admin/spins/HistoryTab.tsx` |
| `components/admin/spins/PrizesTab.tsx` | `frontend/components/admin/spins/PrizesTab.tsx` |
| `components/admin/spins/RulesTab.tsx` | `frontend/components/admin/spins/RulesTab.tsx` |
| `components/admin/spins/shared.tsx` | `frontend/components/admin/spins/shared.tsx` |
| `components/admin/teams/TeamCelebrationSettings.tsx` | `frontend/components/admin/teams/TeamCelebrationSettings.tsx` |
| `components/admin/teams/TeamManagement.tsx` | `frontend/components/admin/teams/TeamManagement.tsx` |
| `components/admin/ui.tsx` | `frontend/components/admin/ui.tsx` |
| `components/arena/AnimatedCounter.tsx` | `frontend/components/arena/AnimatedCounter.tsx` |
| `components/arena/ArenaEventBridge.tsx` | `frontend/components/arena/ArenaEventBridge.tsx` |
| `components/arena/ArenaLeaderboard.tsx` | `frontend/components/arena/ArenaLeaderboard.tsx` |
| `components/arena/ArenaLiveActivity.tsx` | `frontend/components/arena/ArenaLiveActivity.tsx` |
| `components/arena/ArenaSwitch.tsx` | `frontend/components/arena/ArenaSwitch.tsx` |
| `components/arena/AutoSimulator.tsx` | `frontend/components/arena/AutoSimulator.tsx` |
| `components/arena/BroadcastHero.tsx` | `frontend/components/arena/BroadcastHero.tsx` |
| `components/arena/DemoSpinButton.tsx` | `frontend/components/arena/DemoSpinButton.tsx` |
| `components/arena/EarnedBonus.tsx` | `frontend/components/arena/EarnedBonus.tsx` |
| `components/arena/KpiBar.tsx` | `frontend/components/arena/KpiBar.tsx` |
| `components/arena/LiveApiSync.tsx` | `frontend/components/arena/LiveApiSync.tsx` |
| `components/arena/LiveDataGate.tsx` | `frontend/components/arena/LiveDataGate.tsx` |
| `components/arena/LiveLeaderboard.tsx` | `frontend/components/arena/LiveLeaderboard.tsx` |
| `components/arena/screens/FloorScreen.tsx` | `frontend/components/arena/screens/FloorScreen.tsx` |
| `components/arena/screens/parts.tsx` | `frontend/components/arena/screens/parts.tsx` |
| `components/arena/screens/PeriodScreen.tsx` | `frontend/components/arena/screens/PeriodScreen.tsx` |
| `components/arena/screens/TeamsScreen.tsx` | `frontend/components/arena/screens/TeamsScreen.tsx` |
| `components/arena/teams/TeamSaleCelebration.tsx` | `frontend/components/arena/teams/TeamSaleCelebration.tsx` |
| `components/arena/TopPerformersPodium.tsx` | `frontend/components/arena/TopPerformersPodium.tsx` |
| `components/brand/BrandLogo.tsx` | `frontend/components/brand/BrandLogo.tsx` |
| `components/brand/PoweredBy.tsx` | `frontend/components/brand/PoweredBy.tsx` |
| `components/brand/RewardIconView.tsx` | `frontend/components/brand/RewardIconView.tsx` |
| `components/celebrations/CelebrationOverlay.tsx` | `frontend/components/celebrations/CelebrationOverlay.tsx` |
| `components/celebrations/ConfettiCanvas.tsx` | `frontend/components/celebrations/ConfettiCanvas.tsx` |
| `components/common/HydrationGate.tsx` | `frontend/components/common/HydrationGate.tsx` |
| `components/common/TimeAgo.tsx` | `frontend/components/common/TimeAgo.tsx` |
| `components/cub/arena-cub.css` | `frontend/components/cub/arena-cub.css` |
| `components/cub/ArenaCub.tsx` | `frontend/components/cub/ArenaCub.tsx` |
| `components/cub/CubCharacter.tsx` | `frontend/components/cub/CubCharacter.tsx` |
| `components/cub/CubPlayer.tsx` | `frontend/components/cub/CubPlayer.tsx` |
| `components/cub/CubStage.tsx` | `frontend/components/cub/CubStage.tsx` |
| `components/layout/ArenaBackdrop.tsx` | `frontend/components/layout/ArenaBackdrop.tsx` |
| `components/layout/ArenaHeader.tsx` | `frontend/components/layout/ArenaHeader.tsx` |
| `components/layout/ArenaModeSelector.tsx` | `frontend/components/layout/ArenaModeSelector.tsx` |
| `components/layout/RefreshButton.tsx` | `frontend/components/layout/RefreshButton.tsx` |
| `components/layout/SafeQuoteStatus.tsx` | `frontend/components/layout/SafeQuoteStatus.tsx` |
| `components/performance/DiagnosticsPanel.tsx` | `frontend/components/performance/DiagnosticsPanel.tsx` |
| `components/providers/AppProviders.tsx` | `frontend/components/providers/AppProviders.tsx` |
| `components/rewards/BonusCelebration.tsx` | `frontend/components/rewards/BonusCelebration.tsx` |
| `components/rewards/RewardRuntime.tsx` | `frontend/components/rewards/RewardRuntime.tsx` |
| `components/spinflow/AchievementPopup.tsx` | `frontend/components/spinflow/AchievementPopup.tsx` |
| `components/spinflow/PrizeReveal.tsx` | `frontend/components/spinflow/PrizeReveal.tsx` |
| `components/spinflow/SpinFlow.tsx` | `frontend/components/spinflow/SpinFlow.tsx` |
| `components/spinflow/SpinStage.tsx` | `frontend/components/spinflow/SpinStage.tsx` |
| `components/spinner/wheel-face.ts` | `frontend/components/spinner/wheel-face.ts` |
| `components/spinner/Wheel2DFallback.tsx` | `frontend/components/spinner/Wheel2DFallback.tsx` |
| `components/spinner/Wheel3D.tsx` | `frontend/components/spinner/Wheel3D.tsx` |
| `components/spinner/WheelCanvas.tsx` | `frontend/components/spinner/WheelCanvas.tsx` |
| `lib/cub/director.ts` | `frontend/cub/director.ts` |
| `lib/cub/machine.ts` | `frontend/cub/machine.ts` |
| `lib/cub/motion.ts` | `frontend/cub/motion.ts` |
| `lib/cub/phrases.ts` | `frontend/cub/phrases.ts` |
| `lib/cub/sounds.ts` | `frontend/cub/sounds.ts` |
| `lib/events/bus.ts` | `frontend/events/bus.ts` |
| `features/celebrations/tiers.ts` | `frontend/features/celebrations/tiers.ts` |
| `features/rewards/validation.ts` | `frontend/features/rewards/validation.ts` |
| `features/sales/stats.ts` | `frontend/features/sales/stats.ts` |
| `features/spins/selector.ts` | `frontend/features/spins/selector.ts` |
| `features/spins/wheel-math.ts` | `frontend/features/spins/wheel-math.ts` |
| `features/spins/wheel-theme.ts` | `frontend/features/spins/wheel-theme.ts` |
| `features/targets/eligibility.ts` | `frontend/features/targets/eligibility.ts` |
| `lib/teams/use-team-standings.ts` | `frontend/hooks/use-team-standings.ts` |
| `lib/live/background-sync.ts` | `frontend/live/background-sync.ts` |
| `lib/live/config-sync.ts` | `frontend/live/config-sync.ts` |
| `lib/live/display-id.ts` | `frontend/live/display-id.ts` |
| `lib/live/display-sync.ts` | `frontend/live/display-sync.ts` |
| `lib/live/latency.ts` | `frontend/live/latency.ts` |
| `lib/live/resilient-stream.ts` | `frontend/live/resilient-stream.ts` |
| `lib/live/sync-check.ts` | `frontend/live/sync-check.ts` |
| `lib/mock-api/seed.ts` | `frontend/mock-api/seed.ts` |
| `lib/performance/frame-monitor.ts` | `frontend/performance/frame-monitor.ts` |
| `lib/performance/perf-store.ts` | `frontend/performance/perf-store.ts` |
| `lib/performance/quality.ts` | `frontend/performance/quality.ts` |
| `lib/performance/reduced-motion.ts` | `frontend/performance/reduced-motion.ts` |
| `lib/rewards/engine.ts` | `frontend/rewards/engine.ts` |
| `lib/rewards/runner.ts` | `frontend/rewards/runner.ts` |
| `store/arena-mode-store.ts` | `frontend/stores/arena-mode-store.ts` |
| `store/arena-store.ts` | `frontend/stores/arena-store.ts` |
| `store/bonus-flow-store.ts` | `frontend/stores/bonus-flow-store.ts` |
| `store/celebration-store.ts` | `frontend/stores/celebration-store.ts` |
| `store/live-store.ts` | `frontend/stores/live-store.ts` |
| `store/rewards-store.ts` | `frontend/stores/rewards-store.ts` |
| `store/settings-store.ts` | `frontend/stores/settings-store.ts` |
| `store/spin-flow-store.ts` | `frontend/stores/spin-flow-store.ts` |
| `store/team-celebration-store.ts` | `frontend/stores/team-celebration-store.ts` |
| `lib/cub/actions.ts` | `shared/cub/actions.ts` |
| `lib/cub/config.ts` | `shared/cub/config.ts` |
| `lib/live/targets.ts` | `shared/live/targets.ts` |
| `lib/mock-api/schema.ts` | `shared/mock-api/schema.ts` |
| `features/sales/leads.ts` | `shared/sales/leads.ts` |
| `lib/security/ip.ts` | `shared/security/ip.ts` |
| `lib/settings/defaults.ts` | `shared/settings/defaults.ts` |
| `lib/settings/global-keys.ts` | `shared/settings/global-keys.ts` |
| `lib/teams/celebration.ts` | `shared/teams/celebration.ts` |
| `lib/teams/initial-roster.ts` | `shared/teams/initial-roster.ts` |
| `lib/teams/matching.ts` | `shared/teams/matching.ts` |
| `lib/teams/ranking.ts` | `shared/teams/ranking.ts` |
| `lib/time/business.ts` | `shared/time/business.ts` |
| `types/index.ts` | `shared/types/index.ts` |
| `lib/utils/index.ts` | `shared/utils/index.ts` |

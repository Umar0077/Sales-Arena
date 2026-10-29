# SALES ARENA — PRODUCTION DEPLOYMENT & INTEGRATION MANUAL

This manual documents the production architecture, PostgreSQL database migrations, Safe Quote API integration, real-time SSE streaming, reward engine, and safe deployment procedures for **Sales Arena**.

---

## 1. ENVIRONMENT CONFIGURATION

Configure the following server environment variables in your deployment environment (e.g., systemd service, PM2 ecosystem, or Docker `.env.production`).

> **CRITICAL SECURITY NOTE:**  
> Never commit actual API tokens or database passwords to Git.  
> Never prefix sensitive credentials with `NEXT_PUBLIC_`.  
> API tokens are consumed strictly on the server-side Next.js BFF layer.

```env
# Upstream Safe Quote API (Server-Only)
SALES_ARENA_API_URL=https://portal.thesafequote.com/api/sales-arena
SALES_ARENA_API_TOKEN=your_rotated_bearer_token_here

# PostgreSQL Database Connection (sales_arena database ONLY; do NOT touch calling_bot)
DATABASE_URL=postgres://sales_arena_app:your_secure_password@127.0.0.1:5432/sales_arena

# Business Clock & Floor Timezone
SALES_ARENA_TIMEZONE=America/New_York

# Operating Mode: "production" enforces real Safe Quote data; "demo" enables mock simulation
SALES_ARENA_MODE=production

# Admin API Key (Enforces authentication on administrative write endpoints)
ADMIN_API_KEY=your_secure_admin_api_key_here
```

---

## 2. POSTGRESQL DATABASE & MIGRATIONS

The PostgreSQL server hosts the application database `sales_arena` with user `sales_arena_app`.
> **SAFETY GUARD:** Under no circumstances should any migration or connection touch the separate `calling_bot` database.

### Schema Architecture
The migration script is located at:
`lib/server/db/schema.sql`

It establishes versioned, idempotent tables:
1. `campaigns`: Core campaign metadata and color coding.
2. `teams`: Team configurations, campaign relationships, and lead designations.
3. `agents`: Closer mappings, unique `user_code`, title, and avatar gradient hue.
4. `validated_sales`: Real validated sales confirmed by Safe Quote API with unique constraint on `case_id`.
5. `sales_events_inbox`: Idempotent inbox tracking SSE and webhook deliveries with unique `event_id`.
6. `sync_checkpoints`: Tracks endpoint sync checkpoints, reconciliation status, and last event IDs.
7. `reward_programs`: Configurable daily, weekly, and monthly reward rules.
8. `bonus_awards`: Immutable, audit-proof transactional records of bonus achievements.
9. `target_rules`: Spin credit unlock thresholds (e.g., 2 validated sales = 1 spin).
10. `rewards_catalog`: 3D spinner prizes, inventory limits, and selection weights.
11. `spin_credits`: Ledger tracking earned, used, and available spins per closer.
12. `spin_results`: Audit log of server-selected spin outcomes.
13. `admin_settings`: Persistent display, sound, and floor settings.
14. `celebration_settings`: Visual celebration preferences.
15. `audit_logs`: Administrative change history.

### Applying Migrations

#### Option A: Automatic Migration Runner (Recommended)
You can trigger the schema migration via API with administrative authentication:
```bash
curl -X POST http://localhost:3000/api/admin/migrate \
  -H "Authorization: Bearer <ADMIN_API_KEY>"
```

#### Option B: Direct PostgreSQL Command
```bash
psql -U sales_arena_app -d sales_arena -h 127.0.0.1 -f lib/server/db/schema.sql
```

---

## 3. SAFE QUOTE API CONTRACT & ENDPOINTS

### Upstream Endpoints
The application communicates with:
1. `GET /summary`: Returns submitted, validated, close rate, returned, rejected, active closers, and total premium.
   - Note: If `range.from` and `range.to` are null, the data reflects overall lifetime figures, not today's floor statistics.
2. `GET /closers`: Returns ranked list of closers.
   - Identifier rule: `userCode` (e.g. `CLS-EXAMPLE`) is used as the durable closer identity across all reward, bonus, and spin tables.
3. `GET /states`: Returns sales counts and premium breakdown by state.
4. `GET /recent-sales`: Returns recent confirmed sales. Customer personal identifying data is never exposed to public TV screens.
5. `GET /events`: Server-Sent Events stream (`text/event-stream`).

### Server-Side BFF Architecture
Client browsers never call Safe Quote directly with the upstream token:
```
Safe Quote API (/events, /summary, /closers, /recent-sales)
                       │
             Next.js BFF Server Layer
   (SafeQuoteClient, SSE Consumer, RewardEngine, PostgreSQL)
                       │
               Internal Event Bus
                       │
              /api/arena/stream (SSE)
                       │
            Live Arena Browser Clients
```

---

## 4. REAL-TIME EVENT STREAMING & RECONCILIATION

- **Single Upstream SSE Worker:** Only one upstream connection is maintained by `SafeQuoteSseConsumer` across the entire deployment.
- **Heartbeat & Reconnect:** Exponential backoff with random jitter handles network disconnects automatically.
- **Deduplication:** Upstream events are recorded in `sales_events_inbox` with unique `event_id` constraints.
- **Periodic Reconciliation:** The system periodically checks `/recent-sales` via `reconcileRecentSales()` to ensure no validated sale is missed during network interruptions.

---

## 5. REWARD & SPIN ENGINE RULES

1. **Daily Bonus:** When a validated sale arrives from Safe Quote, `RewardEngine` verifies sale uniqueness (`case_id`), checks active daily campaigns, and records the bonus transactionally in `bonus_awards`.
2. **Weekly & Monthly Programs:** Multi-threshold bonuses are evaluated based on business calendar boundaries (configured timezone and week start day).
3. **Spin & Win Logic:**
   - Spins are unlocked only by validated/approved sales (e.g., 2 validated sales = 1 spin).
   - Server-side transactional spin execution (`POST /api/arena/spin`) locks the closer's credit ledger row (`SELECT ... FOR UPDATE`), selects the winning prize using secure random selection, decrements inventory, and directs the 3D wheel to land on that exact prize.
   - Prevents simultaneous double-spins and client-side manipulation.

---

## 6. PRODUCTION BUILD & STARTUP

```bash
# 1. Install dependencies
npm install

# 2. Verify TypeScript integrity
npm run typecheck

# 3. Run all test suites
npm run test

# 4. Create production build
npm run build

# 5. Start production service
npm run start
```

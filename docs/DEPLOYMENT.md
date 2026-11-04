# Sales Arena — Deployment Runbook

Target server facts: Ubuntu, app at `/var/www/sales-arena/staging`, systemd service `sales-arena` on port `3102`,
nginx preview on `8082`, PostgreSQL 16, production DB `sales_arena`, test DB `sales_arena_test`, owner `sales_arena_app`,
timezone `America/New_York`. Currently deployed commit: `51113ca`.

Rules that apply to every step:

- Nothing in this repo runs migrations, imports or deploys automatically. Each step below is run by a person.
- Never paste tokens or DB passwords into a shell command line or a log. They live only in root-only env files.
- Destructive tests run only against `sales_arena_test` (the test harness refuses any DB not ending in `_test`).
- Historical import never issues spins or bonuses. Automatic rewards stay off until an admin sets the activation cutoff.
- Do not touch the running `sales-arena` service until section 4 passes.

---

## 1. Environment files

Two root-only files, one per database. Start from `.env.example`.

```bash
sudo mkdir -p /etc/sales-arena
sudo cp /var/www/sales-arena/staging/.env.example /etc/sales-arena/sales-arena.env
sudo cp /var/www/sales-arena/staging/.env.example /etc/sales-arena/sales-arena-test.env
sudo chmod 600 /etc/sales-arena/*.env
sudo nano /etc/sales-arena/sales-arena.env        # DATABASE_URL -> .../sales_arena
sudo nano /etc/sales-arena/sales-arena-test.env   # DATABASE_URL -> .../sales_arena_test, SALES_ARENA_SYNC_ENABLED=false
```

Variables:

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `SALES_ARENA_API_URL` | yes | Safe Quote base URL |
| `SALES_ARENA_API_TOKEN` | yes | Safe Quote bearer token (server only) |
| `APP_ORIGIN` | yes | Public site origin, e.g. `https://arena.example.com` (CSRF check) |
| `SALES_ARENA_TIMEZONE` | yes | `America/New_York` |
| `SALES_ARENA_SYNC_ENABLED` | no | `false` pauses SSE + reconciliation (default on in production) |
| `SALES_ARENA_RECONCILE_MINUTES` | no | Reconciliation interval, default `5` |
| `SAFEQUOTE_RECENT_SALES_LIMIT` | no | Upstream page size used to flag truncated days, default `50` |
| `ADMIN_COOKIE_SECURE` | no | `false` only for a plain-HTTP preview; leave unset behind HTTPS |

`ADMIN_API_KEY` is gone: admin access is now email + password accounts in PostgreSQL.

Point the systemd unit at the env file (check the current unit first with `systemctl cat sales-arena`):

```ini
# /etc/systemd/system/sales-arena.service  ([Service] section)
EnvironmentFile=/etc/sales-arena/sales-arena.env
Environment=NODE_ENV=production
# Listen on localhost only: every request must come through nginx (IP perimeter trust boundary).
ExecStart=/usr/bin/npm run start -- -H 127.0.0.1 -p 3102
```

## 2. Install and build (in a separate checkout, not the live one)

```bash
cd /var/www/sales-arena
git clone https://github.com/Umar0077/Sales-Arena.git release-new
cd release-new
git checkout <new-commit-sha>
npm ci
npm run typecheck
npm test
npm run build
```

## 3. Migrations on the isolated test database

```bash
cd /var/www/sales-arena/release-new
node --env-file=/etc/sales-arena/sales-arena-test.env scripts/db-migrate.mjs status
node --env-file=/etc/sales-arena/sales-arena-test.env scripts/db-migrate.mjs up
node --env-file=/etc/sales-arena/sales-arena-test.env scripts/db-migrate.mjs status
```

`up` prints the target host/database/user (never the password) and asks you to type `migrate`.
Expected: versions 001–004 applied, in order. Running `up` again applies nothing.

Integration tests (drops and rebuilds the `public` schema of the test DB only):

```bash
echo "TEST_DATABASE_URL=$(sudo grep ^DATABASE_URL= /etc/sales-arena/sales-arena-test.env | cut -d= -f2-)" > .env.test.local
chmod 600 .env.test.local
npm run test:integration
node --env-file=/etc/sales-arena/sales-arena-test.env scripts/db-migrate.mjs up --yes   # re-apply after the tests
```

## 4. Verify schema, foreign keys and records

```bash
psql "$(sudo grep ^DATABASE_URL= /etc/sales-arena/sales-arena-test.env | cut -d= -f2-)" <<'SQL'
SELECT version, checksum IS NOT NULL AS checksummed, applied_at FROM schema_migrations ORDER BY version;
SELECT COUNT(*) AS tables FROM information_schema.tables WHERE table_schema = 'public';
SELECT COUNT(*) AS foreign_keys, BOOL_AND(convalidated) AS all_validated
  FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace;
SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid)
  FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace ORDER BY 1, 2;
SELECT key, value FROM admin_settings ORDER BY key;
SELECT id, sales_per_spin, spins_per_threshold, period, scope_type, effective_from FROM target_rules WHERE superseded_at IS NULL;
SQL
```

Expected: 4 migrations, 24 tables, ~30 foreign keys all validated, `reward_activation_cutoff` = `null`.

## 5. Production backup (before any production change)

```bash
sudo mkdir -p /var/backups/sales-arena && sudo chown "$USER" /var/backups/sales-arena
PGURL="$(sudo grep ^DATABASE_URL= /etc/sales-arena/sales-arena.env | cut -d= -f2-)"
pg_dump --format=custom --no-owner --file=/var/backups/sales-arena/sales_arena_$(date +%Y%m%d_%H%M%S).dump "$PGURL"
ls -lh /var/backups/sales-arena/
```

## 6. Production migrations (manual, after sections 3–5 pass)

```bash
cd /var/www/sales-arena/release-new
node --env-file=/etc/sales-arena/sales-arena.env scripts/db-migrate.mjs status
node --env-file=/etc/sales-arena/sales-arena.env scripts/db-migrate.mjs up      # type: migrate
node --env-file=/etc/sales-arena/sales-arena.env scripts/db-migrate.mjs status
```

Then repeat the section 4 queries against `sales-arena.env`.

### Release notes: migrations 005 and 006 (global admin control)

- `005_sales_targets`: target tables. `006_reward_programs_v2`: extra reward-program columns, `reward_program_history`,
  award workflow columns, and award history protected from program deletes (`ON DELETE RESTRICT`).
  Both only add tables or columns. No existing program, award, sale, spin or admin row is changed.
- Deploy migration 006 **in the same release** as this code: the new build reads the new columns.
- Verify after migrating:
  ```sql
  SELECT version FROM schema_migrations ORDER BY version;                      -- ends with 006_reward_programs_v2
  SELECT conname, confdeltype FROM pg_constraint WHERE conname = 'fk_bonus_awards_program';  -- 'r' (restrict) if awards existed with the old FK
  SELECT COUNT(*) FROM reward_programs; SELECT COUNT(*) FROM bonus_awards;     -- same counts as before the migration
  ```
- After the restart, open Admin → Reward Programs. Programs that already existed are listed as before. The Live Arena only shows
  programs that are **Program Active** and **Show on Live Arena**. Global settings (screens, on/off, sounds, leaderboard,
  celebrations) start from the defaults until an admin saves them once. Each display's old browser values no longer apply.
- Optional, only if more than one Node process ever serves the arena: set `SALES_ARENA_EVENT_BUS=postgres` so live
  events reach displays connected to any process (PostgreSQL LISTEN/NOTIFY). Not needed for the single systemd service.

## 7. First administrator

Interactive only; the password is typed hidden and never echoed, logged or stored in plain text.
Refuses to run if an admin already exists (use `--additional` to add more).

```bash
node --env-file=/etc/sales-arena/sales-arena.env scripts/create-admin.mjs
```

## 8. Initial sale import (no rewards)

```bash
node --env-file=/etc/sales-arena/sales-arena.env scripts/import-sales.mjs --from=2026-10-01 --to=2026-10-30
```

Every imported row is stored with `source='backfill'` and `reward_eligible=false`. The script prints, per day,
how many sales it stored and warns where `/recent-sales` returned a full page (50) — those days may be incomplete
upstream. It compares totals with `/summary` and never invents missing sales. Re-running skips existing `caseId`s.

Check what was stored:

```bash
psql "$PGURL" -c "SELECT source, reward_eligible, COUNT(*) FROM validated_sales GROUP BY 1,2;"
psql "$PGURL" -c "SELECT COUNT(*) FROM spin_credit_transactions;"   # must be 0 after import
```

## 9. Roll out the service

```bash
sudo systemctl stop sales-arena
sudo mv /var/www/sales-arena/staging /var/www/sales-arena/staging-51113ca
sudo mv /var/www/sales-arena/release-new /var/www/sales-arena/staging
sudo systemctl daemon-reload
sudo systemctl start sales-arena
sudo systemctl status sales-arena --no-pager
journalctl -u sales-arena -n 100 --no-pager
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3102/admin/login     # 200
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3102/api/admin/system  # 401 without a session
```

After rollout:

1. Sign in at `/admin/login`, open **System Health**: DB, Safe Quote API and SSE should be green.
2. **Spin Management → Rules**: review the rule, then set the **Reward activation cutoff** to "now".
   Only sales validated after this moment can earn automatic spins or bonuses.
3. **Spin Management → Displays**: create a pairing code, open `/pair` on the office TV and enter it.
   Only paired displays (or a signed-in admin) can run spins.

Persistence check after a restart (read from the database, not from the UI cache):

```bash
psql "$PGURL" -c "SELECT (SELECT COUNT(*) FROM validated_sales) sales, (SELECT COUNT(*) FROM spin_credit_transactions) ledger, (SELECT COUNT(*) FROM admin_users) admins;"
sudo systemctl restart sales-arena
psql "$PGURL" -c "SELECT (SELECT COUNT(*) FROM validated_sales) sales, (SELECT COUNT(*) FROM spin_credit_transactions) ledger, (SELECT COUNT(*) FROM admin_users) admins;"
```

## 10. Rollback

```bash
sudo systemctl stop sales-arena
sudo mv /var/www/sales-arena/staging /var/www/sales-arena/staging-failed
sudo mv /var/www/sales-arena/staging-51113ca /var/www/sales-arena/staging
# Only if the database must go back too (drops everything written since the backup):
pg_restore --clean --if-exists --no-owner --dbname="$PGURL" /var/backups/sales-arena/<backup-file>.dump
sudo systemctl start sales-arena
```

The new migrations only add tables/columns, so the old build normally runs against the migrated schema;
restore the dump only if you need the data as it was.

## 11. nginx (HTTPS + admin)

```nginx
server {
    listen 443 ssl http2;
    server_name arena.example.com;
    ssl_certificate     /etc/letsencrypt/live/arena.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/arena.example.com/privkey.pem;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy same-origin always;

    location / {
        proxy_pass http://127.0.0.1:3102;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
    }

    # Live Arena event stream: no buffering, long timeout
    location /api/arena/stream {
        proxy_pass http://127.0.0.1:3102;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        gzip off;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }

    # Optional: restrict the admin area to the office network
    # location ^~ /admin     { allow 203.0.113.0/24; deny all; proxy_pass http://127.0.0.1:3102; proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; proxy_set_header X-Forwarded-Proto $scheme; }
}
server { listen 80; server_name arena.example.com; return 301 https://$host$request_uri; }
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

The plain-HTTP preview on port 8082 needs `ADMIN_COOKIE_SECURE=false` in its env file, or sign-in cookies will not stick.

## 12. IP perimeter security (application whitelist)

Admin → **IP Perimeter Security** (Owner only) manages a PostgreSQL whitelist (`ip_whitelist_rules`, `cidr`) and a master
switch (`ip_security_settings`). `proxy.ts` enforces it on every page and API request (static `/_next` assets excepted);
the live stream re-checks open connections. Migration `007_ip_perimeter_security` ships it **disabled**.

### Trust boundary (do this before enabling anything)

1. Node listens on `127.0.0.1:3102` only (systemd `ExecStart … -H 127.0.0.1 -p 3102`, section 1). Check:
   `ss -ltnp | grep 3102` must show `127.0.0.1:3102`, never `0.0.0.0` / `*`. Belt and braces: `sudo ufw deny 3102`.
2. In the **Sales Arena server block only** (do not edit the CRM, Asterisk or other vhosts), every `location` that proxies to
   3102 must overwrite the client-IP headers. Put them in one snippet so `/` and `/api/arena/stream` cannot drift apart:
   ```nginx
   # /etc/nginx/snippets/sales-arena-proxy.conf
   proxy_set_header Host              $host;
   proxy_set_header X-Real-IP         $remote_addr;   # overwrites anything the client sent
   proxy_set_header X-Forwarded-For   $remote_addr;   # replace, do not append the client's chain
   proxy_set_header X-Forwarded-Proto $scheme;
   proxy_set_header X-Forwarded-Host  $host;
   proxy_set_header X-Sales-Arena-Proxy "<same value as SALES_ARENA_PROXY_SECRET>";   # optional, recommended
   ```
   and `include snippets/sales-arena-proxy.conf;` in both locations (the stream location currently sets no X-Real-IP).
   Generate the secret with `openssl rand -hex 32`; keep it in the root-only env file and the root-only snippet.
3. The app reads **only** `X-Real-IP` (never `X-Forwarded-For`). With `SALES_ARENA_PROXY_SECRET` set, a request without the
   matching `X-Sales-Arena-Proxy` header has no trusted IP and is blocked while restriction is on.
4. Future CDN / load balancer: configure nginx `set_real_ip_from <provider ranges>; real_ip_header <provider header>;
   real_ip_recursive on;` so `$remote_addr` is the visitor again. The application needs no change.

`sudo nginx -t && sudo systemctl reload nginx`, then verify spoofing is ignored (from a network that is NOT whitelisted, once
restriction is on): `curl -s -o /dev/null -w "%{http_code}\n" -H "X-Real-IP: <whitelisted ip>" -H "X-Forwarded-For: <whitelisted ip>" https://fesalesarena.goconnectivo.com/`
→ `403`. Direct port access from outside must time out: `curl -m 5 http://<server-ip>:3102/`.

### Transition from the existing nginx admin allowlist

1. Keep the current nginx `allow … deny all;` admin block in place.
2. In the app, add every network from that nginx allowlist as a rule **with Admin access**, plus the FE floor / branch
   networks for the Live Arena. Use "Whitelist my current IP" from the office first.
3. Turn the restriction on with scopes *Live Arena* + *Display pairing* (Admin scope off: nginx still guards `/admin`).
   Check every TV/laptop and the Current Connection card.
4. Only after that is verified: optionally turn on the *Admin Panel* scope, and later remove the nginx admin allowlist in a
   separate, reviewed change. Until it is removed, an IP must be allowed by **both** nginx and the app to reach `/admin`.
   nginx rules are never generated from database input.

### Behaviour

- Blocked: branded "ACCESS RESTRICTED" page, HTTP 403 (JSON 403 for APIs and the stream). No data, no whitelist details.
- Live Arena OFF (allowed network): the existing offline page. The two switches are independent.
- Rule changes apply within ~3 s in every app process (revision check), immediately in the process that saved them. No restart.
- Database outage: the last verified policy keeps being enforced. If the app starts while the database is down, protected
  routes answer 503 until it is reachable (fail closed).
- Lockout protection: turning restriction on needs an explicit confirmation, at least one active Admin-access rule without an
  expiry, and the Owner's own IP covered by one. Changes that would remove the last such rule, or cut off the Owner's network
  while the Admin scope is on, are refused.
- Blocked requests are counted in memory and logged at most once per IP per 10 minutes (journal), never one DB row per request.

### Lockout recovery (server console only, no bypass URL)

```bash
cd /var/www/sales-arena/staging
sudo -u <app user> node --env-file=/etc/sales-arena/sales-arena.env scripts/ip-security.mjs status
sudo -u <app user> node --env-file=/etc/sales-arena/sales-arena.env scripts/ip-security.mjs disable --reason="Office IP changed"
# or keep it on and allow the new network:
sudo -u <app user> node --env-file=/etc/sales-arena/sales-arena.env scripts/ip-security.mjs allow 203.0.113.25 --label="Head Office" --reason="New ISP"
sudo -u <app user> node --env-file=/etc/sales-arena/sales-arena.env scripts/ip-security.mjs activate 12 --reason="Re-enable expired office rule"
```

Each command asks you to type `recover`, writes an audit entry (`ip_security.recovery.*`, actor `console:<user>`) and takes
effect within a few seconds.

### Deploy / rollback

Deploy migration 007 in the same release as the code, after a fresh `pg_dump` (section 5) and the test-database run (section 3).
Do not turn restriction on in production until the whitelist is verified (transition steps above). Rollback: turn the
restriction off (Admin or `scripts/ip-security.mjs disable`), then roll back the code as in section 10. The 007 tables are
additive and can stay.

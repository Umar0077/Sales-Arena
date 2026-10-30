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
ExecStart=/usr/bin/npm run start -- -p 3102
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
        proxy_read_timeout 1h;
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

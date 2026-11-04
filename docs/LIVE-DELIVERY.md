# Live delivery: finding where a delay happens (read-only)

The path of a genuine sale:

```
Safe Quote validates  →  FE Sales Arena receives it      →  PostgreSQL commit   →  reward engine (same transaction)
   validated_at            live stream: seconds              first_seen_at         bonus_awards.created_at
                           reconciliation: ≤ N minutes
→  server broadcast  →  Nginx  →  browser SSE  →  popup
   (right after commit)            (window.__arenaLatency on each display)
```

Two ways a sale reaches the app:

| `validated_sales.source` | How | Normal delay |
| --- | --- | --- |
| `sse` | Safe Quote's live event stream (`/events`) | seconds |
| `reconciliation` | the recent-sales poll every `SALES_ARENA_RECONCILE_MINUTES` (default 5) | up to that many minutes |
| `backfill` | historical import (never celebrated) | — |

Many recent `reconciliation` rows mean the **live stream did not deliver** those sales. Before this release, a
parsing bug in the stream consumer dropped any event split across two network packets, so such sales waited for
the next poll. The browser fallback refresh (every 3 minutes) could then add up to 3 more minutes if the
displays' own stream was not delivering: together the observed 4–8 minutes.

Nothing below changes data. Never paste credentials into a terminal history or a ticket.

## 1. Admin → System Health → Live delivery

Shows the Safe Quote live-stream status and last event, connected displays, discovery source with median / p95 /
slowest delay for the last 7 days, and the last 30 sales with their award delay. Same data as JSON:
`GET /api/admin/live-delivery` (admin session required).

## 2. SQL (read-only)

Connect with the application role (do not print the URL), e.g. `sudo -u postgres psql -d sales_arena`.

Latest sales and how they arrived:

```sql
SELECT case_id, closer_name, source, validated_at, first_seen_at,
       ROUND(EXTRACT(EPOCH FROM first_seen_at - validated_at)) AS discovery_sec
  FROM validated_sales WHERE source <> 'backfill'
 ORDER BY first_seen_at DESC LIMIT 20;
```

Discovery delay by source, last 7 days:

```sql
SELECT source, COUNT(*) AS sales,
       ROUND(percentile_cont(0.5)  WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM first_seen_at - validated_at))::numeric) AS median_sec,
       ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM first_seen_at - validated_at))::numeric) AS p95_sec
  FROM validated_sales
 WHERE source <> 'backfill' AND first_seen_at > NOW() - INTERVAL '7 days'
 GROUP BY source;
```

Award timing for a sale (replace the case id):

```sql
SELECT s.case_id, s.source, s.validated_at, s.first_seen_at, b.program_name, b.amount, b.created_at AS award_at,
       ROUND(EXTRACT(EPOCH FROM b.created_at - s.first_seen_at), 2) AS award_after_store_sec
  FROM validated_sales s LEFT JOIN bonus_awards b ON b.trigger_case_id = s.case_id
 WHERE s.case_id = 'CLS-XXXX';
```

Live-stream receipts and checkpoint (was the upstream stream connected?):

```sql
SELECT event_id, case_id, received_at, processed, processed_at, error FROM sales_events_inbox ORDER BY received_at DESC LIMIT 20;
SELECT id, last_sync_at, status, error, details FROM sync_checkpoints ORDER BY id;
```

## 3. Server logs

```bash
sudo journalctl -u sales-arena --since "2 hours ago" | grep -E "SafeQuote SSE|sales-sync|Heartbeat watchdog" | tail -50
grep -E '^SALES_ARENA_RECONCILE_MINUTES|^SALES_ARENA_SYNC_ENABLED|^SALES_ARENA_EVENT_BUS' /etc/sales-arena/*.env 2>/dev/null   # names only matter; never print tokens
```

* `Heartbeat watchdog timeout` repeating → the upstream stream keeps dropping (sales then come from reconciliation).
* `Upstream SSE rejected with HTTP 401/403` → token / IP allow-listing on the Safe Quote side.
* `reconciliation: … stored N` with N > 0 → those N sales were missed by the live stream.

## 4. Nginx (does it hold events back?)

The app now sends `X-Accel-Buffering: no` on `/api/arena/stream`, which disables Nginx buffering for that response
only. The server block should also have the dedicated location from `docs/DEPLOYMENT.md` (`proxy_buffering off`,
`proxy_read_timeout 1h`, `gzip off`). Check without changing anything:

```bash
sudo nginx -T 2>/dev/null | grep -n -A12 'location /api/arena/stream'
# Time to first byte and live events through the real proxy (Ctrl+C after a few lines):
curl -sN -H 'Accept: text/event-stream' https://fesalesarena.goconnectivo.com/api/arena/stream | while IFS= read -r l; do printf '%(%T)T %s\n' -1 "$l"; done
```

A healthy stream prints `event: ready` at once and `: ping` every 15 seconds. Pings arriving in bursts → a proxy
buffers the stream.

## 5. On a display (browser console)

```js
window.__arenaLatency   // per sale / award: validatedAt, firstSeenAt, storedAt, broadcastAt, receivedAt, shownAt + stages (ms)
```

A popup that took more than 60 s also logs `[live-latency] … source→server …, →browser …, →popup …`, which names
the slow stage. Server and display clocks may differ by a few seconds; the stage on one machine is exact.

## 6. `net::ERR_HTTP2_PROTOCOL_ERROR` on `/api/arena/stream`

Reproduced locally (production build behind Nginx with TLS + HTTP/2, generic `location /` as in production):
when the app restarts while browsers hold the live stream open (every deploy / service restart), Nginx must cut
the in-flight HTTP/2 response and Chrome logs exactly `net::ERR_HTTP2_PROTOCOL_ERROR`; reconnect attempts then
get `502` until Node is up again. The stream itself was healthy otherwise: 6½ minutes over HTTP/2 and 320 s over
HTTP/1.1 (direct and through Nginx) without a single error, pings every 15 s.

What made it harmful: on a `502` the browser closes an `EventSource` **for good**. Before the fix, every open
display and Admin tab then stayed without live events (sales, bonuses, settings, Arena Cub commands) until it was
refreshed. Now both reopen the stream themselves (1, 2, 3, 5, 10 s, then every 15 s) and resync everything they
missed. The response no longer sends a `Connection` header (forbidden in HTTP/2; Nginx strips it today).

Checks on the server (read-only):

```bash
sudo grep -E "api/arena/stream" /var/log/nginx/error.log | tail -20          # "upstream prematurely closed" = app restart / crash
sudo grep -cE "proxy_temp.*(Permission denied|failed)" /var/log/nginx/error.log  # must be 0
sudo journalctl -u sales-arena --since "today" | grep -E "Started|Stopped|exited|Killed" | tail   # restarts line up with the errors?
```

Recommended (Sales Arena server block only, after `sudo cp` backup and `sudo nginx -t`): the dedicated stream
location from `docs/DEPLOYMENT.md` (`proxy_buffering off; gzip off; proxy_read_timeout 1h; proxy_set_header Connection "";`).
The app already disables buffering per response with `X-Accel-Buffering: no`, so this is defence in depth.

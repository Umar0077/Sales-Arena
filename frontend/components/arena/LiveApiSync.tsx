"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useArenaStore } from "@/frontend/stores/arena-store";
import { useSettingsStore } from "@/frontend/stores/settings-store";
import { useSpinFlowStore } from "@/frontend/stores/spin-flow-store";
import { useRewardsStore } from "@/frontend/stores/rewards-store";
import { useLiveStore } from "@/frontend/stores/live-store";
import { appliedDisplayRevision, applyGlobalDisplay, fetchGlobalDisplay } from "@/frontend/live/display-sync";
import { createBackgroundSync } from "@/frontend/live/background-sync";
import { changedDatasets, fetchSyncSnapshot, missedSales, serverOffsetMs, type SyncFingerprints } from "@/frontend/live/sync-check";
import { appliedConfigRevision, applyScreenSwitch, fetchArenaConfig, fetchLivePrograms } from "@/frontend/live/config-sync";
import type { BonusAward } from "@/frontend/stores/rewards-store";

/**
 * Full silent refresh of every live dataset at most this often (Safe Quote figures can change without a
 * PostgreSQL change, e.g. a returned sale). Between full refreshes the background sync check (every
 * liveSyncSeconds, default 15 s) re-fetches only what changed. SSE stays the primary real-time channel.
 */
export const RECONCILE_MS = 180_000;
/** When this display opened (browser clock). Sales stored before it are history, never announced. */
const OPENED_AT = Date.now();
/** Settings events that all mean "the global arena configuration has a new revision". */
const CONFIG_EVENTS = [
  "arena.availability.updated",
  "arena.screens.updated",
  "rewards.program.visibility.updated",
  "settings.celebration.updated",
  "settings.appearance.updated",
  "settings.leaderboard.updated",
  "settings.mascot.updated",
] as const;
import { arenaBus } from "@/frontend/events/bus";
import { noteReceived } from "@/frontend/live/latency";
import { openResilientStream } from "@/frontend/live/resilient-stream";
import { getPeriodDateRange } from "@/shared/time/business";
import { parseSaleTeam } from "@/shared/teams/celebration";
import type { Agent, Reward, Sale } from "@/shared/types";
import type { CloserRow } from "@/shared/sales/leads";

export function LiveApiSync() {
  const syncRealData = useArenaStore((s) => s.syncRealData);
  const setPeriodMetrics = useArenaStore((s) => s.setPeriodMetrics);
  const setAllTimeMetrics = useArenaStore((s) => s.setAllTimeMetrics);
  const setApiStatus = useArenaStore((s) => s.setApiStatus);
  const setServerSpinBalance = useArenaStore((s) => s.setServerSpinBalance);

  const businessTimezone = useSettingsStore((s) => s.businessTimezone);
  const weekStartDay = useSettingsStore((s) => s.weekStartDay);

  const [retryingIn, setRetryingIn] = useState<number | null>(null);
  const retryCountRef = useRef(0);
  const sseRef = useRef<EventSource | null>(null);
  const isMountedRef = useRef(true);
  const syncSeqRef = useRef(0);

  // Prize wheel = PostgreSQL rewards_catalog. Applied only when its revision changes, so the
  // wheel textures rebuild only for a real change (and never mid-spin: the stage keeps its spin snapshot).
  const catalogRevRef = useRef<string | null>(null);
  const syncCatalog = useCallback(async () => {
    try {
      const res = await fetch("/api/arena/catalog", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok || !j.ok || !Array.isArray(j.prizes)) return;
      if (j.revision === catalogRevRef.current) return;
      catalogRevRef.current = j.revision;
      useArenaStore.setState({
        rewards: j.prizes.map((p: { id: string; title: string; description: string; icon: string; color: string; quantity: number | null }, i: number) => ({
          id: p.id,
          title: p.title,
          description: p.description,
          icon: p.icon as Reward["icon"],
          color: p.color,
          active: true,
          quantity: p.quantity,
          weight: 1, // odds live on the server only
          order: i,
        })),
      });
      useLiveStore.getState().setCatalogRevision(j.revision, j.fetchedAt);
    } catch {
      // keep the last verified catalog
    }
  }, []);

  const fetchLiveStats = useCallback(async (isInitial = false, manual = false) => {
    const currentSeq = ++syncSeqRef.current;
    // Manual refresh bypasses the server's short upstream cache; the browser never caches.
    const fresh = manual ? "&fresh=true" : "";
    const opt: RequestInit = { cache: "no-store" };
    try {
      if (isInitial) {
        setApiStatus("connecting", null);
      }

      const clock = {
        timezone: businessTimezone || "America/New_York",
        weekStartDay: weekStartDay ?? 1,
      };

      const dayRange = getPeriodDateRange("day", clock);
      const weekRange = getPeriodDateRange("week", clock);
      const monthRange = getPeriodDateRange("month", clock);

      // Concurrent fetches for daily, weekly, monthly, all-time, and backend awards
      const [
        daySummaryRes,
        dayClosersRes,
        daySalesRes,
        weekSummaryRes,
        weekClosersRes,
        weekSalesRes,
        monthSummaryRes,
        monthClosersRes,
        monthSalesRes,
        allTimeSummaryRes,
        allTimeClosersRes,
        awardsRes,
        targetsRes,
        spinTotalsRes,
      ] = await Promise.allSettled([
        fetch(`/api/arena/summary?from=${dayRange.from}&to=${dayRange.to}${fresh}`, opt),
        fetch(`/api/arena/closers?from=${dayRange.from}&to=${dayRange.to}${fresh}`, opt),
        fetch(`/api/arena/recent-sales?from=${dayRange.from}&to=${dayRange.to}${fresh}`, opt),
        fetch(`/api/arena/summary?from=${weekRange.from}&to=${weekRange.to}${fresh}`, opt),
        fetch(`/api/arena/closers?from=${weekRange.from}&to=${weekRange.to}${fresh}`, opt),
        fetch(`/api/arena/recent-sales?from=${weekRange.from}&to=${weekRange.to}${fresh}`, opt),
        fetch(`/api/arena/summary?from=${monthRange.from}&to=${monthRange.to}${fresh}`, opt),
        fetch(`/api/arena/closers?from=${monthRange.from}&to=${monthRange.to}${fresh}`, opt),
        fetch(`/api/arena/recent-sales?from=${monthRange.from}&to=${monthRange.to}${fresh}`, opt),
        fetch(`/api/arena/summary${manual ? "?fresh=true" : ""}`, opt),
        fetch(`/api/arena/closers${manual ? "?fresh=true" : ""}`, opt),
        fetch("/api/arena/awards", opt),
        fetch(`/api/arena/targets?day=${dayRange.from}&week=${weekRange.from}&month=${monthRange.from}`, opt),
        fetch("/api/arena/spin/totals", opt),
      ]);

      if (currentSeq !== syncSeqRef.current) return null; // a newer sync superseded this one

      // Check daySummaryRes
      if (daySummaryRes.status === "fulfilled" && daySummaryRes.value.ok) {
        const daySummaryData = await daySummaryRes.value.json();

        if (daySummaryData.mode === "production" && daySummaryData.ok) {
          retryCountRef.current = 0;
          setRetryingIn(null);

          // 1. Day closers & agents
          let dayClosers: CloserRow[] = [];
          let liveAgents: Agent[] = [];
          if (dayClosersRes.status === "fulfilled" && dayClosersRes.value.ok) {
            const closersData = await dayClosersRes.value.json();
            if (Array.isArray(closersData.closers)) {
              dayClosers = closersData.closers;
              liveAgents = closersData.closers.map((row: CloserRow) => row.agent);
            }
          }

          // 2. Day sales
          let daySales: Sale[] = [];
          if (daySalesRes.status === "fulfilled" && daySalesRes.value.ok) {
            const salesData = await daySalesRes.value.json();
            if (Array.isArray(salesData.sales)) {
              daySales = salesData.sales;
            }
          }

          // 3. Week summary, closers & sales
          let weekSummary = null;
          let weekClosers: CloserRow[] = [];
          let weekSales: Sale[] = [];
          if (weekSummaryRes.status === "fulfilled" && weekSummaryRes.value.ok) {
            const weekSummaryData = await weekSummaryRes.value.json();
            if (weekSummaryData.ok) weekSummary = weekSummaryData.data;
          }
          if (weekClosersRes.status === "fulfilled" && weekClosersRes.value.ok) {
            const weekClosersData = await weekClosersRes.value.json();
            if (Array.isArray(weekClosersData.closers)) {
              weekClosers = weekClosersData.closers;
            }
          }
          if (weekSalesRes.status === "fulfilled" && weekSalesRes.value.ok) {
            const weekSalesData = await weekSalesRes.value.json();
            if (Array.isArray(weekSalesData.sales)) {
              weekSales = weekSalesData.sales;
            }
          }

          // 4. Month summary, closers & sales
          let monthSummary = null;
          let monthClosers: CloserRow[] = [];
          let monthSales: Sale[] = [];
          if (monthSummaryRes.status === "fulfilled" && monthSummaryRes.value.ok) {
            const monthSummaryData = await monthSummaryRes.value.json();
            if (monthSummaryData.ok) monthSummary = monthSummaryData.data;
          }
          if (monthClosersRes.status === "fulfilled" && monthClosersRes.value.ok) {
            const monthClosersData = await monthClosersRes.value.json();
            if (Array.isArray(monthClosersData.closers)) {
              monthClosers = monthClosersData.closers;
            }
          }
          if (monthSalesRes.status === "fulfilled" && monthSalesRes.value.ok) {
            const monthSalesData = await monthSalesRes.value.json();
            if (Array.isArray(monthSalesData.sales)) {
              monthSales = monthSalesData.sales;
            }
          }

          // 5. Backend Verified Awards
          // Earned-cash totals come from PostgreSQL bonus_awards. On failure keep the last verified
          // awards and totals and mark them unavailable: never show an invented zero.
          if (awardsRes.status === "fulfilled" && awardsRes.value.ok) {
            const awardsData = await awardsRes.value.json().catch(() => null);
            if (awardsData?.ok && Array.isArray(awardsData.awards)) {
              useRewardsStore.getState().setBackendAwards(awardsData.awards);
              useLiveStore.getState().setAwardSummary(awardsData.summary ?? null, awardsData.summary ? "ok" : "error", awardsData.agentBonus ?? null);
            } else useLiveStore.getState().setAwardSummary(null, "error");
          } else useLiveStore.getState().setAwardSummary(null, "error");

          // 6. All-Time summary & closers
          let allTimeSummary = null;
          let allTimeClosers: CloserRow[] = [];
          if (allTimeSummaryRes.status === "fulfilled" && allTimeSummaryRes.value.ok) {
            const allTimeSummaryData = await allTimeSummaryRes.value.json();
            if (allTimeSummaryData.ok) allTimeSummary = allTimeSummaryData.data;
          }
          if (allTimeClosersRes.status === "fulfilled" && allTimeClosersRes.value.ok) {
            const allTimeClosersData = await allTimeClosersRes.value.json();
            if (Array.isArray(allTimeClosersData.closers)) {
              allTimeClosers = allTimeClosersData.closers;
            }
          }

          // If daily has few agents active yet today, preserve all-time roster so avatars don't vanish
          if (liveAgents.length === 0 && allTimeClosers.length > 0) {
            liveAgents = allTimeClosers.map((row) => row.agent);
          }

          // Update period-specific metrics in store
          setPeriodMetrics("day", {
            summary: daySummaryData.data,
            closers: dayClosers,
            sales: daySales,
            dateRange: dayRange,
            status: "ready",
          });

          setPeriodMetrics("week", {
            summary: weekSummary,
            closers: weekClosers,
            sales: weekSales,
            dateRange: weekRange,
            status: "ready",
          });

          setPeriodMetrics("month", {
            summary: monthSummary,
            closers: monthClosers,
            sales: monthSales,
            dateRange: monthRange,
            status: "ready",
          });

          if (allTimeSummary) {
            setAllTimeMetrics({
              summary: allTimeSummary,
              closers: allTimeClosers,
            });
          }

          // Targets from PostgreSQL (read-only). Keep the last known values if the DB is briefly unavailable.
          if (targetsRes.status === "fulfilled" && targetsRes.value.ok) {
            const tj = await targetsRes.value.json().catch(() => null);
            if (tj?.ok) {
              useLiveStore.getState().setTargets({
                day: tj.targets?.day?.target ?? null,
                week: tj.targets?.week?.target ?? null,
                month: tj.targets?.month?.target ?? null,
              });
            }
          }

          // Authoritative spin totals from PostgreSQL ledger
          if (spinTotalsRes.status === "fulfilled" && spinTotalsRes.value.ok) {
            const st = await spinTotalsRes.value.json().catch(() => null);
            if (st?.ok && typeof st.unlocked === "number" && typeof st.available === "number") {
              setServerSpinBalance({ unlocked: st.unlocked, available: st.available });
            }
          }
          if (currentSeq !== syncSeqRef.current) return null;

          // Sync real data into primary arena floor (an empty day replaces old data too)
          syncRealData({
            summary: daySummaryData.data,
            agents: liveAgents,
            sales: daySales,
            mode: "production",
          });
          useLiveStore.getState().markSuccess();

          return true;
        } else if (daySummaryData.mode === "unconfigured") {
          setApiStatus("unconfigured", "Safe Quote API token not set; running in demo mode");
          return false;
        }
      } else if (daySummaryRes.status === "fulfilled" && daySummaryRes.value.status === 503) {
        setApiStatus("unconfigured", "API not configured; demo mode active");
        return false;
      } else {
        throw new Error("Unable to reach FE Sales Arena backend API");
      }
    } catch (err) {
      if (!isMountedRef.current || currentSeq !== syncSeqRef.current) return false;
      const errorMsg = err instanceof Error ? err.message : "Connection failed";
      retryCountRef.current++;
      setApiStatus("error", errorMsg);
      return false;
    }
    return false;
  }, [businessTimezone, weekStartDay, setApiStatus, setPeriodMetrics, setAllTimeMetrics, syncRealData, setServerSpinBalance]);

  // The stream effect below runs once; it always calls the latest fetcher through this ref, so a
  // settings change (e.g. business timezone) never closes or duplicates the SSE connection.
  const fetchRef = useRef(fetchLiveStats);
  useEffect(() => {
    fetchRef.current = fetchLiveStats;
  }, [fetchLiveStats]);

  // One silent reconciliation of every live dataset and setting. Never overlaps itself, never
  // reloads the page, never resets the selected screen and never creates awards (read-only).
  const reconcilingRef = useRef<Promise<void> | null>(null);
  const lastReconcileRef = useRef(0);
  const reconcile = useCallback((manual = false): Promise<void> => {
    if (reconcilingRef.current) return reconcilingRef.current;
    const live = useArenaStore.getState().liveMode;
    const run = Promise.allSettled([
      fetchRef.current(false, manual),
      syncCatalog(),
      fetchGlobalDisplay(),
      fetchArenaConfig(),
      live ? fetchLivePrograms() : Promise.resolve(false),
    ]).then(() => {
      lastReconcileRef.current = Date.now();
      document.documentElement.dataset.lastReconcile = new Date(lastReconcileRef.current).toISOString();
    });
    reconcilingRef.current = run.finally(() => {
      reconcilingRef.current = null;
    });
    return reconcilingRef.current;
  }, [syncCatalog]);

  // Connect to server-sent events for real-time sales and celebrations
  useEffect(() => {
    isMountedRef.current = true;
    const seenSales = new Set<string>();
    const seenSpinEvents = new Set<string>();
    const seenRecognitions = new Set<string>();
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    /** When the stats / awards were last re-fetched (so the background check never repeats a live refresh). */
    let statsAt = 0;
    let programsTimer: ReturnType<typeof setTimeout> | null = null;

    // Coalesce rapid live updates into a single efficient batch
    const scheduleLiveSync = (delay = 800) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (isMountedRef.current && document.visibilityState === "visible") {
          statsAt = Date.now();
          void fetchRef.current();
        }
      }, delay);
    };
    let awardsTimer: ReturnType<typeof setTimeout> | null = null;
    // Lightweight: only the awards endpoint (list + earned totals), not the full 14-request sync.
    const scheduleAwardsSync = () => {
      if (!useArenaStore.getState().liveMode) return;
      if (awardsTimer) clearTimeout(awardsTimer);
      awardsTimer = setTimeout(async () => {
        try {
          const res = await fetch("/api/arena/awards", { cache: "no-store" });
          const j = await res.json().catch(() => null);
          if (res.ok && j?.ok && Array.isArray(j.awards)) {
            useRewardsStore.getState().setBackendAwards(j.awards);
            useLiveStore.getState().setAwardSummary(j.summary ?? null, j.summary ? "ok" : "error", j.agentBonus ?? null);
          } else useLiveStore.getState().setAwardSummary(null, "error");
        } catch {
          useLiveStore.getState().setAwardSummary(null, "error");
        }
      }, 400);
    };
    const scheduleProgramsSync = () => {
      if (!useArenaStore.getState().liveMode) return;
      if (programsTimer) clearTimeout(programsTimer);
      programsTimer = setTimeout(() => void fetchLivePrograms(), 250);
    };

    // Initial check (deferred a tick so it does not set state during the effect)
    const initialCheck = setTimeout(() => {
      statsAt = Date.now();
      void fetchRef.current(true).then(() => {
        lastReconcileRef.current = Date.now();
      });
      void syncCatalog();
    }, 0);

    // A validated sale, from the live stream or (missed there) from the background check: one popup and one
    // Arena Cub feeding, deduped by case id across both paths.
    const handleSale = (payload: Record<string, unknown>, via: "sse" | "sync") => {
      const saleKey = String(payload.caseId || "");
      if (saleKey && seenSales.has(saleKey)) return false;
      // Delivery timeline (diagnostics): server stamps + the moment this browser received it.
      if (saleKey && payload.source !== "backfill")
        noteReceived({
          kind: "sale",
          key: saleKey,
          source: payload.source as string,
          validatedAt: payload.validatedAt as string,
          firstSeenAt: payload.firstSeenAt as string,
          storedAt: payload.storedAt as string,
          broadcastAt: payload.broadcastAt as string,
          via,
        });
      if (saleKey) {
        seenSales.add(saleKey);
        if (seenSales.size > 200) {
          const first = seenSales.values().next().value;
          if (first) seenSales.delete(first);
        }
      }

      // Arena Cub: same stream, same dedupe (it keeps its own bounded memory too).
      arenaBus.emit(
        "cub:sale",
        { caseId: saleKey, closerName: String(payload.closerName || payload.userCode || ""), validatedAt: String(payload.validatedAt || ""), source: payload.source ? String(payload.source) : null },
        { broadcast: false },
      );

      // Broadcast celebratory announcement
      arenaBus.emit("celebration:enqueue", {
        event: {
          id: `celeb_sale_${payload.caseId || Date.now()}`,
          tier: "sale",
          headline: "SALE VALIDATED!",
          subline: `${payload.closerName || payload.userCode} · +1 Validated Sale — great work!`,
          agentId: String(payload.userCode ?? ""),
          agentName: String(payload.closerName || payload.userCode || ""),
          teamName: "FE Sales Arena",
          teamColor: "#36E0B5",
          value: (payload.premium as number) || null,
          createdAt: String(payload.validatedAt || new Date().toISOString()),
          preview: false,
          // Team attribution from the server (stream or background sync), passed through unchanged: only the
          // Teams Arena presentation reads it. Left out when the server did not send one (= unknown).
          ...("team" in payload ? { saleTeam: parseSaleTeam(payload.team) } : {}),
        },
      });
      return true;
    };

    // Background sync (default every 15 s, no page reload): a small fingerprint check; only a dataset that
    // changed is re-fetched, everything at most every RECONCILE_MS, and a sale the live stream missed still
    // gets its popup (stored after this display opened, within the server's recovery window, never twice).
    let prevFp: SyncFingerprints | null = null;
    let prevCheckAt = 0;
    const background = createBackgroundSync({
      intervalMs: () => (Number(useSettingsStore.getState().liveSyncSeconds) || 15) * 1000,
      run: async (signal) => {
        const snap = await fetchSyncSnapshot(signal);
        if (signal.aborted || !isMountedRef.current) return;
        const changed = changedDatasets(prevFp, snap.fp);
        const first = prevFp === null;
        const since = prevCheckAt;
        prevFp = snap.fp;
        prevCheckAt = Date.now();
        document.documentElement.dataset.lastSyncCheck = new Date(prevCheckAt).toISOString();

        const missed = missedSales(snap.recentSales, {
          seen: (k) => seenSales.has(k),
          openedAtServerMs: OPENED_AT + serverOffsetMs(),
          nowServerMs: new Date(snap.serverTime).getTime(),
          windowMs: snap.recoveryWindowSec * 1000,
        });
        for (const sale of missed) handleSale({ ...sale, storedAt: sale.firstSeenAt }, "sync");

        if (Date.now() - lastReconcileRef.current >= RECONCILE_MS) return void (await reconcile());
        if (first && !missed.length) return; // the page has just loaded everything
        const jobs: Promise<unknown>[] = [];
        // A missed sale always refreshes; a sales change already refreshed by its live event is not repeated.
        if (missed.length || (changed.has("sales") && statsAt < since)) {
          statsAt = Date.now();
          jobs.push(fetchRef.current()); // includes the awards
        } else if (changed.has("awards")) scheduleAwardsSync(); // one small PostgreSQL read
        if (snap.fp.config > appliedConfigRevision()) jobs.push(fetchArenaConfig());
        if (snap.fp.display > appliedDisplayRevision()) jobs.push(fetchGlobalDisplay());
        if (snap.fp.catalog && snap.fp.catalog !== catalogRevRef.current) jobs.push(syncCatalog());
        if (changed.has("programs") && useArenaStore.getState().liveMode) jobs.push(fetchLivePrograms());
        if (changed.has("teams")) arenaBus.emit("teams:updated", {}, { broadcast: false }); // Teams Arena reloads its standings
        await Promise.allSettled(jobs);
      },
    });
    background.start();

    // Setup internal SSE stream: one per display, reopened automatically if the browser closes it for good
    // (e.g. a 502 during a deploy). A reopened stream counts as a reconnect: everything missed is resynced.
    let closeStream: (() => void) | null = null;
    let connectedOnce = false;
    try {
      closeStream = openResilientStream(
        "/api/arena/stream",
        (eventSource) => {
          sseRef.current = eventSource;

          eventSource.addEventListener("ready", (e) => {
            // (Re)connected: pick up anything missed while offline from the authoritative state.
            void syncCatalog();
            void fetchGlobalDisplay();
            void fetchArenaConfig();
            arenaBus.emit("cub:resync", {}, { broadcast: false });
            if (connectedOnce) arenaBus.emit("teams:updated", {}, { broadcast: false }); // reconnected: restore standings
            if (connectedOnce) {
              scheduleProgramsSync();
              scheduleLiveSync(300); // awards / sales missed during the gap (announced only if newer than page load)
              void background.trigger(); // sale popups missed during the gap (bounded window, never history)
            }
            connectedOnce = true;
            try {
              const payload = JSON.parse(e.data);
              // Show LIVE only once real data has actually loaded.
              if (payload.health?.status === "connected" && useArenaStore.getState().lastSyncAt) {
                setApiStatus("connected", null);
              }
            } catch {
              // ignore
            }
          });

          eventSource.addEventListener("sale.validated", (e) => {
            try {
              // Debounced batch refresh of the statistics (only for a sale not seen yet).
              if (handleSale(JSON.parse(e.data), "sse")) scheduleLiveSync(800);
            } catch (err) {
              console.error("[LiveApiSync] Failed to process sale event", err);
            }
          });

          // A committed award row. The reward runtime shows it once (deduped by award id) through the
          // single bonus popup queue, if the admin's announcement switches allow it.
          eventSource.addEventListener("rewards.award.created", (e) => {
            try {
              const msg = JSON.parse(e.data);
              const a = msg?.award as BonusAward | undefined;
              if (!a?.id || !useArenaStore.getState().liveMode) return;
              noteReceived({ kind: "award", key: a.id, source: msg.source, validatedAt: msg.validatedAt, firstSeenAt: msg.firstSeenAt, storedAt: a.createdAt, broadcastAt: msg.broadcastAt });
              useRewardsStore.getState().recordAwards([a]);
              scheduleAwardsSync(); // earned totals from PostgreSQL, not added up in the browser
            } catch (err) {
              console.error("[LiveApiSync] Failed to process award event", err);
            }
          });

          eventSource.addEventListener("rewards.program.updated", () => {
            scheduleProgramsSync();
            scheduleAwardsSync(); // a hidden / archived program changes the public totals
          });
          // An award was approved, paid, cancelled or reversed: totals change (earned excludes cancelled / reversed).
          eventSource.addEventListener("rewards.award.updated", () => scheduleAwardsSync());

          for (const type of CONFIG_EVENTS)
            eventSource.addEventListener(type, (e) => {
              let rev = Infinity;
              try {
                rev = Number(JSON.parse((e as MessageEvent).data)?.revision);
              } catch {
                /* fetch anyway */
              }
              if (!(rev <= appliedConfigRevision())) void fetchArenaConfig();
              if (type === "rewards.program.visibility.updated") {
                scheduleProgramsSync();
                scheduleLiveSync(400); // award list visibility changed
              }
            });

          // Weekly Top Performer ceremony (Admin-triggered, once per week on the server): into the existing
          // celebration queue, once per display (deduped by its id; never mirrored to other tabs, which have their own stream).
          eventSource.addEventListener("arena.recognition.weekly_top", (e) => {
            try {
              const p = JSON.parse((e as MessageEvent).data);
              const id = String(p?.id ?? "");
              if (!id || !p?.name || seenRecognitions.has(id)) return;
              seenRecognitions.add(id);
              arenaBus.emit(
                "celebration:enqueue",
                {
                  event: {
                    id: `recognition_${id}`,
                    tier: "weekly-top",
                    headline: "CONGRATULATIONS!",
                    subline: String(p.label ?? ""),
                    agentId: String(p.userCode ?? ""),
                    agentName: String(p.name),
                    teamName: null,
                    teamColor: null,
                    value: Number(p.validated) || 0,
                    createdAt: String(p.at ?? new Date().toISOString()),
                    preview: false,
                  },
                },
                { broadcast: false },
              );
            } catch {
              /* malformed: ignored */
            }
          });

          // Teams Arena: an Admin changed teams / memberships / designations.
          eventSource.addEventListener("teams.updated", () => arenaBus.emit("teams:updated", {}, { broadcast: false }));

          // Admin "Test Live Arena Sounds": one short test sound and a real acknowledgement (no popup, nothing created).
          eventSource.addEventListener("arena.sound.test", (e) => {
            try {
              const p = JSON.parse((e as MessageEvent).data);
              void import("@/frontend/audio/sound-test").then((m) => m.runDisplaySoundTest(p));
            } catch {
              /* malformed: ignored */
            }
          });

          // Arena Cub: an admin action validated, audited and broadcast by the server.
          eventSource.addEventListener("arena.cub.action", (e) => {
            try {
              arenaBus.emit("cub:command", JSON.parse((e as MessageEvent).data), { broadcast: false });
            } catch {
              /* malformed: ignored */
            }
          });

          eventSource.addEventListener("arena.screen.changed", (e) => {
            try {
              const p = JSON.parse(e.data);
              applyScreenSwitch({ screen: p.screen, revision: Number(p.revision) });
            } catch {
              void fetchArenaConfig();
            }
          });

          eventSource.addEventListener("spin.unlocked", (e) => {
            try {
              const payload = JSON.parse(e.data);
              // The popup looks agents up by id; map the server's userCode to the live agent.
              const code = String(payload.userCode ?? "").toUpperCase();
              if (!code) return;
              // One popup per ledger transaction, even if the event arrives twice.
              const eventKey = String(payload.eventId ?? "");
              if (eventKey) {
                if (seenSpinEvents.has(eventKey)) return;
                seenSpinEvents.add(eventKey);
                if (seenSpinEvents.size > 200) seenSpinEvents.delete(seenSpinEvents.values().next().value as string);
              }
              const agent = useArenaStore.getState().agents.find((a) => a.userCode === code);
              const name = String(payload.closerName || agent?.name || code);
              const qty = Number(payload.quantity) || 1;
              const manual = payload.origin === "manual";
              scheduleLiveSync(600); // balances refresh either way
              // The spin credit is stored regardless; only the public popup follows the admin switches.
              const s = useSettingsStore.getState();
              if (!s.arenaEnabled || !s.celebrationPopups || !s.spinFeatureEnabled || !s.spinFlowEnabled || !(manual ? s.announceManualSpins : s.announceAutoSpins)) return;
              useSpinFlowStore.getState().push({
                agentId: agent?.id ?? `agt_${code}`,
                userCode: code,
                agentName: name,
                periodSales: Number(payload.salesCounted) || 0,
                available: Number(payload.spinsAvailable) || qty,
                reason: manual ? "bonus" : "target",
                origin: manual ? "manual" : "automatic",
                message: manual
                  ? `Admin has awarded you ${qty} Spin${qty === 1 ? "" : "s"}!`
                  : `You have earned ${qty} Spin${qty === 1 ? "" : "s"}. ${Number(payload.salesCounted) || ""} validated sales completed.`.replace("  ", " "),
              });
            } catch (err) {
              console.error("[LiveApiSync] Failed to process spin unlock event", err);
            }
          });

          eventSource.addEventListener("settings.performance.updated", (e) => {
            try {
              const p = JSON.parse(e.data);
              applyGlobalDisplay({ performanceMode: p.mode, revision: Number(p.revision) });
            } catch {
              void fetchGlobalDisplay();
            }
          });

          eventSource.addEventListener("rewards.catalog.updated", (e) => {
            try {
              const rev = JSON.parse(e.data)?.revision;
              if (!rev || rev !== catalogRevRef.current) void syncCatalog();
            } catch {
              void syncCatalog();
            }
          });

          eventSource.addEventListener("stats.updated", () => {
            scheduleLiveSync(600);
          });

            },
        () => setApiStatus("error", "Live stream disconnected. Reconnecting..."),
      );
    } catch (err) {
      console.warn("[LiveApiSync] Could not establish EventSource", err);
    }

    return () => {
      isMountedRef.current = false;
      clearTimeout(initialCheck);
      if (programsTimer) clearTimeout(programsTimer);
      if (awardsTimer) clearTimeout(awardsTimer);
      if (debounceTimer) clearTimeout(debounceTimer);
      background.stop();
      closeStream?.();
    };
  }, [reconcile, syncCatalog, setApiStatus]);

  // Manual refresh (header button): one coordinated re-fetch of every live dataset. Read-only:
  // it never opens another SSE stream and never writes sales, spins or rewards.
  const refreshRequest = useLiveStore((s) => s.refreshRequest);
  useEffect(() => {
    if (refreshRequest === 0) return;
    // Deferred a tick (no state change inside the effect body). Always clears the spinner.
    setTimeout(() => {
      void reconcile(true).then(() => {
      if (useArenaStore.getState().apiSyncStatus === "error") {
        const err = useArenaStore.getState().apiSyncError;
        useLiveStore.getState().setRefreshing(false, err ? `Refresh failed: ${err}` : "Refresh failed. Showing the last verified data.");
      } else {
        useLiveStore.getState().setRefreshing(false);
      }
      });
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshRequest]);

  // Connection status is shown in the Live Arena header (frontend/components/layout/SafeQuoteStatus.tsx), from this same store state.
  return null;
}

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useArenaStore } from "@/store/arena-store";
import { useSettingsStore } from "@/store/settings-store";
import { useSpinFlowStore } from "@/store/spin-flow-store";
import { useRewardsStore } from "@/store/rewards-store";
import { useLiveStore } from "@/store/live-store";
import { arenaBus } from "@/lib/events/bus";
import { getPeriodDateRange } from "@/lib/time/business";
import type { Agent, Reward, Sale } from "@/types";
import type { CloserRow } from "@/features/sales/leads";

export function LiveApiSync() {
  const syncRealData = useArenaStore((s) => s.syncRealData);
  const setPeriodMetrics = useArenaStore((s) => s.setPeriodMetrics);
  const setAllTimeMetrics = useArenaStore((s) => s.setAllTimeMetrics);
  const setApiStatus = useArenaStore((s) => s.setApiStatus);
  const setServerSpinBalance = useArenaStore((s) => s.setServerSpinBalance);
  const apiStatus = useArenaStore((s) => s.apiSyncStatus);
  const apiError = useArenaStore((s) => s.apiSyncError);
  const dataSourceMode = useArenaStore((s) => s.dataSourceMode);
  const lastSyncAt = useArenaStore((s) => s.lastSyncAt);

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
          if (awardsRes.status === "fulfilled" && awardsRes.value.ok) {
            const awardsData = await awardsRes.value.json();
            if (Array.isArray(awardsData.awards)) {
              useRewardsStore.getState().setBackendAwards(awardsData.awards);
            }
          }

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

  // Connect to server-sent events for real-time sales and celebrations
  useEffect(() => {
    isMountedRef.current = true;
    const seenSales = new Set<string>();
    const seenSpinEvents = new Set<string>();
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let syncInterval: ReturnType<typeof setInterval> | null = null;

    // Coalesce rapid live updates into a single efficient batch
    const scheduleLiveSync = (delay = 800) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (isMountedRef.current && document.visibilityState === "visible") {
          fetchLiveStats();
        }
      }, delay);
    };

    // Initial check (deferred a tick so it does not set state during the effect)
    const initialCheck = setTimeout(() => {
      void fetchLiveStats(true);
      void syncCatalog();
    }, 0);

    // Setup periodic sync every 30s as safety reconciliation (paused when tab hidden)
    const startPeriodicSync = () => {
      if (syncInterval) clearInterval(syncInterval);
      syncInterval = setInterval(() => {
        if (document.visibilityState === "visible") {
          fetchLiveStats();
          void syncCatalog(); // lightweight freshness check; applies only on a new revision
        }
      }, 30_000);
    };

    startPeriodicSync();

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchLiveStats(); // Instant sync when user returns to tab
        startPeriodicSync();
      } else {
        if (syncInterval) clearInterval(syncInterval);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    // Setup internal SSE stream
    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource("/api/arena/stream");
      sseRef.current = eventSource;

      eventSource.addEventListener("ready", (e) => {
        void syncCatalog(); // (re)connected: pick up any catalog change missed while offline
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
          const payload = JSON.parse(e.data);
          const saleKey = String(payload.caseId || "");
          if (saleKey && seenSales.has(saleKey)) return;
          if (saleKey) {
            seenSales.add(saleKey);
            if (seenSales.size > 200) {
              const first = seenSales.values().next().value;
              if (first) seenSales.delete(first);
            }
          }

          // Broadcast celebratory announcement
          arenaBus.emit("celebration:enqueue", {
            event: {
              id: `celeb_sale_${payload.caseId || Date.now()}`,
              tier: "sale",
              headline: "SALE VALIDATED!",
              subline: `${payload.closerName || payload.userCode} · +1 Validated Sale — great work!`,
              agentId: payload.userCode,
              agentName: payload.closerName || payload.userCode,
              teamName: "FE Sales Arena",
              teamColor: "#36E0B5",
              value: payload.premium || null,
              createdAt: payload.validatedAt || new Date().toISOString(),
              preview: false,
            },
          });
          // Debounced batch refresh statistics
          scheduleLiveSync(800);
        } catch (err) {
          console.error("[LiveApiSync] Failed to process sale event", err);
        }
      });

      eventSource.addEventListener("bonus.awarded", (e) => {
        try {
          const payload = JSON.parse(e.data);
          arenaBus.emit("celebration:enqueue", {
            event: {
              id: `celeb_bonus_${payload.awardId || Date.now()}`,
              tier: "milestone",
              headline: `CONGRATULATIONS, ${payload.closer?.name || "CLOSER"}!`,
              subline: `Earned ${payload.amount ? `Rs. ${payload.amount.toLocaleString()}` : payload.prizeLabel} bonus!`,
              agentId: payload.closer?.userCode,
              agentName: payload.closer?.name,
              teamName: "Bonus Program",
              teamColor: "#FFC857",
              value: payload.amount || null,
              createdAt: new Date().toISOString(),
              preview: false,
            },
          });
        } catch (err) {
          console.error("[LiveApiSync] Failed to process bonus event", err);
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

      eventSource.onerror = () => {
        if (eventSource && eventSource.readyState === EventSource.CLOSED) {
          setApiStatus("error", "Live stream disconnected. Reconnecting...");
        }
      };
    } catch (err) {
      console.warn("[LiveApiSync] Could not establish EventSource", err);
    }

    return () => {
      isMountedRef.current = false;
      clearTimeout(initialCheck);
      if (debounceTimer) clearTimeout(debounceTimer);
      if (syncInterval) clearInterval(syncInterval);
      document.removeEventListener("visibilitychange", handleVisibility);
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [fetchLiveStats, setApiStatus]);

  // Manual refresh (header button): one coordinated re-fetch of every live dataset. Read-only:
  // it never opens another SSE stream and never writes sales, spins or rewards.
  const refreshRequest = useLiveStore((s) => s.refreshRequest);
  useEffect(() => {
    if (refreshRequest === 0) return;
    // Deferred a tick (no state change inside the effect body). Always clears the spinner.
    setTimeout(() => {
      void syncCatalog();
      void fetchLiveStats(false, true).then((ok) => {
      if (ok === false) {
        const err = useArenaStore.getState().apiSyncError;
        useLiveStore.getState().setRefreshing(false, err ? `Refresh failed: ${err}` : "Refresh failed. Showing the last verified data.");
      } else {
        useLiveStore.getState().setRefreshing(false);
      }
      });
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshRequest]);

  // Status Indicator Badge in bottom corner
  return (
    <aside
      aria-label="Live connection status"
      className="fixed bottom-3 right-4 z-50 flex items-center gap-2 rounded-full border border-white/10 bg-[#0A0E1A]/90 px-3.5 py-1.5 text-[11px] font-mono backdrop-blur-md shadow-lg"
    >
      {dataSourceMode === "production" ? (
        apiStatus === "connected" ? (
          <>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="font-semibold text-emerald-400">SAFE QUOTE LIVE</span>
            {lastSyncAt && (
              <span className="text-white/40 hidden sm:inline">
                · {new Date(lastSyncAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
          </>
        ) : (
          <>
            <span className="relative flex h-2 w-2">
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
            </span>
            <span className="font-semibold text-amber-400">
              {apiError ? "RECONNECTING" : "CONNECTING..."}
            </span>
          </>
        )
      ) : (
        <>
          <span className="relative flex h-2 w-2">
            <span className="relative inline-flex h-2 w-2 rounded-full bg-purple-400" />
          </span>
          <span className="font-medium text-purple-300">DEMO MODE (SIMULATED)</span>
        </>
      )}
    </aside>
  );
}

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useArenaStore } from "@/store/arena-store";
import { useSettingsStore } from "@/store/settings-store";
import { useSpinFlowStore } from "@/store/spin-flow-store";
import { useRewardsStore } from "@/store/rewards-store";
import { arenaBus } from "@/lib/events/bus";
import { getPeriodDateRange } from "@/lib/time/business";
import type { Agent, Sale } from "@/types";
import type { CloserRow } from "@/features/sales/leads";

export function LiveApiSync() {
  const syncRealData = useArenaStore((s) => s.syncRealData);
  const setPeriodMetrics = useArenaStore((s) => s.setPeriodMetrics);
  const setAllTimeMetrics = useArenaStore((s) => s.setAllTimeMetrics);
  const setApiStatus = useArenaStore((s) => s.setApiStatus);
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

  const fetchLiveStats = useCallback(async (isInitial = false) => {
    const currentSeq = ++syncSeqRef.current;
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
      ] = await Promise.allSettled([
        fetch(`/api/arena/summary?from=${dayRange.from}&to=${dayRange.to}`),
        fetch(`/api/arena/closers?from=${dayRange.from}&to=${dayRange.to}`),
        fetch(`/api/arena/recent-sales?from=${dayRange.from}&to=${dayRange.to}`),
        fetch(`/api/arena/summary?from=${weekRange.from}&to=${weekRange.to}`),
        fetch(`/api/arena/closers?from=${weekRange.from}&to=${weekRange.to}`),
        fetch(`/api/arena/recent-sales?from=${weekRange.from}&to=${weekRange.to}`),
        fetch(`/api/arena/summary?from=${monthRange.from}&to=${monthRange.to}`),
        fetch(`/api/arena/closers?from=${monthRange.from}&to=${monthRange.to}`),
        fetch(`/api/arena/recent-sales?from=${monthRange.from}&to=${monthRange.to}`),
        fetch("/api/arena/summary"),
        fetch("/api/arena/closers"),
        fetch("/api/arena/awards"),
      ]);

      if (currentSeq !== syncSeqRef.current) return false;

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

          // Sync real data into primary arena floor
          syncRealData({
            summary: daySummaryData.data,
            agents: liveAgents.length > 0 ? liveAgents : undefined,
            sales: daySales.length > 0 ? daySales : undefined,
            mode: "production",
          });

          return true;
        } else if (daySummaryData.mode === "unconfigured") {
          setApiStatus("unconfigured", "Safe Quote API token not set; running in demo mode");
          return false;
        }
      } else if (daySummaryRes.status === "fulfilled" && daySummaryRes.value.status === 503) {
        setApiStatus("unconfigured", "API not configured; demo mode active");
        return false;
      } else {
        throw new Error("Unable to reach Sales Arena backend API");
      }
    } catch (err) {
      if (!isMountedRef.current || currentSeq !== syncSeqRef.current) return false;
      const errorMsg = err instanceof Error ? err.message : "Connection failed";
      retryCountRef.current++;
      setApiStatus("error", errorMsg);
      return false;
    }
    return false;
  }, [businessTimezone, weekStartDay, setApiStatus, setPeriodMetrics, setAllTimeMetrics, syncRealData]);

  // Connect to server-sent events for real-time sales and celebrations
  useEffect(() => {
    isMountedRef.current = true;

    // Initial check
    fetchLiveStats(true);

    // Setup periodic sync every 30s as safety reconciliation
    const syncInterval = setInterval(() => {
      fetchLiveStats();
    }, 30_000);

    // Setup internal SSE stream
    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource("/api/arena/stream");
      sseRef.current = eventSource;

      eventSource.addEventListener("ready", (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload.health?.status === "connected") {
            setApiStatus("connected", null);
          }
        } catch {
          // ignore
        }
      });

      eventSource.addEventListener("sale.validated", (e) => {
        try {
          const payload = JSON.parse(e.data);
          // Broadcast celebratory announcement
          arenaBus.emit("celebration:enqueue", {
            event: {
              id: `celeb_sale_${payload.caseId || Date.now()}`,
              tier: "sale",
              headline: "SALE VALIDATED!",
              subline: `${payload.closerName || payload.userCode} closed a policy!`,
              agentId: payload.userCode,
              agentName: payload.closerName || payload.userCode,
              teamName: "Sales Arena",
              teamColor: "#36E0B5",
              value: payload.premium || null,
              createdAt: payload.validatedAt || new Date().toISOString(),
              preview: false,
            },
          });
          // Refresh statistics
          fetchLiveStats();
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
          useSpinFlowStore.getState().push({
            agentId: payload.userCode,
            periodSales: payload.periodSales || 0,
            available: payload.spinsAvailable || 1,
            reason: "target",
          });
        } catch (err) {
          console.error("[LiveApiSync] Failed to process spin unlock event", err);
        }
      });

      eventSource.addEventListener("stats.updated", () => {
        fetchLiveStats();
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
      clearInterval(syncInterval);
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [fetchLiveStats, setApiStatus]);

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

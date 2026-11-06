"use client";

import { useEffect, useRef, useState } from "react";
import { useArenaStore } from "@/frontend/stores/arena-store";
import { arenaBus } from "@/frontend/events/bus";
import type { RankedTeam, TopPerformer } from "@/shared/teams/ranking";

export type TeamPeriod = "day" | "week" | "month";

export interface TeamStandings {
  period: TeamPeriod;
  from: string;
  to: string;
  label: string;
  teams: RankedTeam[];
  top: TopPerformer[];
  leaderTeamId: string | null;
  attribution: string;
  generatedAt: string;
}

/**
 * Teams Arena standings for one period, kept current WITHOUT a timer of its own. It reloads when:
 *  - the live sales data refreshed (a validated sale on the live stream, the 15 s background sync or the
 *    full refresh all end in the same store update: lastSyncAt);
 *  - teams / memberships / designations changed (stream event or background sync fingerprint);
 *  - the live stream reconnected.
 * One request at a time per display (newer replaces older, the obsolete one is aborted); the last good data
 * stays on screen when a request fails. Nothing here writes anything.
 */
export function useTeamStandings(period: TeamPeriod) {
  const [data, setData] = useState<TeamStandings | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const lastSyncAt = useArenaStore((s) => s.lastSyncAt);
  const [bump, setBump] = useState(0);
  const ctrl = useRef<AbortController | null>(null);
  const seq = useRef(0);

  useEffect(() => arenaBus.on("teams:updated", () => setBump((n) => n + 1)), []);

  useEffect(() => {
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      ctrl.current?.abort();
      const ac = new AbortController();
      ctrl.current = ac;
      try {
        const res = await fetch(`/api/arena/teams?period=${period}`, { cache: "no-store", signal: ac.signal });
        const j = await res.json().catch(() => null);
        if (mine !== seq.current) return; // a newer request owns the screen
        if (!res.ok || !j?.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
        setData(j as TeamStandings);
        setStatus("ok");
      } catch {
        if (mine === seq.current && !ac.signal.aborted) setStatus((s) => (s === "loading" ? "error" : s === "ok" ? "ok" : "error"));
      }
    }, 250); // coalesces a burst of triggers into one request
    return () => clearTimeout(t);
  }, [period, lastSyncAt, bump]);

  useEffect(() => () => ctrl.current?.abort(), []);
  // Period switch: drop the other period's data at once (never show This Week's numbers under "Today").
  const shown = data && data.period === period ? data : null;
  return { data: shown, status: shown ? "ok" : status };
}

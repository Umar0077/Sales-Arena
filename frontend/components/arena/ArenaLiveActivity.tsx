"use client";

import { memo } from "react";
import type { ActivityEvent } from "@/shared/types";
import { TimeAgo } from "@/frontend/components/common/TimeAgo";
import { 
  CheckCircle2, 
  Gift, 
  Flame, 
  Crown, 
  Trophy, 
  Sparkles, 
  Disc3, 
  Clock 
} from "lucide-react";

export const ArenaLiveActivity = memo(function ArenaLiveActivity({
  events,
  title = "LIVE TRANSACTION WIRE",
  badge = "STREAMING",
  types,
  limit = 12,
  emptyText = "Waiting for the next update…",
}: {
  events: ActivityEvent[];
  title?: string;
  badge?: string;
  /** Only show these activity types. */
  types?: ActivityEvent["type"][];
  limit?: number;
  emptyText?: string;
}) {
  const displayEvents = (types ? events.filter((e) => types.includes(e.type)) : events).slice(0, limit);

  const getIcon = (type: ActivityEvent["type"]) => {
    switch (type) {
      case "sale-approved":
        return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
      case "spin-unlocked":
        return <Gift className="w-3.5 h-3.5 text-primary" />;
      case "milestone":
        return <Flame className="w-3.5 h-3.5 text-secondary" />;
      case "top-performer":
        return <Crown className="w-3.5 h-3.5 text-gold" />;
      case "team-target":
        return <Trophy className="w-3.5 h-3.5 text-gold" />;
      case "spin-completed":
        return <Disc3 className="w-3.5 h-3.5 text-gold" />;
      default:
        return <Sparkles className="w-3.5 h-3.5 text-secondary" />;
    }
  };

  return (
    <div className="ac-panel p-5 lg:p-6 flex flex-col h-full">
      <div className="flex items-center justify-between mb-4 border-b border-white/[0.06] pb-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg border border-secondary/30 bg-secondary/10">
            <Clock className="w-4 h-4 text-secondary" />
          </span>
          <h3 className="font-heading text-base font-bold text-white tracking-wide">
            {title}
          </h3>
        </div>
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-emerald-400/25 bg-emerald-500/10 text-emerald-300 text-[10px] font-mono font-bold tracking-wider">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          {badge}
        </span>
      </div>

      <div className="space-y-2.5 overflow-y-auto max-h-[420px] pr-1">
        {displayEvents.length === 0 && (
          <div className="ac-empty">
            <span className="ac-empty__icon">
              <Clock className="h-5 w-5 text-secondary" />
            </span>
            <p className="text-sm font-semibold text-text-secondary">{emptyText}</p>
            <p className="text-xs text-text-muted">New entries stream in live as they happen.</p>
          </div>
        )}
        {displayEvents.map((e) => (
          <div
            key={e.id}
            className="flex items-start gap-3 p-3 rounded-xl border border-white/[0.06] bg-gradient-to-r from-white/[0.04] to-transparent"
          >
            <div className="mt-0.5 grid h-7 w-7 place-items-center rounded-lg bg-white/[0.05] border border-white/10 shrink-0">
              {getIcon(e.type)}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-[13px] text-text-primary font-medium leading-snug">
                {e.message}
              </p>
              <span className="text-[11px] text-text-muted block mt-0.5">
                <TimeAgo iso={e.createdAt} />
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

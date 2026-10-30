"use client";

import { memo } from "react";
import type { ActivityEvent } from "@/types";
import { TimeAgo } from "@/components/common/TimeAgo";
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
    <div className="rounded-3xl border border-white/10 bg-[#0D1426]/90 p-5 lg:p-6 backdrop-blur-xl flex flex-col h-full">
      <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-3">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-secondary" />
          <h3 className="font-heading text-base font-bold text-white tracking-tight">
            {title}
          </h3>
        </div>
        <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[10px] font-mono font-bold">
          {badge}
        </span>
      </div>

      <div className="space-y-2.5 overflow-y-auto max-h-[420px] pr-1">
        {displayEvents.length === 0 && <p className="py-8 text-center text-sm text-text-muted">{emptyText}</p>}
        {displayEvents.map((e) => (
          <div
            key={e.id}
            className="flex items-start gap-3 p-2.5 rounded-xl bg-surface/40 border border-white/5 hover:border-white/10 transition-colors"
          >
            <div className="mt-0.5 p-1 rounded-lg bg-surface border border-white/10 shrink-0">
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

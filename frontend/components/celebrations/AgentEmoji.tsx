"use client";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { useReducedMotion } from "@/frontend/performance/reduced-motion";
import { useSettingsStore } from "@/frontend/stores/settings-store";

/** Presentation only: no queue, audio, sales, or reward side effects. */
export type AgentEmojiProps = {
  agentId: string | null;
  name: string;
  url?: string | null;
  className?: string;
  fallback?: React.ReactNode;
};

export function AgentEmoji(props: AgentEmojiProps) {
  return <EmojiImage key={props.agentId + ":" + (props.url ?? "")} {...props} />;
}

function EmojiImage({ agentId, name, url: previewUrl, className, fallback }: AgentEmojiProps) {
  const [url, setUrl] = useState<string | null>(previewUrl ?? null);
  const [failed, setFailed] = useState(false);
  const reduced = useReducedMotion();
  const lite = useSettingsStore((s) => s.quality === "performance");

  useEffect(() => {
    if (previewUrl !== undefined || !agentId) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    fetch("/api/arena/agent-emojis?agent=" + encodeURIComponent(agentId), { signal: controller.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!controller.signal.aborted) setUrl(j?.url ?? null);
      })
      .catch(() => {});
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [agentId, previewUrl]);

  if (!url || failed) return fallback ? <>{fallback}</> : null;

  return (
    <motion.img
      src={url}
      alt={name + " emoji"}
      onError={() => setFailed(true)}
      initial={reduced || lite ? false : { opacity: 0, scale: 0.85, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 350, damping: 25 }}
      className={
        className ??
        "tc-agent-emoji relative mx-auto h-[clamp(170px,40vh,440px)] w-auto max-w-[38vw] sm:max-w-[44vw] shrink-0 object-contain drop-shadow-[0_18px_36px_rgba(0,0,0,0.75)]"
      }
      draggable={false}
    />
  );
}

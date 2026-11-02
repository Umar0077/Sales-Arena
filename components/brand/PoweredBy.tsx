import { cn } from "@/lib/utils";

/**
 * "Powered by GO CONNECTIVO" badge. `size="lg"` is the Live Arena version: ~30% larger, with a static
 * cyan + orange neon glow (box-shadow only: no animation, no backdrop blur, so idle CPU stays flat).
 */
export function PoweredByBadge({ className, size = "md" }: { className?: string; size?: "md" | "lg" }) {
  const lg = size === "lg";
  return (
    <div
      aria-label="Powered by Go Connectivo"
      data-testid="powered-by"
      className={cn(
        "flex w-fit items-center rounded-full select-none",
        lg
          ? "gap-3 border border-cyan-300/40 bg-[#0A1020]/95 py-2 pl-[18px] pr-5 shadow-[0_0_0_1px_rgba(255,140,40,0.18),0_0_18px_-2px_rgba(34,211,238,0.45),0_0_34px_-6px_rgba(255,140,40,0.40),0_10px_28px_-12px_rgba(0,0,0,0.9)]"
          : "gap-2.5 border border-white/10 bg-[#0B1122]/80 py-1.5 pl-3.5 pr-4 shadow-[0_8px_24px_-10px_rgba(0,0,0,0.8)] backdrop-blur-xl",
        className,
      )}
    >
      <span className={cn("font-semibold uppercase", lg ? "text-[12px] tracking-[0.16em] text-[#B9C6E4]" : "text-[10px] font-medium tracking-[0.14em] text-text-muted")}>
        Powered by
      </span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/goconnectivo-mark.png"
        alt=""
        width={lg ? 32 : 24}
        height={lg ? 32 : 24}
        className={cn("object-contain", lg ? "h-8 w-8 drop-shadow-[0_0_6px_rgba(255,140,40,0.55)]" : "h-6 w-6")}
      />
      <span className="flex flex-col leading-none text-white">
        <span className={cn("font-heading font-extrabold tracking-wide", lg ? "text-[17px] [text-shadow:0_0_10px_rgba(34,211,238,0.45)]" : "text-[13px]")}>GO</span>
        <span className={cn("font-bold", lg ? "mt-0.5 text-[10px] tracking-[0.14em]" : "text-[8px] tracking-[0.12em]")}>CONNECTIVO</span>
      </span>
    </div>
  );
}

/** Floating version, bottom-right. The Live Arena uses the large glowing badge (smaller on phones). */
export function PoweredBy({ className, size = "md" }: { className?: string; size?: "md" | "lg" }) {
  return (
    <div className={cn("pointer-events-none fixed bottom-3 right-3 z-[95] sm:bottom-4 sm:right-4", className)}>
      {size === "lg" ? (
        <>
          <PoweredByBadge size="md" className="sm:hidden" />
          <PoweredByBadge size="lg" className="hidden sm:flex" />
        </>
      ) : (
        <PoweredByBadge />
      )}
    </div>
  );
}

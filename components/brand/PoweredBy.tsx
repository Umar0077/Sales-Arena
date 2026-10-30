import { cn } from "@/lib/utils";

/** "Powered by GO CONNECTIVO" badge. */
export function PoweredByBadge({ className }: { className?: string }) {
  return (
    <div
      aria-label="Powered by Go Connectivo"
      className={cn(
        "flex w-fit items-center gap-2.5 rounded-full border border-white/10 bg-[#0B1122]/80 py-1.5 pl-3.5 pr-4 shadow-[0_8px_24px_-10px_rgba(0,0,0,0.8)] backdrop-blur-xl select-none",
        className,
      )}
    >
      <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-text-muted">Powered by</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/goconnectivo-mark.png" alt="" width={24} height={24} className="h-6 w-6 object-contain" />
      <span className="flex flex-col leading-none text-white">
        <span className="font-heading text-[13px] font-extrabold tracking-wide">GO</span>
        <span className="text-[8px] font-bold tracking-[0.12em]">CONNECTIVO</span>
      </span>
    </div>
  );
}

/** Floating version, bottom-right, stacked directly above the Safe Quote Live status pill. */
export function PoweredBy({ className }: { className?: string }) {
  return (
    <div className={cn("pointer-events-none fixed bottom-12 right-4 z-[95]", className)}>
      <PoweredByBadge />
    </div>
  );
}

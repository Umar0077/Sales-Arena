"use client";

import { useSettingsStore } from "@/store/settings-store";
import { cn } from "@/lib/utils";

/** Shield mark (or the admin-uploaded logo) with the configurable brand name. */
export function BrandLogo({
  size = 44,
  showText = true,
  subtitle,
  className,
}: {
  size?: number;
  showText?: boolean;
  subtitle?: string;
  className?: string;
}) {
  const customLogo = useSettingsStore((s) => s.customLogo);
  const brandName = useSettingsStore((s) => s.brandName);
  const tagline = useSettingsStore((s) => s.brandTagline);
  const [first, ...rest] = (brandName || "SALES ARENA").split(" ");

  return (
    <div className={cn("flex items-center gap-3 min-w-0", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={customLogo || "/brand/logo-mark.webp"}
        alt={`${brandName} logo`}
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className="object-contain brand-glow shrink-0"
      />
      {showText && (
        <div className="min-w-0 leading-none">
          <div className="font-heading font-extrabold tracking-tight text-white text-lg truncate">
            {first}
            {rest.length > 0 && <span className="text-gold"> {rest.join(" ")}</span>}
          </div>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted truncate">
            {subtitle ?? tagline}
          </div>
        </div>
      )}
    </div>
  );
}

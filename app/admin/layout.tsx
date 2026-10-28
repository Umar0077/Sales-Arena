"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, MonitorPlay, Users, Shield, BarChart3, Target, Gift, Trophy, PartyPopper, History,
  Palette, Webhook, ExternalLink, Menu, X,
} from "lucide-react";
import { ArenaBackdrop } from "@/components/layout/ArenaBackdrop";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { HydrationGate } from "@/components/common/HydrationGate";
import { PoweredBy, PoweredByBadge } from "@/components/brand/PoweredBy";
import { cn } from "@/lib/utils";

const ADMIN_NAV = [
  { href: "/admin", label: "Overview Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/arena", label: "Live Arena Controls", icon: MonitorPlay },
  { href: "/admin/agents", label: "Agent Management", icon: Users },
  { href: "/admin/teams", label: "Team Management", icon: Shield },
  { href: "/admin/performance", label: "Sales & Performance", icon: BarChart3 },
  { href: "/admin/targets", label: "Target Management", icon: Target },
  { href: "/admin/rewards", label: "Spin & Rewards", icon: Gift },
  { href: "/admin/leaderboard", label: "Leaderboard Settings", icon: Trophy },
  { href: "/admin/celebrations", label: "Celebration Settings", icon: PartyPopper },
  { href: "/admin/spins", label: "Spin History", icon: History },
  { href: "/admin/settings", label: "Appearance & Sound", icon: Palette },
  { href: "/admin/integrations", label: "Integration Preview", icon: Webhook },
];

/** Admin Panel shell: its own sidebar and top bar, separate from the public Live Arena. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const current = ADMIN_NAV.find((l) => (l.exact ? pathname === l.href : pathname.startsWith(l.href))) ?? ADMIN_NAV[0];

  // Close the mobile drawer after navigating.
  useEffect(() => {
    const id = setTimeout(() => setOpen(false), 0);
    return () => clearTimeout(id);
  }, [pathname]);

  const nav = (
    <nav aria-label="Admin" className="flex flex-col gap-1 p-3">
      {ADMIN_NAV.map((l, i) => {
        const active = l.href === current.href;
        const Icon = l.icon;
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
              active ? "bg-primary/15 text-white ring-1 ring-primary/40" : "text-text-secondary hover:bg-white/[0.04] hover:text-white",
            )}
          >
            <span className={cn("w-5 text-right text-[11px] font-semibold tabular", active ? "text-secondary" : "text-text-muted")}>{i + 1}</span>
            <Icon className={cn("h-4 w-4 shrink-0", active ? "text-secondary" : "text-text-muted group-hover:text-white")} />
            <span className="truncate">{l.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen">
      <ArenaBackdrop variant="console" />

      {/* Sidebar (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 flex-col border-r border-white/[0.06] bg-[#080C19]/90 backdrop-blur-xl lg:flex">
        <div className="flex h-16 items-center border-b border-white/[0.06] px-5">
          <BrandLogo size={36} subtitle="Admin Panel" />
        </div>
        <div className="flex-1 overflow-y-auto">{nav}</div>
        <div className="space-y-3 border-t border-white/[0.06] p-4">
          <PoweredByBadge />
          <p className="text-[11px] leading-relaxed text-text-muted">
            Demo mode: settings are saved in this browser only and do not sync to other devices.
          </p>
        </div>
      </aside>

      {/* Drawer (mobile) */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Admin navigation">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 overflow-y-auto border-r border-white/10 bg-[#080C19]">
            <div className="flex h-16 items-center justify-between border-b border-white/[0.06] px-4">
              <BrandLogo size={32} subtitle="Admin Panel" />
              <button onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-lg text-text-secondary hover:text-white" aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            {nav}
          </div>
        </div>
      )}

      {/* Mobile has no sidebar, so the badge floats instead. */}
      <PoweredBy className="lg:hidden" />

      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-white/[0.06] bg-[#070B16]/75 px-4 backdrop-blur-xl lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button onClick={() => setOpen(true)} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-text-secondary hover:text-white lg:hidden" aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-muted">Admin Panel</p>
              <h1 className="truncate font-heading text-lg font-bold text-white">{current.label}</h1>
            </div>
          </div>
          <Link
            href="/"
            target="sales-arena-live"
            className="inline-flex items-center gap-2 rounded-xl border border-secondary/30 bg-secondary/10 px-3.5 py-2 text-sm font-semibold text-secondary transition-colors hover:bg-secondary/20"
          >
            <ExternalLink className="h-4 w-4" />
            <span className="hidden sm:inline">Open Live Arena</span>
          </Link>
        </header>
        <main className="mx-auto w-full max-w-7xl p-4 pb-20 lg:p-8 lg:pb-20">
          <HydrationGate>{children}</HydrationGate>
        </main>
      </div>
    </div>
  );
}

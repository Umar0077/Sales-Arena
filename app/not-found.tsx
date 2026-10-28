import Link from "next/link";
import { Disc3 } from "lucide-react";
import { PoweredBy } from "@/components/brand/PoweredBy";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-4 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface border border-white/10">
        <Disc3 className="h-8 w-8 text-secondary animate-spin" />
      </div>
      <h2 className="font-heading text-3xl font-black text-white">404 - Arena Not Found</h2>
      <p className="mt-2 text-sm text-text-secondary">
        The stadium sector or broadcast feed you requested is currently offline.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-xl bg-primary px-6 py-2.5 font-heading text-xs font-bold text-white shadow-lg shadow-primary/25 hover:brightness-110 transition-all"
      >
        Return to Live Arena
      </Link>
      <PoweredBy />
    </div>
  );
}

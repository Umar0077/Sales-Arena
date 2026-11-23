"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  CARRIER_WEIGHT_RULES,
  DEFAULT_CARRIER_CREDIT,
  classifyCarrierWeight,
  formatSalesCount,
  type CarrierWeightRule,
} from "@/shared/sales/weighting";
import { adminApi } from "@/frontend/components/admin/admin-api";
import { Section, inputClass } from "@/frontend/components/admin/ui";
import type {
  HistoricalSwilSaleRow,
  ObservedCarrierRow,
} from "@/app/api/admin/carriers/route";
import {
  Scale,
  Search,
  CheckCircle2,
  ShieldCheck,
  Info,
  Sparkles,
  Clock,
  Database,
  FileCheck2,
} from "lucide-react";

type FilterMode = "all" | "half" | "full" | "explicit" | "default";

interface TableCarrierItem {
  id: string;
  name: string;
  normalizedName: string;
  credit: 0.5 | 1.0;
  category: "Half Credit" | "Full Credit";
  ruleType: "Explicit Override" | "Default Rule";
  precedence: number;
  aliases: string[];
  description: string;
  updatedAt: string;
  rawValidatedCount?: number;
  creditedTotal?: number;
  lastValidatedAt?: string | null;
}

export function CarrierWeightingManager({
  initialObserved = [],
  initialSwilAudit = null,
}: {
  initialObserved?: ObservedCarrierRow[];
  initialSwilAudit?: {
    databaseAvailable: boolean;
    totalSwilSales: number;
    legacyCreditedTotal: number;
    correctedCreditedTotal: number;
    totalCreditDelta: number;
    affectedAgentsCount: number;
    sales: HistoricalSwilSaleRow[];
  } | null;
} = {}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [selectedId, setSelectedId] = useState<string>(
    CARRIER_WEIGHT_RULES[0].id,
  );
  const [testInput, setTestInput] = useState("Corebridge Financial-SWIL");
  const [observed, setObserved] =
    useState<ObservedCarrierRow[]>(initialObserved);
  const [swilAudit, setSwilAudit] = useState(initialSwilAudit);

  useEffect(() => {
    let active = true;
    adminApi<{
      ok: boolean;
      observedCarriers: ObservedCarrierRow[];
      swilAudit: NonNullable<typeof initialSwilAudit>;
    }>("/api/admin/carriers").then((res) => {
      if (!active || !res.ok) return;
      setObserved(res.data.observedCarriers ?? []);
      setSwilAudit(res.data.swilAudit ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  const halfCreditCount = useMemo(
    () => CARRIER_WEIGHT_RULES.filter((r) => r.credit === 0.5).length,
    [],
  );
  const fullCreditCount = useMemo(
    () => CARRIER_WEIGHT_RULES.filter((r) => r.credit === 1.0).length,
    [],
  );

  // Combine canonical explicit rules with any observed default-rule carriers from PostgreSQL
  const allItems: TableCarrierItem[] = useMemo(() => {
    const base: TableCarrierItem[] = CARRIER_WEIGHT_RULES.map((rule: CarrierWeightRule) => {
      const matchingObserved = observed.filter(
        (o) => o.matchedRuleId === rule.id,
      );
      const rawSum = matchingObserved.reduce(
        (acc, o) => acc + o.rawValidatedCount,
        0,
      );
      const credSum = matchingObserved.reduce(
        (acc, o) => acc + o.creditedTotal,
        0,
      );
      const latest =
        matchingObserved
          .map((o) => o.lastValidatedAt)
          .filter((x): x is string => Boolean(x))
          .sort()
          .pop() ?? null;

      return {
        ...rule,
        aliases: [...rule.aliases],
        rawValidatedCount: matchingObserved.length > 0 ? rawSum : undefined,
        creditedTotal: matchingObserved.length > 0 ? credSum : undefined,
        lastValidatedAt: latest,
      };
    });

    // Append observed default-rule (1.0) carriers from PostgreSQL so admins can inspect them
    for (const obs of observed) {
      if (obs.ruleType === "Default Rule") {
        base.push({
          id: `observed-${obs.normalizedName || obs.carrier}`,
          name: obs.carrier,
          normalizedName: obs.normalizedName,
          credit: obs.credit,
          category: obs.category,
          ruleType: "Default Rule",
          precedence: 4,
          aliases: [obs.carrier],
          description:
            "Observed validated carrier in PostgreSQL. Inherits the default 1.0 full-credit rule per validated transaction.",
          updatedAt: obs.lastValidatedAt ?? "2026-11-24T00:00:00.000Z",
          rawValidatedCount: obs.rawValidatedCount,
          creditedTotal: obs.creditedTotal,
          lastValidatedAt: obs.lastValidatedAt,
        });
      }
    }

    return base;
  }, [observed]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allItems.filter((item) => {
      if (filter === "half" && item.credit !== 0.5) return false;
      if (filter === "full" && item.credit !== 1.0) return false;
      if (filter === "explicit" && item.ruleType !== "Explicit Override")
        return false;
      if (filter === "default" && item.ruleType !== "Default Rule")
        return false;

      if (!q) return true;
      const haystack = [
        item.name,
        item.normalizedName,
        item.category,
        item.ruleType,
        ...item.aliases,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [allItems, search, filter]);

  const selectedItem =
    allItems.find((item) => item.id === selectedId) ??
    filteredItems[0] ??
    allItems[0];

  const liveClassification = useMemo(
    () => classifyCarrierWeight(testInput),
    [testInput],
  );

  return (
    <div className="space-y-6" data-testid="carrier-weighting-page">
      {/* 1. Top Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div
          className="rounded-2xl border border-amber-400/30 bg-[#0D1426]/90 p-5 shadow-lg"
          data-testid="summary-half-credit"
        >
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-amber-300">
            <span>0.5 Credit Carriers</span>
            <Scale className="h-4 w-4 text-amber-300" />
          </div>
          <div className="mt-2 font-heading text-3xl font-black text-white tabular">
            {halfCreditCount}
          </div>
          <p className="mt-1 text-xs text-text-muted">
            Configured half-credit carriers (Corebridge Financial, Gerber,
            Gerber Life)
          </p>
        </div>

        <div
          className="rounded-2xl border border-emerald-400/30 bg-[#0D1426]/90 p-5 shadow-lg"
          data-testid="summary-full-credit"
        >
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-emerald-300">
            <span>1.0 Credit Carriers</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-300" />
          </div>
          <div className="mt-2 font-heading text-3xl font-black text-white tabular">
            {fullCreditCount}
          </div>
          <p className="mt-1 text-xs text-text-muted">
            Explicitly configured 1.0 full-credit override (Corebridge
            Financial-SWIL)
          </p>
        </div>

        <div
          className="rounded-2xl border border-secondary/30 bg-[#0D1426]/90 p-5 shadow-lg"
          data-testid="summary-default-credit"
        >
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-secondary">
            <span>Default Credit</span>
            <ShieldCheck className="h-4 w-4 text-secondary" />
          </div>
          <div className="mt-2 font-heading text-3xl font-black text-white tabular">
            {DEFAULT_CARRIER_CREDIT.toFixed(1)}
          </div>
          <p className="mt-1 text-xs text-text-muted">
            Inherited by all other genuinely validated insurance carriers
          </p>
        </div>
      </div>

      {/* 2. Main Carrier Overview Table & Search/Filter */}
      <Section
        title="Carrier Sales Weighting Rules"
        description="Authoritative carrier credit rules applied across Daily, Weekly, Monthly, Teams Arena, leaderboards, targets, spin eligibility, and bonus calculations. Upper Total Sales cards always show actual validated transaction counts (1 per validated sale)."
      >
        {/* Search and Filter Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              aria-label="Search carriers"
              data-testid="carrier-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search carrier or product name (e.g. Corebridge Financial-SWIL, Gerber)..."
              className={`${inputClass} pl-10`}
            />
          </div>

          <div
            className="flex flex-wrap items-center gap-1.5"
            role="group"
            aria-label="Carrier credit filters"
          >
            {(
              [
                { id: "all", label: "All Rules" },
                { id: "half", label: "0.5 Credit" },
                { id: "full", label: "1.0 Credit" },
                { id: "explicit", label: "Explicit Overrides" },
                { id: "default", label: "Inherited Default" },
              ] as const
            ).map((btn) => (
              <button
                key={btn.id}
                type="button"
                data-testid={`carrier-filter-${btn.id}`}
                onClick={() => setFilter(btn.id)}
                className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                  filter === btn.id
                    ? "border-primary/60 bg-primary/20 text-white"
                    : "border-white/10 bg-white/[0.03] text-text-secondary hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        {/* Carrier Table */}
        <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#080D1B]">
          <table
            className="w-full text-left text-sm"
            data-testid="carrier-weighting-table"
          >
            <thead className="border-b border-white/10 bg-white/[0.03] text-xs font-bold uppercase tracking-wider text-text-muted">
              <tr>
                <th className="px-4 py-3">Carrier / Product</th>
                <th className="px-4 py-3">Sale Credit</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Rule Source</th>
                <th className="px-4 py-3">Precedence</th>
                <th className="px-4 py-3 text-right">Observed Sales</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {filteredItems.map((item) => {
                const isSelected = selectedItem?.id === item.id;
                const isHalf = item.credit === 0.5;
                return (
                  <tr
                    key={item.id}
                    data-testid={`carrier-row-${item.id}`}
                    onClick={() => setSelectedId(item.id)}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-primary/15"
                        : "hover:bg-white/[0.03]"
                    }`}
                  >
                    <td className="px-4 py-3.5 font-semibold text-white">
                      <div className="flex items-center gap-2">
                        <span>{item.name}</span>
                        {item.id === "corebridge-financial-swil" && (
                          <span className="rounded-full border border-emerald-400/40 bg-emerald-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                            SWIL Exception
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs font-mono text-text-muted">
                        Normalized: {item.normalizedName}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 font-heading text-base font-extrabold tabular">
                      <span
                        className={
                          isHalf ? "text-amber-300" : "text-emerald-300"
                        }
                      >
                        {item.credit.toFixed(1)}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                          isHalf
                            ? "border-amber-400/35 bg-amber-400/10 text-amber-200"
                            : "border-emerald-400/35 bg-emerald-400/10 text-emerald-200"
                        }`}
                      >
                        {item.category}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-xs">
                      <span
                        className={`rounded-md border px-2 py-1 font-medium ${
                          item.ruleType === "Explicit Override"
                            ? "border-primary/40 bg-primary/15 text-white"
                            : "border-white/15 bg-white/5 text-text-secondary"
                        }`}
                      >
                        {item.ruleType}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-xs font-mono text-text-secondary">
                      Step #{item.precedence}
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-xs text-text-secondary tabular">
                      {item.rawValidatedCount !== undefined ? (
                        <span>
                          <strong className="text-white">
                            {item.rawValidatedCount}
                          </strong>{" "}
                          actual →{" "}
                          <strong className="text-secondary">
                            {formatSalesCount(item.creditedTotal ?? 0)}
                          </strong>{" "}
                          credited
                        </span>
                      ) : (
                        <span className="text-text-muted">Configured Rule</span>
                      )}
                    </td>
                  </tr>
                );
              })}

              {/* Default Fallback Rule Row */}
              {(filter === "all" ||
                filter === "full" ||
                filter === "default") &&
                (!search.trim() ||
                  "all other genuinely validated carriers default full credit 1.0".includes(
                    search.trim().toLowerCase(),
                  )) && (
                  <tr
                    data-testid="carrier-row-default"
                    className="bg-white/[0.015]"
                  >
                    <td className="px-4 py-3.5 font-semibold text-text-secondary">
                      All Other Genuinely Validated Carriers
                      <div className="mt-0.5 text-xs text-text-muted">
                        e.g. Americo Financial, Aetna, Mutual of Omaha,
                        Transamerica, American Amicable
                      </div>
                    </td>
                    <td className="px-4 py-3.5 font-heading text-base font-extrabold text-emerald-300 tabular">
                      1.0
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center rounded-full border border-emerald-400/35 bg-emerald-400/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-200">
                        Full Credit
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-xs">
                      <span className="rounded-md border border-white/15 bg-white/5 px-2 py-1 font-medium text-text-secondary">
                        Default Rule
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-xs font-mono text-text-secondary">
                      Step #4 (Fallback)
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-xs text-text-muted">
                      1.0 per validated sale
                    </td>
                  </tr>
                )}

              {filteredItems.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-sm text-text-muted"
                  >
                    No configured or observed carriers match your current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 3. Selected Carrier Details Inspector */}
        {selectedItem && (
          <div
            data-testid="carrier-detail-panel"
            className="rounded-2xl border border-primary/30 bg-[#0B1224] p-5 space-y-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <Info className="h-4 w-4 text-secondary" />
                  <span className="text-xs font-bold uppercase tracking-wider text-secondary">
                    Selected Carrier Rule Inspector
                  </span>
                </div>
                <h3 className="mt-1 font-heading text-xl font-extrabold text-white">
                  {selectedItem.name}
                </h3>
                <p className="mt-1 text-xs text-text-secondary">
                  {selectedItem.description}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white">
                  Sale Credit:{" "}
                  <strong
                    className={
                      selectedItem.credit === 0.5
                        ? "text-amber-300"
                        : "text-emerald-300"
                    }
                  >
                    {selectedItem.credit.toFixed(1)}
                  </strong>
                </span>
                <span className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-text-secondary">
                  {selectedItem.ruleType}
                </span>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-xs">
              <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                <span className="text-text-muted block">
                  Normalized Matching Name
                </span>
                <strong className="mt-1 block font-mono text-sm text-white">
                  {selectedItem.normalizedName}
                </strong>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                <span className="text-text-muted block">
                  Evaluation Precedence
                </span>
                <strong className="mt-1 block font-mono text-sm text-secondary">
                  Step #{selectedItem.precedence} of 4
                </strong>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                <span className="text-text-muted block">
                  Category & Effective Credit
                </span>
                <strong className="mt-1 block text-sm text-white">
                  {selectedItem.category} ({selectedItem.credit.toFixed(1)}x)
                </strong>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                <span className="text-text-muted flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Rule Last Updated
                </span>
                <strong className="mt-1 block font-mono text-sm text-white">
                  {selectedItem.updatedAt.slice(0, 10)}
                </strong>
              </div>
            </div>

            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted block mb-2">
                Verified Matching Aliases & Formatting Variations
              </span>
              <div className="flex flex-wrap gap-1.5">
                {selectedItem.aliases.map((alias) => (
                  <span
                    key={alias}
                    className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-xs text-white"
                  >
                    {alias}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </Section>

      {/* 4. Interactive Carrier Name Rule Verifier */}
      <Section
        title="Live Carrier Classification Verifier"
        description="Test any carrier or product name from Safe Quote to verify how JavaScript and PostgreSQL classify its sale credit."
      >
        <div className="grid gap-4 lg:grid-cols-2 items-center">
          <div>
            <label
              htmlFor="carrier-verifier-input"
              className="block text-xs font-semibold uppercase tracking-wider text-text-muted mb-1.5"
            >
              Test Carrier / Product String
            </label>
            <input
              id="carrier-verifier-input"
              data-testid="carrier-verifier-input"
              type="text"
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              placeholder="Enter a carrier name to verify..."
              className={inputClass}
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[
                "Corebridge Financial-SWIL",
                "Corebridge Financial - SWIL",
                "Corebridge Financial SWIL",
                "Corebridge Financial",
                "Gerber Life",
                "Americo Financial",
              ].map((sample) => (
                <button
                  key={sample}
                  type="button"
                  onClick={() => setTestInput(sample)}
                  className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-mono text-text-secondary hover:bg-white/10 hover:text-white"
                >
                  {sample}
                </button>
              ))}
            </div>
          </div>

          <div
            data-testid="carrier-verifier-result"
            className="rounded-2xl border border-secondary/30 bg-[#0B1224] p-4 space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-secondary flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" /> Classification Result
              </span>
              <span
                className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${
                  liveClassification.credit === 0.5
                    ? "border-amber-400/40 bg-amber-400/15 text-amber-300"
                    : "border-emerald-400/40 bg-emerald-400/15 text-emerald-300"
                }`}
              >
                {liveClassification.credit.toFixed(1)} Credited Sale (
                {liveClassification.category})
              </span>
            </div>
            <div className="text-xs text-text-secondary space-y-1">
              <div>
                Matched Rule:{" "}
                <strong className="text-white">
                  {liveClassification.matchedRuleName}
                </strong>{" "}
                ({liveClassification.ruleType} · Precedence Step #
                {liveClassification.precedence})
              </div>
              <div>
                Normalized Input:{" "}
                <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-white">
                  {liveClassification.normalizedName || "(empty)"}
                </code>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* 5. Historical Corebridge Financial-SWIL Sales Audit & Governance */}
      <Section
        title="Historical Corebridge Financial-SWIL Audit & Financial Protection"
        description="Read-only audit of historical Corebridge Financial-SWIL sales in PostgreSQL. Because Arena queries compute credited totals dynamically from carrier names via sqlCarrierWeight, all historical and future SWIL sales automatically receive 1.0 credit without mutating raw transaction counts or paid bonus awards."
      >
        <div className="grid gap-4 sm:grid-cols-3 text-xs">
          <div className="rounded-xl border border-white/10 bg-[#0B1224] p-4">
            <span className="text-text-muted flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5 text-secondary" /> Historical SWIL
              Validated Sales
            </span>
            <strong
              className="mt-1.5 block font-heading text-2xl font-black text-white tabular"
              data-testid="swil-audit-count"
            >
              {swilAudit ? swilAudit.totalSwilSales : 0}
            </strong>
            <span className="mt-1 block text-text-muted">
              {swilAudit?.databaseAvailable
                ? `Across ${swilAudit.affectedAgentsCount} agent(s) in PostgreSQL`
                : "Canonical SQL weighting active"}
            </span>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#0B1224] p-4">
            <span className="text-text-muted flex items-center gap-1.5">
              <FileCheck2 className="h-3.5 w-3.5 text-emerald-300" /> Effective
              Credited Value
            </span>
            <strong className="mt-1.5 block font-heading text-2xl font-black text-emerald-300 tabular">
              {swilAudit
                ? `${formatSalesCount(swilAudit.correctedCreditedTotal)} credits`
                : "1.0x per SWIL sale"}
            </strong>
            <span className="mt-1 block text-text-muted">
              {swilAudit && swilAudit.totalSwilSales > 0
                ? `+${formatSalesCount(swilAudit.totalCreditDelta)} credit increase vs legacy 0.5 rule`
                : "Evaluated before general 0.5 Corebridge rule"}
            </span>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#0B1224] p-4">
            <span className="text-text-muted flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-gold" /> Financial &
              Ledger Safety
            </span>
            <strong className="mt-1.5 block font-heading text-base font-bold text-white">
              Read-Only · Immutable History
            </strong>
            <span className="mt-1 block text-text-muted">
              Paid bonus awards, spin balances, and actual transaction counts
              are never overwritten.
            </span>
          </div>
        </div>

        {swilAudit && swilAudit.sales.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#080D1B]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-white/10 bg-white/[0.03] uppercase tracking-wider text-text-muted">
                <tr>
                  <th className="px-4 py-2.5">Case ID</th>
                  <th className="px-4 py-2.5">Agent</th>
                  <th className="px-4 py-2.5">Carrier</th>
                  <th className="px-4 py-2.5">Validated Date</th>
                  <th className="px-4 py-2.5 text-right">Legacy Credit</th>
                  <th className="px-4 py-2.5 text-right">Corrected Credit</th>
                  <th className="px-4 py-2.5 text-right">Difference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {swilAudit.sales.map((s) => (
                  <tr key={s.caseId}>
                    <td className="px-4 py-2.5 font-mono text-white">
                      {s.caseId}
                    </td>
                    <td className="px-4 py-2.5 text-white">
                      {s.agentName}{" "}
                      <span className="font-mono text-text-muted">
                        ({s.userCode})
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-emerald-300 font-semibold">
                      {s.carrier}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-text-secondary">
                      {s.validatedAt.slice(0, 10)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-text-muted">
                      0.5
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold text-emerald-300">
                      1.0
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-secondary">
                      +0.5
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, Gift, Disc3, RotateCcw, Upload, ExternalLink, Zap } from "lucide-react";
import { useArenaStore, pickData } from "@/store/arena-store";
import { useSettingsStore } from "@/store/settings-store";
import { computeSpinCredit } from "@/features/targets/eligibility";
import { leadCountsByAgent, closedRate } from "@/features/sales/leads";
import { arenaBus } from "@/lib/events/bus";
import { audioEngine } from "@/lib/audio/engine";
import { TIERS, TIER_ORDER } from "@/features/celebrations/tiers";
import { Section, Field, Toggle, Range, Choice, TextField, PrimaryButton, GhostButton, inputClass } from "@/components/admin/ui";
import { adminApi } from "@/components/admin/admin-api";
import { uid } from "@/lib/utils";
import type { CelebrationTier, SaleStatus } from "@/types";
import { TimeAgo } from "@/components/common/TimeAgo";

const STATUS_LABEL: Record<SaleStatus, string> = { approved: "Validated", pending: "Pending", rejected: "Rejected", duplicate: "Duplicate" };
const STATUS_STYLE: Record<SaleStatus, string> = {
  approved: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  pending: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  rejected: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  duplicate: "border-white/15 bg-white/5 text-text-secondary",
};

const MAX_LOGO_BYTES = 400 * 1024;

export default function LiveArenaControlsPage() {
  const agents = useArenaStore((s) => s.agents);
  const teams = useArenaStore((s) => s.teams);
  const sales = useArenaStore((s) => s.sales);
  const spins = useArenaStore((s) => s.spins);
  const bonus = useArenaStore((s) => s.bonusCredits);
  const rules = useArenaStore((s) => s.targetRules);
  const settings = useSettingsStore();
  const update = settings.update;

  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [bulk, setBulk] = useState(2);
  const [note, setNote] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const agent = agents.find((a) => a.id === agentId);
  const team = teams.find((t) => t.id === agent?.teamId);
  const credit = useMemo(
    () => (agent ? computeSpinCredit(pickData(useArenaStore.getState()), agent.id) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agent, sales, spins, bonus, rules],
  );

  const notify = (msg: string) => {
    setNote(msg);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), 3500);
  };

  const counts = useMemo(() => (agent ? leadCountsByAgent(sales).get(agent.id) : undefined), [agent, sales]);
  const agentLeads = useMemo(() => (agent ? sales.filter((x) => x.agentId === agent.id).slice(-8).reverse() : []), [agent, sales]);

  const record = (count: number, status: SaleStatus = "approved") => {
    if (!agent) return;
    audioEngine.unlock();
    const store = useArenaStore.getState();
    for (let i = 0; i < count; i++) {
      store.recordSale({ agentId: agent.id, status, source: "demo-simulator", celebrate: i === count - 1 });
    }
    notify(`${count} ${STATUS_LABEL[status].toLowerCase()} lead${count > 1 ? "s" : ""} recorded for ${agent.name}.`);
  };

  const triggerCelebration = (tier: CelebrationTier) => {
    const meta = TIERS[tier];
    arenaBus.emit("celebration:enqueue", {
      event: {
        id: uid("cel"),
        tier,
        headline: meta.label,
        subline: "Test celebration from the Admin Panel",
        agentId: agent?.id ?? null,
        agentName: agent?.name ?? null,
        teamName: team?.name ?? null,
        teamColor: team?.color ?? null,
        value: null,
        createdAt: new Date().toISOString(),
        preview: true,
      },
    });
    notify(`"${meta.label}" sent to the Live Arena display.`);
  };

  const onLogo = (file: File | undefined) => {
    setLogoError(null);
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) return setLogoError("Use a PNG, JPG, WebP or SVG image.");
    if (file.size > MAX_LOGO_BYTES) return setLogoError("Logo must be 400 KB or smaller (it is stored in this browser).");
    const reader = new FileReader();
    reader.onload = () => {
      update({ customLogo: String(reader.result) });
      notify("Logo updated.");
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-6">
      {note && (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-300">
          <CheckCircle2 className="h-4 w-4" /> {note}
        </div>
      )}

      <Section
        title="Live Arena display"
        description="Turn the public Live Arena on or off. When off, the screen shows an offline page, and celebrations, spin popups and demo sales stop."
        actions={
          <span
            data-testid="arena-status"
            className={
              settings.arenaEnabled
                ? "inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-bold tracking-wider text-emerald-300"
                : "inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-bold tracking-wider text-text-muted"
            }
          >
            <span className={settings.arenaEnabled ? "h-2 w-2 rounded-full bg-emerald-400" : "h-2 w-2 rounded-full bg-text-muted"} />
            {settings.arenaEnabled ? "ON AIR" : "OFF AIR"}
          </span>
        }
      >
        <Toggle
          label="Live Arena on"
          hint="Applies straight away to Live Arena tabs in this browser."
          checked={settings.arenaEnabled}
          onChange={(v) => {
            update({ arenaEnabled: v });
            notify(v ? "Live Arena is back on air." : "Live Arena switched off.");
          }}
        />
        <TextField
          label="Offline message"
          value={settings.arenaOfflineMessage}
          maxLength={80}
          onChange={(v) => update({ arenaOfflineMessage: v })}
        />
      </Section>

      <Section
        title="Sales simulator"
        description="Record demo sales for an agent. Keep the Live Arena open in another tab (same browser) to watch celebrations and the SPIN NOW popup."
        actions={
          <Link href="/" target="sales-arena-live" className="inline-flex items-center gap-1.5 text-sm font-semibold text-secondary hover:underline">
            Open Live Arena <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        }
      >
        <Field label="Agent" htmlFor="sim-agent">
          <select id="sim-agent" value={agentId} onChange={(e) => setAgentId(e.target.value)} className={inputClass} data-testid="sim-agent">
            {agents.map((a) => (
              <option key={a.id} value={a.id} className="bg-[#0D1426]">
                {a.name}
              </option>
            ))}
          </select>
        </Field>

        {credit && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {[
              { k: "Submitted leads", v: counts?.submitted ?? 0 },
              { k: "Validated", v: counts?.validated ?? 0 },
              { k: "Closed rate", v: `${Math.round(closedRate(counts ?? { submitted: 0, validated: 0 }))}%` },
              { k: "Sales per spin", v: credit.ruleEnabled ? credit.salesPerSpin : "Off" },
              { k: "Next spin in", v: credit.salesToNext ?? "—" },
              { k: "Spins available", v: credit.available },
            ].map((x) => (
              <div key={x.k} className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3">
                <div className="text-xs text-text-muted">{x.k}</div>
                <div className="mt-1 font-heading text-2xl font-bold text-white tabular" data-testid={`sim-${x.k.replace(/\s+/g, "-").toLowerCase()}`}>{x.v}</div>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <PrimaryButton onClick={() => record(1)} data-testid="sim-approve-one" title="Submits a lead that is validated straight away">
            <CheckCircle2 className="h-4 w-4" /> Validate 1 sale
          </PrimaryButton>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={20}
              value={bulk}
              onChange={(e) => setBulk(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              aria-label="Number of sales"
              className={`${inputClass} w-20`}
            />
            <GhostButton onClick={() => record(bulk)}>Validate {bulk} sales</GhostButton>
          </div>
          <GhostButton onClick={() => record(1, "pending")} data-testid="sim-submit-lead" title="Submitted, waiting for validation — does not count for spins">
            <Clock className="h-4 w-4" /> Submit lead (pending)
          </GhostButton>
          <GhostButton onClick={() => record(1, "rejected")} data-testid="sim-reject-lead">Reject lead</GhostButton>
          <GhostButton onClick={() => record(1, "duplicate")} data-testid="sim-duplicate-lead">Duplicate lead</GhostButton>
          <GhostButton
            onClick={async () => {
              if (!agent) return;
              useArenaStore.getState().addBonusCredits(agent.id, 1);
              const idemKey = `arena-ctrl-bonus-${agent.id}-${Date.now()}`;
              adminApi("/api/admin/spins/allocate", {
                method: "POST",
                body: {
                  userCode: agent.id,
                  quantity: 1,
                  reason: "Live Arena Controls bonus spin",
                  idempotencyKey: idemKey,
                },
              }).catch(() => {});
              notify(`1 bonus spin granted to ${agent.name} (persisted to PostgreSQL).`);
            }}
          >
            <Gift className="h-4 w-4" /> Grant bonus spin
          </GhostButton>
          <GhostButton
            disabled={!credit || credit.available <= 0}
            title={credit && credit.available > 0 ? "Opens the spin stage on the Live Arena display" : "This agent has no spins available"}
            onClick={() => {
              if (!agent) return;
              arenaBus.emit("spin:launch", { agentId: agent.id });
              notify(`Spin stage opened for ${agent.name} on the Live Arena display.`);
            }}
          >
            <Disc3 className="h-4 w-4" /> Launch spin on Live Arena
          </GhostButton>
        </div>
        <p className="text-xs text-text-muted">Only validated sales earn spins. Pending, rejected and duplicate leads count as submitted leads only.</p>

        {agentLeads.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-white">Today&apos;s latest leads for {agent?.name}</h3>
            <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.07]" data-testid="sim-leads">
              {agentLeads.map((lead) => (
                <li key={lead.id} data-status={lead.status} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-white">{lead.product}</span>
                    <span className="ml-2 text-xs text-text-muted"><TimeAgo iso={lead.createdAt} /></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[lead.status]}`}>{STATUS_LABEL[lead.status]}</span>
                    <select
                      aria-label="Change lead status"
                      value={lead.status}
                      onChange={(e) => {
                        useArenaStore.getState().setLeadStatus(lead.id, e.target.value as SaleStatus);
                        notify(`Lead marked ${STATUS_LABEL[e.target.value as SaleStatus].toLowerCase()}.`);
                      }}
                      className="rounded-lg border border-white/10 bg-[#070B16] px-2 py-1 text-xs text-white"
                    >
                      {(Object.keys(STATUS_LABEL) as SaleStatus[]).map((st) => (
                        <option key={st} value={st}>{STATUS_LABEL[st]}</option>
                      ))}
                    </select>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="Automatic demo sales" description="Submits random leads on the Live Arena display (a mix of validated, pending, rejected and duplicate) so the floor feels live during demos.">
        <Toggle label="Auto-simulate sales" checked={settings.autoSimulate} onChange={(v) => update({ autoSimulate: v })} />
        <Range
          label="Average interval"
          value={settings.autoSimulateEverySec}
          min={3}
          max={60}
          onChange={(v) => update({ autoSimulateEverySec: v })}
          format={(v) => `${v}s`}
        />
      </Section>

      <Section title="Live Arena sections" description="Choose what the TV display shows.">
        <Toggle label="KPI cards" hint="Approved sales, target, completion, spins" checked={settings.showKpis} onChange={(v) => update({ showKpis: v })} />
        <Toggle label="Latest sale & MVP" checked={settings.showHero} onChange={(v) => update({ showHero: v })} />
        <Toggle label="Sales & achievements feeds" checked={settings.showActivity} onChange={(v) => update({ showActivity: v })} />
        <Toggle
          label="Demo spin button"
          hint="Small button on the Live Arena that runs the full spin journey for presentations."
          checked={settings.showDemoSpinButton}
          onChange={(v) => update({ showDemoSpinButton: v })}
        />
        <Toggle label="Leaderboard panel" hint="More options in Leaderboard Settings" checked={settings.leaderboardVisible} onChange={(v) => update({ leaderboardVisible: v })} />
      </Section>

      <Section title="Brand" description="Shown in the Live Arena header, the spin stage and the Admin Panel.">
        <TextField label="Brand name" value={settings.brandName} maxLength={28} onChange={(v) => update({ brandName: v })} />
        <TextField label="Tagline" value={settings.brandTagline} maxLength={40} onChange={(v) => update({ brandTagline: v })} />
        <Field label="Logo" hint="PNG, JPG, WebP or SVG up to 400 KB. Square images work best.">
          <div className="flex flex-wrap items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={settings.customLogo || "/brand/logo-mark.webp"} alt="Current logo" className="h-14 w-14 rounded-xl border border-white/10 bg-white/5 object-contain p-1" />
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-text-secondary hover:text-white">
              <Upload className="h-4 w-4" /> Upload logo
              <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" onChange={(e) => onLogo(e.target.files?.[0])} />
            </label>
            {settings.customLogo && <GhostButton onClick={() => update({ customLogo: null })}>Use default logo</GhostButton>}
          </div>
          {logoError && <p className="mt-2 text-sm text-rose-400">{logoError}</p>}
        </Field>
      </Section>

      <Section title="Visual effects">
        <Choice
          label="Background effects"
          value={settings.backgroundEffects}
          options={[{ value: "full", label: "Full" }, { value: "subtle", label: "Subtle" }, { value: "off", label: "Off" }]}
          onChange={(v) => update({ backgroundEffects: v })}
        />
        <Choice
          label="Celebration intensity"
          value={settings.intensity}
          options={[{ value: "calm", label: "Calm" }, { value: "standard", label: "Standard" }, { value: "epic", label: "Epic" }]}
          onChange={(v) => update({ intensity: v })}
        />
        <Toggle label="Confetti & particles" checked={settings.particles} onChange={(v) => update({ particles: v })} />
        <Choice
          label="Motion"
          hint="Reduced turns off ambient animation and shortens spins."
          value={settings.motion}
          options={[{ value: "system", label: "Follow device" }, { value: "full", label: "Full" }, { value: "reduced", label: "Reduced" }]}
          onChange={(v) => update({ motion: v })}
        />
      </Section>

      <Section title="Test celebrations" description="Sends a sample celebration to the Live Arena display.">
        <div className="flex flex-wrap gap-2">
          {TIER_ORDER.map((t) => (
            <GhostButton key={t} onClick={() => triggerCelebration(t)}>
              <Zap className="h-4 w-4" style={{ color: TIERS[t].color }} /> {TIERS[t].label}
            </GhostButton>
          ))}
        </div>
      </Section>

      <Section title="Demo data">
        <Field label="Reset demo data" hint="Restores the morning seed: sales, spins and activity. Settings are kept.">
          <GhostButton
            className="border-rose-500/30 text-rose-300 hover:bg-rose-500/10"
            onClick={() => {
              if (confirm("Reset all demo sales, spins and activity?")) {
                useArenaStore.getState().resetDemo();
                notify("Demo data reset.");
              }
            }}
          >
            <RotateCcw className="h-4 w-4" /> Reset demo data
          </GhostButton>
        </Field>
      </Section>
    </div>
  );
}

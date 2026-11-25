"use client";

import { useEffect, useState, useId } from "react";
import { adminApi } from "../admin-api";
import { Section, Field, Toggle, PrimaryButton, GhostButton, inputClass } from "../ui";
import { CelebrationOverlay } from "@/frontend/components/celebrations/CelebrationOverlay";
import { TeamSaleCelebrationView, previewItem, useMotionLevel } from "@/frontend/components/arena/teams/TeamSaleCelebration";
import { audioEngine } from "@/frontend/audio/engine";
import { playTeamStingerWithCompletion } from "@/frontend/audio/team-stingers";
import { announceSaleVoice, cancelVoiceAnnouncement } from "@/frontend/audio/voice-announcer";
import { saleCelebrationDurationMs } from "@/frontend/features/celebrations/tiers";
import { useSettingsStore } from "@/frontend/stores/settings-store";
import { themeFor, type SaleTeamInfo } from "@/shared/teams/celebration";
import type { CelebrationEvent } from "@/shared/types";
import { 
  Sparkles, 
  Upload, 
  Trash2, 
  Play, 
  Square, 
  CheckCircle2, 
  AlertCircle, 
  Search, 
  Volume2, 
  VolumeX, 
  Tv, 
  Layers, 
  Users 
} from "lucide-react";

export type AgentItem = {
  id: string;
  name: string;
  user_code: string;
  asset_id: string | null;
  team: SaleTeamInfo | null;
};

export type AssetItem = {
  id: string;
  filename: string;
  mime: string;
  width: number;
  height: number;
};

export interface ImportSummary {
  totalAssetsFound: number;
  imagesImported: number;
  assignmentsCompleted: number;
  existingPreserved: number;
  unmatchedImages: number;
  ambiguousMatches: number;
  agentsWithoutEmojis: number;
}

export function AgentEmojiSettings() {
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(true);

  // Preview state
  const [previewMode, setPreviewMode] = useState<"daily" | "weekly" | "monthly" | "teams">("daily");
  const [teamOverride, setTeamOverride] = useState<"" | "lion" | "panther" | "crest">("");
  const [previewSound, setPreviewSound] = useState(false);
  const [activePreview, setActivePreview] = useState<CelebrationEvent | null>(null);

  // File upload state
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);

  const duration = useSettingsStore((s) => s.celebrationDuration);
  const motionLevel = useMotionLevel();
  const searchId = useId();
  const selectId = useId();

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  async function loadData() {
    const res = await adminApi<{
      agents: AgentItem[];
      assets: AssetItem[];
      enabled: boolean;
    }>("/api/admin/agent-emojis");
    if (res.ok) {
      setAgents(res.data.agents);
      setAssets(res.data.assets);
      setEnabled(res.data.enabled);
    } else {
      setMessage(res.error);
    }
  }

  useEffect(() => {
    let active = true;
    adminApi<{
      agents: AgentItem[];
      assets: AssetItem[];
      enabled: boolean;
    }>("/api/admin/agent-emojis").then((res) => {
      if (!active) return;
      if (res.ok) {
        setAgents(res.data.agents);
        setAssets(res.data.assets);
        setEnabled(res.data.enabled);
      } else {
        setMessage(res.error);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
    };
  }, [fileUrl]);

  // Auto-dismiss preview after ~8s standard sale celebration duration
  useEffect(() => {
    if (!activePreview) return;
    const ms = saleCelebrationDurationMs(duration);
    const t = setTimeout(() => setActivePreview(null), ms);
    return () => {
      clearTimeout(t);
      cancelVoiceAnnouncement(`preview_${activePreview.id}`);
    };
  }, [activePreview, duration]);

  async function performAction(body: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    setImportSummary(null);
    try {
      const res = await adminApi<{
        summary?: ImportSummary;
        report?: unknown;
      }>("/api/admin/agent-emojis", { method: "POST", body });

      if (res.ok) {
        if (res.data.summary) {
          setImportSummary(res.data.summary);
          setMessage(`Bulk import completed: ${res.data.summary.assignmentsCompleted} new assignments made, ${res.data.summary.existingPreserved} existing preserved.`);
        } else {
          setMessage("Saved successfully.");
        }
        await loadData();
      } else {
        setMessage(res.error);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload() {
    if (!file || !selectedAgent) return;
    if (file.size > 4000000) {
      setMessage("Maximum upload size is 4 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      void performAction({
        action: "upload",
        agentId: selectedAgent.id,
        filename: file.name,
        mime: file.type,
        base64: String(reader.result).split(",")[1],
      }).then(() => {
        setFile(null);
        setFileUrl(null);
      });
    };
    reader.readAsDataURL(file);
  }

  function startPreview() {
    if (!selectedAgent) return;

    let headline = "NEW SALE APPROVED!";
    let subline = `${selectedAgent.name} · Just made a sale!`;

    if (previewMode === "weekly") {
      headline = "ANOTHER SALE ON THE BOARD!";
      subline = `${selectedAgent.name} · Just secured a validated sale!`;
    } else if (previewMode === "monthly") {
      headline = "NEW SALE APPROVED!";
      subline = `${selectedAgent.name} · Another sale secured!`;
    } else if (previewMode === "teams") {
      const teamName = teamOverride === "lion" ? "TEAM SIGMA" : teamOverride === "panther" ? "TEAM PANTHERS" : (selectedAgent.team?.name?.toUpperCase() ?? "TEAM");
      headline = `${teamName} GOT A SALE!`;
      subline = "Made it happen!";
    }

    const event: CelebrationEvent = {
      id: "local-preview-" + Date.now(),
      tier: "sale",
      headline,
      subline,
      agentId: selectedAgent.id,
      agentName: selectedAgent.name,
      teamName: selectedAgent.team?.name ?? null,
      teamColor: selectedAgent.team?.color ?? null,
      value: 1250,
      createdAt: new Date().toISOString(),
      preview: true,
    };

    setActivePreview(event);

    if (previewSound) {
      const ownerToken = `preview_${event.id}`;
      audioEngine.unlock();
      const s = useSettingsStore.getState();
      const soundThenVoice =
        previewMode === "teams"
          ? playTeamStingerWithCompletion(teamOverride || (selectedAgent.team ? themeFor(selectedAgent.team) : "crest"), {
              soundEnabled: s.soundEnabled,
              saleCategory: s.soundCategories?.sale !== false,
              teamSaleSound: s.teamSaleSound !== false,
            })
          : audioEngine.playWithCompletion("sale");

      void soundThenVoice
        .catch(() => "skipped" as const)
        .then(() => {
          if (s.voiceAnnouncerEnabled === false) return;
          return announceSaleVoice({
            eventId: event.id,
            agentName: selectedAgent.name,
            ownerToken,
            preview: true,
          });
        })
        .catch(() => undefined);
    }
  }

  const teamPreviewItem = previewItem(teamOverride || "crest");
  if (!teamOverride && selectedAgent?.team) {
    teamPreviewItem.team = selectedAgent.team;
  }
  if (activePreview) {
    teamPreviewItem.event = activePreview;
  }

  const filteredAgents = agents.filter((a) =>
    (a.name + " " + a.user_code).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Section
      title="Agent Emoji Celebrations"
      description="Manage original agent emoji artwork and test mode-specific celebrations. Previews run in isolation inside this browser and never broadcast to office TVs or alter sales records."
    >
      {/* 1. Global Feature Toggle & Quick Import */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <div>
          <Toggle
            label="Enable Agent Emoji Celebrations"
            hint="Display agent emoji artwork during validated sales popups on Daily, Weekly, Monthly, and Teams Arena."
            checked={enabled}
            onChange={(v) => void performAction({ action: "enabled", enabled: v })}
          />
        </div>
        <PrimaryButton
          disabled={busy}
          onClick={() => void performAction({ action: "import" })}
          className="bg-secondary/20 hover:bg-secondary/30 text-secondary border border-secondary/40 shadow-none"
        >
          <Sparkles className="w-4 h-4 mr-2" />
          Import 19 Supplied Originals
        </PrimaryButton>
      </div>

      {/* Import summary card */}
      {importSummary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-xl border border-primary/30 bg-primary/10 text-xs">
          <div><span className="text-text-muted">Total Assets:</span> <strong className="text-white text-sm block">{importSummary.totalAssetsFound}</strong></div>
          <div><span className="text-text-muted">New Assignments:</span> <strong className="text-success text-sm block">{importSummary.assignmentsCompleted}</strong></div>
          <div><span className="text-text-muted">Existing Preserved:</span> <strong className="text-white text-sm block">{importSummary.existingPreserved}</strong></div>
          <div><span className="text-text-muted">Unassigned Agents:</span> <strong className="text-warning text-sm block">{importSummary.agentsWithoutEmojis}</strong></div>
        </div>
      )}

      {/* Status message */}
      {message && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-white/10 bg-surface text-sm text-white">
          <AlertCircle className="w-4 h-4 text-secondary shrink-0" />
          <span className="flex-1">{message}</span>
        </div>
      )}

      {/* 2. Agent Selector & Search */}
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={searchId} className="block text-xs font-medium text-text-muted mb-1.5 flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5" /> Search Agent Roster
            </label>
            <input
              id={searchId}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by agent name or user code..."
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor={selectId} className="block text-xs font-medium text-text-muted mb-1.5 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" /> Select Agent ({filteredAgents.length} agents)
            </label>
            <select
              id={selectId}
              aria-label="Agent"
              value={selectedAgentId}
              onChange={(e) => {
                setSelectedAgentId(e.target.value);
                setActivePreview(null);
                setFile(null);
                setFileUrl(null);
              }}
              className={inputClass}
            >
              <option value="">-- Choose an agent --</option>
              {filteredAgents.map((a) => (
                <option key={a.id} value={a.id} className="bg-[#0D1426]">
                  {a.name} ({a.user_code}) {a.asset_id ? "✓ [Emoji Assigned]" : "— [No Emoji]"}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 3. Selected Agent Detail & Assignment Controls */}
        {selectedAgent && (
          <div className="rounded-xl border border-white/10 bg-[#0B1224] p-5 space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  {selectedAgent.name}
                  {selectedAgent.asset_id ? (
                    <span className="text-xs font-normal text-success bg-success/20 border border-success/40 px-2 py-0.5 rounded-full">
                      Emoji Active
                    </span>
                  ) : (
                    <span className="text-xs font-normal text-warning bg-warning/20 border border-warning/40 px-2 py-0.5 rounded-full">
                      No Emoji Assigned (Uses Default Icon)
                    </span>
                  )}
                </h3>
                <p className="text-xs text-text-muted mt-1">
                  Code: <span className="font-mono text-white">{selectedAgent.user_code}</span> · Internal ID: <span className="font-mono text-white">{selectedAgent.id}</span>
                  {selectedAgent.team && <> · Team: <span className="text-secondary font-semibold">{selectedAgent.team.name}</span></>}
                </p>
              </div>

              {selectedAgent.asset_id && (
                <GhostButton
                  disabled={busy}
                  onClick={() => void performAction({ action: "remove", agentId: selectedAgent.id })}
                  className="text-error border-error/30 hover:bg-error/10 hover:text-error text-xs"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  Remove Assignment
                </GhostButton>
              )}
            </div>

            {/* Current vs Upload Comparison */}
            <div className="grid gap-6 sm:grid-cols-2 items-center">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-text-muted block mb-2">
                  Current Assigned Emoji
                </span>
                {selectedAgent.asset_id ? (
                  <div className="h-44 w-full flex items-center justify-center rounded-xl border border-white/10 bg-black/40 p-3">
                    <img
                      src={"/api/arena/agent-emojis/" + selectedAgent.asset_id}
                      alt={selectedAgent.name}
                      className="h-full max-w-full object-contain drop-shadow-[0_8px_16px_rgba(0,0,0,0.6)]"
                    />
                  </div>
                ) : (
                  <div className="h-44 w-full flex flex-col items-center justify-center rounded-xl border border-dashed border-white/20 bg-white/[0.01] text-text-muted text-xs p-4 text-center">
                    <Users className="w-8 h-8 mb-2 opacity-40" />
                    <span>No emoji currently assigned to {selectedAgent.name}.</span>
                    <span className="text-[11px] mt-1">Upload a new image below or pick an asset from the library.</span>
                  </div>
                )}
              </div>

              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-text-muted block mb-2">
                  Upload or Replace Emoji
                </span>
                <div className="h-44 w-full flex flex-col items-center justify-center rounded-xl border border-white/10 bg-black/40 p-4 text-center">
                  {fileUrl ? (
                    <div className="relative h-full flex flex-col items-center justify-center">
                      <img src={fileUrl} alt="Selected upload" className="h-28 object-contain mb-2" />
                      <span className="text-[11px] text-text-muted truncate max-w-[200px]">{file?.name}</span>
                    </div>
                  ) : (
                    <>
                      <Upload className="w-8 h-8 text-secondary mb-2 opacity-80" />
                      <label className="cursor-pointer text-xs font-semibold text-secondary hover:underline">
                        Choose PNG, JPEG, or WebP
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0] ?? null;
                            setFile(f);
                            setFileUrl(f ? URL.createObjectURL(f) : null);
                          }}
                        />
                      </label>
                      <p className="text-[11px] text-text-muted mt-1">Max 4 MB. Transparent backgrounds preserved.</p>
                    </>
                  )}
                </div>
                {file && (
                  <div className="mt-3 flex gap-2">
                    <PrimaryButton disabled={busy} onClick={() => void handleUpload()} className="flex-1 text-xs py-2">
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                      Save & Assign Image
                    </PrimaryButton>
                    <GhostButton
                      onClick={() => {
                        setFile(null);
                        setFileUrl(null);
                      }}
                      className="text-xs py-2"
                    >
                      Cancel
                    </GhostButton>
                  </div>
                )}
              </div>
            </div>

            {/* 4. Mandatory Celebration Preview (Part E) */}
            <div className="rounded-xl border border-purple-500/20 bg-purple-950/10 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Tv className="w-4 h-4 text-secondary" />
                  <h4 className="font-heading text-sm font-bold text-white uppercase tracking-wider">
                    Broadcast Arena Celebration Preview
                  </h4>
                </div>
                <div className="text-xs text-text-muted">
                  Simulated local preview · Zero database mutations · Never broadcasts to TVs
                </div>
              </div>

              {/* Preview Controls Bar */}
              <div className="flex flex-wrap items-center gap-3">
                {/* Arena Mode Selector */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-text-muted">Arena:</span>
                  <select
                    aria-label="Arena preview mode"
                    value={previewMode}
                    onChange={(e) => {
                      setPreviewMode(e.target.value as typeof previewMode);
                      setActivePreview(null);
                    }}
                    className="rounded-lg border border-white/20 bg-[#121A30] px-3 py-1.5 text-xs text-white"
                  >
                    <option value="daily">Daily Arena</option>
                    <option value="weekly">Weekly Arena</option>
                    <option value="monthly">Monthly Arena</option>
                    <option value="teams">Teams Arena</option>
                  </select>
                </div>

                {/* Team Override (Teams Arena only) */}
                {previewMode === "teams" && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-text-muted">Team:</span>
                    <select
                      value={teamOverride}
                      onChange={(e) => {
                        setTeamOverride(e.target.value as typeof teamOverride);
                        setActivePreview(null);
                      }}
                      className="rounded-lg border border-white/20 bg-[#121A30] px-3 py-1.5 text-xs text-white"
                    >
                      <option value="">Actual Team ({selectedAgent.team?.name ?? "Fallback Crest"})</option>
                      <option value="lion">Team Sigma (Lion Theme)</option>
                      <option value="panther">Team Panthers (Panther Theme)</option>
                      <option value="crest">Generic Team (Crest Theme)</option>
                    </select>
                  </div>
                )}

                {/* Sound Toggle */}
                <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={previewSound}
                    onChange={(e) => setPreviewSound(e.target.checked)}
                    className="rounded border-white/20 accent-[#7568FF]"
                  />
                  {previewSound ? <Volume2 className="w-3.5 h-3.5 text-secondary" /> : <VolumeX className="w-3.5 h-3.5 text-text-muted" />}
                  Preview with sound
                </label>

                {/* Action Buttons */}
                <div className="ml-auto flex items-center gap-2">
                  <PrimaryButton onClick={startPreview} className="text-xs py-1.5 px-3">
                    <Play className="w-3.5 h-3.5 mr-1.5" />
                    Preview Sale Celebration
                  </PrimaryButton>

                  {activePreview && (
                    <GhostButton onClick={() => setActivePreview(null)} className="text-xs py-1.5 px-3">
                      <Square className="w-3.5 h-3.5 mr-1.5" />
                      Stop Preview
                    </GhostButton>
                  )}
                </div>
              </div>

              {/* 16:9 TV Monitor Preview Frame */}
              <div
                data-preview-stage="true"
                className="relative aspect-video w-full overflow-hidden rounded-xl border border-purple-500/30 bg-[#070B16] shadow-2xl [container-type:size]"
                style={{ transform: "translateZ(0)" }}
                aria-label="Local celebration preview"
              >
                {/* Subtle TV glass glow and branding tag */}
                <div className="absolute top-3 left-4 z-[60] flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-text-muted pointer-events-none">
                  <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
                  <span>PREVIEW STAGE · {previewMode.toUpperCase()} ARENA</span>
                </div>

                {activePreview ? (
                  previewMode === "teams" ? (
                    <TeamSaleCelebrationView
                      key={activePreview.id}
                      item={teamPreviewItem}
                      name={teamPreviewItem.team.name}
                      logoUrl={teamPreviewItem.team.logoUrl}
                      color={teamPreviewItem.team.color}
                      accent={teamPreviewItem.team.accentSecondary}
                      total={{ period: "day", value: 18 }}
                      motionLevel={motionLevel}
                    />
                  ) : (
                    <CelebrationOverlay key={activePreview.id} previewEvent={activePreview} />
                  )
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-text-muted text-xs p-6 text-center">
                    <Tv className="w-12 h-12 mb-3 text-secondary/30" />
                    <p className="font-heading font-semibold text-white/70 text-sm">Preview Ready</p>
                    <p className="max-w-md mt-1 text-[11px] text-text-muted">
                      Click <strong className="text-white">Preview Sale Celebration</strong> above to test the full entrance, layout, emoji pop, and announcement for {selectedAgent.name}.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 5. Agent Emoji Library (All Uploaded Assets) */}
      <div className="space-y-3 pt-4 border-t border-white/10">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Layers className="w-4 h-4 text-secondary" />
            Asset Library ({assets.length} stored {assets.length === 1 ? "image" : "images"})
          </h3>
          <span className="text-xs text-text-muted">
            Stored persistently in PostgreSQL BYTEA · Immutable URLs
          </span>
        </div>

        {assets.length === 0 ? (
          <div className="p-8 rounded-xl border border-dashed border-white/20 text-center text-text-muted text-xs">
            No emoji assets currently stored in the database. Click <strong>Import 19 Supplied Originals</strong> above to initialize the library.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {assets.map((a) => {
              const assignedAgents = agents.filter((ag) => ag.asset_id === a.id);
              return (
                <div
                  key={a.id}
                  className="rounded-xl border border-white/10 bg-[#0B1122]/70 p-2.5 flex flex-col justify-between hover:border-secondary/40 transition-colors"
                >
                  <div className="h-28 w-full flex items-center justify-center bg-black/40 rounded-lg p-1.5 mb-2">
                    <img
                      loading="lazy"
                      src={"/api/arena/agent-emojis/" + a.id}
                      alt={a.filename}
                      className="h-full max-w-full object-contain"
                    />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-white truncate" title={a.filename}>
                      {a.filename.replace(/-Photoroom\.png$/i, "")}
                    </p>
                    <p className="text-[10px] text-text-muted font-mono">
                      {a.width}×{a.height} · {a.mime.replace("image/", "")}
                    </p>
                    <p className="text-[10px] text-secondary mt-1 truncate">
                      {assignedAgents.length > 0
                        ? `Assigned: ${assignedAgents.map((ag) => ag.name).join(", ")}`
                        : "Unassigned"}
                    </p>
                  </div>
                  {selectedAgent && (
                    <button
                      disabled={busy || selectedAgent.asset_id === a.id}
                      onClick={() => void performAction({ action: "assign", agentId: selectedAgent.id, assetId: a.id })}
                      className="mt-2 text-[10px] py-1 px-2 rounded bg-white/[0.05] hover:bg-primary hover:text-white text-text-secondary border border-white/10 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                    >
                      {selectedAgent.asset_id === a.id ? "Assigned" : "Assign to Agent"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Section>
  );
}

"use client";

import { useState } from "react";
import { useArenaStore } from "@/store/arena-store";
import { 
  Webhook, 
  CheckCircle2, 
  Terminal, 
  Radio, 
  Sparkles, 
  Send, 
  Clock 
} from "lucide-react";
import { formatDateTime } from "@/lib/utils";

export default function AdminIntegrationsPage() {
  const store = useArenaStore();
  const [testPayload, setTestPayload] = useState(
    JSON.stringify(
      {
        event: "dialer.sale.approved",
        agentId: store.agents[0]?.id || "agt_0_0",
        product: "Fiber Broadband Max 1Gbps",
        value: 129.99,
        timestamp: new Date().toISOString(),
        dialerRef: "DL-9082-TX",
      },
      null,
      2
    )
  );
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  const handleSimulateWebhook = () => {
    try {
      const parsed = JSON.parse(testPayload);
      store.recordSale({
        agentId: parsed.agentId,
        status: "approved",
        source: "integration-preview",
        celebrate: true,
        value: parsed.value,
      });
      store.markSynced();
      setSyncStatus(`Webhook successfully processed: Transaction recorded for agent ${parsed.agentId}`);
      setTimeout(() => setSyncStatus(null), 5000);
    } catch {
      setSyncStatus("Invalid JSON payload format.");
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="font-heading text-xl font-bold text-white">
          Dialer Webhook & Integration Architecture
        </h2>
        <p className="text-xs text-muted">
          Specifications for connecting future telephony and CRM systems without UI redesign
        </p>
      </div>

      {/* Connection Status Card */}
      <div className="rounded-3xl border border-secondary/30 bg-[#0D1426]/90 p-6 backdrop-blur-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary/15 text-secondary border border-secondary/30">
            <Radio className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-heading font-bold text-white text-base">
                Adapter Mode: Simulated Event Bus
              </h3>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-mono text-[10px] font-bold">
                MOCK DEMO READY
              </span>
            </div>
            <p className="text-xs text-muted mt-0.5">
              BroadcastChannel bus active across multi-monitor tabs
            </p>
          </div>
        </div>

        <div className="text-right text-xs font-mono text-muted">
          <span>Last Ingest:</span>{" "}
          <span className="text-white">
            {store.lastSyncAt ? formatDateTime(store.lastSyncAt) : "Floor Initialized"}
          </span>
        </div>
      </div>

      {/* Webhook Payload Simulator */}
      <div className="rounded-3xl border border-white/10 bg-[#0D1426]/90 p-6 backdrop-blur-md space-y-4">
        <div className="flex items-center justify-between border-b border-white/5 pb-3">
          <div className="flex items-center gap-2 font-heading font-bold text-sm text-white">
            <Terminal className="w-4 h-4 text-secondary" />
            <span>Incoming Webhook Simulator</span>
          </div>
          <span className="text-[10px] font-mono text-muted">POST /api/v1/events/sales</span>
        </div>

        {syncStatus && (
          <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
            {syncStatus}
          </div>
        )}

        <div>
          <label className="text-xs font-semibold text-muted block mb-1">
            Raw Ingest JSON Payload:
          </label>
          <textarea
            rows={8}
            value={testPayload}
            onChange={(e) => setTestPayload(e.target.value)}
            className="w-full p-3 rounded-2xl bg-[#070B16] border border-white/10 font-mono text-xs text-secondary focus:outline-none focus:border-secondary/50"
          />
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleSimulateWebhook}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-primary to-secondary font-heading text-xs font-bold text-white shadow-lg shadow-primary/25 hover:brightness-110 active:scale-95 transition-all"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Transmit Webhook Payload</span>
          </button>
        </div>
      </div>

      {/* Production Adapter Documentation */}
      <div className="rounded-3xl border border-white/10 bg-surface/40 p-6 backdrop-blur-md">
        <h4 className="font-heading font-bold text-white text-sm mb-2">
          Production Architecture Contract
        </h4>
        <p className="text-xs text-muted leading-relaxed">
          The application frontend layer consumes <code className="text-secondary font-mono">ArenaDataProvider</code> and receives typed events (<code className="text-secondary font-mono">sale:recorded</code>, <code className="text-secondary font-mono">spin:unlocked</code>) via <code className="text-secondary font-mono">arenaBus</code>. To migrate from Demo to Production, simply replace <code className="text-secondary font-mono">lib/mock-api</code> with real WebSocket or Server-Sent Events (SSE) connections.
        </p>
      </div>
    </div>
  );
}

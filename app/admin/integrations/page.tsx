"use client";

import { useEffect, useState } from "react";
import { useArenaStore } from "@/store/arena-store";
import { 
  Webhook, 
  CheckCircle2, 
  Terminal, 
  Radio, 
  Send, 
  Clock, 
  Database,
  Activity,
  RefreshCw,
  AlertTriangle
} from "lucide-react";
import { formatDateTime } from "@/lib/utils";

interface HealthData {
  status: string;
  environment: string;
  mode: string;
  upstreamApi?: {
    ok: boolean;
    configured: boolean;
    baseUrl: string;
    latencyMs: number | null;
    error?: string;
  };
  database?: {
    connected: boolean;
    error?: string;
  };
  sseConsumer?: {
    status: string;
    reconnectAttempts: number;
    lastConnectedAt: string | null;
    eventsProcessed: number;
    lastError: string | null;
  };
}

export default function AdminIntegrationsPage() {
  const store = useArenaStore();
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<string | null>(null);

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

  const fetchHealth = async () => {
    setLoadingHealth(true);
    try {
      const res = await fetch("/api/admin/health");
      if (res.ok) {
        const data = await res.json();
        setHealth(data);
      }
    } catch {
      // offline / local
    } finally {
      setLoadingHealth(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  const handleReconcile = async () => {
    setReconciling(true);
    setReconcileResult(null);
    try {
      const res = await fetch("/api/admin/reconcile", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setReconcileResult(`Reconciliation complete: checked ${data.result.checkedCount} sales, processed ${data.result.newSalesProcessed} new sales.`);
        fetchHealth();
      } else {
        setReconcileResult(`Reconciliation error: ${data.error || "Failed"}`);
      }
    } catch (err) {
      setReconcileResult(`Reconciliation failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setReconciling(false);
    }
  };

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

  const isConfigured = health?.upstreamApi?.configured ?? false;
  const isUpstreamOk = health?.upstreamApi?.ok ?? false;
  const isDbOk = health?.database?.connected ?? false;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-bold text-white">
            Safe Quote API & Integration Controls
          </h2>
          <p className="text-xs text-muted">
            Live connection monitoring, database state, event streaming and data reconciliation
          </p>
        </div>
        <button
          onClick={fetchHealth}
          disabled={loadingHealth}
          className="flex items-center gap-2 self-start sm:self-auto px-3.5 py-1.5 rounded-xl border border-white/10 bg-[#0D1426] text-xs font-semibold text-white hover:bg-white/5 active:scale-95 transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingHealth ? "animate-spin text-secondary" : ""}`} />
          <span>Refresh Health</span>
        </button>
      </div>

      {/* Primary Integration Health Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Upstream Safe Quote API */}
        <div className={`rounded-2xl border p-4 backdrop-blur-md ${isUpstreamOk ? "border-emerald-500/30 bg-[#0D1426]/90 glow-success" : isConfigured ? "border-amber-500/30 bg-[#0D1426]/90" : "border-white/10 bg-[#0D1426]/90"}`}>
          <div className="flex items-center justify-between text-muted text-xs font-semibold mb-1">
            <span>SAFE QUOTE API</span>
            <Radio className={`w-4 h-4 ${isUpstreamOk ? "text-emerald-400 animate-pulse" : "text-muted"}`} />
          </div>
          <div className="font-heading text-lg font-bold text-white">
            {isUpstreamOk ? "CONNECTED" : isConfigured ? "DEGRADED" : "UNCONFIGURED"}
          </div>
          <div className="text-[11px] font-mono text-muted mt-1 truncate">
            {health?.upstreamApi?.latencyMs !== null && health?.upstreamApi?.latencyMs !== undefined ? `${health.upstreamApi.latencyMs}ms latency` : "Token required in env"}
          </div>
        </div>

        {/* PostgreSQL Database */}
        <div className={`rounded-2xl border p-4 backdrop-blur-md ${isDbOk ? "border-emerald-500/30 bg-[#0D1426]/90" : "border-amber-500/30 bg-[#0D1426]/90"}`}>
          <div className="flex items-center justify-between text-muted text-xs font-semibold mb-1">
            <span>POSTGRESQL DB</span>
            <Database className={`w-4 h-4 ${isDbOk ? "text-emerald-400" : "text-amber-400"}`} />
          </div>
          <div className="font-heading text-lg font-bold text-white">
            {isDbOk ? "ONLINE" : "OFFLINE"}
          </div>
          <div className="text-[11px] font-mono text-muted mt-1 truncate">
            {isDbOk ? "sales_arena connected" : "127.0.0.1:5432"}
          </div>
        </div>

        {/* SSE Event Worker */}
        <div className="rounded-2xl border border-white/10 bg-[#0D1426]/90 p-4 backdrop-blur-md">
          <div className="flex items-center justify-between text-muted text-xs font-semibold mb-1">
            <span>SSE CONSUMER</span>
            <Activity className="w-4 h-4 text-secondary" />
          </div>
          <div className="font-heading text-lg font-bold text-white uppercase">
            {health?.sseConsumer?.status || "IDLE"}
          </div>
          <div className="text-[11px] font-mono text-secondary mt-1">
            {health?.sseConsumer?.eventsProcessed ?? 0} events ingested
          </div>
        </div>
      </div>

      {/* Reconciliation Card */}
      <div className="rounded-3xl border border-white/10 bg-[#0D1426]/90 p-6 backdrop-blur-md space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-4">
          <div>
            <h3 className="font-heading font-bold text-white text-base">
              Sales Data Reconciliation
            </h3>
            <p className="text-xs text-muted mt-0.5">
              Pull latest verified sales from Safe Quote /recent-sales and idempotently ensure all bonus records and spin credits are up to date.
            </p>
          </div>
          <button
            onClick={handleReconcile}
            disabled={reconciling || !isConfigured}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-primary to-secondary font-heading text-xs font-bold text-white shadow-lg shadow-primary/25 hover:brightness-110 active:scale-95 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${reconciling ? "animate-spin" : ""}`} />
            <span>{reconciling ? "Reconciling..." : "Trigger Reconciliation"}</span>
          </button>
        </div>

        {reconcileResult && (
          <div className="p-3 rounded-xl bg-secondary/15 border border-secondary/30 text-secondary text-xs font-semibold">
            {reconcileResult}
          </div>
        )}
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

      {/* Production Architecture Summary */}
      <div className="rounded-3xl border border-white/10 bg-surface/40 p-6 backdrop-blur-md">
        <h4 className="font-heading font-bold text-white text-sm mb-2">
          Production Integration Architecture
        </h4>
        <p className="text-xs text-muted leading-relaxed">
          The Safe Quote API integrates securely on the server via <code className="text-secondary font-mono">lib/server/safequote/client.ts</code>. Real-time events are streamed from upstream <code className="text-secondary font-mono">/events</code> via a server worker, normalized, stored in PostgreSQL (<code className="text-secondary font-mono">sales_events_inbox</code> and <code className="text-secondary font-mono">validated_sales</code>), and broadcast to all browser displays through internal SSE without exposing secret tokens.
        </p>
      </div>
    </div>
  );
}

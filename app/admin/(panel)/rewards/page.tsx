"use client";

import { SpinnerPreview } from "@/components/admin/SpinnerPreview";
import { Section } from "@/components/admin/ui";

import { useState } from "react";
import { useArenaStore } from "@/store/arena-store";
import type { Reward, RewardIcon } from "@/types";
import { REWARD_ICONS, validateReward } from "@/features/rewards/validation";
import { 
  Gift, 
  Plus, 
  Edit2, 
  Trash2, 
  ArrowUp, 
  ArrowDown, 
  X, 
  AlertCircle, 
  Disc3,
  CheckCircle2
} from "lucide-react";

export default function AdminRewardsPage() {
  const store = useArenaStore();
  const [editingReward, setEditingReward] = useState<Reward | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Form states
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#FFC857");
  const [icon, setIcon] = useState<RewardIcon>("trophy");
  const [quantity, setQuantity] = useState<string>("50");
  const [weight, setWeight] = useState<number>(1);
  const [active, setActive] = useState(true);

  const openCreate = () => {
    setTitle("");
    setDescription("");
    setColor("#7568FF");
    setIcon("trophy");
    setQuantity("50");
    setWeight(1);
    setActive(true);
    setErrorMsg(null);
    setIsCreating(true);
  };

  const openEdit = (reward: Reward) => {
    setEditingReward(reward);
    setTitle(reward.title);
    setDescription(reward.description);
    setColor(reward.color);
    setIcon(reward.icon);
    setQuantity(reward.quantity === null ? "" : String(reward.quantity));
    setWeight(reward.weight);
    setActive(reward.active);
    setErrorMsg(null);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const qtyVal = quantity.trim() === "" ? null : parseInt(quantity);

    const draft = {
      id: editingReward?.id,
      title: title.trim(),
      description: description.trim(),
      color,
      icon,
      quantity: qtyVal,
      weight,
      active,
    };

    const val = validateReward(draft, store.rewards);
    if (!val.valid) {
      setErrorMsg(Object.values(val.errors)[0] || "Invalid reward parameters.");
      return;
    }

    const res = store.upsertReward(draft);
    if (!res.ok) {
      setErrorMsg(res.message || "Failed to update reward.");
      return;
    }

    setEditingReward(null);
    setIsCreating(false);
  };

  const handleDelete = (id: string) => {
    const res = store.deleteReward(id);
    if (!res.ok) {
      alert(res.message);
    }
  };

  const moveOrder = (index: number, direction: "up" | "down") => {
    const nextIdx = direction === "up" ? index - 1 : index + 1;
    if (nextIdx < 0 || nextIdx >= store.rewards.length) return;

    const ids = store.rewards.map((r) => r.id);
    const temp = ids[index];
    ids[index] = ids[nextIdx];
    ids[nextIdx] = temp;

    store.reorderRewards(ids);
  };

  const activeRewards = store.rewards.filter((r) => r.active);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-heading text-xl font-bold text-white">Prize Wheel Catalog</h2>
          <p className="text-xs text-muted">
            Configure the 3D prize wheel segments ({activeRewards.length} active segments, 4–12 required)
          </p>
        </div>

        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover font-heading text-xs font-bold text-white shadow-lg shadow-primary/25 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>Add Wheel Reward</span>
        </button>
      </div>

      <Section title="Spinner preview" description="Prize changes appear here and on the Live Arena spinner straight away. Test spins are not saved.">
        <SpinnerPreview />
      </Section>

      {/* Instant 3D Wheel Segment Preview Strip */}
      <div className="rounded-2xl border border-white/10 bg-[#0D1426] p-4">
        <span className="text-[10px] font-mono uppercase text-muted block mb-2">
          Live Wheel Slice Distribution (Clockwise Order)
        </span>
        <div className="flex h-12 w-full rounded-xl overflow-hidden border border-white/10">
          {activeRewards.map((r, i) => (
            <div
              key={r.id}
              className="flex-1 flex items-center justify-center p-1 font-heading text-[10px] font-bold text-white truncate relative group"
              style={{ backgroundColor: r.color }}
              title={`${r.title} (Weight: ${r.weight})`}
            >
              <span className="truncate drop-shadow">{r.title}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Rewards Management Table */}
      <div className="rounded-3xl border border-white/10 bg-[#0D1426]/90 overflow-hidden backdrop-blur-md">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-white/5 bg-surface/40 font-mono text-[11px] uppercase text-muted">
              <tr>
                <th className="py-3 px-4 w-12">Order</th>
                <th className="py-3 px-4">Prize Title</th>
                <th className="py-3 px-4">Segment Color</th>
                <th className="py-3 px-4">Quantity Stock</th>
                <th className="py-3 px-4">Odds Weight</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {store.rewards.map((r, idx) => (
                <tr key={r.id} className="hover:bg-white/5 transition-colors">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => moveOrder(idx, "up")}
                        disabled={idx === 0}
                        className="p-1 rounded hover:bg-white/10 text-muted disabled:opacity-20"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => moveOrder(idx, "down")}
                        disabled={idx === store.rewards.length - 1}
                        className="p-1 rounded hover:bg-white/10 text-muted disabled:opacity-20"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>

                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3.5 h-3.5 rounded-full shrink-0"
                        style={{ backgroundColor: r.color }}
                      />
                      <span className="font-heading font-bold text-white">
                        {r.title}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted block truncate max-w-xs mt-0.5">
                      {r.description}
                    </span>
                  </td>

                  <td className="py-3 px-4 font-mono text-muted">{r.color}</td>

                  <td className="py-3 px-4 font-mono">
                    {r.quantity === null ? (
                      <span className="text-secondary font-bold">Unlimited</span>
                    ) : (
                      <span>{r.quantity} available</span>
                    )}
                  </td>

                  <td className="py-3 px-4 font-mono text-gold font-bold">
                    {r.weight}
                  </td>

                  <td className="py-3 px-4">
                    {r.active ? (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-semibold text-[10px]">
                        ON WHEEL
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-white/5 text-muted font-semibold text-[10px]">
                        HIDDEN
                      </span>
                    )}
                  </td>

                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(r)}
                        className="p-1.5 rounded-lg bg-surface hover:bg-surface-hover text-muted hover:text-white transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(r.id)}
                        className="p-1.5 rounded-lg bg-surface hover:bg-rose-500/20 text-muted hover:text-rose-400 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit / Create Modal */}
      {(isCreating || editingReward) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[#0D1426] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-4">
              <h3 className="font-heading font-bold text-lg text-white">
                {editingReward ? "Edit Wheel Prize" : "Add Wheel Prize"}
              </h3>
              <button
                onClick={() => {
                  setEditingReward(null);
                  setIsCreating(false);
                }}
                className="p-1 rounded-lg hover:bg-white/10 text-muted hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {errorMsg && (
              <div className="mb-4 flex items-center gap-2 p-3 rounded-xl bg-error/15 border border-error/30 text-error text-xs">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-muted block mb-1">
                  Prize Title (Max 22 chars for wheel legibility)
                </label>
                <input
                  type="text"
                  required
                  maxLength={22}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. PlayStation 5"
                  className="w-full px-3 py-2 rounded-xl bg-surface border border-white/10 text-sm text-white focus:outline-none focus:border-primary/50"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-muted block mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Next-gen gaming console for top closer"
                  className="w-full px-3 py-2 rounded-xl bg-surface border border-white/10 text-sm text-white focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted block mb-1">
                    Segment Color (Hex)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      className="h-9 w-9 rounded-lg border-0 bg-transparent cursor-pointer"
                    />
                    <input
                      type="text"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-surface border border-white/10 text-xs font-mono text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted block mb-1">
                    Weight (Odds multiplier)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="10"
                    value={weight}
                    onChange={(e) => setWeight(parseFloat(e.target.value) || 1)}
                    className="w-full px-3 py-2 rounded-xl bg-surface border border-white/10 text-sm font-mono text-white focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted block mb-1">
                  Quantity Stock (leave blank for unlimited)
                </label>
                <input
                  type="number"
                  min="0"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="Unlimited"
                  className="w-full px-3 py-2 rounded-xl bg-surface border border-white/10 text-sm font-mono text-white focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <input
                  type="checkbox"
                  id="activePrizeToggle"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="h-4 w-4 rounded border-white/10 bg-surface accent-primary cursor-pointer"
                />
                <label htmlFor="activePrizeToggle" className="text-xs font-semibold text-white cursor-pointer">
                  Display on 3D Wheel
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => {
                    setEditingReward(null);
                    setIsCreating(false);
                  }}
                  className="px-4 py-2 rounded-xl bg-surface hover:bg-surface-hover text-xs font-semibold text-muted hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-primary hover:bg-primary-hover font-heading text-xs font-bold text-white shadow-lg shadow-primary/25"
                >
                  Save Prize
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

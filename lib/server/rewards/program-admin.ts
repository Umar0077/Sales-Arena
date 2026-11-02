import type { Pool, PoolClient } from "pg";
import { writeAudit } from "../auth/guard";
import { calendarFrom, readArenaConfig } from "../settings/arena-config";
import { assertNoDuplicate, COLS, duplicateProgramIds, listPrograms, normalizeProgram, ProgramError, programHistory, publish, rowToProgram, snapshot, todayIn, type RewardProgram } from "./programs";

/**
 * Owner-only program maintenance: safe permanent delete and "extend to a future month".
 *
 * DELETE: allowed only when no award (any status, automatic or recovered) references the program.
 * Its revision history is copied into the permanent audit log before the history rows go. Programs
 * with award history can only be archived; earned awards are never touched.
 *
 * EXTEND: moves only the end date to the last day of the chosen month (computed, never hard-coded).
 * Thresholds, amounts, stackable, eligibility, visibility, start date, activation time and awards stay
 * the same. Counting stays per business day / week / month (period keys), so months never combine.
 * Paused or expired programs are only reactivated when the Owner explicitly says so; they then earn
 * from that moment (active_since = now), so nothing is awarded retroactively for the gap.
 */

type Actor = { adminId: string; ip: string | null; userAgent: string | null };
const tx = async <T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('reward_programs'))`); // same lock as create / edit
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
};

// ------------------------------------------------------------------ delete

export async function deleteCheck(db: Pool | PoolClient, id: string) {
  const row = (await db.query(`SELECT ${COLS} FROM reward_programs WHERE id = $1`, [id])).rows[0];
  if (!row) throw new ProgramError("Reward program not found.", 404);
  const p = rowToProgram(row);
  const a = (
    await db.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'paid')::int AS paid,
              COUNT(*) FILTER (WHERE source = 'recovery' OR recovered_by IS NOT NULL)::int AS recovered,
              COALESCE(SUM(amount) FILTER (WHERE reward_type = 'cash' AND status NOT IN ('reversed', 'cancelled')), 0)::float AS cash
         FROM bonus_awards WHERE program_id = $1`,
      [id],
    )
  ).rows[0];
  const all = await listPrograms(db);
  const dupes = duplicateProgramIds(all);
  const sameAs = all.filter((o) => o.id !== p.id && o.enabled && p.enabled && o.kind === p.kind && o.salesRequired === p.salesRequired && o.scopeType === p.scopeType && o.rewardType === p.rewardType && [...o.scopeIds].sort().join() === [...p.scopeIds].sort().join());
  const duplicate = sameAs.length ? { awarding: !dupes.has(p.id), others: sameAs.map((o) => ({ id: o.id, name: o.name, awarding: !dupes.has(o.id) })) } : null;
  const blockers: string[] = [];
  if (a.total > 0) blockers.push("This reward has existing award history and cannot be permanently deleted. You can archive it instead.");
  return {
    program: { id: p.id, name: p.name, kind: p.kind, salesRequired: p.salesRequired, rewardType: p.rewardType, amount: p.amount, currency: p.currency, prizeLabel: p.prizeLabel, status: p.status, revision: p.revision },
    awards: { total: a.total, paid: a.paid, recovered: a.recovered, cash: Number(a.cash) },
    duplicate,
    canDelete: blockers.length === 0,
    blockers,
  };
}

export async function deleteProgramPermanently(pool: Pool, id: string, input: { confirm?: unknown; revision?: unknown }, actor: Actor) {
  if (input.confirm !== true) throw new ProgramError("Confirm the permanent deletion.", 428);
  let deleted: RewardProgram | null = null;
  await tx(pool, async (c) => {
    const row = (await c.query(`SELECT ${COLS} FROM reward_programs WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!row) throw new ProgramError("Reward program not found (it may already have been deleted).", 404);
    const p = rowToProgram(row);
    if (input.revision !== undefined && Number(input.revision) !== p.revision) throw new ProgramError("This program changed since you opened the dialog. Review it again.", 409);
    const check = await deleteCheck(c, id);
    if (!check.canDelete) throw new ProgramError(check.blockers.join(" "), 409);
    const history = await programHistory(c, id);
    // Permanent record first (audit_logs is never deleted), then the program's own rows.
    await writeAudit(c, {
      adminId: actor.adminId,
      action: "reward_program.deleted",
      targetType: "reward_program",
      targetId: id,
      details: { program: p, history, duplicate: check.duplicate },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    await c.query(`DELETE FROM reward_program_history WHERE program_id = $1`, [id]);
    await c.query(`DELETE FROM reward_programs WHERE id = $1`, [id]); // FK RESTRICT on bonus_awards still guards awards
    deleted = p;
  });
  const p = deleted as unknown as RewardProgram;
  publish({ id: p.id, kind: p.kind, revision: p.revision + 1 }, "deleted");
  return { id: p.id, name: p.name };
}

// ------------------------------------------------------------------ extend

const KINDS = ["daily", "weekly", "monthly"] as const;
export type ExtendStatus = "will_extend" | "already_covered" | "needs_reactivation" | "ineligible";

/** Last day of a YYYY-MM month (Date.UTC day 0 of the next month: leap years handled by the calendar). */
export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
const nextMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
};

export async function previewExtension(db: Pool | PoolClient, input: { targetMonth?: unknown; kinds?: unknown; programIds?: unknown }) {
  const cal = calendarFrom((await readArenaConfig(db)).values);
  const today = todayIn(cal.timezone);
  const currentMonth = today.slice(0, 7);
  const base = { today, currentMonth, earliestMonth: nextMonth(currentMonth), timezone: cal.timezone };
  if (input.targetMonth === undefined || input.targetMonth === null || input.targetMonth === "") return { ...base, targetMonth: null, newEndDate: null, items: [], affected: 0 };
  const targetMonth = String(input.targetMonth);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(targetMonth)) throw new ProgramError("Choose a target month (YYYY-MM).");
  if (targetMonth <= currentMonth) throw new ProgramError(`Choose a future month (after ${currentMonth}, business timezone ${cal.timezone}).`);
  const kinds = Array.isArray(input.kinds) && input.kinds.length ? input.kinds.filter((k): k is (typeof KINDS)[number] => KINDS.includes(k)) : [...KINDS];
  const ids = Array.isArray(input.programIds) ? new Set(input.programIds.map(String)) : null;
  const newEnd = lastDayOfMonth(targetMonth);
  const all = await listPrograms(db, { includeArchived: false });
  const dupes = duplicateProgramIds(all);
  const items = all
    .filter((p) => kinds.includes(p.kind) && (!ids || ids.has(p.id)))
    .map((p) => {
      let status: ExtendStatus;
      let note = "";
      const expired = !!p.endDate && p.endDate < today;
      if (p.startDate && p.startDate > newEnd) [status, note] = ["ineligible", "Starts after the chosen month."];
      else if (dupes.has(p.id)) [status, note] = ["ineligible", "Duplicate program that does not award; delete or archive it instead."];
      else if (!p.endDate || p.endDate >= newEnd) [status, note] = ["already_covered", p.endDate ? "Already runs until then." : "Has no end date (runs until changed)."];
      else if (!p.enabled || expired) [status, note] = ["needs_reactivation", !p.enabled ? "Paused: extend only if you also reactivate it." : "Expired: extend only if you also reactivate it."];
      else status = "will_extend";
      return {
        id: p.id,
        name: p.name,
        kind: p.kind,
        salesRequired: p.salesRequired,
        amount: p.amount,
        currency: p.currency,
        enabled: p.enabled,
        startDate: p.startDate,
        endDate: p.endDate,
        newEndDate: status === "will_extend" || status === "needs_reactivation" ? newEnd : p.endDate,
        activeSince: p.activeSince,
        // Reactivated programs earn only from the moment they are reactivated (nothing retroactive).
        effectiveStart: status === "needs_reactivation" ? "On reactivation (from that moment)" : p.activeSince,
        revision: p.revision,
        status,
        note,
      };
    });
  return { ...base, targetMonth, newEndDate: newEnd, items, affected: items.filter((i) => i.status === "will_extend").length };
}

export async function applyExtension(
  pool: Pool,
  input: { targetMonth?: unknown; programIds?: unknown; reactivateIds?: unknown; revisions?: unknown; confirm?: unknown },
  actor: Actor,
) {
  if (input.confirm !== true) throw new ProgramError("Confirm the extension.", 428);
  const ids = Array.isArray(input.programIds) ? input.programIds.map(String) : [];
  if (!ids.length) throw new ProgramError("Choose at least one program to extend.");
  const reactivate = new Set(Array.isArray(input.reactivateIds) ? input.reactivateIds.map(String) : []);
  const revisions = (input.revisions && typeof input.revisions === "object" ? input.revisions : {}) as Record<string, unknown>;
  const changed: Array<{ id: string; kind: RewardProgram["kind"]; revision: number; action: string }> = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  await tx(pool, async (c) => {
    const pv = await previewExtension(c, { targetMonth: input.targetMonth, programIds: ids });
    const byId = new Map(pv.items.map((i) => [i.id, i]));
    for (const id of ids) {
      const it = byId.get(id);
      if (!it) throw new ProgramError("A selected program no longer exists or is archived. Review the preview again.", 409);
      if (revisions[id] !== undefined && Number(revisions[id]) !== it.revision) throw new ProgramError(`"${it.name}" changed since the preview. Review it again.`, 409);
      const cur = rowToProgram((await c.query(`SELECT ${COLS} FROM reward_programs WHERE id = $1 FOR UPDATE`, [id])).rows[0]);
      if (it.status === "already_covered" || it.status === "ineligible") {
        skipped.push({ id, reason: it.note });
        continue;
      }
      const react = it.status === "needs_reactivation";
      if (react && !reactivate.has(id)) {
        skipped.push({ id, reason: "Not reactivated (paused or expired)." });
        continue;
      }
      if (react) await assertNoDuplicate(c, normalizeProgram({ enabled: true }, cur), id);
      await c.query(
        `UPDATE reward_programs SET end_date = $2, ${react ? "enabled = TRUE, active_since = NOW()," : ""} revision = revision + 1, updated_by = $3, updated_at = NOW() WHERE id = $1`,
        [id, pv.newEndDate, actor.adminId],
      );
      const action = react ? "extended_reactivated" : "extended";
      const p = await snapshot(c, id, action, actor.adminId);
      await writeAudit(c, {
        adminId: actor.adminId,
        action: `reward_program.${action}`,
        targetType: "reward_program",
        targetId: id,
        details: { revision: p.revision, targetMonth: pv.targetMonth, endDate: { from: cur.endDate, to: pv.newEndDate }, ...(react ? { reactivated: true, activeSince: { from: cur.activeSince, to: p.activeSince } } : {}) },
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
      changed.push({ id, kind: p.kind, revision: p.revision, action });
    }
  });
  for (const c of changed) publish(c, c.action); // after commit: Admin tabs + Live Arena refresh
  return { extended: changed.map((c) => c.id), skipped };
}

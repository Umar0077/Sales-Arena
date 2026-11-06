import { createHash } from "crypto";
import type { Pool, PoolClient } from "pg";
import { arenaBroadcaster } from "../events/broadcaster";

/**
 * The one prize catalog: PostgreSQL `rewards_catalog`. Admin screens and every Live Arena
 * wheel read it from here; the spin engine selects from the same eligible rows.
 */

export interface WheelPrize {
  id: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  displayOrder: number;
  /** null = unlimited stock. */
  quantity: number | null;
}

/** Prizes on the wheel: active, positive weight, in stock — clockwise in display order. */
export async function loadWheelCatalog(db: Pool | PoolClient): Promise<{ prizes: WheelPrize[]; revision: string }> {
  const { rows } = await db.query(
    `SELECT id, title, COALESCE(description, '') AS description, icon, color, display_order, quantity
       FROM rewards_catalog
      WHERE active AND weight > 0 AND (quantity IS NULL OR quantity > 0)
      ORDER BY display_order, id`,
  );
  const prizes: WheelPrize[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    icon: r.icon,
    color: r.color,
    displayOrder: Number(r.display_order),
    quantity: r.quantity === null ? null : Number(r.quantity),
  }));
  // Revision = hash of everything a wheel draws, so any visible change gets a new revision.
  const revision = createHash("sha256")
    .update(JSON.stringify(prizes.map((p) => [p.id, p.title, p.description, p.icon, p.color])))
    .digest("hex")
    .slice(0, 16);
  return { prizes, revision };
}

/** Call AFTER commit: tells every connected Live Arena display to fetch the new catalog. */
export async function publishCatalogUpdated(pool: Pool): Promise<string | null> {
  try {
    const { revision } = await loadWheelCatalog(pool);
    arenaBroadcaster.broadcast("rewards.catalog.updated", { revision });
    return revision;
  } catch {
    return null; // displays still pick it up on their next freshness check
  }
}

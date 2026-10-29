import { getSafeQuoteClient } from "./client";
import { extractCloserIdentity } from "./mapper";
import { dbQuery } from "../db/client";
import { getRewardEngine } from "../rewards/engine";

export interface ReconciliationResult {
  checkedCount: number;
  newSalesProcessed: number;
  errors: string[];
}

export async function reconcileRecentSales(): Promise<ReconciliationResult> {
  const client = getSafeQuoteClient();
  if (!client.isConfigured()) {
    return {
      checkedCount: 0,
      newSalesProcessed: 0,
      errors: ["Safe Quote API is not configured"],
    };
  }

  const result: ReconciliationResult = {
    checkedCount: 0,
    newSalesProcessed: 0,
    errors: [],
  };

  try {
    const recentResponse = await client.getRecentSales(undefined, true);
    const sales = recentResponse.sales || [];
    result.checkedCount = sales.length;

    const rewardEngine = getRewardEngine();

    for (const sale of sales) {
      const caseId = String(sale.caseId);
      const { userCode, name } = extractCloserIdentity(sale.closer);

      try {
        const evalResult = await rewardEngine.processValidatedSale({
          caseId,
          userCode,
          closerName: name,
          state: sale.state,
          carrier: sale.carrier,
          coverage: sale.coverage,
          premium: sale.premium,
          validatedAt: sale.validatedAt,
          rawPayload: sale,
          skipRewardEvaluation: true,
        });

        if (evalResult.isNewSale) {
          result.newSalesProcessed++;
        }
      } catch (itemErr) {
        result.errors.push(`Failed to reconcile caseId ${caseId}: ${itemErr instanceof Error ? itemErr.message : String(itemErr)}`);
      }
    }

    // Update sync checkpoint
    await dbQuery(
      `INSERT INTO sync_checkpoints (id, endpoint, last_sync_at, status, details, updated_at)
       VALUES ('recent_sales_reconciliation', '/recent-sales', NOW(), 'success', $1, NOW())
       ON CONFLICT (id) DO UPDATE
       SET last_sync_at = NOW(), status = 'success', details = $1, updated_at = NOW()`,
      [JSON.stringify({ checked: result.checkedCount, processed: result.newSalesProcessed })]
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(msg);

    await dbQuery(
      `INSERT INTO sync_checkpoints (id, endpoint, last_sync_at, status, error, updated_at)
       VALUES ('recent_sales_reconciliation', '/recent-sales', NOW(), 'error', $1, NOW())
       ON CONFLICT (id) DO UPDATE
       SET last_sync_at = NOW(), status = 'error', error = $1, updated_at = NOW()`,
      [msg]
    );
  }

  return result;
}

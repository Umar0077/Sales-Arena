import { NextRequest, NextResponse } from "next/server";
import { getSafeQuoteClient } from "@/lib/server/safequote/client";
import { SafeQuoteApiError } from "@/lib/server/safequote/errors";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") || undefined;
  const to = searchParams.get("to") || undefined;
  const bypass = searchParams.get("fresh") === "true";

  const client = getSafeQuoteClient();
  if (!client.isConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        mode: "unconfigured",
        message: "SALES_ARENA_API_TOKEN is not configured on the server",
      },
      { status: 503 }
    );
  }

  try {
    const summary = await client.getSummary({ from, to }, bypass);
    return NextResponse.json({
      ok: true,
      mode: "production",
      data: summary,
      isFilteredRange: Boolean(summary.range?.from && summary.range?.to),
    });
  } catch (err: unknown) {
    if (err instanceof SafeQuoteApiError) {
      return NextResponse.json(
        {
          ok: false,
          error: err.message,
          endpoint: err.endpoint,
          isAuthError: err.isAuthError,
          isRateLimited: err.isRateLimited,
        },
        { status: err.status }
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Internal server error fetching summary",
      },
      { status: 500 }
    );
  }
}

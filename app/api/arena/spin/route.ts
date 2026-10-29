import { NextRequest, NextResponse } from "next/server";
import { getRewardEngine } from "@/lib/server/rewards/engine";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userCode = body?.userCode;

    if (!userCode || typeof userCode !== "string") {
      return NextResponse.json(
        { ok: false, reason: "Missing or invalid closer userCode" },
        { status: 400 }
      );
    }

    const rewardEngine = getRewardEngine();
    const result = await rewardEngine.executeServerSpin(userCode);

    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { ok: false, reason: err instanceof Error ? err.message : "Failed to execute spin" },
      { status: 500 }
    );
  }
}

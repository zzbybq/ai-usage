import { NextResponse } from "next/server";
import { getUsageSnapshot } from "@/lib/usage-snapshot-cache";
import { getQuotaSnapshot } from "@/lib/quota/service";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** Shared live payload for the 15-second Tauri widget and dashboard Today poll. */
export async function GET(request: Request) {
  try {
    const force = new URL(request.url).searchParams.get("refresh") === "1";
    // Zero history days still asks sources for the previous local day so
    // cumulative counters can be rebased correctly across midnight.
    const snapshot = await getUsageSnapshot(0, force);
    const quotas = await getQuotaSnapshot(
      snapshot.sources.map((source) => source.id),
      snapshot.rateLimits
    );
    return NextResponse.json(
      {
        generatedAt: snapshot.generatedAt,
        sources: snapshot.sources,
        dailyGoal: snapshot.dailyGoal,
        today: snapshot.today,
        todayModels: snapshot.todayModels,
        rateLimits: snapshot.rateLimits,
        quotas,
        warnings: snapshot.warnings,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

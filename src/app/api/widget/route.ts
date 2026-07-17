import { NextResponse } from "next/server";
import { getUsageSnapshot } from "@/lib/usage-snapshot-cache";
import { getQuotaSnapshot } from "@/lib/quota/service";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** Lightweight payload for the 15-second Tauri widget poll. */
export async function GET() {
  try {
    // Zero history days still asks sources for the previous local day so
    // cumulative counters can be rebased correctly across midnight.
    const snapshot = await getUsageSnapshot(0);
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

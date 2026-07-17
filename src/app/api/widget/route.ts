import { NextResponse } from "next/server";
import { getUsageSnapshot } from "@/lib/usage-snapshot-cache";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Lightweight payload for the 15-second Tauri widget poll. */
export async function GET() {
  try {
    // Zero history days still asks sources for the previous local day so
    // cumulative counters can be rebased correctly across midnight.
    const snapshot = await getUsageSnapshot(0);
    return NextResponse.json(
      {
        generatedAt: snapshot.generatedAt,
        today: snapshot.today,
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

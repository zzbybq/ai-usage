import { NextResponse } from "next/server";
import { getUsageSnapshot } from "@/lib/usage-snapshot-cache";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const days = Math.min(365, Math.max(7, Number(url.searchParams.get("days") ?? 30)));
  const force = url.searchParams.get("refresh") === "1";
  try {
    const snapshot = await getUsageSnapshot(days, force);
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

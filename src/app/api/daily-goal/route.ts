import {
  MAX_DAILY_GOAL_TOKENS,
  MIN_DAILY_GOAL_TOKENS,
  readDailyGoalSettings,
  writeDailyGoalSettings,
} from "@/lib/source-settings";
import { invalidateUsageSnapshotCache } from "@/lib/usage-snapshot-cache";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return Response.json(await readDailyGoalSettings(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PUT(request: Request) {
  let body: { enabled?: unknown; targetTokens?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const targetTokens = Number(body.targetTokens);
  if (typeof body.enabled !== "boolean") {
    return Response.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  if (!Number.isFinite(targetTokens) || targetTokens < MIN_DAILY_GOAL_TOKENS || targetTokens > MAX_DAILY_GOAL_TOKENS) {
    return Response.json({ error: "targetTokens must be between 1M and 10B" }, { status: 400 });
  }

  const dailyGoal = await writeDailyGoalSettings({
    enabled: body.enabled,
    targetTokens,
  });
  invalidateUsageSnapshotCache();
  return Response.json(dailyGoal, {
    headers: { "Cache-Control": "no-store" },
  });
}

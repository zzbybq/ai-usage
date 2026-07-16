import { isSourceDetected, SOURCE_REGISTRY } from "@/lib/source-registry";
import { readSelectedSourceIds, writeSelectedSourceIds } from "@/lib/source-settings";
import { invalidateUsageSnapshotCache } from "@/lib/usage-snapshot-cache";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function getState() {
  const selected = new Set(await readSelectedSourceIds());
  const detected = await Promise.all(SOURCE_REGISTRY.map(isSourceDetected));
  return {
    sources: SOURCE_REGISTRY.map((source, index) => ({
      id: source.id,
      label: source.label,
      shortLabel: source.shortLabel,
      accent: source.accent,
      accentEnd: source.accentEnd,
      selected: selected.has(source.id),
      detected: detected[index],
    })),
  };
}

export async function GET() {
  return Response.json(await getState(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PUT(request: Request) {
  let body: { selectedSourceIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  await writeSelectedSourceIds(body.selectedSourceIds);
  invalidateUsageSnapshotCache();
  return Response.json(await getState(), {
    headers: { "Cache-Control": "no-store" },
  });
}

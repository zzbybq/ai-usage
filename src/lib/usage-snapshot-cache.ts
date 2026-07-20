import { buildSnapshot } from "./aggregate";
import { readSelectedSourceIds } from "./source-settings";
import type { UsageSnapshot } from "./types";

const LIVE_TTL_MS = 15_000;
const HISTORY_TTL_MS = 60_000;

type CacheEntry = {
  expiresAt: number;
  snapshot: UsageSnapshot;
};

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<UsageSnapshot>>();

export function usageSnapshotCacheKey(days: number, selectedSourceIds: string[]): string {
  return `${days}:${selectedSourceIds.join(",")}`;
}

export function usageSnapshotTtlMs(days: number): number {
  return days === 0 ? LIVE_TTL_MS : HISTORY_TTL_MS;
}

export function invalidateUsageSnapshotCache(): void {
  cache.clear();
}

export async function getUsageSnapshot(days: number, force = false): Promise<UsageSnapshot> {
  const selectedSourceIds = await readSelectedSourceIds();
  const key = usageSnapshotCacheKey(days, selectedSourceIds);
  const now = Date.now();
  const cached = cache.get(key);
  if (!force && cached && cached.expiresAt > now) return cached.snapshot;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = buildSnapshot(days, selectedSourceIds)
    .then((snapshot) => {
      cache.set(key, { snapshot, expiresAt: Date.now() + usageSnapshotTtlMs(days) });
      return snapshot;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, request);
  return request;
}

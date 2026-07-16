import { buildSnapshot } from "./aggregate";
import { readSelectedSourceIds } from "./source-settings";
import type { UsageSnapshot } from "./types";

const TTL_MS = 60_000;

type CacheEntry = {
  expiresAt: number;
  snapshot: UsageSnapshot;
};

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<UsageSnapshot>>();

export function invalidateUsageSnapshotCache(): void {
  cache.clear();
}

export async function getUsageSnapshot(days: number, force = false): Promise<UsageSnapshot> {
  const selectedSourceIds = await readSelectedSourceIds();
  const key = `${days}:${selectedSourceIds.join(",")}`;
  const now = Date.now();
  const cached = cache.get(key);
  if (!force && cached && cached.expiresAt > now) return cached.snapshot;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = buildSnapshot(days, selectedSourceIds)
    .then((snapshot) => {
      cache.set(key, { snapshot, expiresAt: Date.now() + TTL_MS });
      return snapshot;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, request);
  return request;
}

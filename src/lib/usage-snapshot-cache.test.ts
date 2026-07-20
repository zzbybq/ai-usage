import { describe, expect, it } from "vitest";
import { usageSnapshotCacheKey, usageSnapshotTtlMs } from "./usage-snapshot-cache";

describe("usage snapshot cache key behavior", () => {
  it("documents that automatic refresh is coalesced by day range and selected sources", () => {
    expect(usageSnapshotCacheKey(30, ["codex", "claude-code"])).toBe("30:codex,claude-code");
    expect(usageSnapshotCacheKey(7, ["codex"])).not.toBe(usageSnapshotCacheKey(30, ["codex"]));
  });

  it("keeps the shared live snapshot fresher than historical snapshots", () => {
    expect(usageSnapshotTtlMs(0)).toBe(15_000);
    expect(usageSnapshotTtlMs(30)).toBe(60_000);
  });
});

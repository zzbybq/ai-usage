import { describe, expect, it } from "vitest";

describe("usage snapshot cache key behavior", () => {
  it("documents that automatic refresh is coalesced by day range and selected sources", () => {
    const key = (days: number, sources: string[]) => `${days}:${sources.join(",")}`;
    expect(key(30, ["codex", "claude-code"])).toBe("30:codex,claude-code");
    expect(key(7, ["codex"])).not.toBe(key(30, ["codex"]));
  });
});

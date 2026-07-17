import { describe, expect, it } from "vitest";
import { mapCodexRateLimits, quotaWindowLabel } from "./codex-app-server";

describe("Codex live quota mapping", () => {
  it("uses actual window durations and computes remaining percentage", () => {
    const quota = mapCodexRateLimits({
      rateLimits: {
        limitId: "codex",
        planType: "prolite",
        primary: { usedPercent: 33, windowDurationMins: 10_080, resetsAt: 1_800_000_000 },
      },
      rateLimitResetCredits: { availableCount: 1 },
    }, "2026-07-17T00:00:00.000Z");

    expect(quota).toMatchObject({
      source: "codex",
      status: "current",
      origin: "live",
      planType: "prolite",
      resetCredits: 1,
      windows: [{ label: "7-day window", usedPercent: 33, remainingPercent: 67 }],
    });
  });

  it("does not assume every primary window is five hours", () => {
    expect(quotaWindowLabel(300)).toBe("5-hour window");
    expect(quotaWindowLabel(10_080)).toBe("7-day window");
    expect(quotaWindowLabel(90)).toBe("90-minute window");
  });

  it("automatically restores a five-hour row if Codex returns it again", () => {
    const quota = mapCodexRateLimits({
      rateLimits: {
        limitId: "codex",
        primary: { usedPercent: 12, windowDurationMins: 300 },
        secondary: { usedPercent: 33, windowDurationMins: 10_080 },
      },
    });

    expect(quota.windows.map((window) => window.label)).toEqual([
      "5-hour window",
      "7-day window",
    ]);
  });
});

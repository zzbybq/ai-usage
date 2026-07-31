import { describe, expect, it } from "vitest";
import { normalizeDailyGoalSettings, normalizeSelectedSourceIds } from "./source-settings";

describe("source selection normalization", () => {
  it("keeps known sources once and preserves their chosen order", () => {
    expect(normalizeSelectedSourceIds(["codex", "codex", "hermes", "unknown"]))
      .toEqual(["codex", "hermes"]);
  });

  it("falls back to every supported source for an empty or invalid selection", () => {
    expect(normalizeSelectedSourceIds([])).toEqual([
      "claude-code", "codex", "workbuddy", "hermes", "gemini-cli", "opencode", "cline", "grok",
    ]);
    expect(normalizeSelectedSourceIds("codex")).toEqual([
      "claude-code", "codex", "workbuddy", "hermes", "gemini-cli", "opencode", "cline", "grok",
    ]);
  });
});

describe("daily goal normalization", () => {
  it("defaults to an enabled 200M target", () => {
    expect(normalizeDailyGoalSettings(undefined)).toEqual({
      enabled: true,
      targetTokens: 200_000_000,
    });
  });

  it("keeps valid values and constrains unsafe targets", () => {
    expect(normalizeDailyGoalSettings({ enabled: false, targetTokens: 350_000_000 }))
      .toEqual({ enabled: false, targetTokens: 350_000_000 });
    expect(normalizeDailyGoalSettings({ enabled: true, targetTokens: 1 }))
      .toEqual({ enabled: true, targetTokens: 1_000_000 });
  });
});

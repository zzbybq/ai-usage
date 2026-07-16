import { describe, expect, it } from "vitest";
import { normalizeSelectedSourceIds } from "./source-settings";

describe("source selection normalization", () => {
  it("keeps known sources once and preserves their chosen order", () => {
    expect(normalizeSelectedSourceIds(["codex", "codex", "hermes", "unknown"]))
      .toEqual(["codex", "hermes"]);
  });

  it("falls back to every supported source for an empty or invalid selection", () => {
    expect(normalizeSelectedSourceIds([])).toEqual([
      "claude-code", "codex", "workbuddy", "hermes", "gemini-cli", "opencode", "cline",
    ]);
    expect(normalizeSelectedSourceIds("codex")).toEqual([
      "claude-code", "codex", "workbuddy", "hermes", "gemini-cli", "opencode", "cline",
    ]);
  });
});

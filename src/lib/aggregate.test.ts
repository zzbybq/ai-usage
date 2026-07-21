import { describe, expect, it } from "vitest";
import { isUnknownModel, localDayKeyFromIso } from "./aggregate";

describe("local date bucketing", () => {
  it("keeps an event in its host-local calendar day", () => {
    const localTimestamp = new Date(2026, 6, 14, 0, 30, 0).toISOString();
    expect(localDayKeyFromIso(localTimestamp)).toBe("2026-07-14");
  });
});

describe("model data quality", () => {
  it("recognizes source-specific unknown labels without flagging real models", () => {
    expect(isUnknownModel("unknown")).toBe(true);
    expect(isUnknownModel("codex-unknown")).toBe(true);
    expect(isUnknownModel("workbuddy_unknown")).toBe(true);
    expect(isUnknownModel("gpt-5.6-sol")).toBe(false);
  });
});

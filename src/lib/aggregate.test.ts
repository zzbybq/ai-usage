import { describe, expect, it } from "vitest";
import { localDayKeyFromIso } from "./aggregate";

describe("local date bucketing", () => {
  it("keeps an event in its host-local calendar day", () => {
    const localTimestamp = new Date(2026, 6, 14, 0, 30, 0).toISOString();
    expect(localDayKeyFromIso(localTimestamp)).toBe("2026-07-14");
  });
});

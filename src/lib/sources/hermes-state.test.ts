import { describe, expect, it } from "vitest";
import {
  emptyHermesUsageState,
  localDayKey,
  reconcileHermesUsage,
  type ObservedHermesSession,
} from "./hermes-state";

function at(day: number, hour: number): number {
  return new Date(2026, 6, day, hour).getTime();
}

function session(overrides: Partial<ObservedHermesSession> = {}): ObservedHermesSession {
  return {
    id: "session-1",
    model: "test-model",
    classifyMs: at(14, 19),
    inputTokens: 100,
    outputTokens: 20,
    cacheCreateTokens: 0,
    cacheReadTokens: 300,
    resolvedCostUSD: 1,
    ...overrides,
  };
}

describe("Hermes cumulative usage ledger", () => {
  it("preserves the first observation on the session classification day", () => {
    const state = reconcileHermesUsage(emptyHermesUsageState(), [session()], at(15, 8));
    const event = Object.values(state.events)[0];
    expect(localDayKey(new Date(event.timestamp).getTime())).toBe("2026-07-14");
    expect(event.inputTokens + event.outputTokens + event.cacheReadTokens).toBe(420);
  });

  it("attributes only later positive deltas to the observation day", () => {
    const state = reconcileHermesUsage(emptyHermesUsageState(), [session()], at(14, 20));
    reconcileHermesUsage(
      state,
      [session({ inputTokens: 160, outputTokens: 30, cacheReadTokens: 500, resolvedCostUSD: 1.5 })],
      at(15, 8)
    );
    const today = Object.values(state.events).find(
      (event) => localDayKey(new Date(event.timestamp).getTime()) === "2026-07-15"
    );
    expect(today).toMatchObject({ inputTokens: 60, outputTokens: 10, cacheReadTokens: 200 });
    expect(today?.costUSD).toBe(0.5);
  });

  it("is idempotent when counters have not changed", () => {
    const state = reconcileHermesUsage(emptyHermesUsageState(), [session()], at(14, 20));
    reconcileHermesUsage(state, [session()], at(15, 8));
    expect(Object.values(state.events)).toHaveLength(1);
  });

  it("re-baselines a regressed counter without inventing a duplicate delta", () => {
    const state = reconcileHermesUsage(emptyHermesUsageState(), [session()], at(14, 20));
    reconcileHermesUsage(state, [session({ inputTokens: 10, cacheReadTokens: 30 })], at(15, 8));
    reconcileHermesUsage(state, [session({ inputTokens: 15, cacheReadTokens: 40 })], at(15, 9));
    const today = Object.values(state.events).find(
      (event) => localDayKey(new Date(event.timestamp).getTime()) === "2026-07-15"
    );
    expect(today).toMatchObject({ inputTokens: 5, cacheReadTokens: 10 });
  });
});

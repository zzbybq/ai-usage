export type HermesCounters = {
  inputTokens: number;
  outputTokens: number;
  cacheCreateTokens: number;
  cacheReadTokens: number;
};

export type ObservedHermesSession = HermesCounters & {
  id: string;
  model: string;
  project?: string;
  classifyMs: number;
  resolvedCostUSD: number;
};

type StoredSession = HermesCounters & {
  model: string;
  project?: string;
  classifyMs: number;
  resolvedCostUSD: number;
};

export type HermesLedgerEvent = HermesCounters & {
  timestamp: string;
  model: string;
  project?: string;
  sessionId: string;
  costUSD: number;
};

export type HermesUsageState = {
  version: 1;
  sessions: Record<string, StoredSession>;
  events: Record<string, HermesLedgerEvent>;
};

export function emptyHermesUsageState(): HermesUsageState {
  return { version: 1, sessions: {}, events: {} };
}

export function localDayKey(timestampMs: number): string {
  const date = new Date(timestampMs);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function total(counters: HermesCounters): number {
  return counters.inputTokens + counters.outputTokens + counters.cacheCreateTokens + counters.cacheReadTokens;
}

function addEvent(
  state: HermesUsageState,
  session: ObservedHermesSession,
  timestampMs: number,
  counters: HermesCounters,
  costUSD: number
): void {
  if (total(counters) === 0) return;
  const key = `${localDayKey(timestampMs)}\u0000${session.id}\u0000${session.model}`;
  const existing = state.events[key];
  if (existing) {
    existing.inputTokens += counters.inputTokens;
    existing.outputTokens += counters.outputTokens;
    existing.cacheCreateTokens += counters.cacheCreateTokens;
    existing.cacheReadTokens += counters.cacheReadTokens;
    existing.costUSD += costUSD;
    existing.timestamp = new Date(timestampMs).toISOString();
    existing.project = session.project;
    return;
  }
  state.events[key] = {
    ...counters,
    timestamp: new Date(timestampMs).toISOString(),
    model: session.model,
    project: session.project,
    sessionId: session.id,
    costUSD,
  };
}

/** Convert cumulative Hermes counters into an idempotent, per-local-day ledger. */
export function reconcileHermesUsage(
  state: HermesUsageState,
  sessions: ObservedHermesSession[],
  nowMs: number
): HermesUsageState {
  for (const session of sessions) {
    const previous = state.sessions[session.id];
    if (!previous) {
      // Preserve legacy attribution for the initial baseline. Usage observed
      // after this baseline is split accurately by the snapshot day.
      addEvent(state, session, session.classifyMs, session, session.resolvedCostUSD);
    } else {
      const reset =
        session.inputTokens < previous.inputTokens ||
        session.outputTokens < previous.outputTokens ||
        session.cacheCreateTokens < previous.cacheCreateTokens ||
        session.cacheReadTokens < previous.cacheReadTokens;
      if (!reset) {
        const delta: HermesCounters = {
          inputTokens: session.inputTokens - previous.inputTokens,
          outputTokens: session.outputTokens - previous.outputTokens,
          cacheCreateTokens: session.cacheCreateTokens - previous.cacheCreateTokens,
          cacheReadTokens: session.cacheReadTokens - previous.cacheReadTokens,
        };
        addEvent(
          state,
          session,
          nowMs,
          delta,
          Math.max(session.resolvedCostUSD - previous.resolvedCostUSD, 0)
        );
      }
    }
    state.sessions[session.id] = {
      inputTokens: session.inputTokens,
      outputTokens: session.outputTokens,
      cacheCreateTokens: session.cacheCreateTokens,
      cacheReadTokens: session.cacheReadTokens,
      model: session.model,
      project: session.project,
      classifyMs: session.classifyMs,
      resolvedCostUSD: session.resolvedCostUSD,
    };
  }
  return state;
}
